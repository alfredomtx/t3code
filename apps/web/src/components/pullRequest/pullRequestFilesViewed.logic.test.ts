import { describe, expect, it } from "vite-plus/test";

import {
  isFileViewed,
  isStaleViewedState,
  toFileViewedStates,
  type FileViewedOverlay,
} from "./pullRequestFilesViewed.logic";

const NO_OVERLAY: FileViewedOverlay = new Map();

const states = toFileViewedStates({
  files: [
    { path: "a.ts", state: "viewed" },
    { path: "b.ts", state: "unviewed" },
    { path: "c.ts", state: "dismissed" },
  ],
  truncated: false,
});

describe("isFileViewed", () => {
  it("reads a file pushed to since it was cleared as unread", () => {
    expect(isFileViewed("c.ts", states, NO_OVERLAY)).toBe(false);
    expect(isStaleViewedState(states?.get("c.ts"))).toBe(true);
    expect(isStaleViewedState(states?.get("a.ts"))).toBe(false);
  });

  it("shows the press ahead of the host's answer", () => {
    expect(isFileViewed("b.ts", states, new Map([["b.ts", true]]))).toBe(true);
    expect(isFileViewed("a.ts", states, new Map([["a.ts", false]]))).toBe(false);
  });
});

describe("toFileViewedBatch", () => {
  it.each([501, 1001])("bounds each drain of %i paths to 500", async (count) => {
    const { toFileViewedBatch } = await import("./pullRequestFilesViewed.logic");
    const queued = new Map(Array.from({ length: count }, (_, n) => [`${n}.ts`, true]));
    const sizes: number[] = [];
    while (queued.size > 0) {
      const batch = toFileViewedBatch(queued);
      sizes.push(batch.length);
      for (const file of batch) queued.delete(file.path);
    }
    expect(sizes).toEqual(count === 501 ? [500, 1] : [500, 500, 1]);
  });
});
