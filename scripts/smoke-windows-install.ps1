$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Setup = Join-Path $Root 'dist\OpenVZ-Agent-Setup.exe'
if (-not (Test-Path $Setup)) { throw "Installer missing: $Setup" }

function Assert-ValidSignature([string]$Path) {
  $signature = Get-AuthenticodeSignature -FilePath $Path
  if ($signature.Status -ne 'Valid') { throw "Invalid Authenticode signature for $Path ($($signature.Status))" }
  if ($env:OPENVZ_AZURE_PUBLISHER -and $signature.SignerCertificate.Subject -notlike "*$($env:OPENVZ_AZURE_PUBLISHER)*") {
    throw "Unexpected signer: $($signature.SignerCertificate.Subject)"
  }
  Write-Host "Signature OK: $($signature.SignerCertificate.Subject)"
}

Assert-ValidSignature $Setup
node (Join-Path $PSScriptRoot 'smoke-packaged-playwright.mjs')

$SmokeRoot = Join-Path $env:RUNNER_TEMP 'openvz-install-smoke'
$InstallDir = Join-Path $SmokeRoot 'OpenVZ Agent'
$UserDir = Join-Path $SmokeRoot 'user-data'
New-Item -ItemType Directory -Force -Path $SmokeRoot, $UserDir | Out-Null

$installer = Start-Process -FilePath $Setup -ArgumentList @('/S', '/currentuser', "/D=$InstallDir") -Wait -PassThru
if ($installer.ExitCode -ne 0) { throw "Silent installer failed with $($installer.ExitCode)" }

$Exe = Join-Path $InstallDir 'OpenVZ Agent.exe'
$Uninstaller = Join-Path $InstallDir 'Uninstall OpenVZ Agent.exe'
if (-not (Test-Path $Exe)) { throw "Installed executable missing: $Exe" }
Assert-ValidSignature $Exe

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
  if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force }
}

# Upgrade/user-data contract: installers and uninstallers must not erase existing data.
$marker = Join-Path $UserDir 'upgrade-preservation-marker.txt'
Set-Content -Path $marker -Value 'v2.1.439 fixture retained' -NoNewline
$installer2 = Start-Process -FilePath $Setup -ArgumentList @('/S', '/currentuser', "/D=$InstallDir") -Wait -PassThru
if ($installer2.ExitCode -ne 0) { throw "Silent upgrade failed with $($installer2.ExitCode)" }
if (-not (Test-Path $marker)) { throw 'Upgrade removed user data' }

if (-not (Test-Path $Uninstaller)) { throw "Uninstaller missing: $Uninstaller" }
$uninstall = Start-Process -FilePath $Uninstaller -ArgumentList @('/S', '/currentuser') -Wait -PassThru
if ($uninstall.ExitCode -ne 0) { throw "Silent uninstall failed with $($uninstall.ExitCode)" }
if (-not (Test-Path $marker)) { throw 'Silent uninstall removed user data despite keep-data default' }

Write-Host 'Windows signed install, launch, SQLite, offline Chromium, upgrade and uninstall smoke: OK'
