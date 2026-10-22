import type { FileDiffMetadata } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import {
  isFileDiffCollapsed,
  isLineInFileDiff,
  setFileDiffCollapsed,
} from "./pullRequestDiff.logic";

function fileWithHunks(
  hunks: ReadonlyArray<{
    deletionStart: number;
    deletionCount: number;
    additionStart: number;
    additionCount: number;
  }>,
): FileDiffMetadata {
  return { name: "src/app.ts", hunks } as unknown as FileDiffMetadata;
}

describe("isLineInFileDiff", () => {
  const file = fileWithHunks([
    { deletionStart: 10, deletionCount: 3, additionStart: 10, additionCount: 5 },
    { deletionStart: 40, deletionCount: 0, additionStart: 42, additionCount: 2 },
  ]);

  it("includes the first line of a hunk and excludes the one past its last", () => {
    expect(isLineInFileDiff(file, "right", 10)).toBe(true);
    expect(isLineInFileDiff(file, "right", 14)).toBe(true);
    expect(isLineInFileDiff(file, "right", 15)).toBe(false);
    expect(isLineInFileDiff(file, "left", 9)).toBe(false);
    expect(isLineInFileDiff(file, "left", 12)).toBe(true);
    expect(isLineInFileDiff(file, "left", 13)).toBe(false);
  });

  it("keeps the two sides apart, since one line number means two lines", () => {
    expect(isLineInFileDiff(file, "right", 43)).toBe(true);
    expect(isLineInFileDiff(file, "left", 40)).toBe(false);
  });
});

describe("isFileDiffCollapsed", () => {
  it("keeps a file the reader folded closed as the next slice arrives", () => {
    const choices = new Map([["b.ts", true]]);
    expect(isFileDiffCollapsed("b.ts", null, choices, false)).toBe(true);
    expect(isFileDiffCollapsed("c.ts", null, choices, false)).toBe(false);
  });

  it("collapses an untouched file when its viewed default is collapsed", () => {
    expect(isFileDiffCollapsed("viewed.ts", null, new Map(), true)).toBe(true);
  });

  it("follows changing defaults only for files without an explicit choice", () => {
    for (const defaultCollapsed of [false, true]) {
      expect(isFileDiffCollapsed("a.ts", null, new Map(), defaultCollapsed)).toBe(defaultCollapsed);
      expect(isFileDiffCollapsed("a.ts", null, new Map([["a.ts", false]]), defaultCollapsed)).toBe(
        false,
      );
      expect(isFileDiffCollapsed("a.ts", null, new Map([["a.ts", true]]), defaultCollapsed)).toBe(
        true,
      );
    }
  });

  it("applies bulk choices to later pages and lets a file override bulk", () => {
    for (const defaultCollapsed of [false, true]) {
      expect(isFileDiffCollapsed("later.ts", "expanded", new Map(), defaultCollapsed)).toBe(false);
      expect(isFileDiffCollapsed("later.ts", "folded", new Map(), defaultCollapsed)).toBe(true);
      expect(
        isFileDiffCollapsed("a.ts", "folded", new Map([["a.ts", false]]), defaultCollapsed),
      ).toBe(false);
      expect(
        isFileDiffCollapsed("a.ts", "expanded", new Map([["a.ts", true]]), defaultCollapsed),
      ).toBe(true);
    }
  });
});

describe("setFileDiffCollapsed", () => {
  it("sets absolute checkbox targets against a bulk choice", () => {
    const folded = setFileDiffCollapsed("a.ts", true, new Map());
    expect(isFileDiffCollapsed("a.ts", "expanded", folded, false)).toBe(true);
    const expanded = setFileDiffCollapsed("a.ts", false, folded);
    expect(isFileDiffCollapsed("a.ts", "folded", expanded, true)).toBe(false);
  });

  it("retains an explicit reveal through late viewed data and repeated reveals", () => {
    const choices = new Map<string, boolean>();
    const expanded = setFileDiffCollapsed("a.ts", false, choices);
    expect(choices.size).toBe(0);
    expect(expanded.get("a.ts")).toBe(false);
    expect(isFileDiffCollapsed("a.ts", null, expanded, false)).toBe(false);
    expect(isFileDiffCollapsed("a.ts", null, expanded, true)).toBe(false);
    expect(setFileDiffCollapsed("a.ts", false, expanded)).toBe(expanded);
  });

  it("retains the last manual choice across changing defaults", () => {
    const collapsed = setFileDiffCollapsed("a.ts", true, new Map());
    const expanded = setFileDiffCollapsed("a.ts", false, collapsed);
    for (const defaultCollapsed of [false, true]) {
      expect(isFileDiffCollapsed("a.ts", null, collapsed, defaultCollapsed)).toBe(true);
      expect(isFileDiffCollapsed("a.ts", null, expanded, defaultCollapsed)).toBe(false);
    }
  });
});
