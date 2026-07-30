import type {
  ProjectId,
  UsageDashboard,
  UsageGroup,
  UsageMode,
  UsageProjectBudgetKind,
  UsageSeriesPoint,
  UsageTimeRange,
} from "@t3tools/contracts";
import { ProviderDriverKind, type UsageSettings } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  DownloadIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { useUsageDashboard } from "../../hooks/useUsageDashboard";
import { ensureLocalApi } from "../../localApi";
import { usePrimaryEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  formatUsageDuration,
  formatUsagePercent,
  formatUsageTokens,
  usageProvenanceLabel,
  usageSeverity,
} from "../../lib/usagePresentation";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settings/settingsLayout";

const RANGE_LABELS: ReadonlyArray<{ value: UsageTimeRange; label: string }> = [
  { value: "current-period", label: "Current period" },
  { value: "24-hours", label: "Last 24 hours" },
  { value: "7-days", label: "Last 7 days" },
  { value: "30-days", label: "Last 30 days" },
  { value: "all", label: "All history" },
];

const MODE_DESCRIPTIONS: Record<UsageMode, string> = {
  normal: "Standard routing and warnings.",
  conserve: "Adds previews for expensive work and recommends lower-usage choices.",
  emergency: "Warns before high-usage work and preserves stronger models for important tasks.",
  unrestricted: "Tracks everything and warns without conservation restrictions.",
};

interface ProjectBudgetDraft {
  readonly kind: UsageProjectBudgetKind;
  readonly limit: string;
  readonly enforce: boolean;
}

type UsageBreakdown = "model" | "project" | "conversation" | "agent" | "task" | "outcome";

const BREAKDOWN_LABELS: ReadonlyArray<{ value: UsageBreakdown; label: string }> = [
  { value: "model", label: "Model" },
  { value: "project", label: "Project" },
  { value: "conversation", label: "Conversation" },
  { value: "agent", label: "Agent" },
  { value: "task", label: "Task" },
  { value: "outcome", label: "Productive / waste" },
];

const SEVERITY_BAR_CLASS = {
  normal: "bg-emerald-500",
  elevated: "bg-yellow-500",
  warning: "bg-amber-500",
  critical: "bg-orange-500",
  exhausted: "bg-destructive",
} as const;

function formatDateTime(value: string | null): string {
  if (!value) return "Unavailable";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)
    : "Unavailable";
}

