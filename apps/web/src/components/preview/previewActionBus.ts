import type { KeybindingCommand } from "@t3tools/contracts";

const PREVIEW_COMMAND_ACTIONS = [
  ["preview.toggle", "toggle-panel"],
  ["preview.refresh", "refresh"],
  ["preview.focusUrl", "focus-url"],
  ["preview.zoomIn", "zoom-in"],
  ["preview.zoomOut", "zoom-out"],
  ["preview.resetZoom", "reset-zoom"],
] as const satisfies ReadonlyArray<readonly [KeybindingCommand, string]>;

export const PREVIEW_COMMANDS = PREVIEW_COMMAND_ACTIONS.map(([command]) => command);
export type PreviewAction = (typeof PREVIEW_COMMAND_ACTIONS)[number][1];

export function previewActionForCommand(command: string): PreviewAction | null {
  return PREVIEW_COMMAND_ACTIONS.find(([candidate]) => candidate === command)?.[1] ?? null;
}

const EVENT_NAME = "t3code:preview-action";

export function dispatchPreviewAction(action: PreviewAction): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PreviewAction>(EVENT_NAME, { detail: action }));
}

export function subscribePreviewAction(listener: (action: PreviewAction) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<PreviewAction>).detail;
    if (typeof detail === "string") listener(detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
