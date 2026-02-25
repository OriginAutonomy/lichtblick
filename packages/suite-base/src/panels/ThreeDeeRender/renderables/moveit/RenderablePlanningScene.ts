// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";

import { toNanoSec } from "@lichtblick/rostime";
import { RosValue } from "@lichtblick/suite-base/players/types";
import {
  PlanningScene,
  CollisionObject,
  AttachedCollisionObject,
  Mesh as MoveItMesh,
} from "@lichtblick/suite-base/types/MoveItMessages";

import type { IRenderer } from "../../IRenderer";
import { BaseUserData, Renderable } from "../../Renderable";
import type { LayerSettingsPlanningScene } from "./PlanningSceneExtension";

export type PlanningSceneUserData = BaseUserData & {
  topic: string;
  planningScene: PlanningScene;
  originalPlanningScene: PlanningScene;
  collisionObjects: THREE.Group;
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
 * Parse a hex color string to {r, g, b, a} with values in [0, 1].
 */
function parseColor(color: string): { r: number; g: number; b: number; a: number } {
  const hex = color.startsWith("#") ? color.slice(1) : color;
  return {
    r: parseInt(hex.slice(0, 2), 16) / 255,
    g: parseInt(hex.slice(2, 4), 16) / 255,
    b: parseInt(hex.slice(4, 6), 16) / 255,
    a: hex.length > 6 ? parseInt(hex.slice(6, 8), 16) / 255 : 0.5,
  };
}

export class RenderablePlanningScene extends Renderable<PlanningSceneUserData> {
  #collisionObjects: THREE.Group;
  #markers: Map<string, THREE.Object3D> = new Map();
  #persistentCollisionObjects: Map<string, CollisionObject> = new Map();

  public constructor(
    topic: string,
    planningScene: PlanningScene,
    receiveTime: bigint | undefined,
    renderer: IRenderer,
  ) {
    const name = `planning-scene-${topic}`;

    super(name, renderer, {
      receiveTime: receiveTime ?? 0n,
      messageTime: toNanoSec(planningScene.robot_state.joint_state.header.stamp),
      frameId: renderer.normalizeFrameId(planningScene.robot_state.joint_state.header.frame_id),
      pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      settingsPath: ["topics", topic],
      settings: { visible: true, frameLocked: false },
      topic,
      planningScene,
      originalPlanningScene: planningScene,
      collisionObjects: new THREE.Group(),
    });

    this.#collisionObjects = new THREE.Group();
    this.#collisionObjects.name = "collision-objects";
    this.add(this.#collisionObjects);

    console.log(`PlanningScene: Created renderable in frame: ${this.userData.frameId}`);

    this.update(planningScene, receiveTime);
  }

  public override idFromMessage(): string | undefined {
    return this.userData.planningScene.name;
  }

  public override details(): Record<string, RosValue> {
    return this.userData.originalPlanningScene;
  }

  public getSettings(): LayerSettingsPlanningScene | undefined {
    return this.renderer.config.topics[this.userData.topic] as
      | LayerSettingsPlanningScene
      | undefined;
  }

  public update(planningScene: PlanningScene, receiveTime: bigint | undefined): void {
    if (receiveTime != undefined) {
      this.userData.receiveTime = receiveTime;
    }
    this.userData.messageTime = toNanoSec(planningScene.robot_state.joint_state.header.stamp);
    this.userData.frameId = this.renderer.normalizeFrameId(
      planningScene.robot_state.joint_state.header.frame_id,
    );
    this.userData.planningScene = planningScene;
    this.userData.originalPlanningScene = planningScene;

    this.#updateCollisionObjects(planningScene.world.collision_objects);
    this.#updateVisibility();
  }

  // REMOVED: Manual transform logic - Lichtblick handles this automatically via updatePose()
  // The SceneExtension.startFrame() method calls updatePose() for every renderable every frame
  // This automatically transforms from userData.frameId to renderFrameId via fixedFrameId

  public updateVisibility(): void {
    this.#updateVisibility();
  }

  public forceClearAllObjects(): void {
    this.#clearAllCollisionObjects();
    this.#persistentCollisionObjects.clear();
  }

  /**
   * Returns the list of attached collision objects from the current planning scene,
   * so the extension can create separate renderables for them in the correct frame.
   */
  public getAttachedCollisionObjects(): AttachedCollisionObject[] {
    return this.userData.planningScene.robot_state.attached_collision_objects ?? [];
  }

  #updateVisibility(): void {
    const settings = this.getSettings();
    const wasVisible = this.visible;
    const newVisible = settings?.visible ?? true;

    if (wasVisible && !newVisible) {
      console.log(`🗑️ TOPIC DISABLED - Clearing all collision objects for topic: ${this.userData.topic}`);
      console.log(`🗑️ Before clear - Markers: ${this.#markers.size}, Persistent: ${this.#persistentCollisionObjects.size}, Children: ${this.#collisionObjects.children.length}`);

      this.#clearAllCollisionObjects();
      this.#persistentCollisionObjects.clear();
    }

    this.visible = newVisible;
  }

  #updateCollisionObjects(collisionObjects: CollisionObject[]): void {
    const settings = this.getSettings();

    if (!this.visible) {
      this.#clearAllCollisionObjects();
      this.#persistentCollisionObjects.clear();
      return;
    }

    // PRINT THE WHOLE TOPIC DATA
    console.log("📊 COMPLETE TOPIC DATA:");
    console.log("📊 Planning Scene Data:", this.userData.planningScene);
    console.log("📊 Collision Objects Array:", collisionObjects);
    console.log("📊 User Data:", this.userData);
    console.log("📊 Settings:", settings);

    console.log("PlanningScene: Settings check - showCollisionObjects:", settings?.showCollisionObjects);
    console.log("PlanningScene: Settings check - visible:", settings?.visible);
    console.log("PlanningScene: Settings check - collisionObjectColor:", settings?.collisionObjectColor);

    // Ensure we have a default color
    const color = settings?.collisionObjectColor ?? "#ff0000";
    console.log("PlanningScene: Using collision object color:", color);

    if (!settings?.showCollisionObjects) {
      console.log("PlanningScene: Collision objects disabled in settings - this might be the issue!");
      console.log("PlanningScene: Current settings:", settings);
      // Don't return early - let's see what happens if we continue
      // return;
    }

    console.log(`PlanningScene: Processing ${collisionObjects.length} collision objects`);
    console.log(`PlanningScene: is_diff = ${this.userData.planningScene.is_diff}`);
    console.log(`PlanningScene: Persistent objects count = ${this.#persistentCollisionObjects.size}`);
    console.log(`PlanningScene: Current markers count = ${this.#markers.size}`);
    console.log(`PlanningScene: Planning scene frame: ${this.userData.frameId}`);

    // Show frame info for any collision objects in the current message
    for (const collisionObject of collisionObjects) {
      console.log(`PlanningScene: Collision object ${collisionObject.id} frame: ${collisionObject.header?.frame_id || 'undefined'}`);
    }

    // Show frame info for persistent objects
    console.log(`PlanningScene: Iterating through ${this.#persistentCollisionObjects.size} persistent objects`);
    for (const [objectId, persistentObject] of this.#persistentCollisionObjects) {
      console.log(`PlanningScene: Persistent object ${objectId}`);
      console.log(`PlanningScene: - Header:`, persistentObject.header);
      console.log(`PlanningScene: - Frame ID: ${persistentObject.header?.frame_id || 'undefined'}`);
      console.log(`PlanningScene: - Has primitive_poses: ${persistentObject.primitive_poses ? persistentObject.primitive_poses.length : 0}`);
      console.log(`PlanningScene: - Has mesh_poses: ${persistentObject.mesh_poses ? persistentObject.mesh_poses.length : 0}`);
    }

    // Handle differential updates vs complete scene updates
    const planningScene = this.userData.planningScene;
    if (planningScene.is_diff) {
      for (const collisionObject of collisionObjects) {
        this.#processCollisionObjectOperation(collisionObject, color);
      }

      // Re-render persistent objects that don't have markers
      if (collisionObjects.length === 0 && this.#persistentCollisionObjects.size > 0) {
        for (const [objectId, persistentObject] of this.#persistentCollisionObjects) {
          if (!this.#markers.has(objectId)) {
            this.#createCollisionObjectMarker(persistentObject, color);
          } else {
            // Force recreation to update pose
            this.#removeCollisionObjectMarker(objectId);
            this.#createCollisionObjectMarker(persistentObject, color);
          }
        }
      }
    } else {
      // Complete scene update
      this.#clearAllCollisionObjects();
      this.#persistentCollisionObjects.clear();

      for (const collisionObject of collisionObjects) {
        this.#persistentCollisionObjects.set(collisionObject.id, collisionObject);
        this.#createCollisionObjectMarker(collisionObject, color);
      }
    }
  }

  #processCollisionObjectOperation(collisionObject: CollisionObject, color: string): void {
    const operation = (collisionObject.operation as number) ?? 0;

    if (operation === 0) {
      // ADD
      this.#persistentCollisionObjects.set(collisionObject.id, collisionObject);
      this.#createCollisionObjectMarker(collisionObject, color);
    } else if (operation === 1) {
      // REMOVE
      this.#persistentCollisionObjects.delete(collisionObject.id);
      this.#removeCollisionObjectMarker(collisionObject.id);
    } else if (operation === 2) {
      // APPEND
      this.#persistentCollisionObjects.set(collisionObject.id, collisionObject);
      this.#createCollisionObjectMarker(collisionObject, color);
    } else if (operation === 3) {
      // MOVE
      this.#persistentCollisionObjects.set(collisionObject.id, collisionObject);
      this.#removeCollisionObjectMarker(collisionObject.id);
      this.#createCollisionObjectMarker(collisionObject, color);
    }
  }

  #clearAllCollisionObjects(): void {
    for (const [objectId] of this.#markers) {
      this.#removeCollisionObjectMarker(objectId);
    }
  }

  #removeCollisionObjectMarker(objectId: string): void {
    const existingMarker = this.#markers.get(objectId);
    if (existingMarker) {
      this.#collisionObjects.remove(existingMarker);
      // Dispose geometry and material
      existingMarker.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this.#markers.delete(objectId);
    }
  }

  #createCollisionObjectMarker(
    collisionObject: CollisionObject,
    color: string = "#ff0000",
  ): void {
    const objectId = collisionObject.id;

    // Don't create duplicate markers
    if (this.#markers.has(objectId)) {
      return;
    }

    // Determine pose: top-level pose > primitive_poses > mesh_poses > origin
    let pose = {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    };

    if (
      collisionObject.pose?.position &&
      collisionObject.pose?.orientation
    ) {
      pose = collisionObject.pose;
    } else if (
      collisionObject.primitive_poses &&
      collisionObject.primitive_poses.length > 0 &&
      collisionObject.primitive_poses[0]?.position
    ) {
      pose = collisionObject.primitive_poses[0]!;
    } else if (
      collisionObject.mesh_poses &&
      collisionObject.mesh_poses.length > 0 &&
      collisionObject.mesh_poses[0]?.position
    ) {
      pose = collisionObject.mesh_poses[0]!;
    }

    const { r, g, b, a } = parseColor(color);

    let threeMesh: THREE.Mesh;

    // Prefer mesh geometry if available (e.g., sander tool), fallback to box for primitives
    if (collisionObject.meshes && collisionObject.meshes.length > 0 && collisionObject.meshes[0]) {
      const moveitMesh = collisionObject.meshes[0];
      if (moveitMesh.vertices.length > 0 && moveitMesh.triangles.length > 0) {
        const geometry = createMeshGeometry(moveitMesh);
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(r, g, b),
          transparent: true,
          opacity: a,
          side: THREE.DoubleSide,
        });
        threeMesh = new THREE.Mesh(geometry, material);

        // If there's a mesh-specific pose, use it instead of the top-level pose
        if (
          collisionObject.mesh_poses &&
          collisionObject.mesh_poses.length > 0 &&
          collisionObject.mesh_poses[0]?.position
        ) {
          pose = collisionObject.mesh_poses[0]!;
        }

        console.log(
          `PlanningScene: Created mesh geometry for ${objectId} with ${moveitMesh.vertices.length} vertices, ${moveitMesh.triangles.length} triangles`,
        );
      } else {
        // Fallback to box if mesh data is empty
        const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(r, g, b),
          transparent: true,
          opacity: a,
        });
        threeMesh = new THREE.Mesh(geometry, material);
      }
    } else {
      // Use box geometry for primitive-based collision objects
      let scale = { x: 0.5, y: 0.5, z: 0.5 };
      if (
        collisionObject.primitives &&
        collisionObject.primitives.length > 0 &&
        collisionObject.primitives[0]
      ) {
        const primitive = collisionObject.primitives[0];
        if (primitive.dimensions && primitive.dimensions.length >= 3) {
          scale = {
            x: primitive.dimensions[0] ?? 0.5,
            y: primitive.dimensions[1] ?? 0.5,
            z: primitive.dimensions[2] ?? 0.5,
          };
        }
      }

      const geometry = new THREE.BoxGeometry(scale.x, scale.y, scale.z);
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(r, g, b),
        transparent: true,
        opacity: a,
      });
      threeMesh = new THREE.Mesh(geometry, material);
    }

    threeMesh.position.set(pose.position.x, pose.position.y, pose.position.z);
    threeMesh.quaternion.set(
      pose.orientation.x,
      pose.orientation.y,
      pose.orientation.z,
      pose.orientation.w,
    );
    threeMesh.name = `collision-object-${objectId}`;

    this.#collisionObjects.add(threeMesh);
    this.#markers.set(objectId, threeMesh);

    console.log(
      `PlanningScene: Created marker for ${objectId} at (${pose.position.x.toFixed(3)}, ${pose.position.y.toFixed(3)}, ${pose.position.z.toFixed(3)})`,
    );
  }

  public override dispose(): void {
    this.#collisionObjects.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => material.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    this.#collisionObjects.clear();
    this.#markers.clear();
  }
}
