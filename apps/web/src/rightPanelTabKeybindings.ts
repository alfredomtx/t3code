import {
  type KeybindingCommand,
  KeybindingRule,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import {
  compileResolvedKeybindingsConfig,
  mergeWithDefaultKeybindings,
} from "@t3tools/shared/keybindings";
import { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import {
  getLocalStorageItem,
  subscribeLocalStorageKey,
  useLocalStorage,
} from "./hooks/useLocalStorage";

const TabKeybindings = Schema.Array(
  Schema.Struct({
    ...KeybindingRule.fields,
    command: Schema.Literals(["rightPanel.previousTab", "rightPanel.nextTab"]),
  }),
);
const STORAGE_KEY = "t3code:right-panel-tab-keybindings:v1";
const EMPTY: typeof TabKeybindings.Type = [];

export function isLocalTabCommand(
  command: KeybindingCommand,
): command is (typeof TabKeybindings.Type)[number]["command"] {
  return command === "rightPanel.previousTab" || command === "rightPanel.nextTab";
}

function readTabKeybindings() {
  try {
    return getLocalStorageItem(STORAGE_KEY, TabKeybindings) ?? EMPTY;
  } catch (error) {
    console.error("Could not read panel tab shortcuts.", error);
    return EMPTY;
  }
}

export const rightPanelTabKeybindingsAtom = Atom.make((get) => {
  get.addFinalizer(subscribeLocalStorageKey(STORAGE_KEY, () => get.setSelf(readTabKeybindings())));
  return readTabKeybindings();
});

export function useRightPanelTabKeybindings() {
  return useLocalStorage(STORAGE_KEY, EMPTY, TabKeybindings);
}

export function mergeRightPanelTabKeybindings(
  server: ResolvedKeybindingsConfig,
  local: typeof TabKeybindings.Type,
) {
  const overridden = new Set(local.map((rule) => rule.command));
  return mergeWithDefaultKeybindings([
    ...server.filter(
      (binding) => !isLocalTabCommand(binding.command) || !overridden.has(binding.command),
    ),
    ...compileResolvedKeybindingsConfig(local),
  ]);
}
