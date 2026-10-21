import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import {
  acquireLock,
  compareVersions,
  parseNightly,
  personalVersion,
  fullSha,
  writeJson,
  publicBuildEnvironment,
  isAncestor,
  assertBuildEnvironment,
} from "./core.mjs";
import { verifyManifest, syncReleaseAssets, smokeApp } from "./verify-artifact.mjs";

async function temporary(fn) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-personal-NodeTest.test-"));
  try {
    await fn(root);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
}
NodeTest.test("personal revisions remain ordered across upstream nightlies and retries", () => {
  const tag = "v0.1.1-nightly.20261020.3411";
  const a = personalVersion(tag, 1),
    b = personalVersion(tag, 2);
  NodeAssert.equal(a, "0.1.1-nightly.20261020.3411001");
  NodeAssert.equal(personalVersion(tag, 1), a);
  NodeAssert.ok(compareVersions(b, a) > 0);
  NodeAssert.ok(
    compareVersions(personalVersion("v0.1.1-nightly.20261020.3412"), personalVersion(tag, 999)) > 0,
  );
  for (const revision of [0, 1000, NaN, 1.5])
    NodeAssert.throws(() => personalVersion(tag, revision));
  for (const invalid of [
    "v0.1.1",
    "1.0.0-nightly.20260230.1",
    "1.0.0-nightly.20260101.99999999999999999",
    "1.0.0-nightly.20260101.1;echo injected",
  ])
    NodeAssert.throws(() => parseNightly(invalid));
  NodeAssert.throws(() => fullSha("d36b7da2485b"));
});
NodeTest.test("one owner excludes another process and a dead PID can be reclaimed", () =>
  temporary(async (root) => {
    const lock = NodePath.join(root, "lock");
    const release = await acquireLock(lock);
    NodeAssert.equal(await acquireLock(lock), null);
    const contender = NodeChildProcess.spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      `import { acquireLock } from ${JSON.stringify(new URL("./core.mjs", import.meta.url).href)}; if (await acquireLock(process.argv[1]) !== null) process.exit(7);`,
      lock,
    ]);
    NodeAssert.equal(contender.status, 0);
    await release();
    const dead = NodeChildProcess.spawnSync(process.execPath, ["-e", ""]);
    await NodeFSP.mkdir(lock);
    await writeJson(NodePath.join(lock, "owner.json"), { pid: dead.pid, token: "dead" });
    const recovered = await acquireLock(lock);
    NodeAssert.ok(recovered);
    await recovered();
  }),
);
NodeTest.test("public defaults exclude Apple and private credentials", () => {
  const env = publicBuildEnvironment(
    "T3CODE_CLERK_PUBLISHABLE_KEY=pk_live_public\nT3CODE_CLERK_JWT_TEMPLATE=t3-relay\nT3CODE_CLERK_CLI_OAUTH_CLIENT_ID=public\nT3CODE_RELAY_URL=https://relay.t3.codes\nT3CODE_APPLE_TEAM_ID=private\nGH_TOKEN=secret",
  );
  NodeAssert.equal(env.T3CODE_RELAY_URL, "https://relay.t3.codes");
  NodeAssert.equal(Object.keys(env).length, 4);
  NodeAssert.equal(env.GH_TOKEN, undefined);
  NodeAssert.throws(() => publicBuildEnvironment(""));
});
NodeTest.test("corrupt bytes cannot pass the release manifest gate", () =>
  temporary(async (root) => {
    const version = personalVersion("v1.0.0-nightly.20260101.7");
    const zip = `T3-Code-Personal-${version}-arm64.zip`;
    await NodeFSP.writeFile(NodePath.join(root, zip), "corrupt");
    await NodeFSP.writeFile(NodePath.join(root, `${zip}.blockmap`), "blockmap");
    await NodeFSP.writeFile(
      NodePath.join(root, "nightly-mac.yml"),
      `version: ${version}\npath: ${zip}\nsha512: incorrect\nfiles:\n  - url: ${zip}\n    size: 7\n    sha512: incorrect\n`,
    );
    await NodeAssert.rejects(verifyManifest(root, version));
  }),
);

NodeTest.test("ancestry uses Git exit status and rejects execution failures", () => {
  for (const status of [0, 1])
    NodeAssert.equal(
      isAncestor(() => ({ status }), "a".repeat(40), "b".repeat(40)),
      status === 0,
    );
  for (const result of [{ status: 128 }, { status: null, error: new Error("spawn failed") }])
    NodeAssert.throws(() => isAncestor(() => result, "a".repeat(40), "b".repeat(40)));
});

