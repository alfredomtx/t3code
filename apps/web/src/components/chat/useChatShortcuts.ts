import { matchesKeybindingShortcut } from "@t3tools/shared/keybindings";
import { isEditableFocused } from "../../lib/editableFocus";
import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef } from "react";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { resolveChatShortcutCommand, type ShortcutMatchContext } from "../../keybindings";
import { isTerminalCloseConfirmPending } from "../../lib/terminalCloseConfirm";
import {
  preventRepeatedTerminalCloseShortcut,
  preventTerminalCloseShortcut,
} from "../../lib/terminalCloseShortcut";
import { getTerminalFocusOwner, type TerminalFocusOwner } from "../../lib/terminalFocus";
import type { ComposerHandleRef } from "../../composerHandleContext";
import type { BranchToolbarHandle } from "../BranchToolbar";
import {
  shouldTypeToFocusComposer,
  TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR,
} from "./composerFocusRedirect";
import { composerShortcutCommands } from "./composerShortcuts";

/** Returning false lets the key event through untouched. */
export type ChatShortcutHandler = (context: {
  readonly event: KeyboardEvent;
  readonly terminalFocusOwner: TerminalFocusOwner | null;
}) => boolean | void;

export type ChatShortcutCommands = Partial<Record<KeybindingCommand, ChatShortcutHandler>>;

export interface ChatShortcutsInput {
  readonly enabled: boolean;
  readonly getTimelineScrollableNode: () => HTMLElement | null;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly scriptKeybindings: ResolvedKeybindingsConfig;
  readonly getShortcutContext: (target: EventTarget | null) => ShortcutMatchContext & {
    readonly modelPickerOpen: boolean;
  };
  readonly threadFindActive: boolean;
  /** Takes type-to-focus keys and the composer and branch toolbar chords. */
  readonly composerRef: ComposerHandleRef;
  readonly branchToolbarRef: { readonly current: BranchToolbarHandle | null };
  readonly closeThreadFind: () => void;
  readonly commands: ChatShortcutCommands;
  /** Handles commands not in `commands`, such as project scripts. */
  readonly fallback: (command: KeybindingCommand) => ChatShortcutHandler | undefined;
}

type PointerPoint = { clientX: number; clientY: number };

const MESSAGE_ROW_SELECTOR =
  '[data-timeline-row-kind="message"], [data-timeline-row-kind="assistant-meta"]';
const PROTECTED_COPY_OWNER_SELECTOR =
  '[role="dialog"], [role="application"], iframe, [inert], [aria-hidden="true"]';

function isRendered(element: HTMLElement): boolean {
  return (
    element.isConnected &&
    element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }) &&
    !element.closest('[inert], [aria-hidden="true"]')
  );
}

function allowsCopyInputOwner(element: Element | null, column: Element): boolean {
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  if (!element) return true;
  if (element.closest(PROTECTED_COPY_OWNER_SELECTOR)) return false;
  const ownerColumn = element.closest("[data-chat-column]");
  if (ownerColumn && ownerColumn !== column) return false;
  if (!isEditableFocused(element)) return true;
  const editor = element.closest('[data-testid="composer-editor"]');
  return (
    editor !== null &&
    editor.closest("[data-chat-column]") === column &&
    editor.closest("form") !== null
  );
}

function resolveHoveredPrimaryCopy(
  root: HTMLElement,
  pointer: PointerPoint,
): HTMLButtonElement | null {
  if (!isRendered(root)) return null;
  const hit = document.elementFromPoint(pointer.clientX, pointer.clientY);
  if (
    !hit ||
    !root.contains(hit) ||
    hit.closest('[role="dialog"], [role="application"], iframe, [inert]')
  )
    return null;
  const row = hit.closest(MESSAGE_ROW_SELECTOR);
  const messageId = row?.getAttribute("data-message-id");
  if (!(row instanceof HTMLElement) || !root.contains(row) || !messageId || !isRendered(row))
    return null;
  const buttons = Array.from(root.querySelectorAll("[data-message-primary-copy]")).filter(
    (button) => {
      const owner = button.closest(MESSAGE_ROW_SELECTOR);
      return (
        owner?.getAttribute("data-message-id") === messageId &&
        (owner === row || owner?.getAttribute("data-timeline-row-kind") === "assistant-meta")
      );
    },
  );
  const button = buttons.length === 1 ? buttons[0] : null;
  if (
    !(button instanceof HTMLButtonElement) ||
    button.matches(":disabled") ||
    button.getAttribute("aria-disabled") === "true" ||
    !isRendered(button)
  )
    return null;
  return button;
}

