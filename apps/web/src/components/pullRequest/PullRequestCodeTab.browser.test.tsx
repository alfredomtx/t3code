import * as Cause from "effect/Cause";
import { RegistryContext } from "@effect/atom-react";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import {
  EnvironmentId,
  ProjectId,
  SourceControlProviderKind,
  type PullRequestDetailView,
  type PullRequestDiffResult,
  type PullRequestFilesViewedResult,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { setAppearanceMode } from "../../hooks/useTheme";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";

const {
  filePatch,
  firstDiffData,
  heldDiffRead,
  diffFailure,
  filesViewedState,
  diffAtom,
  diffPagesAtom,
  pageAtoms,
  firstPage,
  filesViewedAtom,
  command,
  permission,
  diffCommits,
  viewedAnswers,
} = await vi.hoisted(async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const Cause = await import("effect/Cause");
  const filePatch = (path: string, addition = "after()") =>
    [
      `diff --git a/${path} b/${path}`,
      "index 1111111..2222222 100644",
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1,6 +1,6 @@",
      "-before()",
      `+${addition}`,
      " one()",
      " two()",
      " three()",
      " four()",
      " five()",
      "",
    ].join("\n");
  const firstPage: PullRequestDiffResult = {
    patch: filePatch("a.ts"),
    truncated: false,
    nextCursor: null,
  };
  // An environment query whose refetch returns equal content hands back the previous value
  // itself, so a refresh publishes a new result around the very same page.
  const diffPagesAtom = Atom.make<ReadonlyMap<string, PullRequestDiffResult>>(new Map());
  const pageAtoms = Atom.family((cursor: string) =>
    Atom.make((get) => {
      const value = get(diffPagesAtom).get(cursor);
      return value ? AsyncResult.success(value) : AsyncResult.initial<PullRequestDiffResult>();
    }),
  );
  const firstDiffData = Atom.make(firstPage);
  const diffFailure = Atom.make<string | null>(null);
  const heldDiffRead = Atom.make<AsyncResult.AsyncResult<PullRequestDiffResult> | null>(null);
  const filesViewedState = Atom.make<AsyncResult.AsyncResult<PullRequestFilesViewedResult>>(
    AsyncResult.initial(),
  );
  const viewedAnswers = new Set<(answer: PullRequestFilesViewedResult) => void>();
  return {
    viewedAnswers,
    diffCommits: [] as Array<string | undefined>,
    filePatch,
    firstDiffData,
    heldDiffRead,
    diffFailure,
    filesViewedState,
    firstPage,
    diffPagesAtom,
    pageAtoms,
    command: vi.fn(),
    permission: Atom.make(true),
    diffAtom: Atom.make((get) => {
      const held = get(heldDiffRead);
      if (held !== null) return held;
      const error = get(diffFailure);
      return error === null
        ? AsyncResult.success(get(firstDiffData))
        : AsyncResult.failure(Cause.fail(new Error(error)));
    }),
    filesViewedAtom: Atom.make((get) => {
      const result = get(filesViewedState);
      if (AsyncResult.isSuccess(result)) {
        for (const listener of viewedAnswers) listener(result.value);
      }
      return AsyncResult.isSuccess(result) ? AsyncResult.success(result.value) : result;
    }),
  };
});

vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => command) as never,
}));
vi.mock(import("~/state/pullRequests"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    subscribePullRequestFilesViewedAnswers: (_target, listener) => {
      viewedAnswers.add(listener);
      return () => {
        viewedAnswers.delete(listener);
      };
    },
    pullRequestEnvironment: {
      ...actual.pullRequestEnvironment,
      diff: (({ input }: { input: { cursor?: string; commit?: string } }) => {
        diffCommits.push(input.commit);
        return input.cursor ? pageAtoms(input.cursor) : diffAtom;
      }) as never,
      setFilesViewed: {
        ...actual.pullRequestEnvironment.setFilesViewed,
        permissionAtom: () => permission,
      },
      filesViewed: (() => filesViewedAtom) as never,
    },
  };
});

import { WorkerPoolManager } from "@pierre/diffs/worker";
import { createWorkspaceFocusController, workspaceAreaProps } from "~/lib/workspaceFocus";
import { act, render, stubGlobal } from "../../../test/render";
import PullRequestCodeTab from "./PullRequestCodeTab";
import { ToastProvider } from "../ui/toast";
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
  commits: [
    { oid: "commit", messageHeadline: "Current commit", committedDate: "2026-09-01T00:00:00Z" },
  ],
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

