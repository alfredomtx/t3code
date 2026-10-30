import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

describe("074_ScheduledTaskModelSelectionMode", () => {
  it.effect.each([false, true])(
    "preserves model and schedule when legacy Personal is %s",
    (legacy) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: legacy ? 69 : 72 });
        yield* sql`INSERT INTO scheduled_tasks ${sql.insert({
          task_id: "existing",
          title: "task",
          prompt: "Run",
          enabled: 1,
          schedule_json: '{"type":"interval","everyMs":60000}',
          project_id: "project",
          thread_id: null,
          workspace_strategy_json: '{"type":"root"}',
          model_selection_json:
            '{"instanceId":"codex","model":"gpt-5","options":[{"id":"reasoningEffort","value":"high"}]}',
          runtime_mode: "full-access",
          interaction_mode: "default",
          created_by: "user",
          creation_source: "web",
          created_at: "2026-10-01T00:00:00.000Z",
          updated_at: "2026-10-01T00:00:00.000Z",
          next_run_at: null,
          last_run_at: null,
          last_run_status: "never",
          last_run_error: null,
          run_count: 0,
        })}`;
        if (legacy) {
          yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN bound_model_selection_mode TEXT NOT NULL DEFAULT 'inherit_thread'`;
          yield* sql`UPDATE scheduled_tasks SET bound_model_selection_mode = 'use_task_selection'`;
          yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (70, 'ScheduledTaskModelSelectionMode')`;
        }
        yield* runMigrations({ toMigrationInclusive: 74 });

        const rows = yield* sql<{
          bound_model_selection_mode: string;
          model_selection_json: string;
          schedule_json: string;
        }>`SELECT bound_model_selection_mode, model_selection_json, schedule_json FROM scheduled_tasks`;
        assert.deepEqual(rows, [
          {
            bound_model_selection_mode: legacy ? "use_task_selection" : "inherit_thread",
            model_selection_json:
              '{"instanceId":"codex","model":"gpt-5","options":[{"id":"reasoningEffort","value":"high"}]}',
            schedule_json: '{"type":"interval","everyMs":60000}',
          },
        ]);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
