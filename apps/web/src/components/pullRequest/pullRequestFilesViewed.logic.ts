import type { PullRequestFileViewedState, PullRequestFilesViewedResult } from "@t3tools/contracts";

export type FileViewedStates = ReadonlyMap<string, PullRequestFileViewedState>;

export type FileViewedOverlay = ReadonlyMap<string, boolean>;

export function toFileViewedStates(
  result: PullRequestFilesViewedResult | null,
): FileViewedStates | null {
  if (result === null) return null;
  return new Map(result.files.map((file) => [file.path, file.state]));
}

function isViewedState(state: PullRequestFileViewedState | undefined): boolean {
  return state === "viewed";
}

export function isStaleViewedState(state: PullRequestFileViewedState | undefined): boolean {
  return state === "dismissed";
}

export function isFileViewed(
  path: string,
  states: FileViewedStates | null,
  overlay: FileViewedOverlay,
): boolean {
  const pressed = overlay.get(path);
  return pressed ?? isViewedState(states?.get(path));
}

export function toFileViewedBatch(
  overlay: FileViewedOverlay,
): ReadonlyArray<{ readonly path: string; readonly viewed: boolean }> {
  return [...overlay].slice(0, 500).map(([path, viewed]) => ({ path, viewed }));
}
