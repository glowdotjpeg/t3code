$ErrorActionPreference = "Stop"

$command = if ($args.Count -gt 0) { $args[0] } else { "link" }
$allowedCommands = @("link", "status", "unlink", "logout")
if ($command -notin $allowedCommands) {
    throw "Unsupported command '$command'. Use link, status, unlink, or logout."
}

$node = Get-Command node -ErrorAction Stop
$npx = Join-Path (Split-Path $node.Source) "npx.cmd"
$baseDir = Join-Path $env:USERPROFILE ".t3"

Write-Host "T3 Connect data directory: $baseDir"
& $npx --yes t3@latest connect $command --base-dir $baseDir
exit $LASTEXITCODE
