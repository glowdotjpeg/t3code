import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type UsageQuotaSnapshot,
  type UsageRequestRecord,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as UsageRepository from "./UsageRepository.ts";

const repositoryLayer = UsageRepository.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory));

const record: UsageRequestRecord = {
  id: "usage:test",
  occurredAt: "2026-07-24T12:00:00.000Z",
  provider: ProviderDriverKind.make("codex"),
  providerInstanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
  projectId: ProjectId.make("project-1"),
  projectName: "T3 Code",
  conversationId: ThreadId.make("thread-1"),
  conversationName: "Usage",
  turnId: TurnId.make("turn-1"),
  agentId: null,
  taskCategory: "default",
  inputTokens: 100,
  cachedInputTokens: 10,
  outputTokens: 20,
  reasoningTokens: 5,
  totalTokens: 125,
  durationMs: 500,
  succeeded: true,
  retryCount: 0,
  cancelled: false,
  productive: true,
  quotaUnits: 125,
  officialUsedPercentBefore: 20,
  officialUsedPercentAfter: null,
  resetAt: "2026-07-28T00:00:00.000Z",
  source: "provider-reported",
  confidence: "high",
  createdAt: "2026-07-24T12:00:00.000Z",
};

const quota: UsageQuotaSnapshot = {
  id: "quota:test",
  observedAt: "2026-07-24T12:01:00.000Z",
  provider: ProviderDriverKind.make("codex"),
  providerInstanceId: ProviderInstanceId.make("codex"),
  usedPercent: 21,
  remainingPercent: 79,
  resetAt: "2026-07-28T00:00:00.000Z",
  windowDurationMinutes: 10_080,
  source: "exact",
  confidence: "exact",
  isExact: true,
  rawKind: "codex-account-rate-limit",
};

it.layer(NodeServices.layer)("UsageRepository", (it) => {
  it.effect("persists idempotently and separates failed consumption from productive usage", () =>
    Effect.gen(function* () {
      const repository = yield* UsageRepository.UsageRepository;

      expect(yield* repository.insertRequest(record)).toBe(true);
      expect(yield* repository.insertRequest(record)).toBe(false);
      yield* repository.markTurnOutcome("turn-1", "failed");

      const records = yield* repository.listRequests;
      expect(records).toHaveLength(1);
      expect(records[0]?.succeeded).toBe(false);
      expect(records[0]?.productive).toBe(false);
    }).pipe(Effect.provide(repositoryLayer)),
  );

  it.effect("stores exact quota windows and clears notification state on reset", () =>
    Effect.gen(function* () {
      const repository = yield* UsageRepository.UsageRepository;
      expect(yield* repository.insertQuotaSnapshot(quota)).toBe(true);
      yield* repository.observeQuotaPeriod(quota, null);
      yield* repository.setNotificationState({
        key: "threshold:50",
        lastTriggeredAt: quota.observedAt,
        lastUsedPercent: 50,
        resetAt: quota.resetAt,
      });

      const resetQuota = {
        ...quota,
        id: "quota:reset",
        observedAt: "2026-07-28T00:01:00.000Z",
        usedPercent: 2,
        remainingPercent: 98,
        resetAt: "2026-08-04T00:00:00.000Z",
      } satisfies UsageQuotaSnapshot;
      yield* repository.observeQuotaPeriod(resetQuota, "provider-drop");

      expect(yield* repository.getNotificationState("threshold:50")).toBeNull();
      expect(yield* repository.listQuotaSnapshots).toEqual([quota]);
      yield* repository.confirmManualReset("2026-08-04T00:01:00.000Z", "2026-08-11T00:00:00.000Z");
    }).pipe(Effect.provide(repositoryLayer)),
  );
});
