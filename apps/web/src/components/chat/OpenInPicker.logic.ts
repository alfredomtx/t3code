import type { ConnectionTarget } from "@t3tools/client-runtime/connection";

import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";
import type { RemoteOpenMode } from "../../remoteOpen";

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly target: ConnectionTarget | null;
  readonly remoteOpenMode: RemoteOpenMode;
}): boolean {
  if (!input.activeProjectName) return false;
  // Desktop-managed secondary backends, including WSL, keep the picker hidden.
  return !(
    input.remoteOpenMode === "local-exec" &&
    input.target !== null &&
    isDesktopLocalConnectionTarget(input.target)
  );
}
