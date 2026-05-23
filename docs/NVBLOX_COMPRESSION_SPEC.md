# Nvblox Mesh & Voxel Compression Spec

**Status:** Draft
**Author:** Origin Autonomy
**Date:** 2026-05-22

## Problem

nvblox publishes `Mesh` and `VoxelBlockLayer` messages at 1-10Hz over foxglove_bridge WebSocket.
Each message can be 1-16MB (100+ blocks). WiFi bandwidth becomes bottleneck.

No compression solution exists for these message types.

## Design Constraints

| Constraint | Requirement |
|-----------|-------------|
| Robot CPU | Near-zero overhead (Jetson Orin) |
| Browser CPU | Can afford heavier decode |
| Visual quality | **Zero degradation** — lossless positions, lossless normals, effectively lossless colors |
| Integration | Follow existing Cloudini converter pattern in Lichtblick |
| Bridge changes | None — foxglove_bridge forwards custom msgs as-is |

## Architecture

```
Robot (C++ ROS2 node)                    Browser (Lichtblick)
┌─────────────────────┐                  ┌──────────────────────────────┐
│ nvblox_node          │                  │ foxglove_bridge WebSocket    │
│   publishes:         │                  │                              │
│   Mesh               │                  │ CompressedNvbloxMesh         │
│   VoxelBlockLayer    │                  │   ↓ builtinMessageConverter  │
│         │            │                  │   ↓ nvbloxDecompressor.ts    │
│         ▼            │                  │   ↓                          │
│ nvblox_compressor    │   websocket      │ Mesh (decompressed)          │
│   pack + shuffle     │ ──────────────►  │   ↓                          │
│   + ZSTD level 1     │                  │ NvbloxExtension (renders)    │
│   publishes:         │                  │                              │
│   CompressedNvbloxMesh│                 └──────────────────────────────┘
│   CompressedNvbloxVoxelBlockLayer│
└─────────────────────┘
```

## Part 1: ROS2 Message Definitions

### CompressedNvbloxMesh.msg

```
std_msgs/Header header
float32 block_size_m
nvblox_msgs/Index3D[] block_indices
bool clear

# Compression metadata
string format                    # "qzstd_v1"
uint32 num_blocks                # number of compressed blocks
uint32[] block_vertex_counts     # vertex count per block
uint32[] block_triangle_counts   # triangle count per block (number of indices, not faces)
uint32[] block_has_normals       # 1 if block has normals, 0 otherwise
uint32[] block_has_colors        # 1 if block has colors, 0 otherwise
uint32[] block_byte_sizes        # compressed byte size per block

# All blocks packed sequentially, then ZSTD compressed as one blob
uint8[] compressed_data
```

### CompressedNvbloxVoxelBlockLayer.msg

```
std_msgs/Header header
float32 block_size_m
float32 voxel_size_m
int32 layer_type
nvblox_msgs/Index3D[] block_indices
bool clear

# Compression metadata
string format                    # "qzstd_v1"
uint32 num_blocks
uint32[] block_voxel_counts      # voxel count per block
uint32[] block_has_colors        # 1 if block has colors, 0 otherwise
uint32[] block_byte_sizes        # compressed byte size per block

uint8[] compressed_data
```

## Part 2: Wire Format — `qzstd_v1`

### Per-Block Binary Layout (before ZSTD)

#### MeshBlock

```
┌─────────────────────────────────────────────────────┐
│ Section 0: Positions (byte-shuffled float32)         │
│   Length: vertex_count * 3 * 4 bytes                 │
│   Layout: all byte[0]s, all byte[1]s, ...byte[3]s   │
│   of the flat [x0,y0,z0,x1,y1,z1,...] float32 array │
├─────────────────────────────────────────────────────┤
│ Section 1: Normals (byte-shuffled float32)           │
│   Length: vertex_count * 3 * 4 bytes (if has_normals)│
│   Same byte-shuffle as positions                     │
│   OMITTED if has_normals == 0                        │
├─────────────────────────────────────────────────────┤
│ Section 2: Colors (packed uint8 RGBA)                │
│   Length: vertex_count * 4 bytes (if has_colors)     │
│   Each color: [R, G, B, A] as uint8 (0-255)         │
│   Conversion: float32 * 255 → uint8, clamped         │
│   OMITTED if has_colors == 0                         │
├─────────────────────────────────────────────────────┤
│ Section 3: Triangle indices (delta-encoded int32)    │
│   Length: triangle_count * 4 bytes                   │
│   Delta: indices[i] = indices[i] - indices[i-1]     │
│   First index stored as-is                           │
│   Stored as int32 (delta can be negative)            │
└─────────────────────────────────────────────────────┘
```

