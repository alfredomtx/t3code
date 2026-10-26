import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";

const state = vi.hoisted(() => ({ connected: true, writable: true, save: vi.fn() }));
vi.mock("./SettingsScopeContext", async (original) => ({
  ...(await original<typeof import("./SettingsScopeContext")>()),
  useSettingsScope: () => {
    const source = {
      environmentId: "source",
      label: "Source machine",
      serverConfig: { keybindings: [], availableEditors: [] },
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

import { KeybindingsSettingsPanel } from "./KeybindingsSettings";

function setup() {
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
