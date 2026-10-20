import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts/settings";
import {
  __resetClientSettingsPersistenceForTests,
  ensureClientSettingsHydrated,
  getClientSettings,
  useClientSettings,
} from "./useSettings";

function PreferenceReader() {
  return createElement(
    "span",
    null,
    useClientSettings((settings) => settings.timestampFormat),
  );
}

it("refreshes main preferences on window focus while keeping the personal collapse choice", async () => {
  let current: ClientSettings = {
    ...DEFAULT_CLIENT_SETTINGS,
    timestampFormat: "12-hour",
    collapseRenderedResults: false,
  };
  const read = vi.fn(async () => ({
    clientSettings: current,
    themeValues: { "t3code:theme": "dark" },
  }));
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("desktopBridge", { getPersonalSharedPreferences: read });
    __resetClientSettingsPersistenceForTests();
    await ensureClientSettingsHydrated();
    await act(() => root.render(createElement(PreferenceReader)));
    expect(container.textContent).toBe("12-hour");
    current = { ...current, timestampFormat: "24-hour" };
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.waitFor(() => expect(container.textContent).toBe("24-hour"));
    });
    expect(getClientSettings().collapseRenderedResults).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  } finally {
    await act(() => root.unmount());
    __resetClientSettingsPersistenceForTests();
    vi.unstubAllGlobals();
  }
});