#### VoxelBlock

```
┌─────────────────────────────────────────────────────┐
│ Section 0: Centers (byte-shuffled float32)           │
│   Length: voxel_count * 3 * 4 bytes                  │
│   Layout: all byte[0]s, all byte[1]s, ...byte[3]s   │
│   of the flat [x0,y0,z0,x1,y1,z1,...] float32 array │
├─────────────────────────────────────────────────────┤
│ Section 1: Colors (packed uint8 RGBA)                │
│   Length: voxel_count * 4 bytes (if has_colors)      │
│   OMITTED if has_colors == 0                         │
└─────────────────────────────────────────────────────┘
```

### Full Message Packing

```
Block 0 binary | Block 1 binary | ... | Block N binary
└──────────────── ZSTD level 1 compress ──────────────┘
                         │
                         ▼
               compressed_data field
```

`block_byte_sizes[]` stores the PRE-compression size of each block so the browser
can split the decompressed buffer back into individual blocks.

Wait — this is wrong. After ZSTD decompression, we get the concatenated blocks.
We need to know where each block starts in the DECOMPRESSED buffer.

**Correction:** `block_byte_sizes[]` = **uncompressed** byte size of each block.
Browser decompresses entire blob, then slices using cumulative offsets from `block_byte_sizes`.

## Part 3: Byte Shuffling

Byte shuffling reorders a float32 array so all first bytes are grouped, all second bytes, etc.
This creates runs of similar values that ZSTD compresses 2-3x better.

### Encode (C++ robot side)

```cpp
void byteShuffle(const uint8_t* src, uint8_t* dst, size_t numElements, size_t elementSize) {
    for (size_t i = 0; i < numElements; i++) {
        for (size_t b = 0; b < elementSize; b++) {
            dst[b * numElements + i] = src[i * elementSize + b];
        }
    }
}

// Usage for positions:
// float32 array of N*3 floats → treat as N*3 elements of 4 bytes each
std::vector<uint8_t> shuffled(numFloats * 4);
byteShuffle(reinterpret_cast<const uint8_t*>(positions.data()),
            shuffled.data(), numFloats, sizeof(float));
```

### Decode (TypeScript browser side)

```typescript
function byteUnshuffle(src: Uint8Array, numElements: number, elementSize: number): Uint8Array {
  const dst = new Uint8Array(numElements * elementSize);
  for (let i = 0; i < numElements; i++) {
    for (let b = 0; b < elementSize; b++) {
      dst[i * elementSize + b] = src[b * numElements + i]!;
    }
  }
  return dst;
}
```

## Part 4: Delta Encoding for Triangle Indices

Triangle indices in nvblox mesh blocks tend to be sequential (0,1,2,1,2,3,...).
Delta encoding turns large values into small deltas that compress much better.

### Encode (C++ robot side)

```cpp
void deltaEncode(int32_t* data, size_t count) {
    for (size_t i = count - 1; i > 0; i--) {
        data[i] = data[i] - data[i - 1];
    }
    // data[0] stays as-is
}
```

### Decode (TypeScript browser side)

```typescript
function deltaDecode(data: Int32Array): void {
  for (let i = 1; i < data.length; i++) {
    data[i] = data[i]! + data[i - 1]!;
  }
}
```

## Part 5: Color Packing

nvblox colors are `std_msgs/ColorRGBA` — float32 RGBA where values are 0.0-1.0
representing integer 0-255 color values. Packing to uint8 is effectively lossless.

### Encode (C++ robot side)

```cpp
void packColors(const std::vector<std_msgs::msg::ColorRGBA>& colors,
                uint8_t* dst) {
    for (size_t i = 0; i < colors.size(); i++) {
        dst[i * 4 + 0] = static_cast<uint8_t>(std::clamp(colors[i].r * 255.0f, 0.0f, 255.0f));
        dst[i * 4 + 1] = static_cast<uint8_t>(std::clamp(colors[i].g * 255.0f, 0.0f, 255.0f));
        dst[i * 4 + 2] = static_cast<uint8_t>(std::clamp(colors[i].b * 255.0f, 0.0f, 255.0f));
        dst[i * 4 + 3] = static_cast<uint8_t>(std::clamp(colors[i].a * 255.0f, 0.0f, 255.0f));
    }
}
```

