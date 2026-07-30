import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("036_ProjectlessThreads", (it) => {
  it.effect("preserves existing threads and allows a null project id", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 35 });

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          archived_at,
          settled_override,
          settled_at,
          snoozed_until,
          snoozed_at,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          deleted_at
        )
        VALUES (
          'thread-existing',
          'project-existing',
          'Existing thread',
          '{"instanceId":"codex","model":"gpt-5.4"}',
          'full-access',
          'default',
          NULL,
          NULL,
          NULL,
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          0,
          0,
          0,
          NULL
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 36 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.strictEqual(columns.find((column) => column.name === "project_id")?.notnull, 0);

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          created_at,
          updated_at
        )
        VALUES (
          'thread-projectless',
          NULL,
          'New conversation',
          '{"instanceId":"codex","model":"gpt-5.4"}',
          'full-access',
          'default',
          '2026-01-02T00:00:00.000Z',
          '2026-01-02T00:00:00.000Z'
        )
      `;

      const rows = yield* sql<{
        readonly threadId: string;
        readonly projectId: string | null;
      }>`
        SELECT thread_id AS threadId, project_id AS projectId
        FROM projection_threads
        ORDER BY thread_id
      `;
      assert.deepStrictEqual(rows, [
        { threadId: "thread-existing", projectId: "project-existing" },
        { threadId: "thread-projectless", projectId: null },
      ]);
    }),
  );
});
