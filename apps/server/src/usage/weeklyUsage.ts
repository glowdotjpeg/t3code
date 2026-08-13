/**
 * Provider-reported weekly allowance snapshots.
 *
 * Providers emit these independently of transcript token usage. Keeping the
 * small latest-value cache separate prevents an exact subscription percentage
 * from being confused with the API-equivalent usage totals on the Usage page.
 */
import {
  type ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  WeeklyUsageSnapshot,
  type WeeklyUsageStatus,
  type WeeklyUsageWindowKind,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { writeFileStringAtomically } from "../atomicWrite.ts";

const SNAPSHOT_FILE_PREFIX = "weekly-usage-";
const SNAPSHOT_FILE_SUFFIX = ".json";
const MIN_WEEKLY_WINDOW_MINUTES = 6 * 24 * 60;
const MAX_SNAPSHOT_AGE_MS = 8 * 24 * 60 * 60 * 1_000;

const StoredWeeklyUsageSnapshot = Schema.fromJsonString(WeeklyUsageSnapshot);
const decodeSnapshot = Schema.decodeUnknownEffect(StoredWeeklyUsageSnapshot);
const encodeSnapshot = Schema.encodeEffect(StoredWeeklyUsageSnapshot);

type SnapshotIdentity = {
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly observedAt: string;
};

function finiteNumber(value: unknown): number | null {
  return Predicate.isNumber(value) && Number.isFinite(value) ? value : null;
}

function record(value: unknown): { readonly [key: PropertyKey]: unknown } | null {
  return Predicate.isObject(value) ? value : null;
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function epochToIso(value: unknown): string | null {
  const epoch = finiteNumber(value);
  if (epoch === null || epoch <= 0) return null;
  const milliseconds = epoch < 1_000_000_000_000 ? epoch * 1_000 : epoch;
  const instant = DateTime.make(milliseconds);
  return Option.isSome(instant) ? DateTime.formatIso(instant.value) : null;
}

function stringResetToIso(value: unknown): string | null {
  if (!Predicate.isString(value)) return null;
  const instant = DateTime.make(value);
  return Option.isSome(instant) ? DateTime.formatIso(instant.value) : null;
}

function makeSnapshot(
  identity: SnapshotIdentity,
  input: {
    readonly windowKind: WeeklyUsageWindowKind;
    readonly label: string;
    readonly usedPercent: number;
    readonly resetAt: string | null;
  },
): WeeklyUsageSnapshot {
  return {
    provider: identity.provider,
    providerInstanceId: identity.providerInstanceId,
    observedAt: identity.observedAt,
    windowKind: input.windowKind,
    label: input.label,
    usedPercent: clampPercentage(input.usedPercent),
    resetAt: input.resetAt,
  };
}

/** Extracts the longest Codex allowance window, normally the rolling week. */
export function normalizeCodexWeeklyUsage(
  rateLimits: unknown,
  identity: SnapshotIdentity,
): readonly WeeklyUsageSnapshot[] {
  const outer = record(rateLimits);
  if (!outer) return [];

  const nested = record(outer.rateLimits);
  const byLimitId = record(outer.rateLimitsByLimitId);
  const candidates = [
    nested ?? outer,
    ...Object.values(byLimitId ?? {}).flatMap((value) => {
      const candidate = record(value);
      return candidate ? [candidate] : [];
    }),
  ];

  const windows = candidates.flatMap((candidate) =>
    [record(candidate.primary), record(candidate.secondary)].flatMap((window) =>
      window ? [window] : [],
    ),
  );
  const selected = windows
    .filter((window) => {
      const duration = finiteNumber(window.windowDurationMins);
      return duration !== null && duration >= MIN_WEEKLY_WINDOW_MINUTES;
    })
    .toSorted(
      (left, right) =>
        (finiteNumber(right.windowDurationMins) ?? 0) -
        (finiteNumber(left.windowDurationMins) ?? 0),
    )[0];
  const usedPercent = selected ? finiteNumber(selected.usedPercent) : null;
  if (!selected || usedPercent === null) return [];

  return [
    makeSnapshot(identity, {
      windowKind: "weekly",
      label: "Weekly",
      usedPercent,
      resetAt: epochToIso(selected.resetsAt),
    }),
  ];
}

const CLAUDE_WEEKLY_WINDOWS: Readonly<
  Record<string, { readonly windowKind: WeeklyUsageWindowKind; readonly label: string }>
> = {
  seven_day: { windowKind: "weekly", label: "Weekly" },
  seven_day_opus: { windowKind: "weekly-opus", label: "Opus weekly" },
  seven_day_sonnet: { windowKind: "weekly-sonnet", label: "Sonnet weekly" },
};

/** Normalizes a Claude SDK `rate_limit_event`. */
export function normalizeClaudeWeeklyUsageEvent(
  rateLimits: unknown,
  identity: SnapshotIdentity,
): readonly WeeklyUsageSnapshot[] {
  const envelope = record(rateLimits);
  const info = record(envelope?.rate_limit_info);
  const kind = Predicate.isString(info?.rateLimitType) ? info.rateLimitType : null;
  const config = kind === null ? undefined : CLAUDE_WEEKLY_WINDOWS[kind];
  const usedPercent = finiteNumber(info?.utilization);
  if (!config || usedPercent === null) return [];

  return [
    makeSnapshot(identity, {
      ...config,
      usedPercent,
      resetAt: epochToIso(info?.resetsAt),
    }),
  ];
}

/** Normalizes Claude's structured `/usage` response into all weekly windows. */
export function normalizeClaudeWeeklyUsageResponse(
  response: unknown,
  identity: SnapshotIdentity,
): readonly WeeklyUsageSnapshot[] {
  const root = record(response);
  const limits = record(root?.rate_limits);
  if (!limits) return [];

  const definitions = [
    ["seven_day", "weekly", "Weekly"],
    ["seven_day_opus", "weekly-opus", "Opus weekly"],
    ["seven_day_sonnet", "weekly-sonnet", "Sonnet weekly"],
    ["seven_day_oauth_apps", "weekly-oauth-apps", "OAuth apps weekly"],
  ] as const;

  return definitions.flatMap(([field, windowKind, label]) => {
    const window = record(limits[field]);
    const usedPercent = finiteNumber(window?.utilization);
    if (usedPercent === null) return [];
    return [
      makeSnapshot(identity, {
        windowKind,
        label,
        usedPercent,
        resetAt: stringResetToIso(window?.resets_at),
      }),
    ];
  });
}

export function normalizeWeeklyUsageEvent(
  event: Extract<ProviderRuntimeEvent, { type: "account.rate-limits.updated" }>,
): readonly WeeklyUsageSnapshot[] {
  const identity: SnapshotIdentity = {
    provider: event.provider,
    providerInstanceId: event.providerInstanceId ?? ProviderInstanceId.make(event.provider),
    observedAt: event.createdAt,
  };
  return event.provider === "codex"
    ? normalizeCodexWeeklyUsage(event.payload.rateLimits, identity)
    : event.provider === "claudeAgent"
      ? normalizeClaudeWeeklyUsageEvent(event.payload.rateLimits, identity)
      : [];
}

function snapshotFileName(snapshot: WeeklyUsageSnapshot): string {
  const identity = `${snapshot.providerInstanceId}\u0000${snapshot.windowKind}`;
  return `${SNAPSHOT_FILE_PREFIX}${Encoding.encodeBase64Url(identity)}${SNAPSHOT_FILE_SUFFIX}`;
}

export const persistWeeklyUsageSnapshots = Effect.fn("persistWeeklyUsageSnapshots")(function* (
  stateDir: string,
  snapshots: readonly WeeklyUsageSnapshot[],
) {
  if (snapshots.length === 0) return;
  const path = yield* Path.Path;
  const directory = path.join(stateDir, "weekly-usage");

  yield* Effect.forEach(
    snapshots,
    (snapshot) =>
      encodeSnapshot(snapshot).pipe(
        Effect.flatMap((contents) =>
          writeFileStringAtomically({
            filePath: path.join(directory, snapshotFileName(snapshot)),
            contents,
          }),
        ),
      ),
    { concurrency: 1, discard: true },
  );
});

export const readWeeklyUsageStatus = Effect.fn("readWeeklyUsageStatus")(function* (
  stateDir: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const now = yield* DateTime.now;
  const nowMs = DateTime.toEpochMillis(now);
  const directory = path.join(stateDir, "weekly-usage");
  const entries = yield* fileSystem
    .readDirectory(directory)
    .pipe(Effect.catchCause(() => Effect.succeed<readonly string[]>([])));
  const decoded = yield* Effect.forEach(
    entries.filter(
      (entry) => entry.startsWith(SNAPSHOT_FILE_PREFIX) && entry.endsWith(SNAPSHOT_FILE_SUFFIX),
    ),
    (entry) =>
      fileSystem
        .readFileString(path.join(directory, entry))
        .pipe(Effect.flatMap(decodeSnapshot), Effect.option),
    { concurrency: 8 },
  );

  const newestByWindow = new Map<string, WeeklyUsageSnapshot>();
  for (const option of decoded) {
    if (Option.isNone(option)) continue;
    const snapshot = option.value;
    const observedAt = DateTime.make(snapshot.observedAt);
    if (
      Option.isNone(observedAt) ||
      nowMs - DateTime.toEpochMillis(observedAt.value) > MAX_SNAPSHOT_AGE_MS
    ) {
      continue;
    }
    const resetAt = snapshot.resetAt === null ? Option.none() : DateTime.make(snapshot.resetAt);
    if (Option.isSome(resetAt) && DateTime.toEpochMillis(resetAt.value) <= nowMs) continue;
    const key = `${snapshot.providerInstanceId}\u0000${snapshot.windowKind}`;
    const current = newestByWindow.get(key);
    if (!current || current.observedAt < snapshot.observedAt) {
      newestByWindow.set(key, snapshot);
    }
  }

  return {
    readAt: DateTime.formatIso(now),
    snapshots: [...newestByWindow.values()].toSorted((left, right) =>
      left.label.localeCompare(right.label),
    ),
  } satisfies WeeklyUsageStatus;
});
