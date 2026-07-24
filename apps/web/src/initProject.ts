import { type ModelSelection, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";

import type { Thread } from "./types";
import {
  deriveProviderInstanceEntries,
  isProviderInstancePickerReady,
  sortProviderInstanceEntries,
} from "./providerInstances";

export const INIT_PROJECT_COMMAND = "initproj";
export const INIT_PROJECT_PROMPT =
  "Initialize this project with a blank Vite,React,Typescript,Tailwind project";
export const INIT_PROJECT_THREAD_TITLE = "Initialize project";

/**
 * Ordered by current OpenAI API token price, cheapest first.
 *
 * Keep this small and explicit: an unknown future model should not be selected
 * as "cheap" without a published price. The provider snapshot is still the
 * source of truth for whether any candidate is actually available in Codex.
 */
export const INIT_PROJECT_MODEL_PREFERENCE = [
  "gpt-5.4-nano",
  "gpt-5.4-mini",
  "gpt-5.6-luna",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.6-terra",
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.4-pro",
  "gpt-5.5-pro",
] as const;

const CODEX_DRIVER = ProviderDriverKind.make("codex");

export function isStandaloneInitProjectCommand(text: string): boolean {
  return /^\/initproj\s*$/i.test(text.trim());
}

export function resolveInitProjectModelSelection(
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection | null {
  const readyCodexInstances = sortProviderInstanceEntries(
    deriveProviderInstanceEntries(providers),
  ).filter((entry) => entry.driverKind === CODEX_DRIVER && isProviderInstancePickerReady(entry));

  for (const model of INIT_PROJECT_MODEL_PREFERENCE) {
    for (const entry of readyCodexInstances) {
      const advertisedModel = entry.models.find(
        (candidate) => candidate.slug === model && !candidate.isCustom,
      );
      if (advertisedModel) {
        return {
          instanceId: entry.instanceId,
          model: advertisedModel.slug,
        };
      }
    }
  }

  return null;
}

export type InitProjectTurnOutcome = "completed" | "interrupted" | "error";

export function resolveInitProjectTurnOutcome(
  thread: Pick<Thread, "latestTurn"> | null | undefined,
): InitProjectTurnOutcome | null {
  const state = thread?.latestTurn?.state;
  if (state === "completed" || state === "interrupted" || state === "error") {
    return state;
  }
  return null;
}