function formatRate(value: number | null): string {
  return value === null ? "Insufficient data" : `${value.toFixed(1)}% / day`;
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string | undefined;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium tabular-nums text-foreground">{value}</dd>
      {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function TimelineChart({
  points,
  label,
}: {
  points: ReadonlyArray<UsageSeriesPoint>;
  label: string;
}) {
  const max = Math.max(0, ...points.map((point) => point.quotaUnits));
  return (
    <div className="min-w-0 px-3 sm:px-4">
      {points.length === 0 ? (
        <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
          No activity in this range.
        </div>
      ) : (
        <div className="flex h-24 items-end gap-1" role="img" aria-label={label}>
          {points.map((point) => {
            const height = max > 0 ? Math.max(3, (point.quotaUnits / max) * 100) : 3;
            return (
              <div
                key={point.startAt}
                className="group relative flex min-w-0 flex-1 items-end self-stretch"
                title={`${formatDateTime(point.startAt)} · ${formatUsageTokens(point.quotaUnits)} units · ${point.requests} requests`}
              >
                <div
                  className="w-full rounded-[2px] bg-foreground/20 transition-colors group-hover:bg-foreground/35"
                  style={{ height: `${height}%` }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GroupChart({
  groups,
  emptyLabel,
}: {
  groups: ReadonlyArray<UsageGroup>;
  emptyLabel: string;
}) {
  const visible = groups.slice(0, 6);
  const max = Math.max(0, ...visible.map((group) => group.quotaUnits));
  return (
    <div className="min-w-0 px-3 sm:px-4">
      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="divide-y divide-border/60">
          {visible.map((group) => (
            <div key={group.key} className="py-2.5">
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="min-w-0 truncate text-foreground/90">{group.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {group.percentageOfTotal.toFixed(1)}% · {group.requests} req
                </span>
              </div>
              <div className="mt-1.5 h-px overflow-hidden bg-border/60">
                <div
                  className="h-full bg-foreground/50"
                  style={{ width: `${max > 0 ? (group.quotaUnits / max) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WeeklySummary({ data }: { data: UsageDashboard }) {
  const { summary, forecast } = data;
  const used = summary.usedPercent;
  const severity = usageSeverity(used);
  const width = used === null ? 0 : Math.min(100, Math.max(0, used));
  const forecastValue = forecast.predictedExhaustionAt
    ? formatDateTime(forecast.predictedExhaustionAt)
    : forecast.onTrackToReset
      ? "On track"
      : "Insufficient data";
  const forecastDetail =
    forecast.predictedRemainingAtReset === null
      ? forecast.confidence === "unavailable"
        ? undefined
        : `${forecast.confidence} confidence`
      : `${forecast.predictedRemainingAtReset.toFixed(1)}% expected at reset`;

  return (
    <div className="px-3 sm:px-4">
      <div className="flex flex-col gap-3 py-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-2xl font-semibold tracking-tight tabular-nums">
            {formatUsagePercent(used, 0)} used
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {summary.remainingPercent === null
              ? "Remaining allowance unavailable"
              : `${summary.remainingPercent.toFixed(1)}% remaining`}
            {summary.resetAt ? ` · resets ${formatDateTime(summary.resetAt)}` : ""}
          </p>
        </div>
        <p className="text-xs text-muted-foreground sm:text-right">
          {usageProvenanceLabel(summary.source, summary.confidence)}
          <span aria-hidden="true"> · </span>
          <span className="capitalize">{summary.activeMode} mode</span>
        </p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-sm bg-muted">
        <div
          className={cn("h-full transition-[width]", SEVERITY_BAR_CLASS[severity])}
          style={{ width: `${width}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{formatUsageDuration(summary.resetAt)}</p>
      <dl className="mt-4 grid gap-4 border-t border-border/60 pt-4 sm:grid-cols-3">
        <Metric
          label="Burn rate"
          value={formatRate(forecast.currentBurnRate)}
          detail={
            forecast.safeDailyRate === null
              ? undefined
              : `Safe rate ${forecast.safeDailyRate.toFixed(1)}% / day`
          }
        />
        <Metric label="Forecast" value={forecastValue} detail={forecastDetail} />
        <Metric
          label="Safe budget"
          value={
            forecast.safeDailyRate === null
              ? "Unavailable"
              : `${forecast.safeDailyRate.toFixed(1)}% / day`
          }
          detail={
            forecast.safeRemainingToday === null
              ? undefined
              : `${forecast.safeRemainingToday.toFixed(1)}% for today`
          }
        />
      </dl>
    </div>
  );
}

function SettingsControls({
  settings,
  onChange,
}: {
  settings: UsageSettings;
  onChange: (patch: Partial<UsageSettings>) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <SettingsSection title="Usage controls">
      <SettingsRow
        title="Usage mode"
        description={MODE_DESCRIPTIONS[settings.selectedMode]}
        control={
          <Select
            value={settings.selectedMode}
            onValueChange={(value) => onChange({ selectedMode: value as UsageMode })}
          >
            <SelectTrigger className="w-full sm:w-40" aria-label="Usage mode">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {(["normal", "conserve", "emergency", "unrestricted"] as const).map((mode) => (
                <SelectItem key={mode} value={mode} hideIndicator>
                  <span className="capitalize">{mode}</span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {settings.selectedMode === "unrestricted" ? (
        <SettingsRow
          title="Unrestricted duration"
          description="Leave blank to keep it active until you change modes."
          control={
            <Input
              nativeInput
              type="datetime-local"
              className="w-full sm:w-52"
              aria-label="Unrestricted mode end time"
              defaultValue={
                settings.unrestrictedUntil === null ? "" : settings.unrestrictedUntil.slice(0, 16)
              }
              onBlur={(event) => {
                const value = event.currentTarget.value;
                onChange({
                  unrestrictedUntil: value.trim() === "" ? null : new Date(value).toISOString(),
                });
              }}
            />
          }
        />
      ) : null}
      <SettingsRow
        title="Notifications and limits"
        description="Automatic modes, alerts, request previews, and status display."
        control={
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? "Hide" : "Configure"}
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform", detailsOpen && "rotate-180")}
            />
          </Button>
        }
      />
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <CollapsibleContent>
          <div className="border-y border-border/50 py-1">
            <SettingsRow
              title="Automatic mode transitions"
              description={`Conserve at ${settings.conserveAtPercent}%; Emergency at ${settings.emergencyAtPercent}%.`}
              control={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Input
                    nativeInput
                    size="sm"
                    className="w-20"
                    type="number"
                    min={0}
                    max={100}
                    aria-label="Conserve mode threshold percent"
                    defaultValue={settings.conserveAtPercent}
                    onBlur={(event) =>
                      onChange({ conserveAtPercent: Number(event.currentTarget.value) })
                    }
                  />
                  <Input
                    nativeInput
                    size="sm"
                    className="w-20"
                    type="number"
                    min={0}
                    max={100}
                    aria-label="Emergency mode threshold percent"
                    defaultValue={settings.emergencyAtPercent}
                    onBlur={(event) =>
                      onChange({ emergencyAtPercent: Number(event.currentTarget.value) })
                    }
                  />
                  <Switch
                    checked={settings.automaticModeTransitions}
                    onCheckedChange={(checked) =>
                      onChange({ automaticModeTransitions: Boolean(checked) })
                    }
                  />
                </div>
              }
            />
            <SettingsRow
              title="In-app notifications"
              description="Show usage and pacing warnings."
              control={
                <Switch
                  checked={settings.notificationsEnabled}
                  onCheckedChange={(checked) =>
                    onChange({ notificationsEnabled: Boolean(checked) })
                  }
                />
              }
            />
            <SettingsRow
              title="Desktop notifications"
              description="Notify through the operating system."
              control={
                <Switch
                  checked={settings.desktopNotificationsEnabled}
                  onCheckedChange={(checked) => {
                    const enabled = Boolean(checked);
                    onChange({ desktopNotificationsEnabled: enabled });
                    if (
                      enabled &&
                      typeof Notification !== "undefined" &&
                      Notification.permission === "default"
                    ) {
                      void Notification.requestPermission();
                    }
                  }}
                />
              }
            />
            <SettingsRow
              title="Advanced alerts"
              description="Thresholds, quiet hours, and expensive-request detection."
              control={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  {advancedOpen ? "Hide" : "Show"}
                  <ChevronDownIcon
                    className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")}
                  />
                </Button>
              }
            />
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleContent>
                <div className="border-y border-border/50 py-1">
                  <SettingsRow
                    title="Warning thresholds"
                    description="Percentages separated by commas."
                    control={
                      <Input
                        nativeInput
                        size="sm"
                        className="w-full sm:w-52"
                        aria-label="Usage warning thresholds"
                        defaultValue={settings.warningThresholds.join(", ")}
                        onBlur={(event) => {
                          const thresholds = event.currentTarget.value
                            .split(",")
                            .map((value) => Number(value.trim()))
                            .filter((value) => Number.isFinite(value) && value >= 0 && value <= 100)
                            .sort((left, right) => left - right);
                          if (thresholds.length > 0) onChange({ warningThresholds: thresholds });
                        }}
                      />
                    }
                  />
                  <SettingsRow
                    title="Notification policy"
                    description="Cooldown minutes and local quiet hours."
                    control={
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Input
                          nativeInput
                          size="sm"
                          className="w-24"
                          type="number"
                          min={0}
                          aria-label="Notification cooldown minutes"
                          defaultValue={settings.notificationCooldownMinutes}
                          onBlur={(event) =>
                            onChange({
                              notificationCooldownMinutes: Number(event.currentTarget.value),
                            })
                          }
                        />
                        <Input
                          nativeInput
                          size="sm"
                          className="w-16"
                          type="number"
                          min={0}
                          max={23}
                          aria-label="Quiet hours start"
                          defaultValue={settings.quietHours.startHour}
                          onBlur={(event) =>
                            onChange({
                              quietHours: {
                                ...settings.quietHours,
                                startHour: Number(event.currentTarget.value),
                              },
                            })
                          }
                        />
                        <Input
                          nativeInput
                          size="sm"
                          className="w-16"
                          type="number"
                          min={0}
                          max={23}
                          aria-label="Quiet hours end"
                          defaultValue={settings.quietHours.endHour}
                          onBlur={(event) =>
                            onChange({
                              quietHours: {
                                ...settings.quietHours,
                                endHour: Number(event.currentTarget.value),
                              },
                            })
                          }
                        />
                        <Switch
                          checked={settings.quietHours.enabled}
                          aria-label="Enable quiet hours"
                          onCheckedChange={(checked) =>
                            onChange({
                              quietHours: { ...settings.quietHours, enabled: Boolean(checked) },
                            })
                          }
                        />
                      </div>
                    }
                  />
                  <SettingsRow
                    title="Expensive activity detection"
                    description="Weekly %, token count, and retry threshold."
                    control={
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Input
                          nativeInput
                          size="sm"
                          className="w-20"
                          type="number"
                          min={0}
                          max={100}
                          step="0.1"
                          aria-label="Expensive request percent threshold"
                          defaultValue={settings.expensiveRequestPercent}
                          onBlur={(event) =>
                            onChange({ expensiveRequestPercent: Number(event.currentTarget.value) })
                          }
                        />
                        <Input
                          nativeInput
                          size="sm"
                          className="w-28"
                          type="number"
                          min={0}
                          aria-label="Expensive request token threshold"
                          defaultValue={settings.expensiveRequestTokens}
                          onBlur={(event) =>
                            onChange({ expensiveRequestTokens: Number(event.currentTarget.value) })
                          }
                        />
                        <Input
                          nativeInput
                          size="sm"
                          className="w-20"
                          type="number"
                          min={1}
                          aria-label="Retry loop threshold"
                          defaultValue={settings.retryLoopThreshold}
                          onBlur={(event) =>
                            onChange({ retryLoopThreshold: Number(event.currentTarget.value) })
                          }
                        />
                      </div>
                    }
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
            <SettingsRow
              title="Request preview"
              description={`Confirm requests above ${formatUsageTokens(settings.requestPreviewTokenThreshold)} estimated tokens.`}
              control={
                <div className="flex items-center gap-2">
                  <Input
                    nativeInput
                    size="sm"
                    className="w-28"
                    type="number"
                    min={0}
                    aria-label="Request preview token threshold"
                    defaultValue={settings.requestPreviewTokenThreshold}
                    onBlur={(event) =>
                      onChange({ requestPreviewTokenThreshold: Number(event.currentTarget.value) })
                    }
                  />
                  <Switch
                    checked={settings.requestPreviewEnabled}
                    onCheckedChange={(checked) =>
                      onChange({ requestPreviewEnabled: Boolean(checked) })
                    }
                  />
                </div>
              }
            />
            <SettingsRow
              title="Status-bar indicator"
              description="Show usage beside the composer."
              control={
                <Switch
                  checked={settings.statusWidgetVisible}
                  onCheckedChange={(checked) => onChange({ statusWidgetVisible: Boolean(checked) })}
                />
              }
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </SettingsSection>
  );
}

export function UsageDashboardPanel() {
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId = primaryEnvironment?.environmentId ?? null;
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const [range, setRange] = useState<UsageTimeRange>("current-period");
  const [breakdown, setBreakdown] = useState<UsageBreakdown>("model");
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const { data, error, isPending, refresh } = useUsageDashboard({ environmentId, range });
  const exportUsage = useAtomCommand(serverEnvironment.exportUsage, { reportFailure: false });
  const importUsage = useAtomCommand(serverEnvironment.importUsage, { reportFailure: false });
  const calibrateUsage = useAtomCommand(serverEnvironment.calibrateUsage, { reportFailure: false });
  const clearUsage = useAtomCommand(serverEnvironment.clearUsage, { reportFailure: false });
  const setProjectBudget = useAtomCommand(serverEnvironment.setUsageProjectBudget, {
    reportFailure: false,
  });
  const importRef = useRef<HTMLInputElement | null>(null);
  const [calibrationPercent, setCalibrationPercent] = useState("");
  const [calibrationReset, setCalibrationReset] = useState("");
  const [calibrationProvider, setCalibrationProvider] = useState("codex");
  const [calibrationAllowance, setCalibrationAllowance] = useState("");
  const [budgetDrafts, setBudgetDrafts] = useState<Record<string, ProjectBudgetDraft>>({});
  const presentedNotificationKeys = useRef(new Set<string>());

  useEffect(() => {
    if (!data) return;
    setBudgetDrafts((current) => {
      const next = { ...current };
      for (const budget of data.projectBudgets) {
        next[budget.projectId] = {
          kind: budget.kind,
          limit: String(budget.limit),
          enforce: budget.enforce,
        };
      }
      return next;
    });
  }, [data]);

  useEffect(() => {
    if (!data || !settings.usage.notificationsEnabled) return;
    const hour = new Date().getHours();
    const quiet = settings.usage.quietHours;
    const inQuietHours =
      quiet.enabled &&
      (quiet.startHour <= quiet.endHour
        ? hour >= quiet.startHour && hour < quiet.endHour
        : hour >= quiet.startHour || hour < quiet.endHour);
    if (inQuietHours) return;
    for (const notification of data.pendingNotifications) {
      if (presentedNotificationKeys.current.has(notification.key)) continue;
      presentedNotificationKeys.current.add(notification.key);
      toastManager.add(
        stackedThreadToast({
          type: notification.severity === "info" ? "info" : "warning",
          title: notification.title,
          description: notification.message,
        }),
      );
    }
  }, [data, settings.usage.notificationsEnabled, settings.usage.quietHours]);

  const patchUsageSettings = useCallback(
    (patch: Partial<UsageSettings>) => {
      updateSettings({ usage: { ...settings.usage, ...patch } });
    },
    [settings.usage, updateSettings],
  );

  const reportFailure = useCallback((title: string, result: { _tag: string }) => {
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result as never)) return;
    const failure = squashAtomCommandFailure(result as never);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: failure instanceof Error ? failure.message : "The operation failed.",
      }),
    );
  }, []);

  const download = useCallback(
    async (format: "json" | "csv") => {
      if (!environmentId) return;
      const result = await exportUsage({ environmentId, input: { format, range } });
      if (result._tag === "Failure") {
        reportFailure("Could not export usage history", result);
        return;
      }
      const url = URL.createObjectURL(
        new Blob([result.value.content], { type: result.value.mimeType }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.value.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    [environmentId, exportUsage, range, reportFailure],
  );

  const importFile = useCallback(
    async (file: File) => {
      if (!environmentId) return;
      const result = await importUsage({
        environmentId,
        input: { content: await file.text() },
      });
      if (result._tag === "Failure") {
        reportFailure("Could not import usage history", result);
        return;
      }
      toastManager.add({
        type: "success",
        title: "Usage history imported",
        description: `${result.value.inserted} added, ${result.value.duplicates} duplicates, ${result.value.invalid} invalid.`,
      });
      refresh();
    },
    [environmentId, importUsage, refresh, reportFailure],
  );

  const calibrate = useCallback(async () => {
    if (!environmentId || calibrationPercent.trim() === "" || calibrationReset.trim() === "")
      return;
    const resetDate = new Date(calibrationReset);
    const usedPercent = Number(calibrationPercent);
    const totalWeeklyAllowance =
      calibrationAllowance.trim() === "" ? null : Number(calibrationAllowance);
    if (
      !Number.isFinite(resetDate.getTime()) ||
      !Number.isFinite(usedPercent) ||
      usedPercent < 0 ||
      usedPercent > 100 ||
      (totalWeeklyAllowance !== null &&
        (!Number.isFinite(totalWeeklyAllowance) || totalWeeklyAllowance <= 0))
    ) {
      toastManager.add({
        type: "warning",
        title: "Check the calibration values",
        description: "Usage must be 0–100 and an optional weekly allowance must be positive.",
      });
      return;
    }
    const result = await calibrateUsage({
      environmentId,
      input: {
        provider: ProviderDriverKind.make(calibrationProvider),
        usedPercent,
        resetAt: resetDate.toISOString(),
        ...(totalWeeklyAllowance === null ? {} : { totalWeeklyAllowance }),
      },
    });
    if (result._tag === "Failure") {
      reportFailure("Could not save calibration", result);
      return;
    }
    setCalibrationPercent("");
    setCalibrationReset("");
    refresh();
  }, [
    calibrateUsage,
    calibrationAllowance,
    calibrationPercent,
    calibrationProvider,
    calibrationReset,
    environmentId,
    refresh,
    reportFailure,
  ]);

  const confirmManualReset = useCallback(async () => {
    if (!environmentId || calibrationReset.trim() === "") return;
    const resetDate = new Date(calibrationReset);
    if (!Number.isFinite(resetDate.getTime())) return;
    const confirmed = await ensureLocalApi().dialogs.confirm(
      "Confirm that the provider usage period has reset?\n\nThe previous period will be closed, notification thresholds will reset, and history will be preserved.",
    );
    if (!confirmed) return;
    const result = await calibrateUsage({
      environmentId,
      input: {
        provider: ProviderDriverKind.make(calibrationProvider),
        usedPercent: 0,
        resetAt: resetDate.toISOString(),
        confirmReset: true,
      },
    });
    if (result._tag === "Failure") {
      reportFailure("Could not confirm the usage reset", result);
      return;
    }
    refresh();
  }, [
    calibrateUsage,
    calibrationProvider,
    calibrationReset,
    environmentId,
    refresh,
    reportFailure,
  ]);

  const clearHistory = useCallback(async () => {
    if (!environmentId) return;
    const confirmed = await ensureLocalApi().dialogs.confirm(
      "Clear all local AI usage history?\n\nThis cannot be undone. Export a JSON backup first if you may need it.",
    );
    if (!confirmed) return;
    const result = await clearUsage({
      environmentId,
      input: { confirmation: "clear-usage-history" },
    });
    if (result._tag === "Failure") {
      reportFailure("Could not clear usage history", result);
      return;
    }
    refresh();
  }, [clearUsage, environmentId, refresh, reportFailure]);

  const saveProjectBudget = useCallback(
    async (projectId: ProjectId, draft: ProjectBudgetDraft) => {
      if (!environmentId) return;
      const limit = Number(draft.limit);
      if (!Number.isFinite(limit) || limit <= 0) return;
      const result = await setProjectBudget({
        environmentId,
        input: {
          projectId,
          budget: {
            projectId,
            kind: draft.kind,
            limit,
            warnAtPercent: 80,
            enforce: draft.enforce,
          },
        },
      });
      if (result._tag === "Failure") {
        reportFailure("Could not save project budget", result);
        return;
      }
      refresh();
    },
    [environmentId, refresh, reportFailure, setProjectBudget],
  );

  const wastePercent = useMemo(() => {
    if (!data || data.summary.totalQuotaUnits <= 0) return 0;
    return (
      ((data.summary.totalQuotaUnits - data.summary.productiveQuotaUnits) /
        data.summary.totalQuotaUnits) *
      100
    );
  }, [data]);

  const breakdownData = useMemo(() => {
    if (!data) return { groups: [] as ReadonlyArray<UsageGroup>, emptyLabel: "No data yet." };
    const outcomeGroups: ReadonlyArray<UsageGroup> = [
      {
        key: "productive",
        label: "Productive",
        requests: data.summary.successfulRequests,
        totalTokens: data.summary.productiveTokens,
        productiveTokens: data.summary.productiveTokens,
        quotaUnits: data.summary.productiveQuotaUnits,
        productiveQuotaUnits: data.summary.productiveQuotaUnits,
        percentageOfTotal: 100 - wastePercent,
        failures: 0,
        retries: 0,
      },
      {
        key: "waste",
        label: "Retries / failures",
        requests: data.summary.failedRequests + data.summary.retryRequests,
        totalTokens: data.summary.totalTokens - data.summary.productiveTokens,
        productiveTokens: 0,
        quotaUnits: data.summary.totalQuotaUnits - data.summary.productiveQuotaUnits,
        productiveQuotaUnits: 0,
        percentageOfTotal: wastePercent,
        failures: data.summary.failedRequests,
        retries: data.summary.retryRequests,
      },
    ];
    switch (breakdown) {
      case "project":
        return { groups: data.byProject, emptyLabel: "No project data yet." };
      case "conversation":
        return { groups: data.byConversation, emptyLabel: "No conversation data yet." };
      case "agent":
        return { groups: data.byAgent, emptyLabel: "No agent data yet." };
      case "task":
        return { groups: data.byTask, emptyLabel: "No task labels yet." };
      case "outcome":
        return { groups: outcomeGroups, emptyLabel: "No request data yet." };
      case "model":
        return { groups: data.byModel, emptyLabel: "No model data yet." };
    }
  }, [breakdown, data, wastePercent]);

  return (
    <SettingsPageContainer className="gap-10 overflow-x-hidden">
      {error ? (
        <div className="px-3 text-sm text-destructive sm:px-4">
          Usage data could not be loaded: {error}
        </div>
      ) : null}
      {!data && isPending ? (
        <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
          Loading local usage history…
        </div>
      ) : null}
      {data ? (
        <>
          <SettingsSection
            title="Weekly usage"
            headerAction={
              <div className="flex items-center gap-1.5">
                <Select value={range} onValueChange={(value) => setRange(value as UsageTimeRange)}>
                  <SelectTrigger size="sm" className="w-36" aria-label="Usage time range">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {RANGE_LABELS.map((option) => (
                      <SelectItem key={option.value} value={option.value} hideIndicator>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <Button size="icon-sm" variant="ghost" aria-label="Refresh usage" onClick={refresh}>
                  <RefreshCwIcon className={cn(isPending && "animate-spin")} />
                </Button>
              </div>
            }
          >
            <WeeklySummary data={data} />
          </SettingsSection>
          {data.summary.missingData ? (
            <div className="flex gap-2 px-3 text-xs text-amber-700 dark:text-amber-300 sm:px-4">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              Some usage is estimated or unavailable; tracked totals may be incomplete.
            </div>
          ) : null}

          <SettingsSection
            title={range === "24-hours" ? "Hourly activity" : "Daily activity"}
            headerAction={
              <span className="text-xs text-muted-foreground">
                {formatUsageTokens(data.summary.totalQuotaUnits)} units
              </span>
            }
          >
            <TimelineChart
              points={range === "24-hours" ? data.hourly : data.daily}
              label={range === "24-hours" ? "Usage by hour" : "Usage by day"}
            />
            <dl className="grid gap-4 border-t border-border/60 px-3 pt-3 sm:grid-cols-4 sm:px-4">
              <Metric label="Since reset" value={formatRate(data.forecast.averageDailyRate)} />
              <Metric label="Last 24h" value={formatRate(data.forecast.last24HourRate)} />
              <Metric label="Last 3d" value={formatRate(data.forecast.last3DayRate)} />
              <Metric
                label="Retry waste"
                value={`${wastePercent.toFixed(1)}%`}
                detail={`${data.summary.retryRequests} retries · ${data.summary.failedRequests} failed`}
              />
            </dl>
          </SettingsSection>

          <SettingsSection
            title="Breakdown"
            headerAction={
              <Select
                value={breakdown}
                onValueChange={(value) => setBreakdown(value as UsageBreakdown)}
              >
                <SelectTrigger size="sm" className="w-40" aria-label="Usage breakdown">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {BREAKDOWN_LABELS.map((option) => (
                    <SelectItem key={option.value} value={option.value} hideIndicator>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          >
            <GroupChart groups={breakdownData.groups} emptyLabel={breakdownData.emptyLabel} />
          </SettingsSection>

          <SettingsSection title="Project budgets">
            <SettingsRow
              title="Per-project limits"
              description="Optional warnings or enforcement for tracked projects."
              control={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  aria-expanded={budgetsOpen}
                  onClick={() => setBudgetsOpen((open) => !open)}
                >
                  {budgetsOpen ? "Hide" : "Manage"}
                  <ChevronDownIcon
                    className={cn("size-3.5 transition-transform", budgetsOpen && "rotate-180")}
                  />
                </Button>
              }
            />
            <Collapsible open={budgetsOpen} onOpenChange={setBudgetsOpen}>
              <CollapsibleContent>
                <div className="divide-y divide-border/60 border-y border-border/50">
                  {data.byProject.filter((group) => group.key !== "unknown").length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No tracked projects yet.
                    </p>
                  ) : (
                    data.byProject
                      .filter((group) => group.key !== "unknown")
                      .slice(0, 12)
                      .map((group) => (
                        <div key={group.key} className="px-3 py-3 sm:px-4">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{group.label}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {group.percentageOfTotal.toFixed(1)}% of usage · {group.retries}{" "}
                              retries
                            </div>
                          </div>
                          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                            <Select
                              value={budgetDrafts[group.key]?.kind ?? "weekly-percent"}
                              onValueChange={(kind) =>
                                setBudgetDrafts((current) => ({
                                  ...current,
                                  [group.key]: {
                                    kind: kind as UsageProjectBudgetKind,
                                    limit: current[group.key]?.limit ?? "",
                                    enforce: current[group.key]?.enforce ?? false,
                                  },
                                }))
                              }
                            >
                              <SelectTrigger
                                size="sm"
                                className="w-36"
                                aria-label={`${group.label} budget unit`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectPopup>
                                <SelectItem value="weekly-percent" hideIndicator>
                                  Weekly %
                                </SelectItem>
                                <SelectItem value="tokens" hideIndicator>
                                  Tokens
                                </SelectItem>
                                <SelectItem value="quota-units" hideIndicator>
                                  Quota units
                                </SelectItem>
                                <SelectItem value="requests" hideIndicator>
                                  Requests
                                </SelectItem>
                              </SelectPopup>
                            </Select>
                            <Input
                              nativeInput
                              size="sm"
                              className="w-24"
                              type="number"
                              min={0.1}
                              max={100}
                              step="0.1"
                              aria-label={`${group.label} weekly budget percent`}
                              placeholder="Weekly %"
                              value={budgetDrafts[group.key]?.limit ?? ""}
                              onChange={(event) =>
                                setBudgetDrafts((current) => ({
                                  ...current,
                                  [group.key]: {
                                    kind: current[group.key]?.kind ?? "weekly-percent",
                                    limit: event.currentTarget.value,
                                    enforce: current[group.key]?.enforce ?? false,
                                  },
                                }))
                              }
                            />
                            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Switch
                                checked={budgetDrafts[group.key]?.enforce ?? false}
                                aria-label={`Enforce ${group.label} budget`}
                                onCheckedChange={(checked) =>
                                  setBudgetDrafts((current) => ({
                                    ...current,
                                    [group.key]: {
                                      kind: current[group.key]?.kind ?? "weekly-percent",
                                      limit: current[group.key]?.limit ?? "",
                                      enforce: Boolean(checked),
                                    },
                                  }))
                                }
                              />
                              Enforce
                            </label>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() =>
                                void saveProjectBudget(
                                  group.key as ProjectId,
                                  budgetDrafts[group.key] ?? {
                                    kind: "weekly-percent",
                                    limit: "",
                                    enforce: false,
                                  },
                                )
                              }
                            >
                              Save
                            </Button>
                          </div>
                        </div>
                      ))
                  )}
                </div>
                <p className="px-4 pt-2 text-xs text-muted-foreground">
                  Warnings start at 80%. Blocking only applies when enforcement is enabled.
                </p>
              </CollapsibleContent>
            </Collapsible>
          </SettingsSection>

          <SettingsSection title="Expensive activity">
            {data.expensiveActivities.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                No unusual activity in this range.
              </div>
            ) : (
              <div className="divide-y divide-border/60 px-3 sm:px-4">
                {data.expensiveActivities.slice(0, 6).map((item) => (
                  <div key={item.id} className="flex gap-3 py-3">
                    <AlertTriangleIcon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        item.severity === "critical"
                          ? "text-destructive"
                          : item.severity === "warning"
                            ? "text-amber-500"
                            : "text-muted-foreground",
                      )}
                    />
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium">{item.title}</h3>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {item.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SettingsSection>

          <SettingsControls settings={settings.usage} onChange={patchUsageSettings} />

          <SettingsSection title="Calibration">
            <SettingsRow
              title="Provider checkpoint"
              description={
                data.latestCalibration
                  ? `Last calibrated ${formatDateTime(data.latestCalibration.recordedAt)} at ${data.latestCalibration.providerUsedPercent.toFixed(1)}%.`
                  : "Improve estimates with a provider usage reading."
              }
              control={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  aria-expanded={calibrationOpen}
                  onClick={() => setCalibrationOpen((open) => !open)}
                >
                  {calibrationOpen ? "Hide" : "Calibrate"}
                  <ChevronDownIcon
                    className={cn("size-3.5 transition-transform", calibrationOpen && "rotate-180")}
                  />
                </Button>
              }
            />
            <Collapsible open={calibrationOpen} onOpenChange={setCalibrationOpen}>
              <CollapsibleContent>
                <div className="grid gap-2 border-y border-border/50 px-3 py-3 sm:grid-cols-2 sm:px-4">
                  <Select
                    value={calibrationProvider}
                    onValueChange={(value) => {
                      if (value !== null) setCalibrationProvider(value);
                    }}
                  >
                    <SelectTrigger aria-label="Calibration provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {["codex", "claudeAgent", "cursor", "grok", "opencode"].map((provider) => (
                        <SelectItem key={provider} value={provider} hideIndicator>
                          {provider === "claudeAgent" ? "Claude Agent" : provider}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <Input
                    nativeInput
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    placeholder="Used %"
                    value={calibrationPercent}
                    onChange={(event) => setCalibrationPercent(event.currentTarget.value)}
                  />
                  <Input
                    nativeInput
                    type="datetime-local"
                    value={calibrationReset}
                    onChange={(event) => setCalibrationReset(event.currentTarget.value)}
                  />
                  <Input
                    nativeInput
                    type="number"
                    min={0}
                    step="1"
                    placeholder="Weekly units"
                    value={calibrationAllowance}
                    onChange={(event) => setCalibrationAllowance(event.currentTarget.value)}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void calibrate()}>
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void confirmManualReset()}>
                      Confirm reset
                    </Button>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </SettingsSection>

          <SettingsSection title="Local data">
            <SettingsRow
              title="Import and export"
              description="Back up as JSON or export CSV for analysis."
              control={
                <div className="flex flex-wrap gap-2">
                  <Button size="xs" variant="outline" onClick={() => void download("json")}>
                    <DownloadIcon /> JSON
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => void download("csv")}>
                    <DownloadIcon /> CSV
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => importRef.current?.click()}>
                    <UploadIcon /> Import
                  </Button>
                  <input
                    ref={importRef}
                    className="hidden"
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void importFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </div>
              }
            />
            <SettingsRow
              title="Clear usage history"
              description="Permanently delete local usage data after confirmation."
              control={
                <Button size="xs" variant="destructive-outline" onClick={() => void clearHistory()}>
                  <Trash2Icon /> Clear history
                </Button>
              }
            />
          </SettingsSection>
        </>
      ) : null}
    </SettingsPageContainer>
  );
}