### Decode (TypeScript browser side)

```typescript
function unpackColors(packed: Uint8Array, count: number): Color[] {
  const colors: Color[] = new Array(count);
  for (let i = 0; i < count; i++) {
    colors[i] = {
      r: packed[i * 4]! / 255,
      g: packed[i * 4 + 1]! / 255,
      b: packed[i * 4 + 2]! / 255,
      a: packed[i * 4 + 3]! / 255,
    };
  }
  return colors;
}
```

## Part 6: Complete C++ Encoder (Robot Side)

### ROS2 Node: `nvblox_compressor`

```cpp
#include <rclcpp/rclcpp.hpp>
#include <zstd.h>
#include "nvblox_msgs/msg/mesh.hpp"
#include "nvblox_msgs/msg/voxel_block_layer.hpp"
#include "compressed_nvblox_msgs/msg/compressed_nvblox_mesh.hpp"
#include "compressed_nvblox_msgs/msg/compressed_nvblox_voxel_block_layer.hpp"

class NvbloxCompressor : public rclcpp::Node {
public:
  NvbloxCompressor() : Node("nvblox_compressor") {
    // Declare parameters
    declare_parameter("mesh_topics", std::vector<std::string>{});
    declare_parameter("voxel_topics", std::vector<std::string>{});
    declare_parameter("zstd_level", 1);

    auto mesh_topics = get_parameter("mesh_topics").as_string_array();
    auto voxel_topics = get_parameter("voxel_topics").as_string_array();
    zstd_level_ = get_parameter("zstd_level").as_int();

    for (const auto& topic : mesh_topics) {
      auto sub = create_subscription<nvblox_msgs::msg::Mesh>(
        topic, rclcpp::SensorDataQoS(),
        [this, topic](const nvblox_msgs::msg::Mesh::SharedPtr msg) {
          compressAndPublishMesh(topic, msg);
        });
      mesh_subs_.push_back(sub);

      auto pub = create_publisher<compressed_nvblox_msgs::msg::CompressedNvbloxMesh>(
        topic + "/compressed", rclcpp::SensorDataQoS());
      mesh_pubs_[topic] = pub;
    }

    for (const auto& topic : voxel_topics) {
      auto sub = create_subscription<nvblox_msgs::msg::VoxelBlockLayer>(
        topic, rclcpp::SensorDataQoS(),
        [this, topic](const nvblox_msgs::msg::VoxelBlockLayer::SharedPtr msg) {
          compressAndPublishVoxel(topic, msg);
        });
      voxel_subs_.push_back(sub);

      auto pub = create_publisher<compressed_nvblox_msgs::msg::CompressedNvbloxVoxelBlockLayer>(
        topic + "/compressed", rclcpp::SensorDataQoS());
      voxel_pubs_[topic] = pub;
    }
  }

private:
  int zstd_level_;
  // ... subscribers, publishers, compress methods
  // See full implementation in compressed_nvblox_msgs package

  void compressAndPublishMesh(
      const std::string& topic,
      const nvblox_msgs::msg::Mesh::SharedPtr& msg) {
    auto out = std::make_unique<compressed_nvblox_msgs::msg::CompressedNvbloxMesh>();
    out->header = msg->header;
    out->block_size_m = msg->block_size_m;
    out->block_indices = msg->block_indices;
    out->clear = msg->clear;
    out->format = "qzstd_v1";
    out->num_blocks = msg->blocks.size();

    // Pack all blocks into one buffer
    std::vector<uint8_t> packed_buffer;
    for (size_t b = 0; b < msg->blocks.size(); b++) {
      const auto& block = msg->blocks[b];
      size_t block_start = packed_buffer.size();

      uint32_t vc = block.vertices.size();
      uint32_t tc = block.triangles.size();
      bool has_normals = block.normals.size() == vc;
      bool has_colors = block.colors.size() == vc;

      out->block_vertex_counts.push_back(vc);
      out->block_triangle_counts.push_back(tc);
      out->block_has_normals.push_back(has_normals ? 1 : 0);
      out->block_has_colors.push_back(has_colors ? 1 : 0);

      // Section 0: byte-shuffled positions
      size_t num_floats = vc * 3;
      std::vector<float> pos_flat(num_floats);
      for (size_t i = 0; i < vc; i++) {
        pos_flat[i*3]   = block.vertices[i].x;
        pos_flat[i*3+1] = block.vertices[i].y;
        pos_flat[i*3+2] = block.vertices[i].z;
      }
      size_t pos_bytes = num_floats * 4;
      size_t old_size = packed_buffer.size();
      packed_buffer.resize(old_size + pos_bytes);
      byteShuffle(reinterpret_cast<const uint8_t*>(pos_flat.data()),
                  packed_buffer.data() + old_size, num_floats, 4);

      // Section 1: byte-shuffled normals (if present)
      if (has_normals) {
        std::vector<float> norm_flat(num_floats);
        for (size_t i = 0; i < vc; i++) {
          norm_flat[i*3]   = block.normals[i].x;
          norm_flat[i*3+1] = block.normals[i].y;
          norm_flat[i*3+2] = block.normals[i].z;
        }
        old_size = packed_buffer.size();
        packed_buffer.resize(old_size + pos_bytes);
        byteShuffle(reinterpret_cast<const uint8_t*>(norm_flat.data()),
                    packed_buffer.data() + old_size, num_floats, 4);
      }

      // Section 2: packed uint8 RGBA colors (if present)
      if (has_colors) {
        old_size = packed_buffer.size();
        packed_buffer.resize(old_size + vc * 4);
        packColors(block.colors, packed_buffer.data() + old_size);
      }

      // Section 3: delta-encoded triangle indices
      if (tc > 0) {
        std::vector<int32_t> deltas(block.triangles.begin(), block.triangles.end());
        deltaEncode(deltas.data(), deltas.size());
        old_size = packed_buffer.size();
        packed_buffer.resize(old_size + tc * 4);
        std::memcpy(packed_buffer.data() + old_size, deltas.data(), tc * 4);
      }

      out->block_byte_sizes.push_back(packed_buffer.size() - block_start);
    }

    // ZSTD compress entire buffer
    size_t max_compressed = ZSTD_compressBound(packed_buffer.size());
    out->compressed_data.resize(max_compressed);
    size_t compressed_size = ZSTD_compress(
      out->compressed_data.data(), max_compressed,
      packed_buffer.data(), packed_buffer.size(),
      zstd_level_);
    out->compressed_data.resize(compressed_size);

    mesh_pubs_[topic]->publish(std::move(out));
  }
};
```

