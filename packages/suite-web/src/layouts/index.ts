// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import Manual from "./Manual.json";
import Auto from "./Auto.json";

export const layouts: Record<string, unknown> = {
  "manual": Manual,
  "auto": Auto,
};

/**
 * Extracts all topic names from layout configuration files.
 * Iterates through all panel configs in configById and collects topic names
 * from the topics object in each panel config.
 *
 * @param layoutData - Layout data object with configById structure
 * @returns Set of unique topic names
 */
function extractTopicsFromLayout(layoutData: unknown): Set<string> {
  const topics = new Set<string>();

  if (!layoutData || typeof layoutData !== "object") {
    return topics;
  }

  const layout = layoutData as { configById?: Record<string, unknown> };
  const configById = layout.configById;

  if (!configById || typeof configById !== "object") {
    return topics;
  }

  // Iterate through all panel configs
  for (const panelConfig of Object.values(configById)) {
    if (!panelConfig || typeof panelConfig !== "object") {
      continue;
    }

    const config = panelConfig as { topics?: Record<string, unknown> };
    const panelTopics = config.topics;

    if (panelTopics && typeof panelTopics === "object") {
      // Extract all topic names (keys of the topics object)
      for (const topicName of Object.keys(panelTopics)) {
        if (typeof topicName === "string" && topicName.length > 0) {
          topics.add(topicName);
        }
      }
    }
  }

  return topics;
}

/**
 * Extracts all topic names from Manual.json and Auto.json layouts.
 * Returns a deduplicated set of topic names (union of both layouts).
 *
 * @returns Set of unique topic names from both layouts
 */
export function extractAllLayoutTopics(): Set<string> {
  const allTopics = new Set<string>();

  // Extract topics from Manual layout
  const manualTopics = extractTopicsFromLayout(Manual);
  for (const topic of manualTopics) {
    allTopics.add(topic);
  }

  // Extract topics from Auto layout
  const autoTopics = extractTopicsFromLayout(Auto);
  for (const topic of autoTopics) {
    allTopics.add(topic);
  }

  return allTopics;
}