function setup(
  viewed: PullRequestFilesViewedResult | null = null,
  options: {
    patch?: PullRequestDiffResult;
    changedFiles?: number;
  } = {},
) {
  diffCommits.length = 0;
  const scrollScopeKey = expect.getState().currentTestName ?? "fixture";
  const stack = new DisposableStack();
  const settings = getClientSettings();
  __setClientSettingsForTests({ ...settings, diffFilesCollapsed: false });
  stack.defer(() => __setClientSettingsForTests(settings));
  const registry = stack.adopt(AtomRegistry.make(), (registry) => registry.dispose());
  stack.defer(registry.mount(diffPagesAtom));
  stack.defer(registry.mount(diffFailure));
  stack.defer(registry.mount(heldDiffRead));
  registry.set(heldDiffRead, null);
  registry.set(diffFailure, null);
  stack.defer(registry.mount(firstDiffData));
  stack.defer(registry.mount(filesViewedState));
  registry.set(firstDiffData, options.patch ?? firstPage);
  registry.set(diffPagesAtom, new Map());
  registry.set(permission, true);
  command.mockReset();
  command.mockImplementation(async ({ input }) => {
    if (input.refKind) return AsyncResult.success({ refs: [], nextCursor: null });
    if (!input.files) return { _tag: "Success" };
    const previous = registry.get(filesViewedState);
    const states = new Map(
      (AsyncResult.isSuccess(previous) ? previous.value.files : []).map((file) => [
        file.path,
        file.state,
      ]),
    );
    for (const file of input.files) states.set(file.path, file.viewed ? "viewed" : "unviewed");
    registry.set(
      filesViewedState,
      AsyncResult.success({
        files: [...states].map(([path, state]) => ({ path, state })),
        truncated: false,
      }),
    );
    return { _tag: "Success" };
  });
  const groupKeys = () =>
    Object.keys(window.localStorage).filter((key) =>
      key.startsWith("t3.pullRequests.hiddenReviewGroups:"),
    );
  const savedGroups = groupKeys().map((key) => [key, window.localStorage.getItem(key)] as const);
  for (const key of groupKeys()) window.localStorage.removeItem(key);
  stack.defer(() => {
    for (const key of groupKeys()) window.localStorage.removeItem(key);
    for (const [key, value] of savedGroups)
      if (value !== null) window.localStorage.setItem(key, value);
  });
  registry.set(
    filesViewedState,
    viewed === null ? AsyncResult.initial() : AsyncResult.success(viewed),
  );
  return {
    registry,
    wrap: (node: import("react").ReactNode) => (
      <RegistryContext.Provider value={registry}>{node}</RegistryContext.Provider>
    ),
    tab: (refreshToken: number, props: Partial<Parameters<typeof PullRequestCodeTab>[0]> = {}) => (
      <RegistryContext.Provider value={registry}>
        {tab(refreshToken, {
          scrollScopeKey,
          detail: { ...detail, changedFiles: options.changedFiles ?? 1 },
          ...props,
        })}
      </RegistryContext.Provider>
    ),
    [Symbol.dispose]: () => stack.dispose(),
  };
}

