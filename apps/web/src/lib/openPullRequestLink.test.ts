import { describe, expect, it } from "vite-plus/test";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { parsePullRequestLink, shouldOpenPullRequestExternally } from "./openPullRequestLink";
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
  it.each(["commits", "changes"])("selects the full commit from a GitHub %s URL", (route) => {
    const url = `https://github.com/acme/repo/pull/42/${route}/${oid.toUpperCase()}?diff=split#file`;
    expect(parsePullRequestLink(url)).toEqual({
      ...parseChangeRequestUrl(url),
      commitOid: oid,
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
    expect(parsePullRequestLink(url)).toEqual({ ...parseChangeRequestUrl(url), commitOid: null });
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
    expect(parsePullRequestLink(url)).toEqual({ ...parseChangeRequestUrl(url), commitOid: null });
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
