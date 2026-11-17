import { EnvironmentId, type VcsRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  refs: vi.fn(),
  metadata: vi.fn(),
  open: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => ({ availableEditors: ["zed"] }) }));
vi.mock("~/state/server", () => ({ serverEnvironment: { configValueAtom: () => null } }));
vi.mock("~/state/vcs", () => ({ vcsEnvironment: { readRefs: {} } }));
vi.mock("~/state/filesystem", () => ({ filesystemEnvironment: { getMetadata: {} } }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.refs }));
vi.mock("~/state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => state.metadata }));
vi.mock("~/editorPreferences", () => ({ useOpenInPreferredEditor: () => state.open }));
vi.mock("../ui/toast", () => ({ toastManager: { add: state.toast } }));

import { useOpenPullRequestFile } from "./useOpenPullRequestFile";

const branch = (props: Partial<VcsRef> = {}): VcsRef => ({
  name: "feature",
  isDefault: false,
  current: true,
  worktreePath: "/repo-feature",
  ...props,
});
function setup(refs: readonly VcsRef[] = [branch()]) {
  state.refs.mockReset().mockResolvedValue(AsyncResult.success({ refs, nextCursor: null }));
  state.metadata
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ entries: [{ kind: "file" }] }));
  state.open.mockReset().mockResolvedValue(AsyncResult.success("zed"));
  state.toast.mockReset();
  return useOpenPullRequestFile(EnvironmentId.make("environment"), {
    workspaceRoot: "/repo",
    headBranch: "feature",
  });
}

it("opens the file in the checked-out PR worktree instead of the project branch", async () => {
  const open = setup([branch({ name: "main", worktreePath: "/repo" }), branch()]);
  await open("app/Request.php");
  expect(state.open).toHaveBeenCalledExactlyOnceWith("/repo-feature/app/Request.php");
  expect(state.toast).not.toHaveBeenCalled();
});

it.each([
  { refs: [] },
  { refs: [branch({ worktreePath: null })] },
  { refs: [branch({ name: "feature-other" })] },
  { refs: [branch({ isRemote: true })] },
])("requires a local checkout of the exact PR branch for $refs", async ({ refs }) => {
  const open = setup(refs);
  await open("a.ts");
  expect(state.open).not.toHaveBeenCalled();
  expect(state.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      description: "Check out feature locally before opening this file.",
    }),
  );
});

it("finds an exact branch on a later page of matching refs", async () => {
  const open = setup();
  state.refs.mockResolvedValueOnce(
    AsyncResult.success({ refs: [branch({ name: "feature-other" })], nextCursor: 1 }),
  );
  await open("a.ts");
  expect(state.open).toHaveBeenCalledExactlyOnceWith("/repo-feature/a.ts");
});

it("refuses a stale worktree claim after the checkout changes branches", async () => {
  const open = setup();
  state.refs.mockResolvedValueOnce(AsyncResult.success({ refs: [branch()], nextCursor: null }));
  state.refs.mockResolvedValue(
    AsyncResult.success({ refs: [branch({ name: "main" })], nextCursor: null }),
  );
  await open("a.ts");
  expect(state.open).not.toHaveBeenCalled();
  expect(state.toast).toHaveBeenCalledWith(
    expect.objectContaining({ description: expect.stringContaining("changed branches") }),
  );
});

it.each([null, { kind: "directory" }])(
  "reports missing or unreadable files without launching an editor for %j",
  async (entry) => {
    const open = setup();
    state.metadata.mockResolvedValue(AsyncResult.success({ entries: [entry] }));
    await open("deleted.ts");
    expect(state.open).not.toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining("missing or unreadable") }),
    );
  },
);

it("rejects a path outside the checkout", async () => {
  const open = setup();
  await open("../elsewhere.txt");
  expect(state.metadata).not.toHaveBeenCalled();
  expect(state.open).not.toHaveBeenCalled();
  expect(state.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      description: "This file path cannot be opened in the local checkout.",
    }),
  );
});
