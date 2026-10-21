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
  publicationPending,
  defaultRevision,
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

NodeTest.test(
  "scheduler check makes no branch, app, or release mutations and a bad feed fails closed",
  () =>
    temporary(async (root) => {
      const source = NodePath.resolve(import.meta.dirname, "../..");
      const bin = NodePath.join(root, "bin");
      await NodeFSP.mkdir(bin);
      const calls = NodePath.join(root, "calls.txt");
      const notifications = NodePath.join(root, "notifications.txt");
      const notifier = NodePath.join(bin, "notify");
      await NodeFSP.writeFile(notifier, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${notifications}'\n`, {
        mode: 0o755,
      });
      const script = `#!/bin/sh\nprintf '%s %s\\n' "$0" "$*" >> '${calls}'\ncase "$*" in\n  'auth status') exit 0;;\n  'api repos/alfredomtx/t3code-personal-releases --jq .visibility') echo public;;\n  'ls-remote --exit-code https://github.com/alfredomtx/t3code.git refs/heads/personal') echo 'd36b7da2485bc889b320a285deea181f637d760a refs/heads/personal';;\n  *) echo 'Unexpected command' >&2; exit 9;;\nesac\n`;
      for (const command of ["gh", "git", "vp"])
        await NodeFSP.writeFile(NodePath.join(bin, command), script, { mode: 0o755 });
      const configFile = NodePath.join(root, ".local/share/t3-personal/config.json");
      const config = {
        sourceCheckout: source,
        sourceRepository: "alfredomtx/t3code",
        updateRepository: "alfredomtx/t3code-personal-releases",
        signingIdentity: "5982A03C0452FB344BC92765B84FF62391712882",
        node: process.execPath,
        vpHome: root,
        vpBin: bin,
        notifier,
      };
      await writeJson(configFile, config);
      const run = (args) =>
        NodeChildProcess.spawnSync(
          process.execPath,
          [NodePath.join(source, "scripts/personal/nightly.mjs"), ...args],
          { env: { ...process.env, HOME: root }, encoding: "utf8" },
        );
      const result = run(["--check"]);
      NodeAssert.equal(result.status, 0, result.stderr);
      NodeAssert.equal(JSON.parse(result.stdout).mutations, false);
      const firstCalls = await NodeFSP.readFile(calls, "utf8");
      NodeAssert.deepEqual(
        firstCalls
          .trim()
          .split("\n")
          .map((line) => line.slice(line.indexOf(" ") + 1)),
        [
          "auth status",
          "ls-remote --exit-code https://github.com/alfredomtx/t3code.git refs/heads/personal",
          "api repos/alfredomtx/t3code-personal-releases --jq .visibility",
        ],
      );
      await writeJson(configFile, { ...config, updateRepository: "alfredomtx/t3code" });
      NodeAssert.equal(run(["--publish"]).status, 1);
      NodeAssert.equal(run(["--publish"]).status, 1);
      await NodeAssert.rejects(NodeFSP.access(notifications), { code: "ENOENT" });
      NodeAssert.equal(await NodeFSP.readFile(calls, "utf8"), firstCalls);
      await NodeAssert.rejects(
        NodeFSP.access(NodePath.join(root, ".local/share/t3-personal/status.json")),
      );
    }),
);

