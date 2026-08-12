// @effect-diagnostics nodeBuiltinImport:off - disposable Git repositories exercise the real command boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  isCanonicalUpstreamUrl,
  normalizeGitHubRepository,
  parseAheadBehind,
  parseConfirmation,
  resolvePnpmInvocation,
  runForkUpstreamCheck,
  type CommandRequest,
  type CommandResult,
  type ForkCheckResult,
} from "./fork-upstream.ts";

const temporaryDirectories: string[] = [];
let otherDeviceIndex = 0;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

interface GitScenario {
  readonly root: string;
  readonly upstream: string;
  readonly origin: string;
  readonly seed: string;
  readonly device: string;
}

interface CheckerOptions {
  readonly confirmations?: Array<boolean>;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly interactive?: boolean;
  readonly installExitCode?: number;
  readonly failFetch?: boolean;
  readonly failPush?: boolean;
  readonly simulatedOperation?: string;
}

interface CheckerRun {
  readonly result: ForkCheckResult;
  readonly output: string;
  readonly commands: ReadonlyArray<CommandRequest>;
  readonly questions: ReadonlyArray<{ readonly question: string; readonly defaultValue: boolean }>;
}

function command(executable: string, args: ReadonlyArray<string>, cwd: string): CommandResult {
  const result = NodeChildProcess.spawnSync(executable, [...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
    windowsHide: true,
  });
  return {
    exitCode: result.status ?? (result.error ? 127 : 1),
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${result.error?.message ?? ""}`,
  };
}

function git(cwd: string, ...args: ReadonlyArray<string>): string {
  const result = command("git", args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function makeScenario(): GitScenario {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-fork-sync-"));
  temporaryDirectories.push(root);
  const upstream = NodePath.join(root, "upstream.git");
  const origin = NodePath.join(root, "origin.git");
  const seed = NodePath.join(root, "seed");
  const device = NodePath.join(root, "device");

  git(root, "init", "--bare", "--initial-branch=main", upstream);
  git(root, "init", "--bare", "--initial-branch=main", origin);
  git(root, "init", "--initial-branch=main", seed);
  configureIdentity(seed);
  commitFile(seed, "app.txt", "base\n", "base");
  git(seed, "remote", "add", "upstream", upstream);
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "upstream", "main");
  git(seed, "push", "origin", "main");

  git(root, "clone", origin, device);
  configureIdentity(device);
  git(device, "remote", "add", "upstream", upstream);
  git(device, "fetch", "upstream", "+refs/heads/main:refs/remotes/upstream/main");
  return { root, upstream, origin, seed, device };
}

function configureIdentity(repository: string): void {
  git(repository, "config", "user.name", "Fork Sync Test");
  git(repository, "config", "user.email", "fork-sync@example.test");
}

function commitFile(
  repository: string,
  relativePath: string,
  content: string,
  message: string,
): string {
  const filePath = NodePath.join(repository, relativePath);
  NodeFS.mkdirSync(NodePath.dirname(filePath), { recursive: true });
  NodeFS.writeFileSync(filePath, content);
  git(repository, "add", relativePath);
  git(repository, "commit", "-m", message);
  return git(repository, "rev-parse", "HEAD");
}

function advanceUpstream(
  scenario: GitScenario,
  content = "official update\n",
  relativePath = "official.txt",
): string {
  const sha = commitFile(scenario.seed, relativePath, content, "official update");
  git(scenario.seed, "push", "upstream", "main");
  return sha;
}

function pushFromAnotherDevice(scenario: GitScenario): string {
  const other = NodePath.join(scenario.root, `other-${otherDeviceIndex++}`);
  git(scenario.root, "clone", scenario.origin, other);
  configureIdentity(other);
  const sha = commitFile(other, "other.txt", "from another device\n", "other device");
  git(other, "push", "origin", "main");
  return sha;
}

async function runChecker(
  scenario: GitScenario,
  options: CheckerOptions = {},
): Promise<CheckerRun> {
  const output: Array<string> = [];
  const commands: Array<CommandRequest> = [];
  const questions: Array<{ readonly question: string; readonly defaultValue: boolean }> = [];
  const confirmations = [...(options.confirmations ?? [])];

  const runCommand = async (request: CommandRequest): Promise<CommandResult> => {
    commands.push(request);
    if (request.command === "test-node") {
      return { exitCode: options.installExitCode ?? 0, stdout: "", stderr: "" };
    }
    if (options.failFetch && request.args[0] === "fetch") {
      return { exitCode: 1, stdout: "", stderr: "simulated offline fetch" };
    }
    if (
      options.failPush &&
      request.command === "git" &&
      request.args[0] === "push" &&
      request.args[1] === "origin"
    ) {
      return { exitCode: 1, stdout: "", stderr: "simulated push rejection" };
    }
    if (
      options.simulatedOperation &&
      request.command === "git" &&
      request.args.join(" ") === `rev-parse --verify --quiet ${options.simulatedOperation}`
    ) {
      return { exitCode: 0, stdout: "simulated\n", stderr: "" };
    }
    return command(request.command, request.args, request.cwd);
  };

  const result = await runForkUpstreamCheck({
    cwd: scenario.device,
    env: options.env ?? {},
    interactive: options.interactive ?? true,
    lifecycleEvent: "dev:desktop",
    nodeExecutable: "test-node",
    npmExecPath: "test-pnpm.cjs",
    isWindows: NodePath.delimiter === ";",
    upstreamRepository: scenario.upstream,
    upstreamUrl: scenario.upstream,
    runCommand,
    confirm: async (question, defaultValue) => {
      questions.push({ question, defaultValue });
      return confirmations.shift() ?? defaultValue;
    },
    write: (message) => output.push(message),
  });

  return { result, output: output.join("\n"), commands, questions };
}

describe("fork-upstream helpers", () => {
  it("parses every ahead/behind relationship", () => {
    expect(parseAheadBehind("0\t0\n")).toEqual({ leftOnly: 0, rightOnly: 0, kind: "identical" });
    expect(parseAheadBehind("2 0")).toEqual({ leftOnly: 2, rightOnly: 0, kind: "ahead" });
    expect(parseAheadBehind("0 3")).toEqual({ leftOnly: 0, rightOnly: 3, kind: "behind" });
    expect(parseAheadBehind("2 3")).toEqual({ leftOnly: 2, rightOnly: 3, kind: "diverged" });
    expect(() => parseAheadBehind("invalid")).toThrow();
  });

  it("parses yes, no, and the configured empty default", () => {
    expect(parseConfirmation("yes", false)).toBe(true);
    expect(parseConfirmation("Y", false)).toBe(true);
    expect(parseConfirmation("no", true)).toBe(false);
    expect(parseConfirmation("", true)).toBe(true);
    expect(parseConfirmation("", false)).toBe(false);
    expect(parseConfirmation("maybe", true)).toBeUndefined();
  });

  it("accepts equivalent GitHub HTTPS and SSH upstream URLs", () => {
    expect(normalizeGitHubRepository("https://github.com/pingdotgg/t3code.git")).toBe(
      "pingdotgg/t3code",
    );
    expect(isCanonicalUpstreamUrl("git@github.com:pingdotgg/t3code.git")).toBe(true);
    expect(isCanonicalUpstreamUrl("ssh://git@github.com/pingdotgg/t3code")).toBe(true);
    expect(isCanonicalUpstreamUrl("https://github.com/someone-else/t3code.git")).toBe(false);
  });

  it("uses the invoking pnpm entrypoint on every platform", () => {
    expect(
      resolvePnpmInvocation({
        nodeExecutable: "/node",
        npmExecPath: "/pnpm.cjs",
        isWindows: true,
      }),
    ).toEqual({ command: "/node", prefixArgs: ["/pnpm.cjs"] });
    expect(
      resolvePnpmInvocation({ nodeExecutable: "/node", npmExecPath: undefined, isWindows: true }),
    ).toEqual({ command: "pnpm.cmd", prefixArgs: [] });
  });

  it("wires every core development command through the checker", () => {
    const packageJson = JSON.parse(
      NodeFS.readFileSync(NodePath.resolve(import.meta.dirname, "../../package.json"), "utf8"),
    ) as { readonly scripts: Readonly<Record<string, string>> };
    for (const name of ["dev", "dev:share", "dev:server", "dev:web", "dev:desktop"]) {
      expect(packageJson.scripts[name]).toMatch(
        /^node scripts\/fork-upstream\.ts && node scripts\/dev-runner\.ts/u,
      );
    }
    expect(packageJson.scripts["fork:sync"]).toBe("node scripts/fork-upstream.ts");
  });
});

describe("fork-upstream Git integration", () => {
  it("continues without mutation when the checkout is current", async () => {
    const scenario = makeScenario();
    const before = git(scenario.device, "rev-parse", "HEAD");
    const run = await runChecker(scenario);

    expect(run.result).toEqual({ action: "continue", reason: "up-to-date" });
    expect(run.output).toContain("Up to date with upstream/main");
    expect(git(scenario.device, "rev-parse", "HEAD")).toBe(before);
    expect(run.commands.some((request) => request.command === "test-node")).toBe(false);
  });

  it("fast-forwards an upstream-only update, installs, and pushes", async () => {
    const scenario = makeScenario();
    const upstreamHead = advanceUpstream(scenario);
    const run = await runChecker(scenario, { confirmations: [true] });

    expect(run.result).toEqual({ action: "continue", reason: "updated" });
    expect(git(scenario.device, "rev-parse", "HEAD")).toBe(upstreamHead);
    expect(git(scenario.origin, "rev-parse", "main")).toBe(upstreamHead);
    expect(run.commands.some((request) => request.command === "test-node")).toBe(true);
  });

  it("merges divergent fork and upstream commits without rebasing", async () => {
    const scenario = makeScenario();
    commitFile(scenario.device, "custom.txt", "fork change\n", "fork change");
    git(scenario.device, "push", "origin", "main");
    const upstreamHead = advanceUpstream(scenario);
    const run = await runChecker(scenario, { confirmations: [true] });
    const head = git(scenario.device, "rev-parse", "HEAD");

    expect(run.result.reason).toBe("updated");
    expect(git(scenario.origin, "rev-parse", "main")).toBe(head);
    expect(git(scenario.device, "merge-base", "--is-ancestor", upstreamHead, head)).toBe("");
    expect(
      git(scenario.device, "rev-list", "--parents", "-n", "1", "HEAD").split(" "),
    ).toHaveLength(3);
  });

  it("fast-forwards commits pushed from another device", async () => {
    const scenario = makeScenario();
    const remoteHead = pushFromAnotherDevice(scenario);
    const run = await runChecker(scenario, { confirmations: [true] });

    expect(run.result.reason).toBe("updated");
    expect(git(scenario.device, "rev-parse", "HEAD")).toBe(remoteHead);
    expect(run.questions[0]?.question).toContain("Fast-forward this device");
    expect(run.commands.some((request) => request.args[0] === "push")).toBe(false);
  });

  it("reports local commits that have not been pushed", async () => {
    const scenario = makeScenario();
    commitFile(scenario.device, "local.txt", "local\n", "local only");
    const run = await runChecker(scenario);

    expect(run.result.reason).toBe("up-to-date");
    expect(run.output).toContain("not pushed to origin/main");
  });

  it("leaves a dirty checkout unchanged", async () => {
    const scenario = makeScenario();
    advanceUpstream(scenario);
    const before = git(scenario.device, "rev-parse", "HEAD");
    NodeFS.writeFileSync(NodePath.join(scenario.device, "untracked.txt"), "work in progress\n");
    const run = await runChecker(scenario, { confirmations: [false] });

    expect(run.result).toEqual({ action: "stop", reason: "problem" });
    expect(run.output).toContain("tracked or untracked changes");
    expect(git(scenario.device, "rev-parse", "HEAD")).toBe(before);
  });

  it("blocks local and origin divergence", async () => {
    const scenario = makeScenario();
    commitFile(scenario.device, "local.txt", "local\n", "local only");
    pushFromAnotherDevice(scenario);
    const before = git(scenario.device, "rev-parse", "HEAD");
    const run = await runChecker(scenario, { confirmations: [false] });

    expect(run.output).toContain("have diverged");
    expect(git(scenario.device, "rev-parse", "HEAD")).toBe(before);
  });

  it("reports but never updates a feature branch", async () => {
    const scenario = makeScenario();
    git(scenario.device, "switch", "-c", "feature/test");
    advanceUpstream(scenario);
    const run = await runChecker(scenario, { confirmations: [false] });

    expect(run.output).toContain("automatic updates only modify main");
    expect(git(scenario.device, "branch", "--show-current")).toBe("feature/test");
  });

  it("blocks detached HEAD checkouts", async () => {
    const scenario = makeScenario();
    git(scenario.device, "switch", "--detach");
    const run = await runChecker(scenario, { confirmations: [false] });

    expect(run.output).toContain("detached HEAD");
  });

  it("adds a missing upstream remote", async () => {
    const scenario = makeScenario();
    git(scenario.device, "remote", "remove", "upstream");
    const run = await runChecker(scenario);

    expect(run.result.reason).toBe("up-to-date");
    expect(git(scenario.device, "remote", "get-url", "upstream")).toBe(scenario.upstream);
  });

  it("refuses to overwrite an unexpected upstream remote", async () => {
    const scenario = makeScenario();
    git(scenario.device, "remote", "set-url", "upstream", scenario.origin);
    const run = await runChecker(scenario, { confirmations: [false] });

    expect(run.output).toContain("checker will not overwrite it");
    expect(git(scenario.device, "remote", "get-url", "upstream")).toBe(scenario.origin);
  });

  it("treats cached relationships as stale when fetching fails", async () => {
    const scenario = makeScenario();
    const run = await runChecker(scenario, { failFetch: true, confirmations: [false] });

    expect(run.output).toContain("relationship may be stale");
    expect(run.output).toContain("simulated offline fetch");
  });

  it("blocks non-interactive updates instead of hanging", async () => {
    const scenario = makeScenario();
    advanceUpstream(scenario);
    const run = await runChecker(scenario, { interactive: false });

    expect(run.result).toEqual({ action: "stop", reason: "problem" });
    expect(run.output).toContain("non-interactive terminal");
    expect(run.questions).toHaveLength(0);
  });

  it("detects an existing Git operation before updating", async () => {
    const scenario = makeScenario();
    advanceUpstream(scenario);
    const run = await runChecker(scenario, {
      simulatedOperation: "REBASE_HEAD",
      confirmations: [false],
    });

    expect(run.output).toContain("rebase operation is already in progress");
  });

  it("aborts a conflicting upstream merge and restores the pre-merge checkout", async () => {
    const scenario = makeScenario();
    const before = commitFile(scenario.device, "app.txt", "fork version\n", "fork conflict");
    git(scenario.device, "push", "origin", "main");
    advanceUpstream(scenario, "upstream version\n", "app.txt");
    const run = await runChecker(scenario, { confirmations: [true, false] });

    expect(run.output).toContain("merge could not be completed cleanly; it was aborted");
    expect(git(scenario.device, "rev-parse", "HEAD")).toBe(before);
    expect(git(scenario.device, "status", "--porcelain")).toBe("");
    expect(
      command("git", ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], scenario.device).exitCode,
    ).not.toBe(0);
  });

  it("does not push when dependency installation fails", async () => {
    const scenario = makeScenario();
    const upstreamHead = advanceUpstream(scenario);
    const originBefore = git(scenario.origin, "rev-parse", "main");
    const run = await runChecker(scenario, {
      installExitCode: 1,
      confirmations: [true, false],
    });

    expect(run.output).toContain("nothing was pushed");
    expect(git(scenario.device, "rev-parse", "HEAD")).toBe(upstreamHead);
    expect(git(scenario.origin, "rev-parse", "main")).toBe(originBefore);
  });

  it("preserves a local update when pushing fails", async () => {
    const scenario = makeScenario();
    const upstreamHead = advanceUpstream(scenario);
    const originBefore = git(scenario.origin, "rev-parse", "main");
    const run = await runChecker(scenario, { failPush: true, confirmations: [true, false] });

    expect(run.output).toContain("pushing origin/main failed");
    expect(git(scenario.device, "rev-parse", "HEAD")).toBe(upstreamHead);
    expect(git(scenario.origin, "rev-parse", "main")).toBe(originBefore);
  });

  it("leaves the checkout unchanged when an update is declined", async () => {
    const scenario = makeScenario();
    advanceUpstream(scenario);
    const before = git(scenario.device, "rev-parse", "HEAD");
    const run = await runChecker(scenario, { confirmations: [false] });

    expect(run.result).toEqual({ action: "continue", reason: "declined" });
    expect(git(scenario.device, "rev-parse", "HEAD")).toBe(before);
  });

  it("supports an explicit skip without touching Git", async () => {
    const scenario = makeScenario();
    const run = await runChecker(scenario, { env: { T3CODE_SKIP_UPSTREAM_CHECK: "1" } });

    expect(run.result).toEqual({ action: "continue", reason: "skipped" });
    expect(run.commands).toHaveLength(0);
  });
});
