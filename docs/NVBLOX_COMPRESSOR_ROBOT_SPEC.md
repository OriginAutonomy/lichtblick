# Nvblox Compressor — Robot-Side Implementation Spec

**For:** ROS2 C++ package running on Jetson Orin
**Consumes:** `nvblox_msgs/msg/Mesh`, `nvblox_msgs/msg/VoxelBlockLayer`
**Produces:** `compressed_nvblox_msgs/msg/CompressedNvbloxMesh`, `compressed_nvblox_msgs/msg/CompressedNvbloxVoxelBlockLayer`
**Browser decompressor:** Already built in Lichtblick (`services/nvblox-compression/`)

---

## 1. Package Structure

```
compressed_nvblox_msgs/
├── CMakeLists.txt
├── package.xml
├── msg/
│   ├── CompressedNvbloxMesh.msg
│   └── CompressedNvbloxVoxelBlockLayer.msg
├── src/
│   ├── nvblox_compressor_node.cpp
│   └── encoding.cpp
├── include/
│   └── compressed_nvblox_msgs/
│       └── encoding.hpp
└── launch/
    └── nvblox_compressor.launch.py
```

### Dependencies

```xml
<!-- package.xml -->
<depend>rclcpp</depend>
<depend>rclcpp_components</depend>
<depend>nvblox_msgs</depend>
<depend>std_msgs</depend>
<build_depend>rosidl_default_generators</build_depend>
<exec_depend>rosidl_default_runtime</exec_depend>

<!-- System -->
<build_depend>libzstd-dev</build_depend>
```

```bash
# Install ZSTD
sudo apt install libzstd-dev
```

---

## 2. Message Definitions

### msg/CompressedNvbloxMesh.msg

```
std_msgs/Header header
float32 block_size_m
nvblox_msgs/Index3D[] block_indices
bool clear

# Compression metadata
string format                    # Always "qzstd_v1"
uint32 num_blocks
uint32[] block_vertex_counts     # Vertex count per block
uint32[] block_triangle_counts   # Triangle INDEX count per block (not face count)
uint32[] block_has_normals       # 1 = has normals, 0 = no normals
uint32[] block_has_colors        # 1 = has colors, 0 = no colors
uint32[] block_byte_sizes        # UNCOMPRESSED byte size per block

# All blocks packed then ZSTD compressed as single blob
uint8[] compressed_data
```

### msg/CompressedNvbloxVoxelBlockLayer.msg

```
std_msgs/Header header
float32 block_size_m
float32 voxel_size_m
int32 layer_type
nvblox_msgs/Index3D[] block_indices
bool clear

string format                    # Always "qzstd_v1"
uint32 num_blocks
uint32[] block_voxel_counts      # Voxel count per block
uint32[] block_has_colors        # 1 = has colors, 0 = no colors
uint32[] block_byte_sizes        # UNCOMPRESSED byte size per block

uint8[] compressed_data
```

---

## 3. Wire Format — `qzstd_v1`

### Per MeshBlock Binary Layout

Sections are concatenated in this exact order. Sections are OMITTED (zero bytes) when the corresponding `has_*` flag is 0.

```
┌─────────────────────────────────────────────┐
│ Section 0: Byte-shuffled positions           │
│   float32[vertex_count * 3] → byte shuffle  │
│   Size: vertex_count * 3 * 4 bytes          │
├─────────────────────────────────────────────┤
│ Section 1: Byte-shuffled normals             │
│   ONLY if has_normals == 1                   │
│   float32[vertex_count * 3] → byte shuffle  │
│   Size: vertex_count * 3 * 4 bytes          │
├─────────────────────────────────────────────┤
│ Section 2: Packed RGBA colors                │
│   ONLY if has_colors == 1                    │
│   float32 RGBA → uint8 RGBA (×255, clamp)   │
│   Size: vertex_count * 4 bytes              │
├─────────────────────────────────────────────┤
│ Section 3: Delta-encoded triangle indices    │
│   ONLY if triangle_count > 0                │
│   int32[] → delta encode → int32[]          │
│   Size: triangle_count * 4 bytes            │
└─────────────────────────────────────────────┘
```

### Per VoxelBlock Binary Layout

```
┌─────────────────────────────────────────────┐
│ Section 0: Byte-shuffled centers             │
│   float32[voxel_count * 3] → byte shuffle   │
│   Size: voxel_count * 3 * 4 bytes           │
├─────────────────────────────────────────────┤
│ Section 1: Packed RGBA colors                │
│   ONLY if has_colors == 1                    │
│   Size: voxel_count * 4 bytes               │
└─────────────────────────────────────────────┘
```

