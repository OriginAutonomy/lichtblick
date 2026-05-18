// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { CloudiniWasmModule, CompressedPointCloud, PointCloud } from "./types";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const CloudiniModule = require("./cloudini_wasm_single.js") as () => Promise<CloudiniWasmModule>;

let wasmModule: CloudiniWasmModule | undefined;
let wasmLoadingPromise: Promise<void> | undefined;

export function loadCloudiniWasm(): Promise<void> {
  if (!wasmLoadingPromise) {
    wasmLoadingPromise = CloudiniModule().then((module: CloudiniWasmModule) => {
      wasmModule = module;
    });
  }
  return wasmLoadingPromise;
}

export function convertCompressedPointCloud(cloud: CompressedPointCloud): PointCloud | undefined {
  if (!wasmModule) {
    void loadCloudiniWasm();
    return undefined;
  }

  const decodedMsg: PointCloud = {
    header: {
      frame_id: cloud.header.frame_id,
      stamp: cloud.header.stamp,
    },
    height: cloud.height,
    width: cloud.width,
    fields: cloud.fields,
    is_bigendian: false,
    point_step: cloud.point_step,
    row_step: cloud.point_step * cloud.width,
    is_dense: cloud.is_dense,
    data: new Uint8Array(),
  };

  if (cloud.width * cloud.height === 0) {
    return decodedMsg;
  }

  let inputDataPtr: number | undefined;
  let outputDataPtr: number | undefined;
  const data = cloud.compressed_data;

  try {
    const bufferSize = data.byteLength;

    if (wasmModule.HEAPU8) {
      const maxAllowedSize = wasmModule.HEAPU8.length / 4;
      if (bufferSize > maxAllowedSize) {
        throw new Error(`Message too large (${bufferSize} bytes > ${maxAllowedSize} bytes)`);
      }
    }

    inputDataPtr = wasmModule._malloc(bufferSize);
    if (!inputDataPtr) {
      throw new Error("Failed to allocate memory for input data");
    }

    const wasmInputView = new Uint8Array(wasmModule.HEAPU8.buffer, inputDataPtr, bufferSize);
    wasmInputView.set(data);

    const decompressedSize = cloud.height * cloud.width * cloud.point_step;

    outputDataPtr = wasmModule._malloc(decompressedSize);
    if (!outputDataPtr) {
      throw new Error("Failed to allocate memory for output data");
    }

    const actualSize = wasmModule._cldn_DecodeCompressedData(
      inputDataPtr,
      bufferSize,
      outputDataPtr,
    );
    if (actualSize === 0) {
      throw new Error("Decompression failed - function returned 0");
    }

    const decodedData = new Uint8Array(wasmModule.HEAPU8.buffer, outputDataPtr, actualSize);
    decodedMsg.data = new Uint8Array(decodedData);
  } finally {
    if (inputDataPtr) {
      wasmModule._free(inputDataPtr);
    }
    if (outputDataPtr) {
      wasmModule._free(outputDataPtr);
    }
  }

  return decodedMsg;
}
