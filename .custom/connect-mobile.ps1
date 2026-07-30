$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

$runtimePath = Join-Path $env:USERPROFILE ".t3\dev\server-runtime.json"
if (-not (Test-Path -LiteralPath $runtimePath)) {
    throw "The development server is not running. Start it with 'bun run dev:desktop' first."
}

$runtime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
$serverProcess = Get-Process -Id $runtime.pid -ErrorAction SilentlyContinue
if ($null -eq $serverProcess) {
    throw "The recorded development server is no longer running. Restart 'bun run dev:desktop'."
}

$remoteHost = if ($args.Count -gt 0) {
    $args[0]
} else {
    $tailscaleAddress = Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Tailscale" -ErrorAction SilentlyContinue |
        Where-Object { $_.AddressState -eq "Preferred" } |
        Select-Object -First 1 -ExpandProperty IPAddress
    if ($tailscaleAddress) {
        $tailscaleAddress
    } else {
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.AddressState -eq "Preferred" -and
                $_.IPAddress -notlike "127.*" -and
                $_.IPAddress -notlike "169.254.*"
            } |
            Select-Object -First 1 -ExpandProperty IPAddress
    }
}

if (-not $remoteHost) {
    throw "Could not determine a reachable IP address. Pass one explicitly: connect-mobile.cmd 192.168.x.x"
}

$baseUrl = "http://${remoteHost}:$($runtime.port)"
$previousT3Home = $env:T3CODE_HOME
try {
    $env:T3CODE_HOME = $null
    node --env-file=.env.local apps/server/src/bin.ts auth pairing create `
        --dev-url http://127.0.0.1:5733 `
        --base-url $baseUrl `
        --ttl 1h `
        --label "T3 Mobile dev"
} finally {
    $env:T3CODE_HOME = $previousT3Home
}
exit $LASTEXITCODE
