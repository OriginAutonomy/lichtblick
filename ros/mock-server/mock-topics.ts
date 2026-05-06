// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Mock Foxglove WebSocket server publishing realistic ROS2 topics
// for local testing of nvblox, depth images, semantic images, paths, etc.
//
// Usage: npx ts-node ros/mock-server/mock-topics.ts

import { FoxgloveServer } from "@foxglove/ws-protocol";
import { WebSocketServer } from "ws";

const PORT = 8765;

function getTimestamp() {
  const now = Date.now();
  return { sec: Math.floor(now / 1000), nsec: (now % 1000) * 1e6 };
}

function makeHeader(frameId: string) {
  return { stamp: getTimestamp(), frame_id: frameId };
}

// --- Image helpers ---

function makeDepthImage(width: number, height: number): string {
  const floats = new Float32Array(width * height);
  const t = Date.now() / 2000;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      floats[y * width + x] = 0.5 + 4.5 * ((Math.sin(x / 8 + t) + Math.cos(y / 8 + t) + 2) / 4);
    }
  }
  return Buffer.from(floats.buffer).toString("base64");
}

function makeSemanticImage(width: number, height: number): string {
  const bytes = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const classId = (Math.floor(x / 8) + Math.floor(y / 8)) % 11;
      bytes[y * width + x] = classId * 23;
    }
  }
  return Buffer.from(bytes.buffer).toString("base64");
}

function makeRGBImage(width: number, height: number): string {
  const bytes = new Uint8Array(width * height * 3);
  const t = Date.now() / 3000;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      bytes[i] = Math.floor(((Math.sin(x / 10 + t) + 1) / 2) * 255);
      bytes[i + 1] = Math.floor(((Math.cos(y / 10 + t) + 1) / 2) * 255);
      bytes[i + 2] = Math.floor(((Math.sin((x + y) / 15 + t) + 1) / 2) * 255);
    }
  }
  return Buffer.from(bytes.buffer).toString("base64");
}

// --- Mesh helpers ---

function makeMeshBlocks() {
  const blocks = [];
  const blockIndices = [];

  for (let bx = 0; bx < 2; bx++) {
    for (let by = 0; by < 2; by++) {
      const ox = bx * 2;
      const oy = by * 2;
      const vertices = [
        { x: ox, y: oy, z: 0 },
        { x: ox + 1.5, y: oy, z: 0 },
        { x: ox + 0.75, y: oy + 1.5, z: 0.5 },
        { x: ox, y: oy, z: 1 },
        { x: ox + 1.5, y: oy, z: 1 },
        { x: ox + 0.75, y: oy + 1.5, z: 1.5 },
      ];
      const normals = vertices.map(() => ({ x: 0, y: 0, z: 1 }));
      const r = bx === 0 ? 0.8 : 0.2;
      const g = by === 0 ? 0.8 : 0.2;
      const colors = vertices.map(() => ({ r, g, b: 0.5, a: 1.0 }));
      const triangles = [0, 1, 2, 3, 4, 5];

      blockIndices.push({ x: bx, y: by, z: 0 });
      blocks.push({ vertices, normals, colors, triangles });
    }
  }
  return { blocks, blockIndices };
}

// --- Voxel helpers ---

function makeVoxelBlocks() {
  const blocks = [];
  const blockIndices = [];

  for (let bx = 0; bx < 3; bx++) {
    for (let by = 0; by < 3; by++) {
      const centers = [];
      const colors = [];
      for (let vx = 0; vx < 4; vx++) {
        for (let vy = 0; vy < 4; vy++) {
          for (let vz = 0; vz < 3; vz++) {
            centers.push({
              x: bx * 2 + vx * 0.5,
              y: by * 2 + vy * 0.5,
              z: vz * 0.5,
            });
            const occupied = Math.random() > 0.3;
            colors.push({
              r: occupied ? 0.2 + vz * 0.3 : 0,
              g: occupied ? 0.8 - vz * 0.2 : 0,
              b: occupied ? 0.3 : 0,
              a: occupied ? 1.0 : 0.0,
            });
          }
        }
      }
      blockIndices.push({ x: bx, y: by, z: 0 });
      blocks.push({ centers, colors });
    }
  }
  return { blocks, blockIndices };
}

// --- Distance map ---

