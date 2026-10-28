import { useEffect, useEffectEvent, useRef } from "react";
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
    node.scrollIntoView({ block: "center", inline: "nearest" });
    node.focus({ preventScroll: true });
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      node.animate([{ backgroundColor: "var(--accent)" }, { backgroundColor: "transparent" }], {
        duration: 2000,
      });
    }
    handled(requestId);
  }, [matches, requestId]);
  return ref;
}
