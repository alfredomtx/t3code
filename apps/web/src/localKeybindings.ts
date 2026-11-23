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

const LocalKeybindings = Schema.Array(
  Schema.Struct({
    ...KeybindingRule.fields,
    command: Schema.Literals([
      "rightPanel.previousTab",
      "rightPanel.nextTab",
      "thread.editLastSentMessage",
    ]),
  }),
);
const STORAGE_KEY = "t3code:right-panel-tab-keybindings:v1";
const EMPTY: typeof LocalKeybindings.Type = [];

export function isLocalKeybindingCommand(
  command: KeybindingCommand,
): command is (typeof LocalKeybindings.Type)[number]["command"] {
  return (
    command === "rightPanel.previousTab" ||
    command === "rightPanel.nextTab" ||
    command === "thread.editLastSentMessage"
  );
}

function readLocalKeybindings() {
  try {
    return getLocalStorageItem(STORAGE_KEY, LocalKeybindings) ?? EMPTY;
  } catch (error) {
    console.error("Could not read local shortcuts.", error);
    return EMPTY;
  }
}

export const localKeybindingsAtom = Atom.make((get) => {
  get.addFinalizer(
    subscribeLocalStorageKey(STORAGE_KEY, () => get.setSelf(readLocalKeybindings())),
  );
  return readLocalKeybindings();
});

export function useLocalKeybindings() {
  return useLocalStorage(STORAGE_KEY, EMPTY, LocalKeybindings);
}

export function mergeLocalKeybindings(
  server: ResolvedKeybindingsConfig,
  local: typeof LocalKeybindings.Type,
) {
  const overridden = new Set(local.map((rule) => rule.command));
  return mergeWithDefaultKeybindings([
    ...server.filter(
      (binding) => !isLocalKeybindingCommand(binding.command) || !overridden.has(binding.command),
    ),
    ...compileResolvedKeybindingsConfig(local),
  ]);
}
