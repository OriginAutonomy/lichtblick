// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { decompress } from "fzstd";

import type { CompressedNvbloxMesh, CompressedNvbloxVoxelBlockLayer } from "./types";
import type { Mesh, MeshBlock, VoxelBlock, VoxelBlockLayer } from "../../types/NvbloxMessages";

type Point3D = { x: number; y: number; z: number };
type Color = { r: number; g: number; b: number; a: number };

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
): { points: Point3D[]; bytesRead: number } {
  const numFloats = count * 3;
  const byteLen = numFloats * 4;
  const shuffled = buffer.subarray(offset, offset + byteLen);
  const unshuffled = byteUnshuffle(shuffled, numFloats, 4);
  const floats = new Float32Array(unshuffled.buffer, unshuffled.byteOffset, numFloats);

  const points: Point3D[] = new Array(count);
  for (let i = 0; i < count; i++) {
    points[i] = { x: floats[i * 3]!, y: floats[i * 3 + 1]!, z: floats[i * 3 + 2]! };
  }
  return { points, bytesRead: byteLen };
}

function unpackColors(
  buffer: Uint8Array,
  offset: number,
  count: number,
): { colors: Color[]; bytesRead: number } {
  const byteLen = count * 4;
  const colors: Color[] = new Array(count);
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
  // Copy to aligned buffer for Int32Array view
  const aligned = new Uint8Array(byteLen);
  aligned.set(buffer.subarray(offset, offset + byteLen));
  const indices = new Int32Array(aligned.buffer, 0, count);
  deltaDecode(indices);
  return { triangles: Array.from(indices), bytesRead: byteLen };
}

export function decompressNvbloxMesh(compressed: CompressedNvbloxMesh): Mesh | undefined {
  if (compressed.format !== "qzstd_v1") {
    return undefined;
  }

  if (compressed.num_blocks === 0) {
    return {
      header: compressed.header,
      block_size_m: compressed.block_size_m,
      block_indices: compressed.block_indices,
      blocks: [],
      clear: compressed.clear,
    };
  }

  const decompressed = decompress(compressed.compressed_data);

  const blocks: MeshBlock[] = new Array(compressed.num_blocks);
  let offset = 0;

  for (let b = 0; b < compressed.num_blocks; b++) {
    const vertexCount = compressed.block_vertex_counts[b]!;
    const triangleCount = compressed.block_triangle_counts[b]!;
    const hasNormals = compressed.block_has_normals[b] === 1;
    const hasColors = compressed.block_has_colors[b] === 1;

    // Section 0: positions
    const posResult = unpackPositions(decompressed, offset, vertexCount);
    offset += posResult.bytesRead;

    // Section 1: normals (if present)
    let normals: Point3D[] = [];
    if (hasNormals) {
      const normResult = unpackPositions(decompressed, offset, vertexCount);
      normals = normResult.points;
      offset += normResult.bytesRead;
    }

    // Section 2: colors (if present)
    let colors: Color[] = [];
    if (hasColors) {
      const colorResult = unpackColors(decompressed, offset, vertexCount);
      colors = colorResult.colors;
      offset += colorResult.bytesRead;
    }

    // Section 3: triangle indices
    let triangles: number[] = [];
    if (triangleCount > 0) {
      const triResult = unpackTriangles(decompressed, offset, triangleCount);
      triangles = triResult.triangles;
      offset += triResult.bytesRead;
    }

    blocks[b] = { vertices: posResult.points, normals, colors, triangles };
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
    return undefined;
  }

  if (compressed.num_blocks === 0) {
    return {
      header: compressed.header,
      block_size_m: compressed.block_size_m,
      voxel_size_m: compressed.voxel_size_m,
      block_indices: compressed.block_indices,
      blocks: [],
      clear: compressed.clear,
      layer_type: compressed.layer_type,
    };
  }

  const decompressed = decompress(compressed.compressed_data);

  const blocks: VoxelBlock[] = new Array(compressed.num_blocks);
  let offset = 0;

  for (let b = 0; b < compressed.num_blocks; b++) {
    const voxelCount = compressed.block_voxel_counts[b]!;
    const hasColors = compressed.block_has_colors[b] === 1;

    // Section 0: centers
    const posResult = unpackPositions(decompressed, offset, voxelCount);
    offset += posResult.bytesRead;

    // Section 1: colors (if present)
    let colors: Color[] = [];
    if (hasColors) {
      const colorResult = unpackColors(decompressed, offset, voxelCount);
      colors = colorResult.colors;
      offset += colorResult.bytesRead;
    }

    blocks[b] = { centers: posResult.points, colors };
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
