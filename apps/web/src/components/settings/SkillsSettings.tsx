import { useAtomValue } from "@effect/atom-react";
import { connectionStatusText } from "@t3tools/client-runtime/connection";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  PROVIDER_DISPLAY_NAMES,
  type EnvironmentId,
  type ProviderInstanceId,
  type ProviderSkillCreateScope,
  type ProviderSkillDocument,
  type ServerProvider,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import {
  BookOpenIcon,
  CheckIcon,
  CloudIcon,
  ExternalLinkIcon,
  FileCode2Icon,
  FolderOpenIcon,
  LaptopIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";
import { isElectron } from "../../env";
import { usePrimarySessionState } from "../../environments/primary";
import { ensureLocalApi } from "../../localApi";
import { formatProviderSkillDisplayName } from "../../providerSkillPresentation";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
  type EnvironmentPresentation,
} from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useEnvironmentSessionState } from "../../state/session";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "../../lib/utils";
import { ConnectionStatusDot, connectionPhaseDotClassName } from "../ConnectionStatusDot";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Badge } from "../ui/badge";
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
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  buildProviderEnvironmentOptions,
  resolvePrimaryOperateAccess,
  resolveRemoteOperateAccess,
  resolveSelectedProviderEnvironmentId,
} from "./ProviderSettingsPanel.logic";
import {
  filterProviderSkills,
  skillDirectory,
  skillLocationKind,
  type SkillLocationFilter,
  validateNewSkillName,
} from "./SkillsSettings.logic";
import { searchableSetting } from "./settingsSearch";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

type DialogMode = "create" | "install" | null;

const SKILL_SCOPE_LABELS: Readonly<Record<ProviderSkillCreateScope, string>> = {
  personal: "Personal · every workspace",
  project: "Project · current workspace",
};

const SKILL_LOCATION_LABELS: Readonly<Record<SkillLocationFilter, string>> = {
  all: "All locations",
  personal: "Personal",
  project: "Project",
  bundled: "Bundled",
};

function providerLabel(provider: ServerProvider): string {
  return provider.displayName ?? PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver;
}