### Full Message Assembly

```
[Block 0 bytes] [Block 1 bytes] ... [Block N bytes]
└──────────── ZSTD compress (level 1) ────────────┘
                       ↓
             compressed_data field

block_byte_sizes[i] = UNCOMPRESSED size of block i
(browser uses cumulative sum to split decompressed buffer)
```

---

## 4. Encoding Functions

### Byte Shuffle

Groups all first bytes together, all second bytes, etc. Makes ZSTD compress float32 arrays 2-3x better.

```cpp
#include <cstdint>
#include <cstddef>

void byteShuffle(const uint8_t* src, uint8_t* dst,
                 size_t numElements, size_t elementSize) {
    for (size_t i = 0; i < numElements; i++) {
        for (size_t b = 0; b < elementSize; b++) {
            dst[b * numElements + i] = src[i * elementSize + b];
        }
    }
}

// Usage: shuffle N*3 float32 values (positions or normals)
// numElements = vertex_count * 3
// elementSize = 4 (sizeof(float))
```

**Visual example:**
```
Input:  [B0 B1 B2 B3] [B0 B1 B2 B3] [B0 B1 B2 B3]
Output: [B0 B0 B0] [B1 B1 B1] [B2 B2 B2] [B3 B3 B3]
```

### Delta Encode Triangle Indices

```cpp
void deltaEncode(int32_t* data, size_t count) {
    // Process backward to avoid overwriting values we still need
    for (size_t i = count - 1; i > 0; i--) {
        data[i] = data[i] - data[i - 1];
    }
    // data[0] stays as-is (absolute value)
}
```

### Pack Colors

```cpp
void packColors(const std::vector<std_msgs::msg::ColorRGBA>& colors,
                uint8_t* dst) {
    for (size_t i = 0; i < colors.size(); i++) {
        dst[i * 4 + 0] = static_cast<uint8_t>(
            std::clamp(colors[i].r * 255.0f, 0.0f, 255.0f));
        dst[i * 4 + 1] = static_cast<uint8_t>(
            std::clamp(colors[i].g * 255.0f, 0.0f, 255.0f));
        dst[i * 4 + 2] = static_cast<uint8_t>(
            std::clamp(colors[i].b * 255.0f, 0.0f, 255.0f));
        dst[i * 4 + 3] = static_cast<uint8_t>(
            std::clamp(colors[i].a * 255.0f, 0.0f, 255.0f));
    }
}
```

---

## 5. Full Compressor Node

