#!/usr/bin/env node
/* oxlint-disable t3code/no-global-process-runtime -- This synchronous scheduler CLI runs outside the Effect application runtime. */
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { PERSONAL_DESKTOP as identity } from "../../packages/shared/src/personalDesktop.ts";
import {
  acquireLock,
  compareVersions,
  fullSha,
  parseNightly,
  personalVersion,
  writeJson,
  readJson,
  repairSnapshot,
  checkRepairScope,
  reviewAccepted,
  publicBuildEnvironment,
  protectedPath,
} from "./core.mjs";
import { verifyArtifact, smokeApp, fileDigest } from "./verify-artifact.mjs";

const source = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../..");
const root = NodePath.join(NodeOS.homedir(), ".local/share/t3-personal");
const builder = NodePath.join(root, "builder");
const configFile = NodePath.join(root, "config.json");
const stateFile = NodePath.join(root, "status.json");
const requestFile = NodePath.join(root, "pending.json");
const args = process.argv.slice(2);
const publish = args.includes("--publish");
const check = args.includes("--check") || args.includes("--dry-run");
const revisionIndex = args.indexOf("--revision");
const explicitRevision = revisionIndex < 0 ? undefined : Number(args[revisionIndex + 1]);
const allowed = new Set(["--publish", "--build-only", "--check", "--dry-run", "--revision"]);
for (let i = 0; i < args.length; i++) {
  NodeAssert.ok(allowed.has(args[i]), `Unknown argument: ${args[i]}`);
  if (args[i] === "--revision") i++;
}
NodeAssert.ok(!(publish && args.includes("--build-only")), "Choose --build-only or --publish.");
if (explicitRevision !== undefined) personalVersion("1.0.0-nightly.20260101.1", explicitRevision);
let log;
let environment = { ...process.env };
function run(
  command,
  parameters,
  { cwd = builder, input, timeout = 30 * 60_000, acceptFailure = false, env = environment } = {},
) {
  const result = NodeChildProcess.spawnSync(command, parameters, {
    cwd,
    env,
    input,
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (log) {
    log.write(`\n$ ${command} ${parameters.join(" ")}\n`);
    if (result.stdout) log.write(result.stdout);
    if (result.stderr) log.write(result.stderr);
  }
  if (!acceptFailure && (result.status !== 0 || result.error))
    throw new Error(
      `${command} failed with ${result.status}: ${result.error?.message ?? result.stderr?.slice(-2000)}`,
    );
  return { ...result, output: result.stdout?.trim() ?? "" };
}
const git = (...parameters) => run("git", parameters).output;
const gh = (...parameters) => run("gh", parameters, { cwd: source }).output;
async function requiredTests() {
  const fixed = [
    "scripts/build-desktop-artifact.test.ts",
    "scripts/sign-personal-macos.test.ts",
    "apps/server/src/auth/EnvironmentAuth.test.ts",
    "apps/desktop/src/app/DesktopCliCommand.test.ts",
    "apps/desktop/src/app/DesktopCliShim.test.ts",
    "packages/shared/src/providerAuthReturnUrl.test.ts",
    "packages/shared/src/codexAuthHandoff.test.ts",
    "packages/shared/src/promptLinks.test.ts",
    "apps/desktop/src/app/DesktopUserData.test.ts",
    "apps/desktop/src/app/DesktopEnvironment.test.ts",
    "apps/desktop/src/app/DesktopAppIdentity.test.ts",
    "apps/desktop/src/electron/ElectronProtocol.test.ts",
  ];
  const files = git("ls-files").split("\n");
  for (const name of ["collapseRenderedResults", "RenderedResultDisclosure"]) {
    const test = files.find((file) => new RegExp(`(?:^|/)${name}\\.test\\.tsx?$`, "u").test(file));
    NodeAssert.ok(test, `Required integrated UI test is missing: ${name}.test.ts or .tsx`);
    fixed.push(test);
  }
  for (const file of fixed) await NodeFSP.access(NodePath.join(builder, file));
  return fixed;
}

async function repairMerge(runDirectory, conflicts) {
  NodeAssert.ok(
    conflicts.length > 0,
    "The merge failed without conflicts. AI repair is not permitted.",
  );
  const repairHead = fullSha(git("rev-parse", "HEAD"));
  const mergeHead = fullSha(git("rev-parse", "MERGE_HEAD"));
  const files = git("ls-files", "-z").split("\0").filter(Boolean);
  NodeAssert.ok(
    !conflicts.some(protectedPath),
    "A protected file conflicts. Human repair is required.",
  );
  const before = await repairSnapshot(builder, files);
  await writeJson(NodePath.join(runDirectory, "repair-before.json"), before);
  const prompt = `Resolve only the current Git merge conflicts in this builder checkout. Preserve the personal desktop identity, collapsed-result preference, and exact protocol checks. Do not commit, publish, run applications, change tests, configuration, scripts, signing, release gates, or agent instructions. Stop if a protected file conflicts. The original source contract is in the existing code. Use the smallest correction. Conflicted files: ${conflicts.join(", ")}`;
  run(
    "codex",
    [
      "exec",
      "--sandbox",
      "workspace-write",
      "--config",
      'approval_policy="never"',
      "--ephemeral",
      "--output-last-message",
      NodePath.join(runDirectory, "repair.txt"),
      prompt,
    ],
    { timeout: 10 * 60_000 },
  );
  const afterFiles = [
    ...new Set([
      ...git("ls-files", "-z").split("\0").filter(Boolean),
      ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean),
    ]),
  ];
  checkRepairScope(before, await repairSnapshot(builder, afterFiles));
  const schemaFile = NodePath.join(runDirectory, "review-schema.json");
  await writeJson(schemaFile, {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "findings"],
    properties: {
      verdict: { type: "string", enum: ["accept", "reject"] },
      findings: { type: "array", items: { type: "string" } },
    },
  });
  const reviewFile = NodePath.join(runDirectory, "review.json");
  run(
    "codex",
    [
      "exec",
      "--sandbox",
      "read-only",
      "--config",
      'approval_policy="never"',
      "--ephemeral",
      "--output-schema",
      schemaFile,
      "--output-last-message",
      reviewFile,
      `Independently review the current merge repair. Do not edit, delegate, commit, or launch applications. Reject lost upstream behavior, changed personal identity/protocol, data isolation defects, disabled validation, or weakened tests/security. Compare the current worktree with both MERGE_HEAD and HEAD. Prior repair report is ${NodePath.join(runDirectory, "repair.txt")}. Return accept only with no findings.`,
    ],
    { timeout: 10 * 60_000 },
  );
  reviewAccepted(await readJson(reviewFile));
  NodeAssert.equal(git("rev-parse", "HEAD"), repairHead, "AI repair changed HEAD.");
  NodeAssert.equal(
    git("rev-parse", "MERGE_HEAD"),
    mergeHead,
    "AI repair changed the merge target.",
  );
  checkRepairScope(
    before,
    await repairSnapshot(builder, [
      ...new Set([
        ...afterFiles,
        ...git("ls-files", "-z").split("\0").filter(Boolean),
        ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean),
      ]),
    ]),
  );
  NodeAssert.ok(
    !git("diff", "--name-only", "--diff-filter=U"),
    "Repair left unresolved conflicts.",
  );
}

