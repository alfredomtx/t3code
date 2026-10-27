import type { AnyRouter } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import * as session from "../state/session";
import * as previewRuntime from "../browser/previewRuntime";
import { subscribePreviewAction } from "../components/preview/previewActionBus";
import { dispatchMenuAction } from "./dispatcher";

import { useThreadSelectionStore } from "../threadSelectionStore";
import { installChatRouteCommands } from "./chatRouteCommands";

vi.mock(import("../state/session"), { spy: true });
vi.mock(import("../browser/previewRuntime"), { spy: true });

type Match = {
  readonly routeId: string;
  readonly pathname: string;
  readonly params?: Record<string, string>;
};

function routerAt(matches: Match[]) {
  const state = { matches: matches.map((match) => ({ ...match, params: match.params ?? {} })) };
  return {
    router: { state } as unknown as AnyRouter,
    navigate: (next: Match[]) => {
      state.matches = next.map((match) => ({ ...match, params: match.params ?? {} }));
    },
  };
}

const CHAT: Match[] = [
  { routeId: "__root__", pathname: "/" },
  { routeId: "/_chat", pathname: "/" },
];

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
  window.dispatchEvent(event);
  return event;
}

function selectThread(threadKey: string) {
  useThreadSelectionStore.getState().clearSelection();
  useThreadSelectionStore.getState().toggleThread(threadKey);
}

describe("chat route commands", () => {
  it("clears a selection made after install, reading the store at keypress time", () => {
    const { router } = routerAt(CHAT);
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    stack.defer(() => useThreadSelectionStore.getState().clearSelection());

    selectThread("env:thread-1");
    const event = pressEscape();

    expect(event.defaultPrevented).toBe(true);
    expect(useThreadSelectionStore.getState().selectedThreadKeys.size).toBe(0);
    // With nothing selected, Escape is left for other handlers.
    expect(pressEscape().defaultPrevented).toBe(false);
  });

  it("stays out of the way off the chat route and under modal pages", () => {
    const { router, navigate } = routerAt([{ routeId: "__root__", pathname: "/pair" }]);
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    stack.defer(() => useThreadSelectionStore.getState().clearSelection());
    selectThread("env:thread-1");

    expect(pressEscape().defaultPrevented).toBe(false);

    navigate([...CHAT, { routeId: "/_chat/settings", pathname: "/settings" }]);
    expect(pressEscape().defaultPrevented).toBe(false);
    expect(useThreadSelectionStore.getState().selectedThreadKeys.size).toBe(1);

    navigate(CHAT);
    expect(pressEscape().defaultPrevented).toBe(true);
  });
});

it.each(["server", "draft"] as const)(
  "keeps native preview shortcuts live on a %s route and blocks modal pages",
  (kind) => {
    using _scope = vi.spyOn(session, "readEnvironmentScope").mockReturnValue(true);
    using _preview = vi.spyOn(previewRuntime, "isPreviewAvailableFor").mockReturnValue(true);
    using stack = new DisposableStack();
    const previousDrafts = useComposerDraftStore.getState();
    stack.defer(() => useComposerDraftStore.setState(previousDrafts, true));
    useComposerDraftStore
      .getState()
      .setProjectDraftThreadId(
        scopeProjectRef(EnvironmentId.make("local"), ProjectId.make("project-shortcuts")),
        DraftId.make("draft-shortcuts"),
      );
    const params =
      kind === "draft"
        ? { draftId: "draft-shortcuts" }
        : { environmentId: "local", threadId: "thread-shortcuts" };
    const matches = [...CHAT, { routeId: "/_chat/thread", pathname: "/thread", params }];
    const { router, navigate } = routerAt(matches);
    stack.defer(installChatRouteCommands(router));
    const received = vi.fn();
    stack.defer(subscribePreviewAction(received));
    dispatchMenuAction("preview.refresh");
    expect(received).toHaveBeenCalledExactlyOnceWith("refresh");
    navigate([...matches, { routeId: "/_chat/settings", pathname: "/settings" }]);
    dispatchMenuAction("preview.refresh");
    expect(received).toHaveBeenCalledOnce();
  },
);
