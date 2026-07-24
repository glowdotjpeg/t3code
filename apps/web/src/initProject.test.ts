import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  TurnId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  isStandaloneInitProjectCommand,
  resolveInitProjectModelSelection,
  resolveInitProjectTurnOutcome,
} from "./initProject";

function provider(input: {
  instanceId: string;
  driver?: string;
  enabled?: boolean;
  status?: ServerProvider["status"];
  availability?: ServerProvider["availability"];
  models: ReadonlyArray<string | { slug: string; isCustom: boolean }>;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver ?? "codex"),
    enabled: input.enabled ?? true,
    installed: true,
    version: null,
    status: input.status ?? "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-07-24T00:00:00.000Z",
    ...(input.availability ? { availability: input.availability } : {}),
    models: input.models.map((model) => {
      const value = typeof model === "string" ? { slug: model, isCustom: false } : model;
      return {
        slug: value.slug,
        name: value.slug,
        isCustom: value.isCustom,
        capabilities: {},
      };
    }),
    slashCommands: [],
    skills: [],
  };
}

describe("isStandaloneInitProjectCommand", () => {
  it("accepts the standalone command case-insensitively", () => {
    expect(isStandaloneInitProjectCommand(" /INITPROJ ")).toBe(true);
  });

  it("rejects arguments and surrounding message text", () => {
    expect(isStandaloneInitProjectCommand("/initproj please")).toBe(false);
    expect(isStandaloneInitProjectCommand("run /initproj")).toBe(false);
  });
});

describe("resolveInitProjectModelSelection", () => {
  it("chooses the cheapest advertised model regardless of server model order", () => {
    const result = resolveInitProjectModelSelection([
      provider({
        instanceId: "codex",
        models: ["gpt-5.6-terra", "gpt-5.4-mini", "gpt-5.4-nano"],
      }),
    ]);

    expect(result).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4-nano",
    });
  });

  it("falls back through Mini, Luna, and Terra", () => {
    expect(
      resolveInitProjectModelSelection([
        provider({ instanceId: "codex", models: ["gpt-5.6-terra", "gpt-5.6-luna"] }),
      ])?.model,
    ).toBe("gpt-5.6-luna");
    expect(
      resolveInitProjectModelSelection([
        provider({ instanceId: "codex", models: ["gpt-5.6-terra"] }),
      ])?.model,
    ).toBe("gpt-5.6-terra");
  });

  it("prefers GPT-5.3 Codex over higher-priced full-size GPT models", () => {
    expect(
      resolveInitProjectModelSelection([
        provider({
          instanceId: "codex",
          models: ["gpt-5.6-terra", "gpt-5.4", "gpt-5.3-codex"],
        }),
      ])?.model,
    ).toBe("gpt-5.3-codex");
  });

  it("ignores unavailable providers, non-Codex drivers, and custom model guesses", () => {
    const result = resolveInitProjectModelSelection([
      provider({
        instanceId: "codex",
        enabled: false,
        models: ["gpt-5.4-nano"],
      }),
      provider({
        instanceId: "codex_unavailable",
        availability: "unavailable",
        models: ["gpt-5.4-mini"],
      }),
      provider({
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        models: ["gpt-5.4-mini"],
      }),
      provider({
        instanceId: "codex_custom",
        models: [{ slug: "gpt-5.4-mini", isCustom: true }],
      }),
    ]);

    expect(result).toBeNull();
  });

  it("prefers the default Codex instance when equal-cost models are available", () => {
    const result = resolveInitProjectModelSelection([
      provider({ instanceId: "codex_personal", models: ["gpt-5.4-mini"] }),
      provider({ instanceId: "codex", models: ["gpt-5.4-mini"] }),
    ]);

    expect(result?.instanceId).toBe(ProviderInstanceId.make("codex"));
  });
});

describe("resolveInitProjectTurnOutcome", () => {
  it("waits through missing and running turns", () => {
    expect(resolveInitProjectTurnOutcome(null)).toBeNull();
    expect(
      resolveInitProjectTurnOutcome({
        latestTurn: {
          turnId: TurnId.make("turn-1"),
          state: "running",
          requestedAt: "2026-07-24T00:00:00.000Z",
          startedAt: "2026-07-24T00:00:01.000Z",
          completedAt: null,
          assistantMessageId: null,
        },
      }),
    ).toBeNull();
  });

  it.each(["completed", "interrupted", "error"] as const)(
    "returns the terminal %s state",
    (state) => {
      expect(
        resolveInitProjectTurnOutcome({
          latestTurn: {
            turnId: TurnId.make("turn-1"),
            state,
            requestedAt: "2026-07-24T00:00:00.000Z",
            startedAt: "2026-07-24T00:00:01.000Z",
            completedAt: "2026-07-24T00:00:02.000Z",
            assistantMessageId: null,
          },
        }),
      ).toBe(state);
    },
  );
});
