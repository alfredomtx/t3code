import { AuthOrchestrationOperateScope, EnvironmentId, type EditorId } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import * as Option from "effect/Option";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  BearerConnectionProfile,
  BearerConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render as renderUi } from "../../../test/render";
import { resolveRemoteOpenState } from "../../remoteOpen";
import { serverAvailableEditorsAtom, serverEnvironment } from "../../state/server";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { shellEnvironment } from "../../state/shell";
import { shouldShowOpenInPicker } from "./OpenInPicker.logic";

const state = vi.hoisted(() => ({
  allowed: new Set<string>(),
  remoteInput: { route: null, remoteOpenTargets: [], isDesktopRenderer: true } as Parameters<
    typeof resolveRemoteOpenState
  >[0],
  useCommand: vi.fn(),
  clientEditors: ["vscode"] as readonly EditorId[],
  run: vi.fn(),
  openUrl: vi.fn(),
  setPreferred: vi.fn(),
  markHintSeen: vi.fn(),
  listeners: new Set<() => void>(),
}));

vi.mock(import("../../state/session"), async (importOriginal) => {
  const { useSyncExternalStore } = await import("react");
  const readEnvironmentScope = (environmentId: string, scope: string) =>
    scope === AuthOrchestrationOperateScope && state.allowed.has(environmentId);
  return {
    ...(await importOriginal()),
    readEnvironmentScope: readEnvironmentScope as never,
    useEnvironmentScope: ((environmentId: string, scope: string) =>
      useSyncExternalStore(
        (listener) => {
          state.listeners.add(listener);
          return () => state.listeners.delete(listener);
        },
        () => readEnvironmentScope(environmentId, scope),
      )) as never,
  };
});
vi.mock(import("../../state/use-atom-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomCommand: ((command: unknown) => {
    state.useCommand(command);
    return state.run;
  }) as never,
}));
vi.mock(import("../../state/environments"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironment: (() => ({ label: "Test host" })) as never,
}));
vi.mock(import("../../editorPreferences"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    usePreferredEditor: (available: readonly EditorId[]) => {
      const [preferred, setPreferred] = actual.usePreferredEditor(available);
      const recordPreferred: typeof setPreferred = (editor) => {
        state.setPreferred(editor);
        setPreferred(editor);
      };
      return [preferred, recordPreferred] as const;
    },
  };
});
vi.mock(import("../../remoteOpen"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useRemoteOpenState: () => actual.resolveRemoteOpenState(state.remoteInput),
    useRemoteCapableEditors: () => state.clientEditors,
    useRemoteOpenHint: () => [false, state.markHintSeen] as const,
    openRemoteEditorUrl: state.openUrl,
  };
});

import { OpenInPicker } from "./OpenInPicker";
import { useOpenFavoriteEditorShortcut } from "./OpenInPickerShortcut";

const primary = EnvironmentId.make("primary");
const selected = EnvironmentId.make("selected");
const editors: readonly EditorId[] = ["vscode"];

async function setup() {
  state.allowed.clear();
  state.remoteInput = { route: null, remoteOpenTargets: [], isDesktopRenderer: true };
  state.useCommand.mockReset();
  state.clientEditors = editors;
  state.run.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.openUrl.mockReset().mockResolvedValue(true);
  state.setPreferred.mockReset();
  state.markHintSeen.mockReset();
  state.listeners.clear();
  window.localStorage.clear();

  await using stack = new AsyncDisposableStack();
  const _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux");
  stack.use(_platform);
  const _storage = { [Symbol.dispose]: () => window.localStorage.clear() };
  stack.use(_storage);
  const screen = stack.use(await renderUi(null));
  async function renderPicker(
    availableEditors: readonly EditorId[] = editors,
    panel = false,
    { openInCwd = "/work/project", revealFileManager = false } = {},
  ) {
    await act(async () => {
      for (const listener of state.listeners) listener();
      const node = (
        <OpenInPicker
          environmentId={selected}
          keybindings={DEFAULT_RESOLVED_KEYBINDINGS}
          availableEditors={availableEditors}
          openInCwd={openInCwd}
          revealFileManager={revealFileManager}
          displayMode={panel ? "panel" : "toolbar"}
          compact={!panel}
        />
      );
      await screen.rerender(node);
    });
  }

  function byLabel(label: string) {
    const element = document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
    expect(element, label).not.toBeNull();
    return element!;
  }

  const primaryButton = () => byLabel("Open file in preferred editor");
  const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];

  async function click(element: HTMLElement) {
    await act(async () => element.click());
  }

  async function pressOpenFavorite(mac = false) {
    const event = new KeyboardEvent("keydown", {
      key: "o",
      ctrlKey: !mac,
      metaKey: mac,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => document.body.dispatchEvent(event));
    return event;
  }

  function FavoriteEditorFallback() {
    useOpenFavoriteEditorShortcut({
      enabled: true,
      environmentId: selected,
      keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
      availableEditors: editors,
      openInCwd: "/work/project",
    });
    return null;
  }

  const environment = stack.move();
  return {
    screen,
    renderPicker,
    byLabel,
    primaryButton,
    menuItems,
    click,
    pressOpenFavorite,
    FavoriteEditorFallback,
    [Symbol.asyncDispose]: () => environment.disposeAsync(),
  };
}

