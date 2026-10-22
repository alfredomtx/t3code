import {
  BearerConnectionProfile,
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  RelayConnectionTarget,
  SshConnectionProfile,
  SshConnectionTarget,
  type ConnectionRoute,
} from "@t3tools/client-runtime/connection";
import { buildRemoteOpenUrl, EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { resolveRemoteOpenRoute, resolveRemoteOpenState } from "./remoteOpen";

const environmentId = EnvironmentId.make("environment-1");

const primaryRoute = (httpBaseUrl: string): ConnectionRoute => ({
  target: new PrimaryConnectionTarget({
    environmentId,
    label: "sol",
    httpBaseUrl,
    wsBaseUrl: httpBaseUrl.replace("http", "ws"),
  }),
  profile: Option.none(),
});

function bearerRoute(
  httpBaseUrl: string,
  overrides: Partial<ConstructorParameters<typeof BearerConnectionProfile>[0]> = {},
): ConnectionRoute {
  const target = new BearerConnectionTarget({
    environmentId,
    label: "Mac",
    connectionId: "saved-service",
  });
  return {
    target,
    profile: Option.some(
      new BearerConnectionProfile({
        environmentId,
        label: target.label,
        connectionId: target.connectionId,
        httpBaseUrl,
        wsBaseUrl: httpBaseUrl.replace("http", "ws"),
        ...overrides,
      }),
    ),
  };
}

function sshRoute(sshTarget: {
  readonly alias: string;
  readonly username: string | null;
}): ConnectionRoute {
  const target = new SshConnectionTarget({ environmentId, label: "server", connectionId: "ssh-1" });
  return {
    target,
    profile: Option.some(
      new SshConnectionProfile({
        environmentId,
        label: target.label,
        connectionId: target.connectionId,
        target: { ...sshTarget, hostname: "127.0.0.1", port: null },
      }),
    ),
  };
}

const TAILSCALE_TARGETS = [
  { kind: "tailscale", host: "sol.tail1234.ts.net" },
  { kind: "mdns", host: "sol.local" },
] as const;

const resolve = (route: ConnectionRoute) =>
  resolveRemoteOpenState({
    route,
    remoteOpenTargets: [],
    isDesktopRenderer: true,
  });

describe("resolveRemoteOpenState", () => {
  it.each(["http://127.0.0.1:3773", "http://localhost:3773", "http://[::1]:3773"])(
    "opens editors locally for a saved direct loopback service at %s",
    (url) => {
      for (const isDesktopRenderer of [false, true]) {
        expect(
          resolveRemoteOpenState({
            route: bearerRoute(url),
            remoteOpenTargets: TAILSCALE_TARGETS,
            isDesktopRenderer,
          }),
        ).toEqual({ mode: "local-exec" });
      }
    },
  );

  it.each([
    "https://server.example:3773",
    "http://127.0.0.1.example:3773",
    "http://192.168.1.3:3773",
    "http://100.64.1.2:3773",
    "https://sol.tail1234.ts.net",
    "not-a-url",
  ])("keeps saved non-loopback connections remote at %s", (url) =>
    expect(resolve(bearerRoute(url))).toEqual({ mode: "remote-unavailable" }),
  );

  it.each([
    { learned: true as const },
    { authorization: "t3-connect" as const },
    { connectionId: "other-route" },
    { environmentId: EnvironmentId.make("other-environment") },
  ])("does not infer local execution from an ineligible profile %j", (overrides) => {
    expect(resolve(bearerRoute("http://127.0.0.1:3773", overrides))).toEqual({
      mode: "remote-unavailable",
    });
  });

  it("keeps absent and wrong-profile bearer routes remote", () => {
    const route = bearerRoute("http://127.0.0.1:3773");
    expect(resolve({ ...route, profile: Option.none() })).toEqual({ mode: "remote-unavailable" });
    expect(
      resolve({ ...route, profile: sshRoute({ alias: "server", username: null }).profile }),
    ).toEqual({ mode: "remote-unavailable" });
  });

  it("keeps managed SSH tunnels remote even when the SSH host is loopback", () => {
    expect(resolve(sshRoute({ alias: "server", username: null }))).toEqual({
      mode: "remote-links",
      host: { kind: "ssh-alias", host: "server" },
    });
  });

  it("does not use a mismatched SSH profile", () => {
    const route = sshRoute({ alias: "server", username: null });
    expect(
      resolve({
        ...route,
        target: new SshConnectionTarget({ environmentId, label: "other", connectionId: "ssh-2" }),
      }),
    ).toEqual({ mode: "remote-unavailable" });
  });

  it("keeps desktop-managed secondary execution", () => {
    expect(
      resolve({
        target: new BearerConnectionTarget({
          environmentId,
          label: "WSL",
          connectionId: "local:wsl:Ubuntu",
        }),
        profile: Option.none(),
      }),
    ).toEqual({ mode: "local-exec" });
  });

  it("keeps exec behavior for a loopback primary target", () => {
    expect(
      resolveRemoteOpenState({
        route: primaryRoute("http://127.0.0.1:8000"),
        isDesktopRenderer: false,
        remoteOpenTargets: TAILSCALE_TARGETS,
      }),
    ).toEqual({ mode: "local-exec" });
  });

  it("uses deep links for a primary target reached over the network", () => {
    expect(
      resolveRemoteOpenState({
        route: primaryRoute("https://sol.tail1234.ts.net"),
        isDesktopRenderer: false,
        remoteOpenTargets: TAILSCALE_TARGETS,
      }),
    ).toEqual({ mode: "remote-links", host: TAILSCALE_TARGETS[0] });
  });

  it("keeps exec behavior for the desktop app's own primary even on a NAT URL", () => {
    expect(
      resolveRemoteOpenState({
        route: primaryRoute("http://172.29.112.1:14369"),
        isDesktopRenderer: true,
        remoteOpenTargets: TAILSCALE_TARGETS,
      }),
    ).toEqual({ mode: "local-exec" });
  });
  it("leaves a bare desktop SSH alias for the editor to resolve through SSH config", () => {
    const state = resolveRemoteOpenState({
      route: sshRoute({ alias: "sol", username: null }),
      isDesktopRenderer: true,
      remoteOpenTargets: [
        { kind: "tailscale", host: "sol.tail1234.ts.net", username: "server-user" },
      ],
    });
    expect(state).toEqual({ mode: "remote-links", host: { kind: "ssh-alias", host: "sol" } });
    if (state.mode !== "remote-links") throw new Error("Expected a remote link");
    expect(
      buildRemoteOpenUrl({ editor: "vscode", ...state.host, absolutePath: "/work/project" }),
    ).toBe("vscode://vscode-remote/ssh-remote+sol/work/project");
    expect(
      buildRemoteOpenUrl({ editor: "zed", ...state.host, absolutePath: "/work/project" }),
    ).toBe("zed://ssh/sol/work/project");
    expect(
      buildRemoteOpenUrl({ editor: "idea", ...state.host, absolutePath: "/work/project" }),
    ).toBe(
      "jetbrains://gateway/ssh/environment?h=sol&launchIde=true&ideHint=IU&projectHint=%2Fwork%2Fproject",
    );
  });

  it.each([
    { alias: "server", username: "admin-user" },
    { alias: "admin-user@server", username: null },
    { alias: "old-user@server", username: "admin-user" },
    { alias: "admin-user@server", username: "" },
    { alias: "admin-user@server", username: "  " },
  ])("keeps one login username in editor links for $alias (username: '$username')", (sshTarget) => {
    const state = resolveRemoteOpenState({
      route: sshRoute(sshTarget),
      isDesktopRenderer: true,
      remoteOpenTargets: TAILSCALE_TARGETS,
    });
    expect(state.mode).toBe("remote-links");
    if (state.mode !== "remote-links") throw new Error("Expected a remote link");
    expect(
      buildRemoteOpenUrl({ editor: "vscode", ...state.host, absolutePath: "/work/project" }),
    ).toBe("vscode://vscode-remote/ssh-remote+admin-user%40server/work/project");
    expect(
      buildRemoteOpenUrl({ editor: "zed", ...state.host, absolutePath: "/work/project" }),
    ).toBe("zed://ssh/admin-user@server/work/project");
    expect(
      buildRemoteOpenUrl({ editor: "idea", ...state.host, absolutePath: "/work/project" }),
    ).toBe(
      "jetbrains://gateway/ssh/environment?h=server&launchIde=true&ideHint=IU&projectHint=%2Fwork%2Fproject&u=admin-user",
    );
  });

  it("uses the advertised login username in editor links over a relay", () => {
    const state = resolveRemoteOpenState({
      route: {
        target: new RelayConnectionTarget({ environmentId, label: "server" }),
        profile: Option.none(),
      },
      isDesktopRenderer: false,
      remoteOpenTargets: [
        { kind: "tailscale", host: "server.tail1234.ts.net", username: "admin-user" },
      ],
    });
    expect(state.mode).toBe("remote-links");
    if (state.mode !== "remote-links") throw new Error("Expected a remote link");
    expect(
      buildRemoteOpenUrl({ editor: "cursor", ...state.host, absolutePath: "/work/project" }),
    ).toBe("cursor://vscode-remote/ssh-remote+admin-user%40server.tail1234.ts.net/work/project");
  });

  it("reports unavailable when a remote environment advertises no hosts", () => {
    for (const remoteOpenTargets of [[], undefined] as const) {
      expect(
        resolveRemoteOpenState({
          route: {
            target: new RelayConnectionTarget({ environmentId, label: "sol" }),
            profile: Option.none(),
          },
          isDesktopRenderer: false,
          remoteOpenTargets,
        }),
      ).toEqual({ mode: "remote-unavailable" });
    }
  });

  it("does not infer relay locality from a loopback bearer profile", () => {
    const route = bearerRoute("http://127.0.0.1:3773");
    expect(
      resolve({ ...route, target: new RelayConnectionTarget({ environmentId, label: "Mac" }) }),
    ).toEqual({ mode: "remote-unavailable" });
  });
});

describe("active editor route", () => {
  it("uses the active SSH profile instead of the first saved loopback route", () => {
    const saved = bearerRoute("http://127.0.0.1:3773");
    const active = sshRoute({ alias: "server", username: "admin" });
    const entry = { ...saved, enabled: true, alternateRoutes: [active] };
    expect(resolveRemoteOpenRoute(entry, null)).toBe(entry);
    expect(resolveRemoteOpenRoute(entry, active.target)).toBe(active);
    expect(resolve(resolveRemoteOpenRoute(entry, active.target))).toEqual({
      mode: "remote-links",
      host: { kind: "ssh-alias", host: "server", username: "admin" },
    });
  });

  it("uses an active saved bearer fallback instead of the first relay route", () => {
    const saved = bearerRoute("http://127.0.0.1:3773");
    const entry = {
      target: new RelayConnectionTarget({ environmentId, label: "Mac" }),
      profile: Option.none(),
      enabled: true,
      alternateRoutes: [saved],
    };
    expect(resolve(resolveRemoteOpenRoute(entry, saved.target))).toEqual({ mode: "local-exec" });
  });

  it("does not borrow a profile when the active route is absent or belongs to another environment", () => {
    const saved = bearerRoute("http://127.0.0.1:3773");
    const entry = { ...saved, enabled: true };
    for (const target of [
      new BearerConnectionTarget({ environmentId, label: "Missing", connectionId: "missing" }),
      new BearerConnectionTarget({
        environmentId: EnvironmentId.make("other"),
        label: "Other",
        connectionId: "saved-service",
      }),
      new SshConnectionTarget({
        environmentId,
        label: "Other route kind",
        connectionId: "saved-service",
      }),
    ]) {
      expect(resolve(resolveRemoteOpenRoute(entry, target))).toEqual({
        mode: "remote-unavailable",
      });
    }
  });
});

describe("buildRemoteOpenUrl", () => {
  it("roots Windows paths", () => {
    expect(
      buildRemoteOpenUrl({ editor: "vscode", host: "sol", absolutePath: "C:\\Users\\theo" }),
    ).toBe("vscode://vscode-remote/ssh-remote+sol/C%3A/Users/theo");
  });

  it("drops the Windows drive letter for Zed", () => {
    expect(
      buildRemoteOpenUrl({ editor: "zed", host: "sol", absolutePath: "C:\\Users\\theo" }),
    ).toBe("zed://ssh/sol/Users/theo");
    expect(buildRemoteOpenUrl({ editor: "zed", host: "sol", absolutePath: "/C:/project" })).toBe(
      "zed://ssh/sol/C%3A/project",
    );
  });

  it("adds a file position only for confirmed VS Code-family file targets", () => {
    const targets = [
      ["vscode", true, "vscode://vscode-remote/ssh-remote+sol/tmp/my%20file.md:1:1"],
      ["cursor", true, "cursor://vscode-remote/ssh-remote+sol/tmp/my%20file.md:1:1"],
      ["vscode", false, "vscode://vscode-remote/ssh-remote+sol/tmp/my%20file.md"],
      ["vscode", undefined, "vscode://vscode-remote/ssh-remote+sol/tmp/my%20file.md"],
      ["zed", true, "zed://ssh/sol/tmp/my%20file.md"],
      [
        "pycharm",
        true,
        "jetbrains://gateway/ssh/environment?h=sol&launchIde=true&ideHint=PY&projectHint=%2Ftmp%2Fmy+file.md",
      ],
    ] as const;

    for (const [editor, isFile, expected] of targets) {
      expect(
        buildRemoteOpenUrl({
          editor,
          host: "sol",
          absolutePath: "/tmp/my file.md",
          ...(isFile === undefined ? {} : { isFile }),
        }),
        `${editor}, isFile=${isFile}`,
      ).toBe(expected);
    }
  });
});
