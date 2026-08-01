$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Setup = Join-Path $Root 'dist\OpenVZ-Agent-Setup.exe'
$RequireSignature = $env:OPENVZ_RELEASE_BUILD -eq '1'
if (-not (Test-Path $Setup)) { throw "Installer missing: $Setup" }

function Assert-SignatureContract([string]$Path) {
  $signature = Get-AuthenticodeSignature -FilePath $Path
  if ($RequireSignature) {
    if ($signature.Status -ne 'Valid') { throw "Invalid Authenticode signature for $Path ($($signature.Status))" }
    if ($env:OPENVZ_AZURE_PUBLISHER -and $signature.SignerCertificate.Subject -notlike "*$($env:OPENVZ_AZURE_PUBLISHER)*") {
      throw "Unexpected signer: $($signature.SignerCertificate.Subject)"
    }
    Write-Host "Signature OK: $($signature.SignerCertificate.Subject)"
    return
  }

  if ($signature.Status -notin @('NotSigned', 'Valid')) {
    throw "Unexpected signature status for unsigned RC: $Path ($($signature.Status))"
  }
  Write-Host "Unsigned RC signature status: $($signature.Status)"
}

function Invoke-ProcessChecked(
  [string]$Label,
  [string]$FilePath,
  [string[]]$ArgumentList,
  [int]$TimeoutSeconds
) {
  Write-Host "[smoke] Starting $Label (timeout: $TimeoutSeconds seconds)"
  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -PassThru
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Write-Host "[smoke] $Label timed out; terminating process tree $($process.Id)"
    & taskkill.exe /PID $process.Id /T /F 2>&1 | Out-Host
    throw "$Label timed out after $TimeoutSeconds seconds"
  }
  if ($process.ExitCode -ne 0) { throw "$Label failed with $($process.ExitCode)" }
  Write-Host "[smoke] $Label completed"
  return $process
}

function Get-InstalledProcesses([string]$Root) {
  $normalizedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($normalizedRoot, [StringComparison]::OrdinalIgnoreCase)
  })
}

function Stop-InstalledProcessTrees([string]$Root) {
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $processes = Get-InstalledProcesses $Root
    if ($processes.Count -eq 0) {
      Write-Host '[smoke] Installed process trees are stopped'
      return
    }

    foreach ($process in $processes) {
      Write-Host "[smoke] Stopping installed process $($process.Name) ($($process.ProcessId))"
      & taskkill.exe /PID $process.ProcessId /T /F 2>&1 | Out-Host
    }
    Start-Sleep -Seconds 1
  }

  $remaining = Get-InstalledProcesses $Root
  $details = ($remaining | ForEach-Object { "$($_.Name) ($($_.ProcessId))" }) -join ', '
  throw "Installed processes did not exit before upgrade: $details"
}

Assert-SignatureContract $Setup
node (Join-Path $PSScriptRoot 'smoke-packaged-playwright.mjs')

$SmokeRoot = Join-Path $env:RUNNER_TEMP 'openvz-install-smoke'
$InstallDir = Join-Path $SmokeRoot 'OpenVZ Agent'
$UserDir = Join-Path $SmokeRoot 'user-data'
New-Item -ItemType Directory -Force -Path $SmokeRoot, $UserDir | Out-Null

Invoke-ProcessChecked -Label 'silent install' -FilePath $Setup -ArgumentList @('/S', '/currentuser', "/D=$InstallDir") -TimeoutSeconds 300 | Out-Null

$Exe = Join-Path $InstallDir 'OpenVZ Agent.exe'
$Uninstaller = Join-Path $InstallDir 'Uninstall OpenVZ Agent.exe'
if (-not (Test-Path $Exe)) { throw "Installed executable missing: $Exe" }
Assert-SignatureContract $Exe

$env:OPENVZ_USER_DIR = $UserDir
$env:OPENVZ_PORT = '3721'
$app = Start-Process -FilePath $Exe -PassThru
try {
  $ready = $false
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    try {
      $status = Invoke-RestMethod -Uri 'http://127.0.0.1:3721/status' -TimeoutSec 2
      if ($null -ne $status) { $ready = $true; break }
    } catch {}
    if ($app.HasExited) { throw "Installed app exited early with $($app.ExitCode)" }
  }
  if (-not $ready) { throw 'Installed app did not expose /status within 90 seconds' }
  if (-not (Test-Path (Join-Path $UserDir 'data\jarvis.db'))) { throw 'Native SQLite module did not create jarvis.db' }
} finally {
  if (-not $app.HasExited) {
    Write-Host "[smoke] Stopping app process tree $($app.Id)"
    & taskkill.exe /PID $app.Id /T /F 2>&1 | Out-Host
  }
  Stop-InstalledProcessTrees $InstallDir
}

# Upgrade/user-data contract: installers and uninstallers must not erase existing data.
$marker = Join-Path $UserDir 'upgrade-preservation-marker.txt'
Set-Content -Path $marker -Value 'v2.1.439 fixture retained' -NoNewline
Invoke-ProcessChecked -Label 'silent upgrade' -FilePath $Setup -ArgumentList @('/S', '/currentuser', "/D=$InstallDir") -TimeoutSeconds 300 | Out-Null
if (-not (Test-Path $marker)) { throw 'Upgrade removed user data' }

if (-not (Test-Path $Uninstaller)) { throw "Uninstaller missing: $Uninstaller" }
Invoke-ProcessChecked -Label 'silent uninstall' -FilePath $Uninstaller -ArgumentList @('/S', '/currentuser') -TimeoutSeconds 180 | Out-Null
if (-not (Test-Path $marker)) { throw 'Silent uninstall removed user data despite keep-data default' }

$mode = if ($RequireSignature) { 'signed release' } else { 'unsigned community RC' }
Write-Host "Windows $mode install, launch, SQLite, offline Chromium, upgrade and uninstall smoke: OK"
