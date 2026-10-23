import { useEffect, useRef } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import type { ChatComposerHandle } from "./ChatComposer";
import { COMPOSER_CONTEXT_CLIPBOARD_MIME } from "@t3tools/shared/composerContextClipboard";
import { MessageCopyButton } from "./MessageCopyButton";
import { anchoredToastManager } from "../ui/toast";
import { useChatShortcuts } from "./useChatShortcuts";

const shortcutContext = {
  terminalFocus: false,
  terminalOpen: false,
  previewFocus: false,
  previewOpen: false,
  isWeb: true,
  isDesktop: false,
  modelPickerOpen: false,
};

const focusOnMount = (element: HTMLElement | null) => element?.focus();

// Stands in for the right panel's launcher, which needs the whole app around it. Like the
// real one it takes focus, advertises its letters in `data-surface-launcher-keys`, and
// claims one from its own window capture listener unless the key was already handled.
function Launcher(props: { keys: string; received: string[] }) {
  useEffect(() => {
    const claim = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!props.keys.toLowerCase().split("").includes(event.key.toLowerCase())) return;
      event.preventDefault();
      props.received.push(event.key);
    };
    window.addEventListener("keydown", claim, true);
    return () => window.removeEventListener("keydown", claim, true);
  }, [props.keys, props.received]);
  return (
    <div
      ref={focusOnMount}
      tabIndex={0}
      aria-label="Open a surface"
      data-surface-launcher-keys={props.keys}
    />
  );
}

// The chat's shortcut listener registers when the chat mounts, so a launcher that opens
// later registers after it. Tests mount the chat first and add the launcher by rerendering.
function Chat(props: { composerKeys: string[]; launcher?: { keys: string; received: string[] } }) {
  useChatShortcuts({
    enabled: true,
    getTimelineScrollableNode: () => null,
    keybindings: [],
    scriptKeybindings: [],
    getShortcutContext: () => shortcutContext,
    threadFindActive: false,
    // Type-to-focus only calls insertTextAtEnd, so the stand-in composer implements just that.
    composerRef: {
      current: {
        insertTextAtEnd: (key: string) => {
          props.composerKeys.push(key);
          return true;
        },
      } as Partial<ChatComposerHandle> as ChatComposerHandle,
    },
    branchToolbarRef: { current: null },
    closeThreadFind: () => {},
    commands: {},
    fallback: () => undefined,
  });
  return props.launcher ? <Launcher {...props.launcher} /> : null;
}

// router: false because the chat shortcuts and the launcher stand-in never navigate.
const options = { router: false } as const;

it("leaves the launcher's letters to the launcher, in either case", async () => {
  const composerKeys: string[] = [];
  const received: string[] = [];
  await using screen = await render(<Chat composerKeys={composerKeys} />, options);
  await screen.rerender(<Chat composerKeys={composerKeys} launcher={{ keys: "BT", received }} />);

  await userEvent.keyboard("tT");

  expect(received).toEqual(["t", "T"]);
  expect(composerKeys).toEqual([]);
});

it("still types other letters into the composer while the launcher is open", async () => {
  const composerKeys: string[] = [];
  const received: string[] = [];
  await using screen = await render(<Chat composerKeys={composerKeys} />, options);
  await screen.rerender(<Chat composerKeys={composerKeys} launcher={{ keys: "BT", received }} />);

  await userEvent.keyboard("a");

  expect(composerKeys).toEqual(["a"]);
  expect(received).toEqual([]);
});

const altV = { key: "√", code: "KeyV", altKey: true, bubbles: true, cancelable: true };

function HoverChat({
  conflict = false,
  available = true,
  detached = false,
  context = false,
}: {
  conflict?: boolean;
  available?: boolean;
  detached?: boolean;
  context?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useChatShortcuts({
    enabled: true,
    getTimelineScrollableNode: () => (available ? root.current : null),
    keybindings: conflict
      ? [
          {
            command: "chat.find",
            shortcut: {
              key: "v",
              altKey: true,
              ctrlKey: false,
              metaKey: false,
              shiftKey: false,
              modKey: false,
            },
          },
        ]
      : [],
    scriptKeybindings: [],
    getShortcutContext: () => shortcutContext,
    threadFindActive: false,
    composerRef: { current: null },
    branchToolbarRef: { current: null },
    closeThreadFind: () => {},
    commands: { "chat.find": () => false },
    fallback: () => undefined,
  });
  return (
    <div data-chat-column>
      <form>
        <div
          data-testid="composer-editor"
          aria-label="Composer"
          contentEditable
          suppressContentEditableWarning
        />
      </form>
      <input aria-label="Other input" />
      <div ref={root}>
        <div data-timeline-row-kind="message" data-message-id="a" style={{ padding: 20 }}>
          <span data-testid="body-a">Message A</span>
          {!detached && (
            <MessageCopyButton
              primaryMessage
              text="Message A payload"
              variant="ghost"
              {...(context
                ? { extraFlavors: { [COMPOSER_CONTEXT_CLIPBOARD_MIME]: "context-fragment" } }
                : {})}
            />
          )}
          <MessageCopyButton text="prompt-link" label="Copy prompt link" />
        </div>
        <div data-timeline-row-kind="message" data-message-id="b" style={{ padding: 20 }}>
          <span data-testid="body-b">Message B</span>
          <MessageCopyButton primaryMessage text="Message B payload" variant="ghost" />
        </div>
        {detached && (
          <div data-timeline-row-kind="assistant-meta" data-message-id="a">
            <MessageCopyButton primaryMessage text="Message A payload" variant="ghost" />
          </div>
        )}
      </div>
    </div>
  );
}

function pointAt(element: Element) {
  const rect = element.getBoundingClientRect();
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
      pointerType: "mouse",
    }),
  );
}

