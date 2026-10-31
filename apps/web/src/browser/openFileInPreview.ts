import type {
  AssetCreateUrlResult,
  AssetResource,
  EnvironmentId,
  PreviewOpenInput,
  PreviewSessionSnapshot,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { DEFAULT_BROWSER_PROFILE_ID } from "@t3tools/contracts";
import { normalizePreviewUrl } from "@t3tools/shared/preview";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { mediaFileReference } from "@t3tools/client-runtime/media-reference";
import {
  type AtomCommandResult,
  mapAtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import { AsyncResult } from "effect/reactivity";

import { resolveAssetUrl } from "~/assets/assetUrls";
import { isPreviewAvailableFor, previewRuntimeFor } from "~/browser/previewRuntime";
import {
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  rememberPreviewUrl,
  requestPreviewReload,
  setActivePreviewTab,
  updatePreviewServerSnapshot,
} from "~/previewStateStore";
import {
  rightPanelHostRef,
  selectSelectedRightPanelSurface,
  useRightPanelStore,
} from "~/rightPanelStore";

import { resolveBrowserDefaults } from "./browserDefaults";

export const isBrowserPreviewFile = (path: string): boolean =>
  /\.(?:html?|pdf)$/i.test(path.split(/[?#]/, 1)[0] ?? "");

export class BrowserPreviewUnavailableError extends Data.TaggedError(
  "BrowserPreviewUnavailableError",
)<{
  readonly message: string;
}> {}

export class BrowserSettingsReadError extends Data.TaggedError("BrowserSettingsReadError")<{
  readonly cause: unknown;
}> {
  override get message(): string {
    return "Saved browser settings could not be loaded.";
  }
}

export type OpenPreviewMutation<E = unknown> = (input: {
  readonly environmentId: EnvironmentId;
  readonly input: PreviewOpenInput;
}) => Promise<AtomCommandResult<PreviewSessionSnapshot, E>>;

const pendingLinkOpens = new Map<string, Promise<unknown>>();

function comparablePreviewUrl(url: string): string {
  try {
    return normalizePreviewUrl(url);
  } catch {
    return url;
  }
}

export async function openUrlInPreview<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly url: string;
  readonly openPreview: OpenPreviewMutation<E>;
  readonly profileId?: PreviewOpenInput["profileId"];
  readonly background?: boolean;
  readonly reuseExisting?: boolean;
}): Promise<AtomCommandResult<void, E | BrowserSettingsReadError>> {
  // Read before any await: a side chat pane that unmounts meanwhile drops its host mapping.
  const threadRef = rightPanelHostRef(input.threadRef);
  const defaults = await resolveBrowserDefaults().catch(
    (cause: unknown) => new BrowserSettingsReadError({ cause }),
  );
  if (defaults instanceof BrowserSettingsReadError) {
    return AsyncResult.failure(Cause.fail(defaults));
  }
  const runtime = previewRuntimeFor(threadRef.environmentId);
  const profileId = input.profileId ?? defaults.profileId;
  const url = comparablePreviewUrl(input.url);
  const open = async () => {
    const state = readThreadPreviewState(threadRef);
    const matches = (snapshot: PreviewSessionSnapshot) =>
      !state.suppressedTabIds.has(snapshot.tabId) &&
      (snapshot.profileId ?? DEFAULT_BROWSER_PROFILE_ID) === profileId &&
      (snapshot.runtime ?? "desktop") === (runtime ?? "desktop") &&
      snapshot.navStatus._tag !== "Idle" &&
      comparablePreviewUrl(snapshot.navStatus.url) === url;
    const active = state.activeTabId ? state.sessions[state.activeTabId] : undefined;
    const existing =
      input.background || input.reuseExisting === false
        ? undefined
        : active && matches(active)
          ? active
          : Object.values(state.sessions).find(matches);
    if (existing) {
      setActivePreviewTab(threadRef, existing.tabId);
      useRightPanelStore.getState().openBrowser(threadRef, existing.tabId);
      requestPreviewReload(threadRef, existing.tabId);
      rememberPreviewUrl(threadRef, input.url);
      return AsyncResult.success(undefined);
    }
    const previousActiveTabId = readThreadPreviewState(threadRef).activeTabId;
    // The server changes the active tab, not panel selection; selection changes come from the user.
    const selectedSurface = () =>
      selectSelectedRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef)?.id ??
      null;
    const surfaceBeforeOpen = selectedSurface();
    const result = await input.openPreview({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        url: input.url,
        viewport: defaults.viewport,
        profileId,
        ...(runtime === undefined ? {} : { runtime }),
      },
    });
    return mapAtomCommandResult(result, (snapshot) => {
      rememberPreviewUrl(threadRef, input.url);
      if (input.background) {
        updatePreviewServerSnapshot(threadRef, snapshot);
        // Restore focus unless the user picked a tab while opening this one.
        if (
          previousActiveTabId &&
          readThreadPreviewState(threadRef).activeTabId === snapshot.tabId &&
          selectedSurface() === surfaceBeforeOpen
        ) {
          setActivePreviewTab(threadRef, previousActiveTabId);
        }
        return;
      }
      applyPreviewServerSnapshot(threadRef, snapshot);
      useRightPanelStore.getState().openBrowser(threadRef, snapshot.tabId);
    });
  };
  if (input.background || input.reuseExisting === false) return open();
  const key = JSON.stringify([scopedThreadKey(threadRef), profileId, runtime ?? "desktop", url]);
  const pending = (pendingLinkOpens.get(key) ?? Promise.resolve()).then(open, open);
  pendingLinkOpens.set(key, pending);
  try {
    return await pending;
  } finally {
    if (pendingLinkOpens.get(key) === pending) pendingLinkOpens.delete(key);
  }
}

export async function openFileInPreview<AssetError, PreviewError>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly filePath: string;
  readonly workspaceRoot: string | undefined;
  readonly httpBaseUrl: string;
  readonly createAssetUrl: (input: {
    readonly environmentId: EnvironmentId;
    readonly input: { readonly resource: AssetResource };
  }) => Promise<AtomCommandResult<AssetCreateUrlResult, AssetError>>;
  readonly openPreview: OpenPreviewMutation<PreviewError>;
}): Promise<
  AtomCommandResult<
    void,
    AssetError | PreviewError | BrowserPreviewUnavailableError | BrowserSettingsReadError
  >
> {
  if (!isPreviewAvailableFor(input.threadRef.environmentId)) {
    return AsyncResult.failure(
      Cause.fail(
        new BrowserPreviewUnavailableError({
          message: "The integrated browser is unavailable in this runtime.",
        }),
      ),
    );
  }
  const hostRef = rightPanelHostRef(input.threadRef);
  const insideWorkspace =
    mediaFileReference(input.filePath, input.workspaceRoot).relativePath !== undefined;
  const assetResult = await input.createAssetUrl({
    environmentId: input.threadRef.environmentId,
    input: {
      resource: {
        _tag: insideWorkspace ? "workspace-file" : "media-file",
        threadId: input.threadRef.threadId,
        path: input.filePath,
      },
    },
  });
  if (assetResult._tag === "Failure") {
    return AsyncResult.failure(assetResult.cause);
  }
  const assetUrl = resolveAssetUrl(input.httpBaseUrl, assetResult.value.relativeUrl);
  if (assetUrl === null) {
    return AsyncResult.failure(
      Cause.die(new Error("The environment returned an invalid asset URL.")),
    );
  }
  return openUrlInPreview({
    threadRef: hostRef,
    url: assetUrl,
    openPreview: input.openPreview,
  });
}
