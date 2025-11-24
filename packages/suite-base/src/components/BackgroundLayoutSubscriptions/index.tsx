// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useEffect, useRef } from "react";

import { useMessagePipeline } from "@lichtblick/suite-base/components/MessagePipeline";
import { SubscribePayload } from "@lichtblick/suite-base/players/types";

const BACKGROUND_SUBSCRIBER_ID = "background-layout-subscriptions";

/**
 * Checks if the current player is a ROS player (Ros1Player or RosbridgePlayer).
 * ROS players are identified by their sourceId or profile.
 *
 * @param playerState - Current player state
 * @returns true if the player is a ROS player
 */
function isRosPlayer(playerState: {
  urlState?: { sourceId?: string };
  profile?: string;
}): boolean {
  const sourceId = playerState.urlState?.sourceId;
  const profile = playerState.profile;

  // Check by sourceId (from data source factory)
  if (sourceId === "ros1-socket" || sourceId === "rosbridge-websocket") {
    return true;
  }

  // Check by profile (ros1, ros2)
  if (profile === "ros1" || profile === "ros2") {
    return true;
  }

  return false;
}

export type BackgroundLayoutSubscriptionsProps = {
  /** Set of topic names to subscribe to from layout files */
  layoutTopics: ReadonlySet<string>;
};

/**
 * Component that creates background subscriptions to all topics defined in
 * Manual.json and Auto.json layouts when a ROS player connects.
 * These subscriptions have preload enabled so historical messages are available immediately.
 */
export function BackgroundLayoutSubscriptions({
  layoutTopics,
}: BackgroundLayoutSubscriptionsProps): React.JSX.Element {
  const playerState = useMessagePipeline(
    useCallback((ctx) => ctx.playerState, []),
  );

  const setSubscriptions = useMessagePipeline(
    useCallback((ctx) => ctx.setSubscriptions, []),
  );

  const sortedTopics = useMessagePipeline(
    useCallback((ctx) => ctx.sortedTopics, []),
  );

  // Track which topics we've subscribed to
  const subscribedTopicsRef = useRef<Set<string>>(new Set());

  // Check if player is present and is a ROS player
  const isPlayerPresent =
    playerState.presence === "PRESENT" || playerState.presence === "INITIALIZING";
  const isRos = isRosPlayer(playerState);

  // Create subscriptions when ROS player connects
  useEffect(() => {
    if (!isPlayerPresent || !isRos) {
      // Unsubscribe when player disconnects or is not ROS
      if (subscribedTopicsRef.current.size > 0) {
        setSubscriptions(BACKGROUND_SUBSCRIBER_ID, []);
        subscribedTopicsRef.current.clear();
      }
      return;
    }

    // Wait for topics to be available
    if (sortedTopics.length === 0) {
      return;
    }

    // Create a map of available topic names for quick lookup
    const availableTopicNames = new Set(sortedTopics.map((topic) => topic.name));

    // Filter layout topics to only include topics that are actually available
    const topicsToSubscribe: SubscribePayload[] = [];
    for (const topicName of layoutTopics) {
      if (availableTopicNames.has(topicName)) {
        topicsToSubscribe.push({
          topic: topicName,
          preloadType: "full",
        });
      }
    }

    // Only update subscriptions if they've changed
    const currentTopics = new Set(
      subscribedTopicsRef.current.size > 0
        ? Array.from(subscribedTopicsRef.current)
        : [],
    );
    const newTopics = new Set(topicsToSubscribe.map((sub) => sub.topic));

    if (
      currentTopics.size !== newTopics.size ||
      !Array.from(newTopics).every((topic) => currentTopics.has(topic))
    ) {
      setSubscriptions(BACKGROUND_SUBSCRIBER_ID, topicsToSubscribe);
      subscribedTopicsRef.current = newTopics;
    }
  }, [isPlayerPresent, isRos, sortedTopics, layoutTopics, setSubscriptions]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      setSubscriptions(BACKGROUND_SUBSCRIBER_ID, []);
      subscribedTopicsRef.current.clear();
    };
  }, [setSubscriptions]);

  return <></>;
}
