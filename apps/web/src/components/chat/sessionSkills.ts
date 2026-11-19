import type {
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2TurnItem,
  ProviderThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export function skillReadPaths(item: OrchestrationV2TurnItem | undefined) {
  return item?.type === "command_execution" && item.status === "completed" && item.exitCode === 0
    ? (item.skillReadPaths ?? [])
    : [];
}

export function skillReadName(path: string) {
  const parts = path.split(/[\\/]/u);
  return parts.at(-2) ?? parts.at(-1) ?? path;
}

export function collectSessionSkills(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  providerThreadId: ProviderThreadId,
) {
  const skills = new Map<string, { path: string; name: string; count: number; lastRead: string }>();
  for (const { visibility, item } of items) {
    if (visibility !== "local" || item.providerThreadId !== providerThreadId) continue;
    for (const path of skillReadPaths(item)) {
      const previous = skills.get(path);
      const readAt = DateTime.formatIso(item.completedAt ?? item.updatedAt);
      skills.set(path, {
        path,
        name: skillReadName(path),
        count: (previous?.count ?? 0) + 1,
        lastRead: previous && previous.lastRead > readAt ? previous.lastRead : readAt,
      });
    }
  }
  return [...skills.values()].sort(
    (a, b) => b.lastRead.localeCompare(a.lastRead) || a.name.localeCompare(b.name),
  );
}