const tab = (
  refreshToken: number,
  props: Partial<Parameters<typeof PullRequestCodeTab>[0]> = {},
) => (
  <PullRequestCodeTab
    scrollerRef={() => {}}
    environmentId={EnvironmentId.make("environment")}
    reference={detail}
    detail={detail}
    selectedCommitOid={null}
    onSelectedCommitChange={() => {}}
    onRefresh={() => {}}
    refreshToken={refreshToken}
    {...props}
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
      filesViewedState,
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

function sizedContainer() {
  const container = document.createElement("div");
  container.className = "flex h-[700px] w-[900px]";
  return container;
}

function patch(paths: string[], nextCursor: string | null = null): PullRequestDiffResult {
  return {
    patch: paths
      .map((path) =>
        [
          `diff --git a/${path} b/${path}`,
          "index 1111111..2222222 100644",
          `--- a/${path}`,
          `+++ b/${path}`,
          "@@ -1 +1 @@",
          "-before()",
          "+after()",
          "",
        ].join("\n"),
      )
      .join("\n"),
    truncated: false,
    nextCursor,
  };
}

it("marks and collapses Markdown immediately while showing a pending save", async () => {
  using fixture = setup(
    { files: [], truncated: false },
    { patch: patch(["README.md", "app.ts"]), changedFiles: 2 },
  );
  const savedCommand = command.getMockImplementation()!;
  let finishSave = () => {};
  const save = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  command.mockImplementation(async (input) => {
    await save;
    return savedCommand(input);
  });
  await using screen = await render(fixture.tab(0), { container: sizedContainer() });
  await expect.element(screen.getByRole("checkbox", { name: "Markdown" })).toBeEnabled();
  expect(command).not.toHaveBeenCalled();
  await screen.getByRole("checkbox", { name: "Markdown" }).click();
  await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  expect(command.mock.calls[0]?.[0].input.files).toEqual([{ path: "README.md", viewed: true }]);
  await expect.element(screen.getByRole("status", { name: "Saving Markdown" })).toBeVisible();
  await expect.element(screen.getByRole("checkbox", { name: "Markdown" })).toBeDisabled();
  await expect.element(screen.getByText("README.md", { exact: true })).toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Expand diff", exact: true }))
    .toBeVisible();
  await act(() => finishSave());
  await expect
    .element(screen.getByRole("status", { name: "Saving Markdown" }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("checkbox", { name: "Markdown" })).toBeEnabled();
  await expect
    .element(screen.getByRole("button", { name: "Expand diff", exact: true }))
    .toBeVisible();
  await screen.getByRole("checkbox", { name: "Markdown" }).click();
  await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(2));
  expect(command.mock.calls[1]?.[0].input.files).toEqual([{ path: "README.md", viewed: false }]);
  await expect.element(screen.getByText("README.md", { exact: true })).toBeInTheDocument();
});

it.each([
  { group: "Tests", selected: "tests/ThingTest.php", excluded: "app/Thing.php" },
  { group: "Source", selected: "app/Thing.php", excluded: "config/app.php" },
])(
  "marks and collapses $group without including other groups or config",
  async ({ group, selected, excluded }) => {
    using fixture = setup(
      { files: [], truncated: false },
      { patch: patch([selected, excluded, "ci.yaml"]), changedFiles: 3 },
    );
    await using screen = await render(fixture.tab(0), { container: sizedContainer() });
    await expect.element(screen.getByRole("checkbox", { name: group, exact: true })).toBeEnabled();
    await screen.getByRole("checkbox", { name: group, exact: true }).click();
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    expect(command.mock.calls[0]?.[0].input.files).toEqual([{ path: selected, viewed: true }]);
    await expect.element(screen.getByText(selected, { exact: true })).toBeInTheDocument();
    await expect.element(screen.getByText(excluded, { exact: true })).toBeInTheDocument();
    await expect.element(screen.getByText("ci.yaml", { exact: true })).toBeInTheDocument();
  },
);

it("does not inherit the old automatic Markdown preference", async () => {
  using fixture = setup({ files: [], truncated: false }, { patch: patch(["README.md"]) });
  const key = "t3.pullRequests.reviewDefaults.markdown";
  using _preference = vi.spyOn(Storage.prototype, "getItem").mockImplementation((keyToRead) => {
    return keyToRead === key ? '"autoViewed"' : null;
  });
  await using screen = await render(fixture.tab(0), { container: sizedContainer() });
  await expect.element(screen.getByRole("checkbox", { name: "Markdown" })).toBeEnabled();
  await expect.element(screen.getByRole("checkbox", { name: "Viewed" })).not.toBeChecked();
  await expect
    .element(screen.getByRole("button", { name: "Collapse diff", exact: true }))
    .toBeVisible();
  expect(command).not.toHaveBeenCalled();
});

it("waits for later and omitted files, then applies the complete group", async () => {
  using fixture = setup(
    { files: [], truncated: false },
    { patch: patch(["a.ts"], "page2"), changedFiles: 3 },
  );
  await using screen = await render(fixture.tab(0), { container: sizedContainer() });
  await expect.element(screen.getByRole("checkbox", { name: "Tests", exact: true })).toBeDisabled();
  await act(() =>
    fixture.registry.set(
      diffPagesAtom,
      new Map([
        [
          "page2",
          {
            ...patch(["later.test.ts"]),
            truncated: true,
            omittedFileStats: [{ path: "tests/omitted.ts", additions: 1, deletions: 0 }],
          },
        ],
      ]),
    ),
  );
  await expect.element(screen.getByRole("checkbox", { name: "Tests", exact: true })).toBeEnabled();
  await screen.getByRole("checkbox", { name: "Tests", exact: true }).click();
  await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  expect(command.mock.calls[0]?.[0].input.files).toEqual([
    { path: "later.test.ts", viewed: true },
    { path: "tests/omitted.ts", viewed: true },
  ]);
  await expect.element(screen.getByRole("checkbox", { name: "Tests", exact: true })).toBeEnabled();
  await expect.element(screen.getByRole("checkbox", { name: "Tests", exact: true })).toBeChecked();
});

it.each([
  { name: "truncated commit", first: { ...patch(["a.test.ts"]), truncated: true }, count: 1 },
  { name: "count mismatch", first: patch(["a.test.ts"]), count: 2 },
  {
    name: "raw",
    first: { patch: "unstructured response", truncated: false, nextCursor: null },
    count: 1,
  },
  { name: "cursor cycle", first: patch(["a.test.ts"], "page2"), count: 2 },
])("never writes a $name inventory", async ({ name, first, count }) => {
  using fixture = setup({ files: [], truncated: false }, { patch: first, changedFiles: count });
  if (name === "cursor cycle")
    fixture.registry.set(diffPagesAtom, new Map([["page2", patch(["b.test.ts"], "page2")]]));
  await using screen = await render(
    fixture.tab(0, { selectedCommitOid: name === "truncated commit" ? "commit" : null }),
    { container: sizedContainer() },
  );
  await expect.element(screen.getByRole("checkbox", { name: "Tests", exact: true })).toBeDisabled();
  expect(command).not.toHaveBeenCalled();
});

it("retains Viewed defaults on remount without hiding files or writing on mount", async () => {
  using fixture = setup({ files: [], truncated: false }, { patch: patch(["README.md"]) });
  await using screen = await render(fixture.tab(0), { container: sizedContainer() });
  await expect.element(screen.getByRole("checkbox", { name: "Markdown" })).toBeEnabled();
  await screen.getByRole("checkbox", { name: "Markdown" }).click();
  await expect.element(screen.getByRole("checkbox", { name: "Markdown" })).toBeChecked();
  await screen.unmount();
  await using second = await render(fixture.tab(0), { container: sizedContainer() });
  await expect.element(second.getByRole("checkbox", { name: "Markdown" })).toBeChecked();
  await expect.element(second.getByText("README.md", { exact: true })).toBeInTheDocument();
  await act(() =>
    fixture.registry.set(filesViewedState, AsyncResult.success({ files: [], truncated: false })),
  );
  await second.rerender(
    fixture.tab(0, { reference: { ...detail, number: 2 }, detail: { ...detail, number: 2 } }),
  );
  await expect.element(second.getByRole("checkbox", { name: "Markdown" })).not.toBeChecked();
  await expect.element(second.getByText("README.md", { exact: true })).toBeInTheDocument();
  expect(command).toHaveBeenCalledTimes(1);
});

it("keeps failed and later Changed files visible", async () => {
  using fixture = setup({ files: [], truncated: false }, { patch: patch(["README.md"]) });
  command.mockResolvedValue({ _tag: "Failure", cause: Cause.fail(new Error("Test write failed")) });
  await using screen = await render(fixture.tab(0), { container: sizedContainer() });
  await expect.element(screen.getByRole("checkbox", { name: "Markdown" })).toBeEnabled();
  await screen.getByRole("checkbox", { name: "Markdown" }).click();
  await expect.element(screen.getByRole("checkbox", { name: "Markdown" })).toBeEnabled();
  await expect.element(screen.getByText("README.md", { exact: true })).toBeInTheDocument();
  await act(() =>
    fixture.registry.set(
      filesViewedState,
      AsyncResult.success({ files: [{ path: "README.md", state: "viewed" }], truncated: false }),
    ),
  );
  await expect.element(screen.getByText("README.md", { exact: true })).toBeInTheDocument();
  await screen.rerender(fixture.tab(0, { revealRequest: { path: "README.md", nonce: 1 } }));
  await expect.element(screen.getByText("README.md", { exact: true })).toBeInTheDocument();
  await screen.rerender(fixture.tab(0));
  await act(() =>
    fixture.registry.set(
      filesViewedState,
      AsyncResult.success({ files: [{ path: "README.md", state: "dismissed" }], truncated: false }),
    ),
  );
  await expect.element(screen.getByText("README.md", { exact: true })).toBeInTheDocument();
  await expect.element(screen.getByRole("checkbox", { name: "Markdown" })).not.toBeChecked();
  expect(command).toHaveBeenCalledTimes(1);
});

it("recovers a failed inventory through Retry file groups", async () => {
  using fixture = setup({ files: [], truncated: false });
  fixture.registry.set(diffFailure, "Diff read failed");
  await using screen = await render(fixture.tab(0), { container: sizedContainer() });
  await screen.getByRole("button", { name: "Retry file groups" }).click();
  await act(() => fixture.registry.set(diffFailure, null));
  await expect.element(screen.getByRole("checkbox", { name: "Source" })).toBeEnabled();
  expect(command).not.toHaveBeenCalled();
});

it.each(["headSha", "updatedAt"] as const)(
  "rejects retained old-head inventory using %s",
  async (generationField) => {
    using fixture = setup(
      { files: [], truncated: false },
      { patch: patch(["old.md"]), changedFiles: 1 },
    );
    await using screen = await render(
      fixture.tab(0, { detail: { ...detail, [generationField]: "2026-09-01T01:00:00Z" } }),
      { container: sizedContainer() },
    );
    await expect.element(screen.getByRole("checkbox", { name: "Markdown" })).toBeEnabled();
    const retained = fixture.registry.get(diffAtom);
    if (!AsyncResult.isSuccess(retained)) throw new Error("Expected cached diff");
    await act(() => fixture.registry.set(heldDiffRead, retained));
    await screen.rerender(
      fixture.tab(0, { detail: { ...detail, [generationField]: "2026-09-01T02:00:00Z" } }),
    );
    await expect.element(screen.getByRole("checkbox", { name: "Markdown" })).toBeDisabled();
    expect(command).not.toHaveBeenCalled();
    await act(() => {
      fixture.registry.set(firstDiffData, patch(["new.md"]));
      fixture.registry.set(heldDiffRead, null);
    });
    await expect.element(screen.getByRole("checkbox", { name: "Markdown" })).toBeEnabled();
    await screen.getByRole("checkbox", { name: "Markdown" }).click();
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    expect(command.mock.calls[0]?.[0].input.files).toEqual([{ path: "new.md", viewed: true }]);
  },
);
it("restores saved Viewed folds, follows cleared marks, and allows explicit expansion", async () => {
  using fixture = setup({ files: [{ path: "a.ts", state: "viewed" }], truncated: false });
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, diffFilesCollapsed: false });
  using _preferences = {
    [Symbol.dispose]() {
      __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    },
  };
  const container = document.createElement("div");
  container.className = "flex h-[700px] w-[900px]";
  await using screen = await render(fixture.tab(0), { container });
  await expect.element(screen.getByRole("checkbox", { name: "Viewed" })).toBeChecked();
  await expect
    .element(screen.getByRole("button", { name: "Expand diff", exact: true }))
    .toHaveAttribute("aria-expanded", "false");

  await screen.getByRole("button", { name: "Expand diff", exact: true }).click();
  await expect.element(screen.getByText("three()", { exact: true })).toBeVisible();
  screen.getByRole("checkbox", { name: "Viewed" }).element().focus();
  await userEvent.keyboard(" ");
  await expect.element(screen.getByRole("checkbox", { name: "Source", exact: true })).toBeEnabled();
  await expect.element(screen.getByRole("checkbox", { name: "Viewed" })).not.toBeChecked();
  await expect.element(screen.getByText("three()", { exact: true })).toBeVisible();
  screen.getByRole("checkbox", { name: "Viewed" }).element().focus();
  await userEvent.keyboard(" ");
  await expect.element(screen.getByRole("checkbox", { name: "Source", exact: true })).toBeEnabled();
  await expect
    .element(screen.getByRole("button", { name: "Expand diff", exact: true }))
    .toHaveAttribute("aria-expanded", "false");

  await act(() =>
    fixture.registry.set(filesViewedState, AsyncResult.success({ files: [], truncated: false })),
  );
  await expect.element(screen.getByRole("checkbox", { name: "Viewed" })).not.toBeChecked();
  await expect.element(screen.getByText("three()", { exact: true })).toBeVisible();
  await act(() =>
    fixture.registry.set(
      filesViewedState,
      AsyncResult.success({ files: [{ path: "a.ts", state: "viewed" }], truncated: false }),
    ),
  );
  await expect
    .element(screen.getByRole("button", { name: "Expand diff", exact: true }))
    .toHaveAttribute("aria-expanded", "false");
  await screen.getByRole("button", { name: "Expand all files", exact: true }).click();
  await expect.element(screen.getByText("three()", { exact: true })).toBeVisible();

  await screen.rerender(<div />);
  await screen.rerender(fixture.tab(1));
  await expect
    .element(screen.getByRole("button", { name: "Expand diff", exact: true }))
    .toHaveAttribute("aria-expanded", "false");
});

