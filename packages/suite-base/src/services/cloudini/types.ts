// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

export interface EmscriptenModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
  HEAP8: Int8Array;
  HEAPU16: Uint16Array;
  HEAP16: Int16Array;
  HEAPU32: Uint32Array;
  HEAP32: Int32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  ccall: (ident: string, returnType: string | null, argTypes: string[], args: unknown[]) => unknown;
  cwrap: (
    ident: string,
    returnType: string | null,
    argTypes: string[],
  ) => (...args: unknown[]) => unknown;
}

export interface CloudiniWasmModule extends EmscriptenModule {
  _cldn_ComputeCompressedSize(inputPtr: number, inputSize: number, resolution: number): number;
  _cldn_DecodeCompressedData(inputPtr: number, inputSize: number, outputPtr: number): number;
  _cldn_DecodeCompressedMessage(inputPtr: number, inputSize: number, outputPtr: number): number;
  _cldn_GetDecompressedSize(inputPtr: number, inputSize: number): number;
}

type Header = {
  stamp: { sec: number; nsec: number };
  frame_id: string;
};

type PointField = {
  name: string;
  offset: number;
  datatype: number;
  count: number;
};

export type CompressedPointCloud = {
  header: Header;
  height: number;
  width: number;
  fields: PointField[];
  is_bigendian: boolean;
  point_step: number;
  row_step: number;
  is_dense: boolean;
  compressed_data: Uint8Array;
  format: string;
};

export type PointCloud = {
  header: Header;
  height: number;
  width: number;
  fields: PointField[];
  is_bigendian: boolean;
  point_step: number;
  row_step: number;
  is_dense: boolean;
  data: Uint8Array;
};
