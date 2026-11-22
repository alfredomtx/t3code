import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import * as HostProcess from "@t3tools/shared/HostProcess";

import {
  makeClaudeCapabilitiesCacheKey,
  makeClaudeContinuationGroupKey,
  makeClaudeEnvironment,
  mergeClaudeProcessEnvironment,
  resolveClaudeHomePath,
} from "./ClaudeHome.ts";

it.layer(NodeServices.layer)("ClaudeHome", (it) => {
  describe("Claude home resolution", () => {
    it.effect("resolves configured Claude HOME and stamps continuation/cache keys with it", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const homePath = "~/.claude-work";
        const resolved = path.resolve(NodeOS.homedir(), ".claude-work");

        expect(yield* resolveClaudeHomePath({ homePath })).toBe(resolved);
        expect((yield* makeClaudeEnvironment({ homePath })).CLAUDE_CONFIG_DIR).toBe(resolved);
        expect(yield* makeClaudeContinuationGroupKey({ homePath })).toBe(`claude:home:${resolved}`);
        expect(yield* makeClaudeCapabilitiesCacheKey({ binaryPath: "claude", homePath })).toBe(
          `claude\0${resolved}\0`,
        );
      }),
    );

    it.effect("uses inherited CLAUDE_CONFIG_DIR when homePath is empty", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const inherited = path.resolve("/tmp/claude-inherited");
        const environment = { CLAUDE_CONFIG_DIR: inherited };

        expect(yield* resolveClaudeHomePath({ homePath: "" }, environment)).toBe(inherited);
        expect(yield* makeClaudeContinuationGroupKey({ homePath: "" }, environment)).toBe(
          `claude:home:${inherited}`,
        );

        const explicit = path.resolve(NodeOS.homedir(), ".claude-work");
        expect(yield* resolveClaudeHomePath({ homePath: "~/.claude-work" }, environment)).toBe(
          explicit,
        );
      }),
    );

    it.effect("separates capability probes by cwd", () =>
      Effect.gen(function* () {
        const config = { binaryPath: "claude", homePath: "" };
        const first = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-a");
        const second = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-b");
        expect(first).not.toBe(second);
      }),
    );
  });

  it.effect("starts with managed settings when the user settings read stalls", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homePath = path.resolve("user-claude");
      const programFiles = path.resolve("managed-claude");
      const readStarted = yield* Deferred.make<void>();
      const blockedRead = yield* Deferred.make<string>();
      const completed = yield* Deferred.make<NodeJS.ProcessEnv>();
      let userReads = 0;
      const merge = mergeClaudeProcessEnvironment({ homePath }, undefined, {
        ProgramFiles: programFiles,
      }).pipe(
        Effect.provideService(HostProcess.Platform, "win32"),
        Effect.provideService(FileSystem.FileSystem, {
          ...fileSystem,
          readFileString: (file) =>
            file === path.join(homePath, "settings.json")
              ? Effect.gen(function* () {
                  userReads++;
                  yield* Deferred.succeed(readStarted, undefined);
                  return yield* Deferred.await(blockedRead);
                })
              : Effect.succeed('{"env":{"CLAUDE_CODE_ENTRYPOINT":"managed"}}'),
        }),
      );
      yield* Effect.addFinalizer(() => Deferred.succeed(blockedRead, "{}"));
      yield* merge.pipe(
        Effect.tap((environment) => Deferred.succeed(completed, environment)),
        Effect.forkScoped,
      );
      yield* Deferred.await(readStarted);
      yield* TestClock.adjust("5 seconds");
      expect(Option.isSome(yield* Deferred.poll(completed))).toBe(true);
      expect((yield* Deferred.await(completed)).CLAUDE_CODE_ENTRYPOINT).toBe("managed");
      expect((yield* merge).CLAUDE_CODE_ENTRYPOINT).toBe("managed");
      expect(userReads).toBe(1);
    }),
  );

  it.effect(
    "drops the launching Claude session and Electron's run-as-Node flag, and labels processes t3-code unless overridden",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const homePath = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-claude-home-" });
        const host = {
          CLAUDE_CODE_ENTRYPOINT: "claude-desktop",
          CLAUDECODE: "1",
          CLAUDE_CODE_SESSION_ID: "host-session",
          CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/host-claude.sock",
          CLAUDE_EFFORT: "high",
          ELECTRON_RUN_AS_NODE: "1",
          KEEP: "1",
        };
        const instance = [
          { name: "CLAUDE_CODE_ENTRYPOINT", value: "instance", sensitive: false },
          { name: "CLAUDE_EFFORT", value: "low", sensitive: false },
        ];

        expect(yield* mergeClaudeProcessEnvironment({ homePath }, undefined, host)).toEqual({
          CLAUDE_CODE_ENTRYPOINT: "t3-code",
          KEEP: "1",
        });
        expect(yield* mergeClaudeProcessEnvironment({ homePath }, instance, host)).toEqual({
          CLAUDE_CODE_ENTRYPOINT: "instance",
          CLAUDE_EFFORT: "low",
          KEEP: "1",
        });

        yield* fileSystem.writeFileString(
          path.join(homePath, "settings.json"),
          JSON.stringify({ env: { CLAUDE_CODE_ENTRYPOINT: "custom" } }),
        );
        expect(
          (yield* mergeClaudeProcessEnvironment({ homePath }, instance, host))
            .CLAUDE_CODE_ENTRYPOINT,
        ).toBe("custom");
      }),
  );
});
