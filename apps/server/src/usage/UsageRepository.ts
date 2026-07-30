import {
  type UsageCalibrationCheckpoint,
  type UsageProjectBudget,
  type UsageQuotaSnapshot,
  type UsageRequestRecord,
  UsageError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export interface UsageNotificationState {
  readonly key: string;
  readonly lastTriggeredAt: string;
  readonly lastUsedPercent: number | null;
  readonly resetAt: string | null;
}

export class UsageRepository extends Context.Service<
  UsageRepository,
  {
    readonly insertRequest: (record: UsageRequestRecord) => Effect.Effect<boolean, UsageError>;
    readonly insertQuotaSnapshot: (
      snapshot: UsageQuotaSnapshot,
    ) => Effect.Effect<boolean, UsageError>;
    readonly observeQuotaPeriod: (
      snapshot: UsageQuotaSnapshot,
      resetReason: "provider-drop" | "timestamp-passed" | null,
    ) => Effect.Effect<void, UsageError>;
    readonly confirmManualReset: (
      startedAt: string,
      resetAt: string,
    ) => Effect.Effect<void, UsageError>;
    readonly attachLatestQuotaAfter: (
      providerInstanceId: string | null,
      usedPercent: number,
      resetAt: string | null,
    ) => Effect.Effect<void, UsageError>;
    readonly markTurnOutcome: (
      turnId: string,
      outcome: "completed" | "failed" | "cancelled" | "interrupted",
    ) => Effect.Effect<void, UsageError>;
    readonly insertCalibration: (
      calibration: UsageCalibrationCheckpoint,
    ) => Effect.Effect<void, UsageError>;
    readonly listRequests: Effect.Effect<ReadonlyArray<UsageRequestRecord>, UsageError>;
    readonly listQuotaSnapshots: Effect.Effect<ReadonlyArray<UsageQuotaSnapshot>, UsageError>;
    readonly listCalibrations: Effect.Effect<ReadonlyArray<UsageCalibrationCheckpoint>, UsageError>;
    readonly listProjectBudgets: Effect.Effect<ReadonlyArray<UsageProjectBudget>, UsageError>;
    readonly setProjectBudget: (
      projectId: string,
      budget: UsageProjectBudget | null,
    ) => Effect.Effect<void, UsageError>;
    readonly getNotificationState: (
      key: string,
    ) => Effect.Effect<UsageNotificationState | null, UsageError>;
    readonly setNotificationState: (
      state: UsageNotificationState,
    ) => Effect.Effect<void, UsageError>;
    readonly clearHistory: Effect.Effect<void, UsageError>;
  }
>()("t3/usage/UsageRepository") {}

function databaseError(operation: UsageError["operation"], cause: unknown): UsageError {
  return new UsageError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  });
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requestFromRow(row: Record<string, unknown>): UsageRequestRecord {
  return {
    id: String(row.requestId),
    occurredAt: String(row.occurredAt),
    provider: row.provider as UsageRequestRecord["provider"],
    providerInstanceId:
      row.providerInstanceId === null
        ? null
        : (String(row.providerInstanceId) as UsageRequestRecord["providerInstanceId"]),
    model: nullableString(row.model),
    projectId:
      row.projectId === null ? null : (String(row.projectId) as UsageRequestRecord["projectId"]),
    projectName: nullableString(row.projectName),
    conversationId:
      row.conversationId === null
        ? null
        : (String(row.conversationId) as UsageRequestRecord["conversationId"]),
    conversationName: nullableString(row.conversationName),
    turnId: row.turnId === null ? null : (String(row.turnId) as UsageRequestRecord["turnId"]),
    agentId: nullableString(row.agentId),
    taskCategory: nullableString(row.taskCategory),
    inputTokens: nullableNumber(row.inputTokens),
    cachedInputTokens: nullableNumber(row.cachedInputTokens),
    outputTokens: nullableNumber(row.outputTokens),
    reasoningTokens: nullableNumber(row.reasoningTokens),
    totalTokens: nullableNumber(row.totalTokens),
    durationMs: nullableNumber(row.durationMs),
    succeeded: row.succeeded === 1,
    retryCount: nullableNumber(row.retryCount) ?? 0,
    cancelled: row.cancelled === 1,
    productive: row.productive === 1,
    quotaUnits: nullableNumber(row.quotaUnits),
    officialUsedPercentBefore: nullableNumber(row.officialUsedPercentBefore),
    officialUsedPercentAfter: nullableNumber(row.officialUsedPercentAfter),
    resetAt: nullableString(row.resetAt),
    source: row.source as UsageRequestRecord["source"],
    confidence: row.confidence as UsageRequestRecord["confidence"],
    createdAt: String(row.createdAt),
  };
}

