import type {
  ProviderRuntimeEvent,
  UsageQuotaSnapshot,
  UsageRequestRecord,
} from "@t3tools/contracts";
import { estimateTextTokens } from "@t3tools/shared/usageData";

type UsageRecordTokens = Pick<
  UsageRequestRecord,
  | "inputTokens"
  | "cachedInputTokens"
  | "outputTokens"
  | "reasoningTokens"
  | "totalTokens"
  | "durationMs"
  | "quotaUnits"
  | "source"
  | "confidence"
>;

export interface ProviderUsageAdapter {
  readonly capabilities: {
    readonly officialQuota: boolean;
    readonly resetInformation: boolean;
    readonly requestTokens: boolean;
    readonly localTokenEstimate: boolean;
    readonly quotaUnitConversion: boolean;
  };
  readonly estimateInputTokens: (text: string) => number;
  readonly quotaUnitsForTokens: (input: {
    readonly model: string | null;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly reasoningTokens: number;
  }) => number | null;
  readonly normalizeTokenUsage: (
    event: Extract<ProviderRuntimeEvent, { type: "thread.token-usage.updated" }>,
  ) => UsageRecordTokens | null;
  readonly normalizeQuota: (
    event: Extract<ProviderRuntimeEvent, { type: "account.rate-limits.updated" }>,
  ) => UsageQuotaSnapshot | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function epochSecondsToIso(value: unknown): string | null {
  const seconds = finiteNumber(value);
  if (seconds === null || seconds <= 0) return null;
  // @effect-diagnostics-next-line globalDate:off -- provider epochs are converted at this pure adapter boundary
  const date = new Date(seconds * 1_000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function tokenUsage(
  event: Extract<ProviderRuntimeEvent, { type: "thread.token-usage.updated" }>,
): UsageRecordTokens | null {
  const usage = event.payload.usage;
  const inputTokens = usage.lastInputTokens ?? usage.inputTokens ?? null;
  const cachedInputTokens = usage.lastCachedInputTokens ?? usage.cachedInputTokens ?? null;
  const outputTokens = usage.lastOutputTokens ?? usage.outputTokens ?? null;
  const reasoningTokens = usage.lastReasoningOutputTokens ?? usage.reasoningOutputTokens ?? null;
  const componentTotal = (inputTokens ?? 0) + (outputTokens ?? 0) + (reasoningTokens ?? 0);
  const totalTokens =
    usage.lastUsedTokens ?? (componentTotal > 0 ? componentTotal : usage.usedTokens);
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return null;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    durationMs: usage.durationMs ?? null,
    quotaUnits: totalTokens,
    source: "provider-reported",
    confidence: "high",
  };
}

function unsupportedQuota(
  _event: Extract<ProviderRuntimeEvent, { type: "account.rate-limits.updated" }>,
): null {
  return null;
}

export function normalizeCodexRateLimits(
  event: Extract<ProviderRuntimeEvent, { type: "account.rate-limits.updated" }>,
): UsageQuotaSnapshot | null {
  const outer = asRecord(event.payload.rateLimits);
  const nested = asRecord(outer?.rateLimits);
  const byLimitId = asRecord(outer?.rateLimitsByLimitId);
  const snapshots = [
    nested && ("primary" in nested || "secondary" in nested) ? nested : (outer ?? null),
    ...Object.values(byLimitId ?? {}).map(asRecord),
  ].filter((snapshot): snapshot is Record<string, unknown> => snapshot !== null);
  const windows = snapshots.flatMap((snapshot) =>
    [asRecord(snapshot.primary), asRecord(snapshot.secondary)].filter(
      (window): window is Record<string, unknown> => window !== null,
    ),
  );
  const selected = windows
    .filter(
      (window) =>
        finiteNumber(window.usedPercent) !== null &&
        (finiteNumber(window.windowDurationMins) ?? 0) >= 6 * 24 * 60,
    )
    .sort(
      (left, right) =>
        (finiteNumber(right.windowDurationMins) ?? 0) -
        (finiteNumber(left.windowDurationMins) ?? 0),
    )[0];
  if (!selected) return null;
  const usedPercent = finiteNumber(selected.usedPercent);
  if (usedPercent === null) return null;
  const duration = finiteNumber(selected.windowDurationMins);
  return {
    id: `quota:${event.eventId}`,
    observedAt: event.createdAt,
    provider: event.provider,
    providerInstanceId: event.providerInstanceId ?? null,
    usedPercent,
    remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
    resetAt: epochSecondsToIso(selected.resetsAt),
    windowDurationMinutes: duration === null ? null : Math.max(0, Math.round(duration)),
    source: "exact",
    confidence: "exact",
    isExact: true,
    rawKind: "codex-account-rate-limit",
  };
}

const CODEX_ADAPTER: ProviderUsageAdapter = {
  capabilities: {
    officialQuota: true,
    resetInformation: true,
    requestTokens: true,
    localTokenEstimate: true,
    quotaUnitConversion: false,
  },
  estimateInputTokens: estimateTextTokens,
  quotaUnitsForTokens: () => null,
  normalizeTokenUsage: tokenUsage,
  normalizeQuota: normalizeCodexRateLimits,
};
const CLAUDE_ADAPTER: ProviderUsageAdapter = {
  capabilities: {
    officialQuota: false,
    resetInformation: false,
    requestTokens: true,
    localTokenEstimate: true,
    quotaUnitConversion: false,
  },
  estimateInputTokens: estimateTextTokens,
  quotaUnitsForTokens: () => null,
  normalizeTokenUsage: tokenUsage,
  normalizeQuota: unsupportedQuota,
};
const CURSOR_ADAPTER: ProviderUsageAdapter = {
  capabilities: {
    officialQuota: false,
    resetInformation: false,
    requestTokens: false,
    localTokenEstimate: true,
    quotaUnitConversion: false,
  },
  estimateInputTokens: estimateTextTokens,
  quotaUnitsForTokens: () => null,
  normalizeTokenUsage: tokenUsage,
  normalizeQuota: unsupportedQuota,
};
const GROK_ADAPTER: ProviderUsageAdapter = {
  capabilities: {
    officialQuota: false,
    resetInformation: false,
    requestTokens: false,
    localTokenEstimate: true,
    quotaUnitConversion: false,
  },
  estimateInputTokens: estimateTextTokens,
  quotaUnitsForTokens: () => null,
  normalizeTokenUsage: tokenUsage,
  normalizeQuota: unsupportedQuota,
};
const OPENCODE_ADAPTER: ProviderUsageAdapter = {
  capabilities: {
    officialQuota: false,
    resetInformation: false,
    requestTokens: false,
    localTokenEstimate: true,
    quotaUnitConversion: false,
  },
  estimateInputTokens: estimateTextTokens,
  quotaUnitsForTokens: () => null,
  normalizeTokenUsage: tokenUsage,
  normalizeQuota: unsupportedQuota,
};

const ADAPTERS: Readonly<Record<string, ProviderUsageAdapter>> = {
  codex: CODEX_ADAPTER,
  claudeAgent: CLAUDE_ADAPTER,
  cursor: CURSOR_ADAPTER,
  grok: GROK_ADAPTER,
  opencode: OPENCODE_ADAPTER,
};

export function getProviderUsageAdapter(
  provider: ProviderRuntimeEvent["provider"],
): ProviderUsageAdapter {
  return (
    ADAPTERS[provider] ?? {
      capabilities: {
        officialQuota: false,
        resetInformation: false,
        requestTokens: false,
        localTokenEstimate: true,
        quotaUnitConversion: false,
      },
      estimateInputTokens: estimateTextTokens,
      quotaUnitsForTokens: () => null,
      normalizeTokenUsage: tokenUsage,
      normalizeQuota: unsupportedQuota,
    }
  );
}