NodeTest.test("a repeated accepted nightly poll does not build, publish, or change branches", () =>
  temporary(async (root) => {
    const source = NodePath.resolve(import.meta.dirname, "../..");
    const bin = NodePath.join(root, "bin");
    const stateRoot = NodePath.join(root, ".local/share/t3-personal");
    await NodeFSP.mkdir(bin);
    await NodeFSP.mkdir(NodePath.join(stateRoot, "builder/.git"), { recursive: true });
    const calls = NodePath.join(root, "calls.txt");
    const sha = "d36b7da2485bc889b320a285deea181f637d760a";
    const tag = "v0.1.1-nightly.20261020.3411";
    const version = personalVersion(tag, 3);
    const script = `#!/bin/sh\nprintf '%s %s\\n' "$0" "$*" >> '${calls}'\ncase "$*" in\n  'api repos/alfredomtx/t3code-personal-releases --jq .visibility') echo public;;\n  'api repos/pingdotgg/t3code/releases?per_page=100'*) echo '${tag}';;\n  'api repos/alfredomtx/t3code-personal-releases/releases?per_page=100'*) echo 'v${version}';;\n  'remote get-url origin') echo https://github.com/alfredomtx/t3code.git;;\n  'remote get-url upstream') echo https://github.com/pingdotgg/t3code.git;;\n  'status --porcelain') exit 0;;\n  'fetch '*) exit 0;;\n  'rev-parse origin/personal'|'rev-parse ${tag}^{commit}') echo '${sha}';;\n  'rev-parse --is-shallow-repository') echo false;;\n  'remote') printf 'origin\\nupstream\\n';;\n  *) echo "Unexpected mutation: $*" >&2; exit 9;;\nesac\n`;
    for (const command of ["gh", "git", "vp"])
      await NodeFSP.writeFile(NodePath.join(bin, command), script, { mode: 0o755 });
    await writeJson(NodePath.join(stateRoot, "config.json"), {
      sourceCheckout: source,
      sourceRepository: "alfredomtx/t3code",
      updateRepository: "alfredomtx/t3code-personal-releases",
      signingIdentity: "5982A03C0452FB344BC92765B84FF62391712882",
      node: process.execPath,
      vpHome: root,
      vpBin: bin,
    });
    const status = { version, sourceCommit: sha, upstreamCommit: sha };
    await writeJson(NodePath.join(stateRoot, "status.json"), status);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        [NodePath.join(source, "scripts/personal/nightly.mjs"), "--publish"],
        { env: { ...process.env, HOME: root }, encoding: "utf8" },
      );
      NodeAssert.equal(result.status, 0, result.stderr);
      NodeAssert.match(result.stdout, /Already published/u);
    }
    NodeAssert.deepEqual(
      JSON.parse(await NodeFSP.readFile(NodePath.join(stateRoot, "status.json"), "utf8")),
      status,
    );
    NodeAssert.ok(
      !(await NodeFSP.readFile(calls, "utf8"))
        .split("\n")
        .some((line) => / (?:push|checkout|merge|release|install|test)\b/u.test(line)),
    );
  }),
);

