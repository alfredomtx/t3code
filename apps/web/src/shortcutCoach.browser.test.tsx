import { EnvironmentId } from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../test/render";
import { appAtomRegistry } from "./rpc/atomRegistry";

const testAtoms = await vi.hoisted(async () => {
  const { Atom } = await import("effect/reactivity");
  const { EnvironmentId } = await import("@t3tools/contracts");
  return {
    source: Atom.make<EnvironmentId | null>(EnvironmentId.make("source")).pipe(Atom.keepAlive),
  };
});
const state = vi.hoisted(() => ({ add: vi.fn(), close: vi.fn(), navigate: vi.fn() }));
vi.mock(import("./components/ui/toast"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    toastManager: { ...actual.toastManager, add: state.add, close: state.close },
  };
});
vi.mock(import("./state/server"), async (original) => ({
  ...(await original()),
  primaryServerKeybindingsAtom: Atom.make(
    compileResolvedKeybindingsConfig([
      { command: "sidebar.toggle", key: "mod+b", when: "!editableFocus" },
      { command: "sidebar.toggle", key: "mod+k", when: "editableFocus" },
    ]),
  ),
  primaryServerKeybindingsSourceAtom: testAtoms.source,
}));
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: () => state.navigate,
}));

import {
  resetShortcutCoach,
  resolveCoachShortcut,
  shouldTeachShortcut,
  ShortcutCoachSettings,
  useShortcutCoach,
} from "./shortcutCoach";
import { primaryServerKeybindingsAtom } from "./state/server";

function setup() {
  localStorage.clear();
  localStorage.setItem("t3code:shortcut-coach:mode", '"learning"');
  resetShortcutCoach();
  state.add.mockReset();
  state.close.mockReset();
  state.navigate.mockReset();
  appAtomRegistry.set(testAtoms.source, EnvironmentId.make("source"));
}

function Controls({
  accepted = true,
  pending,
}: {
  accepted?: boolean;
  pending?: Promise<boolean>;
}) {
  const coach = useShortcutCoach();
  return (
    <>
      <input aria-label="Composer" />
      <button
        onPointerDownCapture={coach.capture}
        onClick={(event) => {
          const remind = coach.prepare("sidebar.toggle", event);
          if (pending)
            void pending.then((ok) => {
              if (ok) remind();
            });
          else if (accepted) remind();
        }}
      >
        Sidebar
      </button>
      <button
        onPointerDownCapture={coach.capture}
        onClick={(event) => coach.notify("rightPanel.toggleMaximized", event)}
      >
        Maximize
      </button>
      <ShortcutCoachSettings />
    </>
  );
}

