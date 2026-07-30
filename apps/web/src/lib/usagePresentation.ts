import type { UsageConfidence, UsageValueSource } from "@t3tools/contracts";

export type UsageSeverity = "normal" | "elevated" | "warning" | "critical" | "exhausted";

export function usageSeverity(usedPercent: number | null): UsageSeverity {
  if (usedPercent === null || usedPercent < 50) return "normal";
  if (usedPercent < 70) return "elevated";
  if (usedPercent < 85) return "warning";
  if (usedPercent < 95) return "critical";
  return "exhausted";
}

export function formatUsagePercent(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? "Unavailable" : `${value.toFixed(digits)}%`;
}

export function formatUsageTokens(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

export function formatUsageDuration(target: string | null, nowMs = Date.now()): string {
  if (!target) return "Reset unavailable";
  const targetMs = Date.parse(target);
  if (!Number.isFinite(targetMs)) return "Reset unavailable";
  const remainingMs = Math.max(0, targetMs - nowMs);
  const days = Math.floor(remainingMs / 86_400_000);
  const hours = Math.floor((remainingMs % 86_400_000) / 3_600_000);
  return days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;
}

export function usageProvenanceLabel(
  source: UsageValueSource,
  confidence: UsageConfidence,
): string {
  switch (source) {
    case "exact":
      return "Exact";
    case "provider-reported":
      return "Provider-reported";
    case "locally-calculated":
      return "Locally calculated";
    case "estimated":
      return confidence === "unavailable" ? "Estimated" : `Estimated · ${confidence} confidence`;
    case "unavailable":
      return "Unavailable";
  }
}
