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
  repairSnapshot,
  checkRepairScope,
  reviewAccepted,
  publicBuildEnvironment,
} from "./core.mjs";
import { verifyManifest } from "./verify-artifact.mjs";

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
NodeTest.test(
  "repair protection compares the pre-AI working state and rejects protected edits",
  () =>
    temporary(async (root) => {
      await NodeFSP.mkdir(NodePath.join(root, "scripts"));
      await NodeFSP.writeFile(NodePath.join(root, "scripts/gate.mjs"), "legitimate upstream gate");
      await NodeFSP.writeFile(
        NodePath.join(root, "feature.test.ts"),
        "legitimate upstream NodeTest.test",
      );
      await NodeFSP.writeFile(NodePath.join(root, "feature.ts"), "<<<<<<< conflict");
      const files = ["scripts/gate.mjs", "feature.test.ts", "feature.ts"];
      const before = await repairSnapshot(root, files);
      await NodeFSP.writeFile(NodePath.join(root, "feature.ts"), "resolved");
      checkRepairScope(before, await repairSnapshot(root, files));
      await NodeFSP.writeFile(NodePath.join(root, "scripts/gate.mjs"), "disabled gate");
      const after = await repairSnapshot(root, files);
      NodeAssert.throws(() => checkRepairScope(before, after));
      reviewAccepted({ verdict: "accept", findings: [] });
      NodeAssert.throws(() => reviewAccepted({ verdict: "reject", findings: [] }));
      NodeAssert.throws(() => reviewAccepted({ verdict: "accept", findings: ["lost behavior"] }));
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
      const script = `#!/bin/sh\nprintf '%s %s\\n' "$0" "$*" >> '${calls}'\ncase "$*" in\n  'auth status') exit 0;;\n  'api repos/alfredomtx/t3code-personal-releases --jq .visibility') echo public;;\n  'ls-remote --exit-code https://github.com/alfredomtx/t3code.git refs/heads/personal') echo 'd36b7da2485bc889b320a285deea181f637d760a refs/heads/personal';;\n  *) echo 'Unexpected command' >&2; exit 9;;\nesac\n`;
      for (const command of ["gh", "git", "codex", "vp"])
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
        codex: NodePath.join(bin, "codex"),
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
    const version = personalVersion(tag);
    const script = `#!/bin/sh\nprintf '%s %s\\n' "$0" "$*" >> '${calls}'\ncase "$*" in\n  'api repos/alfredomtx/t3code-personal-releases --jq .visibility') echo public;;\n  'api repos/pingdotgg/t3code/releases?per_page=100'*) echo '${tag}';;\n  'api repos/alfredomtx/t3code-personal-releases/releases?per_page=100'*) echo 'v${version}';;\n  'remote get-url origin') echo https://github.com/alfredomtx/t3code.git;;\n  'remote get-url upstream') echo https://github.com/pingdotgg/t3code.git;;\n  'status --porcelain') exit 0;;\n  'fetch '*) exit 0;;\n  'rev-parse origin/personal'|'rev-parse ${tag}^{commit}') echo '${sha}';;\n  'rev-parse --is-shallow-repository') echo false;;\n  'remote') printf 'origin\\nupstream\\n';;\n  *) echo "Unexpected mutation: $*" >&2; exit 9;;\nesac\n`;
    for (const command of ["gh", "git", "codex", "vp"])
      await NodeFSP.writeFile(NodePath.join(bin, command), script, { mode: 0o755 });
    await writeJson(NodePath.join(stateRoot, "config.json"), {
      sourceCheckout: source,
      sourceRepository: "alfredomtx/t3code",
      updateRepository: "alfredomtx/t3code-personal-releases",
      signingIdentity: "5982A03C0452FB344BC92765B84FF62391712882",
      node: process.execPath,
      vpHome: root,
      vpBin: bin,
      codex: NodePath.join(bin, "codex"),
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
