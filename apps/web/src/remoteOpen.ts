import {
  connectionRouteId,
  connectionRouteKind,
  connectionRoutes,
  type ConnectionCatalogEntry,
  type ConnectionRoute,
  type ConnectionTarget,
} from "@t3tools/client-runtime/connection";
import {
  REMOTE_CAPABLE_EDITOR_IDS,
  type EditorId,
  type EnvironmentId,
  type RemoteOpenTarget,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { useAtomValue } from "@effect/atom-react";

import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { environmentPresentations } from "~/state/presentation";
import { environmentSession } from "~/state/session";
import { appAtomRegistry } from "~/rpc/atomRegistry";

export interface RemoteOpenHost {
  readonly kind: "ssh-alias" | RemoteOpenTarget["kind"];
  readonly host: string;
  readonly username?: string;
}

export type RemoteOpenState =
  | { readonly mode: "local-exec" }
  | { readonly mode: "remote-links"; readonly host: RemoteOpenHost }
  | { readonly mode: "remote-unavailable" };

export type RemoteOpenMode = RemoteOpenState["mode"];

export interface RemoteOpenResolution {
  readonly state: RemoteOpenState;
  readonly isResolved: boolean;
}

const LOCAL_EXEC: RemoteOpenState = { mode: "local-exec" };
const REMOTE_UNAVAILABLE: RemoteOpenState = { mode: "remote-unavailable" };
const UNRESOLVED_REMOTE_OPEN: RemoteOpenResolution = {
  state: LOCAL_EXEC,
  isResolved: false,
};

export function resolveRemoteOpenState(input: {
  readonly route: ConnectionRoute | null;
  readonly remoteOpenTargets: ReadonlyArray<RemoteOpenTarget> | undefined;
  readonly isDesktopRenderer: boolean;
}): RemoteOpenState {
  const { route } = input;
  if (route === null) {
    return LOCAL_EXEC;
  }
  const { target } = route;
  const profile = Option.getOrNull(route.profile);
  const matchingProfile =
    profile !== null &&
    profile.environmentId === target.environmentId &&
    "connectionId" in target &&
    profile.connectionId === target.connectionId
      ? profile
      : null;
  if (target._tag === "PrimaryConnectionTarget") {
    // The desktop app owns its primary backend, including WSL NAT addresses.
    if (input.isDesktopRenderer || connectionRouteKind(route) === "loopback") {
      return LOCAL_EXEC;
    }
  } else if (
    target._tag === "BearerConnectionTarget" &&
    (isDesktopLocalConnectionTarget(target) ||
      (matchingProfile?._tag === "BearerConnectionProfile" &&
        matchingProfile.learned !== true &&
        matchingProfile.authorization !== "t3-connect" &&
        connectionRouteKind(route) === "loopback"))
  ) {
    return LOCAL_EXEC;
  }

  const sshTarget =
    target._tag === "SshConnectionTarget" && matchingProfile?._tag === "SshConnectionProfile"
      ? matchingProfile.target
      : null;
  if (sshTarget !== null && sshTarget.alias.length > 0) {
    const { alias } = sshTarget;
    const userSeparator = alias.lastIndexOf("@");
    const host = userSeparator === -1 ? alias : alias.slice(userSeparator + 1);
    const username =
      sshTarget.username?.trim() || (userSeparator === -1 ? null : alias.slice(0, userSeparator));
    return {
      mode: "remote-links",
      host: {
        kind: "ssh-alias",
        host,
        ...(username === null ? {} : { username }),
      },
    };
  }
  const advertised = input.remoteOpenTargets?.[0];
  if (advertised !== undefined) {
    return { mode: "remote-links", host: advertised };
  }
  return REMOTE_UNAVAILABLE;
}

function remoteOpenStatesEqual(previous: RemoteOpenState, next: RemoteOpenState): boolean {
  if (previous.mode !== next.mode) return false;
  if (previous.mode !== "remote-links" || next.mode !== "remote-links") return true;
  return (
    previous.host.kind === next.host.kind &&
    previous.host.host === next.host.host &&
    previous.host.username === next.host.username
  );
}

export function resolveRemoteOpenRoute(
  entry: ConnectionCatalogEntry,
  activeTarget: ConnectionTarget | null,
): ConnectionRoute {
  if (activeTarget === null) return entry;
  return (
    connectionRoutes(entry).find(
      (route) =>
        route.target.environmentId === activeTarget.environmentId &&
        route.target._tag === activeTarget._tag &&
        connectionRouteId(route.target) === connectionRouteId(activeTarget),
    ) ?? { target: activeTarget, profile: Option.none() }
  );
}

// The presentation changes with every server config push and reconnect. This
// keeps the previous resolution while it is equal, so subscribers re-render only
// when where files open actually changes.
const remoteOpenResolutionAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): RemoteOpenResolution => {
    const presentation = get(environmentPresentations.presentationAtom(environmentId));
    const entry = presentation?.entry ?? null;
    if (entry === null) {
      return UNRESOLVED_REMOTE_OPEN;
    }
    const prepared = Option.getOrNull(
      get(environmentSession.preparedConnectionValueAtom(environmentId)),
    );
    const next: RemoteOpenResolution = {
      state: resolveRemoteOpenState({
        route: resolveRemoteOpenRoute(entry, prepared?.target ?? null),
        remoteOpenTargets: presentation?.serverConfig?.remoteOpenTargets,
        isDesktopRenderer: window.desktopBridge !== undefined,
      }),
      isResolved: true,
    };
    const previous = Option.getOrNull(get.self<RemoteOpenResolution>());
    return previous !== null &&
      previous.isResolved &&
      remoteOpenStatesEqual(previous.state, next.state)
      ? previous
      : next;
  }).pipe(Atom.withLabel(`remote-open-resolution:${environmentId}`)),
);