### Launch File

```python
from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription([
        Node(
            package='compressed_nvblox_msgs',
            executable='nvblox_compressor',
            name='nvblox_compressor',
            parameters=[{
                'mesh_topics': [
                    '/global_mapper/nvblox_node/mesh',
                    '/local_mapper/nvblox_node/mesh',
                ],
                'voxel_topics': [
                    '/global_mapper/nvblox_node/semantic_layer',
                    '/local_mapper/nvblox_node/semantic_layer',
                ],
                'zstd_level': 1,
            }],
            output='screen',
        ),
    ])
```

## Part 7: Lichtblick Browser Decompressor

### File Structure

```
packages/suite-base/src/services/nvblox-compression/
├── types.ts                    # CompressedNvbloxMesh, CompressedNvbloxVoxelBlockLayer types
├── nvbloxDecompressor.ts       # Core decompression logic
└── builtinNvbloxConverters.ts  # Converter registration (merged into existing builtinMessageConverters)
```

### types.ts

```typescript
import type { Header, Index3D } from "../../types/NvbloxMessages";

export type CompressedNvbloxMesh = {
  header: Header;
  block_size_m: number;
  block_indices: Index3D[];
  clear: boolean;
  format: string;
  num_blocks: number;
  block_vertex_counts: number[];
  block_triangle_counts: number[];
  block_has_normals: number[];
  block_has_colors: number[];
  block_byte_sizes: number[];
  compressed_data: Uint8Array;
};

export type CompressedNvbloxVoxelBlockLayer = {
  header: Header;
  block_size_m: number;
  voxel_size_m: number;
  layer_type: number;
  block_indices: Index3D[];
  clear: boolean;
  format: string;
  num_blocks: number;
  block_voxel_counts: number[];
  block_has_colors: number[];
  block_byte_sizes: number[];
  compressed_data: Uint8Array;
};
```

### nvbloxDecompressor.ts

