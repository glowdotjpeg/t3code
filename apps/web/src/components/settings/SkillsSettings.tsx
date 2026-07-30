import { useAtomValue } from "@effect/atom-react";
import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderInstanceId,
  type ProviderSkillCreateScope,
  type ServerProvider,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { FolderOpenIcon, PlusIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  formatProviderSkillDisplayName,
  formatProviderSkillInstallSource,
} from "../../providerSkillPresentation";
import { usePrimaryEnvironment } from "../../state/environments";
import { primaryServerProvidersAtom, serverEnvironment } from "../../state/server";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function providerLabel(provider: ServerProvider): string {
  return provider.displayName ?? PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver;
}

function skillDirectory(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, "");
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function SkillRow({
  provider,
  skill,
  pending,
  onToggle,
  onOpen,
}: {
  provider: ServerProvider;
  skill: ServerProviderSkill;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
  onOpen: () => void;
}) {
  const canToggle = provider.skillManagement?.canToggle === true;
  const description = skill.shortDescription ?? skill.description;

  return (
    <div className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border/45 px-3 py-3 last:border-b-0 sm:px-4">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {formatProviderSkillDisplayName(skill)}
          </span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {formatProviderSkillInstallSource(skill)}
          </span>
          {!skill.enabled ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">Disabled</span>
          ) : null}
        </div>
        {description ? (
          <p className="mt-0.5 line-clamp-1 text-xs leading-5 text-muted-foreground/80">
            {description}
          </p>
        ) : null}
        <p className="mt-0.5 truncate font-mono text-[10px] leading-4 text-muted-foreground/55">
          {skill.path}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Open ${formatProviderSkillDisplayName(skill)} in file browser`}
                onClick={onOpen}
              >
                <FolderOpenIcon className="size-3.5" />
              </Button>
            }
          />
          <TooltipPopup side="top">Open in file browser</TooltipPopup>
        </Tooltip>
        {canToggle ? (
          <Switch
            checked={skill.enabled}
            disabled={pending}
            onCheckedChange={(checked) => onToggle(Boolean(checked))}
            aria-label={`${skill.enabled ? "Disable" : "Enable"} ${formatProviderSkillDisplayName(skill)}`}
          />
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex">
                  <Switch checked={skill.enabled} disabled aria-label="Provider-managed skill" />
                </span>
              }
            />
            <TooltipPopup side="top">
              {providerLabel(provider)} does not expose a skill enable/disable API
            </TooltipPopup>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function AddSkillDialog({
  open,
  providers,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  providers: ReadonlyArray<ServerProvider>;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: {
    instanceId: ProviderInstanceId;
    name: string;
    description: string;
    scope: ProviderSkillCreateScope;
  }) => Promise<boolean>;
}) {
  const [instanceId, setInstanceId] = useState<ProviderInstanceId | null>(
    providers[0]?.instanceId ?? null,
  );
  const [scope, setScope] = useState<ProviderSkillCreateScope>("personal");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const normalizedName = name.trim();
  const nameIssue =
    normalizedName.length === 0
      ? null
      : normalizedName.length > 64 || !SKILL_NAME_PATTERN.test(normalizedName)
        ? "Use lowercase letters, numbers, and single hyphens."
        : null;
  const canSubmit =
    instanceId !== null &&
    normalizedName.length > 0 &&
    nameIssue === null &&
    description.trim().length > 0 &&
    !pending;

  useEffect(() => {
    if (!open) return;
    setInstanceId(providers[0]?.instanceId ?? null);
    setScope("personal");
    setName("");
    setDescription("");
    setPending(false);
  }, [open, providers]);

  const submit = async () => {
    if (!canSubmit || instanceId === null) return;
    setPending(true);
    const created = await onCreate({
      instanceId,
      name: normalizedName,
      description: description.trim(),
      scope,
    });
    setPending(false);
    if (created) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md overflow-hidden">
        <DialogHeader>
          <DialogTitle>New skill</DialogTitle>
          <DialogDescription>
            Creates a portable SKILL.md that appears in the composer’s $ menu.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 border-y border-border/60 bg-muted/25 px-6 py-5">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Provider</span>
            <Select
              value={instanceId ?? undefined}
              onValueChange={(value) => setInstanceId(value as ProviderInstanceId)}
            >
              <SelectTrigger className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {providers.map((provider) => (
                  <SelectItem key={provider.instanceId} value={provider.instanceId}>
                    {providerLabel(provider)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Location</span>
            <Select
              value={scope}
              onValueChange={(value) => setScope(value as ProviderSkillCreateScope)}
            >
              <SelectTrigger className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="personal">Personal · available everywhere</SelectItem>
                <SelectItem value="project">Project · this workspace only</SelectItem>
              </SelectPopup>
            </Select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Name</span>
            <Input
              value={name}
              className="bg-background"
              placeholder="review-tests"
              aria-invalid={nameIssue !== null}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
            />
            <span
              className={
                nameIssue ? "text-[11px] text-destructive" : "text-[11px] text-muted-foreground"
              }
            >
              {nameIssue ?? "This is the name used after $."}
            </span>
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">When should it be used?</span>
            <Textarea
              value={description}
              className="min-h-20 resize-none bg-background"
              maxLength={500}
              placeholder="Use when reviewing a failing test suite and proposing focused fixes."
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>
        <DialogFooter variant="bare">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={() => void submit()}>
            {pending ? "Creating…" : "Create skill"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function SkillsSettingsPanel() {
  const providers = useAtomValue(primaryServerProvidersAtom);
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId = primaryEnvironment?.environmentId ?? null;
  const setSkillEnabled = useAtomCommand(serverEnvironment.setSkillEnabled, {
    reportFailure: false,
  });
  const createSkill = useAtomCommand(serverEnvironment.createSkill, {
    reportFailure: false,
  });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const openInFileManager = useAtomCommand(shellEnvironment.openInEditor, {
    reportFailure: false,
  });
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingSkillPaths, setPendingSkillPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const skillProviders = useMemo(
    () =>
      providers.filter(
        (provider) => provider.skills.length > 0 || provider.skillManagement?.canCreate === true,
      ),
    [providers],
  );
  const creatableProviders = useMemo(
    () => providers.filter((provider) => provider.skillManagement?.canCreate === true),
    [providers],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = useMemo(
    () =>
      skillProviders
        .map((provider) => ({
          provider,
          skills: provider.skills
            .filter((skill) => {
              if (!normalizedQuery) return true;
              return [
                skill.name,
                skill.displayName,
                skill.description,
                skill.shortDescription,
                skill.path,
              ].some((value) => value?.toLowerCase().includes(normalizedQuery));
            })
            .sort((left, right) =>
              formatProviderSkillDisplayName(left).localeCompare(
                formatProviderSkillDisplayName(right),
              ),
            ),
        }))
        .filter((group) => group.skills.length > 0),
    [normalizedQuery, skillProviders],
  );
  const totalSkills = skillProviders.reduce((total, provider) => total + provider.skills.length, 0);

  const toggleSkill = useCallback(
    async (provider: ServerProvider, skill: ServerProviderSkill, enabled: boolean) => {
      if (environmentId === null) return;
      setPendingSkillPaths((previous) => new Set(previous).add(skill.path));
      setMessage(null);
      const result = await setSkillEnabled({
        environmentId,
        input: { instanceId: provider.instanceId, path: skill.path, enabled },
      });
      setPendingSkillPaths((previous) => {
        const next = new Set(previous);
        next.delete(skill.path);
        return next;
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        setMessage(
          errorMessage(
            squashAtomCommandFailure(result),
            `Unable to ${enabled ? "enable" : "disable"} the skill.`,
          ),
        );
      }
    },
    [environmentId, setSkillEnabled],
  );

  const create = useCallback(
    async (input: {
      instanceId: ProviderInstanceId;
      name: string;
      description: string;
      scope: ProviderSkillCreateScope;
    }) => {
      if (environmentId === null) return false;
      setMessage(null);
      const result = await createSkill({ environmentId, input });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          setMessage(errorMessage(squashAtomCommandFailure(result), "Unable to create the skill."));
        }
        return false;
      }
      setMessage(`Created $${input.name}.`);
      return true;
    },
    [createSkill, environmentId],
  );

  const refresh = useCallback(async () => {
    if (environmentId === null || isRefreshing) return;
    setIsRefreshing(true);
    setMessage(null);
    const result = await refreshProviders({ environmentId, input: {} });
    setIsRefreshing(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      setMessage(
        errorMessage(squashAtomCommandFailure(result), "Unable to refresh provider skills."),
      );
    }
  }, [environmentId, isRefreshing, refreshProviders]);

  const openSkill = useCallback(
    async (skill: ServerProviderSkill) => {
      if (environmentId === null) return;
      setMessage(null);
      const result = await openInFileManager({
        environmentId,
        input: { cwd: skillDirectory(skill.path), editor: "file-manager" },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        setMessage(
          errorMessage(squashAtomCommandFailure(result), "Unable to open the skill folder."),
        );
      }
    },
    [environmentId, openInFileManager],
  );

  return (
    <>
      <SettingsPageContainer>
        <SettingsSection
          title="Skills"
          headerAction={
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={environmentId === null || isRefreshing}
                      aria-label="Refresh skills"
                      onClick={() => void refresh()}
                    >
                      <RefreshCwIcon
                        className={isRefreshing ? "size-3.5 animate-spin" : "size-3.5"}
                      />
                    </Button>
                  }
                />
                <TooltipPopup side="top">Refresh skills</TooltipPopup>
              </Tooltip>
              <Button
                size="xs"
                variant="outline"
                disabled={creatableProviders.length === 0}
                onClick={() => setDialogOpen(true)}
              >
                <PlusIcon className="size-3.5" />
                New skill
              </Button>
            </div>
          }
        >
          <div className="px-3 sm:px-4">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                value={query}
                className="h-8 bg-background pl-8 text-sm"
                placeholder={`Search ${totalSkills} skill${totalSkills === 1 ? "" : "s"}`}
                aria-label="Search skills"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {message ? (
              <p className="mt-2 text-xs text-muted-foreground" role="status">
                {message}
              </p>
            ) : null}
          </div>

          <div className="mt-3 space-y-5">
            {visibleGroups.length > 0 ? (
              visibleGroups.map(({ provider, skills }) => (
                <section key={provider.instanceId}>
                  <div className="flex items-center justify-between px-3 pb-1.5 sm:px-4">
                    <div className="min-w-0">
                      <h3 className="truncate text-xs font-medium text-foreground">
                        {providerLabel(provider)}
                      </h3>
                      <p className="text-[11px] text-muted-foreground">
                        {skills.length} skill{skills.length === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <div className="mx-3 overflow-hidden rounded-xl border border-border/60 bg-card/30 sm:mx-4">
                    {skills.map((skill) => (
                      <SkillRow
                        key={skill.path}
                        provider={provider}
                        skill={skill}
                        pending={pendingSkillPaths.has(skill.path)}
                        onToggle={(enabled) => void toggleSkill(provider, skill, enabled)}
                        onOpen={() => void openSkill(skill)}
                      />
                    ))}
                  </div>
                </section>
              ))
            ) : (
              <div className="mx-3 rounded-xl border border-dashed border-border/70 px-4 py-10 text-center sm:mx-4">
                <p className="text-sm font-medium text-foreground">
                  {normalizedQuery ? "No matching skills" : "No skills found"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {normalizedQuery
                    ? "Try a different search."
                    : "Create a skill or refresh after installing one."}
                </p>
              </div>
            )}
          </div>
        </SettingsSection>
      </SettingsPageContainer>
      <AddSkillDialog
        open={dialogOpen}
        providers={creatableProviders}
        onOpenChange={setDialogOpen}
        onCreate={create}
      />
    </>
  );
}
