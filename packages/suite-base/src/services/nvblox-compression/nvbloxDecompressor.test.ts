// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import zlib from "zlib";

import { decompressNvbloxMesh, decompressNvbloxVoxelBlockLayer } from "./nvbloxDecompressor";
import type { CompressedNvbloxMesh, CompressedNvbloxVoxelBlockLayer } from "./types";
import type { Header, Index3D } from "../../types/NvbloxMessages";

// ---------------------------------------------------------------------------
// Encoder-side helpers (inverse of the internal decompressor helpers)
// ---------------------------------------------------------------------------

/** Byte-shuffle: transpose a (numElements x elementSize) matrix of bytes into column-major order. */
function byteShuffle(src: Uint8Array, numElements: number, elementSize: number): Uint8Array {
  const dst = new Uint8Array(numElements * elementSize);
  for (let i = 0; i < numElements; i++) {
    for (let b = 0; b < elementSize; b++) {
      dst[b * numElements + i] = src[i * elementSize + b]!;
    }
  }
  return dst;
}

/** Delta-encode an Int32Array — the inverse of deltaDecode. Returns a new array. */
function deltaEncode(data: Int32Array): Int32Array {
  const result = new Int32Array(data.length);
  result[0] = data[0]!;
  for (let i = 1; i < data.length; i++) {
    result[i] = data[i]! - data[i - 1]!;
  }
  return result;
}

/**
 * Pack float32 positions (or normals) for a single block via byte-shuffling.
 * `points` is an array of {x, y, z}. Returns the raw bytes after shuffle.
 */
function packPositions(points: { x: number; y: number; z: number }[]): Uint8Array {
  const numFloats = points.length * 3;
  const floatArr = new Float32Array(numFloats);
  for (let i = 0; i < points.length; i++) {
    floatArr[i * 3] = points[i]!.x;
    floatArr[i * 3 + 1] = points[i]!.y;
    floatArr[i * 3 + 2] = points[i]!.z;
  }
  const raw = new Uint8Array(floatArr.buffer, floatArr.byteOffset, floatArr.byteLength);
  return byteShuffle(raw, numFloats, 4);
}

/**
 * Pack RGBA colours as interleaved uint8 quads. Values are expected in [0, 255].
 */
function packColors(
  colors: { r: number; g: number; b: number; a: number }[],
): Uint8Array {
  const buf = new Uint8Array(colors.length * 4);
  for (let i = 0; i < colors.length; i++) {
    buf[i * 4] = colors[i]!.r;
    buf[i * 4 + 1] = colors[i]!.g;
    buf[i * 4 + 2] = colors[i]!.b;
    buf[i * 4 + 3] = colors[i]!.a;
  }
  return buf;
}

/**
 * Pack triangle indices — delta-encode then write as raw little-endian bytes.
 */
function packTriangles(indices: number[]): Uint8Array {
  const encoded = deltaEncode(new Int32Array(indices));
  return new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);
}

