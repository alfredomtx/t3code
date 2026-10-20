#!/usr/bin/env node
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { PERSONAL_DESKTOP as identity } from "../../packages/shared/src/personalDesktop.ts";
import { writeJson } from "./core.mjs";

const args = process.argv.slice(2);
NodeAssert.ok(
  args.length === 1 && ["--check", "--write"].includes(args[0]),
  "Use --check or --write. This script does not activate launchd.",
);
const sourceCheckout = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../..",
);
const root = NodePath.join(NodeOS.homedir(), ".local/share/t3-personal");
const label = "com.alfredomtx.t3code.personal.nightly";
const config = {
  sourceCheckout,
  sourceRepository: identity.sourceRepository,
  updateRepository: identity.updateRepository,
  signingIdentity: "5982A03C0452FB344BC92765B84FF62391712882",
  node: "/Users/atorres/.nvm/versions/node/v24.21.0/bin/node",
  vpHome: "/Users/atorres/.local/share/t3-personal/toolchain/vite-plus",
  vpBin: "/Users/atorres/.local/share/t3-personal/toolchain/vite-plus/bin",
  codex: NodeChildProcess.execFileSync("/bin/zsh", ["-lc", "command -v codex"], {
    encoding: "utf8",
  }).trim(),
};
for (const value of [config.node, NodePath.join(config.vpBin, "vp"), config.codex]) {
  NodeAssert.ok(NodePath.isAbsolute(value));
  await NodeFSP.access(value);
}
const xml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(config.node)}</string><string>${xml(NodePath.join(sourceCheckout, "scripts/personal/nightly.mjs"))}</string><string>--publish</string></array>
<key>WorkingDirectory</key><string>${xml(sourceCheckout)}</string>
<key>StartInterval</key><integer>900</integer>
<key>RunAtLoad</key><true/>
<key>StandardOutPath</key><string>${xml(NodePath.join(root, "launchd.stdout.log"))}</string>
<key>StandardErrorPath</key><string>${xml(NodePath.join(root, "launchd.stderr.log"))}</string>
</dict></plist>
`;
const target = NodePath.join(NodeOS.homedir(), "Library/LaunchAgents", `${label}.plist`);
if (args[0] === "--write") {
  await writeJson(NodePath.join(root, "config.json"), config);
  await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
  await NodeFSP.writeFile(target, plist, { mode: 0o600 });
  NodeChildProcess.execFileSync("/usr/bin/plutil", ["-lint", target], { stdio: "inherit" });
  console.log(`Prepared ${target}. The LaunchAgent is not active.`);
} else {
  NodeChildProcess.execFileSync("/usr/bin/plutil", ["-lint", "-"], {
    input: plist,
    stdio: ["pipe", "inherit", "inherit"],
  });
  console.log(JSON.stringify({ target, config, active: false }, null, 2));
}