NodeTest.test("build inputs reject hidden environment files and symlinks", () =>
  temporary(async (root) => {
    await NodeFSP.mkdir(NodePath.join(root, "apps/web"), { recursive: true });
    await NodeFSP.mkdir(NodePath.join(root, "node_modules/ignored"), { recursive: true });
    const hidden = NodePath.join(root, "apps/web/.env.production.local");
    await NodeFSP.writeFile(hidden, "VITE_UNEXPECTED=value");
    await NodeAssert.rejects(assertBuildEnvironment(root));
    await NodeFSP.rm(hidden);
    await NodeFSP.writeFile(NodePath.join(root, ".env.example"), "public defaults");
    await NodeFSP.writeFile(NodePath.join(root, "node_modules/ignored/.env"), "dependency");
    await assertBuildEnvironment(root);
    await NodeFSP.symlink(".env.example", NodePath.join(root, ".env"));
    await NodeAssert.rejects(assertBuildEnvironment(root));
  }),
);

NodeTest.test(
  "draft retries replace corrupt assets, verify uploaded bytes, and preserve published assets",
  () =>
    temporary(async (root) => {
      const asset = NodePath.join(root, "app.zip");
      await NodeFSP.writeFile(asset, "verified bytes");
      const remote = new Map([["app.zip", "partial upload"]]);
      const calls = [];
      let draft = true;
      const release = () => ({
        tagName: "vtest",
        isDraft: draft,
        assets: [...remote.keys()].map((name) => ({ name })),
      });
      const run = async (...args) => {
        calls.push(args[1]);
        const name = args[3];
        if (args[1] === "download")
          await NodeFSP.writeFile(NodePath.join(args.at(-1), "app.zip"), remote.get("app.zip"));
        if (args[1] === "delete-asset") remote.delete(name);
        if (args[1] === "upload") remote.set(NodePath.basename(name), await NodeFSP.readFile(name));
      };
      const options = {
        directory: NodePath.join(root, "readback"),
        assets: [asset],
        repository: "owner/repo",
        run,
        refresh: async () => release(),
        repairDraft: true,
      };
      await syncReleaseAssets({ ...options, release: release() });
      NodeAssert.deepEqual(calls, ["download", "delete-asset", "upload", "download"]);
      NodeAssert.equal(remote.get("app.zip").toString(), "verified bytes");
      calls.length = 0;
      remote.set("app.zip", "corrupt again");
      draft = false;
      await NodeAssert.rejects(syncReleaseAssets({ ...options, release: release() }));
      NodeAssert.deepEqual(calls, ["download"]);
      calls.length = 0;
      await NodeAssert.rejects(
        syncReleaseAssets({ ...options, release: { ...release(), isDraft: true } }),
      );
      NodeAssert.deepEqual(calls, ["download"]);
      draft = true;
      remote.clear();
      calls.length = 0;
      await syncReleaseAssets({ ...options, release: release() });
      NodeAssert.deepEqual(calls, ["upload", "download"]);
    }),
);

NodeTest.test("smoke spawn errors reject without an unhandled event or leaked log descriptor", () =>
  temporary(async (root) => {
    const logFile = NodePath.join(root, "smoke.log");
    await NodeAssert.rejects(
      smokeApp({ executable: NodePath.join(root, "missing"), temporary: root, logFile }),
      { code: "ENOENT" },
    );
    const descriptors = NodeChildProcess.spawnSync(
      "/usr/sbin/lsof",
      ["-a", "-p", String(process.pid), logFile],
      { encoding: "utf8" },
    );
    NodeAssert.equal(descriptors.status, 1, descriptors.stdout);
  }),
);

NodeTest.test(
  "smoke keeps the real HOME and starts Personal with the local environment disabled",
  () =>
    temporary(async (root) => {
      const script = NodePath.join(root, "fake-app");
      await NodeFSP.writeFile(
        script,
        `#!${process.execPath}
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
assert.equal(process.env.HOME, ${JSON.stringify(process.env.HOME)});
const settings = JSON.parse(fs.readFileSync(path.join(process.env.T3CODE_HOME, 'userdata/desktop-settings.json')));
assert.equal(settings.localEnvironmentEnabled, false);
fs.mkdirSync(path.join(process.env.T3CODE_HOME, 'electron-profile'));
console.log('desktop app control socket ready');
console.log('bootstrap skipping local environment (disabled in settings)');
console.log('app ready');
setInterval(() => {}, 1000);
`,
        { mode: 0o755 },
      );
      await smokeApp({
        executable: script,
        temporary: root,
        logFile: NodePath.join(root, "smoke.log"),
      });
    }),
);

