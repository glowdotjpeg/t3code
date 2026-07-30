import type { EnvironmentId, ProjectId, ThreadId, UsageTimeRange } from "@t3tools/contracts";
import { useEffect } from "react";

import { serverEnvironment } from "../state/server";
import { useEnvironmentQuery } from "../state/query";

export function useUsageDashboard(input: {
  readonly environmentId: EnvironmentId | null;
  readonly range?: UsageTimeRange;
  readonly projectId?: ProjectId | null;
  readonly conversationId?: ThreadId | null;
}) {
  const rpcInput = {
    ...(input.range === undefined ? {} : { range: input.range }),
    ...(input.projectId === null || input.projectId === undefined
      ? {}
      : { projectId: input.projectId }),
    ...(input.conversationId === null || input.conversationId === undefined
      ? {}
      : { conversationId: input.conversationId }),
  };
  const query = useEnvironmentQuery(
    input.environmentId === null
      ? null
      : serverEnvironment.usageDashboard({
          environmentId: input.environmentId,
          input: rpcInput,
        }),
  );
  useEffect(() => {
    if (input.environmentId === null) return;
    const interval = window.setInterval(query.refresh, 30_000);
    return () => window.clearInterval(interval);
  }, [input.environmentId, query.refresh]);
  return query;
}
