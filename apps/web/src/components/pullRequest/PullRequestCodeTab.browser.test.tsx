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
import { page, userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";

const {
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
} = await vi.hoisted(async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const Cause = await import("effect/Cause");
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
      diff: (({ input }: { input: { cursor?: string } }) =>
        input.cursor ? pageAtoms(input.cursor) : diffAtom) as never,
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

function setup(
  viewed: PullRequestFilesViewedResult | null = null,
  options: {
    patch?: PullRequestDiffResult;
    changedFiles?: number;
    mode?: "collapsed" | "autoViewed" | "off";
  } = {},
) {
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
  const key = "t3.pullRequests.reviewDefaults.markdown";
  const saved = window.localStorage.getItem(key);
  window.localStorage.setItem(key, JSON.stringify(options.mode ?? "collapsed"));
  stack.defer(() =>
    saved === null ? window.localStorage.removeItem(key) : window.localStorage.setItem(key, saved),
  );
  const optOutKeys = Object.keys(window.localStorage).filter((key) =>
    key.startsWith("t3.pullRequests.reviewDefaults.optOuts:"),
  );
  const savedOptOuts = optOutKeys.map((key) => [key, window.localStorage.getItem(key)] as const);
  for (const key of optOutKeys) window.localStorage.removeItem(key);
  stack.defer(() => {
    for (const key of Object.keys(window.localStorage).filter((key) =>
      key.startsWith("t3.pullRequests.reviewDefaults.optOuts:"),
    ))
      window.localStorage.removeItem(key);
    for (const [key, value] of savedOptOuts)
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

it("starts Markdown collapsed without a Viewed write and persists the selector", async () => {
  using fixture = setup({ files: [], truncated: false }, { patch: patch(["README.md"]) });
  await using screen = await render(fixture.tab(0), { container: sizedContainer() });
  await expect
    .element(screen.getByRole("button", { name: "Expand diff", exact: true }))
    .toBeVisible();
  await expect.element(screen.getByRole("checkbox", { name: "Viewed" })).not.toBeChecked();
  expect(command).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Markdown review default" }).click();
  await page.getByRole("menuitemradio", { name: "No special default" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Collapse diff", exact: true }))
    .toBeVisible();
  expect(window.localStorage.getItem("t3.pullRequests.reviewDefaults.markdown")).toBe('"off"');
  expect(command).not.toHaveBeenCalled();
});

it("finds tests on later pages and in known omitted paths before enabling actions", async () => {
  using fixture = setup(
    { files: [], truncated: false },
    { patch: patch(["a.ts"], "page2"), changedFiles: 3 },
  );
  await using screen = await render(fixture.tab(0), { container: sizedContainer() });
  await screen.getByRole("button", { name: "Test file actions" }).click();
  await expect
    .element(page.getByRole("menuitem", { name: "Mark all tests viewed", exact: true }))
    .toBeDisabled();
  await expect
    .element(screen.getByRole("button", { name: "Test file actions" }))
    .toHaveTextContent("Finding test files...");
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
  await expect
    .element(screen.getByRole("button", { name: "Test file actions" }))
    .toHaveTextContent("Tests (2)");
  await expect
    .element(page.getByRole("menuitem", { name: "Inventory unavailable. Retry" }))
    .not.toBeInTheDocument();
  await page.getByRole("menuitem", { name: "Mark all tests viewed", exact: true }).click();
  await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  expect(command.mock.calls[0]?.[0].input.files).toEqual([
    { path: "later.test.ts", viewed: true },
    { path: "tests/omitted.ts", viewed: true },
  ]);
});

it.each([
  { name: "truncated", page: { ...patch(["a.test.ts"]), truncated: true }, count: 1 },
  { name: "count mismatch", page: patch(["a.test.ts"]), count: 2 },
  {
    name: "raw",
    page: { patch: "unstructured response", truncated: false, nextCursor: null },
    count: 1,
  },
  { name: "cursor cycle", page: patch(["a.test.ts"], "page2"), count: 2 },
])("refuses a $name inventory", async ({ name, page: first, count }) => {
  using fixture = setup({ files: [], truncated: false }, { patch: first, changedFiles: count });
  if (name === "cursor cycle")
    fixture.registry.set(diffPagesAtom, new Map([["page2", patch(["b.test.ts"], "page2")]]));
  await using screen = await render(
    fixture.tab(0, { selectedCommitOid: name === "truncated" ? "commit" : null }),
    { container: sizedContainer() },
  );
  await screen.getByRole("button", { name: "Test file actions" }).click();
  await expect
    .element(page.getByRole("menuitem", { name: "Inventory unavailable. Retry" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("menuitem", { name: "Mark all tests viewed", exact: true }))
    .toBeDisabled();
  expect(command).not.toHaveBeenCalled();
});

it("auto Viewed skips viewed and Changed Markdown and never runs in a commit scope", async () => {
  using fixture = setup(
    {
      files: [
        { path: "seen.md", state: "viewed" },
        { path: "changed.md", state: "dismissed" },
      ],
      truncated: false,
    },
    { patch: patch(["seen.md", "changed.md", "new.mdx"]), changedFiles: 3, mode: "autoViewed" },
  );
  await using screen = await render(fixture.tab(0, { selectedCommitOid: "commit" }), {
    container: sizedContainer(),
  });
  await expect
    .element(screen.getByRole("button", { name: "Test file actions" }))
    .toHaveTextContent("Tests (0)");
  expect(command).not.toHaveBeenCalled();
  await screen.rerender(fixture.tab(0));
  await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  expect(command.mock.calls[0]?.[0].input.files).toEqual([{ path: "new.mdx", viewed: true }]);
  await screen.rerender(fixture.tab(0));
  expect(command).toHaveBeenCalledTimes(1);
});

it("preserves a manual Markdown opt-out across remount, mode and commit changes", async () => {
  using fixture = setup(
    { files: [{ path: "README.md", state: "viewed" }], truncated: false },
    { patch: patch(["README.md"]), mode: "autoViewed" },
  );
  await using first = await render(fixture.tab(0), { container: sizedContainer() });
  await expect.element(first.getByRole("checkbox", { name: "Viewed" })).toBeChecked();
  const checkbox = first.getByRole("checkbox", { name: "Viewed" }).element();
  if (!(checkbox instanceof HTMLElement)) throw new Error("Expected checkbox element");
  checkbox.focus();
  await userEvent.keyboard(" ");
  expect(window.localStorage.getItem("t3.pullRequests.reviewDefaults.markdown")).toBe(
    '"autoViewed"',
  );
  await first.unmount();
  await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  await using second = await render(fixture.tab(0), { container: sizedContainer() });
  await expect.element(second.getByRole("checkbox", { name: "Viewed" })).not.toBeChecked();
  await second.rerender(fixture.tab(0, { selectedCommitOid: "commit" }));
  await second.rerender(fixture.tab(0));
  await second.getByRole("button", { name: "Markdown review default" }).click();
  await page.getByRole("menuitemradio", { name: "No special default" }).click();
  await second.getByRole("button", { name: "Markdown review default" }).click();
  await page.getByRole("menuitemradio", { name: "Mark viewed automatically" }).click();
  await expect.element(second.getByRole("checkbox", { name: "Viewed" })).not.toBeChecked();
  expect(command).toHaveBeenCalledTimes(1);
});

it("waits for complete inventory and a successful Viewed read before auto marking", async () => {
  using fixture = setup(null, {
    patch: patch(["a.ts"], "page2"),
    changedFiles: 2,
    mode: "autoViewed",
  });
  await using screen = await render(fixture.tab(0), { container: sizedContainer() });
  await expect
    .element(screen.getByRole("button", { name: "Test file actions" }))
    .toHaveTextContent("Find all tests");
  expect(command).not.toHaveBeenCalled();
  await act(() => fixture.registry.set(diffPagesAtom, new Map([["page2", patch(["README.md"])]])));
  await expect
    .element(screen.getByRole("button", { name: "Test file actions" }))
    .toHaveTextContent("Tests (0)");
  expect(command).not.toHaveBeenCalled();
  await act(() =>
    fixture.registry.set(filesViewedState, AsyncResult.success({ files: [], truncated: false })),
  );
  await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  expect(command.mock.calls[0]?.[0].input.files).toEqual([{ path: "README.md", viewed: true }]);
});

it("keeps per-PR opt-outs separate from another PR", async () => {
  using fixture = setup(
    { files: [], truncated: false },
    { patch: patch(["README.md"]), mode: "autoViewed" },
  );
  const { autoViewedOptOutStorageKey } = await import("./pullRequestReviewDefaults");
  window.localStorage.setItem(
    autoViewedOptOutStorageKey(EnvironmentId.make("environment"), detail),
    JSON.stringify(["README.md"]),
  );
  await using screen = await render(fixture.tab(0), { container: sizedContainer() });
  await expect.element(screen.getByRole("checkbox", { name: "Viewed" })).not.toBeChecked();
  expect(command).not.toHaveBeenCalled();
  await screen.rerender(
    fixture.tab(0, { reference: { ...detail, number: 2 }, detail: { ...detail, number: 2 } }),
  );
  await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  expect(command.mock.calls[0]?.[0].input.number).toBe(2);
});

it("shows a settled first-page failure and recovers through the inventory Retry action", async () => {
  using fixture = setup({ files: [], truncated: false });
  fixture.registry.set(diffFailure, "Diff read failed");
  await using screen = await render(fixture.tab(0), { container: sizedContainer() });
  await screen.getByRole("button", { name: "Test file actions" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Test file actions" }))
    .toHaveTextContent("Find all tests");
  await page.getByRole("menuitem", { name: "Inventory unavailable. Retry" }).click();
  await act(() => fixture.registry.set(diffFailure, null));
  await expect
    .element(screen.getByRole("button", { name: "Test file actions" }))
    .toHaveTextContent("Tests (0)");
  await screen.getByRole("button", { name: "Test file actions" }).click();
  await expect
    .element(page.getByRole("menuitem", { name: "Inventory unavailable. Retry" }))
    .not.toBeInTheDocument();
  expect(command).not.toHaveBeenCalled();
});

it("keeps the Markdown preference editable and persisted while Personal follows Nightly", async () => {
  using fixture = setup({ files: [], truncated: false }, { patch: patch(["README.md"]) });
  const { __resetClientSettingsPersistenceForTests, ensureClientSettingsHydrated } =
    await import("~/hooks/useSettings");
  try {
    vi.stubGlobal("desktopBridge", {
      getPersonalSharedPreferences: async () => ({
        clientSettings: getClientSettings(),
        themeValues: {},
      }),
    });
    __resetClientSettingsPersistenceForTests();
    await ensureClientSettingsHydrated();
    await using first = await render(fixture.tab(0), { container: sizedContainer() });
    await first.getByRole("button", { name: "Markdown review default" }).click();
    await page.getByRole("menuitemradio", { name: "No special default" }).click();
    await first.unmount();
    await using second = await render(fixture.tab(0), { container: sizedContainer() });
    await second.getByRole("button", { name: "Markdown review default" }).click();
    await expect
      .element(page.getByRole("menuitemradio", { name: "No special default" }))
      .toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem("t3.pullRequests.reviewDefaults.markdown")).toBe('"off"');
    expect(command).not.toHaveBeenCalled();
  } finally {
    __resetClientSettingsPersistenceForTests();
    vi.unstubAllGlobals();
  }
});

it.each(["headSha", "updatedAt"] as const)(
  "does not certify retained old-head pages before a replacement read with unchanged refresh tokens using %s",
  async (generationField) => {
    using fixture = setup(
      { files: [], truncated: false },
      { patch: patch(["old.md", "old.test.ts"]), changedFiles: 2 },
    );
    await using screen = await render(
      fixture.tab(0, {
        detail: { ...detail, changedFiles: 2, [generationField]: "2026-09-01T01:00:00Z" },
      }),
      { container: sizedContainer() },
    );
    await expect
      .element(screen.getByRole("button", { name: "Test file actions" }))
      .toHaveTextContent("Tests (1)");
    const retained = fixture.registry.get(diffAtom);
    if (!AsyncResult.isSuccess(retained)) throw new Error("Expected successful cached diff");
    await act(() => fixture.registry.set(heldDiffRead, retained));
    await screen.rerender(
      fixture.tab(0, {
        detail: { ...detail, changedFiles: 2, [generationField]: "2026-09-01T02:00:00Z" },
      }),
    );
    await expect
      .element(screen.getByRole("button", { name: "Test file actions" }))
      .toHaveTextContent("Find all tests");
    await screen.getByRole("button", { name: "Test file actions" }).click();
    await expect
      .element(page.getByRole("menuitem", { name: "Mark all tests viewed", exact: true }))
      .toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await screen.getByRole("button", { name: "Markdown review default" }).click();
    await page.getByRole("menuitemradio", { name: "Mark viewed automatically" }).click();
    expect(command).not.toHaveBeenCalled();
    await act(() => {
      fixture.registry.set(firstDiffData, patch(["new.md", "new.test.ts"]));
      fixture.registry.set(heldDiffRead, null);
    });
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    expect(command.mock.calls[0]?.[0].input.files).toEqual([{ path: "new.md", viewed: true }]);
    await screen.getByRole("button", { name: "Test file actions" }).click();
    await page.getByRole("menuitem", { name: "Mark all tests viewed", exact: true }).click();
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(2));
    expect(command.mock.calls[1]?.[0].input.files).toEqual([{ path: "new.test.ts", viewed: true }]);
  },
);
