#!/usr/bin/env node
// Generates a synthetic .mcap file with compressed nvblox mesh and voxel messages
// for testing the Lichtblick decompressor without a robot.
//
// Usage: node tools/generate-test-mcap.mjs [output.mcap]

import { McapWriter } from "@mcap/core";
import { MessageWriter } from "@lichtblick/rosmsg2-serialization";
import { createWriteStream } from "fs";
import { Buffer } from "buffer";
import zlib from "zlib";

const outputPath = process.argv[2] ?? "test-nvblox-compressed.mcap";

// ── Helpers: qzstd_v1 encoder (mirrors robot-side C++) ──────────────────

function byteShuffle(src, numElements, elementSize) {
  const dst = new Uint8Array(numElements * elementSize);
  for (let i = 0; i < numElements; i++) {
    for (let b = 0; b < elementSize; b++) {
      dst[b * numElements + i] = src[i * elementSize + b];
    }
  }
  return dst;
}

function deltaEncode(data) {
  for (let i = data.length - 1; i > 0; i--) {
    data[i] = data[i] - data[i - 1];
  }
}

function packPositions(points) {
  const numFloats = points.length * 3;
  const flat = new Float32Array(numFloats);
  for (let i = 0; i < points.length; i++) {
    flat[i * 3] = points[i].x;
    flat[i * 3 + 1] = points[i].y;
    flat[i * 3 + 2] = points[i].z;
  }
  return byteShuffle(new Uint8Array(flat.buffer), numFloats, 4);
}

function packColors(colors) {
  const buf = new Uint8Array(colors.length * 4);
  for (let i = 0; i < colors.length; i++) {
    buf[i * 4] = Math.round(colors[i].r * 255);
    buf[i * 4 + 1] = Math.round(colors[i].g * 255);
    buf[i * 4 + 2] = Math.round(colors[i].b * 255);
    buf[i * 4 + 3] = Math.round(colors[i].a * 255);
  }
  return buf;
}

function packTriangles(triangles) {
  const indices = new Int32Array(triangles);
  deltaEncode(indices);
  return new Uint8Array(indices.buffer);
}

function zstdCompress(data) {
  return zlib.zstdCompressSync(Buffer.from(data), { params: { 100: 1 } });
}

// ── Synthetic geometry ──────────────────────────────────────────────────

function makeCubeBlock(cx, cy, cz, size, color) {
  const s = size / 2;
  const vertices = [
    // Front face
    { x: cx - s, y: cy - s, z: cz + s },
    { x: cx + s, y: cy - s, z: cz + s },
    { x: cx + s, y: cy + s, z: cz + s },
    { x: cx - s, y: cy + s, z: cz + s },
    // Back face
    { x: cx - s, y: cy - s, z: cz - s },
    { x: cx + s, y: cy - s, z: cz - s },
    { x: cx + s, y: cy + s, z: cz - s },
    { x: cx - s, y: cy + s, z: cz - s },
  ];
  const normals = [
    { x: -0.577, y: -0.577, z: 0.577 },
    { x: 0.577, y: -0.577, z: 0.577 },
    { x: 0.577, y: 0.577, z: 0.577 },
    { x: -0.577, y: 0.577, z: 0.577 },
    { x: -0.577, y: -0.577, z: -0.577 },
    { x: 0.577, y: -0.577, z: -0.577 },
    { x: 0.577, y: 0.577, z: -0.577 },
    { x: -0.577, y: 0.577, z: -0.577 },
  ];
  const colors = vertices.map(() => color);
  const triangles = [
    0, 1, 2, 0, 2, 3, // front
    5, 4, 7, 5, 7, 6, // back
    4, 0, 3, 4, 3, 7, // left
    1, 5, 6, 1, 6, 2, // right
    3, 2, 6, 3, 6, 7, // top
    4, 5, 1, 4, 1, 0, // bottom
  ];
  return { vertices, normals, colors, triangles };
}

function makeVoxelBlock(cx, cy, cz, gridSize, voxelSize, color) {
  const centers = [];
  const colors = [];
  const half = (gridSize * voxelSize) / 2;
  for (let ix = 0; ix < gridSize; ix++) {
    for (let iy = 0; iy < gridSize; iy++) {
      for (let iz = 0; iz < gridSize; iz++) {
        centers.push({
          x: cx - half + (ix + 0.5) * voxelSize,
          y: cy - half + (iy + 0.5) * voxelSize,
          z: cz - half + (iz + 0.5) * voxelSize,
        });
        colors.push({
          r: color.r * (0.8 + 0.2 * (ix / gridSize)),
          g: color.g * (0.8 + 0.2 * (iy / gridSize)),
          b: color.b * (0.8 + 0.2 * (iz / gridSize)),
          a: color.a,
        });
      }
    }
  }
  return { centers, colors };
}