function makeDistanceMapSlice(width: number, height: number): number[] {
  const data: number[] = [];
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) * 0.1;
      data.push(dist > 3 ? -1 : dist); // -1 = unknown
    }
  }
  return data;
}

// --- Nav path ---

function makeNavPath(numPoses: number) {
  const poses = [];
  const t = Date.now() / 5000;
  for (let i = 0; i < numPoses; i++) {
    const frac = i / numPoses;
    const angle = frac * Math.PI * 2;
    poses.push({
      header: makeHeader("map"),
      pose: {
        position: {
          x: Math.sin(angle + t) * 3,
          y: Math.sin(2 * angle + t) * 2,
          z: 0,
        },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    });
  }
  return poses;
}

// --- Laser scan ---

function makeLaserScan() {
  const numPoints = 360;
  const ranges: number[] = [];
  const intensities: number[] = [];
  const t = Date.now() / 2000;
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    const range = 3 + 2 * Math.sin(3 * angle + t);
    ranges.push(range);
    intensities.push(range / 5);
  }
  return {
    angle_min: 0,
    angle_max: Math.PI * 2,
    angle_increment: (Math.PI * 2) / numPoints,
    time_increment: 0,
    scan_time: 0.1,
    range_min: 0.1,
    range_max: 10,
    ranges,
    intensities,
  };
}

// --- Point cloud ---

function makePointCloud() {
  const numPoints = 200;
  const floatsPerPoint = 4; // x, y, z, intensity
  const floatData = new Float32Array(numPoints * floatsPerPoint);
  const t = Date.now() / 3000;

  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    const r = 2 + Math.sin(3 * angle + t);
    floatData[i * 4] = r * Math.cos(angle);
    floatData[i * 4 + 1] = r * Math.sin(angle);
    floatData[i * 4 + 2] = Math.sin(angle * 2 + t) * 0.5;
    floatData[i * 4 + 3] = (r - 1) / 4;
  }

  const buf = Buffer.from(floatData.buffer);
  return {
    height: 1,
    width: numPoints,
    fields: [
      { name: "x", offset: 0, datatype: 7, count: 1 },
      { name: "y", offset: 4, datatype: 7, count: 1 },
      { name: "z", offset: 8, datatype: 7, count: 1 },
      { name: "intensity", offset: 12, datatype: 7, count: 1 },
    ],
    is_bigendian: false,
    point_step: 16,
    row_step: numPoints * 16,
    data: buf.toString("base64"),
    is_dense: true,
  };
}

// --- Markers ---

