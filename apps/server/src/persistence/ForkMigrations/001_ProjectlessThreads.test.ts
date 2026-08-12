import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runForkMigrations } from "../ForkMigrations.ts";
import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("fork migration 001_ProjectlessThreads", (it) => {
  it.effect("preserves upstream columns and indexes while permitting a null project id", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();

      yield* sql`ALTER TABLE projection_threads ADD COLUMN future_upstream_value TEXT`;
      yield* sql`
        CREATE INDEX idx_projection_threads_future_upstream_value
        ON projection_threads(future_upstream_value)
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, created_at, updated_at, pinned_at, pin_order_key,
          future_upstream_value
        ) VALUES (
          'thread-existing', 'project-existing', 'Existing thread',
          '{"instanceId":"codex","model":"gpt-5.6-sol"}', 'full-access',
          'default', '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z',
          '2026-08-12T00:00:00.000Z', 'middle', 'preserved'
        )
      `;

      yield* runForkMigrations();

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.strictEqual(columns.find((column) => column.name === "project_id")?.notnull, 0);
      assert.isTrue(columns.some((column) => column.name === "future_upstream_value"));

      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, created_at, updated_at
        ) VALUES (
          'thread-projectless', NULL, 'New conversation',
          '{"instanceId":"codex","model":"gpt-5.6-sol"}', 'full-access',
          'default', '2026-08-12T01:00:00.000Z', '2026-08-12T01:00:00.000Z'
        )
      `;

      const rows = yield* sql<{
        readonly threadId: string;
        readonly projectId: string | null;
        readonly pinOrderKey: string | null;
        readonly futureUpstreamValue: string | null;
      }>`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          pin_order_key AS "pinOrderKey",
          future_upstream_value AS "futureUpstreamValue"
        FROM projection_threads
        ORDER BY thread_id
      `;
      assert.deepStrictEqual(rows, [
        {
          threadId: "thread-existing",
          projectId: "project-existing",
          pinOrderKey: "middle",
          futureUpstreamValue: "preserved",
        },
        {
          threadId: "thread-projectless",
          projectId: null,
          pinOrderKey: null,
          futureUpstreamValue: null,
        },
      ]);

      const indexRows = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index' AND tbl_name = 'projection_threads'
      `;
      assert.isTrue(
        indexRows.some((index) => index.name === "idx_projection_threads_future_upstream_value"),
      );

      const upstreamMigrationRows = yield* sql<{ readonly latestId: number }>`
        SELECT MAX(migration_id) AS "latestId" FROM effect_sql_migrations
      `;
      const forkMigrationRows = yield* sql<{ readonly latestId: number }>`
        SELECT MAX(migration_id) AS "latestId" FROM t3code_fork_migrations
      `;
      assert.strictEqual(upstreamMigrationRows[0]?.latestId, 40);
      assert.strictEqual(forkMigrationRows[0]?.latestId, 1);
    }),
  );
});