// regression: #13279 a Viewed answer that lands after a link reveals a file must not fold it
it("keeps a revealed file open when its Viewed mark loads afterwards", async () => {
  using fixture = setup({ files: [], truncated: false });
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, diffFilesCollapsed: false });
  using _preferences = {
    [Symbol.dispose]() {
      __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    },
  };
  const container = document.createElement("div");
  container.className = "flex h-[700px] w-[900px]";
  await using screen = await render(fixture.tab(0, { revealRequest: { path: "a.ts", nonce: 1 } }), {
    container,
  });
  await expect.element(screen.getByText("three()", { exact: true })).toBeVisible();

  await act(() =>
    fixture.registry.set(
      filesViewedState,
      AsyncResult.success({ files: [{ path: "a.ts", state: "viewed" }], truncated: false }),
    ),
  );
  await expect.element(screen.getByRole("checkbox", { name: "Viewed" })).toBeChecked();

  await expect
    .element(screen.getByRole("button", { name: "Collapse diff" }))
    .toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByText("three()", { exact: true })).toBeVisible();
});

function pagedContainer() {
  const container = document.createElement("div");
  container.className = "flex h-[500px] w-[900px]";
  return container;
}

async function expectFileHeaderShown(
  screen: Awaited<ReturnType<typeof render>>,
  container: HTMLElement,
  path: string,
) {
  const header = screen.getByText(path, { exact: true }).first();
  await expect.element(header).toBeInTheDocument();
  await vi.waitFor(() => {
    const bounds = container.querySelector(".diff-render-surface")!.getBoundingClientRect();
    const { top, bottom } = header.element().getBoundingClientRect();
    expect(top).toBeGreaterThanOrEqual(bounds.top);
    expect(bottom).toBeLessThanOrEqual(bounds.bottom);
  });
}

