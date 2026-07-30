import { createFileRoute } from "@tanstack/react-router";

import { UsageDashboardPanel } from "../components/usage/UsageDashboard";

function SettingsUsageRoute() {
  return <UsageDashboardPanel />;
}

export const Route = createFileRoute("/settings/usage")({
  component: SettingsUsageRoute,
});