```cpp
#include <rclcpp/rclcpp.hpp>
#include <zstd.h>

#include "nvblox_msgs/msg/mesh.hpp"
#include "nvblox_msgs/msg/voxel_block_layer.hpp"
#include "compressed_nvblox_msgs/msg/compressed_nvblox_mesh.hpp"
#include "compressed_nvblox_msgs/msg/compressed_nvblox_voxel_block_layer.hpp"

class NvbloxCompressor : public rclcpp::Node {
public:
    NvbloxCompressor(const rclcpp::NodeOptions& options)
        : Node("nvblox_compressor", options) {

        declare_parameter("mesh_topics", std::vector<std::string>{});
        declare_parameter("voxel_topics", std::vector<std::string>{});
        declare_parameter("zstd_level", 1);

        zstd_level_ = get_parameter("zstd_level").as_int();

        for (const auto& topic : get_parameter("mesh_topics").as_string_array()) {
            mesh_pubs_[topic] = create_publisher<
                compressed_nvblox_msgs::msg::CompressedNvbloxMesh>(
                topic + "/compressed", rclcpp::SensorDataQoS());

            mesh_subs_.push_back(
                create_subscription<nvblox_msgs::msg::Mesh>(
                    topic, rclcpp::SensorDataQoS(),
                    [this, topic](nvblox_msgs::msg::Mesh::ConstSharedPtr msg) {
                        compressMesh(topic, msg);
                    }));
        }

        for (const auto& topic : get_parameter("voxel_topics").as_string_array()) {
            voxel_pubs_[topic] = create_publisher<
                compressed_nvblox_msgs::msg::CompressedNvbloxVoxelBlockLayer>(
                topic + "/compressed", rclcpp::SensorDataQoS());

            voxel_subs_.push_back(
                create_subscription<nvblox_msgs::msg::VoxelBlockLayer>(
                    topic, rclcpp::SensorDataQoS(),
                    [this, topic](nvblox_msgs::msg::VoxelBlockLayer::ConstSharedPtr msg) {
                        compressVoxel(topic, msg);
                    }));
        }

        RCLCPP_INFO(get_logger(), "NvbloxCompressor ready: %zu mesh, %zu voxel topics",
                     mesh_subs_.size(), voxel_subs_.size());
    }

private:
    int zstd_level_;

    std::vector<rclcpp::Subscription<nvblox_msgs::msg::Mesh>::SharedPtr> mesh_subs_;
    std::vector<rclcpp::Subscription<nvblox_msgs::msg::VoxelBlockLayer>::SharedPtr> voxel_subs_;
    std::map<std::string, rclcpp::Publisher<
        compressed_nvblox_msgs::msg::CompressedNvbloxMesh>::SharedPtr> mesh_pubs_;
    std::map<std::string, rclcpp::Publisher<
        compressed_nvblox_msgs::msg::CompressedNvbloxVoxelBlockLayer>::SharedPtr> voxel_pubs_;

    // ---------------------------------------------------------------
    // Mesh compression
    // ---------------------------------------------------------------
    void compressMesh(const std::string& topic,
                      nvblox_msgs::msg::Mesh::ConstSharedPtr msg) {
        auto out = std::make_unique<
            compressed_nvblox_msgs::msg::CompressedNvbloxMesh>();

        out->header = msg->header;
        out->block_size_m = msg->block_size_m;
        out->block_indices = msg->block_indices;
        out->clear = msg->clear;
        out->format = "qzstd_v1";
        out->num_blocks = msg->blocks.size();

        std::vector<uint8_t> packed;

        for (size_t b = 0; b < msg->blocks.size(); b++) {
            const auto& block = msg->blocks[b];
            size_t block_start = packed.size();

            uint32_t vc = block.vertices.size();
            uint32_t tc = block.triangles.size();
            bool has_normals = (block.normals.size() == vc) && (vc > 0);
            bool has_colors  = (block.colors.size() == vc) && (vc > 0);

            out->block_vertex_counts.push_back(vc);
            out->block_triangle_counts.push_back(tc);
            out->block_has_normals.push_back(has_normals ? 1 : 0);
            out->block_has_colors.push_back(has_colors ? 1 : 0);

            // Section 0: byte-shuffled positions
            if (vc > 0) {
                size_t nf = vc * 3;
                std::vector<float> flat(nf);
                for (size_t i = 0; i < vc; i++) {
                    flat[i*3]     = block.vertices[i].x;
                    flat[i*3 + 1] = block.vertices[i].y;
                    flat[i*3 + 2] = block.vertices[i].z;
                }
                size_t byte_len = nf * 4;
                size_t off = packed.size();
                packed.resize(off + byte_len);
                byteShuffle(reinterpret_cast<const uint8_t*>(flat.data()),
                            packed.data() + off, nf, 4);
            }

            // Section 1: byte-shuffled normals
            if (has_normals) {
                size_t nf = vc * 3;
                std::vector<float> flat(nf);
                for (size_t i = 0; i < vc; i++) {
                    flat[i*3]     = block.normals[i].x;
                    flat[i*3 + 1] = block.normals[i].y;
                    flat[i*3 + 2] = block.normals[i].z;
                }
                size_t byte_len = nf * 4;
                size_t off = packed.size();
                packed.resize(off + byte_len);
                byteShuffle(reinterpret_cast<const uint8_t*>(flat.data()),
                            packed.data() + off, nf, 4);
            }

            // Section 2: packed uint8 RGBA colors
            if (has_colors) {
                size_t off = packed.size();
                packed.resize(off + vc * 4);
                packColors(block.colors, packed.data() + off);
            }

            // Section 3: delta-encoded triangle indices
            if (tc > 0) {
                std::vector<int32_t> deltas(block.triangles.begin(),
                                            block.triangles.end());
                deltaEncode(deltas.data(), deltas.size());
                size_t off = packed.size();
                packed.resize(off + tc * 4);
                std::memcpy(packed.data() + off, deltas.data(), tc * 4);
            }

            out->block_byte_sizes.push_back(
                static_cast<uint32_t>(packed.size() - block_start));
        }

        // ZSTD compress
        if (!packed.empty()) {
            size_t bound = ZSTD_compressBound(packed.size());
            out->compressed_data.resize(bound);
            size_t actual = ZSTD_compress(
                out->compressed_data.data(), bound,
                packed.data(), packed.size(),
                zstd_level_);
            if (ZSTD_isError(actual)) {
                RCLCPP_ERROR(get_logger(), "ZSTD compress failed: %s",
                             ZSTD_getErrorName(actual));
                return;
            }
            out->compressed_data.resize(actual);
        }

        mesh_pubs_[topic]->publish(std::move(out));
    }

    // ---------------------------------------------------------------
    // Voxel compression
    // ---------------------------------------------------------------
    void compressVoxel(const std::string& topic,
                       nvblox_msgs::msg::VoxelBlockLayer::ConstSharedPtr msg) {
        auto out = std::make_unique<
            compressed_nvblox_msgs::msg::CompressedNvbloxVoxelBlockLayer>();

        out->header = msg->header;
        out->block_size_m = msg->block_size_m;
        out->voxel_size_m = msg->voxel_size_m;
        out->layer_type = msg->layer_type;
        out->block_indices = msg->block_indices;
        out->clear = msg->clear;
        out->format = "qzstd_v1";
        out->num_blocks = msg->blocks.size();

        std::vector<uint8_t> packed;

        for (size_t b = 0; b < msg->blocks.size(); b++) {
            const auto& block = msg->blocks[b];
            size_t block_start = packed.size();

            uint32_t vc = block.centers.size();
            bool has_colors = (block.colors.size() == vc) && (vc > 0);

            out->block_voxel_counts.push_back(vc);
            out->block_has_colors.push_back(has_colors ? 1 : 0);

            // Section 0: byte-shuffled centers
            if (vc > 0) {
                size_t nf = vc * 3;
                std::vector<float> flat(nf);
                for (size_t i = 0; i < vc; i++) {
                    flat[i*3]     = block.centers[i].x;
                    flat[i*3 + 1] = block.centers[i].y;
                    flat[i*3 + 2] = block.centers[i].z;
                }
                size_t byte_len = nf * 4;
                size_t off = packed.size();
                packed.resize(off + byte_len);
                byteShuffle(reinterpret_cast<const uint8_t*>(flat.data()),
                            packed.data() + off, nf, 4);
            }

            // Section 1: packed uint8 RGBA colors
            if (has_colors) {
                size_t off = packed.size();
                packed.resize(off + vc * 4);
                packColors(block.colors, packed.data() + off);
            }

            out->block_byte_sizes.push_back(
                static_cast<uint32_t>(packed.size() - block_start));
        }

        // ZSTD compress
        if (!packed.empty()) {
            size_t bound = ZSTD_compressBound(packed.size());
            out->compressed_data.resize(bound);
            size_t actual = ZSTD_compress(
                out->compressed_data.data(), bound,
                packed.data(), packed.size(),
                zstd_level_);
            if (ZSTD_isError(actual)) {
                RCLCPP_ERROR(get_logger(), "ZSTD compress failed: %s",
                             ZSTD_getErrorName(actual));
                return;
            }
            out->compressed_data.resize(actual);
        }

        voxel_pubs_[topic]->publish(std::move(out));
    }

    // ---------------------------------------------------------------
    // Encoding helpers
    // ---------------------------------------------------------------
    static void byteShuffle(const uint8_t* src, uint8_t* dst,
                            size_t numElements, size_t elementSize) {
        for (size_t i = 0; i < numElements; i++) {
            for (size_t b = 0; b < elementSize; b++) {
                dst[b * numElements + i] = src[i * elementSize + b];
            }
        }
    }

    static void deltaEncode(int32_t* data, size_t count) {
        if (count <= 1) return;
        for (size_t i = count - 1; i > 0; i--) {
            data[i] = data[i] - data[i - 1];
        }
    }

    static void packColors(const std::vector<std_msgs::msg::ColorRGBA>& colors,
                           uint8_t* dst) {
        for (size_t i = 0; i < colors.size(); i++) {
            dst[i * 4 + 0] = static_cast<uint8_t>(
                std::clamp(colors[i].r * 255.0f, 0.0f, 255.0f));
            dst[i * 4 + 1] = static_cast<uint8_t>(
                std::clamp(colors[i].g * 255.0f, 0.0f, 255.0f));
            dst[i * 4 + 2] = static_cast<uint8_t>(
                std::clamp(colors[i].b * 255.0f, 0.0f, 255.0f));
            dst[i * 4 + 3] = static_cast<uint8_t>(
                std::clamp(colors[i].a * 255.0f, 0.0f, 255.0f));
        }
    }
};

// Register as composable node
#include "rclcpp_components/register_node_macro.hpp"
RCLCPP_COMPONENTS_REGISTER_NODE(NvbloxCompressor)
```

