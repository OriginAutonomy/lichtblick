// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessageDefinition } from "@lichtblick/message-definition";

// Nvblox message definitions based on nvblox_msgs package
export const nvbloxMessageDefinitions: Record<string, MessageDefinition> = {
  "nvblox_msgs/msg/Mesh": {
    name: "nvblox_msgs/msg/Mesh",
    definitions: [
      { name: "header", type: "std_msgs/Header", isComplex: true, isArray: false },
      { name: "block_size_m", type: "float32", isComplex: false, isArray: false },
      { name: "block_indices", type: "nvblox_msgs/Index3D", isComplex: true, isArray: true },
      { name: "blocks", type: "nvblox_msgs/MeshBlock", isComplex: true, isArray: true },
      { name: "clear", type: "bool", isComplex: false, isArray: false },
    ],
  },

  "nvblox_msgs/Mesh": {
    name: "u_msgs/Mesh",
    definitions: [
      { name: "header", type: "std_msgs/Header", isComplex: true, isArray: false },
      { name: "block_size_m", type: "float32", isComplex: false, isArray: false },
      { name: "block_indices", type: "nvblox_msgs/Index3D", isComplex: true, isArray: true },
      { name: "blocks", type: "nvblox_msgs/MeshBlock", isComplex: true, isArray: true },
      { name: "clear", type: "bool", isComplex: false, isArray: false },
    ],
  },

  "nvblox_msgs/msg/VoxelBlockLayer": {
    name: "nvblox_msgs/msg/VoxelBlockLayer",
    definitions: [
      { name: "header", type: "std_msgs/Header", isComplex: true, isArray: false },
      { name: "block_size_m", type: "float32", isComplex: false, isArray: false },
      { name: "voxel_size_m", type: "float32", isComplex: false, isArray: false },
      { name: "block_indices", type: "nvblox_msgs/Index3D", isComplex: true, isArray: true },
      { name: "blocks", type: "nvblox_msgs/VoxelBlock", isComplex: true, isArray: true },
      { name: "clear", type: "bool", isComplex: false, isArray: false },
      { name: "layer_type", type: "int32", isComplex: false, isArray: false },
    ],
  },

  "nvblox_msgs/VoxelBlockLayer": {
    name: "nvblox_msgs/VoxelBlockLayer",
    definitions: [
      { name: "header", type: "std_msgs/Header", isComplex: true, isArray: false },
      { name: "block_size_m", type: "float32", isComplex: false, isArray: false },
      { name: "voxel_size_m", type: "float32", isComplex: false, isArray: false },
      { name: "block_indices", type: "nvblox_msgs/Index3D", isComplex: true, isArray: true },
      { name: "blocks", type: "nvblox_msgs/VoxelBlock", isComplex: true, isArray: true },
      { name: "clear", type: "bool", isComplex: false, isArray: false },
      { name: "layer_type", type: "int32", isComplex: false, isArray: false },
    ],
  },

  "nvblox_msgs/Index3D": {
    name: "nvblox_msgs/Index3D",
    definitions: [
      { name: "x", type: "int32", isComplex: false, isArray: false },
      { name: "y", type: "int32", isComplex: false, isArray: false },
      { name: "z", type: "int32", isComplex: false, isArray: false },
    ],
  },

  "nvblox_msgs/MeshBlock": {
    name: "nvblox_msgs/MeshBlock",
    definitions: [
      { name: "vertices", type: "geometry_msgs/Point32", isComplex: true, isArray: true },
      { name: "normals", type: "geometry_msgs/Point32", isComplex: true, isArray: true },
      { name: "colors", type: "std_msgs/ColorRGBA", isComplex: true, isArray: true },
      { name: "triangles", type: "int32", isComplex: false, isArray: true },
    ],
  },

  "nvblox_msgs/VoxelBlock": {
    name: "nvblox_msgs/VoxelBlock",
    definitions: [
      { name: "centers", type: "geometry_msgs/Point32", isComplex: true, isArray: true },
      { name: "colors", type: "std_msgs/ColorRGBA", isComplex: true, isArray: true },
    ],
  },

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
};
