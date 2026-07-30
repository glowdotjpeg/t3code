import type { UsageConfidence, UsageForecast, UsageMode, UsageSettings } from "@t3tools/contracts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;

export interface UsagePercentSample {
  readonly at: string;
  readonly usedPercent: number;
}

function finiteDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function rateBetween(left: UsagePercentSample, right: UsagePercentSample): number | null {
  const leftAt = finiteDateMs(left.at);
  const rightAt = finiteDateMs(right.at);
  if (leftAt === null || rightAt === null || rightAt <= leftAt) return null;
  const delta = right.usedPercent - left.usedPercent;
  if (!Number.isFinite(delta) || delta < 0) return null;
  return delta / ((rightAt - leftAt) / DAY_MS);
}

function rateOverWindow(
  samples: ReadonlyArray<UsagePercentSample>,
  nowMs: number,
  windowMs: number,
): number | null {
  const inWindow = samples.filter((sample) => {
    const at = finiteDateMs(sample.at);
    return at !== null && at >= nowMs - windowMs && at <= nowMs;
  });
  if (inWindow.length < 2) return null;
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  return first && last ? rateBetween(first, last) : null;
}

function weightedRecentRate(samples: ReadonlyArray<UsagePercentSample>): number | null {
  const intervalRates: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const left = samples[index - 1];
    const right = samples[index];
    if (!left || !right) continue;
    const rate = rateBetween(left, right);
    if (rate !== null && rate > 0) intervalRates.push(rate);
  }
  if (intervalRates.length === 0) return null;

  const sorted = [...intervalRates].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const spikeCap = median > 0 ? median * 3 : Math.max(...intervalRates);
  let weightedTotal = 0;
  let totalWeight = 0;
  intervalRates.forEach((rate, index) => {
    const weight = index + 1;
    weightedTotal += Math.min(rate, spikeCap) * weight;
    totalWeight += weight;
  });
  return totalWeight > 0 ? weightedTotal / totalWeight : null;
}

function linearTrendRate(samples: ReadonlyArray<UsagePercentSample>): number | null {
  if (samples.length < 3) return null;
  const firstAt = finiteDateMs(samples[0]?.at);
  if (firstAt === null) return null;
  const points = samples.flatMap((sample) => {
    const at = finiteDateMs(sample.at);
    return at === null ? [] : [{ x: (at - firstAt) / DAY_MS, y: sample.usedPercent }];
  });
  if (points.length < 3) return null;
  const meanX = points.reduce((total, point) => total + point.x, 0) / points.length;
  const meanY = points.reduce((total, point) => total + point.y, 0) / points.length;
  const denominator = points.reduce((total, point) => total + (point.x - meanX) ** 2, 0);
  if (denominator <= 0) return null;
  const numerator = points.reduce(
    (total, point) => total + (point.x - meanX) * (point.y - meanY),
    0,
  );
  const slope = numerator / denominator;
  return Number.isFinite(slope) ? Math.max(0, slope) : null;
}

function confidenceForSamples(samples: ReadonlyArray<UsagePercentSample>): UsageConfidence {
  if (samples.length < 3) return "unavailable";
  const firstAt = finiteDateMs(samples[0]?.at);
  const lastAt = finiteDateMs(samples[samples.length - 1]?.at);
  if (firstAt === null || lastAt === null) return "unavailable";
  const span = lastAt - firstAt;
  if (samples.length >= 8 && span >= 2 * DAY_MS) return "high";
  if (samples.length >= 5 && span >= DAY_MS) return "medium";
  return "low";
}

