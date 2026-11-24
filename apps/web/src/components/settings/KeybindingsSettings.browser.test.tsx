import { EnvironmentId, type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent, type Locator } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import * as atomCommands from "../../state/use-atom-command";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";

const state = vi.hoisted(() => ({
  connected: true,
  writable: true,
  save: vi.fn(),
  rules: [] as ResolvedKeybindingsConfig,
}));
vi.mock("./SettingsScopeContext", async (original) => ({
  ...(await original<typeof import("./SettingsScopeContext")>()),
  useSettingsScope: () => {
    const source = {
      environmentId: "source",
      label: "Source machine",
      serverConfig: { keybindings: state.rules, availableEditors: [] },
    };
    return {
      environment: source,
      connectedEnvironments: state.connected ? [source] : [],
      scope: { kind: "environment", environmentId: "source" },
    };
  },
}));
vi.mock("../../state/session", async (original) => ({
  ...(await original<typeof import("../../state/session")>()),
  useEnvironmentScope: () => true,
  useEnvironmentsWithScope: () => new Set(state.writable ? ["source"] : []),
  readEnvironmentScope: () => state.writable,
}));
vi.mock("../../state/use-atom-command", async (original) => ({
  ...(await original<typeof import("../../state/use-atom-command")>()),
  useAtomCommand: vi.fn(() => state.save),
}));

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { localKeybindingsAtom, mergeLocalKeybindings } from "~/localKeybindings";
import { resolveShortcutCommand } from "~/keybindings";

import { KeybindingsSettingsPanel } from "./KeybindingsSettings";

function setup() {
  state.rules = [];
  state.connected = true;
  state.writable = true;
  state.save.mockReset();
  state.save.mockResolvedValue(AsyncResult.success(undefined));
}

describe("coach shortcut editor", () => {
  it("opens the existing recorder for Change and keeps Add available", async () => {
    setup();
    await using screen = await render(
      <KeybindingsSettingsPanel
        coachCommand="sidebar.toggle"
        coachSource={EnvironmentId.make("source")}
      />,
    );
    await expect
      .element(screen.getByRole("textbox", { name: "Keybinding for Sidebar: Toggle" }))
      .toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Add keybinding" })).toBeEnabled();
    await screen.getByRole("button", { name: "Add keybinding" }).click();
    await expect.element(screen.getByText("New keybinding", { exact: true })).toBeVisible();
  });

  it("preselects an unbound command and saves only to its source, then fails closed on disconnect", async () => {
    setup();
    const source = EnvironmentId.make("source");
    await using screen = await render(
      <KeybindingsSettingsPanel coachCommand="rightPanel.toggleMaximized" coachSource={source} />,
    );
    const recorder = screen.getByRole("textbox", {
      name: "Keybinding for Right Panel: Toggle Maximized",
    });
    await recorder.click();
    await userEvent.keyboard("{Control>}{Shift>}m{/Shift}{/Control}");
    await screen.getByRole("button", { name: "Save", exact: true }).click();
    expect(state.save).toHaveBeenCalledExactlyOnceWith({
      environmentId: source,
      input: expect.objectContaining({ command: "rightPanel.toggleMaximized" }),
    });
    state.connected = false;
    await screen.rerender(
      <KeybindingsSettingsPanel coachCommand="rightPanel.toggleMaximized" coachSource={source} />,
    );
    await expect.element(screen.getByRole("button", { name: "Add keybinding" })).toBeDisabled();
    expect(state.save).toHaveBeenCalledOnce();
  });
});

it.each([
  {
    command: "rightPanel.nextTab",
    label: "Right Panel: Next Tab",
    defaultKey: "alt+f",
    context: { rightPanelOpen: true, editableFocus: false },
  },
  {
    command: "thread.editLastSentMessage",
    label: "Chat: Edit Last Sent Message (Keep Files)",
    defaultKey: "mod+alt+arrowup",
    context: { composerFocus: true },
  },
] as const)(
  "saves $command locally when an older backend does not know it",
  async ({ command, label, defaultKey, context }) => {
    setup();
    const key = "t3code:right-panel-tab-keybindings:v1";
    const previous = localStorage.getItem(key);
    localStorage.removeItem(key);
    try {
      await using screen = await render(
        <KeybindingsSettingsPanel
          coachCommand={command}
          coachSource={EnvironmentId.make("source")}
        />,
      );
      const recorder = screen.getByRole("textbox", { name: `Keybinding for ${label}` });
      await recorder.click();
      await userEvent.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
      await screen.getByRole("button", { name: "Save", exact: true }).click();
      expect(state.save).not.toHaveBeenCalled();
      expect(localStorage.getItem(key)).toContain(command);
      const saved = appAtomRegistry.get(localKeybindingsAtom);
      const resolved = mergeLocalKeybindings([], saved);
      expect(
        resolveShortcutCommand(
          { key: "K", code: "KeyK", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true },
          resolved,
          { context },
        ),
      ).toBe(command);
      await screen.unmount();
      await using reloaded = await render(
        <KeybindingsSettingsPanel
          coachCommand={command}
          coachSource={EnvironmentId.make("source")}
        />,
      );
      await expect
        .element(reloaded.getByRole("textbox", { name: `Keybinding for ${label}` }))
        .toBeVisible();
      expect(appAtomRegistry.get(localKeybindingsAtom)).toEqual(saved);
      await reloaded.getByRole("button", { name: `Actions for ${label}` }).click();
      await page.getByRole("menuitem", { name: "Reset to default", exact: true }).click();
      expect(appAtomRegistry.get(localKeybindingsAtom)[0]?.key).toBe(defaultKey);
      await reloaded.getByRole("textbox", { name: `Keybinding for ${label}` }).click();
      await userEvent.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
      await reloaded.getByRole("button", { name: "Save", exact: true }).click();
      await reloaded.getByRole("button", { name: `Actions for ${label}` }).click();
      await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
      expect(appAtomRegistry.get(localKeybindingsAtom)).toEqual([]);
      expect(state.save).not.toHaveBeenCalled();
    } finally {
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
      await act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
    }
  },
);

