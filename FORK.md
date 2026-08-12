# Maintaining this fork

This repository is a personal fork of [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code). Its `main` branch contains the personal changes and periodically merges official `upstream/main` updates. It never rebases or force-pushes shared history.

## Set up a new device

```bash
git clone https://github.com/glowdotjpeg/t3code.git
cd t3code
pnpm install
pnpm run dev:desktop
```

Use the Node and pnpm versions declared in `package.json` (currently Node 24.13.1 and pnpm 11.10.0). With Node 24, `corepack enable` lets the `packageManager` field select the pinned pnpm version instead of whichever global pnpm happens to be installed.

The first development run adds this standard remote automatically if it is missing:

```text
origin    -> your personal GitHub fork
upstream  -> https://github.com/pingdotgg/t3code.git
```

Checking and fetching are public Git operations. Pushing the synchronized result requires GitHub credentials on the device; authenticate Git or run `gh auth login` before accepting an update if needed.

## What the development check does

`dev`, `dev:share`, `dev:server`, `dev:web`, and `dev:desktop` all check GitHub before starting. You can run the same check without starting an app:

```bash
pnpm run fork:sync
```

The report distinguishes:

- commits only on the current device;
- commits only on `origin/main`, usually pushed from another device;
- fork-specific commits; and
- commits available from official `upstream/main`.

When an update is available, pressing Enter accepts the default: fast-forward from the personal fork if necessary, merge official upstream, run `pnpm install --frozen-lockfile`, and push the resulting `main` to `origin`. A merge is used instead of a rebase so every device can fast-forward through the same shared history without force-pushing.

Answering no changes nothing and starts the requested development command with the current checkout.

## Safety and recovery

Automatic updates require a clean `main` branch. The checker will not stash, reset, overwrite a differently configured `upstream` remote, update a feature branch, or proceed through local/remote divergence. It aborts a conflicting upstream merge and explains the manual recovery step.

If a fetch, merge, install, or push fails, the default is to stop before development starts. You can explicitly choose to continue with the current checkout when the terminal is interactive.

For intentional offline work, bypass the check for one command:

```bash
T3CODE_SKIP_UPSTREAM_CHECK=1 pnpm run dev:desktop
```

PowerShell equivalent:

```powershell
$env:T3CODE_SKIP_UPSTREAM_CHECK = "1"
pnpm run dev:desktop
Remove-Item Env:T3CODE_SKIP_UPSTREAM_CHECK
```

Common recovery commands:

```bash
git status
git fetch origin main
git fetch upstream main
git pull --ff-only origin main
git merge upstream/main
git push origin main
```

Do not force-push `main`. If another device changed `origin/main`, reconcile that history first and rerun `pnpm run fork:sync`.

## Pre-reset archive

The previous custom branches were removed on August 12, 2026. Their final commits remain recoverable through these tags:

- `archive/custom-before-reset-2026-08-12`
- `archive/clickable-markdown-before-reset-2026-08-12`

There is no scheduled or background synchronization. Updates happen only when a development command or `pnpm run fork:sync` performs the visible check.