it("scrolls to a file asked for as the tab opens", async () => {
  using fixture = setup(null, {
    patch: {
      patch: Array.from({ length: 40 }, (_, index) => filePatch(`early-${index}.ts`)).join(""),
      truncated: true,
      nextCursor: "page-2",
    },
    changedFiles: 41,
  });
  fixture.registry.set(
    diffPagesAtom,
    new Map([["page-2", { patch: filePatch("late.ts"), truncated: false, nextCursor: null }]]),
  );
  const container = pagedContainer();
  await using screen = await render(
    fixture.tab(0, { revealRequest: { path: "early-39.ts", nonce: 1 } }),
    { container },
  );

  await expectFileHeaderShown(screen, container, "early-39.ts");
});

it("pages forward to a file asked for that is not loaded yet, then scrolls to it", async () => {
  using fixture = setup(null, {
    patch: {
      patch: Array.from({ length: 40 }, (_, index) =>
        filePatch(index === 1 ? "early-1.test.ts" : `early-${index}.ts`),
      ).join(""),
      truncated: true,
      nextCursor: "page-2",
    },
    changedFiles: 41,
  });
  fixture.registry.set(
    diffPagesAtom,
    new Map([["page-2", { patch: filePatch("late.test.ts"), truncated: false, nextCursor: null }]]),
  );
  __setClientSettingsForTests({ ...getClientSettings(), diffFilesCollapsed: true });
  const container = pagedContainer();
  await using screen = await render(fixture.tab(0), { container });
  await expect.element(screen.getByText("early-0.ts", { exact: true }).first()).toBeVisible();

  const url = `${detail.url}/files#diff-${bytesToHex(sha256(new TextEncoder().encode("late.test.ts")))}R4-R5`;
  const settled = vi.fn();
  await screen.rerender(fixture.tab(0, { revealUrl: url, onRevealSettled: settled }));

  await expectFileHeaderShown(screen, container, "late.test.ts");
  await expect.element(screen.getByText("three()", { exact: true })).toBeVisible();
  await vi.waitFor(() => expect(settled).toHaveBeenCalledWith(url));
  // A later click reveals the same linked file again.
  await screen.rerender(fixture.tab(0, { revealRequest: { path: "early-0.ts", nonce: 1 } }));
  await expectFileHeaderShown(screen, container, "early-0.ts");
  await screen.rerender(
    fixture.tab(0, {
      revealRequest: { path: "early-0.ts", nonce: 1 },
      revealUrl: url,
      onRevealSettled: settled,
    }),
  );
  await expectFileHeaderShown(screen, container, "late.test.ts");
});

it("keeps a linked test file expanded when a refresh changes the rest of the diff", async () => {
  const testPatch = (refreshed: boolean) => ({
    ...firstPage,
    patch:
      filePatch("early-0.ts") +
      filePatch("early-1.test.ts", "testOnly()") +
      filePatch("early-2.generated.ts") +
      (refreshed ? filePatch("early-3.ts") : ""),
  });
  using fixture = setup(null, { patch: testPatch(false), changedFiles: 3 });
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, diffFilesCollapsed: true });
  using _preferences = {
    [Symbol.dispose]() {
      window.localStorage.removeItem("t3code.diffHideTestFiles");
      __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    },
  };
  const container = document.createElement("div");
  container.className = "flex h-[700px] w-[900px]";
  await using screen = await render(fixture.tab(0), { container });
  await screen.getByRole("button", { name: "Hide test files" }).click();

  const path = "early-1.test.ts";
  const url = `${detail.url}/files#diff-${bytesToHex(sha256(new TextEncoder().encode(path)))}`;
  const settled = vi.fn();
  await screen.rerender(fixture.tab(0, { revealUrl: url, onRevealSettled: settled }));
  await vi.waitFor(() => expect(settled).toHaveBeenCalledWith(url));
  await screen.rerender(fixture.tab(0));
  const testLine = screen.getByText("testOnly()", { exact: true });
  await expect.element(testLine).toBeVisible();

  await act(() => fixture.registry.set(firstDiffData, testPatch(true)));
  await screen.rerender(fixture.tab(1, { detail: { ...detail, changedFiles: 4 } }));
  await expect.element(screen.getByText("4 files", { exact: true })).toBeVisible();
  await expect.element(testLine).toBeVisible();
});

