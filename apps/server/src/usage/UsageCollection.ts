import {
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type ProviderRuntimeEvent,
  type UsageQuotaSnapshot,
  type UsageRequestRecord,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { detectUsageReset } from "@t3tools/shared/usageForecasting";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { getProviderUsageAdapter } from "./ProviderUsageAdapters.ts";
import { UsageRepository } from "./UsageRepository.ts";

interface UsageContext {
  readonly thread: OrchestrationThread | null;
  readonly project: OrchestrationProjectShell | null;
}

export class UsageCollection extends Context.Service<
  UsageCollection,
  {
    readonly capture: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  }
>()("t3/usage/UsageCollection") {}

function turnOutcome(
  event: Extract<ProviderRuntimeEvent, { type: "turn.completed" | "turn.aborted" }>,
): "completed" | "failed" | "cancelled" | "interrupted" {
  if (event.type === "turn.aborted") return "interrupted";
  switch (event.payload.state) {
    case "failed":
    case "cancelled":
    case "interrupted":
      return event.payload.state;
    default:
      return "completed";
  }
}

export const make = Effect.gen(function* () {
  const repository = yield* UsageRepository;
  const snapshots = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const seenTurnUsage = yield* Ref.make<ReadonlySet<string>>(new Set());
  const persistedQuotaSnapshots = yield* repository.listQuotaSnapshots.pipe(
    Effect.catch((cause) =>
      Effect.logWarning("usage.quota-hydration-failed", { cause: cause.message }).pipe(
        Effect.as<ReadonlyArray<UsageQuotaSnapshot>>([]),
      ),
    ),
  );
  const hydratedQuota = new Map<string, UsageQuotaSnapshot>();
  for (const snapshot of persistedQuotaSnapshots) {
    hydratedQuota.set(String(snapshot.providerInstanceId ?? snapshot.provider), snapshot);
  }
  const latestQuota = yield* Ref.make<ReadonlyMap<string, UsageQuotaSnapshot>>(hydratedQuota);
  const failureStreaks = yield* Ref.make<ReadonlyMap<string, number>>(new Map());

  const resolveContext = Effect.fn("UsageCollection.resolveContext")(function* (
    event: ProviderRuntimeEvent,
  ): Effect.fn.Return<UsageContext> {
    const thread = Option.getOrNull(
      yield* snapshots.getThreadDetailById(event.threadId).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("usage.context.thread-read-failed", {
            threadId: event.threadId,
            cause: cause.message,
          }).pipe(Effect.as(Option.none<OrchestrationThread>())),
        ),
      ),
    );
    if (!thread) return { thread: null, project: null };
    const project =
      thread.projectId === null
        ? null
        : Option.getOrNull(
            yield* snapshots.getProjectShellById(thread.projectId).pipe(
              Effect.catch((cause) =>
                Effect.logWarning("usage.context.project-read-failed", {
                  projectId: thread.projectId,
                  cause: cause.message,
                }).pipe(Effect.as(Option.none<OrchestrationProjectShell>())),
              ),
            ),
          );
    return { thread, project };
  });

  const captureTokenUsage = Effect.fn("UsageCollection.captureTokenUsage")(function* (
    event: Extract<ProviderRuntimeEvent, { type: "thread.token-usage.updated" }>,
  ) {
    const normalized = getProviderUsageAdapter(event.provider).normalizeTokenUsage(event);
    if (!normalized) return;
    const context = yield* resolveContext(event);
    const turnKey = event.turnId ? String(event.turnId) : null;
    if (turnKey) {
      yield* Ref.update(seenTurnUsage, (current) => new Set(current).add(turnKey));
    }
    const quotaKey = String(event.providerInstanceId ?? event.provider);
    const quota = (yield* Ref.get(latestQuota)).get(quotaKey) ?? null;
    const retryCount = (yield* Ref.get(failureStreaks)).get(String(event.threadId)) ?? 0;
    const record: UsageRequestRecord = {
      id: `usage:${event.eventId}`,
      occurredAt: event.createdAt,
      provider: event.provider,
      providerInstanceId: event.providerInstanceId ?? null,
      model: context.thread?.modelSelection.model ?? null,
      projectId: context.thread?.projectId ?? null,
      projectName: context.project?.title ?? null,
      conversationId: event.threadId,
      conversationName: context.thread?.title ?? null,
      turnId: event.turnId ?? null,
      agentId: null,
      taskCategory: context.thread?.interactionMode ?? null,
      ...normalized,
      succeeded: true,
      retryCount,
      cancelled: false,
      productive: true,
      officialUsedPercentBefore: quota?.usedPercent ?? null,
      officialUsedPercentAfter: null,
      resetAt: quota?.resetAt ?? null,
      createdAt: event.createdAt,
    };
    yield* repository.insertRequest(record);
  });

  const captureQuota = Effect.fn("UsageCollection.captureQuota")(function* (
    event: Extract<ProviderRuntimeEvent, { type: "account.rate-limits.updated" }>,
  ) {
    const normalized = getProviderUsageAdapter(event.provider).normalizeQuota(event);
    if (!normalized) return;
    if (!(yield* repository.insertQuotaSnapshot(normalized))) return;
    const quotaKey = String(event.providerInstanceId ?? event.provider);
    const previous = (yield* Ref.get(latestQuota)).get(quotaKey) ?? null;
    const resetReason = detectUsageReset({
      previousUsedPercent: previous?.usedPercent ?? null,
      nextUsedPercent: normalized.usedPercent,
      previousResetAt: previous?.resetAt ?? null,
      observedAt: normalized.observedAt,
    });
    yield* repository.observeQuotaPeriod(normalized, resetReason);
    yield* Ref.update(latestQuota, (current) => {
      const next = new Map(current);
      next.set(quotaKey, normalized);
      return next;
    });
    if (normalized.usedPercent !== null) {
      yield* repository.attachLatestQuotaAfter(
        normalized.providerInstanceId,
        normalized.usedPercent,
        normalized.resetAt,
      );
    }
  });

  const captureTurnOutcome = Effect.fn("UsageCollection.captureTurnOutcome")(function* (
    event: Extract<ProviderRuntimeEvent, { type: "turn.completed" | "turn.aborted" }>,
  ) {
    const outcome = turnOutcome(event);
    const turnKey = event.turnId ? String(event.turnId) : null;
    if (turnKey) {
      yield* repository.markTurnOutcome(turnKey, outcome);
    }
    const context = yield* resolveContext(event);
    const hasUsage = turnKey ? (yield* Ref.get(seenTurnUsage)).has(turnKey) : false;
    const currentStreak = (yield* Ref.get(failureStreaks)).get(String(event.threadId)) ?? 0;
    if (!hasUsage) {
      const startedAt = context.thread?.latestTurn?.startedAt
        ? Date.parse(context.thread.latestTurn.startedAt)
        : Number.NaN;
      const completedAt = Date.parse(event.createdAt);
      const durationMs =
        Number.isFinite(startedAt) && Number.isFinite(completedAt)
          ? Math.max(0, completedAt - startedAt)
          : null;
      const quotaKey = String(event.providerInstanceId ?? event.provider);
      const quota = (yield* Ref.get(latestQuota)).get(quotaKey) ?? null;
      yield* repository.insertRequest({
        id: `usage:fallback:${event.eventId}`,
        occurredAt: event.createdAt,
        provider: event.provider,
        providerInstanceId: event.providerInstanceId ?? null,
        model: context.thread?.modelSelection.model ?? null,
        projectId: context.thread?.projectId ?? null,
        projectName: context.project?.title ?? null,
        conversationId: event.threadId,
        conversationName: context.thread?.title ?? null,
        turnId: event.turnId ?? null,
        agentId: null,
        taskCategory: context.thread?.interactionMode ?? null,
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        totalTokens: null,
        durationMs,
        succeeded: outcome === "completed",
        retryCount: currentStreak,
        cancelled: outcome === "cancelled" || outcome === "interrupted",
        productive: outcome === "completed",
        quotaUnits: 1,
        officialUsedPercentBefore: quota?.usedPercent ?? null,
        officialUsedPercentAfter: null,
        resetAt: quota?.resetAt ?? null,
        source: "estimated",
        confidence: "low",
        createdAt: event.createdAt,
      });
    }
    yield* Ref.update(failureStreaks, (current) => {
      const next = new Map(current);
      next.set(String(event.threadId), outcome === "completed" ? 0 : currentStreak + 1);
      return next;
    });
    if (turnKey) {
      yield* Ref.update(seenTurnUsage, (current) => {
        const next = new Set(current);
        next.delete(turnKey);
        return next;
      });
    }
  });

  const capture: UsageCollection["Service"]["capture"] = Effect.fn("UsageCollection.capture")(
    function* (event) {
      switch (event.type) {
        case "thread.token-usage.updated":
          yield* captureTokenUsage(event).pipe(Effect.retry({ times: 2 }));
          return;
        case "account.rate-limits.updated":
          yield* captureQuota(event);
          return;
        case "turn.completed":
        case "turn.aborted":
          yield* captureTurnOutcome(event).pipe(Effect.retry({ times: 2 }));
          return;
        default:
          return;
      }
    },
    Effect.catchCause((cause) =>
      Effect.logError("usage.capture.failed", {
        cause,
        detail: "The provider request continued; usage history may be incomplete.",
      }),
    ),
  );

  yield* providerService.streamEvents.pipe(
    Stream.runForEach(capture),
    Effect.catchCause((cause) => Effect.logError("usage.collection.stream-failed", { cause })),
    Effect.forkScoped,
  );

  return UsageCollection.of({ capture });
});

export const layer = Layer.effect(UsageCollection, make);
