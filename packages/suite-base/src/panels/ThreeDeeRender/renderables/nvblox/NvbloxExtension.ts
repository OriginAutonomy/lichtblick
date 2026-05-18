// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toNanoSec } from "@lichtblick/rostime";
import { SettingsTreeAction, SettingsTreeFields } from "@lichtblick/suite";
import { Mesh, VoxelBlockLayer } from "@lichtblick/suite-base/types/NvbloxMessages";

import { RenderableNvbloxMesh } from "./RenderableNvbloxMesh";
import { RenderableNvbloxVoxel } from "./RenderableNvbloxVoxel";
import type { IRenderer, AnyRendererSubscription } from "../../IRenderer";
import { SceneExtension, PartialMessageEvent } from "../../SceneExtension";
import { SettingsTreeEntry } from "../../SettingsManager";
import { BaseSettings } from "../../settings";
import { topicIsConvertibleToSchema } from "../../topicIsConvertibleToSchema";
import { MISSING_TRANSFORM, missingTransformMessage } from "../transforms";
import { updatePose } from "../../updatePose";

export type LayerSettingsNvblox = BaseSettings & {
  showMesh: boolean;
  showVoxels: boolean;
};

const DEFAULT_SETTINGS: LayerSettingsNvblox = {
  visible: true,
  frameLocked: true,
  showMesh: true,
  showVoxels: true,
};

// Schema types for Nvblox messages
const NVBLOX_MESH_DATATYPES = new Set([
  "nvblox_msgs/msg/Mesh",
  "nvblox_msgs/Mesh",
  "ros.nvblox_msgs.Mesh",
]);

const NVBLOX_VOXEL_DATATYPES = new Set([
  "nvblox_msgs/msg/VoxelBlockLayer",
  "nvblox_msgs/VoxelBlockLayer",
  "ros.nvblox_msgs.VoxelBlockLayer",
]);

export type TopicNvbloxMesh = {
  topic: string;
  mesh: RenderableNvbloxMesh | undefined;
  receiveTime: bigint | undefined;
};

export type TopicNvbloxVoxel = {
  topic: string;
  voxel: RenderableNvbloxVoxel | undefined;
  receiveTime: bigint | undefined;
};

export class NvbloxExtension extends SceneExtension<RenderableNvbloxMesh | RenderableNvbloxVoxel> {
  public static extensionId = "foxglove.Nvblox";
  #meshTopics = new Map<string, TopicNvbloxMesh>();
  #voxelTopics = new Map<string, TopicNvbloxVoxel>();

  public constructor(renderer: IRenderer) {
    super("foxglove.Nvblox", renderer);

    renderer.on("topicsChanged", this.#handleTopicsChanged);
  }

  public override dispose(): void {
    this.renderer.off("topicsChanged", this.#handleTopicsChanged);

    // Clean up renderables
    for (const renderable of this.renderables.values()) {
      renderable.dispose();
    }
    this.renderables.clear();
    this.#meshTopics.clear();
    this.#voxelTopics.clear();

    super.dispose();
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    return this.#buildSettingsTree();
  }

  #handleTopicsChanged = (): void => {
    this.updateSettingsTree();
  };

  #handleMesh = (messageEvent: PartialMessageEvent<unknown>): void => {
    const topic = messageEvent.topic;
    const mesh = messageEvent.message as Partial<Mesh>;
    const receiveTime = toNanoSec(messageEvent.receiveTime);

    // Only process if we have the required fields
    if (!mesh.header || mesh.block_size_m == undefined) {
      return;
    }

    let topicMesh = this.#meshTopics.get(topic);
    if (!topicMesh) {
      topicMesh = { topic, receiveTime: 0n, mesh: undefined };
      this.#meshTopics.set(topic, topicMesh);
    }
    topicMesh.receiveTime = receiveTime;

    let renderable = this.renderables.get(topic) as RenderableNvbloxMesh | undefined;
    if (!renderable) {
      const userSettings = this.renderer.config.topics[topic] as
        | Partial<LayerSettingsNvblox>
        | undefined;
      const settings = { ...DEFAULT_SETTINGS, ...userSettings };
      renderable = new RenderableNvbloxMesh(
        topic,
        mesh as Mesh,
        receiveTime,
        settings,
        this.renderer,
      );
      this.add(renderable);
      this.renderables.set(topic, renderable);
    } else {
      renderable.update(mesh as Mesh, receiveTime);
    }
    this.updateSettingsTree();
  };

  #handleVoxelBlockLayer = (messageEvent: PartialMessageEvent<unknown>): void => {
    const topic = messageEvent.topic;
    const layer = messageEvent.message as Partial<VoxelBlockLayer>;
    const receiveTime = toNanoSec(messageEvent.receiveTime);

    // Only process if we have the required fields
    if (!layer.header || layer.block_size_m == undefined || layer.voxel_size_m == undefined) {
      return;
    }