// ── Compress mesh blocks into qzstd_v1 format ──────────────────────────

function compressMeshBlocks(blocks) {
  const metadata = {
    block_vertex_counts: [],
    block_triangle_counts: [],
    block_has_normals: [],
    block_has_colors: [],
    block_byte_sizes: [],
  };
  const chunks = [];

  for (const block of blocks) {
    const parts = [];
    const vc = block.vertices.length;
    const tc = block.triangles.length;

    metadata.block_vertex_counts.push(vc);
    metadata.block_triangle_counts.push(tc);
    metadata.block_has_normals.push(block.normals.length === vc ? 1 : 0);
    metadata.block_has_colors.push(block.colors.length === vc ? 1 : 0);

    parts.push(packPositions(block.vertices));
    if (block.normals.length === vc) {
      parts.push(packPositions(block.normals));
    }
    if (block.colors.length === vc) {
      parts.push(packColors(block.colors));
    }
    if (tc > 0) {
      parts.push(packTriangles(block.triangles));
    }

    const blockBytes = Buffer.concat(parts);
    metadata.block_byte_sizes.push(blockBytes.length);
    chunks.push(blockBytes);
  }

  const packed = Buffer.concat(chunks);
  const compressed = zstdCompress(packed);
  return { metadata, compressed_data: Array.from(new Uint8Array(compressed)) };
}

function compressVoxelBlocks(blocks) {
  const metadata = {
    block_voxel_counts: [],
    block_has_colors: [],
    block_byte_sizes: [],
  };
  const chunks = [];

  for (const block of blocks) {
    const parts = [];
    const vc = block.centers.length;

    metadata.block_voxel_counts.push(vc);
    metadata.block_has_colors.push(block.colors.length === vc ? 1 : 0);

    parts.push(packPositions(block.centers));
    if (block.colors.length === vc) {
      parts.push(packColors(block.colors));
    }

    const blockBytes = Buffer.concat(parts);
    metadata.block_byte_sizes.push(blockBytes.length);
    chunks.push(blockBytes);
  }

  const packed = Buffer.concat(chunks);
  const compressed = zstdCompress(packed);
  return { metadata, compressed_data: Array.from(new Uint8Array(compressed)) };
}

// ── ROS2 message definitions for CDR serialization ──────────────────────

