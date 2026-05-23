// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { RegisterMessageConverterArgs } from "@lichtblick/suite";

import { convertCompressedPointCloud, loadCloudiniWasm } from "./cloudiniConverter";
import type { CompressedPointCloud } from "./types";
import {
  decompressNvbloxMesh,
  decompressNvbloxVoxelBlockLayer,
} from "../nvblox-compression/nvbloxDecompressor";
import type {
  CompressedNvbloxMesh,
  CompressedNvbloxVoxelBlockLayer,
} from "../nvblox-compression/types";

void loadCloudiniWasm();

export const builtinMessageConverters: RegisterMessageConverterArgs<unknown>[] = [
  {
    fromSchemaName: "point_cloud_interfaces/msg/CompressedPointCloud2",
    toSchemaName: "sensor_msgs/msg/PointCloud2",
    converter: (inputMessage: unknown) => {
      return convertCompressedPointCloud(inputMessage as CompressedPointCloud);
    },
  },
  {
    fromSchemaName: "compressed_nvblox_msgs/msg/CompressedNvbloxMesh",
    toSchemaName: "nvblox_msgs/msg/Mesh",
    converter: (inputMessage: unknown) => {
      return decompressNvbloxMesh(inputMessage as CompressedNvbloxMesh);
    },
  },
  {
    fromSchemaName: "compressed_nvblox_msgs/msg/CompressedNvbloxVoxelBlockLayer",
    toSchemaName: "nvblox_msgs/msg/VoxelBlockLayer",
    converter: (inputMessage: unknown) => {
      return decompressNvbloxVoxelBlockLayer(
        inputMessage as CompressedNvbloxVoxelBlockLayer,
      );
    },
  },
];
