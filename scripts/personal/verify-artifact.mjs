import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeNet from "node:net";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeModule from "node:module";
import { extractFile, listPackage } from "@electron/asar";
import Plist from "plist";
import { PERSONAL_DESKTOP as identity } from "../../packages/shared/src/personalDesktop.ts";
import { fullSha } from "./core.mjs";

const requireShared = NodeModule.createRequire(
  new URL("../../packages/shared/package.json", import.meta.url),
);
const { parse: parseYaml } = requireShared("yaml");
const run = (command, args, options = {}) =>
  NodeChildProcess.execFileSync(command, args, {
    encoding: "utf8",
    timeout: 60_000,
    ...options,
  }).trim();
export async function fileDigest(file) {
  const hash = NodeCrypto.createHash("sha512");
  for await (const chunk of NodeFS.createReadStream(file)) hash.update(chunk);
  return hash.digest("base64");
}

export async function verifyManifest(directory, version) {
  const names = await NodeFSP.readdir(directory);
  const zipNames = names.filter((name) => name.endsWith(".zip"));
  NodeAssert.equal(zipNames.length, 1, "Expected one native ZIP artifact.");
  const zip = zipNames[0];
  NodeAssert.equal(zip, `T3-Code-Personal-${version}-arm64.zip`);
  const manifest = parseYaml(
    await NodeFSP.readFile(NodePath.join(directory, "nightly-mac.yml"), "utf8"),
  );
  NodeAssert.equal(manifest.version, version);
  NodeAssert.equal(manifest.path, zip);
  NodeAssert.equal(manifest.files.length, 1);
  const entry = manifest.files[0];
  NodeAssert.equal(entry.url, zip);
  NodeAssert.equal(entry.size, (await NodeFSP.stat(NodePath.join(directory, zip))).size);
  const digest = await fileDigest(NodePath.join(directory, zip));
  NodeAssert.equal(entry.sha512, digest);
  NodeAssert.equal(manifest.sha512, digest);
  NodeAssert.ok(
    (await NodeFSP.stat(NodePath.join(directory, `${zip}.blockmap`))).size > 0,
    "ZIP blockmap is missing.",
  );
  return zip;
}