const compressedMeshDefs = [
  {
    name: "compressed_nvblox_msgs/msg/CompressedNvbloxMesh",
    definitions: [
      { name: "header", type: "std_msgs/msg/Header", isComplex: true, isArray: false },
      { name: "block_size_m", type: "float32", isComplex: false, isArray: false },
      { name: "block_indices", type: "nvblox_msgs/msg/Index3D", isComplex: true, isArray: true },
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
  {
    name: "std_msgs/msg/Header",
    definitions: [
      { name: "stamp", type: "builtin_interfaces/msg/Time", isComplex: true, isArray: false },
      { name: "frame_id", type: "string", isComplex: false, isArray: false },
    ],
  },
  {
    name: "builtin_interfaces/msg/Time",
    definitions: [
      { name: "sec", type: "int32", isComplex: false, isArray: false },
      { name: "nanosec", type: "uint32", isComplex: false, isArray: false },
    ],
  },
  {
    name: "nvblox_msgs/msg/Index3D",
    definitions: [
      { name: "x", type: "int32", isComplex: false, isArray: false },
      { name: "y", type: "int32", isComplex: false, isArray: false },
      { name: "z", type: "int32", isComplex: false, isArray: false },
    ],
  },
];

const compressedVoxelDefs = [
  {
    name: "compressed_nvblox_msgs/msg/CompressedNvbloxVoxelBlockLayer",
    definitions: [
      { name: "header", type: "std_msgs/msg/Header", isComplex: true, isArray: false },
      { name: "block_size_m", type: "float32", isComplex: false, isArray: false },
      { name: "voxel_size_m", type: "float32", isComplex: false, isArray: false },
      { name: "layer_type", type: "int32", isComplex: false, isArray: false },
      { name: "block_indices", type: "nvblox_msgs/msg/Index3D", isComplex: true, isArray: true },
      { name: "clear", type: "bool", isComplex: false, isArray: false },
      { name: "format", type: "string", isComplex: false, isArray: false },
      { name: "num_blocks", type: "uint32", isComplex: false, isArray: false },
      { name: "block_voxel_counts", type: "uint32", isComplex: false, isArray: true },
      { name: "block_has_colors", type: "uint32", isComplex: false, isArray: true },
      { name: "block_byte_sizes", type: "uint32", isComplex: false, isArray: true },
      { name: "compressed_data", type: "uint8", isComplex: false, isArray: true },
    ],
  },
  {
    name: "std_msgs/msg/Header",
    definitions: [
      { name: "stamp", type: "builtin_interfaces/msg/Time", isComplex: true, isArray: false },
      { name: "frame_id", type: "string", isComplex: false, isArray: false },
    ],
  },
  {
    name: "builtin_interfaces/msg/Time",
    definitions: [
      { name: "sec", type: "int32", isComplex: false, isArray: false },
      { name: "nanosec", type: "uint32", isComplex: false, isArray: false },
    ],
  },
  {
    name: "nvblox_msgs/msg/Index3D",
    definitions: [
      { name: "x", type: "int32", isComplex: false, isArray: false },
      { name: "y", type: "int32", isComplex: false, isArray: false },
      { name: "z", type: "int32", isComplex: false, isArray: false },
    ],
  },
];

// ── TF message definitions for CDR serialization ────────────────────────

const tfMessageDefs = [
  {
    name: "tf2_msgs/msg/TFMessage",
    definitions: [
      { name: "transforms", type: "geometry_msgs/msg/TransformStamped", isComplex: true, isArray: true },
    ],
  },
  {
    name: "geometry_msgs/msg/TransformStamped",
    definitions: [
      { name: "header", type: "std_msgs/msg/Header", isComplex: true, isArray: false },
      { name: "child_frame_id", type: "string", isComplex: false, isArray: false },
      { name: "transform", type: "geometry_msgs/msg/Transform", isComplex: true, isArray: false },
    ],
  },
  {
    name: "std_msgs/msg/Header",
    definitions: [
      { name: "stamp", type: "builtin_interfaces/msg/Time", isComplex: true, isArray: false },
      { name: "frame_id", type: "string", isComplex: false, isArray: false },
    ],
  },
  {
    name: "builtin_interfaces/msg/Time",
    definitions: [
      { name: "sec", type: "int32", isComplex: false, isArray: false },
      { name: "nanosec", type: "uint32", isComplex: false, isArray: false },
    ],
  },
  {
    name: "geometry_msgs/msg/Transform",
    definitions: [
      { name: "translation", type: "geometry_msgs/msg/Vector3", isComplex: true, isArray: false },
      { name: "rotation", type: "geometry_msgs/msg/Quaternion", isComplex: true, isArray: false },
    ],
  },
  {
    name: "geometry_msgs/msg/Vector3",
    definitions: [
      { name: "x", type: "float64", isComplex: false, isArray: false },
      { name: "y", type: "float64", isComplex: false, isArray: false },
      { name: "z", type: "float64", isComplex: false, isArray: false },
    ],
  },
  {
    name: "geometry_msgs/msg/Quaternion",
    definitions: [
      { name: "x", type: "float64", isComplex: false, isArray: false },
      { name: "y", type: "float64", isComplex: false, isArray: false },
      { name: "z", type: "float64", isComplex: false, isArray: false },
      { name: "w", type: "float64", isComplex: false, isArray: false },
    ],
  },
];

const tfSchemaText = `\
geometry_msgs/TransformStamped[] transforms

================================================================================
MSG: geometry_msgs/TransformStamped
std_msgs/Header header
string child_frame_id
geometry_msgs/Transform transform

================================================================================
MSG: std_msgs/Header
builtin_interfaces/Time stamp
string frame_id

================================================================================
MSG: builtin_interfaces/Time
int32 sec
uint32 nanosec

================================================================================
MSG: geometry_msgs/Transform
geometry_msgs/Vector3 translation
geometry_msgs/Quaternion rotation

================================================================================
MSG: geometry_msgs/Vector3
float64 x
float64 y
float64 z

================================================================================
MSG: geometry_msgs/Quaternion
float64 x
float64 y
float64 z
float64 w
`;

// ── ROS2 .msg text for schema data ──────────────────────────────────────

const compressedMeshSchemaText = `\
std_msgs/Header header
float32 block_size_m
nvblox_msgs/Index3D[] block_indices
bool clear
string format
uint32 num_blocks
uint32[] block_vertex_counts
uint32[] block_triangle_counts
uint32[] block_has_normals
uint32[] block_has_colors
uint32[] block_byte_sizes
uint8[] compressed_data

================================================================================
MSG: std_msgs/Header
builtin_interfaces/Time stamp
string frame_id

================================================================================
MSG: builtin_interfaces/Time
int32 sec
uint32 nanosec

================================================================================
MSG: nvblox_msgs/Index3D
int32 x
int32 y
int32 z
`;

const compressedVoxelSchemaText = `\
std_msgs/Header header
float32 block_size_m
float32 voxel_size_m
int32 layer_type
nvblox_msgs/Index3D[] block_indices
bool clear
string format
uint32 num_blocks
uint32[] block_voxel_counts
uint32[] block_has_colors
uint32[] block_byte_sizes
uint8[] compressed_data

================================================================================
MSG: std_msgs/Header
builtin_interfaces/Time stamp
string frame_id

================================================================================
MSG: builtin_interfaces/Time
int32 sec
uint32 nanosec

================================================================================
MSG: nvblox_msgs/Index3D
int32 x
int32 y
int32 z
`;

// ── IWritable adapter for Node.js WriteStream ───────────────────────────

class FileWritable {
  #stream;
  #position = 0n;

  constructor(stream) {
    this.#stream = stream;
  }

  position() {
    return this.#position;
  }

  async write(data) {
    await new Promise((resolve, reject) => {
      this.#stream.write(data, (err) => (err ? reject(err) : resolve()));
    });
    this.#position += BigInt(data.byteLength);
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const stream = createWriteStream(outputPath);
  const writable = new FileWritable(stream);

  const writer = new McapWriter({ writable, useChunks: true, useStatistics: true });
  await writer.start({ profile: "ros2", library: "nvblox-test-gen" });

  const meshWriter = new MessageWriter(compressedMeshDefs);
  const voxelWriter = new MessageWriter(compressedVoxelDefs);
  const tfWriter = new MessageWriter(tfMessageDefs);

  const tfSchemaId = await writer.registerSchema({
    name: "tf2_msgs/msg/TFMessage",
    encoding: "ros2msg",
    data: new TextEncoder().encode(tfSchemaText),
  });

  const meshSchemaId = await writer.registerSchema({
    name: "compressed_nvblox_msgs/msg/CompressedNvbloxMesh",
    encoding: "ros2msg",
    data: new TextEncoder().encode(compressedMeshSchemaText),
  });

  const voxelSchemaId = await writer.registerSchema({
    name: "compressed_nvblox_msgs/msg/CompressedNvbloxVoxelBlockLayer",
    encoding: "ros2msg",
    data: new TextEncoder().encode(compressedVoxelSchemaText),
  });

  const tfStaticChannelId = await writer.registerChannel({
    schemaId: tfSchemaId,
    topic: "/tf_static",
    messageEncoding: "cdr",
    metadata: new Map(),
  });

  const tfChannelId = await writer.registerChannel({
    schemaId: tfSchemaId,
    topic: "/tf",
    messageEncoding: "cdr",
    metadata: new Map(),
  });

  const meshChannelId = await writer.registerChannel({
    schemaId: meshSchemaId,
    topic: "/global_mapper/nvblox_node/mesh/compressed",
    messageEncoding: "cdr",
    metadata: new Map(),
  });

  const voxelChannelId = await writer.registerChannel({
    schemaId: voxelSchemaId,
    topic: "/global_mapper/nvblox_node/semantic_layer/compressed",
    messageEncoding: "cdr",
    metadata: new Map(),
  });

  // Write static TF: odom frame (identity)
  const startTimeNs = 1700000000000000000n;
  const startSec = Number(startTimeNs / 1000000000n);
  const startNanosec = Number(startTimeNs % 1000000000n);

  const tfStaticMsg = {
    transforms: [
      {
        header: { stamp: { sec: startSec, nanosec: startNanosec }, frame_id: "map" },
        child_frame_id: "odom",
        transform: {
          translation: { x: 0.0, y: 0.0, z: 0.0 },
          rotation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 },
        },
      },
    ],
  };

  const tfStaticData = new Uint8Array(tfWriter.writeMessage(tfStaticMsg));
  await writer.addMessage({
    channelId: tfStaticChannelId,
    sequence: 0,
    logTime: startTimeNs,
    publishTime: startTimeNs,
    data: tfStaticData,
  });

  // Generate 10 frames of mesh data (growing scene)
  const numFrames = 10;
  const frameIntervalNs = 100_000_000n; // 100ms = 10Hz

  for (let f = 0; f < numFrames; f++) {
    const timeNs = 1700000000000000000n + BigInt(f) * frameIntervalNs;
    const sec = Number(timeNs / 1000000000n);
    const nanosec = Number(timeNs % 1000000000n);

    // TF: publish odom frame each tick
    const tfMsg = {
      transforms: [
        {
          header: { stamp: { sec, nanosec }, frame_id: "map" },
          child_frame_id: "odom",
          transform: {
            translation: { x: 0.0, y: 0.0, z: 0.0 },
            rotation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 },
          },
        },
      ],
    };
    const tfData = new Uint8Array(tfWriter.writeMessage(tfMsg));
    await writer.addMessage({
      channelId: tfChannelId,
      sequence: f,
      logTime: timeNs,
      publishTime: timeNs,
      data: tfData,
    });

    // Build mesh blocks — cubes at grid positions
    const meshBlocks = [];
    const meshIndices = [];
    const numBlocks = 3 + f; // growing scene
    for (let i = 0; i < numBlocks; i++) {
      const bx = (i % 4) * 0.2;
      const by = Math.floor(i / 4) * 0.2;
      const bz = 0;
      const hue = (i * 60 + f * 10) % 360;
      const rgb = hslToRgb(hue / 360, 0.8, 0.6);
      meshBlocks.push(makeCubeBlock(bx, by, bz, 0.15, { ...rgb, a: 1.0 }));
      meshIndices.push({ x: i % 4, y: Math.floor(i / 4), z: 0 });
    }

    const { metadata: meshMeta, compressed_data: meshCompressed } =
      compressMeshBlocks(meshBlocks);

    const meshMsg = {
      header: { stamp: { sec, nanosec }, frame_id: "odom" },
      block_size_m: 0.2,
      block_indices: meshIndices,
      clear: f === 0,
      format: "qzstd_v1",
      num_blocks: numBlocks,
      ...meshMeta,
      compressed_data: meshCompressed,
    };

    const meshData = new Uint8Array(meshWriter.writeMessage(meshMsg));
    await writer.addMessage({
      channelId: meshChannelId,
      sequence: f,
      logTime: timeNs,
      publishTime: timeNs,
      data: meshData,
    });

    // Build voxel blocks — 4x4x4 voxel grids
    const voxelBlocks = [];
    const voxelIndices = [];
    const numVoxBlocks = 2;
    for (let i = 0; i < numVoxBlocks; i++) {
      const hue = (i * 120 + f * 15) % 360;
      const rgb = hslToRgb(hue / 360, 0.7, 0.5);
      voxelBlocks.push(
        makeVoxelBlock(i * 0.4, 0, 0.5, 4, 0.05, { ...rgb, a: 0.8 }),
      );
      voxelIndices.push({ x: i, y: 0, z: 2 });
    }

    const { metadata: voxMeta, compressed_data: voxCompressed } =
      compressVoxelBlocks(voxelBlocks);

    const voxelMsg = {
      header: { stamp: { sec, nanosec }, frame_id: "odom" },
      block_size_m: 0.2,
      voxel_size_m: 0.05,
      layer_type: 1,
      block_indices: voxelIndices,
      clear: f === 0,
      format: "qzstd_v1",
      num_blocks: numVoxBlocks,
      ...voxMeta,
      compressed_data: voxCompressed,
    };

    const voxelData = new Uint8Array(voxelWriter.writeMessage(voxelMsg));
    await writer.addMessage({
      channelId: voxelChannelId,
      sequence: f,
      logTime: timeNs,
      publishTime: timeNs,
      data: voxelData,
    });
  }

  await writer.end();
  await new Promise((resolve) => stream.end(resolve));

  console.log(`Wrote ${outputPath} (${numFrames} frames, mesh + voxel channels)`);
  console.log("Open in Lichtblick to test decompression pipeline.");
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r, g, b };
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
