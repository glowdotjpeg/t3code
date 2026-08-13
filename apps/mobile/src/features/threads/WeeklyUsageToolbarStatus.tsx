import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import {
  formatWeeklyUsagePercent,
  formatWeeklyUsageReset,
  selectWeeklyUsageSnapshot,
  weeklyUsageTone,
} from "@t3tools/shared/weeklyUsage";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo } from "react";
import { Alert, View } from "react-native";

import { ComposerToolbarButton } from "../../components/ComposerToolbarTrigger";
import { cn } from "../../lib/cn";
import { useWeeklyUsage } from "../../state/usage";

const TONE_CLASS = {
  normal: "bg-green-500",
  elevated: "bg-amber-400",
  warning: "bg-orange-500",
  critical: "bg-red-500",
} as const;

export function WeeklyUsageToolbarStatus(props: {
  readonly environmentId: EnvironmentId | null;
  readonly modelSelection: ModelSelection | null;
}) {
  const { data, refresh } = useWeeklyUsage(props.environmentId);

  useEffect(() => {
    if (props.environmentId === null) return;
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [props.environmentId, refresh]);

  const active = useMemo(() => {
    if (!props.modelSelection) return null;
    return selectWeeklyUsageSnapshot(
      data?.snapshots ?? [],
      props.modelSelection.instanceId,
      props.modelSelection.model,
    );
  }, [data?.snapshots, props.modelSelection]);
  if (!active) return null;

  const used = formatWeeklyUsagePercent(active.usedPercent);
  const reset = formatWeeklyUsageReset(active.resetAt);
  const tone = weeklyUsageTone(active.usedPercent);

  return (
    <ComposerToolbarButton
      accessibilityLabel={`${active.label} allowance ${used} used. ${reset}.`}
      iconNode={<View className={cn("h-2 w-2 rounded-full", TONE_CLASS[tone])} />}
      label={used}
      showChevron={false}
      onPress={() => {
        void Haptics.selectionAsync();
        Alert.alert(
          `${active.label} allowance`,
          `${used} used · ${reset}\n\nReported by the provider. Token and cost history are tracked separately.`,
        );
      }}
    />
  );
}
