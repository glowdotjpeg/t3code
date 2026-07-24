# Custom T3 Code workflow

This checkout uses two long-lived branches:

- `main` is a clean mirror of `pingdotgg/t3code`.
- `custom` contains personal features and receives updates from `main`.

The official repository is configured as the `upstream` remote. Do not make
personal commits on `main`.

## Start the desktop development environment

From the repository root:

```powershell
.\.custom\start-dev.cmd
```

This starts the desktop app with `T3CODE_DEV_INSTANCE=custom`, giving it an
isolated development port set. Source changes hot reload.

## Make a feature

For small personal changes, committing directly to `custom` is acceptable:

```powershell
git switch custom
git add <changed-files>
git commit -m "feat(custom): describe the change"
```

For larger work, use a short-lived feature branch and merge it back:

```powershell
git switch custom
git switch -c feature/my-feature
# Make and commit changes.
git switch custom
git merge feature/my-feature
```

## Receive updates from T3 Code

First commit or stash all work, then run:

```powershell
.\.custom\sync-upstream.cmd
```

The helper:

1. refuses to run with uncommitted changes;
2. fetches `upstream`;
3. fast-forwards local `main` to `upstream/main`;
4. switches back to `custom`;
5. merges the updated `main` into `custom`.

If Git reports conflicts, edit the conflicted files, then run:

```powershell
git add <resolved-files>
git commit
```

After an update, start the dev app and verify the features you changed.

## Connect a personal GitHub fork

This local checkout can run without a fork. To back up or share the `custom`
branch, create a GitHub fork and add it as `origin`:

```powershell
git remote add origin https://github.com/YOUR_USERNAME/t3code.git
git push -u origin main
git push -u origin custom
```

Keep `upstream` pointed at:

```text
https://github.com/pingdotgg/t3code.git
```

Do not replace `upstream` with the fork URL.