export function forecastUsage(input: {
  readonly samples: ReadonlyArray<UsagePercentSample>;
  readonly now: string;
  readonly resetAt: string | null;
}): UsageForecast {
  const nowMs = finiteDateMs(input.now);
  const resetMs = finiteDateMs(input.resetAt);
  const samples = input.samples
    .filter(
      (sample) =>
        finiteDateMs(sample.at) !== null &&
        Number.isFinite(sample.usedPercent) &&
        sample.usedPercent >= 0,
    )
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const latest = samples[samples.length - 1];
  const confidence = confidenceForSamples(samples);

  if (
    nowMs === null ||
    resetMs === null ||
    resetMs <= nowMs ||
    !latest ||
    confidence === "unavailable"
  ) {
    return {
      predictedExhaustionAt: null,
      predictedRemainingAtReset: null,
      safeDailyRate:
        nowMs !== null && resetMs !== null && resetMs > nowMs && latest
          ? Math.max(0, 100 - latest.usedPercent) / ((resetMs - nowMs) / DAY_MS)
          : null,
      safeRemainingToday: null,
      currentBurnRate: null,
      averageDailyRate: null,
      last24HourRate: null,
      last3DayRate: null,
      confidence: "unavailable",
      sampleSize: samples.length,
      method: "insufficient-data",
      reason: "At least three valid usage samples over time are required.",
      onTrackToReset: null,
    };
  }

  const first = samples[0]!;
  const averageDailyRate = rateBetween(first, latest);
  const last24HourRate = rateOverWindow(samples, nowMs, DAY_MS);
  const last3DayRate = rateOverWindow(samples, nowMs, 3 * DAY_MS);
  const recentRate = weightedRecentRate(samples);
  const trendRate = linearTrendRate(samples);
  const candidateRates = [
    recentRate === null ? null : { value: recentRate, weight: 0.4 },
    last24HourRate === null ? null : { value: last24HourRate, weight: 0.25 },
    last3DayRate === null ? null : { value: last3DayRate, weight: 0.2 },
    trendRate === null ? null : { value: trendRate, weight: 0.15 },
  ].filter((candidate): candidate is { value: number; weight: number } => candidate !== null);
  const weight = candidateRates.reduce((total, candidate) => total + candidate.weight, 0);
  const currentBurnRate =
    weight > 0
      ? candidateRates.reduce((total, candidate) => total + candidate.value * candidate.weight, 0) /
        weight
      : averageDailyRate;
  const remainingPercent = clamp(100 - latest.usedPercent, 0, 100);
  const fractionalDaysRemaining = (resetMs - nowMs) / DAY_MS;
  const safeDailyRate =
    fractionalDaysRemaining > 0 ? remainingPercent / fractionalDaysRemaining : null;
  // Native Date is intentional: "rest of today" follows the host's local
  // calendar day, while stored timestamps remain ISO UTC.
  // @effect-diagnostics-next-line globalDate:off
  const nextMidnight = new Date(nowMs);
  nextMidnight.setHours(24, 0, 0, 0);
  const remainingDayFraction = Math.min(
    fractionalDaysRemaining,
    Math.max(0, (nextMidnight.getTime() - nowMs) / DAY_MS),
  );
  const safeRemainingToday = safeDailyRate === null ? null : safeDailyRate * remainingDayFraction;

  if (currentBurnRate === null || currentBurnRate <= 0) {
    return {
      predictedExhaustionAt: null,
      predictedRemainingAtReset: remainingPercent,
      safeDailyRate,
      safeRemainingToday,
      currentBurnRate: 0,
      averageDailyRate,
      last24HourRate,
      last3DayRate,
      confidence,
      sampleSize: samples.length,
      method: "weighted-recent-average",
      reason: "Usage is currently flat; no exhaustion date is predicted.",
      onTrackToReset: true,
    };
  }

  const daysToExhaustion = remainingPercent / currentBurnRate;
  const exhaustionMs = nowMs + daysToExhaustion * DAY_MS;
  const predictedRemainingAtReset = clamp(
    remainingPercent - currentBurnRate * fractionalDaysRemaining,
    0,
    100,
  );
  const exhaustsBeforeReset = exhaustionMs < resetMs;

  return {
    predictedExhaustionAt: exhaustsBeforeReset
      ? // @effect-diagnostics-next-line globalDate:off
        new Date(exhaustionMs).toISOString()
      : null,
    predictedRemainingAtReset,
    safeDailyRate,
    safeRemainingToday,
    currentBurnRate,
    averageDailyRate,
    last24HourRate,
    last3DayRate,
    confidence,
    sampleSize: samples.length,
    method: "weighted-recent-average",
    reason: exhaustsBeforeReset
      ? "Recent intervals are weighted most heavily, with a linear trend and capped isolated spikes."
      : "Weighted recent rates and a linear trend project remaining allowance at reset.",
    onTrackToReset: !exhaustsBeforeReset,
  };
}

