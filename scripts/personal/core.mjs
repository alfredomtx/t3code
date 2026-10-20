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
    /(?:^|\/)(?:\.github|\.agents|\.claude|\.husky|testing|__tests__)(?:\/|$)/u.test(file) ||
    /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/u.test(file) ||
    /(?:^|\/)\.env[^/]*$/iu.test(file) ||
    file === "packages/shared/src/personalDesktop.ts" ||
    file.startsWith(".git/") ||
    /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|.*config\.[^/]+|.*\.plist)$/u.test(
      file,
    ) ||
    /(?:^|\/)[^/]*(?:test|spec)\.[^/]+$/u.test(file) ||
    /^(?:scripts\/|apps\/desktop\/scripts\/)/u.test(file)
  );
}

async function inputFiles(root, directory = "") {
  const files = [];
  for (const entry of await NodeFSP.readdir(NodePath.join(root, directory), {
    withFileTypes: true,
  })) {
    if (["node_modules", ".git"].includes(entry.name)) continue;
    const file = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await inputFiles(root, file)));
    else files.push(file);
  }
  return files;
}

export async function assertBuildEnvironment(root) {
  const files = await inputFiles(root);
  NodeAssert.ok(
    !files.some(
      (file) =>
        NodePath.basename(file).toLowerCase().startsWith(".env") &&
        NodePath.basename(file).toLowerCase() !== ".env.example",
    ),
    "The dedicated builder contains an environment input. Remove it before building.",
  );
  for (const file of files) {
    const stat = await NodeFSP.lstat(NodePath.join(root, file));
    NodeAssert.ok(
      !stat.isSymbolicLink() || file === ".claude/skills",
      `The dedicated builder contains a linked input: ${file}`,
    );
  }
}

export async function repairSnapshot(root, files, conflicts) {
  const discovered = await inputFiles(root);
  const gitFiles = [
    ".git/config",
    ".git/config.worktree",
    ".git/HEAD",
    ".git/MERGE_HEAD",
    ".git/info/attributes",
    ".git/info/exclude",
  ];
  try {
    NodeAssert.ok(
      (await NodeFSP.lstat(NodePath.join(root, ".git"))).isDirectory(),
      "The builder must have a private Git directory.",
    );
    const hooks = NodePath.join(root, ".git/hooks");
    NodeAssert.ok(
      (await NodeFSP.lstat(hooks)).isDirectory(),
      "Git hooks must use a private directory.",
    );
    gitFiles.push(...(await inputFiles(hooks)).map((file) => `.git/hooks/${file}`));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const result = {};
  for (const file of [...new Set([...files, ...discovered, ...gitFiles])].sort()) {
    NodeAssert.ok(
      !NodePath.isAbsolute(file) && !file.split("/").includes(".."),
      "Invalid repair input path.",
    );
    if (!protectedPath(file) && (!conflicts || conflicts.includes(file))) continue;
    try {
      const path = NodePath.join(root, file);
      const stat = await NodeFSP.lstat(path);
      if (stat.isSymbolicLink() && file === ".claude/skills") {
        result[file] = `symlink:${await NodeFSP.readlink(path)}`;
        continue;
      }
      NodeAssert.ok(stat.isFile(), `Repair input must be a regular file: ${file}`);
      result[file] = `${stat.mode}:${NodeCrypto.createHash("sha256")
        .update(await NodeFSP.readFile(path))
        .digest("hex")}`;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      result[file] = null;
    }
  }
  return result;
}

export function publicationPending(record) {
  return record?.readyForPublication === true && record.published === false ? record : null;
}

export function defaultRevision({ pending, status, upstreamCommit, originCommit }) {
  if (pending) return parseNightly(pending.version).sequence % 1000;
  if (status?.upstreamCommit === upstreamCommit)
    return (
      (parseNightly(status.version).sequence % 1000) +
      (status.sourceCommit === originCommit ? 0 : 1)
    );
  return 1;
}

export function isAncestor(runGit, ancestor, descendant) {
  const result = runGit(["merge-base", "--is-ancestor", fullSha(ancestor), fullSha(descendant)]);
  NodeAssert.ok(!result.error && [0, 1].includes(result.status), "Git ancestry check failed.");
  return result.status === 0;
}

export function checkRepairScope(before, after) {
  NodeAssert.deepEqual(after, before, "Repair changed a file outside the permitted conflicts.");
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
