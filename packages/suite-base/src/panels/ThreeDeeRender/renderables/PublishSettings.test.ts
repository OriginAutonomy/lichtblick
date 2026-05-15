// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { DEFAULT_PUBLISH_SETTINGS, PublishSettings } from "./PublishSettings";

describe("PublishSettings", () => {
  describe("DEFAULT_PUBLISH_SETTINGS", () => {
    it("defaults bridgeInitialPose to false", () => {
      expect(DEFAULT_PUBLISH_SETTINGS.bridgeInitialPose).toBe(false);
    });
  });

  describe("settingsNodes", () => {
    const createMockRenderer = (publishConfig = DEFAULT_PUBLISH_SETTINGS) => {
      const listeners = new Map<string, Set<(...args: any[]) => void>>();
      return {
        config: {
          publish: publishConfig,
        },
        updateConfig: jest.fn((fn: any) => {
          fn(mockRenderer.config);
        }),
        publishClickTool: {
          addEventListener: jest.fn((event: string, listener: (...args: any[]) => void) => {
            if (!listeners.has(event)) {
              listeners.set(event, new Set());
            }
            listeners.get(event)!.add(listener);
          }),
          removeEventListener: jest.fn(),
          publishClickType: "point",
          setPublishClickType: jest.fn(),
          stop: jest.fn(),
        },
        settings: {
          register: jest.fn(),
          unregister: jest.fn(),
          setNodesForKey: jest.fn(),
        },
        on: jest.fn(),
        off: jest.fn(),
      } as any;
      // Need to define mockRenderer before using it
    };

    let mockRenderer: ReturnType<typeof createMockRenderer>;

    beforeEach(() => {
      mockRenderer = createMockRenderer();
    });

    it("includes bridgeInitialPose toggle in settings", () => {
      const settings = new PublishSettings(mockRenderer as any);
      const nodes = settings.settingsNodes();

      const publishNode = nodes.find((n) => n.path[0] === "publish");
      expect(publishNode).toBeDefined();
      expect(publishNode!.node.fields!.bridgeInitialPose).toMatchObject({
        label: "Bridge initial pose to Android",
        input: "boolean",
        value: false,
      });
    });

    it("reflects bridgeInitialPose=true in settings when configured", () => {
      mockRenderer = createMockRenderer({
        ...DEFAULT_PUBLISH_SETTINGS,
        bridgeInitialPose: true,
      });
      const settings = new PublishSettings(mockRenderer as any);
      const nodes = settings.settingsNodes();

      const publishNode = nodes.find((n) => n.path[0] === "publish");
      expect(publishNode!.node.fields!.bridgeInitialPose).toMatchObject({
        value: true,
      });
    });

    it("handles bridgeInitialPose settings action", () => {
      const settings = new PublishSettings(mockRenderer as any);
      settings.handleSettingsAction({
        action: "update",
        payload: {
          path: ["publish", "bridgeInitialPose"],
          input: "boolean",
          value: true,
        },
      });

      expect(mockRenderer.updateConfig).toHaveBeenCalled();
    });
  });
});