export function detectUsageReset(input: {
  readonly previousUsedPercent: number | null;
  readonly nextUsedPercent: number | null;
  readonly previousResetAt: string | null;
  readonly observedAt: string;
  readonly configuredResetAt?: string | null;
}): "provider-drop" | "timestamp-passed" | null {
  if (
    input.previousUsedPercent !== null &&
    input.nextUsedPercent !== null &&
    input.previousUsedPercent - input.nextUsedPercent >= 30
  ) {
    return "provider-drop";
  }
  const observedAt = finiteDateMs(input.observedAt);
  const resetAt = finiteDateMs(input.previousResetAt ?? input.configuredResetAt);
  return observedAt !== null && resetAt !== null && observedAt >= resetAt
    ? "timestamp-passed"
    : null;
}

export function resolveUsageMode(input: {
  readonly settings: UsageSettings;
  readonly usedPercent: number | null;
  readonly now: string;
}): UsageMode {
  const unrestrictedUntil = finiteDateMs(input.settings.unrestrictedUntil);
  const now = finiteDateMs(input.now);
  if (
    input.settings.selectedMode === "unrestricted" &&
    (unrestrictedUntil === null || (now !== null && unrestrictedUntil > now))
  ) {
    return "unrestricted";
  }
  if (!input.settings.automaticModeTransitions || input.usedPercent === null) {
    return input.settings.selectedMode === "unrestricted" ? "normal" : input.settings.selectedMode;
  }
  if (input.usedPercent >= input.settings.emergencyAtPercent) return "emergency";
  if (input.usedPercent >= input.settings.conserveAtPercent) return "conserve";
  return input.settings.selectedMode === "emergency" || input.settings.selectedMode === "conserve"
    ? input.settings.selectedMode
    : "normal";
}

export function shouldTriggerUsageNotification(input: {
  readonly now: string;
  readonly lastTriggeredAt: string | null;
  readonly cooldownMinutes: number;
  readonly recoveredSinceLastTrigger: boolean;
  readonly resetOccurred: boolean;
}): boolean {
  if (input.resetOccurred || input.recoveredSinceLastTrigger) return true;
  const now = finiteDateMs(input.now);
  const last = finiteDateMs(input.lastTriggeredAt);
  if (now === null) return false;
  if (last === null) return true;
  return now - last >= input.cooldownMinutes * 60_000;
}

export function deriveCalibrationRate(input: {
  readonly previousPercent: number;
  readonly nextPercent: number;
  readonly previousQuotaUnits: number;
  readonly nextQuotaUnits: number;
}): number | null {
  const percentDelta = input.nextPercent - input.previousPercent;
  const unitsDelta = input.nextQuotaUnits - input.previousQuotaUnits;
  if (percentDelta <= 0 || unitsDelta <= 0) return null;
  return percentDelta / unitsDelta;
}

export function estimatePercentFromCalibration(input: {
  readonly checkpointPercent: number;
  readonly checkpointQuotaUnits: number;
  readonly currentQuotaUnits: number;
  readonly percentPerQuotaUnit: number | null;
}): number | null {
  if (input.percentPerQuotaUnit === null) return null;
  return clamp(
    input.checkpointPercent +
      Math.max(0, input.currentQuotaUnits - input.checkpointQuotaUnits) * input.percentPerQuotaUnit,
    0,
    100,
  );
}

export const USAGE_DAY_MS = DAY_MS;
export const USAGE_HOUR_MS = HOUR_MS;