/** Concatenate multiple Uint8Arrays into one. */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/** ZSTD-compress a buffer using Node 22+ zlib. */
function zstdCompress(data: Uint8Array): Uint8Array {
  // zstdCompressSync exists in Node 22+ but is missing from @types/node
  const compress = (zlib as unknown as Record<string, (buf: Buffer) => Buffer>)
    .zstdCompressSync;
  return new Uint8Array(compress(Buffer.from(data)));
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeHeader(frameId = "map"): Header {
  return { stamp: { sec: 1, nsec: 0 }, frame_id: frameId };
}

function makeIndex3D(x = 0, y = 0, z = 0): Index3D {
  return { x, y, z };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("decompressNvbloxMesh", () => {
  it("returns undefined for unknown format", () => {
    const compressed: CompressedNvbloxMesh = {
      header: makeHeader(),
      block_size_m: 1,
      block_indices: [],
      clear: false,
      format: "unknown_format",
      num_blocks: 0,
      block_vertex_counts: [],
      block_triangle_counts: [],
      block_has_normals: [],
      block_has_colors: [],
      block_byte_sizes: [],
      compressed_data: new Uint8Array(0),
    };

    const result = decompressNvbloxMesh(compressed);

    expect(result).toBeUndefined();
  });

  it("returns empty blocks when num_blocks is 0", () => {
    const header = makeHeader("base_link");
    const compressed: CompressedNvbloxMesh = {
      header,
      block_size_m: 0.5,
      block_indices: [],
      clear: true,
      format: "qzstd_v1",
      num_blocks: 0,
      block_vertex_counts: [],
      block_triangle_counts: [],
      block_has_normals: [],
      block_has_colors: [],
      block_byte_sizes: [],
      compressed_data: new Uint8Array(0),
    };

    const result = decompressNvbloxMesh(compressed);

    expect(result).toBeDefined();
    expect(result!.blocks).toEqual([]);
    expect(result!.header).toBe(header);
    expect(result!.block_size_m).toBe(0.5);
    expect(result!.clear).toBe(true);
  });

  it("decompresses a single block with all sections (positions, normals, colors, triangles)", () => {
    const vertices = [
      { x: 1.0, y: 2.0, z: 3.0 },
      { x: 4.0, y: 5.0, z: 6.0 },
      { x: 7.0, y: 8.0, z: 9.0 },
    ];
    const normals = [
      { x: 0.0, y: 0.0, z: 1.0 },
      { x: 0.0, y: 1.0, z: 0.0 },
      { x: 1.0, y: 0.0, z: 0.0 },
    ];
    const colorsRaw = [
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 0, g: 255, b: 0, a: 128 },
      { r: 0, g: 0, b: 255, a: 64 },
    ];
    const triangles = [0, 1, 2];

    const raw = concat(
      packPositions(vertices),
      packPositions(normals),
      packColors(colorsRaw),
      packTriangles(triangles),
    );

    const blockIndex = makeIndex3D(1, 2, 3);
    const compressed: CompressedNvbloxMesh = {
      header: makeHeader(),
      block_size_m: 0.1,
      block_indices: [blockIndex],
      clear: false,
      format: "qzstd_v1",
      num_blocks: 1,
      block_vertex_counts: [3],
      block_triangle_counts: [3],
      block_has_normals: [1],
      block_has_colors: [1],
      block_byte_sizes: [raw.length],
      compressed_data: zstdCompress(raw),
    };

    const result = decompressNvbloxMesh(compressed);

    expect(result).toBeDefined();
    expect(result!.blocks).toHaveLength(1);

    const block = result!.blocks[0]!;

    // Verify positions
    expect(block.vertices).toHaveLength(3);
    for (let i = 0; i < vertices.length; i++) {
      expect(block.vertices[i]!.x).toBeCloseTo(vertices[i]!.x, 5);
      expect(block.vertices[i]!.y).toBeCloseTo(vertices[i]!.y, 5);
      expect(block.vertices[i]!.z).toBeCloseTo(vertices[i]!.z, 5);
    }

    // Verify normals
    expect(block.normals).toHaveLength(3);
    for (let i = 0; i < normals.length; i++) {
      expect(block.normals[i]!.x).toBeCloseTo(normals[i]!.x, 5);
      expect(block.normals[i]!.y).toBeCloseTo(normals[i]!.y, 5);
      expect(block.normals[i]!.z).toBeCloseTo(normals[i]!.z, 5);
    }

    // Verify colors (decompressed values are in [0, 1])
    expect(block.colors).toHaveLength(3);
    expect(block.colors[0]!.r).toBeCloseTo(1.0, 2);
    expect(block.colors[0]!.g).toBeCloseTo(0.0, 2);
    expect(block.colors[0]!.b).toBeCloseTo(0.0, 2);
    expect(block.colors[0]!.a).toBeCloseTo(1.0, 2);

    expect(block.colors[1]!.r).toBeCloseTo(0.0, 2);
    expect(block.colors[1]!.g).toBeCloseTo(1.0, 2);
    expect(block.colors[1]!.b).toBeCloseTo(0.0, 2);
    expect(block.colors[1]!.a).toBeCloseTo(128 / 255, 2);

    expect(block.colors[2]!.r).toBeCloseTo(0.0, 2);
    expect(block.colors[2]!.g).toBeCloseTo(0.0, 2);
    expect(block.colors[2]!.b).toBeCloseTo(1.0, 2);
    expect(block.colors[2]!.a).toBeCloseTo(64 / 255, 2);

    // Verify triangles
    expect(block.triangles).toEqual([0, 1, 2]);
  });

  it("decompresses a block with no normals", () => {
    const vertices = [
      { x: 10.0, y: 20.0, z: 30.0 },
      { x: 40.0, y: 50.0, z: 60.0 },
    ];
    const colorsRaw = [
      { r: 100, g: 150, b: 200, a: 255 },
      { r: 50, g: 75, b: 100, a: 200 },
    ];
    const triangles = [0, 1, 0];

    const raw = concat(
      packPositions(vertices),
      // no normals
      packColors(colorsRaw),
      packTriangles(triangles),
    );

    const compressed: CompressedNvbloxMesh = {
      header: makeHeader(),
      block_size_m: 0.2,
      block_indices: [makeIndex3D()],
      clear: false,
      format: "qzstd_v1",
      num_blocks: 1,
      block_vertex_counts: [2],
      block_triangle_counts: [3],
      block_has_normals: [0],
      block_has_colors: [1],
      block_byte_sizes: [raw.length],
      compressed_data: zstdCompress(raw),
    };

    const result = decompressNvbloxMesh(compressed);

    expect(result).toBeDefined();
    const block = result!.blocks[0]!;
    expect(block.normals).toEqual([]);
    expect(block.vertices).toHaveLength(2);
    expect(block.colors).toHaveLength(2);
    expect(block.triangles).toEqual([0, 1, 0]);
  });

  it("decompresses a block with no colors", () => {
    const vertices = [
      { x: 1.5, y: 2.5, z: 3.5 },
    ];
    const normals = [
      { x: 0.0, y: 1.0, z: 0.0 },
    ];

    const raw = concat(
      packPositions(vertices),
      packPositions(normals),
      // no colors, no triangles
    );

    const compressed: CompressedNvbloxMesh = {
      header: makeHeader(),
      block_size_m: 0.3,
      block_indices: [makeIndex3D()],
      clear: false,
      format: "qzstd_v1",
      num_blocks: 1,
      block_vertex_counts: [1],
      block_triangle_counts: [0],
      block_has_normals: [1],
      block_has_colors: [0],
      block_byte_sizes: [raw.length],
      compressed_data: zstdCompress(raw),
    };

    const result = decompressNvbloxMesh(compressed);

    expect(result).toBeDefined();
    const block = result!.blocks[0]!;
    expect(block.vertices).toHaveLength(1);
    expect(block.normals).toHaveLength(1);
    expect(block.colors).toEqual([]);
    expect(block.triangles).toEqual([]);
  });

  it("decompresses a block with no normals and no colors", () => {
    const vertices = [
      { x: 0.0, y: 0.0, z: 0.0 },
      { x: 1.0, y: 0.0, z: 0.0 },
      { x: 0.0, y: 1.0, z: 0.0 },
    ];
    const triangles = [0, 1, 2];

    const raw = concat(
      packPositions(vertices),
      packTriangles(triangles),
    );

    const compressed: CompressedNvbloxMesh = {
      header: makeHeader(),
      block_size_m: 0.1,
      block_indices: [makeIndex3D()],
      clear: false,
      format: "qzstd_v1",
      num_blocks: 1,
      block_vertex_counts: [3],
      block_triangle_counts: [3],
      block_has_normals: [0],
      block_has_colors: [0],
      block_byte_sizes: [raw.length],
      compressed_data: zstdCompress(raw),
    };

    const result = decompressNvbloxMesh(compressed);

    expect(result).toBeDefined();
    const block = result!.blocks[0]!;
    expect(block.normals).toEqual([]);
    expect(block.colors).toEqual([]);
    expect(block.vertices).toHaveLength(3);
    expect(block.triangles).toEqual([0, 1, 2]);
  });

  it("decompresses multiple blocks in a single message", () => {
    const vertices1 = [
      { x: 1.0, y: 2.0, z: 3.0 },
      { x: 4.0, y: 5.0, z: 6.0 },
    ];
    const triangles1 = [0, 1, 0];

    const vertices2 = [
      { x: 10.0, y: 20.0, z: 30.0 },
      { x: 40.0, y: 50.0, z: 60.0 },
      { x: 70.0, y: 80.0, z: 90.0 },
    ];
    const colorsRaw2 = [
      { r: 255, g: 128, b: 64, a: 255 },
      { r: 32, g: 16, b: 8, a: 200 },
      { r: 100, g: 100, b: 100, a: 100 },
    ];
    const triangles2 = [0, 1, 2, 2, 1, 0];

    // Block 1: positions + triangles (no normals, no colors)
    const rawBlock1 = concat(
      packPositions(vertices1),
      packTriangles(triangles1),
    );

    // Block 2: positions + colors + triangles (no normals)
    const rawBlock2 = concat(
      packPositions(vertices2),
      packColors(colorsRaw2),
      packTriangles(triangles2),
    );

    // All blocks concatenated then compressed
    const rawAll = concat(rawBlock1, rawBlock2);

    const compressed: CompressedNvbloxMesh = {
      header: makeHeader(),
      block_size_m: 0.5,
      block_indices: [makeIndex3D(0, 0, 0), makeIndex3D(1, 0, 0)],
      clear: false,
      format: "qzstd_v1",
      num_blocks: 2,
      block_vertex_counts: [2, 3],
      block_triangle_counts: [3, 6],
      block_has_normals: [0, 0],
      block_has_colors: [0, 1],
      block_byte_sizes: [rawBlock1.length, rawBlock2.length],
      compressed_data: zstdCompress(rawAll),
    };

    const result = decompressNvbloxMesh(compressed);

    expect(result).toBeDefined();
    expect(result!.blocks).toHaveLength(2);

    // Block 1
    const b1 = result!.blocks[0]!;
    expect(b1.vertices).toHaveLength(2);
    expect(b1.vertices[0]!.x).toBeCloseTo(1.0, 5);
    expect(b1.normals).toEqual([]);
    expect(b1.colors).toEqual([]);
    expect(b1.triangles).toEqual([0, 1, 0]);

    // Block 2
    const b2 = result!.blocks[1]!;
    expect(b2.vertices).toHaveLength(3);
    expect(b2.vertices[2]!.z).toBeCloseTo(90.0, 5);
    expect(b2.normals).toEqual([]);
    expect(b2.colors).toHaveLength(3);
    expect(b2.colors[0]!.r).toBeCloseTo(1.0, 2);
    expect(b2.colors[0]!.g).toBeCloseTo(128 / 255, 2);
    expect(b2.triangles).toEqual([0, 1, 2, 2, 1, 0]);
  });

  it("preserves header and metadata fields through decompression", () => {
    const header = makeHeader("odom");
    const blockIndex = makeIndex3D(5, -3, 7);

    const vertices = [{ x: 0.0, y: 0.0, z: 0.0 }];
    const raw = packPositions(vertices);

    const compressed: CompressedNvbloxMesh = {
      header,
      block_size_m: 1.25,
      block_indices: [blockIndex],
      clear: true,
      format: "qzstd_v1",
      num_blocks: 1,
      block_vertex_counts: [1],
      block_triangle_counts: [0],
      block_has_normals: [0],
      block_has_colors: [0],
      block_byte_sizes: [raw.length],
      compressed_data: zstdCompress(raw),
    };

    const result = decompressNvbloxMesh(compressed);

    expect(result).toBeDefined();
    expect(result!.header).toBe(header);
    expect(result!.block_size_m).toBe(1.25);
    expect(result!.block_indices).toEqual([blockIndex]);
    expect(result!.clear).toBe(true);
  });

  it("correctly delta-decodes ascending triangle indices", () => {
    const vertices = [
      { x: 0.0, y: 0.0, z: 0.0 },
      { x: 1.0, y: 0.0, z: 0.0 },
      { x: 0.0, y: 1.0, z: 0.0 },
      { x: 1.0, y: 1.0, z: 0.0 },
    ];
    // After delta-decode these should become [0, 1, 2, 3, 2, 1]
    const triangles = [0, 1, 2, 3, 2, 1];

    const raw = concat(
      packPositions(vertices),
      packTriangles(triangles),
    );

    const compressed: CompressedNvbloxMesh = {
      header: makeHeader(),
      block_size_m: 0.1,
      block_indices: [makeIndex3D()],
      clear: false,
      format: "qzstd_v1",
      num_blocks: 1,
      block_vertex_counts: [4],
      block_triangle_counts: [6],
      block_has_normals: [0],
      block_has_colors: [0],
      block_byte_sizes: [raw.length],
      compressed_data: zstdCompress(raw),
    };

    const result = decompressNvbloxMesh(compressed);

    expect(result).toBeDefined();
    expect(result!.blocks[0]!.triangles).toEqual([0, 1, 2, 3, 2, 1]);
  });

  it("correctly delta-decodes non-monotonic triangle indices", () => {
    // Non-monotonic: [10, 5, 20, 3, 15]
    const vertices = Array.from({ length: 21 }, (_, i) => ({
      x: i * 0.1,
      y: 0.0,
      z: 0.0,
    }));
    const triangles = [10, 5, 20, 3, 15];

    const raw = concat(
      packPositions(vertices),
      packTriangles(triangles),
    );

    const compressed: CompressedNvbloxMesh = {
      header: makeHeader(),
      block_size_m: 0.1,
      block_indices: [makeIndex3D()],
      clear: false,
      format: "qzstd_v1",
      num_blocks: 1,
      block_vertex_counts: [21],
      block_triangle_counts: [5],
      block_has_normals: [0],
      block_has_colors: [0],
      block_byte_sizes: [raw.length],
      compressed_data: zstdCompress(raw),
    };

    const result = decompressNvbloxMesh(compressed);

    expect(result).toBeDefined();
    expect(result!.blocks[0]!.triangles).toEqual([10, 5, 20, 3, 15]);
  });

  it("handles zero-vertex block with zero triangles", () => {
    // Edge case: a block with 0 vertices and 0 triangles
    // The raw buffer for this block is empty
    const raw = new Uint8Array(0);

    const compressed: CompressedNvbloxMesh = {
      header: makeHeader(),
      block_size_m: 0.1,
      block_indices: [makeIndex3D()],
      clear: false,
      format: "qzstd_v1",
      num_blocks: 1,
      block_vertex_counts: [0],
      block_triangle_counts: [0],
      block_has_normals: [0],
      block_has_colors: [0],
      block_byte_sizes: [0],
      compressed_data: zstdCompress(raw),
    };

    const result = decompressNvbloxMesh(compressed);

    expect(result).toBeDefined();
    expect(result!.blocks).toHaveLength(1);
    const block = result!.blocks[0]!;
    expect(block.vertices).toEqual([]);
    expect(block.normals).toEqual([]);
    expect(block.colors).toEqual([]);
    expect(block.triangles).toEqual([]);
  });

  it("preserves float32 precision through byte-shuffle round-trip", () => {
    // Use values that exercise float32 precision edge cases
    const vertices = [
      { x: 0.1, y: 0.2, z: 0.3 },
      { x: -1e6, y: 1e6, z: 3.14159 },
      { x: Number.EPSILON, y: -Number.EPSILON, z: 0.0 },
    ];

    const raw = packPositions(vertices);
    const compressed: CompressedNvbloxMesh = {
      header: makeHeader(),
      block_size_m: 0.1,
      block_indices: [makeIndex3D()],
      clear: false,
      format: "qzstd_v1",
      num_blocks: 1,
      block_vertex_counts: [3],
      block_triangle_counts: [0],
      block_has_normals: [0],
      block_has_colors: [0],
      block_byte_sizes: [raw.length],
      compressed_data: zstdCompress(raw),
    };

    const result = decompressNvbloxMesh(compressed);
    expect(result).toBeDefined();

    const block = result!.blocks[0]!;

    // Float32 has ~7 decimal digits of precision, so check with appropriate tolerance.
    // The values stored go through Float32Array, which truncates float64 → float32.
    const f32 = (v: number) => Math.fround(v);
    for (let i = 0; i < vertices.length; i++) {
      expect(block.vertices[i]!.x).toBe(f32(vertices[i]!.x));
      expect(block.vertices[i]!.y).toBe(f32(vertices[i]!.y));
      expect(block.vertices[i]!.z).toBe(f32(vertices[i]!.z));
    }
  });

  it("handles large vertex counts", () => {
    const count = 1000;
    const vertices = Array.from({ length: count }, (_, i) => ({
      x: i * 0.01,
      y: i * 0.02,
      z: i * 0.03,
    }));
    const triangles = Array.from({ length: count }, (_, i) => i % count);

    const raw = concat(
      packPositions(vertices),
      packTriangles(triangles),
    );

    const compressed: CompressedNvbloxMesh = {
      header: makeHeader(),
      block_size_m: 0.1,
      block_indices: [makeIndex3D()],
      clear: false,
      format: "qzstd_v1",
      num_blocks: 1,
      block_vertex_counts: [count],
      block_triangle_counts: [count],
      block_has_normals: [0],
      block_has_colors: [0],
      block_byte_sizes: [raw.length],
      compressed_data: zstdCompress(raw),
    };

    const result = decompressNvbloxMesh(compressed);

    expect(result).toBeDefined();
    expect(result!.blocks[0]!.vertices).toHaveLength(count);
    expect(result!.blocks[0]!.triangles).toHaveLength(count);

    // Spot-check a few values
    const f32 = (v: number) => Math.fround(v);
    expect(result!.blocks[0]!.vertices[500]!.x).toBe(f32(500 * 0.01));
    expect(result!.blocks[0]!.vertices[999]!.z).toBe(f32(999 * 0.03));
    expect(result!.blocks[0]!.triangles[0]).toBe(0);
    expect(result!.blocks[0]!.triangles[999]).toBe(999);
  });
});

describe("decompressNvbloxVoxelBlockLayer", () => {
  it("returns undefined for unknown format", () => {
    const compressed: CompressedNvbloxVoxelBlockLayer = {
      header: makeHeader(),
      block_size_m: 1,
      voxel_size_m: 0.05,
      layer_type: 0,
      block_indices: [],
      clear: false,
      format: "bad_format",
      num_blocks: 0,
      block_voxel_counts: [],
      block_has_colors: [],
      block_byte_sizes: [],
      compressed_data: new Uint8Array(0),
    };

    const result = decompressNvbloxVoxelBlockLayer(compressed);

    expect(result).toBeUndefined();
  });

  it("returns empty blocks when num_blocks is 0", () => {
    const header = makeHeader("world");
    const compressed: CompressedNvbloxVoxelBlockLayer = {
      header,
      block_size_m: 0.8,
      voxel_size_m: 0.05,
      layer_type: 2,
      block_indices: [],
      clear: true,
      format: "qzstd_v1",
      num_blocks: 0,
      block_voxel_counts: [],
      block_has_colors: [],
      block_byte_sizes: [],
      compressed_data: new Uint8Array(0),
    };

    const result = decompressNvbloxVoxelBlockLayer(compressed);

    expect(result).toBeDefined();
    expect(result!.blocks).toEqual([]);
    expect(result!.header).toBe(header);
    expect(result!.block_size_m).toBe(0.8);
    expect(result!.voxel_size_m).toBe(0.05);
    expect(result!.layer_type).toBe(2);
    expect(result!.clear).toBe(true);
  });

  it("decompresses a single voxel block with centers and colors", () => {
    const centers = [
      { x: 0.5, y: 0.5, z: 0.5 },
      { x: 1.5, y: 0.5, z: 0.5 },
      { x: 0.5, y: 1.5, z: 0.5 },
    ];
    const colorsRaw = [
      { r: 200, g: 100, b: 50, a: 255 },
      { r: 10, g: 20, b: 30, a: 40 },
      { r: 128, g: 128, b: 128, a: 128 },
    ];

    const raw = concat(
      packPositions(centers),
      packColors(colorsRaw),
    );

    const compressed: CompressedNvbloxVoxelBlockLayer = {
      header: makeHeader(),
      block_size_m: 0.1,
      voxel_size_m: 0.025,
      layer_type: 1,
      block_indices: [makeIndex3D(0, 0, 0)],
      clear: false,
      format: "qzstd_v1",
      num_blocks: 1,
      block_voxel_counts: [3],
      block_has_colors: [1],
      block_byte_sizes: [raw.length],
      compressed_data: zstdCompress(raw),
    };

    const result = decompressNvbloxVoxelBlockLayer(compressed);

    expect(result).toBeDefined();
    expect(result!.blocks).toHaveLength(1);

    const block = result!.blocks[0]!;
    expect(block.centers).toHaveLength(3);
    expect(block.centers[0]!.x).toBeCloseTo(0.5, 5);
    expect(block.centers[1]!.x).toBeCloseTo(1.5, 5);
    expect(block.centers[2]!.y).toBeCloseTo(1.5, 5);

    expect(block.colors).toHaveLength(3);
    expect(block.colors[0]!.r).toBeCloseTo(200 / 255, 2);
    expect(block.colors[0]!.g).toBeCloseTo(100 / 255, 2);
    expect(block.colors[1]!.a).toBeCloseTo(40 / 255, 2);
    expect(block.colors[2]!.r).toBeCloseTo(128 / 255, 2);
  });

  it("decompresses a voxel block without colors", () => {
    const centers = [
      { x: 0.0, y: 0.0, z: 0.0 },
      { x: 0.1, y: 0.1, z: 0.1 },
    ];

    const raw = packPositions(centers);

    const compressed: CompressedNvbloxVoxelBlockLayer = {
      header: makeHeader(),
      block_size_m: 0.1,
      voxel_size_m: 0.01,
      layer_type: 0,
      block_indices: [makeIndex3D()],
      clear: false,
      format: "qzstd_v1",
      num_blocks: 1,
      block_voxel_counts: [2],
      block_has_colors: [0],
      block_byte_sizes: [raw.length],
      compressed_data: zstdCompress(raw),
    };

    const result = decompressNvbloxVoxelBlockLayer(compressed);

    expect(result).toBeDefined();
    const block = result!.blocks[0]!;
    expect(block.centers).toHaveLength(2);
    expect(block.colors).toEqual([]);
  });

  it("decompresses multiple voxel blocks with mixed color presence", () => {
    // Block 1: centers only (no colors)
    const centers1 = [
      { x: 0.0, y: 0.0, z: 0.0 },
    ];
    const rawBlock1 = packPositions(centers1);

    // Block 2: centers + colors
    const centers2 = [
      { x: 1.0, y: 1.0, z: 1.0 },
      { x: 2.0, y: 2.0, z: 2.0 },
    ];
    const colorsRaw2 = [
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 0, g: 255, b: 0, a: 255 },
    ];
    const rawBlock2 = concat(
      packPositions(centers2),
      packColors(colorsRaw2),
    );

    // Block 3: centers + colors
    const centers3 = [
      { x: 3.0, y: 3.0, z: 3.0 },
    ];
    const colorsRaw3 = [
      { r: 0, g: 0, b: 255, a: 128 },
    ];
    const rawBlock3 = concat(
      packPositions(centers3),
      packColors(colorsRaw3),
    );

    const rawAll = concat(rawBlock1, rawBlock2, rawBlock3);

    const compressed: CompressedNvbloxVoxelBlockLayer = {
      header: makeHeader(),
      block_size_m: 0.5,
      voxel_size_m: 0.05,
      layer_type: 1,
      block_indices: [makeIndex3D(0, 0, 0), makeIndex3D(1, 0, 0), makeIndex3D(2, 0, 0)],
      clear: false,
      format: "qzstd_v1",
      num_blocks: 3,
      block_voxel_counts: [1, 2, 1],
      block_has_colors: [0, 1, 1],
      block_byte_sizes: [rawBlock1.length, rawBlock2.length, rawBlock3.length],
      compressed_data: zstdCompress(rawAll),
    };

    const result = decompressNvbloxVoxelBlockLayer(compressed);

    expect(result).toBeDefined();
    expect(result!.blocks).toHaveLength(3);

    // Block 1
    expect(result!.blocks[0]!.centers).toHaveLength(1);
    expect(result!.blocks[0]!.colors).toEqual([]);

    // Block 2
    expect(result!.blocks[1]!.centers).toHaveLength(2);
    expect(result!.blocks[1]!.colors).toHaveLength(2);
    expect(result!.blocks[1]!.colors[0]!.r).toBeCloseTo(1.0, 2);
    expect(result!.blocks[1]!.colors[1]!.g).toBeCloseTo(1.0, 2);

    // Block 3
    expect(result!.blocks[2]!.centers).toHaveLength(1);
    expect(result!.blocks[2]!.centers[0]!.x).toBeCloseTo(3.0, 5);
    expect(result!.blocks[2]!.colors).toHaveLength(1);
    expect(result!.blocks[2]!.colors[0]!.b).toBeCloseTo(1.0, 2);
    expect(result!.blocks[2]!.colors[0]!.a).toBeCloseTo(128 / 255, 2);
  });

  it("preserves header and metadata fields through decompression", () => {
    const header = makeHeader("sensor_frame");
    const blockIndex = makeIndex3D(-1, 4, 2);

    const centers = [{ x: 0.0, y: 0.0, z: 0.0 }];
    const raw = packPositions(centers);

    const compressed: CompressedNvbloxVoxelBlockLayer = {
      header,
      block_size_m: 2.0,
      voxel_size_m: 0.1,
      layer_type: 3,
      block_indices: [blockIndex],
      clear: false,
      format: "qzstd_v1",
      num_blocks: 1,
      block_voxel_counts: [1],
      block_has_colors: [0],
      block_byte_sizes: [raw.length],
      compressed_data: zstdCompress(raw),
    };

    const result = decompressNvbloxVoxelBlockLayer(compressed);

    expect(result).toBeDefined();
    expect(result!.header).toBe(header);
    expect(result!.block_size_m).toBe(2.0);
    expect(result!.voxel_size_m).toBe(0.1);
    expect(result!.layer_type).toBe(3);
    expect(result!.block_indices).toEqual([blockIndex]);
    expect(result!.clear).toBe(false);
  });

  it("handles zero-voxel block", () => {
    const raw = new Uint8Array(0);

    const compressed: CompressedNvbloxVoxelBlockLayer = {
      header: makeHeader(),
      block_size_m: 0.1,
      voxel_size_m: 0.01,
      layer_type: 0,
      block_indices: [makeIndex3D()],
      clear: false,
      format: "qzstd_v1",
      num_blocks: 1,
      block_voxel_counts: [0],
      block_has_colors: [0],
      block_byte_sizes: [0],
      compressed_data: zstdCompress(raw),
    };

    const result = decompressNvbloxVoxelBlockLayer(compressed);

    expect(result).toBeDefined();
    expect(result!.blocks).toHaveLength(1);
    expect(result!.blocks[0]!.centers).toEqual([]);
    expect(result!.blocks[0]!.colors).toEqual([]);
  });

  it("handles large voxel counts", () => {
    const count = 512;
    const centers = Array.from({ length: count }, (_, i) => ({
      x: (i % 8) * 0.05,
      y: (Math.floor(i / 8) % 8) * 0.05,
      z: Math.floor(i / 64) * 0.05,
    }));
    const colorsRaw = Array.from({ length: count }, (_, i) => ({
      r: i % 256,
      g: (i * 2) % 256,
      b: (i * 3) % 256,
      a: 255,
    }));

    const raw = concat(
      packPositions(centers),
      packColors(colorsRaw),
    );

    const compressed: CompressedNvbloxVoxelBlockLayer = {
      header: makeHeader(),
      block_size_m: 0.4,
      voxel_size_m: 0.05,
      layer_type: 1,
      block_indices: [makeIndex3D()],
      clear: false,
      format: "qzstd_v1",
      num_blocks: 1,
      block_voxel_counts: [count],
      block_has_colors: [1],
      block_byte_sizes: [raw.length],
      compressed_data: zstdCompress(raw),
    };

    const result = decompressNvbloxVoxelBlockLayer(compressed);

    expect(result).toBeDefined();
    expect(result!.blocks[0]!.centers).toHaveLength(count);
    expect(result!.blocks[0]!.colors).toHaveLength(count);

    // Spot-check
    const f32 = (v: number) => Math.fround(v);
    expect(result!.blocks[0]!.centers[0]!.x).toBe(f32(0.0));
    expect(result!.blocks[0]!.centers[511]!.z).toBe(f32(Math.floor(511 / 64) * 0.05));
    expect(result!.blocks[0]!.colors[0]!.r).toBeCloseTo(0.0, 2);
    expect(result!.blocks[0]!.colors[255]!.r).toBeCloseTo(255 / 255, 2);
  });
});

