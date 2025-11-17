// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { McapIndexedReader, McapTypes } from "@mcap/core";

import Log from "@lichtblick/log";
import { loadDecompressHandlers } from "@lichtblick/mcap-support";
import { Time } from "@lichtblick/rostime";
import { MessageEvent } from "@lichtblick/suite-base/players/types";

import { McapIndexedIterableSource } from "./McapIndexedIterableSource";
import { McapUnindexedIterableSource } from "./McapUnindexedIterableSource";
import { ZstdBlobReadable } from "./ZstdBlobReadable";
import {
  IteratorResult,
  Initialization,
  MessageIteratorArgs,
  GetBackfillMessagesArgs,
  ISerializedIterableSource,
} from "../IIterableSource";

const log = Log.getLogger(__filename);

type ZstdMcapSource = { type: "file"; file: Blob };

/**
 * Create a McapIndexedReader if it will be possible to do an indexed read. If the file is not
 * indexed or is empty, returns undefined.
 */
async function tryCreateIndexedReader(readable: McapTypes.IReadable) {
  const decompressHandlers = await loadDecompressHandlers();
  try {
    const reader = await McapIndexedReader.Initialize({ readable, decompressHandlers });

    if (reader.chunkIndexes.length === 0 || reader.channelsById.size === 0) {
      return undefined;
    }
    return reader;
  } catch (err: unknown) {
    log.error(err);
    return undefined;
  }
}

/**
 * MCAP iterable source that handles zstd-compressed MCAP files.
 * The entire file is decompressed before being passed to the MCAP reader.
 */
export class ZstdMcapIterableSource implements ISerializedIterableSource {
  #source: ZstdMcapSource;
  #sourceImpl: ISerializedIterableSource | undefined;

  public readonly sourceType = "serialized";

  public constructor(source: ZstdMcapSource) {
    this.#source = source;
  }

  public async initialize(): Promise<Initialization> {
    const source = this.#source;

    if (source.type !== "file") {
      throw new Error("ZstdMcapIterableSource only supports file sources");
    }

    // Ensure the file is readable before proceeding
    await source.file.slice(0, 1).arrayBuffer();

    // Use ZstdBlobReadable to decompress the zstd-compressed file
    const readable = new ZstdBlobReadable(source.file);
    const reader = await tryCreateIndexedReader(readable);
    if (reader) {
      this.#sourceImpl = new McapIndexedIterableSource(reader);
    } else {
      // For unindexed files, we need to decompress first and then stream
      // Since we can't easily stream decompress, we'll decompress the entire file
      const decompressedSize = await readable.size();
      const decompressedData = await readable.read(0n, decompressedSize);
      // Create a new ArrayBuffer to avoid SharedArrayBuffer issues
      const buffer = new ArrayBuffer(decompressedData.byteLength);
      new Uint8Array(buffer).set(decompressedData);
      const decompressedBlob = new Blob([buffer]);
      this.#sourceImpl = new McapUnindexedIterableSource({
        size: Number(decompressedSize),
        stream: decompressedBlob.stream(),
      });
    }

    return await this.#sourceImpl.initialize();
  }

  public messageIterator(
    opt: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult<Uint8Array>>> {
    if (!this.#sourceImpl) {
      throw new Error("Invariant: uninitialized");
    }

    return this.#sourceImpl.messageIterator(opt);
  }

  public async getBackfillMessages(
    args: GetBackfillMessagesArgs,
  ): Promise<MessageEvent<Uint8Array>[]> {
    if (!this.#sourceImpl) {
      throw new Error("Invariant: uninitialized");
    }

    return await this.#sourceImpl.getBackfillMessages(args);
  }

  public getStart(): Time | undefined {
    return this.#sourceImpl!.getStart!();
  }
}