async function releaseRecord(tag) {
  const result = run(
    "gh",
    [
      "release",
      "view",
      tag,
      "--repo",
      identity.updateRepository,
      "--json",
      "tagName,isDraft,isPrerelease,assets,targetCommitish,url",
    ],
    { cwd: source, acceptFailure: true },
  );
  if (result.status === 0) return JSON.parse(result.output);
  NodeAssert.ok(
    /release not found|HTTP 404/iu.test(result.stderr),
    "Release lookup failed. Refusing to assume the release is absent.",
  );
  return null;
}

async function readBack(release, directory, assets) {
  await NodeFSP.mkdir(directory, { recursive: true });
  for (const asset of assets) {
    NodeAssert.ok(
      release.assets.some((remote) => remote.name === NodePath.basename(asset)),
      `Remote asset is missing: ${asset}`,
    );
    run(
      "gh",
      [
        "release",
        "download",
        release.tagName,
        "--repo",
        identity.updateRepository,
        "--pattern",
        NodePath.basename(asset),
        "--dir",
        directory,
      ],
      { cwd: source },
    );
    NodeAssert.equal(
      await fileDigest(NodePath.join(directory, NodePath.basename(asset))),
      await fileDigest(asset),
      "Remote asset hash differs.",
    );
    await NodeFSP.rm(NodePath.join(directory, NodePath.basename(asset)));
  }
}

