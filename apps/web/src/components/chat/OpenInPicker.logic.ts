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
