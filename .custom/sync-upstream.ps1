$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments
    )

    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: git $($Arguments -join ' ')"
    }
}

$insideWorkTree = (& git rev-parse --is-inside-work-tree 2>$null)
if ($LASTEXITCODE -ne 0 -or $insideWorkTree -ne "true") {
    throw "This script must run from the T3 Code Git checkout."
}

$currentBranch = (& git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $currentBranch -ne "custom") {
    throw "Switch to the 'custom' branch before syncing."
}

$workingTreeChanges = & git status --porcelain
if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect the Git working tree."
}
if ($workingTreeChanges) {
    throw "Commit or stash all changes before syncing upstream."
}

& git remote get-url upstream *> $null
if ($LASTEXITCODE -ne 0) {
    throw "The 'upstream' remote is missing."
}

Write-Host "Fetching T3 Code updates..."
Invoke-Git -Arguments @("fetch", "upstream")

Write-Host "Fast-forwarding clean main from upstream/main..."
Invoke-Git -Arguments @("switch", "main")
Invoke-Git -Arguments @("merge", "--ff-only", "upstream/main")

Write-Host "Merging updated main into custom..."
Invoke-Git -Arguments @("switch", "custom")
Invoke-Git -Arguments @("merge", "main")

Write-Host ""
Write-Host "Custom T3 Code is synchronized with upstream/main."
Write-Host "Run .\.custom\start-dev.cmd to verify your custom build."
