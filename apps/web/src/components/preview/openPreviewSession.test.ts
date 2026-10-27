import {
  DEFAULT_CLIENT_SETTINGS,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import * as browserDefaults from "~/browser/browserDefaults";
import { BrowserSettingsReadError, openUrlInPreview } from "~/browser/openFileInPreview";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { useRightPanelStore } from "~/rightPanelStore";
import {
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  resetPreviewStateForTests,
  setActivePreviewTab,
  consumePreviewReload,
  beginPreviewSessionClose,
} from "~/previewStateStore";

import { openPreviewSession } from "./openPreviewSession";

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};

const snapshot: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "tab-1",
  navStatus: {
    _tag: "Loading",
    url: "https://t3.chat/",
    title: "",
  },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-06-11T23:00:00.000Z",
};

beforeEach(() => {
  resetPreviewStateForTests();
  useRightPanelStore.setState({ byThreadKey: {}, threadPanelVisibilityByThreadKey: {} });
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openPreviewSession", () => {
  it.each(["session", "link"] as const)(
    "does not open a %s with unread settings and uses the saved profile on retry",
    async (entryPoint) => {
      const failure = new Error("Settings read failed");
      vi.spyOn(browserDefaults, "resolveBrowserDefaults").mockRejectedValueOnce(failure);
      const viewport = { _tag: "freeform", width: 1280, height: 720 } as const;
      __setClientSettingsForTests({
        ...DEFAULT_CLIENT_SETTINGS,
        browserDefaultViewport: viewport,
        browserDefaultProfileId: "work",
        browserProfiles: [{ id: "work", name: "Work", kind: "persistent" }],
      });
      const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
      const input = { openPreview, threadRef, url: "https://t3.chat/" };
      const open = entryPoint === "session" ? openPreviewSession : openUrlInPreview;

      const result = await open(input);

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(Cause.squash(result.cause)).toBeInstanceOf(BrowserSettingsReadError);
        expect(Cause.squash(result.cause)).toMatchObject({ cause: failure });
      }
      expect(openPreview).not.toHaveBeenCalled();
      expect(readThreadPreviewState(threadRef).snapshot).toBeNull();
      expect(readThreadPreviewState(threadRef).recentlySeenUrls).toEqual([]);

      await expect(open(input)).resolves.toMatchObject({ _tag: "Success" });
      expect(openPreview).toHaveBeenCalledExactlyOnceWith({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          url: input.url,
          viewport,
          profileId: "work",
        },
      });
    },
  );
});

describe("openUrlInPreview from a link", () => {
  it("focuses an existing matching tab instead of opening a duplicate", async () => {
    applyPreviewServerSnapshot(threadRef, snapshot);
    useRightPanelStore.getState().open(threadRef, "files");
    const openPreview = vi.fn(async () => AsyncResult.success({ ...snapshot, tabId: "duplicate" }));

    await openUrlInPreview({ threadRef, url: "https://t3.chat", openPreview });

    expect(openPreview).not.toHaveBeenCalled();
    expect(readThreadPreviewState(threadRef).activeTabId).toBe("tab-1");
    expect(Object.keys(readThreadPreviewState(threadRef).sessions)).toEqual(["tab-1"]);
    expect(consumePreviewReload(threadRef, "tab-1")).toBe(true);
    expect(consumePreviewReload(threadRef, "tab-1")).toBe(false);
  });

  it("coalesces simultaneous foreground opens of the same URL", async () => {
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
    await Promise.all([
      openUrlInPreview({ threadRef, url: "https://t3.chat/", openPreview }),
      openUrlInPreview({ threadRef, url: "https://t3.chat/", openPreview }),
    ]);
    expect(openPreview).toHaveBeenCalledTimes(1);
  });

  it.each([
    { url: "https://t3.chat/?page=2" },
    { url: "https://t3.chat/#comment-2" },
    { profileId: "work" },
    { runtime: "server" as const },
  ])("keeps different URLs, profiles, and runtimes separate: %j", async (different) => {
    applyPreviewServerSnapshot(threadRef, {
      ...snapshot,
      ...(different.url
        ? { navStatus: { _tag: "Success", title: "Other", url: different.url } }
        : {}),
      ...(different.profileId ? { profileId: different.profileId } : {}),
      ...(different.runtime ? { runtime: different.runtime } : {}),
    });
    const openPreview = vi.fn(async () => AsyncResult.success({ ...snapshot, tabId: "new" }));
    await openUrlInPreview({ threadRef, url: "https://t3.chat/", openPreview });
    expect(openPreview).toHaveBeenCalledOnce();
  });

  it("does not reuse a tab closed by this client", async () => {
    applyPreviewServerSnapshot(threadRef, snapshot);
    beginPreviewSessionClose(threadRef, snapshot.tabId);
    const openPreview = vi.fn(async () => AsyncResult.success({ ...snapshot, tabId: "new" }));
    await openUrlInPreview({ threadRef, url: "https://t3.chat/", openPreview });
    expect(openPreview).toHaveBeenCalledOnce();
  });

  it("does not reuse tabs in another thread or change explicit new-tab behavior", async () => {
    applyPreviewServerSnapshot(
      { ...threadRef, threadId: "other" as ScopedThreadRef["threadId"] },
      snapshot,
    );
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));
    await openUrlInPreview({ threadRef, url: "https://t3.chat/", openPreview });
    await openPreviewSession({ threadRef, url: "https://t3.chat/", openPreview });
    await openUrlInPreview({
      threadRef,
      url: "https://t3.chat/",
      openPreview,
      reuseExisting: false,
    });
    expect(openPreview).toHaveBeenCalledTimes(3);
  });

  // regression: #16961 a background link open switched the active preview tab
  it("keeps the current tab active for a background open", async () => {
    applyPreviewServerSnapshot(threadRef, { ...snapshot, tabId: "tab-current" });

    await openUrlInPreview({
      openPreview: async () => AsyncResult.success(snapshot),
      threadRef,
      url: "https://t3.chat/",
      background: true,
    });

    const state = readThreadPreviewState(threadRef);
    expect(state.activeTabId).toBe("tab-current");
    expect(Object.keys(state.sessions).toSorted()).toEqual(["tab-1", "tab-current"]);
  });

  it("keeps a tab the user picked while a background open was in flight", async () => {
    applyPreviewServerSnapshot(threadRef, { ...snapshot, tabId: "tab-current" });
    applyPreviewServerSnapshot(threadRef, { ...snapshot, tabId: "tab-other" });
    setActivePreviewTab(threadRef, "tab-current");

    await openUrlInPreview({
      openPreview: async () => {
        applyPreviewServerSnapshot(threadRef, snapshot);
        setActivePreviewTab(threadRef, "tab-other");
        return AsyncResult.success(snapshot);
      },
      threadRef,
      url: "https://t3.chat/",
      background: true,
    });

    expect(readThreadPreviewState(threadRef).activeTabId).toBe("tab-other");
  });
});
