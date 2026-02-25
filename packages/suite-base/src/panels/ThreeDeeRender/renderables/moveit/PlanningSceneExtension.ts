// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toNanoSec } from "@lichtblick/rostime";
import { SettingsTreeAction } from "@lichtblick/suite";
import { PlanningScene } from "@lichtblick/suite-base/types/MoveItMessages";

import type { IRenderer, AnyRendererSubscription } from "../../IRenderer";
import { SceneExtension, PartialMessageEvent } from "../../SceneExtension";
import { RenderablePlanningScene } from "./RenderablePlanningScene";
import { RenderableAttachedCollisionObject } from "./RenderableAttachedCollisionObject";
import { BaseSettings } from "../../settings";
import { SettingsTreeEntry } from "../../SettingsManager";
import { topicIsConvertibleToSchema } from "../../topicIsConvertibleToSchema";
import { AnyFrameId } from "../../transforms";
import { updatePose } from "../../updatePose";
import { missingTransformMessage, MISSING_TRANSFORM } from "../transforms";

export type LayerSettingsPlanningScene = BaseSettings & {
  showCollisionObjects: boolean;
  collisionObjectColor: string;
};

const DEFAULT_SETTINGS: LayerSettingsPlanningScene = {
  visible: true,
  frameLocked: false,
  showCollisionObjects: true,
  collisionObjectColor: "#ff0000",
};

// Schema types for PlanningScene messages
const PLANNING_SCENE_DATATYPES = new Set([
  "moveit_msgs/PlanningScene",
  "moveit_msgs/msg/PlanningScene", // ROS2 format
  "ros.moveit_msgs.PlanningScene", // protobuf format
]);

export type TopicPlanningScene = {
  topic: string;
  planningScene: RenderablePlanningScene | undefined;
  receiveTime: bigint | undefined;
};

export class PlanningSceneExtension extends SceneExtension<RenderablePlanningScene> {
  public static extensionId = "foxglove.PlanningScene";
  #topics = new Map<string, TopicPlanningScene>();
  // Separate map for attached collision objects (e.g., sander tool)
  // These need their own frameId (parent link frame) for correct positioning
  #attachedObjects = new Map<string, RenderableAttachedCollisionObject>();

