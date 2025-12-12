// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { t } from "i18next";
import * as _ from "lodash-es";

import { SettingsTreeAction, SettingsTreeFields } from "@lichtblick/suite";

import type { IRenderer } from "../IRenderer";
import { DEFAULT_MESH_UP_AXIS } from "../ModelCache";
import { DEFAULT_MAX_CAPACITY_PER_FRAME, MAX_DURATION } from "../transforms";
import { SceneExtension } from "../SceneExtension";
import { SettingsTreeEntry } from "../SettingsManager";

export const DEFAULT_LABEL_SCALE_FACTOR = 1;

export class SceneSettings extends SceneExtension {
  public static extensionId = "foxglove.SceneSettings";
  public constructor(renderer: IRenderer, name: string = SceneSettings.extensionId) {
    super(name, renderer);

    renderer.labelPool.scaleFactor =
      renderer.config.scene.labelScaleFactor ?? DEFAULT_LABEL_SCALE_FACTOR;
  }

  public override dispose(): void {
    super.dispose();
  }

  public override settingsNodes(): SettingsTreeEntry[] {
    const config = this.renderer.config;
    const handler = this.handleSettingsAction;

    // Get transform cache statistics
    const cacheStats = this.renderer.transformTree.getCacheStats();
    const maxCapacityPerFrame =
      config.scene.transformCache?.maxCapacityPerFrame ?? DEFAULT_MAX_CAPACITY_PER_FRAME;
    const maxStorageTimeNs =
      config.scene.transformCache?.maxStorageTimeNs ?? MAX_DURATION;

    // Calculate total max capacity (per frame * number of frames)
    const totalMaxCapacity = maxCapacityPerFrame * cacheStats.frameCount;

    // Format max storage time for display (convert nanoseconds to seconds)
    const maxStorageTimeSec = Number(maxStorageTimeNs) / 1e9;
    const maxStorageTimeDisplay =
      maxStorageTimeNs === MAX_DURATION
        ? "Unlimited"
        : maxStorageTimeSec >= 3600
          ? `${(maxStorageTimeSec / 3600).toFixed(1)} hours`
          : maxStorageTimeSec >= 60
            ? `${(maxStorageTimeSec / 60).toFixed(1)} minutes`
            : `${maxStorageTimeSec.toFixed(1)} seconds`;

    const fields: SettingsTreeFields = {
      enableStats: {
        label: t("threeDee:renderStats"),
        input: "boolean",
        value: config.scene.enableStats,
      },
      debugPicking: {
        label: t("threeDee:debugPicking"),
        input: "boolean",
        value: this.renderer.debugPicking,
      },
      backgroundColor: {
        label: t("threeDee:background"),
        input: "rgb",
        value: config.scene.backgroundColor,
      },
      labelScaleFactor: {
        label: t("threeDee:labelScale"),
        help: t("threeDee:labelScaleHelp"),
        input: "number",
        min: 0,
        step: 0.1,
        precision: 2,
        value: config.scene.labelScaleFactor,
        placeholder: String(DEFAULT_LABEL_SCALE_FACTOR),
      },
      ignoreColladaUpAxis: {
        label: t("threeDee:ignoreColladaUpAxis"),
        help: t("threeDee:ignoreColladaUpAxisHelp"),
        input: "boolean",
        value: config.scene.ignoreColladaUpAxis,
        error:
          (config.scene.ignoreColladaUpAxis ?? false) !==
          this.renderer.modelCache.options.ignoreColladaUpAxis
            ? t("threeDee:takeEffectAfterReboot")
            : undefined,
      },
      meshUpAxis: {
        label: t("threeDee:meshUpAxis"),
        help: t("threeDee:meshUpAxisHelp"),
        input: "select",
        value: config.scene.meshUpAxis ?? DEFAULT_MESH_UP_AXIS,
        options: [
          { label: t("threeDee:YUp"), value: "y_up" },
          { label: t("threeDee:ZUp"), value: "z_up" },
        ],
        error:
          (config.scene.meshUpAxis ?? DEFAULT_MESH_UP_AXIS) !==
          this.renderer.modelCache.options.meshUpAxis
            ? t("threeDee:takeEffectAfterReboot")
            : undefined,
      },
      // Transform cache monitoring
      transformCacheTotal: {
        label: "Transform Cache: Total Transforms",
        input: "string",
        value: `${cacheStats.totalTransforms.toLocaleString()} / ${totalMaxCapacity.toLocaleString()} (${cacheStats.frameCount} frames)`,
        readonly: true,
        help: `Total number of transforms cached across all ${cacheStats.frameCount} frames. Maximum capacity: ${maxCapacityPerFrame.toLocaleString()} per frame.`,
      },
      transformCacheFramesAtCapacity: {
        label: "Transform Cache: Frames at Capacity",
        input: "string",
        value: `${cacheStats.framesAtCapacity} / ${cacheStats.frameCount}`,
        readonly: true,
        help: `Number of frames that have reached their maximum capacity. Old transforms will be automatically evicted when capacity is reached.`,
      },
      transformCacheMaxCapacity: {
        label: "Transform Cache: Max Capacity Per Frame",
        input: "number",
        value: maxCapacityPerFrame,
        min: 100,
        max: 100000,
        step: 1000,
        placeholder: String(DEFAULT_MAX_CAPACITY_PER_FRAME),
        help: `Maximum number of transforms to cache per coordinate frame. Higher values use more memory but allow longer transform history. Default: ${DEFAULT_MAX_CAPACITY_PER_FRAME.toLocaleString()}`,
      },
      transformCacheMaxStorageTime: {
        label: "Transform Cache: Max Storage Time (seconds)",
        input: "number",
        value: maxStorageTimeNs === MAX_DURATION ? undefined : Number(maxStorageTimeNs) / 1e9,
        min: 1,
        step: 1,
        precision: 0,
        placeholder: "Unlimited",
        help: `Maximum time span to cache transforms. Transforms older than this will be evicted. Set to empty/unlimited for no time limit. Current: ${maxStorageTimeDisplay}`,
      },
    };

    if (process.env.NODE_ENV === "production") {
      delete fields.debugPicking;
    }
    return [
      {
        path: ["scene"],
        node: {
          label: t("threeDee:scene"),
          actions: [{ type: "action", id: "reset-scene", label: t("threeDee:reset") }],
          fields,
          defaultExpansionState: "collapsed",
          handler,
        },
      },
    ];
  }

