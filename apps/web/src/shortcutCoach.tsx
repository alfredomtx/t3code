import {
  STATIC_KEYBINDING_COMMANDS,
  type EnvironmentId,
  type KeybindingCommand,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { isBrowserEditingShortcut, isMacPlatform } from "@t3tools/shared/keybindings";
import { useNavigate, useParams } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useRef, type MouseEvent, type PointerEvent } from "react";

import { commandLabel } from "./components/settings/KeybindingsSettings.logic";
import { Button } from "./components/ui/button";
import { toastManager } from "./components/ui/toast";
import { getLocalStorageItem, setLocalStorageItem, useLocalStorage } from "./hooks/useLocalStorage";
import {
  effectiveShortcutsForCommand,
  formatShortcutLabel,
  isRichTextBoldShortcut,
  type ShortcutMatchContext,
} from "./keybindings";
import { isEditableFocused } from "./lib/editableFocus";
import { isPreviewFocused } from "./lib/previewFocus";
import { isTerminalFocused } from "./lib/terminalFocus";
import { isModelPickerOpen } from "./modelPickerVisibility";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { primaryServerKeybindingsAtom, primaryServerKeybindingsSourceAtom } from "./state/server";
import {
  selectActiveRightPanel,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "./rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "./terminalUiStateStore";
import { resolveThreadRouteTarget } from "./threadRoutes";
import { useComposerDraftStore } from "./composerDraftStore";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";

const Mode = Schema.Literals(["learning", "everyClick", "off"]);
const decodeMode = Schema.decodeUnknownSync(Mode);
const MODE_KEY = "t3code:shortcut-coach:mode";
const TOAST_ID = "shortcut-coach";
const suppressionKey = (command: KeybindingCommand) => `t3code:shortcut-coach:suppress:${command}`;
const counts = new Map<KeybindingCommand, { count: number; shownAt: number | null }>();
const sessionSuppressions = new Set<KeybindingCommand>();
let sessionMode: typeof Mode.Type = "learning";

function readMode() {
  try {
    return getLocalStorageItem(MODE_KEY, Mode) ?? sessionMode;
  } catch {
    return sessionMode;
  }
}

export function resolveCoachShortcut(
  bindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
  context: Partial<ShortcutMatchContext>,
  platform: string,
) {
  const shortcut = effectiveShortcutsForCommand(bindings, command, { context, platform })[0];
  if (shortcut) {
    const event = {
      ...shortcut,
      metaKey: shortcut.metaKey || (shortcut.modKey && isMacPlatform(platform)),
      ctrlKey: shortcut.ctrlKey || (shortcut.modKey && !isMacPlatform(platform)),
    };
    if (
      command === "sidebar.toggle" &&
      context.richTextSelection &&
      isRichTextBoldShortcut(event, { isCollapsed: false })
    )
      return { kind: "inactive" } as const;
    if (command.startsWith("preview.") && isBrowserEditingShortcut(event, platform))
      return { kind: "inactive" } as const;
    return { kind: "assigned", label: formatShortcutLabel(shortcut, platform) } as const;
  }
  return {
    kind: bindings.some((binding) => binding.command === command) ? "inactive" : "unassigned",
  } as const;
}

export function shouldTeachShortcut(command: KeybindingCommand, assigned: boolean, now: number) {
  const mode = readMode();
  let suppressed = sessionSuppressions.has(command);
  try {
    suppressed ||= getLocalStorageItem(suppressionKey(command), Schema.Boolean) === true;
  } catch {
    /* Session state remains available when storage is blocked. */
  }
  if (mode === "off" || suppressed) return false;
  const previous = counts.get(command) ?? { count: 0, shownAt: null };
  const count = previous.count + 1;
  const show =
    mode === "everyClick" ||
    ((assigned || count >= 3) && (previous.shownAt === null || now - previous.shownAt >= 60_000));
  counts.set(command, { count, shownAt: show ? now : previous.shownAt });
  return show;
}

function suppress(command: KeybindingCommand) {
  sessionSuppressions.add(command);
  try {
    setLocalStorageItem(suppressionKey(command), true, Schema.Boolean);
  } catch {
    /* Keep suppression for this session. */
  }
  toastManager.close(TOAST_ID);
}

export function resetShortcutCoach() {
  counts.clear();
  sessionSuppressions.clear();
  for (const command of new Set([
    ...STATIC_KEYBINDING_COMMANDS,
    ...appAtomRegistry.get(primaryServerKeybindingsAtom).map((binding) => binding.command),
  ])) {
    try {
      setLocalStorageItem(suppressionKey(command), false, Schema.Boolean);
    } catch {
      /* Reset still clears session counters. */
    }
  }
  toastManager.close(TOAST_ID);
}

type Snapshot = {
  context: Partial<ShortcutMatchContext>;
  bindings: ResolvedKeybindingsConfig;
  source: EnvironmentId | null;
  time: number;
  lastClick: number;
};

export function useShortcutCoach(
  context: Partial<ShortcutMatchContext> | (() => Partial<ShortcutMatchContext>) = {},
) {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const snapshot = useRef<Snapshot | null>(null);
  const capture = (event: PointerEvent) => {
    snapshot.current = null;
    if (!event.nativeEvent.isTrusted || event.button !== 0) return;
    const target = resolveThreadRouteTarget(params);
    const draft =
      target?.kind === "draft"
        ? useComposerDraftStore.getState().getDraftSession(target.draftId)
        : null;
    const threadRef =
      target?.kind === "server"
        ? target.threadRef
        : draft
          ? (draft.promotedTo ?? scopeThreadRef(draft.environmentId, draft.threadId))
          : null;
    snapshot.current = {
      context: {
        terminalFocus: isTerminalFocused(),
        terminalOpen: selectThreadTerminalUiState(
          useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
          threadRef,
        ).terminalOpen,
        previewFocus: isPreviewFocused(),
        previewOpen:
          selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, threadRef) ===
          "preview",
        editableFocus: isEditableFocused(document.activeElement),
        modelPickerOpen: isModelPickerOpen(),
        richTextSelection:
          document.activeElement instanceof HTMLElement &&
          document.activeElement.closest('[data-composer-rich-text="true"]') !== null &&
          window.getSelection()?.isCollapsed === false,
        rightPanelOpen: selectThreadRightPanelState(
          useRightPanelStore.getState().byThreadKey,
          threadRef,
        ).isOpen,
        usagePageOpen: window.location.pathname.startsWith("/usage"),
        ...(typeof context === "function" ? context() : context),
      },
      bindings: appAtomRegistry.get(primaryServerKeybindingsAtom),
      source: appAtomRegistry.get(primaryServerKeybindingsSourceAtom),
      time: event.timeStamp,
      lastClick: -1,
    };
  };
  const prepare = (command: KeybindingCommand, event: MouseEvent | globalThis.MouseEvent) => {
    const captured = snapshot.current;
    const native = "nativeEvent" in event ? event.nativeEvent : event;
    if (
      !captured ||
      !native.isTrusted ||
      native.detail <= 0 ||
      native.timeStamp === captured.lastClick ||
      native.timeStamp < captured.time ||
      native.timeStamp - captured.time > 30_000
    )
      return () => {};
    captured.lastClick = native.timeStamp;
    const shortcut = resolveCoachShortcut(
      captured.bindings,
      command,
      captured.context,
      navigator.platform,
    );
    let used = false;
    return () => {
      if (used) return;
      used = true;
      if (
        shortcut.kind === "inactive" ||
        !shouldTeachShortcut(command, shortcut.kind === "assigned", Date.now())
      )
        return;
      toastManager.close(TOAST_ID);
      toastManager.add({
        id: TOAST_ID,
        title: commandLabel(command),
        description:
          shortcut.kind === "assigned"
            ? `Next time, use ${shortcut.label}.`
            : "No shortcut assigned.",
        timeout: 6000,
        actionProps: {
          children: shortcut.kind === "assigned" ? "Change shortcut" : "Assign shortcut",
          disabled: captured.source === null,
          onClick: () => {
            if (captured.source === null) return;
            toastManager.close(TOAST_ID);
            void navigate({
              to: "/settings/keybindings",
              search: {
                machine: captured.source,
                coachCommand: command,
                coachSource: captured.source,
              },
              hash: `keybinding-${command}`,
            });
          },
        },
        data: {
          hideCopyButton: true,
          additionalActions: [
            {
              id: "suppress",
              props: { children: "Do not remind me", onClick: () => suppress(command) },
            },
          ],
        },
      });
    };
  };
  const notify = (command: KeybindingCommand, event: MouseEvent | globalThis.MouseEvent) =>
    prepare(command, event)();
  return { capture, notify, prepare };
}

export function ShortcutCoachSettings() {
  const [mode, setMode] = useLocalStorage(MODE_KEY, "learning", Mode);
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <label htmlFor="shortcut-coach-mode">Shortcut coach</label>
      <select
        id="shortcut-coach-mode"
        value={mode}
        onChange={(event) => {
          const next = decodeMode(event.target.value);
          sessionMode = next;
          setMode(next);
          if (next === "off") toastManager.close(TOAST_ID);
        }}
      >
        <option value="everyClick">Every click</option>
        <option value="learning">Learning</option>
        <option value="off">Off</option>
      </select>
      <Button variant="outline" size="sm" onClick={resetShortcutCoach}>
        Reset reminders
      </Button>
    </div>
  );
}
