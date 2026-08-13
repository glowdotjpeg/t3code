import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { GaugeIcon } from "lucide-react";
import { useEffect, useMemo } from "react";

import { useWeeklyUsage } from "../../state/usage";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ComposerControl } from "../chat/ComposerControl";
import {
  formatWeeklyUsagePercent,
  formatWeeklyUsageReset,
  selectWeeklyUsageSnapshot,
  weeklyUsageTone,
} from "./weeklyUsagePresentation";

const TONE_CLASS = {
  normal: "bg-emerald-500 dark:bg-emerald-300/90",
  elevated: "bg-amber-400",
  warning: "bg-orange-500",
  critical: "bg-destructive",
} as const;

export function WeeklyUsageStatus(props: {
  readonly environmentId: EnvironmentId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly model: string;
  readonly compact: boolean;
}) {
  const navigate = useNavigate();
  const { data, refresh } = useWeeklyUsage(props.environmentId);

  useEffect(() => {
    const interval = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const instanceSnapshots = useMemo(
    () =>
      data?.snapshots.filter(
        (snapshot) => snapshot.providerInstanceId === props.providerInstanceId,
      ) ?? [],
    [data?.snapshots, props.providerInstanceId],
  );
  const active = selectWeeklyUsageSnapshot(
    instanceSnapshots,
    props.providerInstanceId,
    props.model,
  );
  if (!active) return null;

  const used = formatWeeklyUsagePercent(active.usedPercent);
  const reset = formatWeeklyUsageReset(active.resetAt);
  const tone = weeklyUsageTone(active.usedPercent);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <ComposerControl
            type="button"
            className="shrink-0 gap-1.5 whitespace-nowrap px-2"
            aria-label={`${active.label} allowance ${used} used. ${reset}.`}
          />
        }
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", TONE_CLASS[tone])} />
        <span className="font-medium tabular-nums">
          {props.compact ? used : `${active.label} ${used}`}
        </span>
      </PopoverTrigger>
      <PopoverPopup
        side="top"
        align="end"
        viewportClassName="p-0"
        className="w-72 max-w-none text-left whitespace-normal"
      >
        <div className="flex flex-col gap-3 p-[var(--floating-content-inset)]">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <GaugeIcon className="size-3.5" aria-hidden="true" />
              Provider allowance
            </span>
            <span className="text-[11px] text-secondary-label">{reset}</span>
          </div>

          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-foreground">{active.label}</span>
            <span className="text-sm font-semibold tabular-nums text-foreground">{used} used</span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
            role="progressbar"
            aria-label={`${active.label} usage`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(active.usedPercent)}
          >
            <div
              className={cn("h-full rounded-full", TONE_CLASS[tone])}
              style={{ width: `${Math.max(0, Math.min(100, active.usedPercent))}%` }}
            />
          </div>

          {instanceSnapshots.length > 1 ? (
            <div className="grid gap-1 border-t border-border/60 pt-2">
              {instanceSnapshots.map((snapshot) => (
                <div
                  key={snapshot.windowKind}
                  className="flex items-center justify-between gap-3 text-[11px]"
                >
                  <span className="truncate text-secondary-label">{snapshot.label}</span>
                  <span className="shrink-0 font-medium tabular-nums text-foreground">
                    {formatWeeklyUsagePercent(snapshot.usedPercent)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <p className="text-pretty text-[11px] leading-4 text-secondary-label">
            Reported by the provider. Token and cost history are tracked separately.
          </p>
        </div>
        <div className="border-t border-border/60 p-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => void navigate({ to: "/usage" })}
          >
            Open usage details
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
