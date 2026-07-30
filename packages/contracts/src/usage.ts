import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ProjectId, ThreadId, TurnId } from "./baseSchemas.ts";
import { ProviderInstanceId, ProviderDriverKind } from "./providerInstance.ts";

export const UsageValueSource = Schema.Literals([
  "exact",
  "provider-reported",
  "locally-calculated",
  "estimated",
  "unavailable",
]);
export type UsageValueSource = typeof UsageValueSource.Type;

export const UsageConfidence = Schema.Literals(["exact", "high", "medium", "low", "unavailable"]);
export type UsageConfidence = typeof UsageConfidence.Type;

export const UsageMode = Schema.Literals(["normal", "conserve", "emergency", "unrestricted"]);
export type UsageMode = typeof UsageMode.Type;

export const UsageTimeRange = Schema.Literals([
  "current-period",
  "24-hours",
  "7-days",
  "30-days",
  "all",
]);
export type UsageTimeRange = typeof UsageTimeRange.Type;

const NullableString = Schema.NullOr(Schema.String);
const NullableNumber = Schema.NullOr(Schema.Number);
const NullableInt = Schema.NullOr(NonNegativeInt);
const NullableIsoDateTime = Schema.NullOr(IsoDateTime);

/**
 * Metadata-only record for one observed model request or, when a provider
 * exposes no request boundary, one turn-level fallback estimate.
 *
 * Prompt and response content are deliberately absent.
 */
export const UsageRequestRecord = Schema.Struct({
  id: Schema.String,
  occurredAt: IsoDateTime,
  provider: ProviderDriverKind,
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  model: NullableString,
  projectId: Schema.NullOr(ProjectId),
  projectName: NullableString,
  conversationId: Schema.NullOr(ThreadId),
  conversationName: NullableString,
  turnId: Schema.NullOr(TurnId),
  agentId: NullableString,
  taskCategory: NullableString,
  inputTokens: NullableInt,
  cachedInputTokens: NullableInt,
  outputTokens: NullableInt,
  reasoningTokens: NullableInt,
  totalTokens: NullableInt,
  durationMs: NullableInt,
  succeeded: Schema.Boolean,
  retryCount: NonNegativeInt,
  cancelled: Schema.Boolean,
  productive: Schema.Boolean,
  quotaUnits: NullableNumber,
  officialUsedPercentBefore: NullableNumber,
  officialUsedPercentAfter: NullableNumber,
  resetAt: NullableIsoDateTime,
  source: UsageValueSource,
  confidence: UsageConfidence,
  createdAt: IsoDateTime,
});
export type UsageRequestRecord = typeof UsageRequestRecord.Type;

export const UsageQuotaSnapshot = Schema.Struct({
  id: Schema.String,
  observedAt: IsoDateTime,
  provider: ProviderDriverKind,
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  usedPercent: NullableNumber,
  remainingPercent: NullableNumber,
  resetAt: NullableIsoDateTime,
  windowDurationMinutes: NullableInt,
  source: UsageValueSource,
  confidence: UsageConfidence,
  isExact: Schema.Boolean,
  rawKind: NullableString,
});
export type UsageQuotaSnapshot = typeof UsageQuotaSnapshot.Type;

export const UsageCalibrationCheckpoint = Schema.Struct({
  id: Schema.String,
  provider: ProviderDriverKind,
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  recordedAt: IsoDateTime,
  providerUsedPercent: Schema.Number,
  resetAt: IsoDateTime,
  totalWeeklyAllowance: NullableNumber,
  localQuotaUnitsAtCheckpoint: Schema.Number,
});
export type UsageCalibrationCheckpoint = typeof UsageCalibrationCheckpoint.Type;

export const UsageProjectBudgetKind = Schema.Literals([
  "weekly-percent",
  "tokens",
  "quota-units",
  "requests",
]);
export type UsageProjectBudgetKind = typeof UsageProjectBudgetKind.Type;

export const UsageProjectBudget = Schema.Struct({
  projectId: ProjectId,
  kind: UsageProjectBudgetKind,
  limit: Schema.Number,
  warnAtPercent: Schema.Number,
  enforce: Schema.Boolean,
  updatedAt: IsoDateTime,
});
export type UsageProjectBudget = typeof UsageProjectBudget.Type;

export const UsageQuietHours = Schema.Struct({
  enabled: Schema.Boolean,
  startHour: Schema.Number,
  endHour: Schema.Number,
});
export type UsageQuietHours = typeof UsageQuietHours.Type;

