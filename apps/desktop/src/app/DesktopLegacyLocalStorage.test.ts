import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLegacyLocalStorage from "./DesktopLegacyLocalStorage.ts";

const { readStorage } = vi.hoisted(() => ({ readStorage: vi.fn() }));
vi.mock("./chromiumLocalStorage.ts", () => ({ readChromiumLocalStorage: readStorage }));

it.effect("imports only this profile's old origin once, after the renderer saves its state", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const profile = `${root}/electron-profile`;
    const directory = `${profile}/Local Storage/leveldb`;
    const marker = `${profile}/personal-origin-local-storage-imported`;
    yield* fs.makeDirectory(directory, { recursive: true });
    const items = { "t3.environments": "saved-connection", "t3code:composer-drafts:v1": "draft" };
    readStorage.mockReset();
    readStorage.mockReturnValue(Effect.succeed(new Map(Object.entries(items))));
    const environment = DesktopEnvironment.layer({
      dirname: root,
      homeDirectory: root,
      platform: "darwin",
      processArch: "arm64",
      appVersion: "0.1.6",
      appPath: `${root}/Personal.app`,
      isPackaged: true,
      resourcesPath: root,
      runningUnderArm64Translation: false,
    }).pipe(Layer.provide(DesktopConfig.layerTest({ T3CODE_HOME: root })));
    const layer = DesktopLegacyLocalStorage.layer.pipe(Layer.provide(environment));
    yield* Effect.gen(function* () {
      const storage = yield* DesktopLegacyLocalStorage.DesktopLegacyLocalStorage;
      yield* storage.load(profile);
      assert.deepEqual(readStorage.mock.calls, [[directory, "t3code-personal://app"]]);
      assert.deepEqual(Option.getOrNull(yield* storage.take), items);
      assert.isTrue(Option.isNone(yield* storage.take));
      assert.isFalse(yield* fs.exists(marker));
      yield* storage.complete;
      assert.isTrue(yield* fs.exists(marker));
    }).pipe(Effect.provide(layer));
    yield* Effect.gen(function* () {
      const storage = yield* DesktopLegacyLocalStorage.DesktopLegacyLocalStorage;
      yield* storage.load(profile);
      assert.isTrue(Option.isNone(yield* storage.take));
      assert.equal(readStorage.mock.calls.length, 1);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