```typescript
import { decompress } from "fzstd";

import type { Mesh, MeshBlock, VoxelBlock, VoxelBlockLayer } from "../../types/NvbloxMessages";
import type { CompressedNvbloxMesh, CompressedNvbloxVoxelBlockLayer } from "./types";

function byteUnshuffle(src: Uint8Array, numElements: number, elementSize: number): Uint8Array {
  const dst = new Uint8Array(numElements * elementSize);
  for (let i = 0; i < numElements; i++) {
    for (let b = 0; b < elementSize; b++) {
      dst[i * elementSize + b] = src[b * numElements + i]!;
    }
  }
  return dst;
}

function deltaDecode(data: Int32Array): void {
  for (let i = 1; i < data.length; i++) {
    data[i] = data[i]! + data[i - 1]!;
  }
}

function unpackPositions(
  buffer: Uint8Array,
  offset: number,
  count: number,
): { positions: { x: number; y: number; z: number }[]; bytesRead: number } {
  const numFloats = count * 3;
  const byteLen = numFloats * 4;
  const shuffled = buffer.subarray(offset, offset + byteLen);
  const unshuffled = byteUnshuffle(shuffled, numFloats, 4);
  const floats = new Float32Array(unshuffled.buffer, unshuffled.byteOffset, numFloats);

  const positions = new Array(count);
  for (let i = 0; i < count; i++) {
    positions[i] = { x: floats[i * 3]!, y: floats[i * 3 + 1]!, z: floats[i * 3 + 2]! };
  }
  return { positions, bytesRead: byteLen };
}

function unpackColors(
  buffer: Uint8Array,
  offset: number,
  count: number,
): { colors: { r: number; g: number; b: number; a: number }[]; bytesRead: number } {
  const byteLen = count * 4;
  const colors = new Array(count);
  for (let i = 0; i < count; i++) {
    const base = offset + i * 4;
    colors[i] = {
      r: buffer[base]! / 255,
      g: buffer[base + 1]! / 255,
      b: buffer[base + 2]! / 255,
      a: buffer[base + 3]! / 255,
    };
  }
  return { colors, bytesRead: byteLen };
}

function unpackTriangles(
  buffer: Uint8Array,
  offset: number,
  count: number,
): { triangles: number[]; bytesRead: number } {
  const byteLen = count * 4;
  const raw = new Int32Array(buffer.buffer, buffer.byteOffset + offset, count);
  const indices = new Int32Array(raw); // copy for mutation
  deltaDecode(indices);
  const triangles = Array.from(indices);
  return { triangles, bytesRead: byteLen };
}

export function decompressNvbloxMesh(compressed: CompressedNvbloxMesh): Mesh | undefined {
  if (compressed.format !== "qzstd_v1") {
    console.warn(`[nvblox-compression] Unknown format: ${compressed.format}`);
    return undefined;
  }

  // ZSTD decompress
  const decompressed = decompress(compressed.compressed_data);

  // Reconstruct blocks
  const blocks: MeshBlock[] = [];
  let offset = 0;

  for (let b = 0; b < compressed.num_blocks; b++) {
    const vertexCount = compressed.block_vertex_counts[b]!;
    const triangleCount = compressed.block_triangle_counts[b]!;
    const hasNormals = compressed.block_has_normals[b]! === 1;
    const hasColors = compressed.block_has_colors[b]! === 1;

    // Section 0: positions
    const { positions: vertices, bytesRead: posBytes } =
      unpackPositions(decompressed, offset, vertexCount);
    offset += posBytes;

    // Section 1: normals
    let normals: { x: number; y: number; z: number }[] = [];
    if (hasNormals) {
      const result = unpackPositions(decompressed, offset, vertexCount);
      normals = result.positions;
      offset += result.bytesRead;
    }

    // Section 2: colors
    let colors: { r: number; g: number; b: number; a: number }[] = [];
    if (hasColors) {
      const result = unpackColors(decompressed, offset, vertexCount);
      colors = result.colors;
      offset += result.bytesRead;
    }

    // Section 3: triangles
    let triangles: number[] = [];
    if (triangleCount > 0) {
      const result = unpackTriangles(decompressed, offset, triangleCount);
      triangles = result.triangles;
      offset += result.bytesRead;
    }

    blocks.push({ vertices, normals, colors, triangles });
  }

  return {
    header: compressed.header,
    block_size_m: compressed.block_size_m,
    block_indices: compressed.block_indices,
    blocks,
    clear: compressed.clear,
  };
}

export function decompressNvbloxVoxelBlockLayer(
  compressed: CompressedNvbloxVoxelBlockLayer,
): VoxelBlockLayer | undefined {
  if (compressed.format !== "qzstd_v1") {
    console.warn(`[nvblox-compression] Unknown format: ${compressed.format}`);
    return undefined;
  }

  const decompressed = decompress(compressed.compressed_data);

  const blocks: VoxelBlock[] = [];
  let offset = 0;

  for (let b = 0; b < compressed.num_blocks; b++) {
    const voxelCount = compressed.block_voxel_counts[b]!;
    const hasColors = compressed.block_has_colors[b]! === 1;

    // Section 0: centers
    const { positions: centers, bytesRead: posBytes } =
      unpackPositions(decompressed, offset, voxelCount);
    offset += posBytes;

    // Section 1: colors
    let colors: { r: number; g: number; b: number; a: number }[] = [];
    if (hasColors) {
      const result = unpackColors(decompressed, offset, voxelCount);
      colors = result.colors;
      offset += result.bytesRead;
    }

    blocks.push({ centers, colors });
  }

  return {
    header: compressed.header,
    block_size_m: compressed.block_size_m,
    voxel_size_m: compressed.voxel_size_m,
    block_indices: compressed.block_indices,
    blocks,
    clear: compressed.clear,
    layer_type: compressed.layer_type,
  };
}
```

