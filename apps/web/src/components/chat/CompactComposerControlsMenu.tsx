import { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { memo } from "react";
import { EllipsisIcon, PencilRulerIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { shouldShowComposerPlanModeControl } from "./composerPlanMode";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  showInteractionModeToggle: boolean;
  onToggleInteractionMode: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const showPlanModeControl = shouldShowComposerPlanModeControl(
    props.showInteractionModeToggle,
    props.interactionMode,
  );

  return (
    <>
      {showPlanModeControl ? (
        <ComposerControl
          type="button"
          className="shrink-0 gap-1.5 bg-accent text-accent-foreground hover:bg-accent/80"
          aria-label="Plan mode — click to return to build mode"
          onClick={props.onToggleInteractionMode}
        >
          <ComposerControlIcon icon={PencilRulerIcon} className="text-current opacity-100" />
          <span>Plan</span>
        </ComposerControl>
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
        </MenuPopup>
      </Menu>
    </>
  );
});