NodeTest.test("smoke cleanup finds a backend after its launcher exits and closes its port", () =>
  temporary(async (root) => {
    const script = NodePath.join(root, "fake-app");
    const pidFile = NodePath.join(root, "backend.json");
    await NodeFSP.writeFile(
      script,
      `#!${process.execPath}\nconst {spawn} = require('node:child_process');\nconst code = ${JSON.stringify("const fs = require('node:fs'); const net = require('node:net'); const server = net.createServer(); server.listen(Number(process.env.T3CODE_PORT), '127.0.0.1', () => { fs.writeFileSync(" + JSON.stringify(pidFile) + ", JSON.stringify({ pid: process.pid, port: server.address().port, home: process.env.HOME, t3home: process.env.T3CODE_HOME })); console.log('fatal startup error'); });")};\nspawn(process.execPath, ['-e', code], {stdio:'inherit'}).unref();\n`,
      { mode: 0o755 },
    );
    await NodeAssert.rejects(
      smokeApp({ executable: script, temporary: root, logFile: NodePath.join(root, "smoke.log") }),
      /exited during startup|reported a startup error/u,
    );
    const backend = JSON.parse(await NodeFSP.readFile(pidFile, "utf8"));
    NodeAssert.equal(backend.home, process.env.HOME);
    NodeAssert.equal(backend.t3home, NodePath.join(root, "app-home"));
    NodeAssert.throws(() => process.kill(backend.pid, 0), { code: "ESRCH" });
    await NodeAssert.rejects(fetch(`http://127.0.0.1:${backend.port}`));
  }),
);

NodeTest.test("release preflight needs no local configuration or incident records", () =>
  temporary(async (root) => {
    const source = NodePath.resolve(import.meta.dirname, "../..");
    const bin = NodePath.join(root, "bin");
    const stateRoot = NodePath.join(root, ".local/share/t3-personal");
    await NodeFSP.mkdir(bin);
    await NodeFSP.mkdir(stateRoot, { recursive: true });
    for (const file of [
      "config.json",
      "status.json",
      "pending.json",
      "last-failure.json",
      "repair-thread.json",
    ])
      await NodeFSP.writeFile(NodePath.join(stateRoot, file), "invalid retired data");
    const calls = NodePath.join(root, "calls");
    const script = `#!/bin/sh
printf '%s\\n' "$*" >> '${calls}'
case "$*" in
  'remote get-url origin') echo https://github.com/alfredomtx/t3code.git;;
  'auth status'|'--version') exit 0;;
  'api repos/alfredomtx/t3code-personal-releases --jq .visibility') echo public;;
  *) echo "Unexpected command: $*" >&2; exit 9;;
esac
`;
    for (const command of ["git", "gh", "vp"])
      await NodeFSP.writeFile(NodePath.join(bin, command), script, { mode: 0o755 });
    const env = {
      ...process.env,
      HOME: root,
      PATH: `${bin}:${process.env.PATH}`,
      T3CODE_PERSONAL_SIGN_IDENTITY: "5982A03C0452FB344BC92765B84FF62391712882",
    };
    const cli = NodePath.join(source, "scripts/personal/nightly.mjs");
    const result = NodeChildProcess.spawnSync(process.execPath, [cli, "--check"], {
      env,
      encoding: "utf8",
    });
    NodeAssert.equal(result.status, 0, result.stderr);
    NodeAssert.match(result.stdout, /prerequisites passed/u);
    NodeAssert.deepEqual((await NodeFSP.readFile(calls, "utf8")).trim().split("\n"), [
      "remote get-url origin",
      "auth status",
      "api repos/alfredomtx/t3code-personal-releases --jq .visibility",
      "--version",
    ]);
    const firstCalls = await NodeFSP.readFile(calls, "utf8");
    const invalid = NodeChildProcess.spawnSync(
      process.execPath,
      [cli, "--upstream-tag", "bad", "--publish"],
      { env, encoding: "utf8" },
    );
    NodeAssert.equal(invalid.status, 1);
    NodeAssert.match(invalid.stderr, /Invalid nightly tag/u);
    NodeAssert.equal(await NodeFSP.readFile(calls, "utf8"), firstCalls);
    for (const file of await NodeFSP.readdir(stateRoot))
      NodeAssert.equal(
        await NodeFSP.readFile(NodePath.join(stateRoot, file), "utf8"),
        "invalid retired data",
      );
    for (const file of await NodeFSP.readdir(stateRoot))
      await NodeFSP.rm(NodePath.join(stateRoot, file));
    await NodeFSP.writeFile(
      NodePath.join(bin, "git"),
      script.replace(
        'case "$*" in',
        `case "$*" in
  'branch --show-current') echo personal;;
  'status --porcelain') echo ' M user-work.ts';;`,
      ),
      { mode: 0o755 },
    );
    const dirty = NodeChildProcess.spawnSync(
      process.execPath,
      [cli, "--upstream-tag", "v0.1.1-nightly.20261020.3438", "--publish"],
      { env, encoding: "utf8" },
    );
    NodeAssert.equal(dirty.status, 1);
    NodeAssert.match(dirty.stderr, /Commit or preserve source edits/u);
    const [directory] = await NodeFSP.readdir(stateRoot);
    NodeAssert.match(directory, /^release-/u);
    NodeAssert.match(
      await NodeFSP.readFile(NodePath.join(stateRoot, directory, "runner.log"), "utf8"),
      /FAILED:.*Commit or preserve source edits/u,
    );
    NodeAssert.ok(
      !(await NodeFSP.readFile(calls, "utf8"))
        .split("\n")
        .some((line) => /^(?:push|merge|release|install|test)\b/u.test(line)),
    );
  }),
);
