import type { CodeViewScrollTarget } from "@pierre/diffs";
import { LRUCache } from "~/lib/lruCache";

interface ScrollViewer {
  getRenderedItems(): ReadonlyArray<{ id: string; item: { collapsed?: boolean } }>;
  getTopForItem(id: string): number | undefined;
  scrollTo(target: CodeViewScrollTarget): void;
}

const positions = new LRUCache<{ id: string; offset: number; expanded: boolean }>(100, 64 * 1024);

export function createPullRequestCodeScroll(key: string) {
  const saved = positions.get(key);
  let pending = saved;
  return {
    expandedFileId: saved?.expanded ? saved.id : null,
    save(position: number, viewer: ScrollViewer) {
      if (pending !== null) return;
      const item = viewer.getRenderedItems().findLast((item) => {
        const top = viewer.getTopForItem(item.id);
        return top !== undefined && top <= position;
      });
      if (!item) return;
      const top = viewer.getTopForItem(item.id);
      if (top !== undefined)
        positions.set(
          key,
          { id: item.id, offset: top - position, expanded: item.item.collapsed !== true },
          (key.length + item.id.length) * 2 + 8,
        );
    },
    restore(viewer: ScrollViewer) {
      if (pending === null || viewer.getTopForItem(pending.id) === undefined) return;
      const { id, offset } = pending;
      pending = null;
      viewer.scrollTo({ type: "item", id, align: "start", offset });
    },
    cancel() {
      pending = null;
    },
  };
}