describe("host editor access", () => {
  it("uses the selected grant for both the button and a retained shortcut", async () => {
    await using fixture = await setup();
    const { renderPicker, byLabel, primaryButton, click, pressOpenFavorite } = fixture;
    state.allowed.add(selected);
    await renderPicker();
    // Revoke without rerendering: the mounted button and shortcut must re-check the grant.
    state.allowed.delete(selected);
    state.allowed.add(primary);
    await click(primaryButton());
    const event = await pressOpenFavorite();
    expect(state.run).not.toHaveBeenCalled();
    expect(state.setPreferred).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    await renderPicker();
    expect(primaryButton().disabled).toBe(true);
    expect(byLabel("Choose editor").disabled).toBe(true);
    expect((await pressOpenFavorite()).defaultPrevented).toBe(false);
  });
});

describe("saved local service editor action", () => {
  it.each([true, false])(
    "opens Zed on the selected service only with its operate grant: %s",
    async (allowed) => {
      const target = new BearerConnectionTarget({
        environmentId: selected,
        label: "Mac service",
        connectionId: "saved-service",
      });
      const route = {
        target,
        profile: Option.some(
          new BearerConnectionProfile({
            environmentId: selected,
            label: target.label,
            connectionId: target.connectionId,
            httpBaseUrl: "http://127.0.0.1:3773",
            wsBaseUrl: "ws://127.0.0.1:3773",
          }),
        ),
      };
      const registry = AtomRegistry.make({
        initialValues: [
          [primaryEnvironmentIdAtom, null],
          [serverEnvironment.configValueAtom(selected), { availableEditors: ["zed"] }],
        ],
      });
      using _registry = { [Symbol.dispose]: () => registry.dispose() };
      using _config = {
        [Symbol.dispose]: registry.mount(serverEnvironment.configValueAtom(selected)),
      };
      await using fixture = await setup();
      state.remoteInput = { route, remoteOpenTargets: [], isDesktopRenderer: true };
      state.allowed.add(allowed ? selected : primary);
      function ParentEditorControls() {
        const availableEditors = useAtomValue(serverAvailableEditorsAtom(selected));
        if (
          !shouldShowOpenInPicker({
            activeProjectName: "Project",
            target,
            remoteOpenMode: resolveRemoteOpenState(state.remoteInput).mode,
          })
        )
          return null;
        return (
          <OpenInPicker
            environmentId={selected}
            keybindings={DEFAULT_RESOLVED_KEYBINDINGS}
            availableEditors={availableEditors}
            openInCwd="/work/project"
            compact
          />
        );
      }
      await act(async () =>
        fixture.screen.rerender(
          <RegistryContext.Provider value={registry}>
            <ParentEditorControls />
          </RegistryContext.Provider>,
        ),
      );
      await expect
        .element(fixture.screen.getByRole("button", { name: "Open file in preferred editor" }))
        .toBeVisible();
      expect(fixture.primaryButton().disabled).toBe(!allowed);
      await fixture.click(fixture.primaryButton());
      if (allowed) {
        expect(state.useCommand).toHaveBeenCalledWith(shellEnvironment.openInEditor);
        expect(state.run).toHaveBeenCalledExactlyOnceWith({
          environmentId: selected,
          input: { cwd: "/work/project", editor: "zed" },
        });
      } else {
        expect(state.run).not.toHaveBeenCalled();
      }
      expect(state.openUrl).not.toHaveBeenCalled();
    },
  );
});
