// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

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
