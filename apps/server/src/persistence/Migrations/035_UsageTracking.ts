import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS usage_requests (
      request_id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_instance_id TEXT,
      model TEXT,
      project_id TEXT,
      project_name TEXT,
      conversation_id TEXT,
      conversation_name TEXT,
      turn_id TEXT,
      agent_id TEXT,
      task_category TEXT,
      input_tokens INTEGER,
      cached_input_tokens INTEGER,
      output_tokens INTEGER,
      reasoning_tokens INTEGER,
      total_tokens INTEGER,
      duration_ms INTEGER,
      succeeded INTEGER NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      cancelled INTEGER NOT NULL DEFAULT 0,
      productive INTEGER NOT NULL DEFAULT 1,
      quota_units REAL,
      official_used_percent_before REAL,
      official_used_percent_after REAL,
      reset_at TEXT,
      source TEXT NOT NULL,
      confidence TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS usage_requests_occurred_at_idx
    ON usage_requests(occurred_at DESC)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS usage_requests_project_idx
    ON usage_requests(project_id, occurred_at DESC)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS usage_requests_conversation_idx
    ON usage_requests(conversation_id, occurred_at DESC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS usage_quota_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      observed_at TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_instance_id TEXT,
      used_percent REAL,
      remaining_percent REAL,
      reset_at TEXT,
      window_duration_minutes INTEGER,
      source TEXT NOT NULL,
      confidence TEXT NOT NULL,
      is_exact INTEGER NOT NULL,
      raw_kind TEXT
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS usage_quota_snapshots_observed_idx
    ON usage_quota_snapshots(observed_at DESC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS usage_calibrations (
      calibration_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_instance_id TEXT,
      recorded_at TEXT NOT NULL,
      provider_used_percent REAL NOT NULL,
      reset_at TEXT NOT NULL,
      total_weekly_allowance REAL,
      local_quota_units_at_checkpoint REAL NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS usage_notification_state (
      notification_key TEXT PRIMARY KEY,
      last_triggered_at TEXT NOT NULL,
      last_used_percent REAL,
      reset_at TEXT
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS usage_project_budgets (
      project_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      limit_value REAL NOT NULL,
      warn_at_percent REAL NOT NULL,
      enforce INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS usage_periods (
      period_id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      reset_at TEXT,
      source TEXT NOT NULL,
      closed_at TEXT,
      reset_reason TEXT
    )
  `;
});
