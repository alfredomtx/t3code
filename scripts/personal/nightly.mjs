#!/usr/bin/env node
/* oxlint-disable t3code/no-global-process-runtime -- This release CLI runs outside the Effect application runtime. */
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import { PERSONAL_DESKTOP as identity } from "../../packages/shared/src/personalDesktop.ts";
import {
  acquireLock,
  compareVersions,
  fullSha,
  personalVersion,
  writeJson,
  publicBuildEnvironment,
  assertBuildEnvironment,
  isAncestor,
} from "./core.mjs";
import { verifyArtifact, smokeApp, fileDigest, syncReleaseAssets } from "./verify-artifact.mjs";

const source = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../..");
const root = NodePath.join(NodeOS.homedir(), ".local/share/t3-personal");
const { values: args } = NodeUtil.parseArgs({
  options: {
    "upstream-tag": { type: "string" },
    revision: { type: "string", default: "1" },
    publish: { type: "boolean", default: false },
    check: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
let log;
let environment;
function run(
  command,
  parameters,
  { cwd = source, timeout = 30 * 60_000, acceptFailure = false } = {},
) {
  const result = NodeChildProcess.spawnSync(command, parameters, {
    cwd,
    env: environment,
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
const gh = (...parameters) => run("gh", parameters).output;
const browserTests = [
  "apps/web/src/components/settings/ScheduledTasksSettings.browser.test.tsx",
  "apps/web/src/shortcuts/chatRouteCommands.browser.test.ts",
  "apps/web/src/components/RightPanelTabs.browser.test.tsx",
  "apps/web/src/components/files/BrowserDocumentFrame.browser.test.tsx",
  "apps/web/src/components/preview/PreviewView.browser.test.tsx",
  "apps/web/src/components/settings/KeybindingsSettings.browser.test.tsx",
  "apps/web/src/shortcutCoach.browser.test.tsx",
  "apps/web/src/components/ReopenClosedViewShortcut.browser.test.tsx",
  "apps/web/src/components/pullRequest/PullRequestTimelineTab.browser.test.tsx",
  "apps/web/src/components/pullRequest/PullRequestDetailPanel.browser.test.tsx",
  "apps/web/src/components/guest/GuestPage.browser.test.tsx",
  "apps/web/src/components/RelativeTime.browser.test.tsx",
  "apps/web/src/components/chat/useChatShortcuts.browser.test.tsx",
  "apps/web/src/components/chat/OpenInPicker.browser.test.tsx",
  "apps/web/src/components/ChatMarkdown.permissions.browser.test.tsx",
  "apps/web/src/components/pullRequest/PullRequestCodeTab.browser.test.tsx",
  "apps/web/src/components/pullRequest/usePullRequestFilesViewed.browser.test.tsx",
  "apps/web/src/components/ServerUpdateAction.browser.test.tsx",
  "apps/web/src/hooks/useSettings.personal.browser.test.tsx",
  "apps/web/src/components/chat/JiraResultDisclosure.browser.test.tsx",
  "apps/web/src/components/chat/HtmlRenderFrame.browser.test.tsx",
  "apps/web/src/components/chat/McpAppFrame.browser.test.tsx",
];
async function requiredTests() {
  const fixed = [
    "apps/server/src/orchestration-v2/runtimeLayer.test.ts",
    "apps/server/src/orchestration-v2/RestartContinuation.test.ts",
    "apps/server/src/orchestration-v2/ThreadManagementService.test.ts",
    "apps/server/src/scheduledTasks/ScheduledTaskService.test.ts",
    "packages/client-runtime/src/state/serverScheduledTasks.test.ts",
    "packages/contracts/src/scheduledTask.test.ts",
    "apps/web/src/components/preview/openPreviewSession.test.ts",
    "apps/web/src/components/preview/openTerminalLinkInPreview.test.ts",
    "apps/web/src/previewStateStore.test.ts",
    "apps/web/src/keybindings.test.ts",
    "apps/web/src/components/settings/KeybindingsSettings.logic.test.ts",
    "apps/desktop/src/preview/Manager.test.ts",
    "apps/desktop/src/preview/BrowserSession.test.ts",
    "apps/web/src/timestampFormat.test.ts",
    "apps/web/src/remoteOpen.test.ts",
    "apps/web/src/components/chat/OpenInPicker.logic.test.ts",
    "apps/web/src/state/server.test.ts",
    "apps/web/src/components/pullRequest/pullRequestDiff.logic.test.ts",
    "apps/web/src/components/pullRequest/pullRequestFilesViewed.logic.test.ts",
    "apps/web/src/lib/openPullRequestLink.test.ts",
    "apps/web/src/rightPanelStore.test.ts",
    "apps/web/src/components/preview/agentOpenedPreviews.test.ts",
    "apps/web/src/versionSkew.test.ts",
    "apps/web/src/components/sidebar/updateEverything.logic.test.ts",
    "scripts/build-desktop-artifact.test.ts",
    "scripts/sign-personal-macos.test.ts",
    "apps/server/src/auth/EnvironmentAuth.test.ts",
    "apps/server/src/assets/AssetAccess.test.ts",
    "packages/source-control-github/src/server/gitHubMediaFetch.test.ts",
    "apps/mobile/src/features/pull-requests/pullRequestMediaSource.test.ts",
    "apps/server/src/serverSettings.test.ts",
    "apps/desktop/src/app/DesktopCliCommand.test.ts",
    "apps/desktop/src/app/DesktopCliShim.test.ts",
    "packages/shared/src/providerAuthReturnUrl.test.ts",
    "packages/shared/src/codexAuthHandoff.test.ts",
    "packages/shared/src/promptLinks.test.ts",
    "apps/desktop/src/app/DesktopUserData.test.ts",
    "apps/desktop/src/app/DesktopEnvironment.test.ts",
    "apps/desktop/src/app/DesktopAppIdentity.test.ts",
    "apps/desktop/src/electron/ElectronProtocol.test.ts",
    "packages/contracts/src/settings.test.ts",
    "apps/web/src/clientPersistenceStorage.test.ts",
    "apps/desktop/src/settings/DesktopClientSettings.test.ts",
    "apps/web/src/hooks/useSettings.test.ts",
    "apps/web/src/hooks/useTheme.test.ts",
  ];
  for (const file of [...fixed, ...browserTests]) await NodeFSP.access(NodePath.join(source, file));
  return fixed;
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

async function readBack(release, directory, assets, repairDraft = false) {
  await syncReleaseAssets({
    release,
    directory,
    assets,
    repository: identity.updateRepository,
    run: (...parameters) => gh(...parameters),
    repairDraft,
    refresh: () => releaseRecord(release.tagName),
  });
}

async function main() {
  if (args.help) {
    console.log(
      "Usage: node scripts/personal/nightly.mjs --upstream-tag TAG [--revision 1..999] [--publish]\n       node scripts/personal/nightly.mjs --check",
    );
    return;
  }
  NodeAssert.ok(Number(process.versions.node.split(".")[0]) >= 24, "Use Node 24 or later.");
  const certificate = process.env.T3CODE_PERSONAL_SIGN_IDENTITY;
  NodeAssert.ok(
    /^[A-F0-9]{40}$/u.test(certificate ?? ""),
    "Set T3CODE_PERSONAL_SIGN_IDENTITY to the existing certificate fingerprint.",
  );
  NodeAssert.ok(!(args.check && args.publish), "Choose --check or --publish.");
  const upstreamTag = args["upstream-tag"];
  const version = args.check ? null : personalVersion(upstreamTag ?? "", Number(args.revision));
  environment = { ...process.env };
  for (const key of Object.keys(environment))
    if (/^(?:T3CODE_|VITE_|EXPO_PUBLIC_|APP_VERSION|APPLE_|CSC_|GIT_)/u.test(key))
      delete environment[key];
  Object.assign(environment, {
    T3CODE_PERSONAL_SIGN_IDENTITY: certificate,
    T3CODE_DESKTOP_UPDATE_REPOSITORY: identity.updateRepository,
    GITHUB_REPOSITORY: identity.sourceRepository,
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: "!gh auth git-credential",
    GIT_TERMINAL_PROMPT: "0",
  });
  NodeAssert.equal(
    git("remote", "get-url", "origin"),
    `https://github.com/${identity.sourceRepository}.git`,
  );
  run("gh", ["auth", "status"]);
  NodeAssert.equal(
    gh("api", `repos/${identity.updateRepository}`, "--jq", ".visibility"),
    "public",
  );
  run("vp", ["--version"]);
  if (args.check) {
    console.log("Release prerequisites passed. No app, source, or release was changed.");
    return;
  }
  NodeAssert.equal(NodeOS.platform(), "darwin");
  NodeAssert.equal(NodeOS.arch(), "arm64");
  const unlock = await acquireLock(NodePath.join(root, "nightly.lock"));
  NodeAssert.ok(unlock, "A personal release is already running. Wait for its owner to finish.");
  let artifact;
  try {
    const directory = await NodeFSP.mkdtemp(NodePath.join(root, "release-"));
    const logFile = NodePath.join(directory, "runner.log");
    log = NodeFS.createWriteStream(logFile, { mode: 0o600 });
    console.log(`Building ${version}. Diagnostics and artifacts: ${directory}`);
    NodeAssert.equal(
      git("branch", "--show-current"),
      "personal",
      "Build from the personal branch.",
    );
    NodeAssert.equal(
      git("status", "--porcelain"),
      "",
      "Commit or preserve source edits before building.",
    );
    const sourceCommit = fullSha(git("rev-parse", "HEAD"));
    const upstreamCommit = fullSha(git("rev-parse", `${upstreamTag}^{commit}`));
    NodeAssert.ok(
      isAncestor(
        (parameters) => run("git", parameters, { acceptFailure: true }),
        upstreamCommit,
        sourceCommit,
      ),
      "Merge the selected upstream nightly before building.",
    );
    const official = JSON.parse(
      gh(
        "release",
        "view",
        upstreamTag,
        "--repo",
        "pingdotgg/t3code",
        "--json",
        "isDraft,isPrerelease",
      ),
    );
    NodeAssert.ok(
      !official.isDraft && official.isPrerelease,
      "Select a published official nightly.",
    );
    const publicTags = gh(
      "api",
      `repos/${identity.updateRepository}/releases?per_page=100`,
      "--paginate",
      "--jq",
      ".[] | select(.draft == false) | .tag_name",
    )
      .split("\n")
      .filter((tag) => /^v?\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/u.test(tag));
    NodeAssert.ok(
      publicTags.every((tag) => compareVersions(version, tag) > 0),
      "Choose a version newer than every published Personal release.",
    );
    const tag = `v${version}`;
    let release = await releaseRecord(tag);
    NodeAssert.ok(
      !release || release.isDraft,
      "Published release assets are immutable. Choose a new revision.",
    );
    await assertBuildEnvironment(source);
    Object.assign(
      environment,
      publicBuildEnvironment(await NodeFSP.readFile(NodePath.join(source, ".env.example"), "utf8")),
    );
    const tests = await requiredTests();
    run("vp", ["install", "--frozen-lockfile"]);
    run(process.execPath, ["--test", "scripts/personal/core.test.mjs"]);
    run("vp", ["test", "run", ...tests]);
    run("vp", ["exec", "playwright", "install", "chromium"], {
      cwd: NodePath.join(source, "apps/web"),
    });
    run(
      "vp",
      [
        "test",
        "run",
        ...browserTests.map((file) => file.slice("apps/web/".length)),
        "--project",
        "browser",
      ],
      { cwd: NodePath.join(source, "apps/web") },
    );
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
      "t3",
    ])
      run("vp", ["exec", "--filter", workspace, "--", "tsc", "--noEmit"]);
    run(
      process.execPath,
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
        directory,
      ],
      { timeout: 60 * 60_000 },
    );
    artifact = await verifyArtifact({
      directory,
      version,
      sourceCommit,
      certificate,
      temporaryRoot: directory,
    });
    await smokeApp({ ...artifact, logFile: NodePath.join(directory, "app-smoke.log") });
    NodeAssert.equal(git("rev-parse", "HEAD"), sourceCommit, "Source changed during the release.");
    NodeAssert.equal(git("status", "--porcelain"), "", "Source edits appeared during the release.");
    const assets = [artifact.zip, `${artifact.zip}.blockmap`, "nightly-mac.yml"].map((name) =>
      NodePath.join(directory, name),
    );
    const provenance = {
      version,
      upstreamTag,
      upstreamCommit,
      sourceCommit,
      sourceUrl: `https://github.com/${identity.sourceRepository}/commit/${sourceCommit}`,
      updateRepository: identity.updateRepository,
      certificate,
      architecture: "arm64",
      artifacts: [],
    };
    for (const file of assets)
      provenance.artifacts.push({
        name: NodePath.basename(file),
        sha512: await fileDigest(file),
        size: (await NodeFSP.stat(file)).size,
      });
    await writeJson(NodePath.join(directory, "provenance.json"), provenance);
    if (!args.publish) {
      console.log(`Verified ${version} at ${directory}. Nothing was published.`);
      return;
    }
    git("push", "origin", `${sourceCommit}:refs/heads/personal`);
    NodeAssert.equal(
      git("ls-remote", "origin", "refs/heads/personal").split(/\s/u)[0],
      sourceCommit,
      "Published source readback failed.",
    );
    const notes = NodePath.join(directory, "release-notes.md");
    await NodeFSP.writeFile(
      notes,
      `Personal native arm64 build. Local signature without Apple notarization.\n\nSource: ${provenance.sourceUrl}\nOfficial nightly: ${upstreamTag} at ${upstreamCommit}\n`,
    );
    if (!release) {
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
    } else {
      gh("release", "edit", tag, "--repo", identity.updateRepository, "--notes-file", notes);
    }
    release = await releaseRecord(tag);
    NodeAssert.ok(release?.isDraft, "Only draft assets can be changed.");
    await readBack(
      release,
      NodePath.join(directory, "draft-readback"),
      [...assets, NodePath.join(directory, "provenance.json")],
      true,
    );
    gh(
      "release",
      "edit",
      tag,
      "--repo",
      identity.updateRepository,
      "--draft=false",
      "--prerelease",
    );
    release = await releaseRecord(tag);
    NodeAssert.ok(
      release && !release.isDraft && release.isPrerelease,
      "The Personal prerelease is not public.",
    );
    const feed = await fetch(
      `https://github.com/${identity.updateRepository}/releases/download/${tag}/nightly-mac.yml`,
      { signal: AbortSignal.timeout(30_000) },
    );
    NodeAssert.ok(feed.ok, "The public update manifest is unavailable.");
    NodeAssert.equal(
      await feed.text(),
      await NodeFSP.readFile(NodePath.join(directory, "nightly-mac.yml"), "utf8"),
    );
    console.log(`Published ${release.url}`);
  } catch (error) {
    log?.write(`\nFAILED: ${error.stack ?? error}\n`);
    throw error;
  } finally {
    try {
      if (artifact) await NodeFSP.rm(artifact.temporary, { recursive: true, force: true });
    } finally {
      if (log) await new Promise((resolve) => log.end(resolve));
      await unlock();
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
