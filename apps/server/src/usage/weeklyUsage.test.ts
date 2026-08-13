import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  normalizeClaudeWeeklyUsageEvent,
  normalizeClaudeWeeklyUsageResponse,
  normalizeCodexWeeklyUsage,
  persistWeeklyUsageSnapshots,
  readWeeklyUsageStatus,
} from "./weeklyUsage.ts";

const observedAt = "2026-08-12T12:00:00.000Z";

describe("weekly provider usage", () => {
  it("selects the longest Codex allowance window", () => {
    const snapshots = normalizeCodexWeeklyUsage(
      {
        rateLimitsByLimitId: {
          codex: {
            primary: {
              usedPercent: 12,
              windowDurationMins: 300,
              resetsAt: 1_786_800_000,
            },
            secondary: {
              usedPercent: 63,
              windowDurationMins: 10_080,
              resetsAt: 1_787_400_000,
            },
          },
        },
      },
      {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: ProviderInstanceId.make("codex-personal"),
        observedAt,
      },
    );

    expect(snapshots).toEqual([
      expect.objectContaining({
        windowKind: "weekly",
        usedPercent: 63,
        providerInstanceId: "codex-personal",
      }),
    ]);
  });

  it("does not label a short Codex window as weekly", () => {
    expect(
      normalizeCodexWeeklyUsage(
        {
          primary: {
            usedPercent: 90,
            windowDurationMins: 300,
            resetsAt: 1_786_800_000,
          },
        },
        {
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: ProviderInstanceId.make("codex"),
          observedAt,
        },
      ),
    ).toEqual([]);
  });

  it("normalizes Claude's structured weekly windows", () => {
    const snapshots = normalizeClaudeWeeklyUsageResponse(
      {
        rate_limits: {
          five_hour: { utilization: 9, resets_at: "2026-08-12T17:00:00.000Z" },
          seven_day: { utilization: 41, resets_at: "2026-08-18T12:00:00.000Z" },
          seven_day_opus: { utilization: 72, resets_at: "2026-08-19T12:00:00.000Z" },
        },
      },
      {
        provider: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId: ProviderInstanceId.make("claudeAgent"),
        observedAt,
      },
    );

    expect(snapshots.map(({ windowKind, usedPercent }) => [windowKind, usedPercent])).toEqual([
      ["weekly", 41],
      ["weekly-opus", 72],
    ]);
  });

  it("normalizes Claude weekly rate-limit events", () => {
    const snapshots = normalizeClaudeWeeklyUsageEvent(
      {
        rate_limit_info: {
          rateLimitType: "seven_day_sonnet",
          utilization: 54,
          resetsAt: 1_787_400_000,
        },
      },
      {
        provider: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId: ProviderInstanceId.make("claude-team"),
        observedAt,
      },
    );

    expect(snapshots).toEqual([
      expect.objectContaining({
        windowKind: "weekly-sonnet",
        label: "Sonnet weekly",
        usedPercent: 54,
      }),
    ]);
  });

  it.effect("persists the latest snapshot without provider transcript data", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const stateDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-weekly-usage-" });
      const currentObservedAt = DateTime.formatIso(yield* DateTime.now);
      const snapshot = {
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: ProviderInstanceId.make("codex"),
        windowKind: "weekly" as const,
        label: "Weekly",
        usedPercent: 38,
        resetAt: null,
        observedAt: currentObservedAt,
      };

      yield* persistWeeklyUsageSnapshots(stateDir, [snapshot]);
      const status = yield* readWeeklyUsageStatus(stateDir);

      expect(status.snapshots).toEqual([snapshot]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