/**
 * The chat's window keyboard shortcuts, plus Escape closing thread find.
 * Listeners attach once; the effect events read the latest input, so handlers
 * act on the current render without re-registering on every change.
 */
export function useChatShortcuts(input: ChatShortcutsInput) {
  const pointer = useRef<PointerPoint | null>(null);
  const copyHoveredMessage = useEffectEvent(
    (event: KeyboardEvent, context: ShortcutMatchContext) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.getModifierState("AltGraph") ||
        context.terminalFocus ||
        context.previewFocus ||
        context.modelPickerOpen ||
        !matchesKeybindingShortcut(
          event,
          {
            key: "v",
            altKey: true,
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            modKey: false,
          },
          navigator.platform,
        ) ||
        document.querySelector(TYPE_TO_FOCUS_FLOATING_LAYER_SELECTOR)
      )
        return;
      const root = input.getTimelineScrollableNode();
      const column = root?.closest("[data-chat-column]");
      if (
        !root ||
        !column ||
        !pointer.current ||
        !allowsCopyInputOwner(document.activeElement, column) ||
        event
          .composedPath()
          .some((owner) => owner instanceof Element && !allowsCopyInputOwner(owner, column))
      )
        return;
      const button = resolveHoveredPrimaryCopy(root, pointer.current);
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      button.click();
    },
  );
  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    const { keybindings } = input;
    if (preventRepeatedTerminalCloseShortcut(event, keybindings)) {
      event.stopPropagation();
      return;
    }
    if (input.threadFindActive && event.key === "Escape") return;
    if (isTerminalCloseConfirmPending() && preventTerminalCloseShortcut(event, keybindings)) {
      event.stopPropagation();
      return;
    }
    if (!input.enabled || isCommandPaletteOpen()) return;
    const terminalFocusOwner = getTerminalFocusOwner();
    if (event.defaultPrevented && terminalFocusOwner === null) return;
    const shortcutContext = input.getShortcutContext(event.target);

    if (
      !shortcutContext.terminalFocus &&
      !shortcutContext.modelPickerOpen &&
      shouldTypeToFocusComposer(event) &&
      input.composerRef.current?.insertTextAtEnd(event.key) === true
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const command = resolveChatShortcutCommand(event, keybindings, input.scriptKeybindings, {
      context: shortcutContext,
    });
    if (!command) {
      copyHoveredMessage(event, shortcutContext);
      return;
    }
    const run =
      input.commands[command] ??
      composerShortcutCommands(input.composerRef, input.branchToolbarRef)[command] ??
      input.fallback(command);
    if (!run || run({ event, terminalFocusOwner }) === false) return;
    event.preventDefault();
    event.stopPropagation();
  });
  const dismissFind = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      !input.threadFindActive ||
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      isCommandPaletteOpen()
    )
      return;
    const context = input.getShortcutContext(event.target);
    if (context.terminalFocus || context.previewFocus || context.modelPickerOpen) return;
    event.preventDefault();
    input.closeThreadFind();
  });
  useEffect(() => {
    const onKeyDownCapture = (event: KeyboardEvent) => handleShortcut(event);
    const onKeyDown = (event: KeyboardEvent) => dismissFind(event);
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch")
        pointer.current = { clientX: event.clientX, clientY: event.clientY };
    };
    const clearPointer = () => {
      pointer.current = null;
    };
    const onPointerOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) clearPointer();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("blur", clearPointer);
    document.addEventListener("pointerout", onPointerOut);
    window.addEventListener("keydown", onKeyDownCapture, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", clearPointer);
      document.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("keydown", onKeyDownCapture, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
