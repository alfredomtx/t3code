import {
  ProviderThreadId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it } from "vite-plus/test";
import { workEntryDisplayLabel } from "./MessagesTimeline.logic";
import { collectSessionSkills } from "./sessionSkills";
import { deriveTimelineEntriesFromVisibleTurnItems } from "../../session-logic";

const session = ProviderThreadId.make("current-session");
const thread = ThreadId.make("thread");

function read(
  id: string,
  minute: number,
  path: string,
  options: {
    providerThreadId?: ProviderThreadId;
    visibility?: OrchestrationV2ProjectedTurnItem["visibility"];
    exitCode?: number;
  } = {},
): OrchestrationV2ProjectedTurnItem {
  const completedAt = DateTime.makeUnsafe(Date.UTC(2026, 10, 19, 15, minute));
  return {
    position: minute,
    sourceItemId: TurnItemId.make(id),
    sourceThreadId: thread,
    visibility: options.visibility ?? "local",
    item: {
      id: TurnItemId.make(id),
      threadId: thread,
      runId: null,
      nodeId: null,
      providerThreadId: options.providerThreadId ?? session,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: minute,
      status: options.exitCode ? "failed" : "completed",
      title: null,
      startedAt: null,
      completedAt,
      updatedAt: completedAt,
      type: "command_execution",
      input: `cat ${path}`,
      exitCode: options.exitCode ?? 0,
      skillReadPaths: [path],
    },
  };
}

it("counts reads in the current session and sorts skills by their latest read", () => {
  const ponytail = "/skills/ponytail/SKILL.md";
  const unslop = "C:\\skills\\unslop\\SKILL.md";
  expect(
    collectSessionSkills(
      [
        read("latest", 5, unslop),
        read("first", 1, unslop),
        read("other", 4, ponytail),
        read("failed", 7, ponytail, { exitCode: 1 }),
        read("previous", 8, ponytail, { providerThreadId: ProviderThreadId.make("previous") }),
        read("inherited", 9, ponytail, { visibility: "inherited" }),
      ],
      session,
    ),
  ).toEqual([
    { path: unslop, name: "unslop", count: 2, lastRead: "2026-11-19T15:05:00.000Z" },
    { path: ponytail, name: "ponytail", count: 1, lastRead: "2026-11-19T15:04:00.000Z" },
  ]);
});

it("labels a recorded skill read in the timeline", () => {
  const [entry] = deriveTimelineEntriesFromVisibleTurnItems({
    optimisticMessages: [],
    visibleTurnItems: [read("read", 1, "/skills/ponytail/SKILL.md")],
  });
  expect(entry?.kind === "work" && workEntryDisplayLabel(entry.entry, undefined)).toBe(
    "Read skill: ponytail",
  );
});