  public constructor(renderer: IRenderer) {
    super("foxglove.PlanningScene", renderer);

    renderer.on("transformTreeUpdated", this.#handleTransformTreeUpdated);
    renderer.on("topicsChanged", this.#handleTopicsChanged);

    console.log("🔧 PlanningSceneExtension: Constructor called");
  }

  public override dispose(): void {
    this.renderer.off("transformTreeUpdated", this.#handleTransformTreeUpdated);
    this.renderer.off("topicsChanged", this.#handleTopicsChanged);

    for (const renderable of this.renderables.values()) {
      renderable.dispose();
    }
    this.renderables.clear();
    this.#topics.clear();

    // Clean up attached objects
    for (const attached of this.#attachedObjects.values()) {
      this.remove(attached);
      attached.dispose();
    }
    this.#attachedObjects.clear();

    super.dispose();
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    return this.#buildSettingsTree();
  }

  /**
   * Override startFrame to also update poses for attached collision objects,
   * which are tracked in a separate map from the main renderables.
   */
  public override startFrame(
    currentTime: bigint,
    renderFrameId: AnyFrameId,
    fixedFrameId: AnyFrameId,
  ): void {
    // Let the base class handle the main planning scene renderables
    super.startFrame(currentTime, renderFrameId, fixedFrameId);

    // Also update poses for attached collision objects (e.g., sander on flange)
    for (const attached of this.#attachedObjects.values()) {
      if (!attached.visible) {
        continue;
      }

      const frameLocked = attached.userData.settings.frameLocked ?? true;
      const srcTime = frameLocked ? currentTime : attached.userData.messageTime;
      const frameId = attached.userData.frameId;
      const path = attached.userData.settingsPath;

      const updated = updatePose(
        attached,
        this.renderer.transformTree,
        renderFrameId,
        fixedFrameId,
        frameId,
        currentTime,
        srcTime,
      );
      if (!updated) {
        const message = missingTransformMessage(renderFrameId, fixedFrameId, frameId);
        this.renderer.settings.errors.add(path, MISSING_TRANSFORM, message);
      } else {
        this.renderer.settings.errors.remove(path, MISSING_TRANSFORM);
      }
    }
  }

  #handleTransformTreeUpdated = (): void => {
    console.log("🔧 PlanningSceneExtension: Transform tree updated");
    // Transform tree updates are handled automatically by the renderer
  };

  #handleTopicsChanged = (): void => {
    console.log("🔧 PlanningSceneExtension: Topics changed");
    this.updateSettingsTree();
  };

  #handlePlanningScene = (messageEvent: PartialMessageEvent<unknown>): void => {
    const topic = messageEvent.topic;
    const planningScene = messageEvent.message as Partial<PlanningScene>;
    const receiveTime = toNanoSec(messageEvent.receiveTime);

    console.log(`🔧 PlanningSceneExtension: Received message on topic: ${topic}`);
    console.log(`🔧 Message keys:`, Object.keys(planningScene));
    console.log(`🔧 Collision objects count: ${planningScene.world?.collision_objects?.length ?? 0}`);
    console.log(`🔧 Attached collision objects count: ${planningScene.robot_state?.attached_collision_objects?.length ?? 0}`);
    console.log(`🔧 Is diff: ${planningScene.is_diff}`);
    console.log(`🔧 Robot state exists: ${!!planningScene.robot_state?.joint_state?.header}`);

    // Only process if we have the required fields
    if (!planningScene.name || !planningScene.robot_state?.joint_state?.header) {
      console.log(`❌ PlanningSceneExtension: Missing required fields - name: ${!!planningScene.name}, robot_state: ${!!planningScene.robot_state?.joint_state?.header}`);
      return;
    }

    console.log(`✅ PlanningSceneExtension: Processing valid message for topic: ${topic}`);

    let topicPlanningScene = this.#topics.get(topic);
    if (!topicPlanningScene) {
      topicPlanningScene = { topic, receiveTime: 0n, planningScene: undefined };
      this.#topics.set(topic, topicPlanningScene);
    }
    topicPlanningScene.receiveTime = receiveTime;

    // Force planning scene topics to always be visible and subscribed
    const topicConfig = this.renderer.config.topics[topic] as
      | Partial<LayerSettingsPlanningScene>
      | undefined;
    if (topicConfig?.visible !== true || topicConfig?.showCollisionObjects !== true) {
      this.saveSetting(["topics", topic, "visible"], true);
      this.saveSetting(["topics", topic, "showCollisionObjects"], true);
      this.updateSettingsTree();
    }

    // Handle main planning scene renderable (world collision objects)
    let renderable = this.renderables.get(topic);
    if (!renderable) {
      console.log(`🔧 PlanningSceneExtension: Creating new renderable for topic: ${topic}`);
      renderable = new RenderablePlanningScene(
        topic,
        planningScene as PlanningScene,
        receiveTime,
        this.renderer,
      );
      this.add(renderable);
      this.renderables.set(topic, renderable);
      console.log(`🔧 PlanningSceneExtension: Renderable created and added to scene`);
    } else {
      console.log(`🔧 PlanningSceneExtension: Updating existing renderable for topic: ${topic}`);
      renderable.update(planningScene as PlanningScene, receiveTime);
    }

    // Handle attached collision objects (e.g., sander tool on flange)
    this.#updateAttachedCollisionObjects(topic, planningScene as PlanningScene, receiveTime);
  };

  /**
   * Process attached_collision_objects from robot_state.
   * Creates/updates separate renderables for each attached object,
   * each positioned in the correct parent link frame (e.g., "flange").
   */
  #updateAttachedCollisionObjects(
    topic: string,
    planningScene: PlanningScene,
    receiveTime: bigint,
  ): void {
    const attachedObjects = planningScene.robot_state.attached_collision_objects ?? [];

    // Track which attached object IDs are in the current message
    const currentIds = new Set<string>();

    for (const attachedObj of attachedObjects) {
      if (!attachedObj.object?.id || !attachedObj.link_name) {
        continue;
      }

      const objectId = attachedObj.object.id;
      const key = `${topic}::attached::${objectId}`;
      currentIds.add(key);

      const existing = this.#attachedObjects.get(key);
      if (existing) {
        existing.updateAttachedObject(attachedObj, receiveTime);
      } else {
        const attached = new RenderableAttachedCollisionObject(
          topic,
          attachedObj,
          receiveTime,
          this.renderer,
        );
        this.add(attached);
        this.#attachedObjects.set(key, attached);
        console.log(
          `PlanningSceneExtension: Created attached object "${objectId}" in frame "${attachedObj.link_name}"`,
        );
      }
    }

    // Remove attached objects that are no longer present (only for non-diff updates)
    if (!planningScene.is_diff) {
      for (const [key, attached] of this.#attachedObjects) {
        if (key.startsWith(`${topic}::attached::`) && !currentIds.has(key)) {
          this.remove(attached);
          attached.dispose();
          this.#attachedObjects.delete(key);
          console.log(`PlanningSceneExtension: Removed detached object "${key}"`);
        }
      }
    }
  }

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [
      {
        type: "schema",
        schemaNames: PLANNING_SCENE_DATATYPES,
        subscription: { handler: this.#handlePlanningScene },
      },
    ];
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;
    console.log(`🔧 PlanningSceneExtension: Settings action received:`, action);
    console.log(`🔧 PlanningSceneExtension: Path:`, path);

    if (action.action !== "update" || path.length !== 3) {
      console.log(`🔧 PlanningSceneExtension: Invalid action or path length`);
      return;
    }

    if (path[0] !== "topics") {
      console.log(`🔧 PlanningSceneExtension: Path doesn't start with 'topics'`);
      return;
    }

    const topicName = path[1];
    const fieldName = path[2];
    if (!topicName || !fieldName) {
      console.log(`🔧 PlanningSceneExtension: Missing topic name or field name`);
      return;
    }

    console.log(`🔧 PlanningSceneExtension: Updating ${fieldName} for topic ${topicName} to:`, action.payload.value);

    this.saveSetting(path, action.payload.value);

    const renderable = this.renderables.get(topicName);
    if (renderable) {
      console.log(`🔧 PlanningSceneExtension: Found renderable for topic ${topicName}, updating...`);
      if (fieldName === "visible") {
        console.log(`🔧 PlanningSceneExtension: Setting visibility to:`, action.payload.value);
        if (action.payload.value === false) {
          renderable.forceClearAllObjects();

          for (const [key, attached] of this.#attachedObjects) {
            if (key.startsWith(`${topicName}::attached::`)) {
              attached.visible = false;
            }
          }
        } else {
          for (const [key, attached] of this.#attachedObjects) {
            if (key.startsWith(`${topicName}::attached::`)) {
              attached.visible = true;
            }
          }
        }

        renderable.updateVisibility();
      }

      if (fieldName === "showCollisionObjects" || fieldName === "collisionObjectColor") {
        console.log(`🔧 PlanningSceneExtension: Updating collision object settings...`);
        renderable.update(renderable.userData.planningScene, renderable.userData.receiveTime);
      }
    } else {
      console.log(`🔧 PlanningSceneExtension: No renderable found for topic ${topicName}`);
    }

    this.updateSettingsTree();
  };

