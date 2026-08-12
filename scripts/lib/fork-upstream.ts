export const MAIN_BRANCH = "main";
export const ORIGIN_REMOTE = "origin";
export const UPSTREAM_REMOTE = "upstream";
export const UPSTREAM_REPOSITORY = "pingdotgg/t3code";
export const UPSTREAM_URL = `https://github.com/${UPSTREAM_REPOSITORY}.git`;

const DEV_LIFECYCLE_EVENTS = new Set(["dev", "dev:share", "dev:server", "dev:web", "dev:desktop"]);

export interface CommandRequest {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly output?: "capture" | "inherit";
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ForkUpstreamContext {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly interactive: boolean;
  readonly lifecycleEvent: string | undefined;
  readonly nodeExecutable: string;
  readonly npmExecPath: string | undefined;
  readonly isWindows: boolean;
  /** Test-only override; production always uses the canonical public upstream. */
  readonly upstreamRepository?: string;
  /** Test-only override; production always uses the canonical public upstream. */
  readonly upstreamUrl?: string;
  readonly runCommand: (request: CommandRequest) => Promise<CommandResult>;
  readonly confirm: (question: string, defaultValue: boolean) => Promise<boolean>;
  readonly write: (message: string) => void;
}

export interface BranchRelation {
  readonly leftOnly: number;
  readonly rightOnly: number;
  readonly kind: "identical" | "ahead" | "behind" | "diverged";
}

export interface ForkCheckResult {
  readonly action: "continue" | "stop";
  readonly reason:
    | "skipped"
    | "up-to-date"
    | "declined"
    | "updated"
    | "continued-after-problem"
    | "problem";
}

export interface PnpmInvocation {
  readonly command: string;
  readonly prefixArgs: ReadonlyArray<string>;
}

const continueWith = (reason: ForkCheckResult["reason"]): ForkCheckResult => ({
  action: "continue",
  reason,
});

const stopWithProblem = (): ForkCheckResult => ({
  action: "stop",
  reason: "problem",
});

export function parseConfirmation(input: string, defaultValue: boolean): boolean | undefined {
  const normalized = input.trim().toLowerCase();
  if (normalized === "") {
    return defaultValue;
  }
  if (normalized === "y" || normalized === "yes") {
    return true;
  }
  if (normalized === "n" || normalized === "no") {
    return false;
  }
  return undefined;
}

export function parseAheadBehind(output: string): BranchRelation {
  const parts = output.trim().split(/\s+/u);
  if (parts.length !== 2) {
    throw new Error(`Expected two revision counts, received: ${JSON.stringify(output.trim())}`);
  }

  const leftOnly = Number(parts[0]);
  const rightOnly = Number(parts[1]);
  if (
    !Number.isSafeInteger(leftOnly) ||
    leftOnly < 0 ||
    !Number.isSafeInteger(rightOnly) ||
    rightOnly < 0
  ) {
    throw new Error(`Invalid revision counts: ${JSON.stringify(output.trim())}`);
  }

  const kind =
    leftOnly === 0 && rightOnly === 0
      ? "identical"
      : rightOnly === 0
        ? "ahead"
        : leftOnly === 0
          ? "behind"
          : "diverged";

  return { leftOnly, rightOnly, kind };
}

export function normalizeGitHubRepository(remoteUrl: string): string | undefined {
  const trimmed = remoteUrl
    .trim()
    .replace(/\/+$/u, "")
    .replace(/\.git$/u, "");
  const match =
    /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+)$/iu.exec(
      trimmed,
    );
  return match?.[1]?.toLowerCase();
}

export function isCanonicalUpstreamUrl(remoteUrl: string): boolean {
  return normalizeGitHubRepository(remoteUrl) === UPSTREAM_REPOSITORY.toLowerCase();
}

function isExpectedUpstreamUrl(
  remoteUrl: string,
  expectedUrl: string,
  expectedRepository: string,
): boolean {
  if (expectedRepository === UPSTREAM_REPOSITORY) {
    return isCanonicalUpstreamUrl(remoteUrl);
  }
  return remoteUrl.trim().replace(/\/+$/u, "") === expectedUrl.trim().replace(/\/+$/u, "");
}

