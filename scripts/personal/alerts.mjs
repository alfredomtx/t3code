import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { readJson, writeJson } from "./core.mjs";

function notifyMac({ notifier, message, diagnostics }) {
  const result = NodeChildProcess.spawnSync(
    notifier,
    [
      "-title",
      "T3 Code Personal",
      "-message",
      message,
      "-group",
      "t3code-personal-nightly",
      "-sound",
      "default",
      "-open",
      NodeURL.pathToFileURL(diagnostics).href,
    ],
    { encoding: "utf8", timeout: 15_000 },
  );
  if (result.error || result.status !== 0)
    throw new Error(`Nightly notification failed: ${result.error?.message ?? result.stderr}`);
}

export async function reportNightlyStatus(
  { root, notifier, failure = null, release = null },
  send = notifyMac,
) {
  if (!notifier) return;
  const stateFile = NodePath.join(root, "notification-state.json");
  const previous = await readJson(stateFile);
  if (failure) {
    if (previous?.status === "failed") return;
    await send({
      notifier,
      message:
        "A nightly build failed. Your current app stays available. Click to view diagnostics.",
      diagnostics: NodePath.join(root, "last-failure.json"),
    });
    await writeJson(stateFile, { status: "failed", notifiedAt: new Date().toISOString() });
  } else if (previous?.status === "failed") {
    await send({
      notifier,
      message: `Nightly checks recovered. Current personal release: ${release.version}.`,
      diagnostics: NodePath.join(root, "status.json"),
    });
    await writeJson(stateFile, { status: "healthy", notifiedAt: new Date().toISOString() });
  }
}
