import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatWeeklyUsagePercent,
  formatWeeklyUsageReset,
  selectWeeklyUsageSnapshot,
  weeklyUsageTone,
} from "./weeklyUsagePresentation";

const providerInstanceId = ProviderInstanceId.make("claudeAgent");
const baseSnapshot = {
  provider: ProviderDriverKind.make("claudeAgent"),
  providerInstanceId,
  label: "Weekly",
  windowKind: "weekly" as const,
  usedPercent: 41,
  resetAt: "2026-08-18T12:00:00.000Z",
  observedAt: "2026-08-12T12:00:00.000Z",
};

describe("weekly usage presentation", () => {
  it("selects a model-specific allowance when available", () => {
    const opus = {
      ...baseSnapshot,
      windowKind: "weekly-opus" as const,
      label: "Opus weekly",
      usedPercent: 72,
    };

    expect(
      selectWeeklyUsageSnapshot([baseSnapshot, opus], providerInstanceId, "claude-opus-4-8"),
    ).toBe(opus);
  });

  it("formats percentages and reset distance compactly", () => {
    expect(formatWeeklyUsagePercent(6.25)).toBe("6.3%");
    expect(
      formatWeeklyUsageReset("2026-08-14T15:00:00.000Z", Date.parse("2026-08-12T12:00:00.000Z")),
    ).toBe("Resets in 2d 3h");
  });

  it("escalates the indicator as the allowance is consumed", () => {
    expect(weeklyUsageTone(49)).toBe("normal");
    expect(weeklyUsageTone(50)).toBe("elevated");
    expect(weeklyUsageTone(75)).toBe("warning");
    expect(weeklyUsageTone(90)).toBe("critical");
  });
});
