import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect.each(["darwin", "win32", "linux"] as const)(
  "isolates the personal profile on %s without reading official profiles",
  (platform) =>
    Effect.gen(function* () {
      for (const isDevelopment of [false, true]) {
        const profile = yield* resolveUserDataPath({
          appDataDirectory: "/profiles",
          isDevelopment,
          platform,
        });
        assert.equal(profile, "/profiles/t3code-personal");
      }
    }).pipe(Effect.provide(Path.layer)),
);

it.effect("isolates the Electron lock and browser data with an explicit smoke home", () =>
  Effect.gen(function* () {
    assert.equal(
      yield* resolveUserDataPath({
        appDataDirectory: "/profiles",
        homeDirectory: "/users/alice",
        baseDir: "/tmp/smoke-home",
        isDevelopment: false,
        platform: "darwin",
      }),
      "/tmp/smoke-home/electron-profile",
    );
  }).pipe(Effect.provide(Path.layer)),
);
