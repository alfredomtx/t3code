import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { resetPreviewStateForTests, readThreadPreviewState } from "~/previewStateStore";

import * as previewRuntime from "~/browser/previewRuntime";

import { openTerminalLinkInPreview } from "./openTerminalLinkInPreview";

const browserDefaultsMocks = vi.hoisted(() => ({
  resolve: vi.fn(),
}));

vi.mock("~/browser/browserDefaults", () => ({
  resolveBrowserDefaults: browserDefaultsMocks.resolve,
}));

const linkTargetMocks = vi.hoisted(() => ({
  preference: vi.fn<() => "system" | "app">(),
}));

vi.mock("~/browser/browserLinkTarget", () => ({
  resolveBrowserLinkTargetPreference: async () => linkTargetMocks.preference(),
  isWebUrl: (url: string) => /^https?:/u.test(url),
}));

const hydratedDefaults = {
  viewport: { _tag: "fixed", width: 1280, height: 720 } as const,
  profileId: "work",
};

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};

beforeEach(() => {
  resetPreviewStateForTests();
  vi.spyOn(previewRuntime, "isPreviewAvailableFor").mockReturnValue(true);
  browserDefaultsMocks.resolve.mockReset();
  browserDefaultsMocks.resolve.mockResolvedValue(hydratedDefaults);
  linkTargetMocks.preference.mockReturnValue("app");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openTerminalLinkInPreview", () => {
  it("does not report or fall back when opening the preview is interrupted", async () => {
    const fallbackToBrowser = vi.fn();
    const reportError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await openTerminalLinkInPreview({
      url: "http://localhost:5173/",
      threadRef,
      openPreview: async () => AsyncResult.failure(Cause.interrupt()),
      fallbackToBrowser,
      forceBrowser: false,
    });

    expect(reportError).not.toHaveBeenCalled();
    expect(fallbackToBrowser).not.toHaveBeenCalled();
  });
});

it("reuses and reloads normal terminal links, preserving forced external opens", async () => {
  const openPreview = vi.fn(async () =>
    AsyncResult.success({
      threadId: threadRef.threadId,
      tabId: "terminal-link",
      profileId: "work",
      navStatus: { _tag: "Success" as const, url: "https://example.com/", title: "Example" },
      canGoBack: false,
      canGoForward: false,
      updatedAt: "2026-10-26T00:00:00Z",
    }),
  );
  const fallbackToBrowser = vi.fn();
  const input = {
    url: "https://example.com/",
    threadRef,
    openPreview,
    fallbackToBrowser,
    forceBrowser: false,
  };
  await openTerminalLinkInPreview(input);
  await openTerminalLinkInPreview(input);
  expect(openPreview).toHaveBeenCalledOnce();
  expect(readThreadPreviewState(threadRef).pendingReloadTabIds.has("terminal-link")).toBe(true);
  await openTerminalLinkInPreview({ ...input, forceBrowser: true });
  expect(fallbackToBrowser).toHaveBeenCalledOnce();
  expect(openPreview).toHaveBeenCalledOnce();
});