---

## 6. CMakeLists.txt

```cmake
cmake_minimum_required(VERSION 3.8)
project(compressed_nvblox_msgs)

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(rclcpp_components REQUIRED)
find_package(std_msgs REQUIRED)
find_package(nvblox_msgs REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(PkgConfig REQUIRED)
pkg_check_modules(ZSTD REQUIRED libzstd)

# Generate messages
rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/CompressedNvbloxMesh.msg"
  "msg/CompressedNvbloxVoxelBlockLayer.msg"
  DEPENDENCIES std_msgs nvblox_msgs
)

# Compressor node library
add_library(nvblox_compressor_component SHARED
  src/nvblox_compressor_node.cpp
)
target_include_directories(nvblox_compressor_component PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  ${ZSTD_INCLUDE_DIRS}
)
target_link_libraries(nvblox_compressor_component ${ZSTD_LIBRARIES})
ament_target_dependencies(nvblox_compressor_component
  rclcpp rclcpp_components std_msgs nvblox_msgs
)

# Link against generated message types
rosidl_get_typesupport_target(cpp_typesupport_target
  ${PROJECT_NAME} rosidl_typesupport_cpp)
target_link_libraries(nvblox_compressor_component "${cpp_typesupport_target}")

# Register composable node
rclcpp_components_register_node(nvblox_compressor_component
  PLUGIN "NvbloxCompressor"
  EXECUTABLE nvblox_compressor
)

install(TARGETS nvblox_compressor_component
  ARCHIVE DESTINATION lib
  LIBRARY DESTINATION lib
  RUNTIME DESTINATION lib/${PROJECT_NAME}
)

install(DIRECTORY launch/
  DESTINATION share/${PROJECT_NAME}/launch
)

ament_package()
```

