# Local AI usage tracking

T3 Code records request metadata locally so usage pacing remains useful even when a provider does
not publish a weekly allowance. The subsystem is deliberately observational: a storage or quota
read failure is logged, but it never fails the provider request that produced it.

## Data flow

1. `ProviderService.streamEvents` emits canonical token, quota, and turn-outcome events.
2. `UsageCollection` normalizes the event through a provider adapter and enriches it with project
   and conversation identifiers from the orchestration projection.
3. `UsageRepository` stores metadata in SQLite. Prompt text, response text, terminal output,
   environment variables, and credentials are not part of the schema.
4. `UsageService` aggregates records, applies calibration, computes forecasts, identifies expensive
   activity, and deduplicates notification candidates.
5. Usage RPCs expose normalized dashboard, calibration, budget, import, export, and clear-history
   operations to the web client.

The SQLite migration is `035_UsageTracking.ts`. Historical periods and records are retained until
the user explicitly clears them.

## Provenance

Every displayed allowance value carries one of these labels:

- **Exact**: a provider supplied the quota value and reset window directly.
- **Provider-reported**: the provider supplied request token usage, but not necessarily a weekly
  allowance.
- **Locally calculated**: derived deterministically from provider values.
- **Estimated**: based on calibration, local token estimates, or request counts.
- **Unavailable**: there is not enough trustworthy information to display the value.

Codex currently provides the strongest path: account rate-limit events expose exact used
percentages and reset timestamps, and token events expose request usage. Claude Agent events can
provide request tokens but do not expose the same normalized weekly allowance. Cursor, Grok, and
OpenCode fall back to token events when available and otherwise record a low-confidence request
unit. No hard-coded token-to-weekly-percent conversion is claimed for those providers.

## Forecasting

`packages/shared/src/usageForecasting.ts` is a pure, deterministic module. It combines a weighted
recent interval rate, last-24-hour rate, last-three-day rate, and period average. It requires at
least three valid samples, caps isolated spikes, handles flat usage and partial days, and returns
confidence and method metadata with every forecast.

Manual calibration stores provider checkpoints without overwriting history. Two checkpoints can
derive a local quota-unit conversion rate; a known total weekly allowance can supply one directly.

## Adding a provider adapter

Add an adapter in `apps/server/src/usage/ProviderUsageAdapters.ts` and register it in `ADAPTERS`.
Keep provider-specific parsing inside that file. An adapter declares support for official quota,
reset information, request tokens, local estimates, and quota conversion, then returns normalized
token and quota objects.

Only mark `isExact` when the provider itself reports the quota window. If a model has a documented
quota-unit conversion, implement `quotaUnitsForTokens`; otherwise return `null` and allow local
calibration to provide the estimate. Never include request content in adapter output.

## Reliability and privacy

Request IDs and quota snapshot IDs are idempotent primary keys, so retries and imports do not create
duplicates. Failed and cancelled turns remain recorded as total consumption but are excluded from
productive totals. Notification state is persisted and cleared at a detected reset.

Exports contain only the usage-record schema. JSON imports are schema-validated record by record and
deduplicated. Usage data is not sent to PostHog or any other analytics service.