  #buildSettingsTree(): SettingsTreeEntry[] {
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];

    console.log("🔧 PlanningSceneExtension: Building settings tree");
    console.log("🔧 Available topics:", this.renderer.topics?.map(t => ({ name: t.name, schemaName: t.schemaName, convertibleTo: t.convertibleTo })));
    console.log("🔧 Looking for schemas:", Array.from(PLANNING_SCENE_DATATYPES));

    for (const topic of this.renderer.topics ?? []) {
      console.log(`🔧 Checking topic: ${topic.name} with schema: ${topic.schemaName}`);
      console.log(`🔧 Topic convertibleTo:`, topic.convertibleTo);

      const isConvertible = topicIsConvertibleToSchema(topic, PLANNING_SCENE_DATATYPES);
      console.log(`🔧 Topic ${topic.name} is convertible: ${isConvertible}`);

      if (isConvertible) {
        console.log(`✅ Found matching topic: ${topic.name}`);
        const config = this.renderer.config.topics[topic.name] as
          | Partial<LayerSettingsPlanningScene>
          | undefined;

        const visible = config?.visible ?? DEFAULT_SETTINGS.visible;
        console.log(`🔧 Topic ${topic.name} visibility from config: ${visible}`);

        entries.push({
          path: ["topics", topic.name],
          node: {
            label: topic.name,
            icon: "Cube",
            order: topic.name.toLocaleLowerCase(),
            visible,
            handler,
            fields: {
              showCollisionObjects: {
                label: "Show Collision Objects",
                input: "boolean",
                value: config?.showCollisionObjects ?? DEFAULT_SETTINGS.showCollisionObjects,
              },
              collisionObjectColor: {
                label: "Collision Object Color",
                input: "rgba",
                value: config?.collisionObjectColor ?? DEFAULT_SETTINGS.collisionObjectColor,
              },
            },
          },
        });
      }
    }

    console.log(`🔧 PlanningSceneExtension: Found ${entries.length} matching topics`);
    return entries;
  }
}
