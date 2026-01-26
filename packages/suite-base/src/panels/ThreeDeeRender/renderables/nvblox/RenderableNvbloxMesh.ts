// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { toNanoSec } from "@lichtblick/rostime";
import { RosValue } from "@lichtblick/suite-base/players/types";
import { Mesh } from "@lichtblick/suite-base/types/NvbloxMessages";

import type { LayerSettingsNvblox } from "./NvbloxExtension";
import type { IRenderer } from "../../IRenderer";
import { BaseUserData, Renderable } from "../../Renderable";

export type NvbloxMeshUserData = BaseUserData & {
  topic: string;
  mesh: Mesh;
  originalMessage: Mesh;
  blockGroup: THREE.Group;
};

export class RenderableNvbloxMesh extends Renderable<NvbloxMeshUserData> {
  #blockGroup: THREE.Group;
  #blockMarkers = new Map<string, THREE.Mesh>();

  public constructor(
    topic: string,
    mesh: Mesh,
    receiveTime: bigint | undefined,
    settings: LayerSettingsNvblox,
    renderer: IRenderer,
  ) {
    const name = `nvblox-mesh-${topic}`;

    super(name, renderer, {
      receiveTime: receiveTime ?? 0n,
      messageTime: toNanoSec(mesh.header.stamp),
      frameId: renderer.normalizeFrameId(mesh.header.frame_id),
      pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      settingsPath: ["topics", topic],
      settings,
      topic,
      mesh,
      originalMessage: mesh,
      blockGroup: new THREE.Group(),
    });

    this.visible = settings.visible;
    this.#blockGroup = new THREE.Group();
    this.#blockGroup.name = "nvblox-mesh-blocks";
    this.add(this.#blockGroup);

    this.update(mesh, receiveTime);
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

  public update(mesh: Mesh, receiveTime: bigint | undefined): void {
    if (receiveTime != undefined) {
      this.userData.receiveTime = receiveTime;
    }
    this.userData.messageTime = toNanoSec(mesh.header.stamp);
    this.userData.frameId = this.renderer.normalizeFrameId(mesh.header.frame_id);
    this.userData.mesh = mesh;
    this.userData.originalMessage = mesh;

    // If clear flag is set, remove all existing blocks
    if (mesh.clear) {
      this.#clearAllBlocks();
    }

    this.#updateMeshBlocks(mesh);
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

  #updateMeshBlocks(mesh: Mesh): void {
    const settings = this.getSettings();
    if (settings?.visible === false) {
      return;
    }

    for (let i = 0; i < mesh.blocks.length; i++) {
      const block = mesh.blocks[i];
      const idx = mesh.block_indices[i];
      if (!idx || !block) {
        continue;
      }

      const blockId = `${idx.x}_${idx.y}_${idx.z}`;

      // If block is empty, remove it
      if (block.vertices.length === 0) {
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

      // Create or update the mesh block
      this.#createOrUpdateMeshBlock(blockId, block, idx, mesh.block_size_m);
    }
  }

  #createOrUpdateMeshBlock(
    blockId: string,
    block: Mesh["blocks"][0],
    _idx: { x: number; y: number; z: number },
    _blockSize: number,
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

    // Create geometry
    const geometry = new THREE.BufferGeometry();

    // Set vertices
    const vertices = new Float32Array(block.vertices.length * 3);
    for (let i = 0; i < block.vertices.length; i++) {
      const v = block.vertices[i]!;
      vertices[i * 3] = v.x;
      vertices[i * 3 + 1] = v.y;
      vertices[i * 3 + 2] = v.z;
    }
    const positionAttr = new THREE.BufferAttribute(vertices, 3);
    positionAttr.needsUpdate = true;
    geometry.setAttribute("position", positionAttr);

    // Set normals if available
    if (block.normals.length === block.vertices.length) {
      const normals = new Float32Array(block.normals.length * 3);
      for (let i = 0; i < block.normals.length; i++) {
        const n = block.normals[i]!;
        normals[i * 3] = n.x;
        normals[i * 3 + 1] = n.y;
        normals[i * 3 + 2] = n.z;
      }
      const normalAttr = new THREE.BufferAttribute(normals, 3);
      normalAttr.needsUpdate = true;
      geometry.setAttribute("normal", normalAttr);
    }

    // Set colors if available
    if (block.colors.length === block.vertices.length) {
      const colors = new Float32Array(block.colors.length * 3);
      for (let i = 0; i < block.colors.length; i++) {
        const c = block.colors[i]!;
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      const colorAttr = new THREE.BufferAttribute(colors, 3);
      colorAttr.needsUpdate = true;
      geometry.setAttribute("color", colorAttr);
    }

    // Set indices
    if (block.triangles.length > 0) {
      const indices = new Uint32Array(block.triangles);
      const indexAttr = new THREE.BufferAttribute(indices, 1);
      indexAttr.needsUpdate = true;
      geometry.setIndex(indexAttr);
    }

    if (block.normals.length === 0) {
      geometry.computeVertexNormals();
    }

    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: block.colors.length > 0,
      side: THREE.DoubleSide,
      flatShading: false,
    });
    material.needsUpdate = true;

    // Create mesh
    const meshObject = new THREE.Mesh(geometry, material);
    meshObject.name = `nvblox-mesh-block-${blockId}`;

    // No need to position the mesh - vertices are already in the correct world coordinates
    // The block origin is implicit in the vertex positions

    this.#blockGroup.add(meshObject);
    this.#blockMarkers.set(blockId, meshObject);
  }

  public override dispose(): void {
    this.#clearAllBlocks();
    super.dispose();
  }
}
