// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Ported from nvblox_foxglove extension (NVIDIA Isaac ROS nvblox)
// Converts nvblox_msgs/msg/Mesh and VoxelBlockLayer to foxglove.SceneUpdate

import type { Mesh, VoxelBlockLayer } from "../../types/NvbloxMessages";

type Color = { r: number; g: number; b: number; a: number };
type Duration = { sec: number; nsec: number };

type Pose = {
  position: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
};

type CubePrimitive = {
  pose: Pose;
  size: { x: number; y: number; z: number };
  color: Color;
};

type TrianglePrimitive = {
  pose: Pose;
  points: { x: number; y: number; z: number }[];
  colors: Color[];
  color: Color;
  indices: number[];
};

type SceneEntity = {
  timestamp: { sec: number; nsec: number };
  frame_id: string;
  id: string;
  lifetime: Duration;
  frame_locked: boolean;
  metadata: unknown[];
  arrows: unknown[];
  cubes: CubePrimitive[];
  cylinders: unknown[];
  lines: unknown[];
  triangles: TrianglePrimitive[];
  texts: unknown[];
  models: unknown[];
  spheres: unknown[];
};

type SceneEntityDeletion = {
  timestamp: { sec: number; nsec: number };
  type: number;
  id: string;
};

type SceneUpdate = {
  deletions: SceneEntityDeletion[];
  entities: SceneEntity[];
};

const BLOCK_LIFETIME: Duration = { sec: 10, nsec: 0 };
const IDENTITY_ORIENTATION = { x: 0, y: 0, z: 0, w: 1 };
const ZERO_POSITION = { x: 0, y: 0, z: 0 };
const DEFAULT_POSE: Pose = { position: ZERO_POSITION, orientation: IDENTITY_ORIENTATION };
const DEFAULT_COLOR: Color = { r: 1, g: 0, b: 0, a: 1 };
// SceneEntityDeletionType.MATCHING_ID = 1
const DELETION_MATCHING_ID = 1;

export function convertVoxelBlockLayer(layer: VoxelBlockLayer): SceneUpdate {
  const entities: SceneEntity[] = [];
  const deletions: SceneEntityDeletion[] = [];

  const voxel_size = layer.voxel_size_m;

  for (let i_block = 0; i_block < layer.blocks.length; ++i_block) {
    const block = layer.blocks[i_block];
    const idx = layer.block_indices[i_block];
    if (!idx || !block) {
      continue;
    }
    const id_string = `${layer.layer_type}_${idx.x}_${idx.y}_${idx.z}`;
    if (block.centers.length === 0) {
      deletions.push({
        timestamp: layer.header.stamp,
        type: DELETION_MATCHING_ID,
        id: id_string,
      });
    } else {
      const voxel_cubes: CubePrimitive[] = [];
      for (let i_voxel = 0; i_voxel < block.centers.length; ++i_voxel) {
        const center = block.centers[i_voxel];
        const color = block.colors[i_voxel];
        if (center && color) {
          voxel_cubes.push({
            pose: {
              position: { x: center.x, y: center.y, z: center.z },
              orientation: IDENTITY_ORIENTATION,
            },
            size: { x: voxel_size, y: voxel_size, z: voxel_size },
            color: { r: color.r, g: color.g, b: color.b, a: 1 },
          });
        }
      }
      entities.push({
        timestamp: layer.header.stamp,
        frame_id: layer.header.frame_id,
        id: id_string,
        lifetime: BLOCK_LIFETIME,
        frame_locked: true,
        metadata: [],
        arrows: [],
        triangles: [],
        cylinders: [],
        lines: [],
        cubes: voxel_cubes,
        texts: [],
        models: [],
        spheres: [],
      });
    }
  }

  return { deletions, entities };
}

export function convertMesh(mesh: Mesh): SceneUpdate {
  const entities: SceneEntity[] = [];
  const deletions: SceneEntityDeletion[] = [];

  for (let i = 0; i < mesh.blocks.length; ++i) {
    const block = mesh.blocks[i];
    const idx = mesh.block_indices[i];
    if (!idx || !block) {
      continue;
    }
    const id_string = `${idx.x}_${idx.y}_${idx.z}`;
    if (block.vertices.length === 0) {
      deletions.push({
        timestamp: mesh.header.stamp,
        type: DELETION_MATCHING_ID,
        id: id_string,
      });
    } else {
      entities.push({
        timestamp: mesh.header.stamp,
        frame_id: mesh.header.frame_id,
        id: id_string,
        lifetime: BLOCK_LIFETIME,
        frame_locked: true,
        metadata: [],
        arrows: [],
        cubes: [],
        cylinders: [],
        lines: [],
        triangles: [
          {
            pose: DEFAULT_POSE,
            points: block.vertices,
            colors: block.colors,
            color: DEFAULT_COLOR,
            indices: block.triangles,
          },
        ],
        texts: [],
        models: [],
        spheres: [],
      });
    }
  }

  return { deletions, entities };
}
