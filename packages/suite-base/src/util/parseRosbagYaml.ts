// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Log from "@lichtblick/log";

const log = Log.getLogger(__filename);

export interface RosbagYamlMetadata {
  relativeFilePaths: string[];
  files?: Array<{
    path: string;
    startingTime?: { nanoseconds_since_epoch: number | bigint };
    duration?: { nanoseconds: number | bigint };
    messageCount?: number;
  }>;
  compressionFormat?: string;
  compressionMode?: string;
}

/**
 * Parse ROS2 bag metadata YAML file and extract file paths and metadata.
 * @param yamlContent - The YAML file content as a string
 * @returns Parsed metadata including relative file paths
 */
export async function parseRosbagYaml(yamlContent: string): Promise<RosbagYamlMetadata> {
  try {
    // Dynamically import js-yaml
    const yaml = await import("js-yaml");
    const parsed = yaml.load(yamlContent) as {
      rosbag2_bagfile_information?: {
        relative_file_paths?: string[];
        files?: Array<{
          path: string;
          starting_time?: { nanoseconds_since_epoch: number | bigint };
          duration?: { nanoseconds: number | bigint };
          message_count?: number;
        }>;
        compression_format?: string;
        compression_mode?: string;
      };
    };

    if (!parsed.rosbag2_bagfile_information) {
      throw new Error("YAML does not contain rosbag2_bagfile_information");
    }

    const info = parsed.rosbag2_bagfile_information;

    if (!info.relative_file_paths || !Array.isArray(info.relative_file_paths)) {
      throw new Error("YAML does not contain relative_file_paths array");
    }

      return {
        relativeFilePaths: info.relative_file_paths,
        files: info.files?.map((file) => ({
          path: file.path,
          startingTime: file.starting_time
            ? {
                nanoseconds_since_epoch:
                  typeof file.starting_time.nanoseconds_since_epoch === "bigint"
                    ? Number(file.starting_time.nanoseconds_since_epoch)
                    : file.starting_time.nanoseconds_since_epoch,
              }
            : undefined,
          duration: file.duration
            ? {
                nanoseconds:
                  typeof file.duration.nanoseconds === "bigint"
                    ? Number(file.duration.nanoseconds)
                    : file.duration.nanoseconds,
              }
            : undefined,
          messageCount: file.message_count,
        })),
        compressionFormat: info.compression_format,
        compressionMode: info.compression_mode,
      };
  } catch (error) {
    log.error("Failed to parse ROS2 bag YAML", error);
    throw new Error(`Failed to parse ROS2 bag YAML: ${error}`);
  }
}
