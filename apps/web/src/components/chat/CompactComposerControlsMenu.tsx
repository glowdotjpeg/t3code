import { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { memo } from "react";
import { EllipsisIcon, ListTodoIcon, PencilRulerIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  activePlan: boolean;
  interactionMode: ProviderInteractionMode;
  planSidebarLabel: string;
  planSidebarOpen: boolean;
  runtimeMode: RuntimeMode;
  showInteractionModeToggle: boolean;
  onToggleInteractionMode: () => void;
  onTogglePlanSidebar: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  return (
    <>
      {props.showInteractionModeToggle && props.interactionMode === "plan" ? (
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 gap-1.5 bg-accent px-2 text-foreground"
          aria-label="Plan mode — click to return to build mode"
          onClick={props.onToggleInteractionMode}
        >
          <PencilRulerIcon aria-hidden="true" className="size-4" />
          <span>Plan</span>
        </Button>
      ) : null}
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80"
              aria-label="More composer controls"
            />
          }
        >
          <EllipsisIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="start">
          <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Access</div>
          <MenuRadioGroup
            value={props.runtimeMode}
            onValueChange={(value) => {
              if (!value || value === props.runtimeMode) return;
              props.onRuntimeModeChange(value as RuntimeMode);
            }}
          >
            <MenuRadioItem value="approval-required">Supervised</MenuRadioItem>
            <MenuRadioItem value="auto-accept-edits">Auto-accept edits</MenuRadioItem>
            <MenuRadioItem value="auto">Auto</MenuRadioItem>
            <MenuRadioItem value="full-access">Full access</MenuRadioItem>
          </MenuRadioGroup>
          {props.activePlan ? (
            <>
              <MenuDivider />
              <MenuItem onClick={props.onTogglePlanSidebar}>
                <ListTodoIcon className="size-4 shrink-0" />
                {props.planSidebarOpen
                  ? `Hide ${props.planSidebarLabel.toLowerCase()} sidebar`
                  : `Show ${props.planSidebarLabel.toLowerCase()} sidebar`}
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
    </>
  );
});
