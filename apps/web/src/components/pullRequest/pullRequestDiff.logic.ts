import type { FileDiffMetadata } from "@pierre/diffs";
import type { PullRequestDiffSide } from "@t3tools/contracts";

/**
 * A thread naming a file is not the same as a thread the diff can show: its line may have moved
 * out of the change, or sit in a hunk the host withheld. Pinning it anyway would put the remark
 * against whatever code now occupies that line number, and silently dropping it would lose the
 * conversation, so the answer decides which of the two lists it belongs in.
 */
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