### Converter Registration

Add to existing `builtinMessageConverters.ts`:

```typescript
{
  fromSchemaName: "compressed_nvblox_msgs/msg/CompressedNvbloxMesh",
  toSchemaName: "nvblox_msgs/msg/Mesh",
  converter: (inputMessage: unknown) => {
    return decompressNvbloxMesh(inputMessage as CompressedNvbloxMesh);
  },
},
{
  fromSchemaName: "compressed_nvblox_msgs/msg/CompressedNvbloxVoxelBlockLayer",
  toSchemaName: "nvblox_msgs/msg/VoxelBlockLayer",
  converter: (inputMessage: unknown) => {
    return decompressNvbloxVoxelBlockLayer(inputMessage as CompressedNvbloxVoxelBlockLayer);
  },
},
```

### Message Definitions Registration

Add to `NvbloxMessageDefinitions.ts` and `basicDatatypes.ts`:

```typescript
"compressed_nvblox_msgs/msg/CompressedNvbloxMesh": {
  name: "compressed_nvblox_msgs/msg/CompressedNvbloxMesh",
  definitions: [
    { name: "header", type: "std_msgs/Header", isComplex: true, isArray: false },
    { name: "block_size_m", type: "float32", isComplex: false, isArray: false },
    { name: "block_indices", type: "nvblox_msgs/Index3D", isComplex: true, isArray: true },
    { name: "clear", type: "bool", isComplex: false, isArray: false },
    { name: "format", type: "string", isComplex: false, isArray: false },
    { name: "num_blocks", type: "uint32", isComplex: false, isArray: false },
    { name: "block_vertex_counts", type: "uint32", isComplex: false, isArray: true },
    { name: "block_triangle_counts", type: "uint32", isComplex: false, isArray: true },
    { name: "block_has_normals", type: "uint32", isComplex: false, isArray: true },
    { name: "block_has_colors", type: "uint32", isComplex: false, isArray: true },
    { name: "block_byte_sizes", type: "uint32", isComplex: false, isArray: true },
    { name: "compressed_data", type: "uint8", isComplex: false, isArray: true },
  ],
},

"compressed_nvblox_msgs/msg/CompressedNvbloxVoxelBlockLayer": {
  name: "compressed_nvblox_msgs/msg/CompressedNvbloxVoxelBlockLayer",
  definitions: [
    { name: "header", type: "std_msgs/Header", isComplex: true, isArray: false },
    { name: "block_size_m", type: "float32", isComplex: false, isArray: false },
    { name: "voxel_size_m", type: "float32", isComplex: false, isArray: false },
    { name: "layer_type", type: "int32", isComplex: false, isArray: false },
    { name: "block_indices", type: "nvblox_msgs/Index3D", isComplex: true, isArray: true },
    { name: "clear", type: "bool", isComplex: false, isArray: false },
    { name: "format", type: "string", isComplex: false, isArray: false },
    { name: "num_blocks", type: "uint32", isComplex: false, isArray: false },
    { name: "block_voxel_counts", type: "uint32", isComplex: false, isArray: true },
    { name: "block_has_colors", type: "uint32", isComplex: false, isArray: true },
    { name: "block_byte_sizes", type: "uint32", isComplex: false, isArray: true },
    { name: "compressed_data", type: "uint8", isComplex: false, isArray: true },
  ],
},
```

