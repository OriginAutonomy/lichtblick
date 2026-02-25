// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { RosValue } from "@lichtblick/suite-base/players/types";
import {
  AttachedCollisionObject,
  CollisionObject,
  Mesh as MoveItMesh,
} from "@lichtblick/suite-base/types/MoveItMessages";

import type { IRenderer } from "../../IRenderer";
import { BaseUserData, Renderable } from "../../Renderable";

export type AttachedCollisionObjectUserData = BaseUserData & {
  topic: string;
  attachedObject: AttachedCollisionObject;
  linkName: string;
};

/**
 * Create a THREE.BufferGeometry from a MoveIt Mesh message (triangles + vertices).
 */
function createMeshGeometry(moveitMesh: MoveItMesh): THREE.BufferGeometry {
  const vertices = moveitMesh.vertices;
  const triangles = moveitMesh.triangles;

  const positions = new Float32Array(vertices.length * 3);
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i]!;
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  }

  const indices: number[] = [];
  for (const tri of triangles) {
    if (tri.vertex_indices.length >= 3) {
      indices.push(tri.vertex_indices[0]!, tri.vertex_indices[1]!, tri.vertex_indices[2]!);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * RenderableAttachedCollisionObject renders a MoveIt AttachedCollisionObject
 * (e.g., the sander tool attached to "flange") in the correct parent link frame.
 *
 * Each instance has its own frameId set to the parent link name, so Lichtblick's
 * transform system automatically positions it correctly via the TF tree.
 */
export class RenderableAttachedCollisionObject extends Renderable<AttachedCollisionObjectUserData> {
  #meshGroup: THREE.Group;

  public constructor(
    topic: string,
    attachedObject: AttachedCollisionObject,
    receiveTime: bigint,
    renderer: IRenderer,
  ) {
    const linkName = attachedObject.link_name;
    const objectId = attachedObject.object.id;
    const name = `attached-collision-${topic}-${objectId}`;

    // Determine the pose from the inner collision object
    const collisionObj = attachedObject.object;
    const pose = RenderableAttachedCollisionObject.#extractPose(collisionObj);

    super(name, renderer, {
      receiveTime,
      messageTime: receiveTime,
      frameId: renderer.normalizeFrameId(linkName),
      pose,
      settingsPath: ["topics", topic],
      settings: { visible: true, frameLocked: true },
      topic,
      attachedObject,
      linkName,
    });

    this.#meshGroup = new THREE.Group();
    this.#meshGroup.name = `attached-mesh-${objectId}`;
    this.add(this.#meshGroup);

    this.#buildMeshes(collisionObj, "#000000");

    console.log(
      `AttachedCollisionObject: Created "${objectId}" in frame "${linkName}" with pose (${pose.position.x.toFixed(3)}, ${pose.position.y.toFixed(3)}, ${pose.position.z.toFixed(3)})`,
    );
  }

  public override idFromMessage(): string | undefined {
    return this.userData.attachedObject.object.id;
  }

  public override details(): Record<string, RosValue> {
    return this.userData.attachedObject as unknown as Record<string, RosValue>;
  }

  public updateAttachedObject(
    attachedObject: AttachedCollisionObject,
    receiveTime: bigint,
  ): void {
    this.userData.receiveTime = receiveTime;
    this.userData.messageTime = receiveTime;
    this.userData.attachedObject = attachedObject;
    this.userData.linkName = attachedObject.link_name;
    this.userData.frameId = this.renderer.normalizeFrameId(attachedObject.link_name);

    const pose = RenderableAttachedCollisionObject.#extractPose(attachedObject.object);
    this.userData.pose = pose;

    // Rebuild meshes
    this.#clearMeshes();
    this.#buildMeshes(attachedObject.object, "#000000");
  }

  static #extractPose(collisionObj: CollisionObject) {
    if (collisionObj.pose?.position && collisionObj.pose?.orientation) {
      return collisionObj.pose;
    }
    if (
      collisionObj.mesh_poses &&
      collisionObj.mesh_poses.length > 0 &&
      collisionObj.mesh_poses[0]?.position
    ) {
      return collisionObj.mesh_poses[0]!;
    }
    if (
      collisionObj.primitive_poses &&
      collisionObj.primitive_poses.length > 0 &&
      collisionObj.primitive_poses[0]?.position
    ) {
      return collisionObj.primitive_poses[0]!;
    }
    return {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    };
  }

  #buildMeshes(collisionObj: CollisionObject, color: string): void {
    const hex = color.startsWith("#") ? color.slice(1) : color;
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;

    // Render mesh geometry (e.g., sander STL data)
    if (collisionObj.meshes && collisionObj.meshes.length > 0) {
      for (let i = 0; i < collisionObj.meshes.length; i++) {
        const moveitMesh = collisionObj.meshes[i];
        if (!moveitMesh || moveitMesh.vertices.length === 0 || moveitMesh.triangles.length === 0) {
          continue;
        }

        const geometry = createMeshGeometry(moveitMesh);
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(r, g, b),
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geometry, material);

        // Apply mesh-specific pose if available
        const meshPose = collisionObj.mesh_poses?.[i];
        if (meshPose?.position && meshPose?.orientation) {
          mesh.position.set(meshPose.position.x, meshPose.position.y, meshPose.position.z);
          mesh.quaternion.set(
            meshPose.orientation.x,
            meshPose.orientation.y,
            meshPose.orientation.z,
            meshPose.orientation.w,
          );
        }

        mesh.name = `mesh-${collisionObj.id}-${i}`;
        this.#meshGroup.add(mesh);

        console.log(
          `AttachedCollisionObject: Built mesh for "${collisionObj.id}" - ${moveitMesh.vertices.length} vertices, ${moveitMesh.triangles.length} triangles`,
        );
      }
    }

    // Also render primitives if present
    if (collisionObj.primitives && collisionObj.primitives.length > 0) {
      for (let i = 0; i < collisionObj.primitives.length; i++) {
        const primitive = collisionObj.primitives[i];
        if (!primitive?.dimensions || primitive.dimensions.length < 3) {
          continue;
        }

        const geometry = new THREE.BoxGeometry(
          primitive.dimensions[0] ?? 0.1,
          primitive.dimensions[1] ?? 0.1,
          primitive.dimensions[2] ?? 0.1,
        );
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(r, g, b),
          transparent: true,
          opacity: 0.7,
        });
        const mesh = new THREE.Mesh(geometry, material);

        const primPose = collisionObj.primitive_poses?.[i];
        if (primPose?.position && primPose?.orientation) {
          mesh.position.set(primPose.position.x, primPose.position.y, primPose.position.z);
          mesh.quaternion.set(
            primPose.orientation.x,
            primPose.orientation.y,
            primPose.orientation.z,
            primPose.orientation.w,
          );
        }

        mesh.name = `primitive-${collisionObj.id}-${i}`;
        this.#meshGroup.add(mesh);
      }
    }
  }

  #clearMeshes(): void {
    this.#meshGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    this.#meshGroup.clear();
  }

  public override dispose(): void {
    this.#clearMeshes();
    super.dispose();
  }
}
