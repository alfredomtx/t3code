import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  SourceControlProviderKind,
  type PullRequestDetailView,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { useRightPanelStore, selectActiveRightPanelSurface } from "~/rightPanelStore";
import { useOpenChangeRequestLink } from "~/lib/openPullRequestLink";
import { PullRequestDetailPanel } from "./PullRequestDetailPanel";

vi.mock("~/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: () => vi.fn(),
}));
vi.mock(import("~/state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: () => ({
    data: null,
    dataUpdatedAt: 0,
    failure: null,
    isPending: false,
    isSuccess: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock(import("~/state/usePullRequestStack"), async (original) => ({
  ...(await original()),
  usePullRequestStack: () => ({
    data: null,
    dataUpdatedAt: 0,
    failure: null,
    isPending: false,
    isSuccess: false,
    notice: null,
    isFresh: true,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock("@t3tools/client-runtime/change-request-links", async (original) => ({
  ...(await original<typeof import("@t3tools/client-runtime/change-request-links")>()),
  projectChangeRequestUrl: () => null,
  resolveChangeRequestLinkTarget: () => ({
    project: { id: "project", environmentId: EnvironmentId.make("environment") },
    repository: "owner/repo",
    number: 1,
  }),
}));
vi.mock("./usePullRequestDetail", () => ({
  pullRequestRefKey: () => "owner/repo/1",
  usePullRequestDetail: () => ({
    canWriteSourceControl: false,
    detail,
    coreDetail: detail,
    sharedSummary: detail,
    activity: detail,
    detailQuery: { isPending: false, refresh: vi.fn() },
    activityQuery: { isPending: false, refresh: vi.fn() },
  }),
}));
vi.mock("./PullRequestSummaryTab", () => ({
  PullRequestSummaryTab: () => <div>Summary content</div>,
}));
vi.mock("./PullRequestTimelineTab", () => ({
  PullRequestTimelineTab: () => <div>Timeline content</div>,
}));
vi.mock("./PullRequestCodeTab", () => ({ default: () => <div>Code content</div> }));

const detail: PullRequestDetailView = {
  provider: SourceControlProviderKind.make("github"),
  projectId: ProjectId.make("project"),
  projectTitle: "Project",
  workspaceRoot: "/workspace",
  repository: "owner/repo",
  number: 1,
  title: "Test pull request",
  body: "Original description",
  url: "https://github.com/owner/repo/pull/1",
  author: { login: "author", name: null, avatarUrl: null },
  viewer: "author",
  state: "open",
  isDraft: false,
  mergeability: "mergeable",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  headBranch: "feature",
  baseBranch: "main",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  mergedAt: null,
  closedAt: null,
  reviewers: [],
  labels: [],
  checks: [{ name: "Unit tests", status: "success", description: null, url: null }],
  comments: [],
  commentCount: 0,
  commentsTruncated: false,
  reviewThreads: [],
  commits: [],
  mergeCapabilities: { merge: false, squash: false, rebase: false },
  capabilities: {
    diff: true,
    comment: true,
    search: true,
    actions: [],
    mergeMethods: [],
    review: { inlineComment: false, reply: false, resolve: false, verdicts: [] },
    reviewers: { request: false, listCandidates: false },
    edit: { changeRequest: true, comment: true },
  },
  viewerPermissions: {
    actions: [],
    comment: true,
    resolve: false,
    verdicts: [],
    requestReviewers: false,
  },
};

const ref = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("thread"));
function Panel() {
  const surface = useRightPanelStore((state) =>
    selectActiveRightPanelSurface(state.byThreadKey, ref),
  );
  const open = useOpenChangeRequestLink(ref);
  if (surface?.kind !== "pull-request") return null;
  return (
    <>
      <a href={detail.url} onClick={(event) => open(event, detail.url)}>
        Open PR link
      </a>
      <PullRequestDetailPanel
        environmentId={ref.environmentId}
        reference={detail}
        threadRef={ref}
        context="thread"
        shortcutsEnabled={false}
        getShortcutContext={() => ({
          terminalFocus: false,
          terminalOpen: false,
          previewFocus: false,
          previewOpen: false,
          isWeb: true,
          isDesktop: false,
        })}
        selectedTab={surface.detailTab ?? "summary"}
        onTabChange={(tab) =>
          useRightPanelStore.getState().setPullRequestDetailTab(ref, surface.id, tab)
        }
      />
    </>
  );
}

it.each(["Code", "Timeline"])(
  "returns the mounted %s panel to Summary when its plain PR link is clicked",
  async (label) => {
    useRightPanelStore.setState({ byThreadKey: {} });
    useRightPanelStore.getState().openPullRequest(ref, {
      projectId: detail.projectId,
      repository: detail.repository,
      number: detail.number,
    });
    await using screen = await render(<Panel />);
    await expect
      .element(screen.getByRole("button", { name: "Summary", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: label, exact: true }));
    await expect
      .element(screen.getByRole("button", { name: label, exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("link", { name: "Open PR link" }));
    await expect
      .element(screen.getByRole("button", { name: "Summary", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.element(screen.getByText("Summary content", { exact: true })).toBeVisible();
  },
);