// regression: #42199 an agent's push re-keyed every file and dropped the comment being typed
it.each([
  { action: "keeps", changesDraftFile: false },
  { action: "drops", changesDraftFile: true },
])("$action an unfinished inline comment after a head change", async ({ changesDraftFile }) => {
  const paths = ["early-0.ts", "early-1.test.ts", "early-2.generated.ts"];
  using fixture = setup(null, {
    patch: { ...firstPage, patch: paths.map((path) => filePatch(path)).join("") },
    changedFiles: paths.length,
  });
  const reviewable = {
    ...detail,
    capabilities: {
      ...detail.capabilities,
      review: { ...detail.capabilities.review, inlineComment: true },
    },
    viewerPermissions: { ...detail.viewerPermissions, comment: true },
  };
  const reviewTab = (backgroundRefreshToken: number) =>
    fixture.tab(0, {
      reference: reviewable,
      detail: {
        ...reviewable,
        headSha: backgroundRefreshToken === 0 ? "original-head" : "updated-head",
        changedFiles: paths.length + backgroundRefreshToken,
      },
      backgroundRefreshToken,
    });
  const container = document.createElement("div");
  container.className = "flex h-[700px] w-[900px]";
  await using screen = await render(reviewTab(0), { container });
  const header = screen.getByText("early-0.ts", { exact: true }).first();
  await expect.element(header).toBeVisible();
  const root = header.element().getRootNode() as ShadowRoot;
  await userEvent.click(root.querySelector<HTMLElement>('[data-column-number="1"]')!);
  const input = () => screen.getByRole("textbox", { name: "Comment on lines early-0.ts:1" });
  await input().fill("Unsent review note");

  const retained = fixture.registry.get(diffAtom);
  if (!AsyncResult.isSuccess(retained)) throw new Error("Expected cached diff");
  await act(() => fixture.registry.set(heldDiffRead, retained));
  await screen.rerender(reviewTab(1));
  await expect.element(input()).not.toBeInTheDocument();

  await act(() => {
    fixture.registry.set(firstDiffData, {
      ...firstPage,
      patch: [...paths, "early-3.ts"]
        .map((path) =>
          filePatch(path, path === "early-0.ts" && changesDraftFile ? "changed()" : undefined),
        )
        .join(""),
    });
    fixture.registry.set(heldDiffRead, null);
  });

  await expect.element(screen.getByText("4 files", { exact: true })).toBeVisible();
  if (changesDraftFile) {
    await expect.element(input()).not.toBeInTheDocument();
  } else {
    await expect.element(input()).toHaveValue("Unsent review note");
  }
});

// Two short pages of a source and a test file each; the next page loads only through the file tree.
async function renderShortPages(stack: AsyncDisposableStack) {
  const fixture = stack.use(
    setup(null, { patch: patch(["early-0.ts", "early-1.test.ts"], "page-2"), changedFiles: 4 }),
  );
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, diffFilesCollapsed: false });
  stack.defer(() => {
    window.localStorage.removeItem("t3code.diffHideTestFiles");
    window.localStorage.removeItem("t3code.pullRequestFileTreeOpen");
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  });
  stack.use(
    stubGlobal(
      "IntersectionObserver",
      class extends IntersectionObserver {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          super(options?.rootMargin === "240px" ? () => {} : callback, options);
        }
      },
    ),
  );
  const container = document.createElement("div");
  container.className = "flex h-[1000px] w-[900px]";
  const screen = stack.use(await render(fixture.tab(0), { container }));
  const loadNextPage = async () => {
    await screen.getByRole("button", { name: "Show file tree", exact: true }).click();
    const loadMore = screen.getByRole("button", { name: "Load more files", exact: true });
    await act(() =>
      fixture.registry.set(
        diffPagesAtom,
        new Map([["page-2", patch(["late.ts", "late.test.ts"])]]),
      ),
    );
    await expect.element(loadMore).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Hide file tree", exact: true }).click();
  };
  // The later page sits at the bottom of the list, which grows as expanded files render.
  const diffToggle = async (path: string) => {
    const scroller = container.querySelector(".diff-render-surface")!;
    const header = await vi.waitFor(() => {
      scroller.scrollTop = scroller.scrollHeight;
      return screen.getByText(path, { exact: true }).element();
    });
    const { host } = header.getRootNode() as ShadowRoot;
    return page.elementLocator(host).getByRole("button", { name: /^(Expand|Collapse) diff$/ });
  };
  const filter = screen.getByRole("button", { name: "Hide test files" });
  return { screen, fixture, loadNextPage, diffToggle, filter };
}

it("keeps a later test file folded by hand through a refresh and bulk toggles while hidden", async () => {
  await using stack = new AsyncDisposableStack();
  const { screen, fixture, loadNextPage, diffToggle, filter } = await renderShortPages(stack);
  await loadNextPage();
  const lateTest = await diffToggle("late.test.ts");
  await lateTest.click();
  await expect.element(lateTest).toHaveAttribute("aria-expanded", "false");
  await filter.click();

  // A refresh drops the loaded later page, so the bulk toggles below run without it.
  await act(() => fixture.registry.set(diffPagesAtom, new Map()));
  await screen.rerender(fixture.tab(1));
  await expect.element(screen.getByText("1 test file hidden", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "Collapse all files", exact: true }).click();
  await screen.getByRole("button", { name: "Expand all files", exact: true }).click();
  await loadNextPage();
  await filter.click();

  await expect.element(screen.getByText("4 files", { exact: true })).toBeVisible();
  await expect.element(await diffToggle("late.test.ts")).toHaveAttribute("aria-expanded", "false");
});

