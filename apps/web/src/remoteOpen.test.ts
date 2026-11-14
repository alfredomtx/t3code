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

import {
  remoteFallbackEditors,
  resolveRemoteOpenRoute,
  resolveRemoteOpenState,
} from "./remoteOpen";

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
    hostEnvironmentId: null,
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
            hostEnvironmentId: null,
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
        hostEnvironmentId: null,
      }),
    ).toEqual({ mode: "local-exec" });
  });

  it("uses deep links for a primary target reached over the network", () => {
    expect(
      resolveRemoteOpenState({
        route: primaryRoute("https://sol.tail1234.ts.net"),
        isDesktopRenderer: false,
        remoteOpenTargets: TAILSCALE_TARGETS,
        hostEnvironmentId: null,
      }),
    ).toEqual({ mode: "remote-links", host: TAILSCALE_TARGETS[0] });
  });

  it("keeps exec behavior for the desktop app's own primary even on a NAT URL", () => {
    // wsl-only binds the desktop-owned primary to its WSL2 NAT address.
    expect(
      resolveRemoteOpenState({
        route: primaryRoute("http://172.29.112.1:14369"),
        isDesktopRenderer: true,
        remoteOpenTargets: TAILSCALE_TARGETS,
        hostEnvironmentId: null,
      }),
    ).toEqual({ mode: "local-exec" });
  });

  it("keeps exec behavior for the environment that owns the desktop's T3 home", () => {
    // With Local environment off, a background service on this machine can own the
    // desktop's home and still be reached through T3 Connect.
    expect(
      resolveRemoteOpenState({
        route: {
          target: new RelayConnectionTarget({ environmentId, label: "sol" }),
          profile: Option.none(),
        },
        isDesktopRenderer: true,
        remoteOpenTargets: TAILSCALE_TARGETS,
        hostEnvironmentId: environmentId,
      }),
    ).toEqual({ mode: "local-exec" });
  });

  it("uses deep links for other environments when the desktop home has its own", () => {
    expect(
      resolveRemoteOpenState({
        route: {
          target: new RelayConnectionTarget({ environmentId, label: "sol" }),
          profile: Option.none(),
        },
        isDesktopRenderer: true,
        remoteOpenTargets: TAILSCALE_TARGETS,
        hostEnvironmentId: EnvironmentId.make("environment-host"),
      }),
    ).toEqual({
      mode: "remote-links",
      host: { kind: "tailscale", host: "sol.tail1234.ts.net" },
    });
  });

  it("leaves a bare desktop SSH alias for the editor to resolve through SSH config", () => {
    const state = resolveRemoteOpenState({
      route: sshRoute({ alias: "sol", username: null }),
      isDesktopRenderer: true,
      remoteOpenTargets: [
        { kind: "tailscale", host: "sol.tail1234.ts.net", username: "server-user" },
      ],
      hostEnvironmentId: null,
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
      hostEnvironmentId: null,
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
      hostEnvironmentId: null,
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
          hostEnvironmentId: null,
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

describe("remoteFallbackEditors", () => {
  it.each([
    {
      // iPadOS Safari requests the desktop site with a Macintosh user agent by default.
      device: "iPad with a desktop user agent",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 5,
    },
    {
      device: "iPhone",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5,
    },
    {
      device: "Android phone",
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      platform: "Linux armv81",
      maxTouchPoints: 5,
    },
  ])("offers no desktop editor for remote links on an $device", ({ device: _, ...identity }) => {
    expect(remoteFallbackEditors(identity)).toEqual([]);
  });

  it("keeps the VS Code fallback for remote links on a Mac", () => {
    expect(
      remoteFallbackEditors({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toEqual(["vscode"]);
  });
});

describe("buildRemoteOpenUrl", () => {
  it("roots Windows paths", () => {
    expect(
      buildRemoteOpenUrl({ editor: "vscode", host: "sol", absolutePath: "C:\\Users\\theo" }),
    ).toBe("vscode://vscode-remote/ssh-remote+sol/C%3A/Users/theo");
  });

  it("keeps a plus in the SSH username through Remote-SSH's authority parsing", () => {
    const url = buildRemoteOpenUrl({
      editor: "vscode",
      host: "ssh.example.com",
      username: "vm+demo",
      absolutePath: "/workspace/project",
    });
    // VS Code decodes the authority, then Remote-SSH (0.129) takes `authority.split("+")[1]` and
    // reads it as hex-encoded JSON `{ hostName, user }` or as `user@host`.
    const authority = decodeURIComponent(new URL(url ?? "").pathname.split("/")[1] ?? "");
    const destination = authority.split("+")[1] ?? "";
    const hexBytes = /^(?:[0-9a-f]{2})+$/i.test(destination)
      ? destination.match(/../g)?.map((byte) => Number.parseInt(byte, 16))
      : undefined;
    const resolved =
      hexBytes === undefined
        ? destination.match(/^(?:(?<user>.*)@)?(?<hostName>.+?)$/)?.groups
        : JSON.parse(new TextDecoder().decode(new Uint8Array(hexBytes)));
    expect({ user: resolved?.user, hostName: resolved?.hostName }).toEqual({
      user: "vm+demo",
      hostName: "ssh.example.com",
    });
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