describe("shortcut coach", () => {
  it("uses pointer-down focus, replaces one hint, suppresses and resets, and selects only its source", async () => {
    setup();
    await using screen = await render(<Controls />);
    await screen.getByRole("textbox", { name: "Composer" }).click();
    await screen.getByRole("button", { name: "Sidebar", exact: true }).click();
    expect(state.add).toHaveBeenCalledOnce();
    expect(state.add.mock.lastCall?.[0].description).toContain("K");
    expect(document.activeElement?.tagName).toBe("BUTTON");
    state.add.mock.lastCall?.[0].actionProps.onClick();
    expect(state.navigate.mock.lastCall?.[0].search).toEqual({
      machine: "source",
      coachSource: "source",
      coachCommand: "sidebar.toggle",
    });
    state.add.mock.lastCall?.[0].data.additionalActions[0].props.onClick();
    await screen.getByRole("combobox").selectOptions("everyClick");
    await screen.getByRole("button", { name: "Sidebar", exact: true }).click();
    expect(state.add).toHaveBeenCalledOnce();
    await screen.getByRole("button", { name: "Reset reminders" }).click();
    await screen.getByRole("button", { name: "Sidebar", exact: true }).click();
    expect(state.add).toHaveBeenCalledTimes(2);
    expect(state.add.mock.calls.map(([toast]) => toast.id)).toEqual([
      "shortcut-coach",
      "shortcut-coach",
    ]);
    await screen.getByRole("combobox").selectOptions("off");
    expect(state.close).toHaveBeenLastCalledWith("shortcut-coach");
    await screen.getByRole("button", { name: "Sidebar", exact: true }).click();
    expect(state.add).toHaveBeenCalledTimes(2);
  });

  it("rejects keyboard, synthetic and rejected actions; retains an async action's original snapshot", async () => {
    setup();
    let accept = (_accepted: boolean) => {};
    const pending = new Promise<boolean>((resolve) => {
      accept = resolve;
    });
    await using screen = await render(<Controls pending={pending} />);
    const sidebar = screen.getByRole("button", { name: "Sidebar", exact: true });
    await sidebar.click();
    await screen.getByRole("button", { name: "Maximize", exact: true }).click();
    accept(true);
    await vi.waitFor(() => expect(state.add).toHaveBeenCalledOnce());
    await userEvent.keyboard("{Enter}");
    const button = sidebar.element();
    if (!(button instanceof HTMLElement)) throw new Error("Expected a button");
    button.click();
    expect(state.add).toHaveBeenCalledOnce();
    await screen.rerender(<Controls accepted={false} />);
    await sidebar.click();
    expect(state.add).toHaveBeenCalledOnce();
  });

  it("distinguishes inactive, shadowed and unassigned bindings and honors platform overrides", () => {
    setup();
    const bindings = compileResolvedKeybindingsConfig([
      { command: "sidebar.toggle", key: "mod+b", when: "terminalFocus" },
      { command: "terminal.toggle", key: "mod+b" },
    ]);
    expect(resolveCoachShortcut(bindings, "sidebar.toggle", {}, "MacIntel").kind).toBe("inactive");
    expect(
      resolveCoachShortcut(bindings, "sidebar.toggle", { terminalFocus: true }, "MacIntel").kind,
    ).toBe("inactive");
    expect(resolveCoachShortcut(bindings, "rightPanel.toggleMaximized", {}, "MacIntel").kind).toBe(
      "unassigned",
    );
    expect(resolveCoachShortcut(bindings, "terminal.toggle", {}, "Win32")).toEqual({
      kind: "assigned",
      label: "Ctrl+B",
    });
  });

  it("does not advertise browser editing chords or rich-text bold overrides", () => {
    setup();
    const always = compileResolvedKeybindingsConfig([{ command: "preview.refresh", key: "mod+c" }]);
    expect(
      resolveCoachShortcut(always, "preview.refresh", { previewFocus: true }, "MacIntel"),
    ).toEqual({ kind: "inactive" });
    const guestOnly = compileResolvedKeybindingsConfig([
      { command: "preview.refresh", key: "mod+c", when: "previewFocus" },
    ]);
    expect(
      resolveCoachShortcut(guestOnly, "preview.refresh", { previewFocus: true }, "MacIntel").kind,
    ).toBe("inactive");
    const windowsEditing = compileResolvedKeybindingsConfig([
      { command: "preview.focusUrl", key: "ctrl+y" },
    ]);
    expect(
      resolveCoachShortcut(windowsEditing, "preview.focusUrl", { previewFocus: true }, "Win32"),
    ).toEqual({ kind: "inactive" });
    const bold = compileResolvedKeybindingsConfig([{ command: "sidebar.toggle", key: "mod+b" }]);
    expect(
      resolveCoachShortcut(bold, "sidebar.toggle", { richTextSelection: true }, "MacIntel").kind,
    ).toBe("inactive");
  });

  it("uses deterministic learning counts and cooldowns and survives corrupt storage", () => {
    setup();
    localStorage.setItem("t3code:shortcut-coach:mode", '"learning"');
    expect(shouldTeachShortcut("sidebar.toggle", true, 0)).toBe(true);
    expect(shouldTeachShortcut("sidebar.toggle", true, 59_999)).toBe(false);
    expect(shouldTeachShortcut("sidebar.toggle", true, 60_000)).toBe(true);
    expect(shouldTeachShortcut("rightPanel.toggleMaximized", false, 0)).toBe(false);
    expect(shouldTeachShortcut("rightPanel.toggleMaximized", false, 1)).toBe(false);
    expect(shouldTeachShortcut("rightPanel.toggleMaximized", false, 2)).toBe(true);
    localStorage.setItem("t3code:shortcut-coach:mode", "broken");
    using _storage = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => shouldTeachShortcut("terminal.toggle", true, 0)).not.toThrow();
  });

  it("disables editing when the binding source is unknown", async () => {
    setup();
    appAtomRegistry.set(testAtoms.source, null);
    await using screen = await render(<Controls />);
    await screen.getByRole("button", { name: "Sidebar", exact: true }).click();
    expect(state.add.mock.lastCall?.[0].actionProps.disabled).toBe(true);
    state.add.mock.lastCall?.[0].actionProps.onClick();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(appAtomRegistry.get(primaryServerKeybindingsAtom).length).toBe(2);
  });
});