function pressCopy(target: Element, overrides: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { ...altV, ...overrides });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

it.each([false, true])(
  "copies the exact primary action with composer focus, detached=%s",
  async (detached) => {
    await using screen = await render(<HoverChat detached={detached} />, options);
    using write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    using _toast = vi.spyOn(anchoredToastManager, "add").mockReturnValue("copy-test");
    const editor = screen.getByLabelText("Composer").element();
    if (!(editor instanceof HTMLElement)) throw new Error("Composer is missing");
    editor.focus();
    pointAt(screen.getByTestId("body-a").element());
    await act(() => {
      expect(pressCopy(editor)).toBe(true);
    });
    await vi.waitFor(() => expect(write).toHaveBeenCalledExactlyOnceWith("Message A payload"));
    const primary = screen.container.querySelector("[data-message-primary-copy]");
    const copied = detached
      ? screen.container.querySelector('[data-timeline-row-kind="assistant-meta"] button')
      : primary;
    expect(copied).toBeInstanceOf(HTMLButtonElement);
    expect(copied?.hasAttribute("disabled")).toBe(true);
    expect(_toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Copied!", positionerProps: { anchor: copied } }),
    );
    expect(pressCopy(editor)).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
  },
);

it("yields to a configured command even when its handler declines", async () => {
  await using screen = await render(<HoverChat conflict />, options);
  using write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const editor = screen.getByLabelText("Composer").element();
  pointAt(screen.getByTestId("body-a").element());
  expect(pressCopy(editor)).toBe(false);
  expect(write).not.toHaveBeenCalled();
});

it("does not intercept unavailable, covered, or unrelated editable targets", async () => {
  await using screen = await render(<HoverChat available={false} />, options);
  using write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const editor = screen.getByLabelText("Composer").element();
  pointAt(screen.getByTestId("body-a").element());
  expect(pressCopy(editor)).toBe(false);
  await screen.rerender(<HoverChat />);
  const input = screen.getByLabelText("Other input").element();
  if (!(input instanceof HTMLInputElement)) throw new Error("Input is missing");
  input.focus();
  expect(pressCopy(input)).toBe(false);
  input.blur();
  const body = screen.getByTestId("body-a").element();
  pointAt(body);
  const cover = document.createElement("div");
  cover.style.cssText = "position:fixed;inset:0;z-index:99999";
  document.body.append(cover);
  using _overlay = { [Symbol.dispose]: () => cover.remove() };
  expect(pressCopy(editor)).toBe(false);
  expect(write).not.toHaveBeenCalled();
});

it.each([
  { repeat: true },
  { isComposing: true },
  { keyCode: 229 },
  { shiftKey: true },
  { ctrlKey: true },
  { metaKey: true },
])("does not intercept unsafe key variants %j", async (overrides) => {
  await using screen = await render(<HoverChat />, options);
  using write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  pointAt(screen.getByTestId("body-a").element());
  expect(pressCopy(screen.getByLabelText("Composer").element(), overrides)).toBe(false);
  expect(write).not.toHaveBeenCalled();
});

it("re-hit-tests the latest coordinates after rows move under a stationary pointer", async () => {
  await using screen = await render(<HoverChat />, options);
  using write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  using _toast = vi.spyOn(anchoredToastManager, "add").mockReturnValue("copy-test");
  const first = screen.getByTestId("body-a").element().closest("[data-timeline-row-kind]");
  const second = screen.getByTestId("body-b").element().closest("[data-timeline-row-kind]");
  if (!first || !second) throw new Error("Rows are missing");
  pointAt(screen.getByTestId("body-a").element());
  first.before(second);
  await act(() => {
    expect(pressCopy(screen.getByLabelText("Composer").element())).toBe(true);
  });
  await vi.waitFor(() => expect(write).toHaveBeenCalledExactlyOnceWith("Message B payload"));
});

it("uses the primary button's context MIME and HTML clipboard payload", async () => {
  await using screen = await render(<HoverChat context />, options);
  using write = vi.spyOn(navigator.clipboard, "write").mockResolvedValue();
  using plain = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  using _toast = vi.spyOn(anchoredToastManager, "add").mockReturnValue("copy-test");
  pointAt(screen.getByTestId("body-a").element());
  await act(() => {
    expect(pressCopy(screen.getByLabelText("Composer").element())).toBe(true);
  });
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  const item = write.mock.calls[0]?.[0][0];
  if (!item) throw new Error("Clipboard item is missing");
  expect(await (await item.getType("text/plain")).text()).toBe("Message A payload");
  expect(await (await item.getType(COMPOSER_CONTEXT_CLIPBOARD_MIME)).text()).toBe(
    "context-fragment",
  );
  expect(await (await item.getType("text/html")).text()).toContain("Message A payload");
  expect(plain).not.toHaveBeenCalled();
});

it("leaves AltGraph, prevented events, and missing pointer targets untouched", async () => {
  await using screen = await render(<HoverChat />, options);
  using write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const editor = screen.getByLabelText("Composer").element();
  expect(pressCopy(editor)).toBe(false);
  pointAt(screen.getByTestId("body-a").element());
  const altGraph = new KeyboardEvent("keydown", altV);
  using _modifier = vi.spyOn(altGraph, "getModifierState").mockReturnValue(true);
  editor.dispatchEvent(altGraph);
  expect(altGraph.defaultPrevented).toBe(false);
  const prevented = new KeyboardEvent("keydown", altV);
  prevented.preventDefault();
  editor.dispatchEvent(prevented);
  expect(write).not.toHaveBeenCalled();
});