const UNRESOLVED_REMOTE_OPEN_ATOM = Atom.make(UNRESOLVED_REMOTE_OPEN);

export function useRemoteOpenResolution(environmentId: EnvironmentId | null): RemoteOpenResolution {
  return useAtomValue(
    environmentId === null ? UNRESOLVED_REMOTE_OPEN_ATOM : remoteOpenResolutionAtom(environmentId),
  );
}

export function readRemoteOpenResolution(environmentId: EnvironmentId): RemoteOpenResolution {
  return appAtomRegistry.get(remoteOpenResolutionAtom(environmentId));
}

export function useRemoteOpenState(environmentId: EnvironmentId | null): RemoteOpenState {
  return useRemoteOpenResolution(environmentId).state;
}

const REMOTE_FALLBACK_EDITORS: ReadonlyArray<EditorId> = ["vscode"];

// Probed once per page: installed editors rarely change, and the probe spawns processes.
const remoteCapableEditorsAtom = Atom.make((get): ReadonlyArray<EditorId> => {
  const probe = window.desktopBridge?.probeRemoteEditors;
  probe?.().then(
    (ids) => {
      const remoteCapable = ids.filter((id) => REMOTE_CAPABLE_EDITOR_IDS.includes(id));
      if (remoteCapable.length > 0) get.setSelf(remoteCapable);
    },
    () => undefined,
  );
  return REMOTE_FALLBACK_EDITORS;
}).pipe(Atom.keepAlive, Atom.withLabel("remote-capable-editors"));

export function useRemoteCapableEditors(): ReadonlyArray<EditorId> {
  return useAtomValue(remoteCapableEditorsAtom);
}

/** Resolves false when the desktop refuses the URL, including unsupported editor schemes. */
export async function openRemoteEditorUrl(url: string): Promise<boolean> {
  const bridge = window.desktopBridge;
  if (bridge !== undefined) {
    try {
      return await bridge.openExternal(url);
    } catch {
      return false;
    }
  }
  window.location.assign(url);
  return true;
}

const REMOTE_OPEN_HINT_KEY = "t3code:remote-open-hint-seen";

export function useRemoteOpenHint(): readonly [seen: boolean, markSeen: () => void] {
  const [seen, setSeen] = useLocalStorage(REMOTE_OPEN_HINT_KEY, false, Schema.Boolean);
  return [seen, () => setSeen(true)] as const;
}
