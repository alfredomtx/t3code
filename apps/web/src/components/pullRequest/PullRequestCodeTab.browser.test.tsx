import { RegistryContext } from "@effect/atom-react";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import {
  EnvironmentId,
  ProjectId,
  SourceControlProviderKind,
  type PullRequestDetailView,
  type PullRequestDiffResult,
  type PullRequestFilesViewedResult,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";

const { diffAtom, filesViewedAtom } = await vi.hoisted(async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const firstPage: PullRequestDiffResult = {
    patch: [
      "diff --git a/a.ts b/a.ts",
      "index 1111111..2222222 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "-before()",
      "+after()",
      "",
    ].join("\n"),
    truncated: false,
    nextCursor: null,
  };
  // An environment query whose refetch returns equal content hands back the previous value
  // itself, so a refresh publishes a new result around the very same page.
  return {
    diffAtom: Atom.make(() => AsyncResult.success(firstPage)),
    filesViewedAtom: Atom.make<AsyncResult.AsyncResult<PullRequestFilesViewedResult>>(
      AsyncResult.initial(),
    ),
  };
});

vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => vi.fn()) as never,
}));
vi.mock(import("~/state/pullRequests"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    pullRequestEnvironment: {
      ...actual.pullRequestEnvironment,
      diff: (() => diffAtom) as never,
      filesViewed: (() => filesViewedAtom) as never,
    },
  };
});

import { act, render } from "../../../test/render";
import PullRequestCodeTab from "./PullRequestCodeTab";
import { __setClientSettingsForTests, getClientSettings } from "~/hooks/useSettings";

const detail: PullRequestDetailView = {
  provider: SourceControlProviderKind.make("github"),
  projectId: ProjectId.make("project"),
  projectTitle: "Project",
  workspaceRoot: "/workspace",
  repository: "owner/repo",
  number: 1,
  title: "Test pull request",
  body: "",
  url: "https://github.com/owner/repo/pull/1",
  author: { login: "author", name: null, avatarUrl: null },
  viewer: "author",
  state: "open",
  isDraft: false,
  mergeability: "mergeable",
  additions: 1,
  deletions: 1,
  changedFiles: 1,
  headBranch: "feature",
  baseBranch: "main",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  mergedAt: null,
  closedAt: null,
  reviewers: [],
  labels: [],
  checks: [],
  comments: [],
  commentCount: 0,
  commentsTruncated: false,
  reviewThreads: [],
  commits: [],
  mergeCapabilities: { merge: false, squash: false, rebase: false },
  capabilities: {
    diff: true,
    viewedFiles: "host",
    comment: false,
    search: true,
    actions: [],
    mergeMethods: [],
    review: { inlineComment: false, reply: false, resolve: false, verdicts: [] },
    reviewers: { request: false, listCandidates: false },
    edit: { changeRequest: false, comment: false },
  },
  viewerPermissions: {
    actions: [],
    comment: false,
    resolve: false,
    verdicts: [],
    requestReviewers: false,
  },
};

function setup(viewed: PullRequestFilesViewedResult | null = null) {
  const stack = new DisposableStack();
  const settings = getClientSettings();
  __setClientSettingsForTests({ ...settings, diffFilesCollapsed: false });
  stack.defer(() => __setClientSettingsForTests(settings));
  const registry = stack.adopt(AtomRegistry.make(), (registry) => registry.dispose());
  registry.set(
    filesViewedAtom,
    viewed === null ? AsyncResult.initial() : AsyncResult.success(viewed),
  );
  return {
    registry,
    tab: (refreshToken: number) => (
      <RegistryContext.Provider value={registry}>{tab(refreshToken)}</RegistryContext.Provider>
    ),
    [Symbol.dispose]: () => stack.dispose(),
  };
}

const tab = (refreshToken: number) => (
  <PullRequestCodeTab
    scrollerRef={() => {}}
    environmentId={EnvironmentId.make("environment")}
    reference={detail}
    detail={detail}
    selectedCommitOid={null}
    onSelectedCommitChange={() => {}}
    onRefresh={() => {}}
    refreshToken={refreshToken}
  />
);

it("keeps the diff after a refresh that brings back the same page", async () => {
  using fixture = setup();
  const container = document.createElement("div");
  container.className = "flex h-[700px] w-[900px]";
  await using screen = await render(fixture.tab(0), { container });
  await expect.element(screen.getByText("1 file", { exact: true })).toBeVisible();

  await screen.rerender(fixture.tab(1));

  await expect
    .element(screen.getByText("This pull request has no file changes."))
    .not.toBeInTheDocument();
  await expect.element(screen.getByText("1 file", { exact: true })).toBeVisible();
});

it("starts a persisted viewed file checked and collapsed", async () => {
  using fixture = setup({ files: [{ path: "a.ts", state: "viewed" }], truncated: false });
  const container = document.createElement("div");
  container.className = "flex h-[700px] w-[900px]";
  await using screen = await render(fixture.tab(0), { container });

  await expect.element(screen.getByRole("checkbox", { name: "Viewed" })).toBeChecked();
  await expect
    .element(screen.getByRole("button", { name: "Expand diff", exact: true }))
    .toHaveAttribute("aria-expanded", "false");
});

it("preserves a manual expansion when viewed data arrives late", async () => {
  using fixture = setup();
  const container = document.createElement("div");
  container.className = "flex h-[700px] w-[900px]";
  await using screen = await render(fixture.tab(0), { container });

  await screen.getByRole("button", { name: "Collapse diff", exact: true }).click();
  await screen.getByRole("button", { name: "Expand diff", exact: true }).click();
  await act(() =>
    fixture.registry.set(
      filesViewedAtom,
      AsyncResult.success({
        files: [{ path: "a.ts", state: "viewed" }],
        truncated: false,
      }),
    ),
  );

  await expect.element(screen.getByRole("checkbox", { name: "Viewed" })).toBeChecked();
  await expect
    .element(screen.getByRole("button", { name: "Collapse diff", exact: true }))
    .toHaveAttribute("aria-expanded", "true");
});
