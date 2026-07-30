/**
 * CodexAdapter — shape type for the Codex provider adapter.
 *
 * Historically this module exposed a `Context.Service` tag so consumers
 * could inject the adapter through the Effect layer graph. The driver
 * model ({@link ../Drivers/CodexDriver}) bundles one adapter per
 * instance as a captured closure instead, so the tag is gone — we only
 * retain the shape interface as a naming anchor for the driver bundle.
 *
 * @module CodexAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";
import type * as CodexSchema from "effect-codex-app-server/schema";

/**
 * CodexAdapterShape — per-instance Codex adapter contract. Carries
 * a branded driver kind as the nominal discriminant.
 */
export interface CodexAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  /**
   * Publishes an account-level quota snapshot discovered outside a thread
   * session (for example, during the provider health probe).
   */
  readonly publishAccountRateLimits: (
    rateLimits: CodexSchema.V2GetAccountRateLimitsResponse,
  ) => import("effect/Effect").Effect<void>;
}
