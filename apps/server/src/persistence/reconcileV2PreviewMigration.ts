import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import PullRequestFilesViewed from "./Migrations/053_PullRequestFilesViewed.ts";
import AutoSettleDisabledAt from "./Migrations/054_ProjectionThreadsAutoSettleDisabledAt.ts";

export function planV2PreviewMigration(history: ReadonlyArray<readonly [number, string]>) {
  const legacy = history.find(
    ([id, name]) => name === "OrchestrationV2" && (id === 53 || id === 54),
  );
  const valid = history
    .filter(([id]) => id >= 53)
    .every(
      ([id, name]) =>
        (id === legacy?.[0] && name === "OrchestrationV2") ||
        (legacy?.[0] === 54 &&
          ((id === 53 && name === "PullRequestFilesViewed") ||
            (id === 55 && name === "RemoveRedundantProjectionIndexes"))),
    );
  return { legacyId: legacy?.[0], valid };
}

// Previews used V2 ids 53/54; preserve their schema and import progress while reserving main's ids.
export const reconcileV2PreviewMigration = Effect.fn("reconcileV2PreviewMigration")(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const tables = yield* sql`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
      `;
      if (tables.length === 0) return [];
      const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 53
      `;
      const { legacyId, valid } = planV2PreviewMigration(
        history.map(({ migration_id, name }) => [migration_id, name]),
      );
      if (legacyId === undefined) return [];
      if (!valid) {
        return yield* new Migrator.MigrationError({
          kind: "BadState",
          message: "Cannot upgrade V2 preview with unexpected later migrations.",
        });
      }
      const executed: Array<readonly [number, string]> = [];
      if (legacyId === 53) {
        yield* PullRequestFilesViewed;
        executed.push([53, "PullRequestFilesViewed"]);
      }
      yield* AutoSettleDisabledAt;
      executed.push([54, "ProjectionThreadsAutoSettleDisabledAt"]);
      // Move the later entry first to avoid a primary-key collision.
      yield* sql`UPDATE effect_sql_migrations SET migration_id = 56 WHERE migration_id = 55 AND name = 'RemoveRedundantProjectionIndexes'`;
      yield* sql`UPDATE effect_sql_migrations SET migration_id = 55 WHERE migration_id = ${legacyId} AND name = 'OrchestrationV2'`;
      if (legacyId === 53) {
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (53, 'PullRequestFilesViewed')`;
      }
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (54, 'ProjectionThreadsAutoSettleDisabledAt')`;
      return executed;
    }),
  );
});
