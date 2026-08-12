#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - this bootstrap must work before workspace dependencies load.
import * as NodeChildProcess from "node:child_process";
import * as NodeReadlinePromises from "node:readline/promises";

import {
  parseConfirmation,
  runForkUpstreamCheck,
  type CommandRequest,
  type CommandResult,
} from "./lib/fork-upstream.ts";

async function runCommand(request: CommandRequest): Promise<CommandResult> {
  return new Promise((resolve) => {
    const capture = request.output !== "inherit";
    const child = NodeChildProcess.spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: process.env,
      shell: false,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
    });
    const stdout: Array<Buffer> = [];
    const stderr: Array<Buffer> = [];
    if (capture) {
      child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    }
    child.once("error", (error) => {
      resolve({
        exitCode: 127,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}${error.message}`,
      });
    });
    child.once("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function confirm(question: string, defaultValue: boolean): Promise<boolean> {
  const readline = NodeReadlinePromises.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const suffix = defaultValue ? "[Y/n]" : "[y/N]";
  try {
    for (;;) {
      const answer = await readline.question(`${question} ${suffix} `);
      const parsed = parseConfirmation(answer, defaultValue);
      if (parsed !== undefined) {
        return parsed;
      }
      process.stdout.write("Please answer yes or no.\n");
    }
  } finally {
    readline.close();
  }
}

export async function main(): Promise<number> {
  const result = await runForkUpstreamCheck({
    cwd: process.cwd(),
    env: process.env,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    lifecycleEvent: process.env.npm_lifecycle_event,
    nodeExecutable: process.execPath,
    npmExecPath: process.env.npm_execpath,
    isWindows: process.env.OS === "Windows_NT",
    runCommand,
    confirm,
    write: (message) => process.stdout.write(`${message}\n`),
  });
  return result.action === "continue" ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[fork-sync] Unexpected failure: ${message}\n`);
    return 1;
  });
}
