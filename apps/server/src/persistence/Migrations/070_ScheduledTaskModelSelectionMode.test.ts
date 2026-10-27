import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("070_ScheduledTaskModelSelectionMode", (it) => {
  it.effect(
    "defaults existing tasks to inheritance without changing their saved model or schedule",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 69 });
        yield* sql`INSERT INTO scheduled_tasks ${sql.insert({
          task_id: "existing",
          title: "task",
          prompt: "Run",
          enabled: 1,
          schedule_json: '{"type":"interval","everyMs":60000}',
          project_id: "project",
          thread_id: null,
          workspace_strategy_json: '{"type":"root"}',
          model_selection_json: '{"instanceId":"codex","model":"gpt-5"}',
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
        yield* runMigrations({ toMigrationInclusive: 70 });

        const rows = yield* sql<{
          bound_model_selection_mode: string;
          model_selection_json: string;
          schedule_json: string;
        }>`SELECT bound_model_selection_mode, model_selection_json, schedule_json FROM scheduled_tasks`;
        assert.deepEqual(rows, [
          {
            bound_model_selection_mode: "inherit_thread",
            model_selection_json: '{"instanceId":"codex","model":"gpt-5"}',
            schedule_json: '{"type":"interval","everyMs":60000}',
          },
        ]);
      }),
  );
});