---

## 7. Launch File

### launch/nvblox_compressor.launch.py

```python
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument('zstd_level', default_value='1',
                              description='ZSTD compression level (1=fastest)'),

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
                'zstd_level': LaunchConfiguration('zstd_level'),
            }],
            output='screen',
        ),
    ])
```

---

## 8. Build & Test

```bash
# Build
cd ~/ros2_ws
colcon build --packages-select compressed_nvblox_msgs

# Source
source install/setup.bash

# Launch
ros2 launch compressed_nvblox_msgs nvblox_compressor.launch.py

# Verify topics exist
ros2 topic list | grep compressed
# Expected:
#   /global_mapper/nvblox_node/mesh/compressed
#   /global_mapper/nvblox_node/semantic_layer/compressed
#   /local_mapper/nvblox_node/mesh/compressed
#   /local_mapper/nvblox_node/semantic_layer/compressed

# Compare bandwidth
ros2 topic bw /global_mapper/nvblox_node/mesh
ros2 topic bw /global_mapper/nvblox_node/mesh/compressed
# Expected: 3-4x reduction

# Verify message content
ros2 topic echo /global_mapper/nvblox_node/mesh/compressed --once \
  --field format
# Expected: "qzstd_v1"
```

---

## 9. Integration with foxglove_bridge

No bridge changes needed. foxglove_bridge auto-discovers and forwards any ROS2 topic.

If using `topic_whitelist`, ensure compressed topics are included:
```yaml
topic_whitelist: ['.*']  # Already matches everything
```

The bridge serializes the custom `CompressedNvbloxMesh` message using CDR encoding
and sends the `.msg` schema definition to the WebSocket client. Lichtblick's
built-in converter auto-detects the schema and decompresses before rendering.

---

## 10. Performance Expectations

| Metric | Value |
|--------|-------|
| Encode time per 100 blocks | ~5-7 ms |
| ZSTD level 1 throughput | ~1 GB/s |
| Compression ratio (mesh) | 3-4x |
| Compression ratio (voxel) | 2.5-3x |
| CPU overhead at 5 Hz | ~7% single core |
| Quality loss | Zero (positions/normals lossless, colors uint8 round-trip) |

---

## 11. Verification Checklist

- [ ] `compressed_nvblox_msgs` package builds on Jetson
- [ ] `.msg` files generate correctly (`ros2 interface show`)
- [ ] Compressor node starts without errors
- [ ] Compressed topics appear in `ros2 topic list`
- [ ] `format` field is `"qzstd_v1"` in echoed messages
- [ ] Bandwidth reduction measured with `ros2 topic bw`
- [ ] Lichtblick receives and renders compressed topics correctly
- [ ] No visual difference between compressed and uncompressed rendering
- [ ] `clear` flag propagates correctly (clear all blocks)
- [ ] Both global_mapper and local_mapper topics work