export function resolvePnpmInvocation(options: {
  readonly nodeExecutable: string;
  readonly npmExecPath: string | undefined;
  readonly isWindows: boolean;
}): PnpmInvocation {
  if (options.npmExecPath) {
    return {
      command: options.nodeExecutable,
      prefixArgs: [options.npmExecPath],
    };
  }
  return {
    command: options.isWindows ? "pnpm.cmd" : "pnpm",
    prefixArgs: [],
  };
}

function sanitizeTerminalLine(line: string): string {
  return Array.from(line, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
      ? ""
      : character;
  }).join("");
}

function commandFailureDetail(result: CommandResult): string | undefined {
  const detail = (result.stderr || result.stdout)
    .trim()
    .split(/\r?\n/u)
    .slice(-3)
    .map(sanitizeTerminalLine)
    .join("\n");
  return detail || undefined;
}

async function handleProblem(
  context: ForkUpstreamContext,
  message: string,
  advice?: string,
): Promise<ForkCheckResult> {
  context.write("");
  context.write(`! ${message}`);
  if (advice) {
    context.write(`  ${advice}`);
  }

  if (!context.interactive) {
    context.write(
      "  This check cannot ask for confirmation in a non-interactive terminal. Fix the problem or explicitly set T3CODE_SKIP_UPSTREAM_CHECK=1.",
    );
    return stopWithProblem();
  }

  const isDevCommand =
    context.lifecycleEvent !== undefined && DEV_LIFECYCLE_EVENTS.has(context.lifecycleEvent);
  const question = isDevCommand
    ? "Continue and start the current checkout anyway?"
    : "Ignore this problem and leave the checkout unchanged?";
  const shouldContinue = await context.confirm(question, false);
  if (!shouldContinue) {
    return stopWithProblem();
  }

  context.write("Continuing without a successful upstream update.");
  return continueWith("continued-after-problem");
}

async function git(
  context: ForkUpstreamContext,
  cwd: string,
  args: ReadonlyArray<string>,
  output: CommandRequest["output"] = "capture",
): Promise<CommandResult> {
  return context.runCommand({ command: "git", args, cwd, output });
}

async function readRelation(
  context: ForkUpstreamContext,
  cwd: string,
  left: string,
  right: string,
): Promise<BranchRelation | undefined> {
  const result = await git(context, cwd, [
    "rev-list",
    "--left-right",
    "--count",
    `${left}...${right}`,
  ]);
  if (result.exitCode !== 0) {
    return undefined;
  }
  try {
    return parseAheadBehind(result.stdout);
  } catch {
    return undefined;
  }
}

async function refExists(context: ForkUpstreamContext, cwd: string, ref: string): Promise<boolean> {
  const result = await git(context, cwd, ["rev-parse", "--verify", "--quiet", ref]);
  return result.exitCode === 0;
}

async function findGitOperation(
  context: ForkUpstreamContext,
  cwd: string,
): Promise<string | undefined> {
  const operations = [
    ["MERGE_HEAD", "merge"],
    ["REBASE_HEAD", "rebase"],
    ["CHERRY_PICK_HEAD", "cherry-pick"],
    ["REVERT_HEAD", "revert"],
  ] as const;
  for (const [ref, label] of operations) {
    if (await refExists(context, cwd, ref)) {
      return label;
    }
  }
  return undefined;
}

function writeRelationSummary(
  context: ForkUpstreamContext,
  label: string,
  leftLabel: string,
  rightLabel: string,
  relation: BranchRelation,
): void {
  context.write(
    `${label}: ${relation.leftOnly} only on ${leftLabel}, ${relation.rightOnly} only on ${rightLabel}.`,
  );
}

async function writeRecentUpstreamCommits(
  context: ForkUpstreamContext,
  cwd: string,
  leftRef: string,
  missingCount: number,
): Promise<void> {
  if (missingCount === 0) {
    return;
  }
  const log = await git(context, cwd, [
    "log",
    "--max-count=5",
    "--format=%h %s",
    `${leftRef}..${UPSTREAM_REMOTE}/${MAIN_BRANCH}`,
  ]);
  if (log.exitCode !== 0 || !log.stdout.trim()) {
    return;
  }
  context.write("Newest missing upstream commits:");
  for (const line of log.stdout.trim().split(/\r?\n/u)) {
    context.write(`  ${sanitizeTerminalLine(line)}`);
  }
}

