import type { FileDiffMetadata } from "@pierre/diffs";
import type { PullRequestDiffSide } from "@t3tools/contracts";

/** Only rendered hunks can anchor comments; list others off-diff. */
export function isLineInFileDiff(
  file: FileDiffMetadata,
  side: PullRequestDiffSide,
  line: number,
): boolean {
  return file.hunks.some((hunk) =>
    side === "left"
      ? line >= hunk.deletionStart && line < hunk.deletionStart + hunk.deletionCount
      : line >= hunk.additionStart && line < hunk.additionStart + hunk.additionCount,
  );
}

export type DiffFoldOverride = "expanded" | "folded" | null;

export type FileFoldChoices = ReadonlyMap<string, boolean>;

// Explicit choices survive changing viewed defaults. Bulk also applies to files not yet loaded.
export function isFileDiffCollapsed(
  fileKey: string,
  foldOverride: DiffFoldOverride,
  choices: FileFoldChoices,
  defaultCollapsed: boolean,
): boolean {
  return (
    choices.get(fileKey) ?? (foldOverride === null ? defaultCollapsed : foldOverride === "folded")
  );
}

export function setFileDiffCollapsed(
  fileKey: string,
  collapsed: boolean,
  choices: FileFoldChoices,
): FileFoldChoices {
  return choices.get(fileKey) === collapsed ? choices : new Map(choices).set(fileKey, collapsed);
}

export function getFileViewedRange<T extends { readonly fileKey: string }>(
  files: ReadonlyArray<T>,
  fileKey: string,
  anchorFileKey: string | null,
): ReadonlyArray<T> {
  const index = files.findIndex((file) => file.fileKey === fileKey);
  if (index === -1) return [];
  const anchorIndex = files.findIndex((file) => file.fileKey === anchorFileKey);
  if (anchorIndex === -1) return files.slice(index, index + 1);
  return files.slice(Math.min(index, anchorIndex), Math.max(index, anchorIndex) + 1);
}
