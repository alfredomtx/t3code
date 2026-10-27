import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
} from "@t3tools/shared/keybindings";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { act, render, stubGlobal } from "../../test/render";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { isEditableFocused } from "~/lib/editableFocus";
import type { RightPanelSurface } from "~/rightPanelStore";
import { RightPanelTabs, type RightPanelTabsProps } from "./RightPanelTabs";

const surfaces: readonly RightPanelSurface[] = [
  { id: "files", kind: "files" },
  { id: "browser:one", kind: "preview", resourceId: "one" },
  {
    id: "terminal:one",
    kind: "terminal",
    resourceId: "one",
    terminalIds: ["one"],
    activeTerminalId: "one",
  },
  { id: "diff", kind: "diff" },
];

function Tabs({
  keybindings = DEFAULT_RESOLVED_KEYBINDINGS,
  open = true,
}: Pick<Partial<RightPanelTabsProps>, "keybindings" | "open">) {
  const [active, setActive] = useState("files");
  const noop = () => {};
  return (
    <RightPanelTabs
      mode="inline"
      open={open}
      keybindings={keybindings}
      getShortcutContext={() => ({
        rightPanelOpen: open,
        editableFocus: isEditableFocused(document.activeElement),
        terminalFocus: isTerminalFocused(),
        terminalOpen: true,
        previewFocus: false,
        previewOpen: false,
        isWeb: true,
        isDesktop: false,
      })}
      surfaces={surfaces}
      environmentId={null}
      activeSurfaceId={active}
      pendingSurfaceIds={new Set()}
      previewSessions={{}}
      desktopByTabId={{}}
      terminalLabelsById={new Map()}
      onActivate={(surface) => {
        setActive(surface.id);
        if (surface.kind === "terminal")
          document.querySelector<HTMLElement>("[data-terminal-owner] textarea")?.focus();
      }}
      onCloseSurface={noop}
      onCloseOtherSurfaces={noop}
      onCloseSurfacesToRight={noop}
      onCloseAllSurfaces={noop}
      onCopyFilePath={noop}
      onAddBrowser={noop}
      onAddBrowserInProfile={noop}
      onAddTerminal={noop}
      onAddDiff={noop}
      onAddFiles={noop}
      onAddPullRequest={noop}
      onAddPullRequests={noop}
      onAddDevice={noop}
      browserAvailable
      diffAvailable
      filesAvailable
      terminalAvailable={false}
      pullRequestAvailable={false}
      pullRequestsAvailable={false}
      deviceAvailable={false}
    >
      <output aria-label="Selected tab">{active}</output>
      <input aria-label="Typing field" />
      <div data-terminal-owner="right-panel">
        <textarea aria-label="Panel terminal" />
      </div>
    </RightPanelTabs>
  );
}

function press(key: string, code: string, overrides: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    code,
    altKey: true,
    bubbles: true,
    cancelable: true,
    ...overrides,
  });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

it("cycles every rendered tab in order and wraps with Option glyphs", async () => {
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  await using screen = await render(<Tabs />);
  for (const expected of ["browser:one", "terminal:one", "diff", "files"]) {
    await act(() => {
      press("ƒ", "KeyF");
    });
    await expect
      .element(screen.getByRole("status", { name: "Selected tab" }))
      .toHaveTextContent(expected);
  }
  await act(() => {
    press("∂", "KeyD");
  });
  await expect
    .element(screen.getByRole("status", { name: "Selected tab" }))
    .toHaveTextContent("diff");
});

it("supports custom chords and forwarded native guest actions", async () => {
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  const listeners = new Set<(action: string) => void>();
  using _bridge = stubGlobal("desktopBridge", {
    onMenuAction: (listener: (action: string) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  await using screen = await render(
    <Tabs
      keybindings={compileResolvedKeybindingsConfig([
        { command: "rightPanel.nextTab", key: "ctrl+shift+k" },
      ])}
    />,
  );
  await act(() => {
    press("K", "KeyK", { altKey: false, ctrlKey: true, shiftKey: true });
  });
  await expect
    .element(screen.getByRole("status", { name: "Selected tab" }))
    .toHaveTextContent("browser:one");
  await act(() => {
    for (const listener of listeners) listener("rightPanel.nextTab");
  });
  await expect
    .element(screen.getByRole("status", { name: "Selected tab" }))
    .toHaveTextContent("terminal:one");
});

it("leaves typing, IME, shortcut capture, overlays, and closed panels alone", async () => {
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  await using screen = await render(<Tabs />);
  const field = screen.getByRole("textbox", { name: "Typing field" }).element();
  await act(() => {
    field.focus();
    expect(press("f", "KeyF").defaultPrevented).toBe(false);
    field.blur();
    expect(press("f", "KeyF", { isComposing: true }).defaultPrevented).toBe(false);
    expect(press("f", "KeyF", { repeat: true }).defaultPrevented).toBe(true);
    field.setAttribute("data-keybinding-capture", "");
    field.focus();
    expect(press("f", "KeyF").defaultPrevented).toBe(false);
    field.blur();
    const dialog = document.createElement("div");
    dialog.dataset.slot = "dialog-popup";
    dialog.dataset.open = "";
    screen.container.append(dialog);
    expect(press("f", "KeyF").defaultPrevented).toBe(false);
    dialog.remove();
  });
  await expect
    .element(screen.getByRole("status", { name: "Selected tab" }))
    .toHaveTextContent("files");
  await screen.rerender(<Tabs open={false} />);
  await act(() => {
    expect(press("f", "KeyF").defaultPrevented).toBe(false);
  });
});