describe("encoder helper round-trip verification", () => {
  it("byteShuffle is the inverse of byteUnshuffle", () => {
    // Verify our test encoder helpers are correct by doing a manual round-trip
    // without ZSTD — just byte shuffle → unshuffle through the decompressor's position unpacker.
    const points = [
      { x: 1.0, y: 2.0, z: 3.0 },
      { x: -1.0, y: -2.0, z: -3.0 },
    ];

    const shuffled = packPositions(points);

    // The shuffled buffer should have length = 2 * 3 * 4 = 24 bytes
    expect(shuffled.length).toBe(24);

    // Manually unshuffle to verify
    const numFloats = 6;
    const unshuffled = new Uint8Array(24);
    for (let i = 0; i < numFloats; i++) {
      for (let b = 0; b < 4; b++) {
        unshuffled[i * 4 + b] = shuffled[b * numFloats + i]!;
      }
    }
    const floats = new Float32Array(unshuffled.buffer);
    expect(floats[0]).toBeCloseTo(1.0, 5);
    expect(floats[1]).toBeCloseTo(2.0, 5);
    expect(floats[2]).toBeCloseTo(3.0, 5);
    expect(floats[3]).toBeCloseTo(-1.0, 5);
    expect(floats[4]).toBeCloseTo(-2.0, 5);
    expect(floats[5]).toBeCloseTo(-3.0, 5);
  });

  it("deltaEncode is the inverse of deltaDecode", () => {
    const original = new Int32Array([10, 5, 20, 3, 15]);
    const encoded = deltaEncode(original);

    // Verify encoding: [10, 5-10, 20-5, 3-20, 15-3]
    expect(encoded[0]).toBe(10);
    expect(encoded[1]).toBe(-5);
    expect(encoded[2]).toBe(15);
    expect(encoded[3]).toBe(-17);
    expect(encoded[4]).toBe(12);

    // Verify that delta-decoding (cumulative sum) recovers original
    const decoded = new Int32Array(encoded);
    for (let i = 1; i < decoded.length; i++) {
      decoded[i] = decoded[i]! + decoded[i - 1]!;
    }
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });
});
