import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterProjectlessThreadsFromShell,
  isProjectlessCompatibleShellItem,
} from "./ProjectlessThreads.ts";

const NOW = "2026-08-12T12:00:00.000Z";

function thread(id: string, projectId: ProjectId | null): OrchestrationThreadShell {
  return {
    id: ThreadId.make(id),
    projectId,
    title: id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

describe("projectless thread wire compatibility", () => {
  const projectThread = thread("thread-project", ProjectId.make("project-1"));
  const projectlessThread = thread("thread-projectless", null);
  const snapshot: OrchestrationShellSnapshot = {
    snapshotSequence: 2,
    projects: [],
    threads: [projectThread, projectlessThread],
    updatedAt: NOW,
  };

  it("filters projectless snapshots unless the client opts in", () => {
    expect(filterProjectlessThreadsFromShell(snapshot, false).threads).toEqual([projectThread]);
    expect(filterProjectlessThreadsFromShell(snapshot, true)).toBe(snapshot);
  });

  it("filters projectless live upserts unless the client opts in", () => {
    const item = { kind: "thread-upserted" as const, sequence: 3, thread: projectlessThread };
    expect(isProjectlessCompatibleShellItem(item, false)).toBe(false);
    expect(isProjectlessCompatibleShellItem(item, true)).toBe(true);
  });
});