export async function verifyArtifact({
  directory,
  version,
  sourceCommit,
  certificate,
  repository = identity.updateRepository,
  temporaryRoot,
}) {
  fullSha(sourceCommit);
  NodeAssert.ok(
    /^[A-F0-9]{40}$/u.test(certificate),
    "Expected the signing certificate fingerprint.",
  );
  const zip = await verifyManifest(directory, version);
  const temporary = await NodeFSP.mkdtemp(NodePath.join(temporaryRoot, "verify-"));
  try {
    run("/usr/bin/ditto", ["-x", "-k", NodePath.join(directory, zip), temporary]);
    const app = NodePath.join(temporary, `${identity.productName}.app`);
    const info = Plist.parse(
      await NodeFSP.readFile(NodePath.join(app, "Contents/Info.plist"), "utf8"),
    );
    NodeAssert.equal(info.CFBundleIdentifier, identity.appId);
    NodeAssert.equal(info.CFBundleShortVersionString, version);
    NodeAssert.equal(info.CFBundleDisplayName, identity.productName);
    NodeAssert.deepEqual(
      info.CFBundleURLTypes.flatMap((entry) => entry.CFBundleURLSchemes),
      [identity.scheme],
    );
    NodeAssert.ok(
      !info.CFBundleDocumentTypes,
      "The personal app must not register as a web browser.",
    );
    const executable = NodePath.join(app, "Contents/MacOS", info.CFBundleExecutable);
    NodeAssert.equal(run("/usr/bin/lipo", ["-archs", executable]), "arm64");
    run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
    const prefix = NodePath.join(temporary, "certificate-");
    run("/usr/bin/codesign", ["-d", `--extract-certificates=${prefix}`, app]);
    const leaf = new NodeCrypto.X509Certificate(await NodeFSP.readFile(`${prefix}0`));
    NodeAssert.equal(leaf.fingerprint.replaceAll(":", ""), certificate);
    const resources = NodePath.join(app, "Contents/Resources");
    const feed = parseYaml(
      await NodeFSP.readFile(NodePath.join(resources, "app-update.yml"), "utf8"),
    );
    const [owner, repo] = repository.split("/");
    NodeAssert.equal(feed.provider, "github");
    NodeAssert.equal(feed.owner, owner);
    NodeAssert.equal(feed.repo, repo);
    NodeAssert.equal(feed.updaterCacheDirName, `${identity.packageName}-updater`);
    const asar = NodePath.join(resources, "app.asar");
    const metadata = JSON.parse(extractFile(asar, "package.json").toString());
    NodeAssert.equal(metadata.name, identity.packageName);
    NodeAssert.equal(metadata.version, version);
    NodeAssert.equal(metadata.t3codeCommitHash, sourceCommit.slice(0, 12));
    const main = extractFile(asar, "apps/desktop/dist-electron/main.cjs").toString();
    for (const value of [identity.appId, identity.profileName, identity.homeName, identity.scheme])
      NodeAssert.ok(main.includes(value), `Missing identity value ${value}.`);
    const webAssets = listPackage(asar).filter((file) =>
      /^\/apps\/server\/dist\/client\/assets\/.*\.js$/u.test(file),
    );
    const releaseAssets = webAssets
      .map((file) => extractFile(asar, file.slice(1)).toString())
      .filter((code) => code.includes("/releases"));
    NodeAssert.ok(releaseAssets.length > 0, "Compiled release-link code is missing.");
    NodeAssert.ok(
      releaseAssets.some((code) => code.includes(repository)),
      "Compiled release links use another feed.",
    );
    const home = NodePath.join(temporary, "cli-home");
    await NodeFSP.mkdir(home);
    const output = run(executable, [NodePath.join(asar, "apps/server/dist/bin.mjs"), "--version"], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        T3CODE_HOME: home,
      },
    });
    NodeAssert.ok(output.includes(version), "Bundled CLI version does not match the package.");
    return { zip, app, executable, temporary, metadata, feed };
  } catch (error) {
    await NodeFSP.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function syncReleaseAssets({
  release,
  directory,
  assets,
  repository,
  run,
  repairDraft = false,
  refresh,
}) {
  await NodeFSP.mkdir(directory, { recursive: true });
  for (const asset of assets) {
    const name = NodePath.basename(asset);
    const downloaded = NodePath.join(directory, name);
    const exists = release.assets.some((remote) => remote.name === name);
    let matches = false;
    if (exists) {
      await run(
        "release",
        "download",
        release.tagName,
        "--repo",
        repository,
        "--pattern",
        name,
        "--dir",
        directory,
      );
      matches = (await fileDigest(downloaded)) === (await fileDigest(asset));
      await NodeFSP.rm(downloaded);
    }
    if (!matches) {
      NodeAssert.ok(
        repairDraft && release.isDraft,
        `Remote asset is missing or its hash differs: ${name}`,
      );
      const current = await refresh();
      NodeAssert.ok(current?.isDraft, "Assets can only be replaced on a draft.");
      if (current.assets.some((remote) => remote.name === name))
        await run("release", "delete-asset", release.tagName, name, "--repo", repository, "--yes");
      await run("release", "upload", release.tagName, asset, "--repo", repository);
      await run(
        "release",
        "download",
        release.tagName,
        "--repo",
        repository,
        "--pattern",
        name,
        "--dir",
        directory,
      );
      NodeAssert.equal(
        await fileDigest(downloaded),
        await fileDigest(asset),
        "Remote asset hash differs after upload.",
      );
      await NodeFSP.rm(downloaded);
    }
  }
}

async function portIsClosed(port) {
  return new Promise((resolve, reject) => {
    const socket = NodeNet.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", (error) =>
      error.code === "ECONNREFUSED" ? resolve(true) : reject(error),
    );
    socket.setTimeout(1000, () => {
      socket.destroy();
      reject(new Error("Backend port closure check timed out."));
    });
  });
}

