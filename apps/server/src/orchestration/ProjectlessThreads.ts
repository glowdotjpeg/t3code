import type { OrchestrationShellSnapshot, OrchestrationShellStreamItem } from "@t3tools/contracts";

export function filterProjectlessThreadsFromShell(
  snapshot: OrchestrationShellSnapshot,
  includeProjectlessThreads: boolean,
): OrchestrationShellSnapshot {
  if (includeProjectlessThreads) {
    return snapshot;
  }
  return {
    ...snapshot,
    threads: snapshot.threads.filter((thread) => thread.projectId !== null),
  };
}

export function isProjectlessCompatibleShellItem(
  item: OrchestrationShellStreamItem,
  includeProjectlessThreads: boolean,
): boolean {
  return (
    includeProjectlessThreads || item.kind !== "thread-upserted" || item.thread.projectId !== null
  );
}