export const UsageSettings = Schema.Struct({
  notificationsEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  desktopNotificationsEnabled: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  warningThresholds: Schema.Array(Schema.Number).pipe(
    Schema.withDecodingDefault(Effect.succeed([50, 70, 80, 90, 95])),
  ),
  expensiveRequestPercent: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(2))),
  expensiveRequestTokens: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(100_000))),
  retryLoopThreshold: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(5))),
  notificationCooldownMinutes: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(360))),
  quietHours: UsageQuietHours.pipe(
    Schema.withDecodingDefault(Effect.succeed({ enabled: false, startHour: 22, endHour: 8 })),
  ),
  selectedMode: UsageMode.pipe(Schema.withDecodingDefault(Effect.succeed("normal"))),
  automaticModeTransitions: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  conserveAtPercent: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(70))),
  emergencyAtPercent: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(90))),
  requestPreviewEnabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  requestPreviewTokenThreshold: NonNegativeInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(50_000)),
  ),
  statusWidgetVisible: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  unrestrictedUntil: NullableIsoDateTime.pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type UsageSettings = typeof UsageSettings.Type;

export const DEFAULT_USAGE_SETTINGS: UsageSettings = Schema.decodeSync(UsageSettings)({});

export const UsageSettingsPatch = Schema.Struct({
  notificationsEnabled: Schema.optionalKey(Schema.Boolean),
  desktopNotificationsEnabled: Schema.optionalKey(Schema.Boolean),
  warningThresholds: Schema.optionalKey(Schema.Array(Schema.Number)),
  expensiveRequestPercent: Schema.optionalKey(Schema.Number),
  expensiveRequestTokens: Schema.optionalKey(NonNegativeInt),
  retryLoopThreshold: Schema.optionalKey(NonNegativeInt),
  notificationCooldownMinutes: Schema.optionalKey(NonNegativeInt),
  quietHours: Schema.optionalKey(UsageQuietHours),
  selectedMode: Schema.optionalKey(UsageMode),
  automaticModeTransitions: Schema.optionalKey(Schema.Boolean),
  conserveAtPercent: Schema.optionalKey(Schema.Number),
  emergencyAtPercent: Schema.optionalKey(Schema.Number),
  requestPreviewEnabled: Schema.optionalKey(Schema.Boolean),
  requestPreviewTokenThreshold: Schema.optionalKey(NonNegativeInt),
  statusWidgetVisible: Schema.optionalKey(Schema.Boolean),
  unrestrictedUntil: Schema.optionalKey(NullableIsoDateTime),
});
export type UsageSettingsPatch = typeof UsageSettingsPatch.Type;

export const UsagePeriod = Schema.Struct({
  startedAt: IsoDateTime,
  resetAt: NullableIsoDateTime,
  source: UsageValueSource,
});
export type UsagePeriod = typeof UsagePeriod.Type;

export const UsageForecast = Schema.Struct({
  predictedExhaustionAt: NullableIsoDateTime,
  predictedRemainingAtReset: NullableNumber,
  safeDailyRate: NullableNumber,
  safeRemainingToday: NullableNumber,
  currentBurnRate: NullableNumber,
  averageDailyRate: NullableNumber,
  last24HourRate: NullableNumber,
  last3DayRate: NullableNumber,
  confidence: UsageConfidence,
  sampleSize: NonNegativeInt,
  method: Schema.String,
  reason: Schema.String,
  onTrackToReset: Schema.NullOr(Schema.Boolean),
});
export type UsageForecast = typeof UsageForecast.Type;

export const UsageGroup = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  requests: NonNegativeInt,
  totalTokens: NonNegativeInt,
  productiveTokens: NonNegativeInt,
  quotaUnits: Schema.Number,
  productiveQuotaUnits: Schema.Number,
  percentageOfTotal: Schema.Number,
  failures: NonNegativeInt,
  retries: NonNegativeInt,
});
export type UsageGroup = typeof UsageGroup.Type;

export const UsageSeriesPoint = Schema.Struct({
  startAt: IsoDateTime,
  requests: NonNegativeInt,
  totalTokens: NonNegativeInt,
  productiveTokens: NonNegativeInt,
  quotaUnits: Schema.Number,
  productiveQuotaUnits: Schema.Number,
});
export type UsageSeriesPoint = typeof UsageSeriesPoint.Type;

export const UsageExpensiveActivity = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals([
    "conversation",
    "request",
    "retry-loop",
    "failures",
    "agent-loop",
    "model",
    "project",
    "burn-spike",
  ]),
  title: Schema.String,
  detail: Schema.String,
  severity: Schema.Literals(["info", "warning", "critical"]),
  projectId: Schema.NullOr(ProjectId),
  conversationId: Schema.NullOr(ThreadId),
  agentId: NullableString,
  occurredAt: NullableIsoDateTime,
});
export type UsageExpensiveActivity = typeof UsageExpensiveActivity.Type;

