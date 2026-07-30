import {
  type UsageCalibrateInput,
  type UsageCalibrationCheckpoint,
  type UsageDashboard,
  UsageError,
  type UsageExpensiveActivity,
  type UsageExportInput,
  type UsageExportResult,
  type UsageGetDashboardInput,
  type UsageGroup,
  type UsageImportResult,
  type UsageProjectBudget,
  UsageRequestRecord,
  type UsageSeriesPoint,
  type UsageTimeRange,
} from "@t3tools/contracts";
import {
  deriveCalibrationRate,
  estimatePercentFromCalibration,
  forecastUsage,
  resolveUsageMode,
  shouldTriggerUsageNotification,
  USAGE_DAY_MS,
  USAGE_HOUR_MS,
} from "@t3tools/shared/usageForecasting";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { ServerSettingsService } from "../serverSettings.ts";
import { UsageRepository } from "./UsageRepository.ts";

const decodeUsageRequestRecord = Schema.decodeUnknownExit(UsageRequestRecord);

export class UsageService extends Context.Service<
  UsageService,
  {
    readonly getDashboard: (
      input: UsageGetDashboardInput,
    ) => Effect.Effect<UsageDashboard, UsageError>;
    readonly exportHistory: (
      input: UsageExportInput,
    ) => Effect.Effect<UsageExportResult, UsageError>;
    readonly importHistory: (content: string) => Effect.Effect<UsageImportResult, UsageError>;
    readonly calibrate: (input: UsageCalibrateInput) => Effect.Effect<void, UsageError>;
    readonly clearHistory: Effect.Effect<void, UsageError>;
    readonly setProjectBudget: (
      projectId: string,
      budget: UsageProjectBudget | null,
    ) => Effect.Effect<void, UsageError>;
  }
>()("t3/usage/UsageService") {}

function finiteDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function formatRemainingTime(resetAt: string | null, nowMs: number): string {
  const resetMs = finiteDate(resetAt);
  if (resetMs === null || resetMs <= nowMs) return "an unknown amount of time";
  const remainingMs = resetMs - nowMs;
  const days = Math.floor(remainingMs / USAGE_DAY_MS);
  const hours = Math.floor((remainingMs % USAGE_DAY_MS) / USAGE_HOUR_MS);
  return days > 0 ? `${days} days and ${hours} hours` : `${hours} hours`;
}

function rangeStart(range: UsageTimeRange, nowMs: number, periodStartMs: number): number {
  switch (range) {
    case "current-period":
      return periodStartMs;
    case "24-hours":
      return nowMs - USAGE_DAY_MS;
    case "7-days":
      return nowMs - 7 * USAGE_DAY_MS;
    case "30-days":
      return nowMs - 30 * USAGE_DAY_MS;
    case "all":
      return Number.NEGATIVE_INFINITY;
  }
}

function quotaUnits(record: UsageRequestRecord): number {
  return Math.max(0, record.quotaUnits ?? record.totalTokens ?? 1);
}

function groupRecords(
  records: ReadonlyArray<UsageRequestRecord>,
  keyFor: (record: UsageRequestRecord) => { readonly key: string; readonly label: string },
): ReadonlyArray<UsageGroup> {
  const totalUnits = records.reduce((total, record) => total + quotaUnits(record), 0);
  const groups = new Map<string, UsageGroup>();
  for (const record of records) {
    const identity = keyFor(record);
    const current = groups.get(identity.key) ?? {
      key: identity.key,
      label: identity.label,
      requests: 0,
      totalTokens: 0,
      productiveTokens: 0,
      quotaUnits: 0,
      productiveQuotaUnits: 0,
      percentageOfTotal: 0,
      failures: 0,
      retries: 0,
    };
    const units = quotaUnits(record);
    groups.set(identity.key, {
      ...current,
      requests: current.requests + 1,
      totalTokens: current.totalTokens + (record.totalTokens ?? 0),
      productiveTokens:
        current.productiveTokens + (record.productive ? (record.totalTokens ?? 0) : 0),
      quotaUnits: current.quotaUnits + units,
      productiveQuotaUnits: current.productiveQuotaUnits + (record.productive ? units : 0),
      failures: current.failures + (record.succeeded ? 0 : 1),
      retries: current.retries + (record.retryCount > 0 ? 1 : 0),
    });
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      percentageOfTotal: totalUnits > 0 ? (group.quotaUnits / totalUnits) * 100 : 0,
    }))
    .sort((left, right) => right.quotaUnits - left.quotaUnits);
}