  public override handleSettingsAction = (action: SettingsTreeAction): void => {
    if (action.action === "perform-node-action" && action.payload.id === "reset-scene") {
      this.renderer.updateConfig((draft) => {
        draft.scene = {};
      });
      this.updateSettingsTree();
      return;
    }

    if (action.action !== "update" || action.payload.path.length === 0) {
      return;
    }

    const path = action.payload.path;
    const category = path[0]!;
    const value = action.payload.value;
    if (category === "scene") {
      if (path[1] === "debugPicking") {
        this.renderer.debugPicking = (value as boolean | undefined) ?? false;
        this.updateSettingsTree();
        return;
      }

      // Handle transform cache settings
      if (path[1] === "transformCacheMaxCapacity") {
        const maxCapacity = value as number | undefined;
        this.renderer.updateConfig((draft) => {
          if (!draft.scene.transformCache) {
            draft.scene.transformCache = {};
          }
          draft.scene.transformCache.maxCapacityPerFrame = maxCapacity;
        });
        this.updateSettingsTree();
        return;
      }

      if (path[1] === "transformCacheMaxStorageTime") {
        const maxStorageTimeSec = value as number | undefined;
        this.renderer.updateConfig((draft) => {
          if (!draft.scene.transformCache) {
            draft.scene.transformCache = {};
          }
          if (maxStorageTimeSec != null && maxStorageTimeSec > 0) {
            draft.scene.transformCache.maxStorageTimeNs = BigInt(Math.floor(maxStorageTimeSec * 1e9));
          } else {
            // Set to undefined to use MAX_DURATION (unlimited)
            draft.scene.transformCache.maxStorageTimeNs = undefined;
          }
        });
        this.updateSettingsTree();
        return;
      }

      // Update the configuration
      this.renderer.updateConfig((draft) => _.set(draft, path, value));

      if (path[1] === "backgroundColor") {
        const backgroundColor = value as string | undefined;
        this.renderer.setColorScheme(this.renderer.colorScheme, backgroundColor);
      } else if (path[1] === "labelScaleFactor") {
        const labelScaleFactor = value as number | undefined;
        this.renderer.labelPool.setScaleFactor(labelScaleFactor ?? DEFAULT_LABEL_SCALE_FACTOR);
      }
    } else {
      return;
    }

    // Update the settings sidebar
    this.updateSettingsTree();
  };
}
