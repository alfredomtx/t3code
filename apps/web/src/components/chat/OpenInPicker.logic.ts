import type { ConnectionTarget } from "@t3tools/client-runtime/connection";

import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";
import type { RemoteOpenMode } from "../../remoteOpen";

export function shouldShowOpenInPicker(input: {
  readonly hasOpenTarget: boolean;
  readonly target: ConnectionTarget | null;
  readonly primaryEnvironmentId?: string | null;
  readonly hostEnvironmentId?: string | null;
  readonly remoteOpenMode: RemoteOpenMode;
}): boolean {
  if (!input.hasOpenTarget || input.target === null) return false;
  if (
    input.target.environmentId === input.primaryEnvironmentId ||
    input.target.environmentId === input.hostEnvironmentId
  )
    return true;
  return !(input.remoteOpenMode === "local-exec" && isDesktopLocalConnectionTarget(input.target));
}

export type FileManagerAction = "open" | "reveal" | "unavailable";

/**
 * The file manager opens folders and shows files in their folder. A path whose read has not
 * settled may be either, and a file needs the server's reveal support, so both wait.
 */
export function fileManagerActionForPath(input: {
  readonly isFolder: boolean;
  readonly isSettled: boolean;
  readonly canReveal: boolean;
}): FileManagerAction {
  if (input.isFolder) return "open";
  return input.isSettled && input.canReveal ? "reveal" : "unavailable";
}