function makeMarkerArray() {
  const t = Date.now() / 2000;
  return {
    markers: [
      {
        header: makeHeader("map"),
        ns: "test",
        id: 0,
        type: 1, // CUBE
        action: 0,
        pose: {
          position: { x: 2 + Math.sin(t), y: 0, z: 0.5 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
        scale: { x: 1, y: 1, z: 1 },
        color: { r: 1.0, g: 0.2, b: 0.2, a: 0.8 },
        lifetime: { sec: 0, nsec: 0 },
        frame_locked: false,
        points: [],
        colors: [],
        text: "",
        mesh_resource: "",
        mesh_use_embedded_materials: false,
      },
      {
        header: makeHeader("map"),
        ns: "test",
        id: 1,
        type: 2, // SPHERE
        action: 0,
        pose: {
          position: { x: -2, y: Math.cos(t), z: 1 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
        scale: { x: 0.5, y: 0.5, z: 0.5 },
        color: { r: 0.2, g: 0.2, b: 1.0, a: 0.8 },
        lifetime: { sec: 0, nsec: 0 },
        frame_locked: false,
        points: [],
        colors: [],
        text: "",
        mesh_resource: "",
        mesh_use_embedded_materials: false,
      },
    ],
  };
}

// ===== JSON Schemas =====

const schemas: Record<string, string> = {
  "tf2_msgs/msg/TFMessage": JSON.stringify({
    type: "object",
    properties: {
      transforms: {
        type: "array",
        items: {
          type: "object",
          properties: {
            header: {
              type: "object",
              properties: {
                stamp: { type: "object", properties: { sec: { type: "number" }, nsec: { type: "number" } } },
                frame_id: { type: "string" },
              },
            },
            child_frame_id: { type: "string" },
            transform: {
              type: "object",
              properties: {
                translation: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
                rotation: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" }, w: { type: "number" } } },
              },
            },
          },
        },
      },
    },
  }),

  "sensor_msgs/msg/Image": JSON.stringify({
    type: "object",
    properties: {
      header: { type: "object" },
      height: { type: "number" },
      width: { type: "number" },
      encoding: { type: "string" },
      is_bigendian: { type: "number" },
      step: { type: "number" },
      data: { type: "string", contentEncoding: "base64" },
    },
  }),

  "nav_msgs/msg/Path": JSON.stringify({
    type: "object",
    properties: {
      header: { type: "object", properties: {
        stamp: { type: "object", properties: { sec: { type: "number" }, nsec: { type: "number" } } },
        frame_id: { type: "string" },
      } },
      poses: { type: "array", items: { type: "object", properties: {
        header: { type: "object", properties: {
          stamp: { type: "object", properties: { sec: { type: "number" }, nsec: { type: "number" } } },
          frame_id: { type: "string" },
        } },
        pose: { type: "object", properties: {
          position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
          orientation: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" }, w: { type: "number" } } },
        } },
      } } },
    },
  }),

  "nvblox_msgs/msg/Mesh": JSON.stringify({
    type: "object",
    properties: {
      header: { type: "object" },
      block_size_m: { type: "number" },
      block_indices: { type: "array", items: { type: "object", properties: {
        x: { type: "number" }, y: { type: "number" }, z: { type: "number" },
      } } },
      blocks: { type: "array", items: { type: "object", properties: {
        vertices: { type: "array", items: { type: "object", properties: {
          x: { type: "number" }, y: { type: "number" }, z: { type: "number" },
        } } },
        normals: { type: "array", items: { type: "object", properties: {
          x: { type: "number" }, y: { type: "number" }, z: { type: "number" },
        } } },
        colors: { type: "array", items: { type: "object", properties: {
          r: { type: "number" }, g: { type: "number" }, b: { type: "number" }, a: { type: "number" },
        } } },
        triangles: { type: "array", items: { type: "number" } },
      } } },
      clear: { type: "boolean" },
    },
  }),

  "nvblox_msgs/msg/VoxelBlockLayer": JSON.stringify({
    type: "object",
    properties: {
      header: { type: "object" },
      block_size_m: { type: "number" },
      voxel_size_m: { type: "number" },
      block_indices: { type: "array", items: { type: "object", properties: {
        x: { type: "number" }, y: { type: "number" }, z: { type: "number" },
      } } },
      blocks: { type: "array", items: { type: "object", properties: {
        centers: { type: "array", items: { type: "object", properties: {
          x: { type: "number" }, y: { type: "number" }, z: { type: "number" },
        } } },
        colors: { type: "array", items: { type: "object", properties: {
          r: { type: "number" }, g: { type: "number" }, b: { type: "number" }, a: { type: "number" },
        } } },
      } } },
      clear: { type: "boolean" },
      layer_type: { type: "number" },
    },
  }),

  "nvblox_msgs/msg/DistanceMapSlice": JSON.stringify({
    type: "object",
    properties: {
      header: { type: "object" },
      origin: { type: "object", properties: {
        x: { type: "number" }, y: { type: "number" }, z: { type: "number" },
      } },
      resolution: { type: "number" },
      width: { type: "number" },
      height: { type: "number" },
      data: { type: "array", items: { type: "number" } },
      unknown_value: { type: "number" },
    },
  }),

  "visualization_msgs/msg/MarkerArray": JSON.stringify({
    type: "object",
    properties: {
      markers: { type: "array", items: { type: "object", properties: {
        header: { type: "object" },
        ns: { type: "string" },
        id: { type: "number" },
        type: { type: "number" },
        action: { type: "number" },
        pose: { type: "object", properties: {
          position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
          orientation: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" }, w: { type: "number" } } },
        } },
        scale: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } },
        color: { type: "object", properties: { r: { type: "number" }, g: { type: "number" }, b: { type: "number" }, a: { type: "number" } } },
        lifetime: { type: "object", properties: { sec: { type: "number" }, nsec: { type: "number" } } },
        frame_locked: { type: "boolean" },
        points: { type: "array", items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } } },
        colors: { type: "array", items: { type: "object", properties: { r: { type: "number" }, g: { type: "number" }, b: { type: "number" }, a: { type: "number" } } } },
        text: { type: "string" },
        mesh_resource: { type: "string" },
        mesh_use_embedded_materials: { type: "boolean" },
      } } },
    },
  }),

  "sensor_msgs/msg/LaserScan": JSON.stringify({
    type: "object",
    properties: {
      header: { type: "object" },
      angle_min: { type: "number" },
      angle_max: { type: "number" },
      angle_increment: { type: "number" },
      time_increment: { type: "number" },
      scan_time: { type: "number" },
      range_min: { type: "number" },
      range_max: { type: "number" },
      ranges: { type: "array", items: { type: "number" } },
      intensities: { type: "array", items: { type: "number" } },
    },
  }),

  "sensor_msgs/msg/PointCloud2": JSON.stringify({
    type: "object",
    properties: {
      header: { type: "object" },
      height: { type: "number" },
      width: { type: "number" },
      fields: { type: "array", items: { type: "object", properties: {
        name: { type: "string" }, offset: { type: "number" }, datatype: { type: "number" }, count: { type: "number" },
      } } },
      is_bigendian: { type: "boolean" },
      point_step: { type: "number" },
      row_step: { type: "number" },
      data: { type: "string", contentEncoding: "base64" },
      is_dense: { type: "boolean" },
    },
  }),
};

