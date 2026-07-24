$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

$vitePlusBin = Join-Path $env:USERPROFILE ".vite-plus\bin"
$bunBin = Join-Path $env:USERPROFILE ".bun\bin"
$env:PATH = "$vitePlusBin;$bunBin;$env:PATH"
$env:T3CODE_DEV_INSTANCE = "custom"

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    throw "Bun was not found. Restart the terminal or reinstall it from https://bun.sh/."
}

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "node_modules"))) {
    throw "Dependencies are missing. Run 'vp i' from the repository root first."
}

Write-Host "Starting custom T3 Code desktop development environment..."
Write-Host "Development instance: $env:T3CODE_DEV_INSTANCE"
& bun run dev:desktop
exit $LASTEXITCODE