async function fetchMain(
  context: ForkUpstreamContext,
  cwd: string,
  remote: string,
): Promise<CommandResult> {
  return git(context, cwd, [
    "fetch",
    "--quiet",
    "--no-tags",
    remote,
    `+refs/heads/${MAIN_BRANCH}:refs/remotes/${remote}/${MAIN_BRANCH}`,
  ]);
}

async function mergeFailedResult(
  context: ForkUpstreamContext,
  cwd: string,
): Promise<ForkCheckResult> {
  if (await refExists(context, cwd, "MERGE_HEAD")) {
    const abort = await git(context, cwd, ["merge", "--abort"], "inherit");
    if (abort.exitCode !== 0) {
      return handleProblem(
        context,
        "The upstream merge failed and Git could not abort it automatically.",
        "Run git status, resolve or abort the merge manually, and do not discard your work.",
      );
    }
  }
  return handleProblem(
    context,
    "The upstream merge could not be completed cleanly; it was aborted.",
    "Resolve the upstream changes manually, then rerun pnpm run fork:sync.",
  );
}

export async function runForkUpstreamCheck(context: ForkUpstreamContext): Promise<ForkCheckResult> {
  if (context.env.T3CODE_SKIP_UPSTREAM_CHECK === "1") {
    context.write("[fork-sync] Upstream check skipped by T3CODE_SKIP_UPSTREAM_CHECK=1.");
    return continueWith("skipped");
  }

  const expectedUpstreamRepository = context.upstreamRepository ?? UPSTREAM_REPOSITORY;
  const expectedUpstreamUrl = context.upstreamUrl ?? UPSTREAM_URL;
  context.write(
    `[fork-sync] Checking origin/main and ${expectedUpstreamRepository} ${MAIN_BRANCH}...`,
  );

  const topLevel = await git(context, context.cwd, ["rev-parse", "--show-toplevel"]);
  if (topLevel.exitCode !== 0 || !topLevel.stdout.trim()) {
    return handleProblem(
      context,
      "This command is not running inside a Git checkout.",
      "Run it from a clone of the T3 Code fork.",
    );
  }
  const repoRoot = topLevel.stdout.trim();

  const originUrl = await git(context, repoRoot, ["remote", "get-url", ORIGIN_REMOTE]);
  if (originUrl.exitCode !== 0 || !originUrl.stdout.trim()) {
    return handleProblem(
      context,
      "The checkout does not have an origin remote.",
      "Clone your personal GitHub fork normally so origin points to it.",
    );
  }

  const upstreamUrl = await git(context, repoRoot, ["remote", "get-url", UPSTREAM_REMOTE]);
  if (upstreamUrl.exitCode !== 0) {
    const addUpstream = await git(context, repoRoot, [
      "remote",
      "add",
      UPSTREAM_REMOTE,
      expectedUpstreamUrl,
    ]);
    if (addUpstream.exitCode !== 0) {
      return handleProblem(
        context,
        "The canonical upstream remote could not be added.",
        commandFailureDetail(addUpstream),
      );
    }
    context.write(`[fork-sync] Added upstream -> ${expectedUpstreamUrl}`);
  } else if (
    !isExpectedUpstreamUrl(upstreamUrl.stdout, expectedUpstreamUrl, expectedUpstreamRepository)
  ) {
    return handleProblem(
      context,
      `The upstream remote points to ${upstreamUrl.stdout.trim()}, not ${expectedUpstreamRepository}.`,
      `Rename that remote or set it to ${expectedUpstreamUrl}; the checker will not overwrite it.`,
    );
  }

  // Fetch sequentially because concurrent fetches contend on FETCH_HEAD and its lock.
  const originFetch = await fetchMain(context, repoRoot, ORIGIN_REMOTE);
  const upstreamFetch = await fetchMain(context, repoRoot, UPSTREAM_REMOTE);
  const fetchResults: ReadonlyArray<readonly [string, CommandResult]> = [
    [ORIGIN_REMOTE, originFetch],
    [UPSTREAM_REMOTE, upstreamFetch],
  ];
  const fetchFailures = fetchResults
    .filter((entry) => entry[1].exitCode !== 0)
    .map(([remote, result]) => `${remote}: ${commandFailureDetail(result) ?? "fetch failed"}`);

  const branchResult = await git(context, repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : undefined;

  const hasOriginMain = await refExists(context, repoRoot, `${ORIGIN_REMOTE}/${MAIN_BRANCH}`);
  const hasUpstreamMain = await refExists(context, repoRoot, `${UPSTREAM_REMOTE}/${MAIN_BRANCH}`);
  if (!hasOriginMain || !hasUpstreamMain) {
    return handleProblem(
      context,
      "The main branch references are unavailable after fetching.",
      fetchFailures.join("\n") || "Confirm that origin/main and upstream/main both exist.",
    );
  }

  const [deviceToOrigin, deviceToUpstream, forkToUpstream] = await Promise.all([
    readRelation(context, repoRoot, "HEAD", `${ORIGIN_REMOTE}/${MAIN_BRANCH}`),
    readRelation(context, repoRoot, "HEAD", `${UPSTREAM_REMOTE}/${MAIN_BRANCH}`),
    readRelation(
      context,
      repoRoot,
      `${ORIGIN_REMOTE}/${MAIN_BRANCH}`,
      `${UPSTREAM_REMOTE}/${MAIN_BRANCH}`,
    ),
  ]);
  if (!deviceToOrigin || !deviceToUpstream || !forkToUpstream) {
    return handleProblem(
      context,
      "Git could not calculate the branch relationship.",
      "Verify the repository history with git status and rerun the check.",
    );
  }

  writeRelationSummary(
    context,
    "Device ↔ GitHub fork",
    "this device",
    "origin/main",
    deviceToOrigin,
  );
  writeRelationSummary(
    context,
    "GitHub fork ↔ official upstream",
    "the fork",
    "upstream/main",
    forkToUpstream,
  );
  await writeRecentUpstreamCommits(
    context,
    repoRoot,
    branch === MAIN_BRANCH && deviceToOrigin.kind === "behind"
      ? `${ORIGIN_REMOTE}/${MAIN_BRANCH}`
      : "HEAD",
    branch === MAIN_BRANCH && deviceToOrigin.kind === "behind"
      ? forkToUpstream.rightOnly
      : deviceToUpstream.rightOnly,
  );

  if (fetchFailures.length > 0) {
    return handleProblem(
      context,
      "The remote check failed, so the displayed relationship may be stale.",
      fetchFailures.join("\n"),
    );
  }

  if (!branch) {
    return handleProblem(
      context,
      "The checkout has a detached HEAD; automatic updates are disabled.",
      `Check out ${MAIN_BRANCH} and rerun the command.`,
    );
  }

  if (branch !== MAIN_BRANCH) {
    if (deviceToUpstream.rightOnly === 0) {
      context.write(
        `[fork-sync] ${branch} already contains the latest upstream/main; no branch changes were made.`,
      );
      return continueWith("up-to-date");
    }
    return handleProblem(
      context,
      `${branch} is ${deviceToUpstream.rightOnly} commit(s) behind upstream/main; automatic updates only modify main.`,
      `Update main, then merge main into ${branch}.`,
    );
  }

  const updateNeeded = deviceToOrigin.rightOnly > 0 || deviceToUpstream.rightOnly > 0;
  if (!updateNeeded) {
    context.write(
      `[fork-sync] Up to date with upstream/main (${deviceToUpstream.leftOnly} fork-specific commit(s) ahead).`,
    );
    if (deviceToOrigin.leftOnly > 0) {
      context.write(
        `[fork-sync] Note: this device has ${deviceToOrigin.leftOnly} commit(s) not pushed to origin/main.`,
      );
    }
    return continueWith("up-to-date");
  }

  if (deviceToOrigin.kind === "diverged") {
    return handleProblem(
      context,
      `This device and origin/main have diverged (${deviceToOrigin.leftOnly} local, ${deviceToOrigin.rightOnly} remote-only commit(s)).`,
      "Reconcile origin/main manually before merging official upstream changes.",
    );
  }

  const operation = await findGitOperation(context, repoRoot);
  if (operation) {
    return handleProblem(
      context,
      `A ${operation} operation is already in progress.`,
      `Finish or abort the ${operation} before updating the fork.`,
    );
  }

  const status = await git(context, repoRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=normal",
  ]);
  if (status.exitCode !== 0) {
    return handleProblem(
      context,
      "Git could not inspect the worktree.",
      commandFailureDetail(status),
    );
  }
  if (status.stdout.trim()) {
    return handleProblem(
      context,
      "The worktree has tracked or untracked changes, so it will not be updated automatically.",
      "Commit or stash the changes, then rerun the command.",
    );
  }

  if (!context.interactive) {
    return handleProblem(
      context,
      "Updates are available, but confirmation requires an interactive terminal.",
    );
  }

  context.write("");
  if (deviceToOrigin.rightOnly > 0) {
    context.write(`This device is ${deviceToOrigin.rightOnly} commit(s) behind origin/main.`);
  }
  context.write(
    `Upstream has ${forkToUpstream.rightOnly} commit(s) not in your GitHub fork; your fork has ${forkToUpstream.leftOnly} fork-specific commit(s).`,
  );
  const officialUpdateNeededAfterOrigin =
    deviceToOrigin.kind === "behind"
      ? forkToUpstream.rightOnly > 0
      : deviceToUpstream.rightOnly > 0;
  const shouldUpdate = await context.confirm(
    officialUpdateNeededAfterOrigin
      ? "Merge upstream/main, install dependencies, and push origin/main?"
      : "Fast-forward this device from origin/main and install dependencies?",
    true,
  );
  if (!shouldUpdate) {
    context.write("[fork-sync] Update declined; continuing with the current checkout.");
    return continueWith("declined");
  }

  if (deviceToOrigin.kind === "behind") {
    context.write("[fork-sync] Fast-forwarding this device from origin/main...");
    const fastForward = await git(
      context,
      repoRoot,
      ["merge", "--ff-only", `${ORIGIN_REMOTE}/${MAIN_BRANCH}`],
      "inherit",
    );
    if (fastForward.exitCode !== 0) {
      return handleProblem(
        context,
        "This device could not be fast-forwarded from origin/main.",
        "Inspect git status and reconcile origin/main manually.",
      );
    }
  }

  const refreshedUpstreamRelation = await readRelation(
    context,
    repoRoot,
    "HEAD",
    `${UPSTREAM_REMOTE}/${MAIN_BRANCH}`,
  );
  if (!refreshedUpstreamRelation) {
    return handleProblem(
      context,
      "Git could not recalculate upstream status after fast-forwarding.",
    );
  }
  if (refreshedUpstreamRelation.rightOnly > 0) {
    context.write("[fork-sync] Merging upstream/main...");
    const merge = await git(
      context,
      repoRoot,
      ["merge", "--no-edit", `${UPSTREAM_REMOTE}/${MAIN_BRANCH}`],
      "inherit",
    );
    if (merge.exitCode !== 0) {
      return mergeFailedResult(context, repoRoot);
    }
  }

  context.write("[fork-sync] Installing the synchronized dependency graph...");
  const pnpm = resolvePnpmInvocation(context);
  const install = await context.runCommand({
    command: pnpm.command,
    args: [...pnpm.prefixArgs, "install", "--frozen-lockfile"],
    cwd: repoRoot,
    output: "inherit",
  });
  if (install.exitCode !== 0) {
    return handleProblem(
      context,
      "The Git update succeeded, but pnpm install --frozen-lockfile failed; nothing was pushed.",
      "Fix the installation problem and rerun pnpm install before pushing.",
    );
  }

  const afterInstallOriginRelation = await readRelation(
    context,
    repoRoot,
    "HEAD",
    `${ORIGIN_REMOTE}/${MAIN_BRANCH}`,
  );
  if (!afterInstallOriginRelation) {
    return handleProblem(
      context,
      "Git could not determine whether the synchronized branch needs pushing.",
    );
  }
  if (afterInstallOriginRelation.rightOnly > 0) {
    return handleProblem(
      context,
      "origin/main changed while the update was running, so the result was not pushed.",
      "Fetch and reconcile origin/main, then push main manually.",
    );
  }
  if (afterInstallOriginRelation.leftOnly > 0) {
    context.write("[fork-sync] Pushing the synchronized main branch to origin...");
    const push = await git(context, repoRoot, ["push", ORIGIN_REMOTE, MAIN_BRANCH], "inherit");
    if (push.exitCode !== 0) {
      return handleProblem(
        context,
        "The local update succeeded, but pushing origin/main failed.",
        "Configure GitHub credentials and run git push origin main; other devices do not have this update yet.",
      );
    }
  }

  context.write("[fork-sync] Update complete; continuing with the requested command.");
  return continueWith("updated");
}