it("removes server-origin custom tab shortcuts through their server owner", async () => {
  setup();
  state.rules = compileResolvedKeybindingsConfig([
    { command: "rightPanel.nextTab", key: "ctrl+shift+k" },
  ]);
  await using screen = await render(<KeybindingsSettingsPanel />);
  await screen.getByRole("button", { name: "Actions for Right Panel: Next Tab" }).click();
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
  expect(state.save).toHaveBeenCalledExactlyOnceWith({
    environmentId: "source",
    input: { command: "rightPanel.nextTab", key: "ctrl+shift+k" },
  });
});

it("re-enables Save when a When editor closes on an expression it could not parse", async () => {
  setup();
  await using screen = await render(<KeybindingsSettingsPanel />);
  const whenTrigger = screen.getByRole("button", { name: "Edit when clause for Terminal: Toggle" });
  const expression = screen.getByRole("textbox", { name: "When expression" });

  await whenTrigger.click();
  await userEvent.type(expression, "terminalFocus");
  await userEvent.type(expression, " &&");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  await userEvent.keyboard("{Escape}");
  await whenTrigger.click();

  await expect.element(expression).toHaveValue("terminalFocus");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});

// The modal dialog's inert layer swallows pointer events in this harness, so drive the DOM.
async function activate(locator: Locator, action: "click" | "focus") {
  await expect.element(locator).toBeVisible();
  (locator.element() as HTMLElement)[action]();
}

const existingField = page.getByRole("textbox", { name: "Keybinding for Sidebar: Toggle" });
const existingPill = page.getByRole("button", { name: /^Edit shortcut for Sidebar: Toggle:/ });
const newField = page.getByRole("textbox", { name: "Keybinding for new keybinding" });

describe("Esc in a shortcut recorder", () => {
  it.each<{
    name: string;
    field: Locator;
    open: () => Promise<void>;
    expectReset: () => Promise<void>;
  }>([
    {
      name: "existing binding",
      field: existingField,
      open: () => activate(existingPill, "click"),
      expectReset: async () => {
        await expect.element(existingField).not.toBeInTheDocument();
        await expect.element(existingPill).toHaveFocus();
        await expect.element(page.getByRole("button", { name: "Save" })).not.toBeInTheDocument();
      },
    },
    {
      name: "new binding",
      field: newField,
      open: async () => {
        await activate(page.getByRole("button", { name: "Add keybinding" }), "click");
        await activate(newField, "focus");
      },
      expectReset: async () => {
        await expect.element(newField).toHaveValue("");
        await expect.element(newField).toHaveAttribute("placeholder", "Unassigned");
      },
    },
  ])("leaves the $name field without closing Settings", async ({ field, open, expectReset }) => {
    setup();
    const onOpenChange = vi.fn();
    await using _screen = await render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogPopup>
          <DialogTitle>Settings</DialogTitle>
          <KeybindingsSettingsPanel />
        </DialogPopup>
      </Dialog>,
    );

    await open();
    await userEvent.keyboard("{Control>}k{/Control}");
    await expect.element(field).not.toHaveValue("");
    await userEvent.tab();
    await activate(field, "focus");
    await expect.element(field).toHaveAttribute("placeholder", "Press shortcut");

    await userEvent.keyboard("{Escape}");

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.activeElement?.matches("[data-keybinding-capture]")).toBe(false);
    await expectReset();

    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });
});

