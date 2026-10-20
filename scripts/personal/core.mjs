import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

export function parseNightly(tag) {
  const match = /^v?(\d+\.\d+\.\d+)-nightly\.(\d{8})\.(\d+)$/u.exec(tag);
  NodeAssert.ok(match, `Invalid nightly tag: ${tag}`);
  const [, base, date, sequenceText] = match;
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  NodeAssert.ok(new Date(iso).toISOString().slice(0, 10) === iso, "Invalid nightly date.");
  const sequence = Number(sequenceText);
  NodeAssert.ok(
    Number.isSafeInteger(sequence) &&
      sequence >= 0 &&
      sequence <= (Number.MAX_SAFE_INTEGER - 999) / 1000,
    "Invalid nightly sequence.",
  );
  return { base, date, sequence };
}

export function personalVersion(tag, revision = 1) {
  NodeAssert.ok(
    Number.isInteger(revision) && revision >= 1 && revision <= 999,
    "Revision must be 1 through 999.",
  );
  const { base, date, sequence } = parseNightly(tag);
  return `${base}-nightly.${date}.${sequence * 1000 + revision}`;
}

export function fullSha(value) {
  NodeAssert.ok(/^[a-f0-9]{40}$/u.test(value), "Expected a full Git commit SHA.");
  return value;
}

export function compareVersions(a, b) {
  const x = parseNightly(a),
    y = parseNightly(b);
  const left = [...x.base.split(".").map(Number), Number(x.date), x.sequence];
  const right = [...y.base.split(".").map(Number), Number(y.date), y.sequence];
  for (let i = 0; i < left.length; i++)
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

export async function writeJson(file, value) {
  await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await NodeFSP.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await NodeFSP.rename(temporary, file);
}

export async function readJson(file) {
  try {
    return JSON.parse(await NodeFSP.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function acquireLock(directory) {
  const token = NodeCrypto.randomUUID();
  await NodeFSP.mkdir(NodePath.dirname(directory), { recursive: true });
  try {
    await NodeFSP.mkdir(directory);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = await readJson(NodePath.join(directory, "owner.json"));
    if (!owner || !Number.isInteger(owner.pid))
      throw new Error("Lock owner is missing. Inspect the lock before removal.", { cause: error });
    try {
      process.kill(owner.pid, 0);
      return null;
    } catch (cause) {
      if (cause.code !== "ESRCH") return null;
    }
    // Only one contender can reclaim a dead owner's directory.
    try {
      await NodeFSP.writeFile(NodePath.join(directory, "reclaim"), token, { flag: "wx" });
    } catch (cause) {
      if (cause.code === "EEXIST") return null;
      throw cause;
    }
    const current = await readJson(NodePath.join(directory, "owner.json"));
    NodeAssert.ok(current?.token === owner.token, "Lock ownership changed during recovery.");
    await NodeFSP.rm(NodePath.join(directory, "owner.json"));
    await NodeFSP.rm(NodePath.join(directory, "reclaim"));
    try {
      await NodeFSP.rmdir(directory);
    } catch (cause) {
      if (cause.code === "ENOTEMPTY") return null;
      throw cause;
    }
    return acquireLock(directory);
  }
  await writeJson(NodePath.join(directory, "owner.json"), { pid: process.pid, token });
  return async () => {
    const owner = await readJson(NodePath.join(directory, "owner.json"));
    NodeAssert.ok(
      owner?.token === token && owner.pid === process.pid,
      "Refusing to release another process lock.",
    );
    await NodeFSP.rm(NodePath.join(directory, "owner.json"));
    await NodeFSP.rmdir(directory);
  };
}

export function protectedPath(file) {
  return (
    /(?:^|\/)(?:\.github|\.agents|\.husky|testing|__tests__)(?:\/|$)/u.test(file) ||
    /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/u.test(file) ||
    /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|.*config\.[^/]+|.*\.plist)$/u.test(
      file,
    ) ||
    /(?:^|\/)[^/]*(?:test|spec)\.[^/]+$/u.test(file) ||
    /^(?:scripts\/|apps\/desktop\/scripts\/)/u.test(file)
  );
}

export async function repairSnapshot(root, files) {
  const result = {};
  for (const file of files.filter(protectedPath)) {
    try {
      result[file] = NodeCrypto.createHash("sha256")
        .update(await NodeFSP.readFile(NodePath.join(root, file)))
        .digest("hex");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      result[file] = null;
    }
  }
  return result;
}

export function checkRepairScope(before, after) {
  NodeAssert.deepEqual(
    after,
    before,
    "Repair changed protected tests, configuration, or release/signing code.",
  );
}

export function reviewAccepted(value) {
  NodeAssert.ok(
    value &&
      value.verdict === "accept" &&
      Array.isArray(value.findings) &&
      value.findings.length === 0,
    "Independent repair review rejected the change.",
  );
}

export const PUBLIC_BUILD_KEYS = [
  "T3CODE_CLERK_PUBLISHABLE_KEY",
  "T3CODE_CLERK_JWT_TEMPLATE",
  "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID",
  "T3CODE_RELAY_URL",
];
export function publicBuildEnvironment(example) {
  const env = {};
  for (const line of example.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.+)$/u.exec(line);
    if (match && PUBLIC_BUILD_KEYS.includes(match[1])) env[match[1]] = match[2];
  }
  NodeAssert.ok(
    PUBLIC_BUILD_KEYS.every((key) => env[key]),
    "Public source-build defaults are missing.",
  );
  NodeAssert.ok(
    env.T3CODE_CLERK_PUBLISHABLE_KEY.startsWith("pk_live_"),
    "Expected the documented public Clerk key.",
  );
  NodeAssert.ok(new URL(env.T3CODE_RELAY_URL).protocol === "https:", "Relay requires HTTPS.");
  return env;
}
