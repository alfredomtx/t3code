import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function createStorage(overrides: Partial<Storage> = {}): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.doUnmock("react");
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("theme failure handling", () => {
  it("follows only theme keys and removes values deleted in the main app", async () => {
    const storage = createStorage();
    storage.setItem("private-draft", "preserve");
    storage.setItem("t3code:theme-halves:v1", "old");
    vi.stubGlobal("window", { localStorage: storage });
    const { applySharedThemePreferences, readThemePreference } = await import("./useTheme");
    applySharedThemePreferences({
      following: true,
      values: { "t3code:theme": "dark", "private-draft": "discard" },
    });
    expect(readThemePreference()).toBe("dark");
    expect(storage.getItem("t3code:theme-halves:v1")).toBeNull();
    expect(storage.getItem("private-draft")).toBe("preserve");
    applySharedThemePreferences({ following: true, values: null });
    expect(readThemePreference()).toBe("dark");
  });
});