    let topicVoxel = this.#voxelTopics.get(topic);
    if (!topicVoxel) {
      topicVoxel = { topic, receiveTime: 0n, voxel: undefined };
      this.#voxelTopics.set(topic, topicVoxel);
    }
    topicVoxel.receiveTime = receiveTime;

    let renderable = this.renderables.get(topic) as RenderableNvbloxVoxel | undefined;
    if (!renderable) {
      const userSettings = this.renderer.config.topics[topic] as
        | Partial<LayerSettingsNvblox>
        | undefined;
      const settings = { ...DEFAULT_SETTINGS, ...userSettings };
      renderable = new RenderableNvbloxVoxel(
        topic,
        layer as VoxelBlockLayer,
        receiveTime,
        settings,
        this.renderer,
      );
      this.add(renderable);
      this.renderables.set(topic, renderable);
    } else {
      renderable.update(layer as VoxelBlockLayer, receiveTime);
    }
    this.updateSettingsTree();
  };

  public override getSubscriptions(): readonly AnyRendererSubscription[] {
    return [
      {
        type: "schema",
        schemaNames: NVBLOX_MESH_DATATYPES,
        subscription: { handler: this.#handleMesh },
      },
      {
        type: "schema",
        schemaNames: NVBLOX_VOXEL_DATATYPES,
        subscription: { handler: this.#handleVoxelBlockLayer },
      },
    ];
  }

  public override startFrame(
    currentTime: bigint,
    renderFrameId: string,
    fixedFrameId: string,
  ): void {
    for (const renderable of this.renderables.values()) {
      const settingsVisible = renderable.userData.settings.visible;
      if (!settingsVisible) {
        renderable.visible = false;
        this.renderer.settings.errors.clearPath(renderable.userData.settingsPath);
        continue;
      }

      const frameId = renderable.userData.frameId;
      const frameLocked = renderable.userData.settings.frameLocked ?? true;
      const srcTime = frameLocked ? currentTime : renderable.userData.messageTime;

      const updated = updatePose(
        renderable,
        this.renderer.transformTree,
        renderFrameId,
        fixedFrameId,
        frameId,
        currentTime,
        srcTime,
      );

      renderable.visible = updated;
      if (!updated) {
        const message = missingTransformMessage(renderFrameId, fixedFrameId, frameId);
        this.renderer.settings.errors.add(
          renderable.userData.settingsPath,
          MISSING_TRANSFORM,
          message,
        );
      } else {
        this.renderer.settings.errors.remove(renderable.userData.settingsPath, MISSING_TRANSFORM);
      }
    }
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    const path = action.payload.path;

    if (action.action !== "update" || path.length !== 3) {
      return;
    }

    // Path should be ["topics", topicName, fieldName]
    if (path[0] !== "topics") {
      return;
    }

    const topicName = path[1];
    const fieldName = path[2];
    if (topicName == undefined || fieldName == undefined) {
      return;
    }

    // Update settings
    this.saveSetting(path, action.payload.value);

    // Update the renderable if it exists
    const renderable = this.renderables.get(topicName);
    if (renderable) {
      // Handle visibility changes
      if (fieldName === "visible") {
        renderable.updateVisibility();
      }
    }

    // Trigger settings update
    this.updateSettingsTree();
  };

  #buildSettingsTree(): SettingsTreeEntry[] {
    const handler = this.handleSettingsAction;
    const entries: SettingsTreeEntry[] = [];

    // Check all available topics for Nvblox messages
    for (const topic of this.renderer.topics ?? []) {
      const isMeshTopic = topicIsConvertibleToSchema(topic, NVBLOX_MESH_DATATYPES);
      const isVoxelTopic = topicIsConvertibleToSchema(topic, NVBLOX_VOXEL_DATATYPES);

      if (!isMeshTopic && !isVoxelTopic) {
        continue;
      }

      const config = (this.renderer.config.topics[topic.name] ??
        DEFAULT_SETTINGS) as Partial<LayerSettingsNvblox>;

      const fields: SettingsTreeFields = {
        frameLocked: {
          label: "Frame locked",
          input: "boolean",
          value: config.frameLocked ?? DEFAULT_SETTINGS.frameLocked,
        },
      };

      // Add mesh-specific or voxel-specific fields
      if (isMeshTopic) {
        fields.showMesh = {
          label: "Show mesh",
          input: "boolean",
          value: config.showMesh ?? DEFAULT_SETTINGS.showMesh,
        };
      } else if (isVoxelTopic) {
        fields.showVoxels = {
          label: "Show voxels",
          input: "boolean",
          value: config.showVoxels ?? DEFAULT_SETTINGS.showVoxels,
        };
      }

      entries.push({
        path: ["topics", topic.name],
        node: {
          label: topic.name,
          icon: "Cube",
          order: topic.name.toLocaleLowerCase(),
          visible: config.visible ?? DEFAULT_SETTINGS.visible,
          handler,
          fields,
        },
      });
    }

    return entries;
  }
}
