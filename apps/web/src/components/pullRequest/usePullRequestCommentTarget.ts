import { useEffect, useEffectEvent, useRef } from "react";
import { observeResize } from "~/lib/observeResize";
import {
  isPullRequestCommentTarget,
  type PullRequestCommentRequest,
} from "~/lib/pullRequestCommentLink";

export function usePullRequestCommentTarget<T extends HTMLElement = HTMLElement>(
  url: string | null,
  request: PullRequestCommentRequest | undefined,
  onHandled: ((requestId: string) => void) | undefined,
) {
  const ref = useRef<T>(null);
  const requestId = request?.id;
  const matches = isPullRequestCommentTarget(url, request);
  const handled = useEffectEvent((id: string) => onHandled?.(id));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize a linked comment with browser scrolling and focus after its discussion opens.
  useEffect(() => {
    const node = ref.current;
    if (!matches || requestId === undefined || !node) return;
    const ancestors: Element[] = [];
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      ancestors.push(parent);
      if (parent.classList.contains("scrollbar-gutter-both")) break;
    }
    let acknowledged = false;
    const stopObserving = observeResize(ancestors, () => {
      node.scrollIntoView({ block: "center", inline: "nearest" });
      if (!acknowledged) {
        acknowledged = true;
        handled(requestId);
      }
    });
    node.scrollIntoView({ block: "center", inline: "nearest" });
    node.focus({ preventScroll: true });
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      node.animate([{ backgroundColor: "var(--accent)" }, { backgroundColor: "transparent" }], {
        duration: 2000,
      });
    }
    return stopObserving;
  }, [matches, requestId]);
  return ref;
}
