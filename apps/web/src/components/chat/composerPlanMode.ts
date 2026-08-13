import type { ProviderInteractionMode } from "@t3tools/contracts";

export function shouldShowComposerPlanModeControl(
  providerSupportsPlanMode: boolean,
  interactionMode: ProviderInteractionMode,
): boolean {
  return providerSupportsPlanMode && interactionMode === "plan";
}