function quotaFromRow(row: Record<string, unknown>): UsageQuotaSnapshot {
  return {
    id: String(row.snapshotId),
    observedAt: String(row.observedAt),
    provider: row.provider as UsageQuotaSnapshot["provider"],
    providerInstanceId:
      row.providerInstanceId === null
        ? null
        : (String(row.providerInstanceId) as UsageQuotaSnapshot["providerInstanceId"]),
    usedPercent: nullableNumber(row.usedPercent),
    remainingPercent: nullableNumber(row.remainingPercent),
    resetAt: nullableString(row.resetAt),
    windowDurationMinutes: nullableNumber(row.windowDurationMinutes),
    source: row.source as UsageQuotaSnapshot["source"],
    confidence: row.confidence as UsageQuotaSnapshot["confidence"],
    isExact: row.isExact === 1,
    rawKind: nullableString(row.rawKind),
  };
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertRequest: UsageRepository["Service"]["insertRequest"] = Effect.fn(
    "UsageRepository.insertRequest",
  )(
    function* (record) {
      const existing = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM usage_requests WHERE request_id = ${record.id}
    `;
      if ((existing[0]?.count ?? 0) > 0) return false;
      yield* sql`
      INSERT INTO usage_requests (
        request_id, occurred_at, provider, provider_instance_id, model,
        project_id, project_name, conversation_id, conversation_name, turn_id,
        agent_id, task_category, input_tokens, cached_input_tokens, output_tokens,
        reasoning_tokens, total_tokens, duration_ms, succeeded, retry_count,
        cancelled, productive, quota_units, official_used_percent_before,
        official_used_percent_after, reset_at, source, confidence, created_at
      ) VALUES (
        ${record.id}, ${record.occurredAt}, ${record.provider}, ${record.providerInstanceId},
        ${record.model}, ${record.projectId}, ${record.projectName}, ${record.conversationId},
        ${record.conversationName}, ${record.turnId}, ${record.agentId}, ${record.taskCategory},
        ${record.inputTokens}, ${record.cachedInputTokens}, ${record.outputTokens},
        ${record.reasoningTokens}, ${record.totalTokens}, ${record.durationMs},
        ${record.succeeded ? 1 : 0}, ${record.retryCount}, ${record.cancelled ? 1 : 0},
        ${record.productive ? 1 : 0}, ${record.quotaUnits},
        ${record.officialUsedPercentBefore}, ${record.officialUsedPercentAfter},
        ${record.resetAt}, ${record.source}, ${record.confidence}, ${record.createdAt}
      )
    `;
      return true;
    },
    Effect.mapError((cause) => databaseError("write", cause)),
  );

  const insertQuotaSnapshot: UsageRepository["Service"]["insertQuotaSnapshot"] = Effect.fn(
    "UsageRepository.insertQuotaSnapshot",
  )(
    function* (snapshot) {
      const existing = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM usage_quota_snapshots WHERE snapshot_id = ${snapshot.id}
    `;
      if ((existing[0]?.count ?? 0) > 0) return false;
      yield* sql`
      INSERT INTO usage_quota_snapshots (
        snapshot_id, observed_at, provider, provider_instance_id, used_percent,
        remaining_percent, reset_at, window_duration_minutes, source, confidence,
        is_exact, raw_kind
      ) VALUES (
        ${snapshot.id}, ${snapshot.observedAt}, ${snapshot.provider},
        ${snapshot.providerInstanceId}, ${snapshot.usedPercent}, ${snapshot.remainingPercent},
        ${snapshot.resetAt}, ${snapshot.windowDurationMinutes}, ${snapshot.source},
        ${snapshot.confidence}, ${snapshot.isExact ? 1 : 0}, ${snapshot.rawKind}
      )
    `;
      return true;
    },
    Effect.mapError((cause) => databaseError("write", cause)),
  );

  const attachLatestQuotaAfter: UsageRepository["Service"]["attachLatestQuotaAfter"] = Effect.fn(
    "UsageRepository.attachLatestQuotaAfter",
  )(
    function* (providerInstanceId, usedPercent, resetAt) {
      yield* sql`
      UPDATE usage_requests
      SET
        official_used_percent_after = ${usedPercent},
        reset_at = COALESCE(${resetAt}, reset_at),
        quota_units = CASE
          WHEN official_used_percent_before IS NOT NULL
          THEN MAX(0, ${usedPercent} - official_used_percent_before)
          ELSE quota_units
        END
      WHERE request_id = (
        SELECT request_id
        FROM usage_requests
        WHERE (
          provider_instance_id = ${providerInstanceId}
          OR (provider_instance_id IS NULL AND ${providerInstanceId} IS NULL)
        )
        ORDER BY occurred_at DESC, request_id DESC
        LIMIT 1
      )
    `;
    },
    Effect.mapError((cause) => databaseError("write", cause)),
  );

  const observeQuotaPeriod: UsageRepository["Service"]["observeQuotaPeriod"] = Effect.fn(
    "UsageRepository.observeQuotaPeriod",
  )(
    function* (snapshot, resetReason) {
      if (resetReason !== null) {
        yield* sql`
        UPDATE usage_periods
        SET closed_at = ${snapshot.observedAt}, reset_reason = ${resetReason}
        WHERE closed_at IS NULL
      `;
        yield* sql`DELETE FROM usage_notification_state`;
      }
      const open = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM usage_periods WHERE closed_at IS NULL
    `;
      if ((open[0]?.count ?? 0) === 0) {
        yield* sql`
        INSERT INTO usage_periods (
          period_id, started_at, reset_at, source, closed_at, reset_reason
        ) VALUES (
          ${`period:${snapshot.observedAt}`}, ${snapshot.observedAt}, ${snapshot.resetAt},
          ${snapshot.source}, NULL, NULL
        )
      `;
      }
    },
    Effect.mapError((cause) => databaseError("write", cause)),
  );

  const confirmManualReset: UsageRepository["Service"]["confirmManualReset"] = Effect.fn(
    "UsageRepository.confirmManualReset",
  )(
    function* (startedAt, resetAt) {
      yield* sql`
      UPDATE usage_periods
      SET closed_at = ${startedAt}, reset_reason = 'manual'
      WHERE closed_at IS NULL
    `;
      yield* sql`DELETE FROM usage_notification_state`;
      yield* sql`
      INSERT INTO usage_periods (
        period_id, started_at, reset_at, source, closed_at, reset_reason
      ) VALUES (
        ${`period:manual:${startedAt}`}, ${startedAt}, ${resetAt},
        'locally-calculated', NULL, NULL
      )
    `;
    },
    Effect.mapError((cause) => databaseError("write", cause)),
  );

  const markTurnOutcome: UsageRepository["Service"]["markTurnOutcome"] = Effect.fn(
    "UsageRepository.markTurnOutcome",
  )(
    function* (turnId, outcome) {
      const succeeded = outcome === "completed";
      const cancelled = outcome === "cancelled" || outcome === "interrupted";
      yield* sql`
      UPDATE usage_requests
      SET
        succeeded = ${succeeded ? 1 : 0},
        cancelled = ${cancelled ? 1 : 0},
        productive = ${succeeded ? 1 : 0}
      WHERE turn_id = ${turnId}
    `;
    },
    Effect.mapError((cause) => databaseError("write", cause)),
  );

  const insertCalibration: UsageRepository["Service"]["insertCalibration"] = Effect.fn(
    "UsageRepository.insertCalibration",
  )(
    function* (calibration) {
      yield* sql`
      INSERT OR REPLACE INTO usage_calibrations (
        calibration_id, provider, provider_instance_id, recorded_at,
        provider_used_percent, reset_at, total_weekly_allowance,
        local_quota_units_at_checkpoint
      ) VALUES (
        ${calibration.id}, ${calibration.provider}, ${calibration.providerInstanceId},
        ${calibration.recordedAt}, ${calibration.providerUsedPercent}, ${calibration.resetAt},
        ${calibration.totalWeeklyAllowance}, ${calibration.localQuotaUnitsAtCheckpoint}
      )
    `;
    },
    Effect.mapError((cause) => databaseError("calibrate", cause)),
  );

  const listRequests = sql<Record<string, unknown>>`
    SELECT
      request_id AS "requestId", occurred_at AS "occurredAt", provider,
      provider_instance_id AS "providerInstanceId", model, project_id AS "projectId",
      project_name AS "projectName", conversation_id AS "conversationId",
      conversation_name AS "conversationName", turn_id AS "turnId", agent_id AS "agentId",
      task_category AS "taskCategory", input_tokens AS "inputTokens",
      cached_input_tokens AS "cachedInputTokens", output_tokens AS "outputTokens",
      reasoning_tokens AS "reasoningTokens", total_tokens AS "totalTokens",
      duration_ms AS "durationMs", succeeded, retry_count AS "retryCount", cancelled,
      productive, quota_units AS "quotaUnits",
      official_used_percent_before AS "officialUsedPercentBefore",
      official_used_percent_after AS "officialUsedPercentAfter", reset_at AS "resetAt",
      source, confidence, created_at AS "createdAt"
    FROM usage_requests
    ORDER BY occurred_at ASC, request_id ASC
  `.pipe(
    Effect.map((rows) => rows.map(requestFromRow)),
    Effect.mapError((cause) => databaseError("read", cause)),
  );

  const listQuotaSnapshots = sql<Record<string, unknown>>`
    SELECT
      snapshot_id AS "snapshotId", observed_at AS "observedAt", provider,
      provider_instance_id AS "providerInstanceId", used_percent AS "usedPercent",
      remaining_percent AS "remainingPercent", reset_at AS "resetAt",
      window_duration_minutes AS "windowDurationMinutes", source, confidence,
      is_exact AS "isExact", raw_kind AS "rawKind"
    FROM usage_quota_snapshots
    ORDER BY observed_at ASC, snapshot_id ASC
  `.pipe(
    Effect.map((rows) => rows.map(quotaFromRow)),
    Effect.mapError((cause) => databaseError("read", cause)),
  );

  const listCalibrations = sql<Record<string, unknown>>`
    SELECT
      calibration_id AS "calibrationId", provider,
      provider_instance_id AS "providerInstanceId", recorded_at AS "recordedAt",
      provider_used_percent AS "providerUsedPercent", reset_at AS "resetAt",
      total_weekly_allowance AS "totalWeeklyAllowance",
      local_quota_units_at_checkpoint AS "localQuotaUnitsAtCheckpoint"
    FROM usage_calibrations
    ORDER BY recorded_at ASC, calibration_id ASC
  `.pipe(
    Effect.map((rows) =>
      rows.map(
        (row): UsageCalibrationCheckpoint => ({
          id: String(row.calibrationId),
          provider: row.provider as UsageCalibrationCheckpoint["provider"],
          providerInstanceId:
            row.providerInstanceId === null
              ? null
              : (String(
                  row.providerInstanceId,
                ) as UsageCalibrationCheckpoint["providerInstanceId"]),
          recordedAt: String(row.recordedAt),
          providerUsedPercent: Number(row.providerUsedPercent),
          resetAt: String(row.resetAt),
          totalWeeklyAllowance: nullableNumber(row.totalWeeklyAllowance),
          localQuotaUnitsAtCheckpoint: Number(row.localQuotaUnitsAtCheckpoint),
        }),
      ),
    ),
    Effect.mapError((cause) => databaseError("read", cause)),
  );

  const listProjectBudgets = sql<Record<string, unknown>>`
    SELECT
      project_id AS "projectId", kind, limit_value AS "limitValue",
      warn_at_percent AS "warnAtPercent", enforce, updated_at AS "updatedAt"
    FROM usage_project_budgets
    ORDER BY project_id ASC
  `.pipe(
    Effect.map((rows) =>
      rows.map(
        (row): UsageProjectBudget => ({
          projectId: String(row.projectId) as UsageProjectBudget["projectId"],
          kind: row.kind as UsageProjectBudget["kind"],
          limit: Number(row.limitValue),
          warnAtPercent: Number(row.warnAtPercent),
          enforce: row.enforce === 1,
          updatedAt: String(row.updatedAt),
        }),
      ),
    ),
    Effect.mapError((cause) => databaseError("read", cause)),
  );

  const setProjectBudget: UsageRepository["Service"]["setProjectBudget"] = Effect.fn(
    "UsageRepository.setProjectBudget",
  )(
    function* (projectId, budget) {
      if (budget === null) {
        yield* sql`DELETE FROM usage_project_budgets WHERE project_id = ${projectId}`;
        return;
      }
      yield* sql`
      INSERT INTO usage_project_budgets (
        project_id, kind, limit_value, warn_at_percent, enforce, updated_at
      ) VALUES (
        ${budget.projectId}, ${budget.kind}, ${budget.limit}, ${budget.warnAtPercent},
        ${budget.enforce ? 1 : 0}, ${budget.updatedAt}
      )
      ON CONFLICT(project_id) DO UPDATE SET
        kind = excluded.kind,
        limit_value = excluded.limit_value,
        warn_at_percent = excluded.warn_at_percent,
        enforce = excluded.enforce,
        updated_at = excluded.updated_at
    `;
    },
    Effect.mapError((cause) => databaseError("budget", cause)),
  );

  const getNotificationState: UsageRepository["Service"]["getNotificationState"] = Effect.fn(
    "UsageRepository.getNotificationState",
  )(
    function* (key) {
      const rows = yield* sql<Record<string, unknown>>`
      SELECT notification_key AS "notificationKey",
        last_triggered_at AS "lastTriggeredAt", last_used_percent AS "lastUsedPercent",
        reset_at AS "resetAt"
      FROM usage_notification_state
      WHERE notification_key = ${key}
      LIMIT 1
    `;
      const row = rows[0];
      return row
        ? {
            key: String(row.notificationKey),
            lastTriggeredAt: String(row.lastTriggeredAt),
            lastUsedPercent: nullableNumber(row.lastUsedPercent),
            resetAt: nullableString(row.resetAt),
          }
        : null;
    },
    Effect.mapError((cause) => databaseError("read", cause)),
  );

  const setNotificationState: UsageRepository["Service"]["setNotificationState"] = Effect.fn(
    "UsageRepository.setNotificationState",
  )(
    function* (state) {
      yield* sql`
      INSERT INTO usage_notification_state (
        notification_key, last_triggered_at, last_used_percent, reset_at
      ) VALUES (
        ${state.key}, ${state.lastTriggeredAt}, ${state.lastUsedPercent}, ${state.resetAt}
      )
      ON CONFLICT(notification_key) DO UPDATE SET
        last_triggered_at = excluded.last_triggered_at,
        last_used_percent = excluded.last_used_percent,
        reset_at = excluded.reset_at
    `;
    },
    Effect.mapError((cause) => databaseError("write", cause)),
  );

  const clearHistory = Effect.gen(function* () {
    yield* sql`DELETE FROM usage_requests`;
    yield* sql`DELETE FROM usage_quota_snapshots`;
    yield* sql`DELETE FROM usage_calibrations`;
    yield* sql`DELETE FROM usage_notification_state`;
    yield* sql`DELETE FROM usage_project_budgets`;
    yield* sql`DELETE FROM usage_periods`;
  }).pipe(Effect.mapError((cause) => databaseError("clear", cause)));

  return UsageRepository.of({
    insertRequest,
    insertQuotaSnapshot,
    observeQuotaPeriod,
    confirmManualReset,
    attachLatestQuotaAfter,
    markTurnOutcome,
    insertCalibration,
    listRequests,
    listQuotaSnapshots,
    listCalibrations,
    listProjectBudgets,
    setProjectBudget,
    getNotificationState,
    setNotificationState,
    clearHistory,
  });
});

export const layer = Layer.effect(UsageRepository, make);
