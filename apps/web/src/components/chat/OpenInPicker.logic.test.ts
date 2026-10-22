import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { shouldShowOpenInPicker } from "./OpenInPicker.logic";

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
        activeProjectName: "Project",
        target,
        remoteOpenMode: "local-exec",
      }),
    ).toBe(true);
  });

  it("preserves desktop-managed secondary suppression", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "Project",
        target: new BearerConnectionTarget({ ...target, connectionId: "local:wsl:Ubuntu" }),
        remoteOpenMode: "local-exec",
      }),
    ).toBe(false);
  });

  it("keeps primary, remote and unavailable pickers visible", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: "Project",
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
          activeProjectName: "Project",
          target: new RelayConnectionTarget({ environmentId, label: "Remote" }),
          remoteOpenMode,
        }),
      ).toBe(true);
    }
  });

  it("hides the picker without a project or file path", () => {
    expect(
      shouldShowOpenInPicker({
        activeProjectName: undefined,
        target,
        remoteOpenMode: "local-exec",
      }),
    ).toBe(false);
  });
});