## Part 8: Performance Budget

### Robot Side (Jetson Orin)

| Operation | Per Block | 100 Blocks | 200 Blocks (both mappers) |
|-----------|-----------|------------|--------------------------|
| Flatten float arrays | ~0.005 ms | 0.5 ms | 1 ms |
| Byte shuffle | ~0.01 ms | 1 ms | 2 ms |
| Color pack | ~0.005 ms | 0.5 ms | 1 ms |
| Delta encode | ~0.002 ms | 0.2 ms | 0.4 ms |
| ZSTD level 1 | ~0.05 ms | 5 ms | 10 ms |
| **Total** | **~0.07 ms** | **~7 ms** | **~14 ms** |

At 5 Hz publish rate: **14ms / 200ms budget = 7% CPU**. Acceptable.

### Browser Side

| Operation | Per Block | 100 Blocks |
|-----------|-----------|------------|
| ZSTD decompress (fzstd) | n/a (whole blob) | ~2 ms |
| Byte unshuffle | ~0.02 ms | 2 ms |
| Color unpack | ~0.01 ms | 1 ms |
| Delta decode | ~0.005 ms | 0.5 ms |
| Object construction | ~0.02 ms | 2 ms |
| **Total** | — | **~7.5 ms** |

At 60fps: 7.5ms / 16.6ms budget = 45%. Fine — decode happens on message arrival, not per frame.

### Bandwidth Savings

| Scenario | Raw | Compressed | Savings |
|----------|-----|-----------|---------|
| 100 mesh blocks, 1K verts each | 4.8 MB | ~1.2-1.6 MB | **67-75%** |
| 50 voxel blocks, 500 voxels each | 1.2 MB | ~0.3-0.4 MB | **67-75%** |
| Both mappers combined at 5 Hz | 60 MB/s | ~15-20 MB/s | **67-75%** |

## Part 9: Testing Strategy

### Unit Tests (Lichtblick)

1. **Round-trip test**: Encode a known MeshBlock → compress → decompress → compare bit-exact
2. **Byte shuffle/unshuffle**: Verify round-trip identity for various array sizes
3. **Delta encode/decode**: Verify round-trip for typical nvblox index patterns
4. **Color pack/unpack**: Verify 0-255 int values survive round-trip through float conversion
5. **Edge cases**: Empty blocks, blocks with no colors, blocks with no normals, single-vertex blocks

### Integration Tests

1. **Mock compressed message → converter → NvbloxExtension**: Verify end-to-end rendering
2. **Schema registration**: Verify compressed schemas appear in topic list
3. **Converter discovery**: Verify `topicIsConvertibleToSchema` works for compressed → raw

### Robot-Side Tests

1. **Compression ratio**: Measure on real nvblox data
2. **Latency**: Measure encode time per message
3. **Correctness**: Publish raw + compressed, compare decoded output

## Part 10: Dependency

### Browser (Lichtblick)

```
fzstd: ^1.0.1    # Pure JS ZSTD decompressor, 8KB minified
```

No WASM dependencies. No Draco. Pure JavaScript.

### Robot (ROS2)

```
libzstd-dev       # ZSTD compression library (apt install)
```

Already commonly available on Jetson images.

## Part 11: Rollout Plan

### Phase 1: Lichtblick Decompressor (this PR)
- Add `fzstd` dependency
- Create `services/nvblox-compression/` module
- Register converters in `builtinMessageConverters`
- Register message definitions
- Add unit tests
- **No breaking changes** — uncompressed topics still work via NvbloxExtension

### Phase 2: ROS2 Compressor Package (separate repo)
- Create `compressed_nvblox_msgs` package
- Implement `nvblox_compressor` node
- Integration test on Jetson
- Launch file for both mappers

### Phase 3: Deploy
- Add compressor node to robot docker compose
- foxglove_bridge already forwards custom msgs
- Browser auto-detects and decompresses via converter
- Raw topics can coexist with compressed topics (no conflict)
