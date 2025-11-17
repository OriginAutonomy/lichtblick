// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { McapTypes } from "@mcap/core";

import Log from "@lichtblick/log";

const log = Log.getLogger(__filename);

/**
 * Wrapper that decompresses a zstd-compressed blob and provides IReadable interface.
 * The entire file is decompressed on first access and cached in memory.
 */
export class ZstdBlobReadable implements McapTypes.IReadable {
  #compressedBlob: Blob;
  #decompressedBlob: Blob | undefined;
  #decompressionPromise: Promise<Blob> | undefined;

  public constructor(compressedBlob: Blob) {
    this.#compressedBlob = compressedBlob;
  }

  private async decompress(): Promise<Blob> {
    if (this.#decompressedBlob) {
      return this.#decompressedBlob;
    }

    if (this.#decompressionPromise) {
      return await this.#decompressionPromise;
    }

    this.#decompressionPromise = (async () => {
      try {
        // Load zstd decompression module
        const zstdModule = await import("@lichtblick/wasm-zstd");
        await zstdModule.isLoaded;

        // Read the compressed file
        const compressedData = new Uint8Array(await this.#compressedBlob.arrayBuffer());

        // Decompress the entire file
        // For file-level zstd compression, we need to decompress the entire file.
        // The wasm-zstd decompress function may require a size, but zstd frames often
        // contain the decompressed size in the header. We'll try decompressing with
        // a reasonable maximum size estimate (compressed size * 10 as a safe upper bound).
        // If that fails, we may need to use a different approach.
        const maxDecompressedSize = compressedData.length * 10;
        const decompressedData = zstdModule.decompress(compressedData, maxDecompressedSize);

        this.#decompressedBlob = new Blob([decompressedData]);
        return this.#decompressedBlob;
      } catch (error) {
        log.error("Failed to decompress zstd file", error);
        throw new Error(`Failed to decompress zstd file: ${error}`);
      }
    })();

    return await this.#decompressionPromise;
  }

  public async size(): Promise<bigint> {
    const decompressed = await this.decompress();
    return BigInt(decompressed.size);
  }

  public async read(offset: bigint, size: bigint): Promise<Uint8Array> {
    const decompressed = await this.decompress();
    const offsetNum = Number(offset);
    const sizeNum = Number(size);

    if (offsetNum + sizeNum > decompressed.size) {
      throw new Error(
        `Read of ${sizeNum} bytes at offset ${offsetNum} exceeds file size ${decompressed.size}`,
      );
    }

    return new Uint8Array(
      await decompressed.slice(offsetNum, offsetNum + sizeNum).arrayBuffer(),
    );
  }
}
