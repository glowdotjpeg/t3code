import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_USAGE_SETTINGS } from "@t3tools/contracts";

import {
  deriveCalibrationRate,
  detectUsageReset,
  estimatePercentFromCalibration,
  forecastUsage,
  resolveUsageMode,
  shouldTriggerUsageNotification,
} from "./usageForecasting.ts";

const NOW = "2026-07-24T12:00:00.000Z";
const RESET = "2026-07-28T00:00:00.000Z";

describe("forecastUsage", () => {
  it("calculates burn rate, exhaustion, and a partial-day safe budget", () => {
    const result = forecastUsage({
      now: NOW,
      resetAt: RESET,
      samples: [
        { at: "2026-07-21T12:00:00.000Z", usedPercent: 20 },
        { at: "2026-07-22T12:00:00.000Z", usedPercent: 35 },
        { at: "2026-07-23T12:00:00.000Z", usedPercent: 50 },
        { at: NOW, usedPercent: 65 },
      ],
    });

    expect(result.currentBurnRate).toBeCloseTo(15);
    expect(result.safeDailyRate).toBeCloseTo(10);
    // @effect-diagnostics-next-line globalDate:off -- verifies local partial-day behavior
    const localMidnight = new Date(NOW);
    localMidnight.setHours(24, 0, 0, 0);
    const expectedRemainingToday = 10 * ((localMidnight.getTime() - Date.parse(NOW)) / 86_400_000);
    expect(result.safeRemainingToday).toBeCloseTo(expectedRemainingToday);
    expect(result.predictedExhaustionAt).toBe("2026-07-26T20:00:00.000Z");
    expect(result.onTrackToReset).toBe(false);
  });

  it("returns an explicit insufficient-data state for sparse samples", () => {
    const result = forecastUsage({
      now: NOW,
      resetAt: RESET,
      samples: [
        { at: "2026-07-23T12:00:00.000Z", usedPercent: 10 },
        { at: NOW, usedPercent: 11 },
      ],
    });

    expect(result.method).toBe("insufficient-data");
    expect(result.predictedExhaustionAt).toBeNull();
    expect(result.confidence).toBe("unavailable");
  });

  it("handles zero usage without divide-by-zero or a false exhaustion date", () => {
    const result = forecastUsage({
      now: NOW,
      resetAt: RESET,
      samples: [
        { at: "2026-07-21T12:00:00.000Z", usedPercent: 0 },
        { at: "2026-07-22T12:00:00.000Z", usedPercent: 0 },
        { at: NOW, usedPercent: 0 },
      ],
    });

    expect(result.currentBurnRate).toBe(0);
    expect(result.predictedExhaustionAt).toBeNull();
    expect(result.predictedRemainingAtReset).toBe(100);
  });

  it("caps a sudden isolated spike in the weighted forecast", () => {
    const result = forecastUsage({
      now: NOW,
      resetAt: RESET,
      samples: [
        { at: "2026-07-20T12:00:00.000Z", usedPercent: 10 },
        { at: "2026-07-21T12:00:00.000Z", usedPercent: 12 },
        { at: "2026-07-22T12:00:00.000Z", usedPercent: 14 },
        { at: "2026-07-23T12:00:00.000Z", usedPercent: 54 },
        { at: NOW, usedPercent: 56 },
      ],
    });

    expect(result.currentBurnRate).not.toBeNull();
    expect(result.currentBurnRate!).toBeLessThan(20);
  });
});

describe("usage reset, modes, calibration, and notification policy", () => {
  it("detects provider drops and reset timestamps", () => {
    expect(
      detectUsageReset({
        previousUsedPercent: 82,
        nextUsedPercent: 4,
        previousResetAt: RESET,
        observedAt: NOW,
      }),
    ).toBe("provider-drop");
    expect(
      detectUsageReset({
        previousUsedPercent: 20,
        nextUsedPercent: 21,
        previousResetAt: "2026-07-24T11:00:00.000Z",
        observedAt: NOW,
      }),
    ).toBe("timestamp-passed");
  });

  it("applies automatic conserve and emergency transitions without selecting unrestricted", () => {
    expect(resolveUsageMode({ settings: DEFAULT_USAGE_SETTINGS, usedPercent: 75, now: NOW })).toBe(
      "conserve",
    );
    expect(resolveUsageMode({ settings: DEFAULT_USAGE_SETTINGS, usedPercent: 92, now: NOW })).toBe(
      "emergency",
    );
  });

  it("deduplicates notifications until cooldown, recovery, or reset", () => {
    expect(
      shouldTriggerUsageNotification({
        now: NOW,
        lastTriggeredAt: "2026-07-24T11:00:00.000Z",
        cooldownMinutes: 360,
        recoveredSinceLastTrigger: false,
        resetOccurred: false,
      }),
    ).toBe(false);
    expect(
      shouldTriggerUsageNotification({
        now: NOW,
        lastTriggeredAt: "2026-07-24T11:00:00.000Z",
        cooldownMinutes: 360,
        recoveredSinceLastTrigger: true,
        resetOccurred: false,
      }),
    ).toBe(true);
  });

  it("derives and applies a manual calibration rate", () => {
    const rate = deriveCalibrationRate({
      previousPercent: 20,
      nextPercent: 30,
      previousQuotaUnits: 1_000,
      nextQuotaUnits: 2_000,
    });
    expect(rate).toBe(0.01);
    expect(
      estimatePercentFromCalibration({
        checkpointPercent: 30,
        checkpointQuotaUnits: 2_000,
        currentQuotaUnits: 2_500,
        percentPerQuotaUnit: rate,
      }),
    ).toBe(35);
  });
});
