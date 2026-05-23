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
import { SRGBToLinear } from "../../color";
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
    const vertexCount = block.vertices.length;
    const hasVertexColors = block.colors.length > 0 && block.colors.length === vertexCount;
    const hasNormals = block.normals.length === vertexCount;
    const indexCount = block.triangles.length;

    let meshObject = this.#blockMarkers.get(blockId);
    let geometry: THREE.BufferGeometry;
    let material: THREE.MeshPhongMaterial;

    const existingMaterial = meshObject?.material as THREE.MeshPhongMaterial | undefined;
    const materialCompatible =
      existingMaterial != undefined && existingMaterial.vertexColors === hasVertexColors;

    if (meshObject && materialCompatible) {
      geometry = meshObject.geometry;
      material = existingMaterial!;
    } else {
      if (meshObject) {
        this.#blockGroup.remove(meshObject);
        meshObject.geometry.dispose();
        (meshObject.material as THREE.Material).dispose();
      }
      geometry = new THREE.BufferGeometry();
      material = new THREE.MeshPhongMaterial({
        vertexColors: hasVertexColors,
        side: THREE.DoubleSide,
        flatShading: false,
        emissive: hasVertexColors ? 0x222222 : 0x888888,
        shininess: 30,
      });
      meshObject = new THREE.Mesh(geometry, material);
      meshObject.name = `nvblox-mesh-block-${blockId}`;
      this.#blockGroup.add(meshObject);
      this.#blockMarkers.set(blockId, meshObject);
    }

    const positionAttr = this.#ensureFloat32Attribute(geometry, "position", vertexCount, 3);
    const positions = positionAttr.array as Float32Array;
    for (let i = 0; i < vertexCount; i++) {
      const v = block.vertices[i]!;
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
    }
    positionAttr.needsUpdate = true;

    if (hasNormals) {
      const normalAttr = this.#ensureFloat32Attribute(geometry, "normal", vertexCount, 3);
      const normals = normalAttr.array as Float32Array;
      for (let i = 0; i < vertexCount; i++) {
        const n = block.normals[i]!;
        normals[i * 3] = n.x;
        normals[i * 3 + 1] = n.y;
        normals[i * 3 + 2] = n.z;
      }
      normalAttr.needsUpdate = true;
    } else if (geometry.getAttribute("normal")) {
      geometry.deleteAttribute("normal");
    }

    if (hasVertexColors) {
      const colorAttr = this.#ensureFloat32Attribute(geometry, "color", vertexCount, 3);
      const colors = colorAttr.array as Float32Array;
      for (let i = 0; i < vertexCount; i++) {
        const c = block.colors[i]!;
        colors[i * 3] = SRGBToLinear(c.r);
        colors[i * 3 + 1] = SRGBToLinear(c.g);
        colors[i * 3 + 2] = SRGBToLinear(c.b);
      }
      colorAttr.needsUpdate = true;
    } else if (geometry.getAttribute("color")) {
      geometry.deleteAttribute("color");
    }

    if (indexCount > 0) {
      const existingIndex = geometry.getIndex();
      let indexArray: Uint32Array;
      if (existingIndex && existingIndex.array.length === indexCount) {
        indexArray = existingIndex.array as Uint32Array;
        indexArray.set(block.triangles);
        existingIndex.needsUpdate = true;
      } else {
        indexArray = new Uint32Array(block.triangles);
        geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
      }
    } else if (geometry.getIndex()) {
      geometry.setIndex(null);
    }

    if (indexCount > 0) {
      geometry.setDrawRange(0, indexCount);
    } else {
      geometry.setDrawRange(0, vertexCount);
    }

    if (!hasNormals) {
      geometry.computeVertexNormals();
    }

    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
  }

  #ensureFloat32Attribute(
    geometry: THREE.BufferGeometry,
    name: string,
    count: number,
    itemSize: number,
  ): THREE.BufferAttribute {
    const existing = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (existing && existing.array.length === count * itemSize) {
      return existing;
    }
    const attr = new THREE.BufferAttribute(new Float32Array(count * itemSize), itemSize);
    geometry.setAttribute(name, attr);
    return attr;
  }

  public override dispose(): void {
    this.#clearAllBlocks();
    super.dispose();
  }
}
