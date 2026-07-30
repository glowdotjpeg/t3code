import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type UsageRequestRecord,
} from "@t3tools/contracts";

import { deduplicateUsageRecords, estimateTextTokens } from "./usageData.ts";

function record(id: string): UsageRequestRecord {
  return {
    id,
    occurredAt: "2026-07-24T12:00:00.000Z",
    provider: ProviderDriverKind.make("codex"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
    projectId: ProjectId.make("project-1"),
    projectName: "T3 Code",
    conversationId: ThreadId.make("thread-1"),
    conversationName: "Usage tracking",
    turnId: null,
    agentId: null,
    taskCategory: null,
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 20,
    reasoningTokens: 0,
    totalTokens: 30,
    durationMs: 100,
    succeeded: true,
    retryCount: 0,
    cancelled: false,
    productive: true,
    quotaUnits: 30,
    officialUsedPercentBefore: null,
    officialUsedPercentAfter: null,
    resetAt: null,
    source: "provider-reported",
    confidence: "high",
    createdAt: "2026-07-24T12:00:00.000Z",
  };
}

describe("usage data utilities", () => {
  it("deduplicates both existing and repeated imported records", () => {
    const result = deduplicateUsageRecords(
      [record("one"), record("one"), record("two")],
      new Set(["existing"]),
    );
    expect(result.accepted.map(({ id }) => id)).toEqual(["one", "two"]);
    expect(result.duplicates).toBe(1);
  });

  it("uses a conservative local text-token estimate", () => {
    expect(estimateTextTokens("")).toBe(0);
    expect(estimateTextTokens("abcd")).toBe(1);
    expect(estimateTextTokens("abcde")).toBe(2);
  });
});
