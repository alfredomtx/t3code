import { EnvironmentId, type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent, type Locator } from "vite-plus/test/browser";
import { act, render } from "../../../test/render";
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
  useAtomCommand: () => state.save,
}));

import { appAtomRegistry } from "~/rpc/atomRegistry";
import {
  rightPanelTabKeybindingsAtom,
  mergeRightPanelTabKeybindings,
} from "~/rightPanelTabKeybindings";
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

it("saves a custom tab chord locally without asking an older backend to recognize it", async () => {
  setup();
  const key = "t3code:right-panel-tab-keybindings:v1";
  const previous = localStorage.getItem(key);
  localStorage.removeItem(key);
  try {
    await using screen = await render(
      <KeybindingsSettingsPanel
        coachCommand="rightPanel.nextTab"
        coachSource={EnvironmentId.make("source")}
      />,
    );
    const recorder = screen.getByRole("textbox", { name: "Keybinding for Right Panel: Next Tab" });
    await recorder.click();
    await userEvent.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
    await screen.getByRole("button", { name: "Save", exact: true }).click();
    expect(state.save).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toContain("rightPanel.nextTab");
    const saved = appAtomRegistry.get(rightPanelTabKeybindingsAtom);
    const resolved = mergeRightPanelTabKeybindings([], saved);
    expect(
      resolveShortcutCommand(
        { key: "K", code: "KeyK", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true },
        resolved,
        { context: { rightPanelOpen: true, editableFocus: false } },
      ),
    ).toBe("rightPanel.nextTab");
    await screen.unmount();
    await using reloaded = await render(
      <KeybindingsSettingsPanel
        coachCommand="rightPanel.nextTab"
        coachSource={EnvironmentId.make("source")}
      />,
    );
    await expect
      .element(reloaded.getByRole("textbox", { name: "Keybinding for Right Panel: Next Tab" }))
      .toBeVisible();
    expect(appAtomRegistry.get(rightPanelTabKeybindingsAtom)).toEqual(saved);
    await reloaded.getByRole("button", { name: "Actions for Right Panel: Next Tab" }).click();
    await page.getByRole("menuitem", { name: "Reset to default", exact: true }).click();
    expect(appAtomRegistry.get(rightPanelTabKeybindingsAtom)[0]?.key).toBe("alt+f");
    await reloaded.getByRole("textbox", { name: "Keybinding for Right Panel: Next Tab" }).click();
    await userEvent.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
    await reloaded.getByRole("button", { name: "Save", exact: true }).click();
    await reloaded.getByRole("button", { name: "Actions for Right Panel: Next Tab" }).click();
    await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
    expect(appAtomRegistry.get(rightPanelTabKeybindingsAtom)).toEqual([]);
    expect(state.save).not.toHaveBeenCalled();
  } finally {
    if (previous === null) localStorage.removeItem(key);
    else localStorage.setItem(key, previous);
    await act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
  }
});

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
