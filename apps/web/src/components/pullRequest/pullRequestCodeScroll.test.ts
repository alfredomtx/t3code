import type { CodeViewScrollTarget } from "@pierre/diffs";
import { expect, it } from "vite-plus/test";
import { createPullRequestCodeScroll } from "./pullRequestCodeScroll";

it("restores the file and offset after its page loads without replacing the saved position with startup scrolling", () => {
  const items = new Map([
    ["first", 0],
    ["later", 1000],
  ]);
  const scrolls: CodeViewScrollTarget[] = [];
  const viewer = {
    getRenderedItems: () => [...items.keys()].map((id) => ({ id, item: { collapsed: false } })),
    getTopForItem: (id: string) => items.get(id),
    scrollTo: (target: CodeViewScrollTarget) => scrolls.push(target),
  };
  const key = "thread-a:pr-one:page-test";
  createPullRequestCodeScroll(key).save(1400, viewer);
  const restored = createPullRequestCodeScroll(key);
  expect(restored.expandedFileId).toBe("later");
  items.delete("later");
  restored.save(0, viewer);
  restored.restore(viewer);
  expect(scrolls).toEqual([]);
  items.set("later", 1100);
  restored.restore(viewer);
  restored.restore(viewer);
  expect(scrolls).toEqual([{ type: "item", id: "later", align: "start", offset: -400 }]);
  createPullRequestCodeScroll("thread-b:pr-one:page-test").restore(viewer);
  expect(scrolls).toHaveLength(1);
});

it("gives an explicit file reveal precedence over a saved scroll position", () => {
  const scrolls: CodeViewScrollTarget[] = [];
  const viewer = {
    getRenderedItems: () => [{ id: "first", item: { collapsed: false } }],
    getTopForItem: () => 0,
    scrollTo: (target: CodeViewScrollTarget) => scrolls.push(target),
  };
  const key = "thread-a:pr-two:reveal-test";
  createPullRequestCodeScroll(key).save(100, viewer);
  const restored = createPullRequestCodeScroll(key);
  restored.cancel();
  restored.restore(viewer);
  expect(scrolls).toEqual([]);
});
