import { ProviderRegistry, type ProviderRegistryShape } from "../Services/ProviderRegistry.ts";
import type { ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";

export const makeProviderRegistryMock = (
  providers: ReadonlyArray<ServerProvider> = [],
): ProviderRegistryShape => ({
  getProviders: Effect.succeed(providers),
  refresh: () => Effect.succeed(providers),
  refreshInstance: () => Effect.succeed(providers),
  readSkill: () => Effect.die("Skill management is not configured in this test."),
  createSkill: () => Effect.die("Skill management is not configured in this test."),
  updateSkill: () => Effect.die("Skill management is not configured in this test."),
  deleteSkill: () => Effect.die("Skill management is not configured in this test."),
  installSkills: () => Effect.die("Skill management is not configured in this test."),
  setSkillEnabled: () => Effect.die("Skill management is not configured in this test."),
  getProviderMaintenanceCapabilitiesForInstance: (_instanceId, provider) =>
    Effect.succeed(makeManualOnlyProviderMaintenanceCapabilities({ provider, packageName: null })),
  setProviderMaintenanceActionState: () => Effect.succeed(providers),
  streamChanges: Stream.empty,
});

export const makeProviderRegistryLayer = (providers: ReadonlyArray<ServerProvider> = []) =>
  Layer.succeed(ProviderRegistry, makeProviderRegistryMock(providers));
