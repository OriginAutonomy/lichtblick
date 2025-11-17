// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { AllowedFileExtensions } from "@lichtblick/suite-base/constants/allowedFileExtensions";
import {
  IDataSourceFactory,
  DataSourceFactoryInitializeArgs,
} from "@lichtblick/suite-base/context/PlayerSelectionContext";
import { IterablePlayer } from "@lichtblick/suite-base/players/IterablePlayer";
import { WorkerSerializedIterableSource } from "@lichtblick/suite-base/players/IterablePlayer/WorkerSerializedIterableSource";
import { Player } from "@lichtblick/suite-base/players/types";
import { RosbagYamlMetadata } from "@lichtblick/suite-base/util/parseRosbagYaml";
import { mergeMultipleFileNames } from "@lichtblick/suite-base/util/mergeMultipleFileName";
import { Time } from "@lichtblick/rostime";

import Log from "@lichtblick/log";

const log = Log.getLogger(__filename);

// Store file boundaries by player ID for navigation
const fileBoundariesByPlayerId = new Map<
  string,
  Array<{ startTime: Time; endTime: Time; fileName: string; index: number }>
>();

// Store metadata temporarily before player initialization
const pendingMetadata = new Map<string, { files?: RosbagYamlMetadata["files"] }>();

export function getFileBoundaries(playerId: string) {
  return fileBoundariesByPlayerId.get(playerId) ?? [];
}

export function clearFileBoundaries(playerId: string) {
  fileBoundariesByPlayerId.delete(playerId);
  pendingMetadata.delete(playerId);
}

export function setPendingMetadata(key: string, metadata: { files?: RosbagYamlMetadata["files"] }) {
  pendingMetadata.set(key, metadata);
}

export function getPendingMetadata(key: string) {
  return pendingMetadata.get(key);
}

/**
 * Data source factory for ROS2 bag YAML files that reference zstd-compressed MCAP files.
 * When a YAML file is opened, it parses the file list and loads all referenced .mcap.zstd files.
 */
class RosbagYamlDataSourceFactory implements IDataSourceFactory {
  public id = "rosbag-yaml-file";
  public type: IDataSourceFactory["type"] = "file";
  public displayName = "ROS2 Bag (YAML)";
  public iconName: IDataSourceFactory["iconName"] = "OpenFile";
  public supportedFileTypes = [AllowedFileExtensions.YAML];
  public supportsMultiFile = false;

  public initialize(args: DataSourceFactoryInitializeArgs): Player | undefined {
    const files = args.files;

    if (!files || files.length === 0) {
      return;
    }

    // Files should already be discovered and sorted by PlayerManager
    // We just need to create the player with the provided files
    try {
      // Create the source using ZstdMcapIterableSource worker
      const source = new WorkerSerializedIterableSource({
        initWorker: () => {
          return new Worker(
            // foxglove-depcheck-used: babel-plugin-transform-import-meta
            new URL(
              "@lichtblick/suite-base/players/IterablePlayer/Mcap/ZstdMcapIterableSourceWorker.worker",
              import.meta.url,
            ),
          );
        },
        initArgs: { files },
      });

      const player = new IterablePlayer({
        metricsCollector: args.metricsCollector,
        source,
        name: mergeMultipleFileNames(files.map((file) => file.name)),
        sourceId: this.id,
        readAheadDuration: { sec: 120, nsec: 0 },
      });

      // Get pending metadata and store file boundaries for navigation
      // Use a temporary key based on file names to match metadata
      const tempKey = files.map((f) => f.name).join("|");
      const metadata = getPendingMetadata(tempKey);
      if (metadata?.files && metadata.files.length > 0) {
        const boundaries = metadata.files.map((file, index) => {
          const startTime: Time = file.startingTime
            ? {
                sec: Math.floor(Number(file.startingTime.nanoseconds_since_epoch) / 1e9),
                nsec: Number(file.startingTime.nanoseconds_since_epoch) % 1e9,
              }
            : { sec: 0, nsec: 0 };
          const durationNs = file.duration ? Number(file.duration.nanoseconds) : 0;
          const endTime: Time = {
            sec: startTime.sec + Math.floor(durationNs / 1e9),
            nsec: startTime.nsec + (durationNs % 1e9),
          };
          // Normalize nsec
          if (endTime.nsec >= 1e9) {
            endTime.sec += Math.floor(endTime.nsec / 1e9);
            endTime.nsec %= 1e9;
          }

          return {
            startTime,
            endTime,
            fileName: file.path,
            index,
          };
        });
        // Store boundaries - we'll get the player ID after initialization
        player.setListener(async (state) => {
          if (state.playerId) {
            fileBoundariesByPlayerId.set(state.playerId, boundaries);
            pendingMetadata.delete(tempKey);
          }
        });
      }

      return player;
    } catch (error) {
      log.error("Failed to initialize ROS2 bag YAML data source", error);
      throw error;
    }
  }
}

export default RosbagYamlDataSourceFactory;