function ProviderSelectLabel({ provider }: { readonly provider: ServerProvider }) {
  const label = providerLabel(provider);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <ProviderInstanceIcon
        driverKind={provider.driver}
        displayName={label}
        accentColor={provider.accentColor}
        className="size-4"
        iconClassName="size-3.5"
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

function skillDescription(skill: ServerProviderSkill): string {
  return skill.shortDescription ?? skill.description ?? "No description provided.";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function environmentIcon(environment: EnvironmentPresentation) {
  if (environment.entry.target._tag === "PrimaryConnectionTarget") return LaptopIcon;
  if (environment.entry.target._tag === "SshConnectionTarget") return TerminalIcon;
  if (isDesktopLocalConnectionTarget(environment.entry.target)) return LaptopIcon;
  return CloudIcon;
}

function environmentOperateAccess(
  environment: EnvironmentPresentation,
  primary: ReturnType<typeof usePrimarySessionState>,
  remote: ReturnType<typeof useEnvironmentSessionState> | null,
): "granted" | "denied" | "pending" {
  if (environment.entry.target._tag === "PrimaryConnectionTarget") {
    if (isElectron) return "granted";
    return resolvePrimaryOperateAccess({
      isPrimary: true,
      hasDesktopBridge: false,
      session: primary.data,
      isPending: primary.isPending,
      hasError: primary.error !== null,
    });
  }
  if (!remote) return "pending";
  return resolveRemoteOperateAccess({
    session: remote.data,
    isPending: remote.isPending,
    hasError: remote.hasError,
  });
}

function SkillAuthorDialog({
  mode,
  providers,
  onOpenChange,
  onCreate,
  onInstall,
}: {
  readonly mode: DialogMode;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (input: {
    instanceId: ProviderInstanceId;
    name: string;
    description: string;
    scope: ProviderSkillCreateScope;
  }) => Promise<boolean>;
  readonly onInstall: (input: {
    instanceId: ProviderInstanceId;
    source: string;
    skillName?: string;
    scope: ProviderSkillCreateScope;
  }) => Promise<boolean>;
}) {
  const [instanceId, setInstanceId] = useState<ProviderInstanceId | null>(null);
  const [scope, setScope] = useState<ProviderSkillCreateScope>("personal");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState("");
  const [skillName, setSkillName] = useState("");
  const [pending, setPending] = useState(false);

  const eligibleProviders = useMemo(
    () =>
      providers.filter((provider) =>
        mode === "create"
          ? provider.skillManagement?.canCreate
          : provider.skillManagement?.canInstall,
      ),
    [mode, providers],
  );
  const selectedProvider =
    eligibleProviders.find((provider) => provider.instanceId === instanceId) ?? null;

  useEffect(() => {
    if (!mode) return;
    setInstanceId(eligibleProviders[0]?.instanceId ?? null);
    setScope("personal");
    setName("");
    setDescription("");
    setSource("");
    setSkillName("");
    setPending(false);
  }, [eligibleProviders, mode]);

  const nameIssue = validateNewSkillName(name);
  const canSubmit =
    !pending &&
    instanceId !== null &&
    (mode === "create"
      ? name.trim().length > 0 && description.trim().length > 0 && nameIssue === null
      : source.trim().length > 0);

  const submit = async () => {
    if (!canSubmit || instanceId === null || mode === null) return;
    setPending(true);
    const succeeded =
      mode === "create"
        ? await onCreate({
            instanceId,
            name: name.trim(),
            description: description.trim(),
            scope,
          })
        : await onInstall({
            instanceId,
            source: source.trim(),
            ...(skillName.trim() ? { skillName: skillName.trim() } : {}),
            scope,
          });
    setPending(false);
    if (succeeded) onOpenChange(false);
  };

  return (
    <Dialog open={mode !== null} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Create a skill" : "Install skills"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Start with a valid SKILL.md, then finish its instructions in the editor."
              : "Add one or every valid skill from a Git repository or supported download URL."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 border-y border-border/60 bg-muted/20 px-6 py-5">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Provider</span>
            <Select
              value={instanceId ?? undefined}
              onValueChange={(value) => setInstanceId(value as ProviderInstanceId)}
            >
              <SelectTrigger>
                <SelectValue>
                  {selectedProvider ? <ProviderSelectLabel provider={selectedProvider} /> : null}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {eligibleProviders.map((provider) => (
                  <SelectItem key={provider.instanceId} value={provider.instanceId}>
                    <ProviderSelectLabel provider={provider} />
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium">Location</span>
            <Select
              value={scope}
              onValueChange={(value) => setScope(value as ProviderSkillCreateScope)}
            >
              <SelectTrigger>
                <SelectValue>{SKILL_SCOPE_LABELS[scope]}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="personal">{SKILL_SCOPE_LABELS.personal}</SelectItem>
                <SelectItem value="project">{SKILL_SCOPE_LABELS.project}</SelectItem>
              </SelectPopup>
            </Select>
          </label>
          {mode === "create" ? (
            <>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium">Name</span>
                <Input
                  autoFocus
                  value={name}
                  placeholder="review-tests"
                  aria-invalid={nameIssue !== null}
                  onChange={(event) => setName(event.currentTarget.value)}
                />
                <span
                  className={cn(
                    "text-[11px]",
                    nameIssue ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {nameIssue ?? "This is the name used after $."}
                </span>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium">When should it be used?</span>
                <Textarea
                  value={description}
                  maxLength={500}
                  className="min-h-24 resize-none"
                  placeholder="Use when reviewing a failing test suite and proposing focused fixes."
                  onChange={(event) => setDescription(event.currentTarget.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium">Repository or URL</span>
                <Input
                  autoFocus
                  value={source}
                  placeholder="vercel-labs/agent-skills"
                  onChange={(event) => setSource(event.currentTarget.value)}
                />
                <span className="text-[11px] text-muted-foreground">
                  GitHub shorthand, a Git URL, or a supported SKILL.md/archive URL.
                </span>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium">Skill name · optional</span>
                <Input
                  value={skillName}
                  placeholder="Leave empty to install every skill"
                  onChange={(event) => setSkillName(event.currentTarget.value)}
                />
              </label>
            </>
          )}
        </div>
        <DialogFooter variant="bare">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={() => void submit()}>
            {pending ? <Spinner className="size-3.5" /> : null}
            {pending
              ? mode === "create"
                ? "Creating…"
                : "Installing…"
              : mode === "create"
                ? "Create skill"
                : "Install"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function SkillListRow({
  skill,
  selected,
  onSelect,
}: {
  readonly skill: ServerProviderSkill;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const location = skillLocationKind(skill);
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "group grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "bg-primary/8 text-foreground dark:bg-primary/12" : "hover:bg-muted/45",
      )}
      onClick={onSelect}
    >
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border",
          selected
            ? "border-primary/25 bg-primary/10 text-primary"
            : "border-border/60 bg-background text-muted-foreground",
        )}
      >
        <FileCode2Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {formatProviderSkillDisplayName(skill)}
        </span>
        <span className="mt-0.5 block line-clamp-2 text-xs leading-4 text-muted-foreground">
          {skillDescription(skill)}
        </span>
      </span>
      <span className="flex items-center gap-1 pt-0.5">
        <Badge size="sm" variant="outline" className="capitalize">
          {location}
        </Badge>
        {!skill.enabled ? (
          <Badge size="sm" variant="warning">
            Off
          </Badge>
        ) : null}
      </span>
    </button>
  );
}

function SkillEditor({
  provider,
  skill,
  document,
  content,
  readOnly,
  loading,
  saving,
  onContentChange,
  onSave,
  onReload,
  onDelete,
  onToggle,
  onOpenFolder,
}: {
  readonly provider: ServerProvider;
  readonly skill: ServerProviderSkill | null;
  readonly document: ProviderSkillDocument | null;
  readonly content: string;
  readonly readOnly: boolean;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly onContentChange: (value: string) => void;
  readonly onSave: () => void;
  readonly onReload: () => void;
  readonly onDelete: () => void;
  readonly onToggle: (enabled: boolean) => void;
  readonly onOpenFolder: () => void;
}) {
  if (!skill) {
    return (
      <div className="flex min-h-96 flex-1 items-center justify-center p-8 text-center">
        <div className="max-w-xs">
          <span className="mx-auto flex size-10 items-center justify-center rounded-xl border border-border/60 bg-muted/35 text-muted-foreground">
            <BookOpenIcon className="size-4.5" />
          </span>
          <p className="mt-4 text-sm font-medium">Choose a skill</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Inspect its instructions, edit custom skills, or see where a bundled skill comes from.
          </p>
        </div>
      </div>
    );
  }

  const dirty = document !== null && content !== document.content;
  const canEdit = !readOnly && document?.editable === true;
  const canDelete = !readOnly && document?.deletable === true;
  const canToggle = !readOnly && provider.skillManagement?.canToggle === true;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 items-start gap-3 border-b border-border/60 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">
              {formatProviderSkillDisplayName(skill)}
            </h3>
            <Badge size="sm" variant="outline" className="capitalize">
              {skillLocationKind(skill)}
            </Badge>
            {dirty ? (
              <Badge size="sm" variant="info">
                Unsaved
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-4.5 text-muted-foreground">
            {skillDescription(skill)}
          </p>
          <p className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground/65">
            {skill.path}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Open skill folder"
                  onClick={onOpenFolder}
                >
                  <FolderOpenIcon className="size-3.5" />
                </Button>
              }
            />
            <TooltipPopup>Open skill folder</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button size="icon-xs" variant="ghost" aria-label="Reload skill" onClick={onReload}>
                  <RefreshCwIcon className="size-3.5" />
                </Button>
              }
            />
            <TooltipPopup>Reload from disk</TooltipPopup>
          </Tooltip>
          {canDelete ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    aria-label="Delete skill"
                    onClick={onDelete}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                }
              />
              <TooltipPopup>Delete skill</TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
      </div>
      <div className="relative min-h-0 flex-1 bg-muted/14">
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5" /> Reading SKILL.md…
            </span>
          </div>
        ) : null}
        {document ? (
          <textarea
            value={content}
            readOnly={!canEdit}
            spellCheck={false}
            aria-label={`${formatProviderSkillDisplayName(skill)} SKILL.md contents`}
            className={cn(
              "h-full min-h-96 w-full resize-none bg-transparent px-4 py-4 font-mono text-[12px] leading-5 text-foreground outline-none selection:bg-primary/20 sm:px-5",
              !canEdit && "text-muted-foreground",
            )}
            onChange={(event) => onContentChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                if (canEdit && dirty && !saving) onSave();
              }
            }}
          />
        ) : null}
      </div>
      <div className="flex min-h-12 items-center gap-3 border-t border-border/60 px-4 py-2">
        {canToggle ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={skill.enabled} onCheckedChange={(value) => onToggle(Boolean(value))} />
            Available to {providerLabel(provider)}
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">
            {document?.editable
              ? "This provider loads custom skills automatically."
              : "Bundled skills are visible here but managed by their source."}
          </p>
        )}
        <Button
          size="sm"
          className="ms-auto"
          disabled={!canEdit || !dirty || saving}
          onClick={onSave}
        >
          {saving ? <Spinner className="size-3.5" /> : <SaveIcon className="size-3.5" />}
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

export function SkillsSettingsPanel() {
  const { environments, isReady } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const options = useMemo(
    () => buildProviderEnvironmentOptions(environments, primaryEnvironmentId),
    [environments, primaryEnvironmentId],
  );
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(
    primaryEnvironmentId,
  );
  const effectiveEnvironmentId = resolveSelectedProviderEnvironmentId(
    options,
    selectedEnvironmentId,
    primaryEnvironmentId,
  );
  const selectedEnvironment =
    options.find((environment) => environment.environmentId === effectiveEnvironmentId) ?? null;

  return (
    <SettingsPageContainer className="max-w-6xl">
      {options.length > 1 ? (
        <SettingsSection title="Devices">
          <div className="grid gap-1 sm:grid-cols-2">
            {options.map((environment) => {
              const Icon = environmentIcon(environment);
              const selected = environment.environmentId === effectiveEnvironmentId;
              return (
                <button
                  key={environment.environmentId}
                  type="button"
                  aria-pressed={selected}
                  className={cn(
                    "flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors sm:px-4",
                    selected
                      ? "bg-primary/8 ring-1 ring-primary/25 dark:bg-primary/12"
                      : "hover:bg-muted/40",
                  )}
                  onClick={() => setSelectedEnvironmentId(environment.environmentId)}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background text-muted-foreground">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <ConnectionStatusDot
                        tooltipText={connectionStatusText(environment.connection)}
                        dotClassName={connectionPhaseDotClassName(environment.connection.phase)}
                      />
                      <span className="truncate text-sm font-medium">{environment.label}</span>
                    </span>
                    <span className="block truncate pl-[18px] text-xs text-muted-foreground">
                      Skills on this device
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </SettingsSection>
      ) : null}
      {selectedEnvironment ? (
        <SelectedEnvironmentSkills
          key={selectedEnvironment.environmentId}
          environment={selectedEnvironment}
        />
      ) : (
        <SettingsSection {...searchableSetting("skills")}>
          <div className="rounded-xl border border-dashed border-border/70 p-10 text-center">
            <p className="text-sm font-medium">
              {isReady ? "No connected device" : "Loading devices"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Connect an environment to browse its installed skills.
            </p>
          </div>
        </SettingsSection>
      )}
    </SettingsPageContainer>
  );
}

function SelectedEnvironmentSkills({
  environment,
}: {
  readonly environment: EnvironmentPresentation;
}) {
  const primarySession = usePrimarySessionState();
  const isPrimary = environment.entry.target._tag === "PrimaryConnectionTarget";
  return isPrimary ? (
    <SkillsWorkspace
      environment={environment}
      operateAccess={environmentOperateAccess(environment, primarySession, null)}
    />
  ) : (
    <RemoteEnvironmentSkills environment={environment} primarySession={primarySession} />
  );
}

function RemoteEnvironmentSkills({
  environment,
  primarySession,
}: {
  readonly environment: EnvironmentPresentation;
  readonly primarySession: ReturnType<typeof usePrimarySessionState>;
}) {
  const remoteSession = useEnvironmentSessionState(environment.environmentId);
  return (
    <SkillsWorkspace
      environment={environment}
      operateAccess={environmentOperateAccess(environment, primarySession, remoteSession)}
    />
  );
}

function SkillsWorkspace({
  environment,
  operateAccess,
}: {
  readonly environment: EnvironmentPresentation;
  readonly operateAccess: "granted" | "denied" | "pending";
}) {
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environment.environmentId)) ??
    EMPTY_SERVER_PROVIDERS;
  const [providerId, setProviderId] = useState<ProviderInstanceId | null>(null);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState<SkillLocationFilter>("all");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [document, setDocument] = useState<ProviderSkillDocument | null>(null);
  const [content, setContent] = useState("");
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const selectionRequestRef = useRef(0);

  const skillProviders = useMemo(
    () =>
      providers.filter(
        (provider) => provider.skills.length > 0 || provider.skillManagement !== undefined,
      ),
    [providers],
  );
  const activeProvider =
    skillProviders.find((provider) => provider.instanceId === providerId) ??
    skillProviders[0] ??
    null;
  const visibleSkills = useMemo(
    () => filterProviderSkills(activeProvider?.skills ?? [], { query, location }),
    [activeProvider, location, query],
  );
  const selectedSkill = activeProvider?.skills.find((skill) => skill.path === selectedPath) ?? null;
  const readOnly = operateAccess !== "granted" || environment.connection.phase !== "connected";

  const readSkill = useAtomCommand(serverEnvironment.readSkill, { reportFailure: false });
  const createSkill = useAtomCommand(serverEnvironment.createSkill, { reportFailure: false });
  const updateSkill = useAtomCommand(serverEnvironment.updateSkill, { reportFailure: false });
  const deleteSkill = useAtomCommand(serverEnvironment.deleteSkill, { reportFailure: false });
  const installSkills = useAtomCommand(serverEnvironment.installSkills, { reportFailure: false });
  const setSkillEnabled = useAtomCommand(serverEnvironment.setSkillEnabled, {
    reportFailure: false,
  });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const openInFileManager = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });

  useEffect(() => {
    if (activeProvider && activeProvider.instanceId !== providerId) {
      setProviderId(activeProvider.instanceId);
    }
  }, [activeProvider, providerId]);

  useEffect(() => {
    if (!selectedPath) return;
    if (activeProvider?.skills.some((skill) => skill.path === selectedPath)) return;
    setSelectedPath(null);
    setDocument(null);
    setContent("");
  }, [activeProvider, selectedPath]);

  const showError = useCallback(
    <A, E>(title: string, fallback: string, result: AtomCommandResult<A, E>) => {
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      toastManager.add({ type: "error", title, description: errorMessage(error, fallback) });
    },
    [],
  );

  const selectSkill = useCallback(
    async (provider: ServerProvider, skill: ServerProviderSkill) => {
      const request = ++selectionRequestRef.current;
      setSelectedPath(skill.path);
      setDocument(null);
      setContent("");
      setLoadingPath(skill.path);
      const result = await readSkill({
        environmentId: environment.environmentId,
        input: { instanceId: provider.instanceId, path: skill.path },
      });
      if (request !== selectionRequestRef.current) return;
      setLoadingPath(null);
      if (result._tag === "Success") {
        setDocument(result.value);
        setContent(result.value.content);
        return;
      }
      showError("Could not open skill", "SKILL.md could not be read.", result);
    },
    [environment.environmentId, readSkill, showError],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const result = await refreshProviders({
      environmentId: environment.environmentId,
      input: activeProvider ? { instanceId: activeProvider.instanceId } : {},
    });
    setRefreshing(false);
    if (result._tag === "Failure") {
      showError(
        "Could not refresh skills",
        "The provider skill list could not be refreshed.",
        result,
      );
      return;
    }
    if (selectedSkill) void selectSkill(activeProvider!, selectedSkill);
  }, [
    activeProvider,
    environment.environmentId,
    refreshProviders,
    selectSkill,
    selectedSkill,
    showError,
  ]);

  const save = useCallback(async () => {
    if (!activeProvider || !selectedSkill || !document || saving) return;
    setSaving(true);
    const result = await updateSkill({
      environmentId: environment.environmentId,
      input: {
        instanceId: activeProvider.instanceId,
        path: selectedSkill.path,
        content,
        expectedRevision: document.revision,
      },
    });
    setSaving(false);
    if (result._tag === "Success") {
      setDocument(result.value.document);
      setContent(result.value.document.content);
      toastManager.add({ type: "success", title: "Skill saved" });
      return;
    }
    showError("Could not save skill", "The skill was not changed.", result);
  }, [
    activeProvider,
    content,
    document,
    environment.environmentId,
    saving,
    selectedSkill,
    showError,
    updateSkill,
  ]);

  const remove = useCallback(async () => {
    if (!activeProvider || !selectedSkill || !document) return;
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Delete ${formatProviderSkillDisplayName(selectedSkill)}?\nThe entire skill directory will be removed from ${environment.label}. This cannot be undone.`,
      { variant: "destructive" },
    );
    if (!confirmed) return;
    const result = await deleteSkill({
      environmentId: environment.environmentId,
      input: {
        instanceId: activeProvider.instanceId,
        path: selectedSkill.path,
        expectedRevision: document.revision,
      },
    });
    if (result._tag === "Success") {
      setSelectedPath(null);
      setDocument(null);
      setContent("");
      toastManager.add({ type: "success", title: "Skill deleted" });
      return;
    }
    showError("Could not delete skill", "The skill was not removed.", result);
  }, [
    activeProvider,
    deleteSkill,
    document,
    environment.environmentId,
    environment.label,
    selectedSkill,
    showError,
  ]);

  const create = useCallback(
    async (input: {
      instanceId: ProviderInstanceId;
      name: string;
      description: string;
      scope: ProviderSkillCreateScope;
    }) => {
      const result = await createSkill({ environmentId: environment.environmentId, input });
      if (result._tag === "Success") {
        setProviderId(input.instanceId);
        setSelectedPath(result.value.document.skill.path);
        setDocument(result.value.document);
        setContent(result.value.document.content);
        toastManager.add({ type: "success", title: `Created $${input.name}` });
        return true;
      }
      showError("Could not create skill", "The skill was not created.", result);
      return false;
    },
    [createSkill, environment.environmentId, showError],
  );

  const install = useCallback(
    async (input: {
      instanceId: ProviderInstanceId;
      source: string;
      skillName?: string;
      scope: ProviderSkillCreateScope;
    }) => {
      const result = await installSkills({ environmentId: environment.environmentId, input });
      if (result._tag === "Success") {
        setProviderId(input.instanceId);
        toastManager.add({
          type: "success",
          title: `Installed ${result.value.paths.length} skill${result.value.paths.length === 1 ? "" : "s"}`,
        });
        return true;
      }
      showError("Could not install skills", "No skills were installed.", result);
      return false;
    },
    [environment.environmentId, installSkills, showError],
  );

  const toggle = useCallback(
    async (enabled: boolean) => {
      if (!activeProvider || !selectedSkill) return;
      const result = await setSkillEnabled({
        environmentId: environment.environmentId,
        input: { instanceId: activeProvider.instanceId, path: selectedSkill.path, enabled },
      });
      if (result._tag === "Failure") {
        showError(
          `Could not ${enabled ? "enable" : "disable"} skill`,
          "The skill setting was not changed.",
          result,
        );
      }
    },
    [activeProvider, environment.environmentId, selectedSkill, setSkillEnabled, showError],
  );

  const openFolder = useCallback(async () => {
    if (!selectedSkill) return;
    const result = await openInFileManager({
      environmentId: environment.environmentId,
      input: { cwd: skillDirectory(selectedSkill.path), editor: "file-manager" },
    });
    if (result._tag === "Failure") {
      showError("Could not open skill folder", "The folder was not opened.", result);
    }
  }, [environment.environmentId, openInFileManager, selectedSkill, showError]);

  return (
    <SettingsSection
      {...searchableSetting("skills")}
      headerAction={
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={refreshing}
                  aria-label="Refresh skills"
                  onClick={() => void refresh()}
                >
                  <RefreshCwIcon className={cn("size-3.5", refreshing && "animate-spin")} />
                </Button>
              }
            />
            <TooltipPopup>Refresh skills</TooltipPopup>
          </Tooltip>
          <Button
            size="xs"
            variant="outline"
            disabled={
              readOnly || !skillProviders.some((provider) => provider.skillManagement?.canInstall)
            }
            onClick={() => setDialogMode("install")}
          >
            <ExternalLinkIcon className="size-3.5" /> Install
          </Button>
          <Button
            size="xs"
            disabled={
              readOnly || !skillProviders.some((provider) => provider.skillManagement?.canCreate)
            }
            onClick={() => setDialogMode("create")}
          >
            <PlusIcon className="size-3.5" /> New
          </Button>
        </div>
      }
    >
      {operateAccess === "denied" ? (
        <p className="px-3 text-xs text-muted-foreground sm:px-4">
          This connection can browse skills but does not have permission to change them.
        </p>
      ) : null}
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs/5">
        <div className="flex flex-col border-b border-border/60 bg-muted/18 p-3 sm:flex-row sm:items-center sm:gap-2">
          <Select
            value={activeProvider?.instanceId}
            onValueChange={(value) => {
              setProviderId(value as ProviderInstanceId);
              setSelectedPath(null);
              setDocument(null);
            }}
          >
            <SelectTrigger size="sm" className="sm:w-44">
              <SelectValue placeholder="Provider">
                {activeProvider ? <ProviderSelectLabel provider={activeProvider} /> : null}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {skillProviders.map((provider) => (
                <SelectItem key={provider.instanceId} value={provider.instanceId}>
                  <ProviderSelectLabel provider={provider} />
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <div className="relative mt-2 min-w-0 flex-1 sm:mt-0">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              nativeInput
              size="sm"
              value={query}
              placeholder={`Search ${activeProvider?.skills.length ?? 0} skills`}
              aria-label="Search skills"
              className="[&_input]:pl-8"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
          <Select
            value={location}
            onValueChange={(value) => setLocation(value as SkillLocationFilter)}
          >
            <SelectTrigger size="sm" className="mt-2 sm:mt-0 sm:w-36">
              <SelectValue>{SKILL_LOCATION_LABELS[location]}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="all">{SKILL_LOCATION_LABELS.all}</SelectItem>
              <SelectItem value="personal">{SKILL_LOCATION_LABELS.personal}</SelectItem>
              <SelectItem value="project">{SKILL_LOCATION_LABELS.project}</SelectItem>
              <SelectItem value="bundled">{SKILL_LOCATION_LABELS.bundled}</SelectItem>
            </SelectPopup>
          </Select>
        </div>
        {skillProviders.length === 0 ? (
          <div className="flex min-h-96 items-center justify-center p-8 text-center">
            <div className="max-w-sm">
              <span className="mx-auto flex size-10 items-center justify-center rounded-xl border border-border/60 bg-muted/35 text-muted-foreground">
                <SparklesIcon className="size-4.5" />
              </span>
              <p className="mt-4 text-sm font-medium">No manageable skill providers</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Install and enable Codex or Claude Code on this device, then refresh.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid min-h-[34rem] min-w-0 md:grid-cols-[minmax(15rem,0.78fr)_minmax(0,1.45fr)]">
            <div className="min-h-0 border-b border-border/60 p-2 md:max-h-[42rem] md:overflow-y-auto md:border-r md:border-b-0">
              {visibleSkills.length > 0 ? (
                <div className="space-y-0.5">
                  {visibleSkills.map((skill) => (
                    <SkillListRow
                      key={skill.path}
                      skill={skill}
                      selected={skill.path === selectedPath}
                      onSelect={() => void selectSkill(activeProvider!, skill)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex min-h-56 items-center justify-center px-6 text-center">
                  <div>
                    <p className="text-sm font-medium">No matching skills</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Try another search or location.
                    </p>
                  </div>
                </div>
              )}
            </div>
            <SkillEditor
              provider={activeProvider!}
              skill={selectedSkill}
              document={document}
              content={content}
              readOnly={readOnly}
              loading={loadingPath === selectedPath}
              saving={saving}
              onContentChange={setContent}
              onSave={() => void save()}
              onReload={() => selectedSkill && void selectSkill(activeProvider!, selectedSkill)}
              onDelete={() => void remove()}
              onToggle={(enabled) => void toggle(enabled)}
              onOpenFolder={() => void openFolder()}
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 pt-1 text-[11px] text-muted-foreground sm:px-4">
        <CheckIcon className="size-3.5 text-success-foreground" />
        Skills stay on {environment.label}; remote connections manage that device over the existing
        encrypted session.
      </div>
      <SkillAuthorDialog
        mode={dialogMode}
        providers={skillProviders}
        onOpenChange={(open) => {
          if (!open) setDialogMode(null);
        }}
        onCreate={create}
        onInstall={install}
      />
    </SettingsSection>
  );
}
