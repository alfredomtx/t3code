import type { ConnectionTarget } from "@t3tools/client-runtime/connection";

import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";
import type { RemoteOpenMode } from "../../remoteOpen";

export function shouldShowOpenInPicker(input: {
  readonly hasOpenTarget: boolean;
  readonly target: ConnectionTarget | null;
  readonly remoteOpenMode: RemoteOpenMode;
}): boolean {
  if (!input.hasOpenTarget || input.target === null) return false;
  // Desktop-managed secondary backends, including WSL, keep the picker hidden.
  return !(input.remoteOpenMode === "local-exec" && isDesktopLocalConnectionTarget(input.target));
}
