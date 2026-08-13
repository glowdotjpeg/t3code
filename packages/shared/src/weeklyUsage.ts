import type {
  ProviderInstanceId,
  WeeklyUsageSnapshot,
  WeeklyUsageWindowKind,
} from "@t3tools/contracts";

export type WeeklyUsageTone = "normal" | "elevated" | "warning" | "critical";

export function weeklyUsageTone(usedPercent: number): WeeklyUsageTone {
  if (usedPercent >= 90) return "critical";
  if (usedPercent >= 75) return "warning";
  if (usedPercent >= 50) return "elevated";
  return "normal";
}

export function formatWeeklyUsagePercent(usedPercent: number): string {
  const digits = usedPercent < 10 ? 1 : 0;
  return `${usedPercent.toFixed(digits).replace(/\.0$/, "")}%`;
}

export function formatWeeklyUsageReset(resetAt: string | null, nowMs = Date.now()): string {
  if (resetAt === null) return "Reset time unavailable";
  const resetMs = Date.parse(resetAt);
  if (!Number.isFinite(resetMs)) return "Reset time unavailable";
  const remainingMs = Math.max(0, resetMs - nowMs);
  const days = Math.floor(remainingMs / 86_400_000);
  const hours = Math.floor((remainingMs % 86_400_000) / 3_600_000);
  if (days > 0) return `Resets in ${days}d ${hours}h`;
  if (hours > 0) return `Resets in ${hours}h`;
  return "Resets in less than an hour";
}

function preferredWindowKind(model: string): WeeklyUsageWindowKind {
  const normalized = model.toLowerCase();
  if (normalized.includes("opus")) return "weekly-opus";
  if (normalized.includes("sonnet")) return "weekly-sonnet";
  return "weekly";
}

export function selectWeeklyUsageSnapshot(
  snapshots: readonly WeeklyUsageSnapshot[],
  providerInstanceId: ProviderInstanceId,
  model: string,
): WeeklyUsageSnapshot | null {
  const matching = snapshots.filter(
    (snapshot) => snapshot.providerInstanceId === providerInstanceId,
  );
  const preferred = preferredWindowKind(model);
  return (
    matching.find((snapshot) => snapshot.windowKind === preferred) ??
    matching.find((snapshot) => snapshot.windowKind === "weekly") ??
    matching[0] ??
    null
  );
}
