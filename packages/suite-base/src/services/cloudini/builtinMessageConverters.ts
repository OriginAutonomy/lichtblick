// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { RegisterMessageConverterArgs } from "@lichtblick/suite";

import { convertCompressedPointCloud, loadCloudiniWasm } from "./cloudiniConverter";
import type { CompressedPointCloud } from "./types";

void loadCloudiniWasm();

export const builtinMessageConverters: RegisterMessageConverterArgs<unknown>[] = [
  {
    fromSchemaName: "point_cloud_interfaces/msg/CompressedPointCloud2",
    toSchemaName: "sensor_msgs/msg/PointCloud2",
    converter: (inputMessage: unknown): ReturnType<typeof convertCompressedPointCloud> => {
      return convertCompressedPointCloud(inputMessage as CompressedPointCloud);
    },
  },
];