// ===== Server setup =====

const server = new FoxgloveServer({ name: "mock-ros2-server" });
const ws = new WebSocketServer({
  port: PORT,
  handleProtocols: (protocols) => server.handleProtocols(protocols),
});

ws.on("listening", () => {
  console.log(`Mock Foxglove WebSocket server listening on ws://localhost:${PORT}`);
  console.log("Connect Lichtblick to this address using Foxglove WebSocket data source");
});

ws.on("connection", (conn, req) => {
  const name = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
  console.log(`Client connected: ${name}`);
  server.handleConnection(conn, name);
});

server.on("subscribe", (chanId) => {
  console.log(`Client subscribed to channel ${chanId}`);
});

server.on("error", (err) => {
  console.error("Server error:", err);
});

const textEncoder = new TextEncoder();

function addChan(topic: string, schemaName: string) {
  return server.addChannel({
    topic,
    encoding: "json",
    schemaName,
    schema: schemas[schemaName] ?? "{}",
  });
}

function send(chanId: number, msg: unknown) {
  server.sendMessage(
    chanId,
    BigInt(Date.now()) * 1_000_000n,
    textEncoder.encode(JSON.stringify(msg)),
  );
}

// Register all channels
const chanTF = addChan("/tf", "tf2_msgs/msg/TFMessage");
const chanMesh = addChan("/nvblox_node/mesh", "nvblox_msgs/msg/Mesh");
const chanVoxel = addChan("/nvblox_node/semantic_layer", "nvblox_msgs/msg/VoxelBlockLayer");
const chanDistMap = addChan("/nvblox_node/map_slice", "nvblox_msgs/msg/DistanceMapSlice");
const chanPath = addChan("/coverage_planner_paths", "nav_msgs/msg/Path");
const chanDepth = addChan("/camera/depth/image_raw", "sensor_msgs/msg/Image");
const chanSemantic = addChan("/camera/semantic/image_raw", "sensor_msgs/msg/Image");
const chanColor = addChan("/camera/color/image_raw", "sensor_msgs/msg/Image");
const chanMarkers = addChan("/markers", "visualization_msgs/msg/MarkerArray");
const chanScan = addChan("/scan", "sensor_msgs/msg/LaserScan");
const chanCloud = addChan("/pointcloud", "sensor_msgs/msg/PointCloud2");