it("unassigns a default shortcut and restores its condition when one is assigned again", async () => {
  setup();
  state.rules = compileResolvedKeybindingsConfig([
    { command: "composer.sendBackground", key: "mod+alt+enter", when: "false" },
  ]);
  const mutate = vi.fn(async () => ({ _tag: "Success", value: [] }));
  await vi.mocked(atomCommands.useAtomCommand).withImplementation(
    () => mutate as never,
    async () => {
      await using screen = await render(<KeybindingsSettingsPanel />);

      await screen.getByRole("button", { name: "Actions for Sidebar: Toggle" }).click();
      await screen.getByRole("menuitem", { name: "Unassign" }).click();
      expect(mutate).toHaveBeenLastCalledWith({
        environmentId: "source",
        input: {
          command: "sidebar.toggle",
          key: "mod+b",
          when: "false",
          replace: { command: "sidebar.toggle", key: "mod+b" },
        },
      });

      const unassigned = screen.getByRole("button", {
        name: "Edit shortcut for Composer: Start in Background: Unassigned",
      });
      const save = screen.getByRole("button", { name: "Save" });
      await unassigned.click();
      await userEvent.keyboard("{Control>}{Alt>}j{/Alt}{/Control}");
      await expect.element(save).toBeVisible();
      await userEvent.keyboard("{Escape}");
      await expect.element(save).not.toBeInTheDocument();

      await unassigned.click();
      await userEvent.keyboard("{Control>}{Alt>}j{/Alt}{/Control}");
      await save.click();
      expect(mutate).toHaveBeenLastCalledWith({
        environmentId: "source",
        input: expect.objectContaining({
          command: "composer.sendBackground",
          when: "composerFocus && draftThreadRoute",
          replace: { command: "composer.sendBackground", key: "mod+alt+enter", when: "false" },
        }),
      });
    },
  );
});

it("Esc in the keybindings search clears the query without closing Settings", async () => {
  setup();
  const onOpenChange = vi.fn();
  await using _screen = await render(
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogTitle>Settings</DialogTitle>
        <KeybindingsSettingsPanel />
      </DialogPopup>
    </Dialog>,
  );
  const search = page.getByRole("searchbox", { name: "Search keybindings" });
  await search.fill("sidebar");
  for (const composition of [
    { key: "Escape", isComposing: true, keyCode: 27 },
    { key: "Escape", isComposing: false, keyCode: 229 },
  ]) {
    const keydown = new KeyboardEvent("keydown", {
      ...composition,
      bubbles: true,
      cancelable: true,
    });
    await act(() => {
      // Safari ends the composition just before the Escape keydown.
      if (!composition.isComposing)
        search.element().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      search.element().dispatchEvent(keydown);
    });
    expect(keydown.defaultPrevented).toBe(false);
    await expect.element(search).toHaveValue("sidebar");
    await expect.element(search).toHaveFocus();
  }
  expect(search.element().getAttribute("type")).toBe("text");

  await userEvent.keyboard("{Escape}");

  await expect.element(search).toHaveValue("");
  expect(onOpenChange).not.toHaveBeenCalled();
});

it("re-enables Save when a When editor closes on an expression it could not parse", async () => {
  setup();
  await using screen = await render(<KeybindingsSettingsPanel />);
  const whenTrigger = screen.getByRole("button", { name: "Edit when clause for Terminal: Toggle" });
  const expression = screen.getByRole("textbox", { name: "When expression" });

  await whenTrigger.click();
  await userEvent.type(expression, "terminalFocus");
  await userEvent.type(expression, " &&");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  await userEvent.keyboard("{Escape}");
  await whenTrigger.click();

  await expect.element(expression).toHaveValue("terminalFocus");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});

it("filters actions and allows additional shortcuts for assigned commands", async () => {
  await using screen = await render(<KeybindingsSettingsPanel />);
  await screen.getByRole("button", { name: "Add keybinding" }).click();
  const dialog = page.getByRole("dialog", { name: "Command", exact: true });
  const search = dialog.getByRole("combobox", { name: "Search", exact: true });
  await expect.element(search).toHaveFocus();
  await userEvent.keyboard("sidebar.toggle");
  const assigned = dialog.getByRole("option", { name: /Sidebar: Toggle/ });
  await expect.element(assigned).not.toHaveAttribute("aria-disabled", "true");
  await expect.element(assigned.element().querySelector("kbd")!).toBeVisible();
  await vi.waitFor(() => expect(dialog.getByRole("option").elements()).toHaveLength(1));
  await assigned.click();
  const command = screen.getByRole("combobox", { name: "Command", exact: true });
  await expect.element(command).toHaveTextContent("Sidebar: Toggle");
  await command.click();
  await search.fill("Opposite Queue");
  await expect
    .element(dialog.getByRole("option", { name: /Composer: Opposite Queue or Steer Action/ }))
    .toBeVisible();
  await vi.waitFor(() => expect(dialog.getByRole("option").elements()).toHaveLength(1));
  await search.fill("no-such-action");
  await expect.element(dialog.getByText("No results found.")).toBeVisible();
  await search.fill("composer.cycleHost");
  const available = dialog.getByRole("option", { name: "Composer: Cycle Host" });
  await expect.element(available).not.toHaveAttribute("aria-disabled", "true");
  await available.click();
  await expect
    .element(screen.getByRole("combobox", { name: "Command", exact: true }))
    .toHaveTextContent("Composer: Cycle Host");
});
