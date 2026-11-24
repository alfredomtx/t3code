import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { fileManagerActionForPath, shouldShowOpenInPicker } from "./OpenInPicker.logic";

const environmentId = EnvironmentId.make("saved-local-service");
const target = new BearerConnectionTarget({
  environmentId,
  label: "Mac",
  connectionId: "saved-service",
});

describe("parent editor picker visibility", () => {
  it("shows a selected saved local service without a primary backend", () => {
    expect(
      shouldShowOpenInPicker({
        hasOpenTarget: true,
        target,
        remoteOpenMode: "local-exec",
      }),
    ).toBe(true);
  });

  it("preserves desktop-managed secondary suppression", () => {
    expect(
      shouldShowOpenInPicker({
        hasOpenTarget: true,
        target: new BearerConnectionTarget({ ...target, connectionId: "local:wsl:Ubuntu" }),
        remoteOpenMode: "local-exec",
      }),
    ).toBe(false);
  });

  it("keeps primary, remote and unavailable pickers visible", () => {
    expect(
      shouldShowOpenInPicker({
        hasOpenTarget: true,
        target: new PrimaryConnectionTarget({
          environmentId,
          label: "Mac",
          httpBaseUrl: "http://localhost",
          wsBaseUrl: "ws://localhost",
        }),
        remoteOpenMode: "local-exec",
      }),
    ).toBe(true);
    for (const remoteOpenMode of ["remote-links", "remote-unavailable"] as const) {
      expect(
        shouldShowOpenInPicker({
          hasOpenTarget: true,
          target: new RelayConnectionTarget({ environmentId, label: "Remote" }),
          remoteOpenMode,
        }),
      ).toBe(true);
    }
  });

  it("hides the picker while its selected environment is unresolved", () => {
    expect(
      shouldShowOpenInPicker({
        hasOpenTarget: true,
        target: null,
        remoteOpenMode: "local-exec",
      }),
    ).toBe(false);
  });

  it("hides the picker without a project or file path", () => {
    expect(
      shouldShowOpenInPicker({
        hasOpenTarget: false,
        target,
        remoteOpenMode: "local-exec",
      }),
    ).toBe(false);
  });
});

describe("shouldShowOpenInPicker", () => {
  it("shows both local environments when the primary has a separate WSL home", () => {
    const primaryEnvironmentId = EnvironmentId.make("wsl");
    const hostEnvironmentId = EnvironmentId.make("host");
    for (const [activeThreadEnvironmentId, visible] of [
      [primaryEnvironmentId, true],
      [hostEnvironmentId, true],
      [EnvironmentId.make("other"), false],
    ] as const) {
      expect(
        shouldShowOpenInPicker({
          hasOpenTarget: true,
          target: new BearerConnectionTarget({
            environmentId: activeThreadEnvironmentId,
            label: "Local",
            connectionId: "local:wsl:Ubuntu",
          }),
          primaryEnvironmentId,
          hostEnvironmentId,
          remoteOpenMode: "local-exec",
        }),
      ).toBe(visible);
    }
  });
});

describe("fileManagerActionForPath", () => {
  it("opens only folders and shows a file once its read settled on a server that can", () => {
    for (const [isFolder, isSettled, canReveal, action] of [
      [true, false, false, "open"],
      [false, false, true, "unavailable"],
      [false, true, false, "unavailable"],
      [false, true, true, "reveal"],
    ] as const) {
      expect(fileManagerActionForPath({ isFolder, isSettled, canReveal })).toBe(action);
    }
  });
});