async function main() {
  const config = await readJson(configFile);
  NodeAssert.ok(config, "Generate the personal runner configuration first.");
  NodeAssert.equal(
    config.sourceCheckout,
    source,
    "Run the scheduler from its configured stable source checkout.",
  );
  NodeAssert.equal(
    config.updateRepository,
    identity.updateRepository,
    "The production runner requires the production release feed.",
  );
  NodeAssert.equal(config.sourceRepository, identity.sourceRepository);
  NodeAssert.ok(/^[A-F0-9]{40}$/u.test(config.signingIdentity), "Signing fingerprint is missing.");
  for (const value of [config.node, config.vpBin, config.codex]) {
    NodeAssert.ok(NodePath.isAbsolute(value));
    await NodeFSP.access(value);
  }
  environment = {
    ...process.env,
    PATH: `${config.vpBin}:${NodePath.dirname(config.node)}:${NodePath.dirname(config.codex)}:${NodeOS.homedir()}/.cargo/bin:/opt/homebrew/bin:/usr/bin:/bin`,
    VP_HOME: config.vpHome,
    RUSTUP_TOOLCHAIN: "1.95.0",
  };
  for (const key of Object.keys(environment))
    if (/^(?:T3CODE_|VITE_|EXPO_PUBLIC_|APP_VERSION|APPLE_|CSC_)/u.test(key))
      delete environment[key];
  environment.T3CODE_PERSONAL_SIGN_IDENTITY = config.signingIdentity;
  environment.T3CODE_DESKTOP_UPDATE_REPOSITORY = identity.updateRepository;
  environment.GITHUB_REPOSITORY = identity.sourceRepository;
  environment.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  if (check) {
    run(config.node, ["--version"], { cwd: source });
    run("gh", ["auth", "status"], { cwd: source });
    run(
      "git",
      [
        "ls-remote",
        "--exit-code",
        `https://github.com/${identity.sourceRepository}.git`,
        "refs/heads/personal",
      ],
      { cwd: source },
    );
    gh("api", `repos/${identity.updateRepository}`, "--jq", ".visibility");
    console.log(
      JSON.stringify({
        check: "passed",
        source,
        builder,
        updateRepository: config.updateRepository,
        intervalSeconds: 900,
        appLaunched: false,
        mutations: false,
      }),
    );
    return;
  }
  NodeAssert.equal(NodeOS.platform(), "darwin");
  NodeAssert.equal(NodeOS.arch(), "arm64");
  const unlock = await acquireLock(NodePath.join(root, "nightly.lock"));
  if (!unlock) {
    console.log("A personal build is already running.");
    return;
  }
  let artifact;
  let status = await readJson(stateFile);
  const runDirectory = NodePath.join(
    root,
    "runs",
    `${new Date().toISOString().replaceAll(":", "-")}-${process.pid}`,
  );
  await NodeFSP.mkdir(runDirectory, { recursive: true });
  log = NodeFS.createWriteStream(NodePath.join(runDirectory, "runner.log"), {
    mode: 0o600,
  });
  try {
    NodeAssert.equal(
      gh("api", `repos/${identity.updateRepository}`, "--jq", ".visibility"),
      "public",
      "The release feed must remain public.",
    );
    const sourceUrl = `https://github.com/${identity.sourceRepository}.git`;
    try {
      await NodeFSP.access(NodePath.join(builder, ".git"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      run("git", ["clone", "--filter=blob:none", "--branch", "personal", sourceUrl, builder], {
        cwd: root,
      });
    }
    NodeAssert.equal(git("remote", "get-url", "origin"), sourceUrl);
    NodeAssert.ok(
      !git("status", "--porcelain"),
      "Builder has uncommitted changes. Preserve and inspect the previous failure.",
    );
    git("fetch", "--filter=blob:none", "origin", "personal");
    const originCommit = fullSha(git("rev-parse", "origin/personal"));
    const previousPending = await readJson(requestFile);
    // A verified pending source push can precede a failed release publication.
    const accepted = status?.sourceCommit ? fullSha(status.sourceCommit) : originCommit;
    if (status?.sourceCommit) {
      NodeAssert.ok(
        originCommit === accepted ||
          originCommit === previousPending?.sourceCommit ||
          git("merge-base", "--is-ancestor", accepted, originCommit) === "",
        "The source branch diverged from accepted history.",
      );
    }
    const publishedTags = gh(
      "api",
      `repos/pingdotgg/t3code/releases?per_page=100`,
      "--paginate",
      "--jq",
      ".[] | select(.draft == false and .prerelease == true) | .tag_name",
    )
      .split("\n")
      .filter((tag) => /^v?\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/u.test(tag));
    NodeAssert.ok(publishedTags.length, "No published official nightly exists.");
    publishedTags.sort(compareVersions);
    const upstreamTag =
      previousPending && !previousPending.published
        ? previousPending.upstreamTag
        : publishedTags.at(-1);
    NodeAssert.ok(
      publishedTags.includes(upstreamTag),
      "Pending upstream tag is no longer a published official nightly.",
    );
    parseNightly(upstreamTag);
    if (!git("remote").split("\n").includes("upstream"))
      git("remote", "add", "upstream", "https://github.com/pingdotgg/t3code.git");
    NodeAssert.equal(
      git("remote", "get-url", "upstream"),
      "https://github.com/pingdotgg/t3code.git",
    );
    if (git("rev-parse", "--is-shallow-repository") === "true")
      git("fetch", "--unshallow", "--filter=blob:none", "origin", "personal");
    git(
      "fetch",
      "--filter=blob:none",
      "upstream",
      `refs/tags/${upstreamTag}:refs/tags/${upstreamTag}`,
    );
    const upstreamCommit = fullSha(git("rev-parse", `${upstreamTag}^{commit}`));
    if (previousPending && !previousPending.published)
      NodeAssert.equal(
        upstreamCommit,
        previousPending.upstreamCommit,
        "The pending official tag moved.",
      );
    const revision =
      explicitRevision ??
      (previousPending && !previousPending.published
        ? parseNightly(previousPending.version).sequence % 1000
        : 1);
    const version = personalVersion(upstreamTag, revision);
    const personalTags = gh(
      "api",
      `repos/${identity.updateRepository}/releases?per_page=100`,
      "--paginate",
      "--jq",
      ".[] | select(.draft == false) | .tag_name",
    )
      .split("\n")
      .filter((tag) => /^v?\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/u.test(tag))
      .sort(compareVersions);
    if (personalTags.length)
      NodeAssert.ok(
        compareVersions(version, personalTags.at(-1)) >= 0,
        "A newer personal release already exists.",
      );
    if (status?.version) {
      NodeAssert.ok(
        compareVersions(version, status.version) >= 0,
        "Requested version is older than the accepted release.",
      );
      if (
        version === status.version &&
        upstreamCommit === status.upstreamCommit &&
        originCommit === status.sourceCommit
      ) {
        console.log(`Already published ${version}.`);
        return;
      }
      NodeAssert.ok(
        compareVersions(version, status.version) > 0,
        "Increment --revision for another source revision of this nightly.",
      );
    }
    let pending = previousPending;
    const resume = pending?.version === version && pending.upstreamCommit === upstreamCommit;
    if (resume) {
      fullSha(pending.sourceCommit);
      NodeAssert.ok(
        git("merge-base", "--is-ancestor", originCommit, pending.sourceCommit) === "",
        "Pending source no longer extends origin/personal.",
      );
      git("checkout", "--detach", pending.sourceCommit);
    } else {
      NodeAssert.ok(
        !pending || pending.published === true,
        "A previous draft is pending. Resume its revision before a new nightly.",
      );
      git("checkout", "--detach", originCommit);
      const merge = run("git", ["merge", "--no-ff", "--no-commit", upstreamCommit], {
        acceptFailure: true,
      });
      if (merge.status !== 0)
        await repairMerge(
          runDirectory,
          git("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean),
        );
      if (git("status", "--porcelain")) {
        git("add", "--all");
        git("commit", "-m", `chore(personal): integrate ${upstreamTag}`);
      }
      pending = {
        version,
        upstreamTag,
        upstreamCommit,
        sourceCommit: fullSha(git("rev-parse", "HEAD")),
        published: false,
      };
      await writeJson(requestFile, pending);
    }
    const publicEnvironment = publicBuildEnvironment(
      await NodeFSP.readFile(NodePath.join(builder, ".env.example"), "utf8"),
    );
    Object.assign(environment, publicEnvironment);
    const tests = await requiredTests();
    run("vp", ["install", "--frozen-lockfile"]);
    run(config.node, ["--test", "scripts/personal/core.test.mjs"]);
    run("vp", ["test", "run", ...tests]);
    const changedFiles = git("diff", "--name-only", `${upstreamCommit}...HEAD`)
      .split("\n")
      .filter((file) => /\.(?:[cm]?[jt]sx?)$/u.test(file));
    if (changedFiles.length) run("vp", ["lint", ...changedFiles]);
    for (const workspace of [
      "@t3tools/shared",
      "@t3tools/scripts",
      "@t3tools/desktop",
      "@t3tools/client-runtime",
      "@t3tools/web",
    ])
      run("vp", ["exec", "--filter", workspace, "--", "tsc-rs", "--noEmit"]);
    const directory = NodePath.join(root, "artifacts", version);
    const verified = await readJson(NodePath.join(directory, "verified.json"));
    const buildDirectory = verified ? directory : NodePath.join(runDirectory, "package");
    if (!verified) {
      await NodeFSP.mkdir(buildDirectory);
      run(
        config.node,
        [
          "scripts/build-desktop-artifact.ts",
          "--platform",
          "mac",
          "--target",
          "zip",
          "--arch",
          "arm64",
          "--build-version",
          version,
          "--output-dir",
          buildDirectory,
        ],
        { timeout: 60 * 60_000 },
      );
    } else {
      NodeAssert.equal(verified.sourceCommit, pending.sourceCommit);
      NodeAssert.equal(verified.version, version);
    }
    artifact = await verifyArtifact({
      directory: buildDirectory,
      version,
      sourceCommit: pending.sourceCommit,
      certificate: config.signingIdentity,
      temporaryRoot: runDirectory,
    });
    await smokeApp({ ...artifact, logFile: NodePath.join(runDirectory, "app-smoke.log") });
    const assetNames = [artifact.zip, `${artifact.zip}.blockmap`, "nightly-mac.yml"];
    const provenance = {
      ...pending,
      sourceUrl: `https://github.com/${identity.sourceRepository}/commit/${pending.sourceCommit}`,
      updateRepository: identity.updateRepository,
      certificate: config.signingIdentity,
      architecture: "arm64",
      publicBuildKeys: Object.keys(publicEnvironment),
      artifacts: [],
    };
    for (const name of assetNames)
      provenance.artifacts.push({
        name,
        sha512: await fileDigest(NodePath.join(buildDirectory, name)),
        size: (await NodeFSP.stat(NodePath.join(buildDirectory, name))).size,
      });
    await writeJson(NodePath.join(buildDirectory, "provenance.json"), provenance);
    await writeJson(NodePath.join(buildDirectory, "verified.json"), {
      version,
      sourceCommit: pending.sourceCommit,
    });
    if (!verified) {
      await NodeFSP.mkdir(NodePath.dirname(directory), { recursive: true });
      await NodeFSP.rename(buildDirectory, directory);
    }
    if (!publish) {
      console.log(
        `Verified build ${version} at ${directory}. Source and release publication remain disabled.`,
      );
      return;
    }
    const tag = `v${version}`;
    let release = await releaseRecord(tag);
    const assets = [...assetNames, "provenance.json"].map((name) => NodePath.join(directory, name));
    if (!release?.isDraft && release) {
      await readBack(release, NodePath.join(runDirectory, "published-readback"), assets);
    } else {
      git("push", "origin", `${pending.sourceCommit}:refs/heads/personal`);
      NodeAssert.equal(
        run("git", ["ls-remote", "origin", "refs/heads/personal"]).output.split(/\s/u)[0],
        pending.sourceCommit,
      );
      if (!release) {
        const notes = NodePath.join(runDirectory, "release-notes.md");
        await NodeFSP.writeFile(
          notes,
          `Personal native arm64 build. Local signature without Apple notarization.\n\nSource: ${provenance.sourceUrl}\nOfficial nightly: ${upstreamTag} at ${upstreamCommit}\n`,
        );
        gh(
          "release",
          "create",
          tag,
          "--repo",
          identity.updateRepository,
          "--target",
          "main",
          "--draft",
          "--prerelease",
          "--title",
          `${identity.productName} ${version}`,
          "--notes-file",
          notes,
        );
        release = await releaseRecord(tag);
      }
      NodeAssert.ok(release.isDraft, "Assets can only be added to a draft.");
      for (const asset of assets)
        if (!release.assets.some((remote) => remote.name === NodePath.basename(asset)))
          gh("release", "upload", tag, asset, "--repo", identity.updateRepository);
      release = await releaseRecord(tag);
      await readBack(release, NodePath.join(runDirectory, "draft-readback"), assets);
      gh(
        "release",
        "edit",
        tag,
        "--repo",
        identity.updateRepository,
        "--draft=false",
        "--prerelease",
      );
    }
    release = await releaseRecord(tag);
    NodeAssert.ok(
      release && !release.isDraft && release.isPrerelease,
      "The production prerelease is not public.",
    );
    const feed = await fetch(
      `https://github.com/${identity.updateRepository}/releases/download/${tag}/nightly-mac.yml`,
    );
    NodeAssert.ok(feed.ok, "The public update manifest is unavailable.");
    const bytes = Buffer.from(await feed.arrayBuffer());
    NodeAssert.equal(
      bytes.toString(),
      await NodeFSP.readFile(NodePath.join(directory, "nightly-mac.yml"), "utf8"),
    );
    const sourceReadback = run("git", ["ls-remote", "origin", "refs/heads/personal"]).output.split(
      /\s/u,
    )[0];
    NodeAssert.equal(sourceReadback, pending.sourceCommit, "Published source readback failed.");
    status = {
      ...pending,
      published: true,
      releaseUrl: release.url,
      publishedAt: new Date().toISOString(),
      runDirectory,
    };
    await writeJson(stateFile, status);
    await writeJson(requestFile, { ...pending, published: true });
    const published = gh(
      "api",
      `repos/${identity.updateRepository}/releases?per_page=100`,
      "--jq",
      ".[] | select(.draft == false) | .tag_name",
    ).split("\n");
    const keep = new Set(published.slice(0, 2).map((value) => value.replace(/^v/u, "")));
    for (const name of await NodeFSP.readdir(NodePath.join(root, "artifacts")))
      if (!keep.has(name) && /^\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/u.test(name)) {
        const record = await readJson(NodePath.join(root, "artifacts", name, "verified.json"));
        if (record?.version === name && published.includes(`v${name}`))
          await NodeFSP.rm(NodePath.join(root, "artifacts", name), { recursive: true });
      }
    console.log(`Published ${release.url}`);
  } catch (error) {
    await writeJson(NodePath.join(root, "last-failure.json"), {
      error: error.message,
      runDirectory,
      failedAt: new Date().toISOString(),
      acceptedRelease: status?.releaseUrl ?? null,
    });
    throw error;
  } finally {
    if (artifact) await NodeFSP.rm(artifact.temporary, { recursive: true, force: true });
    await NodeFSP.rm(NodePath.join(runDirectory, "package"), { recursive: true, force: true });
    await new Promise((resolve) => log.end(resolve));
    await unlock();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
