import {
  SourceControlProviderKind,
  EnvironmentId,
  ProjectId,
  type PullRequestDetailView,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { PullRequestTimelineTab } from "./PullRequestTimelineTab";

vi.mock(import("~/state/use-atom-command"), () => ({ useAtomCommand: () => vi.fn() }));

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

const original = {
  id: "root",
  author: detail.author,
  body: "Root review finding",
  createdAt: detail.createdAt,
  url: `${detail.url}#discussion_r123`,
};
const reply = {
  ...original,
  id: "reply",
  body: "The linked reply",
  url: `${detail.url}#discussion_r456`,
};
const reviewed: PullRequestDetailView = {
  ...detail,
  reviewThreads: [
    {
      id: "thread",
      path: "src/example.ts",
      line: 60,
      side: "right",
      isResolved: true,
      isOutdated: true,
      comments: [original, reply],
    },
  ],
};
const tab = (
  id: string | undefined,
  onHandled: (id: string) => void,
  value = reviewed,
  anchor = "#discussion_r456",
) => (
  <div style={{ height: 220 }}>
    <PullRequestTimelineTab
      scrollerRef={() => {}}
      detail={value}
      environmentId={EnvironmentId.make("environment")}
      reference={value}
      order="newest"
      onOpenCommit={() => {}}
      onRefresh={() => {}}
      commentRequest={id === undefined ? undefined : { id, anchor }}
      onCommentRequestHandled={onHandled}
    />
  </div>
);

it("reveals and focuses a reply inside a resolved review thread and repeats navigation", async () => {
  const handled = vi.fn();
  await using screen = await render(tab("first", handled));
  await expect.element(screen.getByText("The linked reply")).toBeVisible();
  await vi.waitFor(() => expect(document.activeElement?.textContent).toContain("The linked reply"));
  await vi.waitFor(() => expect(handled).toHaveBeenCalledWith("first"));
  const target = screen.getByText("The linked reply").element().closest("article")!;
  target.blur();
  await screen.rerender(tab("second", handled));
  await vi.waitFor(() => expect(document.activeElement).toBe(target));
  await vi.waitFor(() => expect(handled).toHaveBeenCalledWith("second"));
});

it("opens a collapsed ordinary comment group for an issue comment link", async () => {
  const value: PullRequestDetailView = {
    ...detail,
    comments: [
      {
        ...original,
        kind: "issue-comment",
        path: null,
        reviewState: null,
        body: "Linked conversation comment",
        url: `${detail.url}#issuecomment-789`,
      },
    ],
  };
  const handled = vi.fn();
  await using screen = await render(tab("issue", handled, value, "#issuecomment-789"));
  await expect.element(screen.getByText("Linked conversation comment")).toBeVisible();
  await vi.waitFor(() =>
    expect(document.activeElement?.textContent).toContain("Linked conversation comment"),
  );
  await vi.waitFor(() => expect(handled).toHaveBeenCalledWith("issue"));
});

it("scrolls a late comment request inside a long collapsed conversation into the viewport", async () => {
  const value: PullRequestDetailView = {
    ...detail,
    comments: [
      ...Array.from({ length: 20 }, (_, index) => ({
        ...original,
        id: `other-${index}`,
        kind: "issue-comment" as const,
        path: null,
        reviewState: null,
        body: `Other conversation comment ${index}`,
        createdAt: "2026-09-02T00:00:00Z",
        url: `${detail.url}#issuecomment-${1000 + index}`,
      })),
      {
        ...original,
        kind: "issue-comment",
        path: null,
        reviewState: null,
        body: "Deep linked comment",
        url: `${detail.url}#issuecomment-789`,
      },
    ],
  };
  const handled = vi.fn();
  await using screen = await render(tab(undefined, handled, value, "#issuecomment-789"));
  await screen.rerender(tab("late", handled, value, "#issuecomment-789"));
  await vi.waitFor(() => {
    const target = screen.getByText("Deep linked comment").element().closest("article")!;
    const scroller = screen.container.querySelector(".scrollbar-gutter-both")!;
    const bounds = target.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    expect(document.activeElement).toBe(target);
    expect(bounds.top).toBeGreaterThanOrEqual(viewport.top);
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.bottom);
  });
  expect(handled).toHaveBeenCalledWith("late");
});

import "../../index.css";
const COMMITS = 2000;