function series(
  records: ReadonlyArray<UsageRequestRecord>,
  bucketMs: number,
): ReadonlyArray<UsageSeriesPoint> {
  const buckets = new Map<number, UsageSeriesPoint>();
  for (const record of records) {
    const occurredAt = finiteDate(record.occurredAt);
    if (occurredAt === null) continue;
    const start = Math.floor(occurredAt / bucketMs) * bucketMs;
    const current = buckets.get(start) ?? {
      // @effect-diagnostics-next-line globalDate:off -- deterministic epoch bucket serialization
      startAt: new Date(start).toISOString(),
      requests: 0,
      totalTokens: 0,
      productiveTokens: 0,
      quotaUnits: 0,
      productiveQuotaUnits: 0,
    };
    const units = quotaUnits(record);
    buckets.set(start, {
      ...current,
      requests: current.requests + 1,
      totalTokens: current.totalTokens + (record.totalTokens ?? 0),
      productiveTokens:
        current.productiveTokens + (record.productive ? (record.totalTokens ?? 0) : 0),
      quotaUnits: current.quotaUnits + units,
      productiveQuotaUnits: current.productiveQuotaUnits + (record.productive ? units : 0),
    });
  }
  return [...buckets.values()].sort(
    (left, right) => Date.parse(left.startAt) - Date.parse(right.startAt),
  );
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function recordsToCsv(records: ReadonlyArray<UsageRequestRecord>): string {
  const keys = Object.keys(UsageRequestRecord.fields) as ReadonlyArray<keyof UsageRequestRecord>;
  return [
    keys.map(csvCell).join(","),
    ...records.map((record) => keys.map((key) => csvCell(record[key])).join(",")),
  ].join("\n");
}

function expensiveActivities(input: {
  readonly records: ReadonlyArray<UsageRequestRecord>;
  readonly byConversation: ReadonlyArray<UsageGroup>;
  readonly byProject: ReadonlyArray<UsageGroup>;
  readonly byModel: ReadonlyArray<UsageGroup>;
  readonly byAgent: ReadonlyArray<UsageGroup>;
  readonly retryLoopThreshold: number;
  readonly expensiveRequestPercent: number;
  readonly expensiveRequestTokens: number;
  readonly burnRate: number | null;
  readonly averageRate: number | null;
}): ReadonlyArray<UsageExpensiveActivity> {
  const items: UsageExpensiveActivity[] = [];
  for (const record of input.records) {
    const officialImpact =
      record.officialUsedPercentBefore !== null && record.officialUsedPercentAfter !== null
        ? Math.max(0, record.officialUsedPercentAfter - record.officialUsedPercentBefore)
        : null;
    const expensiveByPercent =
      officialImpact !== null && officialImpact >= input.expensiveRequestPercent;
    const expensiveByTokens =
      record.totalTokens !== null && record.totalTokens >= input.expensiveRequestTokens;
    if (!expensiveByPercent && !expensiveByTokens) continue;
    items.push({
      id: `request:${record.id}`,
      kind: "request",
      title:
        officialImpact !== null
          ? `One request consumed ${officialImpact.toFixed(1)}% of the weekly allowance`
          : `One request used ${record.totalTokens?.toLocaleString() ?? "many"} tokens`,
      detail: `${record.model ?? "Unknown model"} · ${record.projectName ?? "Unknown project"} · ${record.durationMs === null ? "duration unavailable" : `${Math.round(record.durationMs / 1_000)}s`}`,
      severity:
        officialImpact !== null && officialImpact >= input.expensiveRequestPercent * 2
          ? "critical"
          : "warning",
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
      occurredAt: record.occurredAt,
    });
  }
  for (const group of input.byConversation.filter((group) => group.percentageOfTotal >= 8)) {
    items.push({
      id: `conversation:${group.key}`,
      kind: "conversation",
      title: `${group.label} used ${group.percentageOfTotal.toFixed(1)}% of tracked activity`,
      detail: `${group.requests} requests · ${group.totalTokens.toLocaleString()} tokens`,
      severity: group.percentageOfTotal >= 20 ? "critical" : "warning",
      projectId: null,
      conversationId:
        group.key === "unknown" ? null : (group.key as UsageExpensiveActivity["conversationId"]),
      agentId: null,
      occurredAt: null,
    });
  }
  for (const group of input.byConversation.filter(
    (group) => group.retries >= input.retryLoopThreshold,
  )) {
    items.push({
      id: `retry:${group.key}`,
      kind: "retry-loop",
      title: `${group.label} has repeated retry activity`,
      detail: `${group.retries} retried requests and ${group.failures} failures were observed.`,
      severity: "critical",
      projectId: null,
      conversationId:
        group.key === "unknown" ? null : (group.key as UsageExpensiveActivity["conversationId"]),
      agentId: null,
      occurredAt: null,
    });
  }
  for (const group of input.byConversation.filter(
    (group) => group.failures >= input.retryLoopThreshold,
  )) {
    items.push({
      id: `failures:${group.key}`,
      kind: "failures",
      title: `${group.label} is repeatedly failing`,
      detail: `${group.failures} failed requests were observed in the selected range.`,
      severity: "critical",
      projectId: null,
      conversationId:
        group.key === "unknown" ? null : (group.key as UsageExpensiveActivity["conversationId"]),
      agentId: null,
      occurredAt: null,
    });
  }
  for (const group of input.byAgent.filter(
    (group) => group.key !== "primary" && group.retries >= input.retryLoopThreshold,
  )) {
    items.push({
      id: `agent:${group.key}`,
      kind: "agent-loop",
      title: `${group.label} appears to be looping`,
      detail: `${group.retries} retried requests across ${group.requests} attempts.`,
      severity: "critical",
      projectId: null,
      conversationId: null,
      agentId: group.key,
      occurredAt: null,
    });
  }
  for (const record of input.records.filter(
    (record) => record.durationMs !== null && record.durationMs >= 30 * 60_000,
  )) {
    items.push({
      id: `long-running:${record.id}`,
      kind: record.agentId === null ? "request" : "agent-loop",
      title:
        record.agentId === null
          ? "A model request ran for more than 30 minutes"
          : `${record.agentId} ran for more than 30 minutes`,
      detail: `${Math.round((record.durationMs ?? 0) / 60_000)} minutes · ${record.model ?? "Unknown model"}`,
      severity: "warning",
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
      occurredAt: record.occurredAt,
    });
  }
  const topProject = input.byProject[0];
  if (topProject && topProject.percentageOfTotal >= 30) {
    items.push({
      id: `project:${topProject.key}`,
      kind: "project",
      title: `${topProject.label} accounts for ${topProject.percentageOfTotal.toFixed(1)}% of usage`,
      detail: `${topProject.requests} requests in the selected range.`,
      severity: topProject.percentageOfTotal >= 50 ? "critical" : "warning",
      projectId:
        topProject.key === "unknown"
          ? null
          : (topProject.key as UsageExpensiveActivity["projectId"]),
      conversationId: null,
      agentId: null,
      occurredAt: null,
    });
  }
  const topModel = input.byModel[0];
  if (topModel && topModel.percentageOfTotal >= 40) {
    items.push({
      id: `model:${topModel.key}`,
      kind: "model",
      title: `${topModel.label} accounts for ${topModel.percentageOfTotal.toFixed(1)}% of usage`,
      detail: "Consider a lower-usage model for routine work when the provider supports it.",
      severity: "info",
      projectId: null,
      conversationId: null,
      agentId: null,
      occurredAt: null,
    });
  }
  const comparableModels = input.byModel.filter(
    (group) => group.requests >= 2 && group.quotaUnits > 0,
  );
  const leastAverageUnits = Math.min(
    ...comparableModels.map((group) => group.quotaUnits / group.requests),
  );
  for (const model of comparableModels.filter(
    (group) => leastAverageUnits > 0 && group.quotaUnits / group.requests >= leastAverageUnits * 2,
  )) {
    items.push({
      id: `model-cost:${model.key}`,
      kind: "model",
      title: `${model.label} is expensive in local request history`,
      detail: `Its measured quota units per request are ${(model.quotaUnits / model.requests / leastAverageUnits).toFixed(1)}× the least-intensive observed model. This is a local comparison, not provider pricing.`,
      severity: "info",
      projectId: null,
      conversationId: null,
      agentId: null,
      occurredAt: null,
    });
  }
  if (
    input.burnRate !== null &&
    input.averageRate !== null &&
    input.averageRate > 0 &&
    input.burnRate >= input.averageRate * 2
  ) {
    items.push({
      id: "burn-spike",
      kind: "burn-spike",
      title: "Recent burn rate is unusually high",
      detail: `Recent usage is ${(input.burnRate / input.averageRate).toFixed(1)}× the period average.`,
      severity: "warning",
      projectId: null,
      conversationId: null,
      agentId: null,
      occurredAt: null,
    });
  }
  return items.slice(0, 20);
}

export const make = Effect.gen(function* () {
  const repository = yield* UsageRepository;
  const settingsService = yield* ServerSettingsService;

  const getDashboard: UsageService["Service"]["getDashboard"] = Effect.fn(
    "UsageService.getDashboard",
  )(function* (input) {
    const now = yield* DateTime.now;
    const nowIso = DateTime.formatIso(now);
    const nowMs = Date.parse(nowIso);
    const [allRecords, snapshots, calibrations, budgets, serverSettings] = yield* Effect.all([
      repository.listRequests,
      repository.listQuotaSnapshots,
      repository.listCalibrations,
      repository.listProjectBudgets,
      settingsService.getSettings.pipe(
        Effect.mapError((cause) => new UsageError({ operation: "read", message: cause.message })),
      ),
    ]);
    const latestSnapshot = snapshots.toReversed().find((snapshot) => snapshot.usedPercent !== null);
    const latestCalibration = calibrations[calibrations.length - 1] ?? null;
    const resetAt = latestSnapshot?.resetAt ?? latestCalibration?.resetAt ?? null;
    const resetMs = finiteDate(resetAt);
    const durationMs =
      latestSnapshot?.windowDurationMinutes !== null &&
      latestSnapshot?.windowDurationMinutes !== undefined
        ? latestSnapshot.windowDurationMinutes * 60_000
        : 7 * USAGE_DAY_MS;
    const periodStartMs =
      resetMs !== null && resetMs > nowMs ? resetMs - durationMs : nowMs - 7 * USAGE_DAY_MS;
    const range = input.range ?? "current-period";
    const startMs = rangeStart(range, nowMs, periodStartMs);
    const records = allRecords.filter((record) => {
      const at = finiteDate(record.occurredAt);
      return (
        at !== null &&
        at >= startMs &&
        (input.projectId === undefined || record.projectId === input.projectId) &&
        (input.conversationId === undefined || record.conversationId === input.conversationId)
      );
    });
    const periodRecords = allRecords.filter((record) => {
      const at = finiteDate(record.occurredAt);
      return at !== null && at >= periodStartMs;
    });
    const totalPeriodUnits = periodRecords.reduce((total, record) => total + quotaUnits(record), 0);

    let usedPercent = latestSnapshot?.usedPercent ?? null;
    let source = latestSnapshot?.source ?? ("unavailable" as const);
    let confidence = latestSnapshot?.confidence ?? ("unavailable" as const);
    let isExact = latestSnapshot?.isExact ?? false;
    if (usedPercent === null && latestCalibration) {
      const previousCalibration = calibrations[calibrations.length - 2] ?? null;
      const percentPerUnit =
        latestCalibration.totalWeeklyAllowance && latestCalibration.totalWeeklyAllowance > 0
          ? 100 / latestCalibration.totalWeeklyAllowance
          : previousCalibration
            ? deriveCalibrationRate({
                previousPercent: previousCalibration.providerUsedPercent,
                nextPercent: latestCalibration.providerUsedPercent,
                previousQuotaUnits: previousCalibration.localQuotaUnitsAtCheckpoint,
                nextQuotaUnits: latestCalibration.localQuotaUnitsAtCheckpoint,
              })
            : null;
      usedPercent =
        percentPerUnit === null
          ? latestCalibration.providerUsedPercent
          : estimatePercentFromCalibration({
              checkpointPercent: latestCalibration.providerUsedPercent,
              checkpointQuotaUnits: latestCalibration.localQuotaUnitsAtCheckpoint,
              currentQuotaUnits: totalPeriodUnits,
              percentPerQuotaUnit: percentPerUnit,
            });
      source =
        usedPercent === null
          ? "unavailable"
          : percentPerUnit === null
            ? "provider-reported"
            : "estimated";
      confidence =
        usedPercent === null ? "unavailable" : percentPerUnit === null ? "low" : "medium";
      isExact = false;
    }
    const remainingPercent = usedPercent === null ? null : Math.max(0, 100 - usedPercent);
    const periodSnapshots = snapshots.filter((snapshot) => {
      const at = finiteDate(snapshot.observedAt);
      return at !== null && at >= periodStartMs && snapshot.usedPercent !== null;
    });
    const calibrationSamples = calibrations
      .filter((calibration) => finiteDate(calibration.recordedAt)! >= periodStartMs)
      .map((calibration) => ({
        at: calibration.recordedAt,
        usedPercent: calibration.providerUsedPercent,
      }));
    const forecast = forecastUsage({
      samples: [
        ...periodSnapshots.map((snapshot) => ({
          at: snapshot.observedAt,
          usedPercent: snapshot.usedPercent ?? 0,
        })),
        ...calibrationSamples,
      ],
      now: nowIso,
      resetAt,
    });
    const activeMode = resolveUsageMode({
      settings: serverSettings.usage,
      usedPercent,
      now: nowIso,
    });
    const byModel = groupRecords(records, (record) => ({
      key: record.model ?? "unknown",
      label: record.model ?? "Unknown model",
    }));
    const byProject = groupRecords(records, (record) => ({
      key: record.projectId ?? "unknown",
      label: record.projectName ?? "Unknown project",
    }));
    const byConversation = groupRecords(records, (record) => ({
      key: record.conversationId ?? "unknown",
      label: record.conversationName ?? "Unknown conversation",
    }));
    const byAgent = groupRecords(records, (record) => ({
      key: record.agentId ?? "primary",
      label: record.agentId ?? "Primary agent",
    }));
    const byTask = groupRecords(records, (record) => ({
      key: record.taskCategory ?? "uncategorized",
      label: record.taskCategory ?? "Uncategorized",
    }));
    const totalTokens = records.reduce((total, record) => total + (record.totalTokens ?? 0), 0);
    const productiveTokens = records.reduce(
      (total, record) => total + (record.productive ? (record.totalTokens ?? 0) : 0),
      0,
    );
    const totalQuotaUnits = records.reduce((total, record) => total + quotaUnits(record), 0);
    const productiveQuotaUnits = records.reduce(
      (total, record) => total + (record.productive ? quotaUnits(record) : 0),
      0,
    );
    const detectedExpensiveActivities = expensiveActivities({
      records,
      byConversation,
      byProject,
      byModel,
      byAgent,
      retryLoopThreshold: serverSettings.usage.retryLoopThreshold,
      expensiveRequestPercent: serverSettings.usage.expensiveRequestPercent,
      expensiveRequestTokens: serverSettings.usage.expensiveRequestTokens,
      burnRate: forecast.last24HourRate,
      averageRate: forecast.averageDailyRate,
    });
    const notificationCandidates = [
      ...(usedPercent === null
        ? []
        : serverSettings.usage.warningThresholds
            .filter((threshold) => usedPercent >= threshold)
            .map((threshold) => ({
              key: `threshold:${threshold}`,
              title: `${Math.round(usedPercent)}% of weekly usage consumed`,
              message: `You have used ${usedPercent.toFixed(1)}% of your weekly allowance with ${formatRemainingTime(resetAt, nowMs)} remaining.`,
              severity: threshold >= 90 ? ("critical" as const) : ("warning" as const),
            }))),
      ...(forecast.predictedExhaustionAt === null
        ? []
        : [
            {
              key: "forecast:before-reset",
              title: "Usage may run out before reset",
              message: `At the current burn rate, usage is forecast to run out ${forecast.predictedExhaustionAt}.`,
              severity: "critical" as const,
            },
          ]),
      ...(forecast.currentBurnRate !== null &&
      forecast.safeDailyRate !== null &&
      forecast.currentBurnRate > forecast.safeDailyRate
        ? [
            {
              key: "burn-rate:above-safe",
              title: "Burn rate is above the safe pace",
              message: `Current burn rate is ${forecast.currentBurnRate.toFixed(1)}% per day; safe rate is ${forecast.safeDailyRate.toFixed(1)}% per day.`,
              severity: "warning" as const,
            },
          ]
        : []),
      ...detectedExpensiveActivities
        .filter((activity) => activity.kind === "retry-loop" || activity.kind === "request")
        .map((activity) => ({
          key: `activity:${activity.id}`,
          title: activity.title,
          message: activity.detail,
          severity: activity.severity,
        })),
      ...budgets.flatMap((budget) => {
        const project = byProject.find((group) => group.key === budget.projectId);
        if (!project) return [];
        const consumed =
          budget.kind === "weekly-percent"
            ? usedPercent === null
              ? null
              : (usedPercent * project.percentageOfTotal) / 100
            : budget.kind === "tokens"
              ? project.totalTokens
              : budget.kind === "quota-units"
                ? project.quotaUnits
                : project.requests;
        if (consumed === null || budget.limit <= 0) return [];
        const budgetPercent = (consumed / budget.limit) * 100;
        return budgetPercent < budget.warnAtPercent
          ? []
          : [
              {
                key: `project-budget:${budget.projectId}`,
                title: `${project.label} is approaching its usage budget`,
                message: `${budgetPercent.toFixed(1)}% of the configured ${budget.kind} budget has been consumed.`,
                severity: budgetPercent >= 100 ? ("critical" as const) : ("warning" as const),
              },
            ];
      }),
    ];
    const pendingNotifications = serverSettings.usage.notificationsEnabled
      ? yield* Effect.filter(notificationCandidates, (candidate) =>
          Effect.gen(function* () {
            const state = yield* repository.getNotificationState(candidate.key);
            const shouldTrigger = shouldTriggerUsageNotification({
              now: nowIso,
              lastTriggeredAt: state?.lastTriggeredAt ?? null,
              cooldownMinutes: serverSettings.usage.notificationCooldownMinutes,
              recoveredSinceLastTrigger:
                state?.lastUsedPercent !== null &&
                state?.lastUsedPercent !== undefined &&
                usedPercent !== null &&
                usedPercent < state.lastUsedPercent - 5,
              resetOccurred:
                state?.resetAt !== null &&
                state?.resetAt !== undefined &&
                resetAt !== null &&
                state.resetAt !== resetAt,
            });
            if (shouldTrigger) {
              yield* repository.setNotificationState({
                key: candidate.key,
                lastTriggeredAt: nowIso,
                lastUsedPercent: usedPercent,
                resetAt,
              });
            }
            return shouldTrigger;
          }),
        )
      : [];

    return {
      generatedAt: nowIso,
      range,
      period: {
        // @effect-diagnostics-next-line globalDateInEffect:off -- periodStartMs derives from Effect DateTime.now
        startedAt: new Date(periodStartMs).toISOString(),
        resetAt,
        source,
      },
      summary: {
        usedPercent,
        remainingPercent,
        resetAt,
        source,
        confidence,
        isExact,
        activeMode,
        requests: records.length,
        successfulRequests: records.filter((record) => record.succeeded).length,
        failedRequests: records.filter((record) => !record.succeeded).length,
        retryRequests: records.filter((record) => record.retryCount > 0).length,
        totalTokens,
        productiveTokens,
        totalQuotaUnits,
        productiveQuotaUnits,
        missingData:
          usedPercent === null ||
          records.some(
            (record) => record.source === "estimated" || record.source === "unavailable",
          ),
      },
      forecast,
      byModel,
      byProject,
      byConversation,
      byAgent,
      byTask,
      daily: series(records, USAGE_DAY_MS),
      hourly: series(
        records.filter((record) => Date.parse(record.occurredAt) >= nowMs - USAGE_DAY_MS),
        USAGE_HOUR_MS,
      ),
      expensiveActivities: detectedExpensiveActivities,
      pendingNotifications,
      recentRecords: records.toReversed().slice(0, 100),
      latestCalibration,
      projectBudgets: budgets,
    } satisfies UsageDashboard;
  });

  const exportHistory: UsageService["Service"]["exportHistory"] = Effect.fn(
    "UsageService.exportHistory",
  )(
    function* (input) {
      const now = DateTime.formatIso(yield* DateTime.now);
      const nowMs = Date.parse(now);
      const [allRecords, snapshots] = yield* Effect.all([
        repository.listRequests,
        repository.listQuotaSnapshots,
      ]);
      const latestSnapshot = snapshots
        .toReversed()
        .find((snapshot) => snapshot.usedPercent !== null);
      const resetMs = finiteDate(latestSnapshot?.resetAt);
      const durationMs = (latestSnapshot?.windowDurationMinutes ?? 7 * 24 * 60) * 60_000;
      const periodStartMs =
        resetMs !== null && resetMs > nowMs ? resetMs - durationMs : nowMs - 7 * USAGE_DAY_MS;
      const startMs = rangeStart(input.range ?? "all", nowMs, periodStartMs);
      const records = allRecords.filter(
        (record) => (finiteDate(record.occurredAt) ?? Number.NEGATIVE_INFINITY) >= startMs,
      );
      const stamp = now.slice(0, 10);
      return input.format === "csv"
        ? {
            filename: `t3-usage-${stamp}.csv`,
            mimeType: "text/csv",
            content: recordsToCsv(records),
          }
        : {
            filename: `t3-usage-${stamp}.json`,
            mimeType: "application/json",
            // @effect-diagnostics-next-line preferSchemaOverJson:off -- portable backup envelope is validated record-by-record on import
            content: JSON.stringify({ version: 1, exportedAt: now, records }, null, 2),
          };
    },
    Effect.mapError(
      (cause) =>
        new UsageError({
          operation: "export",
          message: String(cause),
        }),
    ),
  );

  const importHistory: UsageService["Service"]["importHistory"] = Effect.fn(
    "UsageService.importHistory",
  )(function* (content) {
    const parsed: unknown = yield* Effect.try({
      try: () => {
        // @effect-diagnostics-next-line preferSchemaOverJson:off -- untrusted import is decoded below with UsageRequestRecord
        return JSON.parse(content) as unknown;
      },
      catch: () =>
        new UsageError({
          operation: "import",
          message: "The selected file is not valid JSON.",
        }),
    });
    const candidates = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && "records" in parsed
        ? (parsed as { records?: unknown }).records
        : null;
    if (!Array.isArray(candidates)) {
      return yield* new UsageError({
        operation: "import",
        message: "The backup does not contain a records array.",
      });
    }
    let inserted = 0;
    let duplicates = 0;
    let invalid = 0;
    for (const candidate of candidates) {
      const decoded = decodeUsageRequestRecord(candidate);
      if (decoded._tag === "Failure") {
        invalid += 1;
        continue;
      }
      if (yield* repository.insertRequest(decoded.value)) inserted += 1;
      else duplicates += 1;
    }
    return { inserted, duplicates, invalid };
  });

  const calibrate: UsageService["Service"]["calibrate"] = Effect.fn("UsageService.calibrate")(
    function* (input) {
      const now = DateTime.formatIso(yield* DateTime.now);
      const records = yield* repository.listRequests;
      const localQuotaUnitsAtCheckpoint = records.reduce(
        (total, record) => total + quotaUnits(record),
        0,
      );
      const calibration: UsageCalibrationCheckpoint = {
        id: `calibration:${input.provider}:${input.providerInstanceId ?? "default"}:${now}`,
        provider: input.provider,
        providerInstanceId: input.providerInstanceId ?? null,
        recordedAt: now,
        providerUsedPercent: Math.max(0, Math.min(100, input.usedPercent)),
        resetAt: input.resetAt,
        totalWeeklyAllowance: input.totalWeeklyAllowance ?? null,
        localQuotaUnitsAtCheckpoint,
      };
      if (input.confirmReset === true) {
        yield* repository.confirmManualReset(now, input.resetAt);
      }
      yield* repository.insertCalibration(calibration);
    },
  );

  return UsageService.of({
    getDashboard,
    exportHistory,
    importHistory,
    calibrate,
    clearHistory: repository.clearHistory,
    setProjectBudget: repository.setProjectBudget,
  });
});

export const layer = Layer.effect(UsageService, make);
