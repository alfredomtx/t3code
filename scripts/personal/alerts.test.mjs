import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { reportNightlyStatus } from "./alerts.mjs";

NodeTest.test(
  "a failure incident notifies once and recovery permits the next incident",
  async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-personal-alerts-"));
    try {
      const notifications = [];
      const send = async (notification) => {
        notifications.push(notification);
      };
      const input = { root, notifier: "/notifier", release: { version: "1.2.3" } };
      await reportNightlyStatus(input, send);
      NodeAssert.equal(notifications.length, 0);
      await reportNightlyStatus({ ...input, failure: { error: "build failed" } }, send);
      await reportNightlyStatus({ ...input, failure: { error: "build still failed" } }, send);
      NodeAssert.equal(notifications.length, 1);
      NodeAssert.equal(notifications[0].diagnostics, NodePath.join(root, "last-failure.json"));
      await reportNightlyStatus(input, send);
      await reportNightlyStatus(input, send);
      NodeAssert.equal(notifications.length, 2);
      NodeAssert.match(notifications[1].message, /recovered/);
      await reportNightlyStatus({ ...input, failure: { error: "new failure" } }, send);
      NodeAssert.equal(notifications.length, 3);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  },
);

NodeTest.test("failed notification delivery stays retryable", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-personal-alert-retry-"));
  try {
    const input = { root, notifier: "/notifier", failure: { error: "build failed" } };
    await NodeAssert.rejects(
      reportNightlyStatus(input, async () => {
        throw new Error("unavailable");
      }),
      /unavailable/,
    );
    let delivered = 0;
    await reportNightlyStatus(input, async () => {
      delivered++;
    });
    NodeAssert.equal(delivered, 1);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