const hugeDetail: PullRequestDetailView = {
  provider: SourceControlProviderKind.make("github"),
  projectId: ProjectId.make("project"),
  projectTitle: "Project",
  workspaceRoot: "/workspace",
  repository: "owner/repo",
  number: 1,
  title: "Huge pull request",
  body: "",
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
  checks: [],
  comments: [],
  commentCount: 0,
  commentsTruncated: false,
  reviewThreads: [],
  commits: Array.from({ length: COMMITS }, (_, index) => ({
    oid: `${index.toString(16).padStart(7, "0")}${"0".repeat(33)}`,
    messageHeadline: `Commit number ${index}`,
    committedDate: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
  })),
  mergeCapabilities: { merge: false, squash: false, rebase: false },
  capabilities: {
    diff: true,
    comment: true,
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

it("mounts only the timeline rows near the viewport of a huge pull request", async () => {
  await using screen = await render(
    <div style={{ height: 600 }}>
      <PullRequestTimelineTab
        scrollerRef={() => {}}
        detail={hugeDetail}
        environmentId={EnvironmentId.make("environment")}
        reference={hugeDetail}
        order="oldest"
        onOpenCommit={() => {}}
        onRefresh={() => {}}
      />
    </div>,
  );
  await expect.element(screen.getByText("Commit number 0")).toBeVisible();
  const mounted = screen.container.querySelectorAll("button").length;
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThan(COMMITS / 10);
});

it.each(["review", "issue-comment", "resolved-reply"] as const)(
  "reveals a linked %s below the virtual viewport",
  async (kind) => {
    const url = `${detail.url}#${kind === "review" ? "pullrequestreview-123" : kind === "issue-comment" ? "issuecomment-123" : "discussion_r123"}`;
    const linkedDetail: PullRequestDetailView = {
      ...detail,
      comments:
        kind === "resolved-reply"
          ? []
          : [
              {
                id: "linked",
                kind,
                author: detail.author,
                body: "Linked reply",
                createdAt: "2026-10-01T00:00:00Z",
                url,
                path: null,
                reviewState: kind === "review" ? "CHANGES_REQUESTED" : null,
              },
            ],
      reviewThreads:
        kind !== "resolved-reply"
          ? []
          : [
              {
                id: "thread",
                path: "src/test.ts",
                line: 5,
                side: "right",
                isResolved: true,
                isOutdated: false,
                comments: [
                  {
                    id: "root",
                    author: detail.author,
                    body: "Root comment",
                    createdAt: "2026-10-01T00:00:00Z",
                    url: `${detail.url}#discussion_r122`,
                  },
                  {
                    id: "reply",
                    author: detail.author,
                    body: "Linked reply",
                    createdAt: "2026-10-01T00:01:00Z",
                    url,
                  },
                ],
              },
            ],
    };
    const settled = vi.fn();
    await using screen = await render(
      <div style={{ height: 600 }}>
        <PullRequestTimelineTab
          scrollerRef={() => {}}
          detail={linkedDetail}
          environmentId={EnvironmentId.make("environment")}
          reference={detail}
          order="oldest"
          onOpenCommit={() => {}}
          onRefresh={() => {}}
          revealUrl={url}
          onRevealSettled={settled}
        />
      </div>,
    );
    await expect.element(screen.getByText("Linked reply", { exact: true })).toBeVisible();
    await vi.waitFor(() => expect(settled).toHaveBeenCalledWith(url));
    await screen.rerender(
      <div style={{ height: 600 }}>
        <PullRequestTimelineTab
          scrollerRef={() => {}}
          detail={linkedDetail}
          environmentId={EnvironmentId.make("environment")}
          reference={detail}
          order="oldest"
          onOpenCommit={() => {}}
          onRefresh={() => {}}
          onRevealSettled={settled}
        />
      </div>,
    );
    await expect.element(screen.getByText("Linked reply", { exact: true })).toBeVisible();
  },
);

it("gives each comment and review a heading for screen reader navigation", async () => {
  const commented: PullRequestDetailView = {
    ...detail,
    commits: [],
    comments: [
      {
        id: "review",
        kind: "review",
        author: { login: "bob", name: null, avatarUrl: null },
        body: "Looks good",
        createdAt: "2026-10-01T00:00:00Z",
        url: `${detail.url}#pullrequestreview-1`,
        path: null,
        reviewState: "APPROVED",
      },
      {
        id: "comment",
        kind: "issue-comment",
        author: { login: "alice", name: null, avatarUrl: null },
        body: "One question",
        createdAt: "2026-10-01T00:01:00Z",
        url: `${detail.url}#issuecomment-2`,
        path: null,
        reviewState: null,
      },
    ],
  };
  await using screen = await render(
    <div style={{ height: 600 }}>
      <PullRequestTimelineTab
        scrollerRef={() => {}}
        detail={commented}
        environmentId={EnvironmentId.make("environment")}
        reference={detail}
        order="oldest"
        onOpenCommit={() => {}}
        onRefresh={() => {}}
      />
    </div>,
  );
  await expect.element(screen.getByRole("heading", { name: /bob approved/i })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: /1 comment/ }));
  await expect.element(screen.getByText("One question", { exact: true })).toBeVisible();
  await expect.element(screen.getByRole("heading", { name: /alice commented/ })).toBeVisible();
});
