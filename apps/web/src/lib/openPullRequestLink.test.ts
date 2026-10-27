import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import {
  parsePullRequestLink,
  shouldOpenPullRequestExternally,
  useOpenChangeRequestLink,
} from "./openPullRequestLink";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../hooks/useSettings", () => ({ useClientSettings: () => true }));
vi.mock("../browser/useOpenLink", () => ({ useOpenLink: () => vi.fn() }));
vi.mock("../state/environments", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make("env-1"),
}));
vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => new Map() } }));
vi.mock("../state/server", () => ({ environmentServerConfigsAtom: {} }));
vi.mock("../state/entities", () => ({ readProjects: () => [] }));
vi.mock("@t3tools/client-runtime/change-request-links", () => ({
  resolveChangeRequestLinkTarget: () => ({
    project: { id: "project-a", environmentId: EnvironmentId.make("env-1") },
    repository: "acme/repo",
    number: 42,
  }),
}));

describe("opening a PR link", () => {
  it.each([
    ["#discussion_r123", "timeline", "commentRequest"],
    [`/commits/${"a".repeat(40)}`, "code", "commitRequest"],
    [`/changes/${"a".repeat(40)}`, "code", "commitRequest"],
  ])("preserves the explicit destination for %s", (suffix, detailTab, request) => {
    useRightPanelStore.setState({ byThreadKey: {} });
    const ref = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-a"));
    const open = useOpenChangeRequestLink(ref);
    open(
      { preventDefault: vi.fn(), stopPropagation: vi.fn(), metaKey: false, ctrlKey: false },
      `https://github.com/acme/repo/pull/42${suffix}`,
    );
    const panel = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);
    expect(panel.surfaces).toHaveLength(1);
    expect(panel.surfaces[0]).toMatchObject({ detailTab });
    expect(panel.surfaces[0]).toHaveProperty(request);
  });

  it.each(["code", "timeline"] as const)(
    "returns an existing %s tab to Summary without opening a duplicate",
    (detailTab) => {
      useRightPanelStore.setState({ byThreadKey: {} });
      const ref = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-a"));
      const url = "https://github.com/acme/repo/pull/42";
      useRightPanelStore.getState().openPullRequest(ref, {
        projectId: "project-a",
        repository: "acme/repo",
        number: 42,
        detailTab,
        commitRequest: { id: "old-commit", oid: "a".repeat(40) },
        commentRequest: { id: "old-comment", anchor: "#discussion_r123" },
      });
      const open = useOpenChangeRequestLink(ref);
      expect(
        open(
          { preventDefault: vi.fn(), stopPropagation: vi.fn(), metaKey: false, ctrlKey: false },
          url,
        ),
      ).toBe(true);
      const panel = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);
      expect(panel.isOpen).toBe(true);
      expect(panel.surfaces).toHaveLength(1);
      expect(panel.surfaces[0]).toMatchObject({ url, detailTab: "summary" });
      expect(panel.surfaces[0]).not.toHaveProperty("commitRequest");
      expect(panel.surfaces[0]).not.toHaveProperty("commentRequest");
      expect(panel.activeSurfaceId).toBe(panel.surfaces[0]?.id);
    },
  );
});
const parseChangeRequestUrl = (url: string) =>
  sourceControlClients.parseChangeRequestUrl(url)?.link ?? null;

describe("parsePullRequestLink", () => {
  const oid = "abcdef0123456789abcdef0123456789abcdef01";
  it("accepts upstream enterprise host recognition", () => {
    expect(
      parsePullRequestLink(`https://github-example.test/acme/repo/pull/42/commits/${oid}`)
        ?.commitOid,
    ).toBe(oid);
  });
  it.each(["discussion_r123", "issuecomment-456", "pullrequestreview-789"])(
    "preserves a GitHub comment target %s",
    (anchor) => {
      expect(parsePullRequestLink(`https://github.com/acme/repo/pull/42#${anchor}`)).toMatchObject({
        commentAnchor: `#${anchor}`,
      });
    },
  );
  it.each(["discussion_r", "discussion_r0", "discussion_r123extra", "files"])(
    "ignores an invalid comment anchor %s",
    (anchor) => {
      expect(parsePullRequestLink(`https://github.com/acme/repo/pull/42#${anchor}`)).toMatchObject({
        commentAnchor: null,
      });
    },
  );
  it.each(["commits", "changes"])("selects the full commit from a GitHub %s URL", (route) => {
    const url = `https://github.com/acme/repo/pull/42/${route}/${oid.toUpperCase()}?diff=split#file`;
    expect(parsePullRequestLink(url)).toEqual({
      ...parseChangeRequestUrl(url),
      commitOid: oid,
      commentAnchor: null,
    });
    expect(
      parsePullRequestLink(`https://github.company.test/acme/repo/pull/42/${route}/${oid}/`)
        ?.commitOid,
    ).toBe(oid);
  });

  it.each([
    "",
    "/files",
    "/commits",
    `/commits/${oid.slice(0, 7)}`,
    `/commits/${oid}a`,
    `/commits/${"g".repeat(40)}`,
    `/commits/${oid}/files`,
    `/changes/${oid}%2F`,
    `/changes/%61${oid.slice(1)}`,
  ])("keeps ordinary PR behavior for the suffix %s", (suffix) => {
    const url = `https://github.com/acme/repo/pull/42${suffix}`;
    expect(parsePullRequestLink(url)).toEqual({
      ...parseChangeRequestUrl(url),
      commitOid: null,
      commentAnchor: null,
    });
  });

  it.each([
    `https://github.com/acme/repo/commit/${oid}`,
    "not a URL",
    `ftp://github.com/acme/repo/pull/42/commits/${oid}`,
    `https://github.com/acme/repo/pull/0/commits/${oid}`,
  ])("does not claim %s", (url) => {
    expect(parsePullRequestLink(url)).toBeNull();
  });

  it.each([
    `https://gitlab.com/acme/repo/-/merge_requests/42/commits/${oid}`,
    `https://forge.example/acme/repo/pulls/42/commits/${oid}`,
    `https://bitbucket.org/acme/repo/pull-requests/42/commits/${oid}`,
  ])("preserves other hosts' PR identity for %s", (url) => {
    expect(parsePullRequestLink(url)).toEqual({
      ...parseChangeRequestUrl(url),
      commitOid: null,
      commentAnchor: null,
    });
  });
});

describe("shouldOpenPullRequestExternally", () => {
  it.each([
    [{ metaKey: false, ctrlKey: false, button: 0 }, false],
    [{ metaKey: true, ctrlKey: false, button: 0 }, true],
    [{ metaKey: false, ctrlKey: true, button: 0 }, true],
    [{ metaKey: false, ctrlKey: false, button: 1 }, true],
  ])("preserves browser navigation for %j", (event, expected) => {
    expect(shouldOpenPullRequestExternally(event)).toBe(expected);
  });
});