export async function smokeApp({ executable, temporary, logFile }) {
  const home = NodePath.join(temporary, "app-home");
  await NodeFSP.mkdir(NodePath.join(home, "userdata"), { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(home, "userdata/desktop-settings.json"),
    JSON.stringify({ localEnvironmentEnabled: false }),
  );
  const output = await NodeFSP.open(logFile, "a", 0o600);
  const reservation = NodeNet.createServer();
  let child;
  let port;
  let startupError;
  let cleanupError;
  const owned = new Map();
  function captureOwnedProcesses() {
    if (!child?.pid) return;
    const rows = run("/bin/ps", ["-axo", "pid=,ppid=,pgid=,lstart="])
      .split("\n")
      .map((line) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u.exec(line))
      .filter(Boolean);
    let added;
    do {
      added = false;
      for (const [, pid, parent, group, started] of rows) {
        if ((Number(group) === child.pid || owned.has(Number(parent))) && !owned.has(Number(pid))) {
          owned.set(Number(pid), started.trim());
          added = true;
        }
      }
    } while (added);
  }
  function stillOwned(pid, started) {
    const result = NodeChildProcess.spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
    });
    return result.status === 0 && result.stdout.trim() === started;
  }
  function signalOwned(signal) {
    captureOwnedProcesses();
    const targets = [...owned].filter(([pid, started]) => stillOwned(pid, started));
    if (!targets.length) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    for (const [pid, started] of targets) {
      if (!stillOwned(pid, started)) continue;
      try {
        process.kill(pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
  function processesRemain() {
    captureOwnedProcesses();
    return [...owned].some(([pid, started]) => stillOwned(pid, started));
  }
  try {
    reservation.listen(0, "127.0.0.1");
    await NodeEvents.once(reservation, "listening");
    port = reservation.address().port;
    await new Promise((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve())),
    );
    const env = {
      ...process.env,
      T3CODE_HOME: home,
      T3CODE_DISABLE_AUTO_UPDATE: "true",
      T3CODE_PORT: String(port),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VITE_DEV_SERVER_URL;
    child = NodeChildProcess.spawn(executable, [], {
      env,
      detached: true,
      stdio: ["ignore", output.fd, output.fd],
    });
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", resolve);
    });
    child.on("error", (error) => {
      startupError ??= error;
    });
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      captureOwnedProcesses();
      if (startupError) throw startupError;
      NodeAssert.ok(
        child.exitCode === null && child.signalCode === null,
        "The isolated app exited during startup.",
      );
      const log = await NodeFSP.readFile(logFile, "utf8");
      NodeAssert.ok(
        !/fatal startup error|Uncaught Exception|Error launching app|failed to start backend|backend process exited/iu.test(
          log,
        ),
        "The isolated app reported a startup error.",
      );
      NodeAssert.ok(await portIsClosed(port), "The isolated app started an unexpected backend.");
      if (
        log.includes("main window created") &&
        log.includes("app ready") &&
        log.includes("bootstrap skipping local environment (disabled in settings)")
      ) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    NodeAssert.ok(ready, "The isolated app did not become ready within 60 seconds.");
    await NodeFSP.access(NodePath.join(home, "electron-profile"));
  } catch (error) {
    startupError = error;
  } finally {
    try {
      if (reservation.listening) await new Promise((resolve) => reservation.close(resolve));
      signalOwned("SIGTERM");
      const deadline = Date.now() + 10_000;
      while (processesRemain() && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 100));
      const forced = processesRemain();
      if (forced) {
        signalOwned("SIGKILL");
        const killDeadline = Date.now() + 2000;
        while (processesRemain() && Date.now() < killDeadline)
          await new Promise((resolve) => setTimeout(resolve, 100));
      }
      NodeAssert.ok(!processesRemain(), "An owned smoke process did not exit.");
      if (port) NodeAssert.ok(await portIsClosed(port), "The owned backend port is still open.");
      NodeAssert.ok(!forced, "The isolated app or backend required forced shutdown.");
    } catch (error) {
      cleanupError = error;
    } finally {
      try {
        await output.close();
      } catch (error) {
        cleanupError ??= error;
      }
    }
  }
  if (startupError) {
    if (cleanupError) startupError.cause = cleanupError;
    throw startupError;
  }
  if (cleanupError) throw cleanupError;
}
