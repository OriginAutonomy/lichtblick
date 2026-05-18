// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

export type Time = { sec: number; nsec: number };
export type Duration = { sec: number; nsec: number };
export type Header = { stamp: Time; frame_id: string };
export type Index3D = { x: number; y: number; z: number };
export type Point3D = { x: number; y: number; z: number };
export type Color = { r: number; g: number; b: number; a: number };

export type MeshBlock = {
  vertices: Point3D[];
  normals: Point3D[];
  colors: Color[];
  triangles: number[];
};

export type Mesh = {
  header: Header;
  block_size_m: number;
  block_indices: Index3D[];
  blocks: MeshBlock[];
  clear: boolean;
};

export type VoxelBlock = {
  centers: Point3D[];
  colors: Color[];
};

export type VoxelBlockLayer = {
  header: Header;
  block_size_m: number;
  voxel_size_m: number;
  block_indices: Index3D[];
  blocks: VoxelBlock[];
  clear: boolean;
  layer_type: number;
};