export const UsageNotification = Schema.Struct({
  key: Schema.String,
  title: Schema.String,
  message: Schema.String,
  severity: Schema.Literals(["info", "warning", "critical"]),
});
export type UsageNotification = typeof UsageNotification.Type;

export const UsageSummary = Schema.Struct({
  usedPercent: NullableNumber,
  remainingPercent: NullableNumber,
  resetAt: NullableIsoDateTime,
  source: UsageValueSource,
  confidence: UsageConfidence,
  isExact: Schema.Boolean,
  activeMode: UsageMode,
  requests: NonNegativeInt,
  successfulRequests: NonNegativeInt,
  failedRequests: NonNegativeInt,
  retryRequests: NonNegativeInt,
  totalTokens: NonNegativeInt,
  productiveTokens: NonNegativeInt,
  totalQuotaUnits: Schema.Number,
  productiveQuotaUnits: Schema.Number,
  missingData: Schema.Boolean,
});
export type UsageSummary = typeof UsageSummary.Type;

export const UsageDashboard = Schema.Struct({
  generatedAt: IsoDateTime,
  range: UsageTimeRange,
  period: UsagePeriod,
  summary: UsageSummary,
  forecast: UsageForecast,
  byModel: Schema.Array(UsageGroup),
  byProject: Schema.Array(UsageGroup),
  byConversation: Schema.Array(UsageGroup),
  byAgent: Schema.Array(UsageGroup),
  byTask: Schema.Array(UsageGroup),
  daily: Schema.Array(UsageSeriesPoint),
  hourly: Schema.Array(UsageSeriesPoint),
  expensiveActivities: Schema.Array(UsageExpensiveActivity),
  pendingNotifications: Schema.Array(UsageNotification),
  recentRecords: Schema.Array(UsageRequestRecord),
  latestCalibration: Schema.NullOr(UsageCalibrationCheckpoint),
  projectBudgets: Schema.Array(UsageProjectBudget),
});
export type UsageDashboard = typeof UsageDashboard.Type;

export const UsageGetDashboardInput = Schema.Struct({
  range: Schema.optionalKey(UsageTimeRange),
  projectId: Schema.optionalKey(ProjectId),
  conversationId: Schema.optionalKey(ThreadId),
});
export type UsageGetDashboardInput = typeof UsageGetDashboardInput.Type;

export const UsageExportInput = Schema.Struct({
  format: Schema.Literals(["json", "csv"]),
  range: Schema.optionalKey(UsageTimeRange),
});
export type UsageExportInput = typeof UsageExportInput.Type;

export const UsageExportResult = Schema.Struct({
  filename: Schema.String,
  mimeType: Schema.String,
  content: Schema.String,
});
export type UsageExportResult = typeof UsageExportResult.Type;

export const UsageImportInput = Schema.Struct({ content: Schema.String });
export type UsageImportInput = typeof UsageImportInput.Type;

export const UsageImportResult = Schema.Struct({
  inserted: NonNegativeInt,
  duplicates: NonNegativeInt,
  invalid: NonNegativeInt,
});
export type UsageImportResult = typeof UsageImportResult.Type;

export const UsageCalibrateInput = Schema.Struct({
  provider: ProviderDriverKind,
  providerInstanceId: Schema.optionalKey(ProviderInstanceId),
  usedPercent: Schema.Number,
  resetAt: IsoDateTime,
  totalWeeklyAllowance: Schema.optionalKey(Schema.Number),
  confirmReset: Schema.optionalKey(Schema.Boolean),
});
export type UsageCalibrateInput = typeof UsageCalibrateInput.Type;

export const UsageSetProjectBudgetInput = Schema.Struct({
  budget: Schema.NullOr(
    Schema.Struct({
      projectId: ProjectId,
      kind: UsageProjectBudgetKind,
      limit: Schema.Number,
      warnAtPercent: Schema.Number,
      enforce: Schema.Boolean,
    }),
  ),
  projectId: ProjectId,
});
export type UsageSetProjectBudgetInput = typeof UsageSetProjectBudgetInput.Type;

export const UsageClearInput = Schema.Struct({
  confirmation: Schema.Literal("clear-usage-history"),
});
export type UsageClearInput = typeof UsageClearInput.Type;

export const UsageMutationResult = Schema.Struct({ ok: Schema.Boolean });
export type UsageMutationResult = typeof UsageMutationResult.Type;

export const UsageErrorOperation = Schema.Literals([
  "read",
  "write",
  "import",
  "export",
  "clear",
  "calibrate",
  "budget",
]);
export class UsageError extends Schema.TaggedErrorClass<UsageError>()("UsageError", {
  operation: UsageErrorOperation,
  message: Schema.String,
}) {}