it("never requests the diff of a selected commit the pull request no longer has", async () => {
  using fixture = setup();
  const container = document.createElement("div");
  container.className = "flex h-[700px] w-[900px]";
  // The timeline can open a commit that a force-push removed from the pull request.
  await using screen = await render(
    fixture.tab(0, {
      detail: {
        ...detail,
        commits: [
          {
            oid: "kept",
            messageHeadline: "Kept commit",
            committedDate: "2026-09-01T00:00:00Z",
          },
        ],
      },
      selectedCommitOid: "gone",
    }),
    { container },
  );

  await expect.element(screen.getByText("1 file", { exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Diff scope: All commits" }))
    .toBeVisible();
  expect(diffCommits).not.toContain("gone");
});

it("marks the hovered file viewed with macOS Option+V and keeps its collapsed header", async () => {
  using fixture = setup({ files: [], truncated: false });
  await using screen = await render(fixture.tab(0), { container: sizedContainer() });
  const header = screen.getByText("a.ts", { exact: true });
  await expect.element(header).toBeVisible();
  await screen.getByRole("button", { name: "Collapse diff", exact: true }).hover();
  await act(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "v",
        code: "KeyV",
        altKey: true,
        repeat: true,
        bubbles: true,
      }),
    ),
  );
  expect(command).not.toHaveBeenCalled();
  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  document.body.append(overlay);
  try {
    await act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "v", code: "KeyV", altKey: true, bubbles: true }),
      ),
    );
    expect(command).not.toHaveBeenCalled();
  } finally {
    overlay.remove();
  }
  await act(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "√", code: "KeyV", altKey: true, bubbles: true }),
    ),
  );
  await expect.element(screen.getByRole("checkbox", { name: "Viewed", exact: true })).toBeChecked();
  await expect
    .element(screen.getByRole("button", { name: "Expand diff", exact: true }))
    .toBeVisible();
  await expect.element(header).toBeVisible();
  await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));
});

it("restores a scrolled PR after the viewer unmounts for another thread", async () => {
  const lines = Array.from({ length: 200 }, (_, index) => `+line${index}`).join("\n");
  using fixture = setup(
    { files: [{ path: "long.ts", state: "viewed" }], truncated: false },
    {
      patch: {
        patch: `diff --git a/long.ts b/long.ts\n--- a/long.ts\n+++ b/long.ts\n@@ -0,0 +1,200 @@\n${lines}\n`,
        truncated: false,
        nextCursor: null,
      },
    },
  );
  const firstContainer = pagedContainer();
  await using first = await render(fixture.tab(0, { scrollScopeKey: "return-to-thread" }), {
    container: firstContainer,
  });
  await expect.element(first.getByText("long.ts", { exact: true })).toBeVisible();
  await first.getByRole("button", { name: "Expand diff", exact: true }).click();
  const scroller = firstContainer.querySelector(".diff-render-surface");
  if (!(scroller instanceof HTMLElement)) throw new Error("Expected diff scroller");
  await vi.waitFor(() => expect(scroller.scrollHeight).toBeGreaterThan(1500));
  await act(() => {
    scroller.scrollTop = 900;
    scroller.dispatchEvent(new Event("scroll"));
  });
  await vi.waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(700));
  await first.unmount();
  const secondContainer = pagedContainer();
  await using _second = await render(fixture.tab(0, { scrollScopeKey: "return-to-thread" }), {
    container: secondContainer,
  });
  await vi.waitFor(() =>
    expect(secondContainer.querySelector(".diff-render-surface")?.scrollTop).toBeGreaterThan(700),
  );
});

it("answers a commit's diff link only once that commit's diff is shown", async () => {
  using fixture = setup({ files: [], truncated: false });
  const container = document.createElement("div");
  container.className = "flex h-[700px] w-[900px]";
  const oid = "c".repeat(40);
  const withCommit = {
    ...detail,
    commits: [{ oid, messageHeadline: "Linked commit", committedDate: "2026-09-01T00:00:00Z" }],
  };
  const url = `${detail.url}/commits/${oid}#diff-${bytesToHex(sha256(new TextEncoder().encode("a.ts")))}R2`;
  const settled = vi.fn();
  const scoped = (selectedCommitOid: string | null, revealUrl?: string) => (
    <PullRequestCodeTab
      scrollerRef={() => {}}
      environmentId={EnvironmentId.make("environment")}
      reference={detail}
      detail={withCommit}
      selectedCommitOid={selectedCommitOid}
      onSelectedCommitChange={() => {}}
      onRefresh={() => {}}
      revealUrl={revealUrl}
      onRevealSettled={settled}
    />
  );
  await using screen = await render(fixture.wrap(scoped(null)), { container });
  await expect.element(screen.getByText("1 file", { exact: true })).toBeVisible();

  // The panel selects the link's commit after this tab has already seen the link.
  await screen.rerender(fixture.wrap(scoped(null, url)));
  expect(settled).not.toHaveBeenCalled();
  await screen.rerender(fixture.wrap(scoped(oid, url)));
  await vi.waitFor(() => expect(settled).toHaveBeenCalledWith(url));
});

