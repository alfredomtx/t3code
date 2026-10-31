import * as Cause from "effect/Cause";
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
} = await vi.hoisted(async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const Cause = await import("effect/Cause");
  const filePatch = (path: string) =>
    [
      `diff --git a/${path} b/${path}`,
      "index 1111111..2222222 100644",
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1 +1 @@",
      "-before()",
      "+after()",
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
  return {
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

it("marks and collapses Markdown while keeping its header visible", async () => {
  using fixture = setup(
    { files: [], truncated: false },
    { patch: patch(["README.md", "app.ts"]), changedFiles: 2 },
  );
  await using screen = await render(fixture.tab(0), { container: sizedContainer() });
  await expect.element(screen.getByRole("checkbox", { name: "Markdown" })).toBeEnabled();
  expect(command).not.toHaveBeenCalled();
  await screen.getByRole("checkbox", { name: "Markdown" }).click();
  await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  expect(command.mock.calls[0]?.[0].input.files).toEqual([{ path: "README.md", viewed: true }]);
  await expect.element(screen.getByText("README.md", { exact: true })).toBeInTheDocument();
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

function pagedContainer() {
  const container = document.createElement("div");
  container.className = "flex h-[500px] w-[900px]";
  return container;
}

// Rows are virtualized, so a header far down is not rendered until the view scrolls to it.
async function expectFileHeaderShown(
  screen: Awaited<ReturnType<typeof render>>,
  container: HTMLElement,
  path: string,
) {
  const header = screen.getByText(path, { exact: true }).first();
  await expect.element(header).toBeInTheDocument();
  await vi.waitFor(() => {
    const top = header.element().getBoundingClientRect().top;
    const bounds = container.getBoundingClientRect();
    expect(top).toBeGreaterThanOrEqual(bounds.top);
    expect(top).toBeLessThan(bounds.top + bounds.height / 2);
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
  await using screen = await render(fixture.tab(0), { container });
  await expect.element(screen.getByText("early-0.ts", { exact: true }).first()).toBeVisible();

  await screen.rerender(fixture.tab(0, { revealRequest: { path: "late.ts", nonce: 1 } }));

  await expectFileHeaderShown(screen, container, "late.ts");
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