console.log("Registered channels:");
console.log("  /tf                          (tf2_msgs/msg/TFMessage)");
console.log("  /nvblox_node/mesh            (nvblox_msgs/msg/Mesh)");
console.log("  /nvblox_node/semantic_layer   (nvblox_msgs/msg/VoxelBlockLayer)");
console.log("  /nvblox_node/map_slice       (nvblox_msgs/msg/DistanceMapSlice)");
console.log("  /coverage_planner_paths      (nav_msgs/msg/Path)");
console.log("  /camera/depth/image_raw      (sensor_msgs/msg/Image, 32FC1)");
console.log("  /camera/semantic/image_raw   (sensor_msgs/msg/Image, mono8)");
console.log("  /camera/color/image_raw      (sensor_msgs/msg/Image, rgb8)");
console.log("  /markers                     (visualization_msgs/msg/MarkerArray)");
console.log("  /scan                        (sensor_msgs/msg/LaserScan)");
console.log("  /pointcloud                  (sensor_msgs/msg/PointCloud2)");

// --- Publish loops ---

// TF: 20Hz — must be fast so frames exist when other messages arrive
setInterval(() => {
  const t = Date.now() / 5000;
  send(chanTF, {
    transforms: [
      {
        header: makeHeader("map"),
        child_frame_id: "odom",
        transform: {
          translation: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
      {
        header: makeHeader("odom"),
        child_frame_id: "base_link",
        transform: {
          translation: { x: Math.sin(t) * 0.5, y: Math.cos(t) * 0.5, z: 0 },
          rotation: { x: 0, y: 0, z: Math.sin(t / 2) * 0.1, w: Math.cos(t / 2) * 0.1 + 0.9 },
        },
      },
    ],
  });
}, 50);

// Nvblox mesh: 2Hz
setInterval(() => {
  const { blocks, blockIndices } = makeMeshBlocks();
  send(chanMesh, {
    header: makeHeader("map"),
    block_size_m: 2.0,
    block_indices: blockIndices,
    blocks,
    clear: false,
  });
}, 500);

// Nvblox voxel layer: 2Hz
setInterval(() => {
  const { blocks, blockIndices } = makeVoxelBlocks();
  send(chanVoxel, {
    header: makeHeader("map"),
    block_size_m: 2.0,
    voxel_size_m: 0.5,
    block_indices: blockIndices,
    blocks,
    clear: false,
    layer_type: 1, // Occupancy
  });
}, 500);

// Distance map slice: 1Hz
setInterval(() => {
  const width = 50;
  const height = 50;
  send(chanDistMap, {
    header: makeHeader("map"),
    origin: { x: -2.5, y: -2.5, z: 0.01 },
    resolution: 0.1,
    width,
    height,
    data: makeDistanceMapSlice(width, height),
    unknown_value: -1,
  });
}, 1000);

// Nav path: 2Hz
setInterval(() => {
  send(chanPath, {
    header: makeHeader("map"),
    poses: makeNavPath(30),
  });
}, 500);

// Depth image: 10Hz
const IMG_W = 64;
const IMG_H = 64;
setInterval(() => {
  send(chanDepth, {
    header: makeHeader("base_link"),
    height: IMG_H,
    width: IMG_W,
    encoding: "32FC1",
    is_bigendian: 0,
    step: IMG_W * 4,
    data: makeDepthImage(IMG_W, IMG_H),
  });
}, 100);

// Semantic image: 10Hz
setInterval(() => {
  send(chanSemantic, {
    header: makeHeader("base_link"),
    height: IMG_H,
    width: IMG_W,
    encoding: "mono8",
    is_bigendian: 0,
    step: IMG_W,
    data: makeSemanticImage(IMG_W, IMG_H),
  });
}, 100);

// Color image: 10Hz
setInterval(() => {
  send(chanColor, {
    header: makeHeader("base_link"),
    height: IMG_H,
    width: IMG_W,
    encoding: "rgb8",
    is_bigendian: 0,
    step: IMG_W * 3,
    data: makeRGBImage(IMG_W, IMG_H),
  });
}, 100);

// Markers: 5Hz
setInterval(() => {
  send(chanMarkers, makeMarkerArray());
}, 200);

// Laser scan: 10Hz
setInterval(() => {
  send(chanScan, {
    header: makeHeader("base_link"),
    ...makeLaserScan(),
  });
}, 100);

// Point cloud: 5Hz
setInterval(() => {
  send(chanCloud, {
    header: makeHeader("base_link"),
    ...makePointCloud(),
  });
}, 200);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down mock server...");
  ws.clients.forEach((client) => {
    client.terminate();
  });
  ws.close(() => {
    process.exit(0);
  });
});

console.log("\nPublishing mock data. Press Ctrl+C to stop.");
