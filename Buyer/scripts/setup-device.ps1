param([switch]$Elevated)
$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
$device = Get-Content -LiteralPath (Join-Path $packageRoot 'config\device.json') -Raw | ConvertFrom-Json
$nodeConfig = Get-Content -LiteralPath (Join-Path $packageRoot 'node\config\node.json') -Raw | ConvertFrom-Json
$tailscaleExe = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
$stamp = Join-Path $packageRoot '.runtime\system-ready.json'
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'Use a Windows 10/11 x64 laptop.' }
if ((Test-Path -LiteralPath $stamp) -and (Test-Path -LiteralPath $tailscaleExe)) {
    $saved = Get-Content -LiteralPath $stamp -Raw | ConvertFrom-Json
    if ($saved.packageRoot -eq $packageRoot) { exit 0 }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'First use: Windows may ask to install Tailscale and allow this paired network.'
    $arguments = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), '-Elevated')
    $setupProcess = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList $arguments -Wait -PassThru
    exit $setupProcess.ExitCode
}
try {
    if (-not (Test-Path -LiteralPath $tailscaleExe)) {
        $manifest = Get-Content -LiteralPath (Join-Path $packageRoot 'installers\tailscale.json') -Raw | ConvertFrom-Json
        $installer = Join-Path $packageRoot ('installers\tailscale-' + $manifest.version + '-amd64.msi')
        if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $manifest.sha256) { throw 'Tailscale installer checksum mismatch.' }
        $signature = Get-AuthenticodeSignature -LiteralPath $installer
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Tailscale') { throw 'Tailscale installer signature is invalid.' }
        $installation = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', ('"' + $installer + '"'), '/qn', '/norestart') -WindowStyle Hidden -Wait -PassThru
        if ($installation.ExitCode -notin @(0, 3010)) { throw ('Tailscale installation failed: ' + $installation.ExitCode) }
    }
    $nodeExe = Join-Path $packageRoot 'node\runtime\node.exe'
    $javaExe = Get-ChildItem -LiteralPath (Join-Path $packageRoot 'node\runtime\java') -Directory | ForEach-Object { Join-Path $_.FullName 'bin\java.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $javaExe -or -not (Test-Path -LiteralPath $nodeExe)) { throw 'Bundled runtime missing. Extract the entire ZIP.' }
    $rules = @(
        @{ suffix='gateway'; program=$nodeExe; port=[int]$nodeConfig.controlPort },
        @{ suffix='peer'; program=$javaExe; port=[int]$nodeConfig.p2pPort }
    )
    foreach ($rule in $rules) {
        $name = 'TradeLock-' + $nodeConfig.networkId + '-' + $device.role + '-' + $rule.suffix
        $settings = @{ Name=$name; Direction='Inbound'; Action='Allow'; Protocol='TCP'; LocalPort=$rule.port; RemoteAddress='100.64.0.0/10'; Program=$rule.program; Profile='Any' }
        if (Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue) { Set-NetFirewallRule @settings | Out-Null }
        else { New-NetFirewallRule @settings -DisplayName ('TradeLock ' + $device.role + ' ' + $rule.suffix + ' over Tailscale') | Out-Null }
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $packageRoot '.runtime') | Out-Null
    @{ packageRoot=$packageRoot; completedAt=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $stamp
} catch {
    New-Item -ItemType Directory -Force -Path (Join-Path $packageRoot '.runtime') | Out-Null
    $_.Exception.Message | Set-Content -LiteralPath (Join-Path $packageRoot '.runtime\setup-error.txt')
    Write-Error $_.Exception.Message
    exit 1
}
