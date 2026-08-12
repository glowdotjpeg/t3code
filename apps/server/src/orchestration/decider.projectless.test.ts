import {
  CommandId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-08-12T12:00:00.000Z";

it.layer(NodeServices.layer)("projectless thread decider", (it) =>
  it.effect("creates a thread without requiring a project", () =>
    Effect.gen(function* () {
      const readModel: OrchestrationReadModel = {
        snapshotSequence: 0,
        projects: [],
        threads: [],
        updatedAt: NOW,
      };

      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.create",
          commandId: CommandId.make("command-projectless"),
          threadId: ThreadId.make("thread-projectless"),
          projectId: null,
          title: "New conversation",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.6-sol",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: NOW,
        },
        readModel,
      });

      const createdEvent = Array.isArray(event) ? event[0] : event;
      expect(createdEvent?.type).toBe("thread.created");
      if (createdEvent?.type === "thread.created") {
        expect(createdEvent.payload.projectId).toBeNull();
      }
    }),
  ),
);
