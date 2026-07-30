import type { EnvironmentId, ThreadId, UsageMode, UsageSettings } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { GaugeIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { useUsageDashboard } from "../../hooks/useUsageDashboard";
import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import {
  formatUsageDuration,
  formatUsagePercent,
  formatUsageTokens,
  usageProvenanceLabel,
  usageSeverity,
} from "../../lib/usagePresentation";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";

const DOT_CLASS = {
  normal: "bg-emerald-500",
  elevated: "bg-yellow-500",
  warning: "bg-amber-500",
  critical: "bg-orange-500",
  exhausted: "bg-destructive",
} as const;

export function UsageStatusWidget(props: {
  readonly environmentId: EnvironmentId;
  readonly conversationId: ThreadId | null;
  readonly settings: UsageSettings;
}) {
  const navigate = useNavigate();
  const updateSettings = useUpdateEnvironmentSettings(props.environmentId);
  const { data } = useUsageDashboard({
    environmentId: props.environmentId,
    range: "current-period",
  });
  const presentedNotificationKeys = useRef(new Set<string>());
  useEffect(() => {
    if (!data || !props.settings.notificationsEnabled) return;
    const hour = new Date().getHours();
    const quiet = props.settings.quietHours;
    const inQuietHours =
      quiet.enabled &&
      (quiet.startHour <= quiet.endHour
        ? hour >= quiet.startHour && hour < quiet.endHour
        : hour >= quiet.startHour || hour < quiet.endHour);
    for (const notification of data.pendingNotifications) {
      if (presentedNotificationKeys.current.has(notification.key)) continue;
      presentedNotificationKeys.current.add(notification.key);
      if (!inQuietHours) {
        toastManager.add(
          stackedThreadToast({
            type: notification.severity === "info" ? "info" : "warning",
            title: notification.title,
            description: notification.message,
          }),
        );
      }
      if (
        !inQuietHours &&
        props.settings.desktopNotificationsEnabled &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        const desktopNotification = new Notification(notification.title, {
          body: notification.message,
        });
        desktopNotification.addEventListener("click", () => desktopNotification.close(), {
          once: true,
        });
      }
    }
  }, [
    data,
    props.settings.desktopNotificationsEnabled,
    props.settings.notificationsEnabled,
    props.settings.quietHours,
  ]);
  if (!props.settings.statusWidgetVisible || !data) return null;

  const summary = data.summary;
  const conversation =
    data.byConversation.find((group) => group.key === props.conversationId) ?? null;
  const projectId = data.recentRecords.find(
    (record) => record.conversationId === props.conversationId,
  )?.projectId;
  const project = data.byProject.find((group) => group.key === projectId) ?? null;
  const conversationRecords = data.recentRecords.filter(
    (record) => record.conversationId === props.conversationId,
  );
  const conversationInputTokens = conversationRecords.reduce(
    (total, record) => total + (record.inputTokens ?? 0),
    0,
  );
  const conversationOutputTokens = conversationRecords.reduce(
    (total, record) => total + (record.outputTokens ?? 0),
    0,
  );
  const severity = usageSeverity(summary.usedPercent);
  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Open AI usage summary"
      >
        <span className={cn("size-1.5 rounded-full", DOT_CLASS[severity])} />
        <span className="font-medium tabular-nums">
          {summary.usedPercent === null
            ? "Usage unavailable"
            : `Weekly ${formatUsagePercent(summary.usedPercent, 0)}`}
        </span>
        <span className="hidden text-muted-foreground/60 sm:inline">
          · {formatUsageDuration(summary.resetAt)}
        </span>
      </PopoverTrigger>
      <PopoverPopup side="top" align="end" className="w-80" viewportClassName="p-0">
        <div className="border-b border-border/70 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <GaugeIcon className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">AI usage</h3>
            </div>
            <Select
              value={props.settings.selectedMode}
              onValueChange={(value) => {
                const mode = value as UsageMode;
                updateSettings({
                  usage: {
                    ...props.settings,
                    selectedMode: mode,
                  },
                });
              }}
            >
              <SelectTrigger
                size="xs"
                variant="ghost"
                className="w-auto min-w-0 capitalize"
                aria-label={`Usage mode: ${props.settings.selectedMode}`}
                title={`Usage mode: ${props.settings.selectedMode}`}
              >
                <SelectValue>{props.settings.selectedMode}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false} matchTriggerWidth={false}>
                {(["normal", "conserve", "emergency", "unrestricted"] as const).map((mode) => (
                  <SelectItem key={mode} value={mode} hideIndicator>
                    <span className="capitalize">{mode}</span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span className="text-lg font-semibold tabular-nums">
              {formatUsagePercent(summary.usedPercent)}
            </span>
            <span className="text-xs text-muted-foreground">
              {usageProvenanceLabel(summary.source, summary.confidence)}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", DOT_CLASS[severity])}
              style={{ width: `${Math.max(0, Math.min(100, summary.usedPercent ?? 0))}%` }}
            />
          </div>
        </div>
        <dl className="divide-y divide-border/60 px-3 text-xs">
          <div className="flex items-center justify-between gap-4 py-2">
            <dt className="text-muted-foreground">Burn rate</dt>
            <dd className="font-medium tabular-nums">
              {data.forecast.currentBurnRate === null
                ? "Insufficient data"
                : `${data.forecast.currentBurnRate.toFixed(1)}% / day`}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-2">
            <dt className="text-muted-foreground">At reset</dt>
            <dd className="font-medium tabular-nums">
              {data.forecast.predictedRemainingAtReset === null
                ? "Insufficient data"
                : `${data.forecast.predictedRemainingAtReset.toFixed(1)}% remaining`}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4 py-2">
            <dt className="shrink-0 text-muted-foreground">This conversation</dt>
            <dd className="min-w-0 text-right">
              <span className="block font-medium tabular-nums">
                {conversation
                  ? `${formatUsageTokens(conversation.totalTokens)} · ${conversation.requests} req`
                  : "No requests yet"}
              </span>
              {conversation ? (
                <span className="mt-0.5 block text-muted-foreground">
                  {formatUsageTokens(conversationInputTokens)} in ·{" "}
                  {formatUsageTokens(conversationOutputTokens)} out · {conversation.retries} retries
                </span>
              ) : null}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-2">
            <dt className="text-muted-foreground">Project share</dt>
            <dd className="min-w-0 truncate text-right font-medium">
              {project ? `${project.percentageOfTotal.toFixed(1)}% · ${project.label}` : "No data"}
            </dd>
          </div>
        </dl>
        {conversation && conversation.totalTokens >= 100_000 ? (
          <p className="border-t border-border/60 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            Large context; a fresh thread may reduce future input usage.
          </p>
        ) : null}
        <div className="border-t border-border/70 p-2">
          <Button
            size="sm"
            variant="ghost"
            className="w-full"
            onClick={() => void navigate({ to: "/settings/usage" })}
          >
            Usage settings
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
