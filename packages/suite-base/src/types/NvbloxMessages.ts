// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time } from "@lichtblick/rostime";

import { Color } from "./Messages";

// Nvblox message types based on nvblox_msgs package

export type Index3D = {
  x: number;
  y: number;
  z: number;
};

export type Point3D = {
  x: number;
  y: number;
  z: number;
};

export type Header = {
  stamp: Time;
  frame_id: string;
};

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

export type NvbloxMessages = {
  "nvblox_msgs/msg/Mesh": Mesh;
  "nvblox_msgs/Mesh": Mesh;
  "ros.nvblox_msgs.Mesh": Mesh;

  "nvblox_msgs/msg/VoxelBlockLayer": VoxelBlockLayer;
  "nvblox_msgs/VoxelBlockLayer": VoxelBlockLayer;
  "ros.nvblox_msgs.VoxelBlockLayer": VoxelBlockLayer;
};
