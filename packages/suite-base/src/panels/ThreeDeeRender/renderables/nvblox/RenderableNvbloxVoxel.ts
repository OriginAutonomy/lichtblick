// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { toNanoSec } from "@lichtblick/rostime";
import { RosValue } from "@lichtblick/suite-base/players/types";
import { VoxelBlockLayer } from "@lichtblick/suite-base/types/NvbloxMessages";

import type { LayerSettingsNvblox } from "./NvbloxExtension";
import { SRGBToLinear } from "../../color";
import type { IRenderer } from "../../IRenderer";
import { BaseUserData, Renderable } from "../../Renderable";

export type NvbloxVoxelUserData = BaseUserData & {
  topic: string;
  layer: VoxelBlockLayer;
  originalMessage: VoxelBlockLayer;
  blockGroup: THREE.Group;
};

export class RenderableNvbloxVoxel extends Renderable<NvbloxVoxelUserData> {
  #blockGroup: THREE.Group;
  #blockMarkers = new Map<string, THREE.InstancedMesh>();

  public constructor(
    topic: string,
    layer: VoxelBlockLayer,
    receiveTime: bigint | undefined,
    settings: LayerSettingsNvblox,
    renderer: IRenderer,
  ) {
    const name = `nvblox-voxel-${topic}`;

    super(name, renderer, {
      receiveTime: receiveTime ?? 0n,
      messageTime: toNanoSec(layer.header.stamp),
      frameId: renderer.normalizeFrameId(layer.header.frame_id),
      pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      settingsPath: ["topics", topic],
      settings,
      topic,
      layer,
      originalMessage: layer,
      blockGroup: new THREE.Group(),
    });

    this.visible = settings.visible;
    this.#blockGroup = new THREE.Group();
    this.#blockGroup.name = "nvblox-voxel-blocks";
    this.add(this.#blockGroup);

    this.update(layer, receiveTime);
  }

  public override idFromMessage(): string | undefined {
    return this.userData.topic;
  }

  public override details(): Record<string, RosValue> {
    return this.userData.originalMessage as unknown as Record<string, RosValue>;
  }

  public getSettings(): LayerSettingsNvblox | undefined {
    return this.renderer.config.topics[this.userData.topic] as LayerSettingsNvblox | undefined;
  }

  public update(layer: VoxelBlockLayer, receiveTime: bigint | undefined): void {
    if (receiveTime != undefined) {
      this.userData.receiveTime = receiveTime;
    }
    this.userData.messageTime = toNanoSec(layer.header.stamp);
    this.userData.frameId = this.renderer.normalizeFrameId(layer.header.frame_id);
    this.userData.layer = layer;
    this.userData.originalMessage = layer;

    // If clear flag is set, remove all existing blocks
    if (layer.clear) {
      this.#clearAllBlocks();
    }

    this.#updateVoxelBlocks(layer);
    this.#updateVisibility();
  }

  public updateVisibility(): void {
    const settings = this.getSettings();
    this.visible = settings?.visible ?? true;
  }

  #updateVisibility(): void {
    this.updateVisibility();
  }

  #clearAllBlocks(): void {
    for (const marker of this.#blockMarkers.values()) {
      this.#blockGroup.remove(marker);
      marker.geometry.dispose();
      if (Array.isArray(marker.material)) {
        marker.material.forEach((m) => {
          m.dispose();
        });
      } else {
        marker.material.dispose();
      }
    }
    this.#blockMarkers.clear();
  }

  #updateVoxelBlocks(layer: VoxelBlockLayer): void {
    const settings = this.getSettings();
    if (settings?.visible === false) {
      return;
    }

    const voxelSize = layer.voxel_size_m;

    for (let i = 0; i < layer.blocks.length; i++) {
      const block = layer.blocks[i];
      const idx = layer.block_indices[i];
      if (!idx || !block) {
        continue;
      }

      const blockId = `${layer.layer_type}_${idx.x}_${idx.y}_${idx.z}`;

      // If block is empty, remove it
      if (block.centers.length === 0) {
        const existingMarker = this.#blockMarkers.get(blockId);
        if (existingMarker) {
          this.#blockGroup.remove(existingMarker);
          existingMarker.geometry.dispose();
          if (Array.isArray(existingMarker.material)) {
            existingMarker.material.forEach((m) => {
              m.dispose();
            });
          } else {
            existingMarker.material.dispose();
          }
          this.#blockMarkers.delete(blockId);
        }
        continue;
      }

      // Create or update the voxel block
      this.#createOrUpdateVoxelBlock(blockId, block, idx, voxelSize);
    }
  }

  #createOrUpdateVoxelBlock(
    blockId: string,
    block: VoxelBlockLayer["blocks"][0],
    _idx: { x: number; y: number; z: number },
    voxelSize: number,
  ): void {
    // Remove existing marker if it exists
    const existingMarker = this.#blockMarkers.get(blockId);
    if (existingMarker) {
      this.#blockGroup.remove(existingMarker);
      existingMarker.geometry.dispose();
      if (Array.isArray(existingMarker.material)) {
        existingMarker.material.forEach((m) => {
          m.dispose();
        });
      } else {
        existingMarker.material.dispose();
      }
      this.#blockMarkers.delete(blockId);
    }

    const voxelCount = block.centers.length;
    if (voxelCount === 0) {
      return;
    }

    // Create instanced mesh for voxels
    const geometry = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);
    const material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      emissive: 0x222222,
      shininess: 30,
    });

    const instancedMesh = new THREE.InstancedMesh(geometry, material, voxelCount);
    instancedMesh.name = `nvblox-voxel-block-${blockId}`;

    // Set up matrices and colors for each voxel
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    for (let i = 0; i < voxelCount; i++) {
      const center = block.centers[i];
      const voxelColor = block.colors[i];

      if (center && voxelColor) {
        // Set position
        matrix.makeTranslation(center.x, center.y, center.z);
        instancedMesh.setMatrixAt(i, matrix);

        // Set color (convert sRGB → linear for Three.js rendering pipeline)
        color.setRGB(SRGBToLinear(voxelColor.r), SRGBToLinear(voxelColor.g), SRGBToLinear(voxelColor.b));
        instancedMesh.setColorAt(i, color);
      }
    }

    // Update instance matrix
    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) {
      instancedMesh.instanceColor.needsUpdate = true;
    }

    this.#blockGroup.add(instancedMesh);
    this.#blockMarkers.set(blockId, instancedMesh);
  }

  public override dispose(): void {
    this.#clearAllBlocks();
    super.dispose();
  }
}