it("hides a resolved conversation behind avatars on its line until they are clicked", async () => {
  using fixture = setup({ files: [], truncated: false });
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, diffFilesCollapsed: false });
  using _preferences = {
    [Symbol.dispose]() {
      __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    },
  };
  const container = document.createElement("div");
  container.className = "flex h-[700px] w-[900px]";
  const comment = {
    author: { login: "reviewer", name: null, avatarUrl: null },
    body: "Rename this.",
    createdAt: "2026-09-01T00:00:00Z",
    url: null,
  };
  const withThread = (isResolved: boolean, oldSideToo = false) => (
    <PullRequestCodeTab
      scrollerRef={() => {}}
      environmentId={EnvironmentId.make("environment")}
      reference={detail}
      detail={{
        ...detail,
        capabilities: {
          ...detail.capabilities,
          review: { ...detail.capabilities.review, reply: true },
        },
        viewerPermissions: { ...detail.viewerPermissions, comment: true },
        reviewThreads: [
          {
            id: "thread",
            path: "a.ts",
            line: 3,
            side: "right",
            isResolved,
            isOutdated: false,
            comments: [{ id: "comment", ...comment }],
          },
          ...(oldSideToo
            ? [
                {
                  id: "old-side",
                  path: "a.ts",
                  line: 3,
                  side: "left" as const,
                  isResolved: true,
                  isOutdated: false,
                  comments: [{ id: "old-side-comment", ...comment }],
                },
              ]
            : []),
        ],
      }}
      selectedCommitOid={null}
      onSelectedCommitChange={() => {}}
      onRefresh={() => {}}
    />
  );
  await using screen = await render(fixture.wrap(withThread(true)), { container });
  const marker = screen.getByRole("button", { name: "Resolved conversation", exact: true });
  const card = (state: string) => screen.getByRole("button", { name: `${state} · 1 comment` });
  const reply = () => screen.getByRole("textbox", { name: "Reply to this conversation" });

  await expect.element(marker).toHaveAttribute("aria-expanded", "false");
  await expect.element(card("Resolved")).not.toBeInTheDocument();

  await marker.click();
  await expect.element(marker).toHaveAttribute("aria-expanded", "true");
  await expect.element(card("Resolved")).toHaveAttribute("aria-expanded", "true");
  await screen.getByRole("button", { name: "Reply", exact: true }).click();
  await reply().fill("Unsent");

  // Hidden conversations stay mounted, so the unsent reply is still there.
  await marker.click();
  await expect.element(card("Resolved")).not.toBeInTheDocument();
  await marker.click();
  await expect.element(reply()).toHaveValue("Unsent");
  await marker.click();

  // Seen open and then resolved, it stays until the avatars are clicked.
  await screen.rerender(fixture.wrap(withThread(false)));
  await expect.element(card("Open")).toBeVisible();
  await screen.rerender(fixture.wrap(withThread(true)));
  await expect.element(card("Resolved")).toBeVisible();

  // Stacked view draws a context row once, so both sides' conversations share the avatars.
  await screen.rerender(fixture.wrap(withThread(true, true)));
  await expect
    .element(screen.getByRole("button", { name: "2 resolved conversations" }))
    .toBeVisible();
});

// regression: #37996
it("keeps an unsent reply when the appearance switches between light and dark", async () => {
  using fixture = setup();
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, diffFilesCollapsed: false });
  setAppearanceMode("dark");
  using _preferences = {
    [Symbol.dispose]() {
      __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
      setAppearanceMode("system");
    },
  };
  const container = document.createElement("div");
  container.className = "flex h-[700px] w-[900px]";
  await using screen = await render(
    fixture.wrap(
      <PullRequestCodeTab
        scrollerRef={() => {}}
        environmentId={EnvironmentId.make("environment")}
        reference={detail}
        detail={{
          ...detail,
          capabilities: {
            ...detail.capabilities,
            review: { ...detail.capabilities.review, reply: true },
          },
          viewerPermissions: { ...detail.viewerPermissions, comment: true },
          reviewThreads: [
            {
              id: "thread",
              path: "a.ts",
              line: 3,
              side: "right",
              isResolved: false,
              isOutdated: false,
              comments: [
                {
                  id: "comment",
                  author: { login: "reviewer", name: null, avatarUrl: null },
                  body: "Rename this.",
                  createdAt: "2026-09-01T00:00:00Z",
                  url: null,
                },
              ],
            },
          ],
        }}
        selectedCommitOid={null}
        onSelectedCommitChange={() => {}}
        onRefresh={() => {}}
      />,
    ),
    { container },
  );
  const reply = () => screen.getByRole("textbox", { name: "Reply to this conversation" });
  await screen.getByRole("button", { name: "Reply", exact: true }).click();
  await reply().fill("Unsent");

  setAppearanceMode("light");

  await expect.element(reply()).toHaveValue("Unsent");
});

it("opens the editor action on Command-click without folding the file", async () => {
  using fixture = setup();
  await using screen = await render(<ToastProvider>{fixture.tab(0)}</ToastProvider>, {
    container: sizedContainer(),
  });
  const title = screen.getByText("a.ts", { exact: true });
  await expect.element(title).toBeVisible();
  await act(() =>
    title.element().dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        composed: true,
        metaKey: true,
      }),
    ),
  );
  await expect
    .element(page.getByText("Check out feature locally before opening this file."))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Collapse diff", exact: true }))
    .toHaveAttribute("aria-expanded", "true");
  await act(() =>
    title.element().dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true })),
  );
  await expect
    .element(screen.getByRole("button", { name: "Expand diff", exact: true }))
    .toHaveAttribute("aria-expanded", "false");
});

it("hands panel focus from the loading diff to the diff once the diff workers start", async () => {
  using fixture = setup();
  let start = () => {};
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  using isInitialized = vi
    .spyOn(WorkerPoolManager.prototype, "isInitialized")
    .mockReturnValue(false);
  using initialize = vi.spyOn(WorkerPoolManager.prototype, "initialize").mockReturnValue(started);
  const container = document.createElement("div");
  container.className = "flex h-[700px] w-[900px]";
  // A conversation off the diff puts a panel where the loading body was, which could reuse its node.
  const withOrphan: PullRequestDetailView = {
    ...detail,
    reviewThreads: [
      {
        id: "thread",
        path: "gone.ts",
        line: 1,
        side: "right",
        isResolved: false,
        isOutdated: false,
        comments: [
          {
            id: "comment",
            author: { login: "reviewer", name: null, avatarUrl: null },
            body: "Rename this.",
            createdAt: "2026-09-01T00:00:00Z",
            url: null,
          },
        ],
      },
    ],
  };
  await using screen = await render(
    <div {...workspaceAreaProps("panel", 4, "Workspace panel")} className="flex flex-1">
      {fixture.tab(0, { detail: { ...withOrphan, changedFiles: 1 } })}
    </div>,
    { container },
  );
  const focus = createWorkspaceFocusController(document);
  using _focus = { [Symbol.dispose]: focus.dispose };
  await expect.element(screen.getByText("Loading pull request diff...")).toBeVisible();
  expect(focus.focus("panel")).toBe(true);

  isInitialized.mockRestore();
  initialize.mockRestore();
  start();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(container.querySelector(".diff-render-surface")),
  );
});
