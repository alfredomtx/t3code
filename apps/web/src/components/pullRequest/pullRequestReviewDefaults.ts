import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { classifyChangedFile } from "@t3tools/shared/changedFileKind";
import * as Schema from "effect/Schema";

import { pullRequestReviewKey } from "./pullRequestReviewStore";

export const MarkdownReviewDefault = Schema.Literals(["collapsed", "autoViewed", "off"]);
export type MarkdownReviewDefault = typeof MarkdownReviewDefault.Type;
export const MARKDOWN_REVIEW_DEFAULT_KEY = "t3.pullRequests.reviewDefaults.markdown";
export const MarkdownAutoViewedOptOuts = Schema.Array(
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(4096)),
);

export function autoViewedOptOutStorageKey(
  environmentId: EnvironmentId,
  reference: PullRequestRef,
) {
  return `t3.pullRequests.reviewDefaults.optOuts:${JSON.stringify([environmentId, pullRequestReviewKey(reference)])}`;
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx)$/i.test(path);
}

export function selectTestPaths(paths: ReadonlySet<string>): ReadonlyArray<string> {
  return [...paths].filter((path) => classifyChangedFile(path) === "tests");
}

export function resolveDefaultCollapsed(input: {
  path: string;
  markdownDefault: MarkdownReviewDefault;
  globalCollapsed: boolean;
  viewed: boolean;
  viewedEnabled: boolean;
}): boolean {
  return (
    input.globalCollapsed ||
    (input.viewedEnabled && input.viewed) ||
    (input.markdownDefault === "collapsed" && isMarkdownPath(input.path))
  );
}