NodeTest.test(
  "only verified publication work pins recovery and accepted manual revisions stay idle",
  () => {
    const upstreamCommit = "a".repeat(40);
    const originCommit = "b".repeat(40);
    const status = {
      upstreamCommit,
      sourceCommit: originCommit,
      version: personalVersion("v1.0.0-nightly.20261020.4", 3),
    };
    const failed = { ...status, published: false };
    NodeAssert.equal(publicationPending(failed), null);
    NodeAssert.equal(
      publicationPending({ ...failed, readyForPublication: true, published: true }),
      null,
    );
    const pending = publicationPending({ ...failed, readyForPublication: true });
    NodeAssert.ok(pending);
    NodeAssert.equal(defaultRevision({ status, upstreamCommit, originCommit }), 3);
    NodeAssert.equal(defaultRevision({ status, upstreamCommit, originCommit: "c".repeat(40) }), 4);
    NodeAssert.equal(defaultRevision({ status, upstreamCommit: "d".repeat(40), originCommit }), 1);
    NodeAssert.equal(defaultRevision({ pending, status, upstreamCommit, originCommit }), 3);
  },
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

NodeTest.test(
  "a recloned builder preserves an unavailable cached merge and starts a fresh candidate",
  () =>
    temporary(async (root) => {
      const source = NodePath.resolve(import.meta.dirname, "../..");
      const bin = NodePath.join(root, "bin");
      const stateRoot = NodePath.join(root, ".local/share/t3-personal");
      const builder = NodePath.join(stateRoot, "builder");
      await NodeFSP.mkdir(bin);
      await NodeFSP.mkdir(NodePath.join(builder, ".git"), { recursive: true });
      await NodeFSP.copyFile(
        NodePath.join(source, ".env.example"),
        NodePath.join(builder, ".env.example"),
      );
      const sha = "d36b7da2485bc889b320a285deea181f637d760a";
      const missing = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const tag = "v0.1.1-nightly.20261020.3411";
      const version = personalVersion(tag);
      const cached = NodePath.join(stateRoot, "artifacts", version);
      await writeJson(NodePath.join(cached, "verified.json"), {
        version,
        upstreamCommit: sha,
        baseSourceCommit: sha,
        sourceCommit: missing,
      });
      await NodeFSP.writeFile(NodePath.join(cached, "app.zip"), "retained evidence");
      const calls = NodePath.join(root, "calls.txt");
      const script = `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\ncase "$*" in\n  'api repos/alfredomtx/t3code-personal-releases --jq .visibility') echo public;;\n  'api repos/pingdotgg/t3code/releases?per_page=100'*) echo '${tag}';;\n  'api repos/alfredomtx/t3code-personal-releases/releases?per_page=100'*) exit 0;;\n  'remote get-url origin') echo https://github.com/alfredomtx/t3code.git;;\n  'remote get-url upstream') echo https://github.com/pingdotgg/t3code.git;;\n  'status --porcelain'|'fetch '*|'checkout --detach '*|'merge --no-ff --no-commit '*) exit 0;;\n  'rev-parse origin/personal'|'rev-parse ${tag}^{commit}'|'rev-parse HEAD') echo '${sha}';;\n  'rev-parse --is-shallow-repository') echo false;;\n  'remote') printf 'origin\\nupstream\\n';;\n  'cat-file -e ${missing}^{commit}') exit 128;;\n  *) echo "Unexpected command: $*" >&2; exit 9;;\nesac\n`;
      for (const command of ["gh", "git", "vp"])
        await NodeFSP.writeFile(NodePath.join(bin, command), script, { mode: 0o755 });
      await writeJson(NodePath.join(stateRoot, "config.json"), {
        sourceCheckout: source,
        sourceRepository: "alfredomtx/t3code",
        updateRepository: "alfredomtx/t3code-personal-releases",
        signingIdentity: "5982A03C0452FB344BC92765B84FF62391712882",
        node: process.execPath,
        vpHome: root,
        vpBin: bin,
      });
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        [NodePath.join(source, "scripts/personal/nightly.mjs"), "--build-only"],
        { env: { ...process.env, HOME: root }, encoding: "utf8" },
      );
      NodeAssert.equal(result.status, 1);
      NodeAssert.match(result.stderr, /build-desktop-artifact\.test\.ts/u);
      const commands = await NodeFSP.readFile(calls, "utf8");
      NodeAssert.ok(commands.includes(`checkout --detach ${sha}`));
      NodeAssert.ok(!commands.includes(`checkout --detach ${missing}`));
      await NodeAssert.rejects(NodeFSP.access(cached));
      const [run] = await NodeFSP.readdir(NodePath.join(stateRoot, "runs"));
      NodeAssert.equal(
        await NodeFSP.readFile(
          NodePath.join(stateRoot, "runs", run, "superseded-artifacts/app.zip"),
          "utf8",
        ),
        "retained evidence",
      );
      await NodeAssert.rejects(NodeFSP.access(NodePath.join(stateRoot, "pending.json")));
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

NodeTest.test(
  "failed build gates retain diagnostics without pinning the next upstream nightly",
  () =>
    temporary(async (root) => {
      const source = NodePath.resolve(import.meta.dirname, "../..");
      const bin = NodePath.join(root, "bin");
      const stateRoot = NodePath.join(root, ".local/share/t3-personal");
      await NodeFSP.mkdir(bin);
      await NodeFSP.mkdir(NodePath.join(stateRoot, "builder/.git"), { recursive: true });
      await NodeFSP.writeFile(
        NodePath.join(stateRoot, "builder/.env.example"),
        "T3CODE_CLERK_PUBLISHABLE_KEY=pk_live_public\nT3CODE_CLERK_JWT_TEMPLATE=t3-relay\nT3CODE_CLERK_CLI_OAUTH_CLIENT_ID=public\nT3CODE_RELAY_URL=https://relay.t3.codes\n",
      );
      const sha = "d36b7da2485bc889b320a285deea181f637d760a";
      const calls = NodePath.join(root, "calls");
      const tagFile = NodePath.join(root, "tag");
      const script = `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\ncase "$*" in\n  'api repos/alfredomtx/t3code-personal-releases --jq .visibility') echo public;;\n  'api repos/pingdotgg/t3code/releases?per_page=100'*) cat '${tagFile}';;\n  'api repos/alfredomtx/t3code-personal-releases/releases?per_page=100'*) exit 0;;\n  'remote get-url origin') echo https://github.com/alfredomtx/t3code.git;;\n  'remote get-url upstream') echo https://github.com/pingdotgg/t3code.git;;\n  'status --porcelain'|'fetch '*|'checkout '*|'merge --no-ff --no-commit '*|'merge-base --is-ancestor '*|'cat-file -e '*) exit 0;;\n  'rev-parse origin/personal'|'rev-parse HEAD'|'rev-parse v'*'^{commit}') echo '${sha}';;\n  'rev-parse --is-shallow-repository') echo false;;\n  'remote') printf 'origin\\nupstream\\n';;\n  *) echo "Unexpected: $*" >&2; exit 9;;\nesac\n`;
      for (const command of ["gh", "git", "vp"])
        await NodeFSP.writeFile(NodePath.join(bin, command), script, { mode: 0o755 });
      await writeJson(NodePath.join(stateRoot, "config.json"), {
        sourceCheckout: source,
        sourceRepository: "alfredomtx/t3code",
        updateRepository: "alfredomtx/t3code-personal-releases",
        signingIdentity: "5982A03C0452FB344BC92765B84FF62391712882",
        node: process.execPath,
        vpHome: root,
        vpBin: bin,
      });
      const failures = [];
      for (const [index, mode] of ["--publish", "--build-only"].entries()) {
        const tag = `v0.1.1-nightly.20261020.${3411 + index}`;
        await NodeFSP.writeFile(tagFile, tag);
        const result = NodeChildProcess.spawnSync(
          process.execPath,
          [NodePath.join(source, "scripts/personal/nightly.mjs"), mode],
          { env: { ...process.env, HOME: root }, encoding: "utf8" },
        );
        NodeAssert.equal(result.status, 1);
        NodeAssert.match(result.stderr, /ENOENT.*build-desktop-artifact.test.ts/su);
        await NodeAssert.rejects(NodeFSP.access(NodePath.join(stateRoot, "pending.json")), {
          code: "ENOENT",
        });
        const failure = JSON.parse(
          await NodeFSP.readFile(NodePath.join(stateRoot, "last-failure.json"), "utf8"),
        );
        failures.push(failure);
        const candidate = JSON.parse(
          await NodeFSP.readFile(NodePath.join(failure.runDirectory, "candidate.json"), "utf8"),
        );
        NodeAssert.equal(candidate.upstreamTag, tag);
        NodeAssert.equal(candidate.version, personalVersion(tag));
      }
      const cachedVersion = personalVersion("v0.1.1-nightly.20261020.3412");
      const cachedCommit = "c".repeat(40);
      await writeJson(NodePath.join(stateRoot, "artifacts", cachedVersion, "verified.json"), {
        version: cachedVersion,
        upstreamTag: "v0.1.1-nightly.20261020.3412",
        upstreamCommit: sha,
        sourceCommit: cachedCommit,
        baseSourceCommit: sha,
        published: false,
      });
      const resumed = NodeChildProcess.spawnSync(
        process.execPath,
        [NodePath.join(source, "scripts/personal/nightly.mjs"), "--build-only"],
        { env: { ...process.env, HOME: root }, encoding: "utf8" },
      );
      NodeAssert.equal(resumed.status, 1);
      NodeAssert.match(resumed.stderr, /ENOENT.*build-desktop-artifact.test.ts/su);
      NodeAssert.match(
        await NodeFSP.readFile(calls, "utf8"),
        new RegExp(`checkout --detach ${cachedCommit}`, "u"),
      );
      await NodeAssert.rejects(NodeFSP.access(NodePath.join(stateRoot, "pending.json")), {
        code: "ENOENT",
      });
      await NodeFSP.writeFile(tagFile, "v0.1.1-nightly.20261020.3413");
      const mergeFailureScript = script.replace(
        'case "$*" in\n',
        "case \"$*\" in\n  'merge --no-ff --no-commit '*) exit 1;;\n",
      );
      await NodeFSP.writeFile(NodePath.join(bin, "git"), mergeFailureScript);
      const mergeFailure = NodeChildProcess.spawnSync(
        process.execPath,
        [NodePath.join(source, "scripts/personal/nightly.mjs"), "--publish"],
        { env: { ...process.env, HOME: root }, encoding: "utf8" },
      );
      NodeAssert.equal(mergeFailure.status, 1);
      NodeAssert.match(mergeFailure.stderr, /Use the T3 repair thread/u);
      const mergeDiagnostic = JSON.parse(
        await NodeFSP.readFile(NodePath.join(stateRoot, "last-failure.json"), "utf8"),
      );
      NodeAssert.match(mergeDiagnostic.error, /Use the T3 repair thread/u);
      await NodeAssert.rejects(NodeFSP.access(NodePath.join(stateRoot, "pending.json")));
      NodeAssert.notEqual(failures[0].runDirectory, failures[1].runDirectory);
      for (const failure of failures)
        NodeAssert.deepEqual(
          JSON.parse(
            await NodeFSP.readFile(NodePath.join(failure.runDirectory, "failure.json"), "utf8"),
          ),
          failure,
        );
      NodeAssert.doesNotMatch(
        await NodeFSP.readFile(calls, "utf8"),
        /^(?:push|release|install|test) /mu,
      );
    }),
);

NodeTest.test("forced smoke cleanup preserves startup failure and closes the log descriptor", () =>
  temporary(async (root) => {
    const executable = NodePath.join(root, "fake-app");
    const pidFile = NodePath.join(root, "pid");
    const logFile = NodePath.join(root, "smoke.log");
    await NodeFSP.writeFile(
      executable,
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nprocess.on('SIGTERM', () => {}); console.log('fatal startup error'); setInterval(() => {}, 1000);\n`,
      { mode: 0o755 },
    );
    await NodeAssert.rejects(smokeApp({ executable, temporary: root, logFile }), (error) => {
      NodeAssert.match(error.message, /reported a startup error/u);
      NodeAssert.match(error.cause.message, /required forced shutdown/u);
      return true;
    });
    const pid = Number(await NodeFSP.readFile(pidFile, "utf8"));
    NodeAssert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    NodeAssert.equal(
      NodeChildProcess.spawnSync("/usr/sbin/lsof", ["-a", "-p", String(process.pid), logFile])
        .status,
      1,
    );
  }),
);
