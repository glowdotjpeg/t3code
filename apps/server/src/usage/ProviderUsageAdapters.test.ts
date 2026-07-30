import { describe, expect, it } from "@effect/vitest";
import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";

import { getProviderUsageAdapter, normalizeCodexRateLimits } from "./ProviderUsageAdapters.ts";

function rateLimitEvent(
  rateLimits: unknown,
): Extract<ProviderRuntimeEvent, { type: "account.rate-limits.updated" }> {
  return {
    type: "account.rate-limits.updated",
    eventId: EventId.make("event-1"),
    provider: ProviderDriverKind.make("codex"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    threadId: ThreadId.make("thread-1"),
    turnId: TurnId.make("turn-1"),
    createdAt: "2026-07-24T12:00:00.000Z",
    payload: { rateLimits },
  };
}

describe("provider usage adapters", () => {
  it("normalizes the longest Codex quota window as exact provider data", () => {
    const result = normalizeCodexRateLimits(
      rateLimitEvent({
        rateLimits: {
          primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_774_416_000 },
          secondary: { usedPercent: 63, windowDurationMins: 10_080, resetsAt: 1_774_848_000 },
        },
      }),
    );

    expect(result?.usedPercent).toBe(63);
    expect(result?.remainingPercent).toBe(37);
    expect(result?.windowDurationMinutes).toBe(10_080);
    expect(result?.source).toBe("exact");
    expect(result?.isExact).toBe(true);
  });

  it("normalizes a full account/rateLimits/read response", () => {
    const result = normalizeCodexRateLimits(
      rateLimitEvent({
        rateLimits: {
          primary: { usedPercent: 18, windowDurationMins: 300, resetsAt: 1_774_416_000 },
          secondary: { usedPercent: 41, windowDurationMins: 10_080, resetsAt: 1_774_848_000 },
        },
        rateLimitsByLimitId: {
          codex: {
            primary: { usedPercent: 18, windowDurationMins: 300, resetsAt: 1_774_416_000 },
            secondary: {
              usedPercent: 41,
              windowDurationMins: 10_080,
              resetsAt: 1_774_848_000,
            },
          },
        },
      }),
    );

    expect(result).toMatchObject({
      usedPercent: 41,
      remainingPercent: 59,
      windowDurationMinutes: 10_080,
      source: "exact",
      confidence: "exact",
      isExact: true,
    });
  });

  it("gracefully returns unavailable quota support for non-Codex providers", () => {
    const adapter = getProviderUsageAdapter(ProviderDriverKind.make("cursor"));
    expect(adapter.normalizeQuota(rateLimitEvent({}))).toBeNull();
  });

  it("does not mislabel a short Codex rate-limit window as weekly usage", () => {
    expect(
      normalizeCodexRateLimits(
        rateLimitEvent({
          rateLimits: {
            primary: { usedPercent: 90, windowDurationMins: 300, resetsAt: 1_774_416_000 },
          },
        }),
      ),
    ).toBeNull();
  });
});
