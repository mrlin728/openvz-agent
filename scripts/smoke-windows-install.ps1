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
  # Start-Process -Wait on Windows waits for the launched process and all of its
  # descendants. A plain Process.WaitForExit only waits for the NSIS bootstrapper,
  # which can leave its inner installer alive and holding the installer mutex.
  $argumentsJson = ConvertTo-Json -Compress -InputObject @($ArgumentList)
  $job = Start-Job -ScriptBlock {
    param([string]$TargetPath, [string]$ArgumentsJson)
    $targetArguments = @(ConvertFrom-Json -InputObject $ArgumentsJson)
    $targetProcess = Start-Process -FilePath $TargetPath -ArgumentList $targetArguments -Wait -PassThru
    [pscustomobject]@{
      ExitCode = $targetProcess.ExitCode
      ProcessId = $targetProcess.Id
    }
  } -ArgumentList $FilePath, $argumentsJson

  try {
    $completedJob = Wait-Job -Job $job -Timeout $TimeoutSeconds
    if ($null -eq $completedJob) {
      Write-Host "[smoke] $Label timed out; related Windows processes:"
      $targetLeaf = [IO.Path]::GetFileName($FilePath)
      $installDirectoryArgument = $ArgumentList | Where-Object { $_ -like '/D=*' } | Select-Object -First 1
      $targetInstallDirectory = if ($installDirectoryArgument) { $installDirectoryArgument.Substring(3) } else { '' }
      $relatedProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        ($_.ExecutablePath -and $_.ExecutablePath.Equals($FilePath, [StringComparison]::OrdinalIgnoreCase)) -or
        ($_.Name -and ($_.Name -eq $targetLeaf -or $_.Name -eq 'old-uninstaller.exe' -or $_.Name -like 'OpenVZ Agent*' -or $_.Name -like 'Uninstall OpenVZ Agent*')) -or
        ($_.CommandLine -and $_.CommandLine.Contains($FilePath, [StringComparison]::OrdinalIgnoreCase)) -or
        ($targetInstallDirectory -and $_.CommandLine -and $_.CommandLine.Contains($targetInstallDirectory, [StringComparison]::OrdinalIgnoreCase))
      })
      foreach ($relatedProcess in $relatedProcesses) {
        $windowTitle = ''
        $responding = ''
        try {
          $runtimeProcess = Get-Process -Id $relatedProcess.ProcessId -ErrorAction Stop
          $windowTitle = $runtimeProcess.MainWindowTitle
          $responding = $runtimeProcess.Responding
        } catch {}
        Write-Host ("[smoke]   PID={0} PPID={1} Name={2} Responding={3} Window={4} Path={5} CommandLine={6}" -f `
          $relatedProcess.ProcessId,
          $relatedProcess.ParentProcessId,
          $relatedProcess.Name,
          $responding,
          $windowTitle,
          $relatedProcess.ExecutablePath,
          $relatedProcess.CommandLine)
      }

      Stop-Job -Job $job -ErrorAction SilentlyContinue
      foreach ($relatedProcess in $relatedProcesses) {
        Write-Host "[smoke] Terminating timed-out process tree $($relatedProcess.ProcessId)"
        & taskkill.exe /PID $relatedProcess.ProcessId /T /F 2>&1 | Out-Host
      }
      throw "$Label timed out after $TimeoutSeconds seconds"
    }

    $result = Receive-Job -Job $job -ErrorAction Stop | Select-Object -Last 1
    if ($null -eq $result) { throw "$Label completed without returning an exit code" }
    if ($result.ExitCode -ne 0) { throw "$Label failed with $($result.ExitCode)" }
    Write-Host "[smoke] $Label completed (process tree $($result.ProcessId))"
    return $result
  } finally {
    if ($job.State -eq 'Running') {
      Stop-Job -Job $job -ErrorAction SilentlyContinue
    }
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
  }
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

function Test-InstalledApp(
  [string]$InstallDir,
  [string]$UserDir,
  [int]$Port
) {
  $exe = Join-Path $InstallDir 'OpenVZ Agent.exe'
  if (-not (Test-Path $exe)) { throw "Installed executable missing: $exe" }
  Assert-SignatureContract $exe

  $env:OPENVZ_USER_DIR = $UserDir
  $env:OPENVZ_PORT = "$Port"
  $app = Start-Process -FilePath $exe -PassThru
  try {
    $ready = $false
    for ($i = 0; $i -lt 90; $i++) {
      Start-Sleep -Seconds 1
      try {
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/status" -TimeoutSec 2
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
}

Assert-SignatureContract $Setup
node (Join-Path $PSScriptRoot 'smoke-packaged-playwright.mjs')

$SmokeRoot = Join-Path $env:RUNNER_TEMP 'openvz-install-smoke'
$FreshInstallDir = Join-Path $SmokeRoot 'fresh\OpenVZ Agent'
$FreshUserDir = Join-Path $SmokeRoot 'fresh-user-data'
$MigrationInstallDir = Join-Path $SmokeRoot 'migration\OpenVZ Agent'
$MigrationUserDir = $env:OPENVZ_UPGRADE_FIXTURE_DIR
New-Item -ItemType Directory -Force -Path $SmokeRoot, $FreshUserDir | Out-Null

# Current installer fresh-install contract.
Invoke-ProcessChecked -Label 'current-version silent fresh install' -FilePath $Setup -ArgumentList @('/S', '/currentuser', "/D=$FreshInstallDir") -TimeoutSeconds 300 | Out-Null
Test-InstalledApp -InstallDir $FreshInstallDir -UserDir $FreshUserDir -Port 3721

$freshMarker = Join-Path $FreshUserDir 'uninstall-preservation-marker.txt'
Set-Content -Path $freshMarker -Value 'fresh install data retained' -NoNewline
$freshUninstaller = Join-Path $FreshInstallDir 'Uninstall OpenVZ Agent.exe'
if (-not (Test-Path $freshUninstaller)) { throw "Uninstaller missing: $freshUninstaller" }
Invoke-ProcessChecked -Label 'current-version silent uninstall' -FilePath $freshUninstaller -ArgumentList @('/S', '/currentuser') -TimeoutSeconds 180 | Out-Null
if (-not (Test-Path $freshMarker)) { throw 'Silent uninstall removed user data despite keep-data default' }

# The published v2.1.439 NSIS binary cannot be used as a setup fixture: its
# package was already branded OpenVZ Agent while its custom payload validation
# still required Bailongma.exe. Exercise the user-visible upgrade contract with
# a realistic pre-created v2.1.439 data directory instead. The packaged app must
# back it up, migrate it in place, encrypt credentials, and preserve it through
# uninstall.
if (-not $MigrationUserDir -or -not (Test-Path $MigrationUserDir)) {
  throw "v2.1.439 user-data fixture missing: $MigrationUserDir"
}
Invoke-ProcessChecked -Label 'current-version install over v2.1.439 user data' -FilePath $Setup -ArgumentList @('/S', '/currentuser', "/D=$MigrationInstallDir") -TimeoutSeconds 300 | Out-Null
Test-InstalledApp -InstallDir $MigrationInstallDir -UserDir $MigrationUserDir -Port 3722
python (Join-Path $PSScriptRoot 'v21439-packaged-fixture.py') verify $MigrationUserDir
if ($LASTEXITCODE -ne 0) { throw 'Independent v2.1.439 packaged migration verification failed' }

$migrationUninstaller = Join-Path $MigrationInstallDir 'Uninstall OpenVZ Agent.exe'
if (-not (Test-Path $migrationUninstaller)) { throw "Uninstaller missing: $migrationUninstaller" }
Invoke-ProcessChecked -Label 'migrated-version silent uninstall' -FilePath $migrationUninstaller -ArgumentList @('/S', '/currentuser') -TimeoutSeconds 180 | Out-Null
python (Join-Path $PSScriptRoot 'v21439-packaged-fixture.py') verify $MigrationUserDir
if ($LASTEXITCODE -ne 0) { throw 'Silent uninstall removed or changed migrated user data' }

$mode = if ($RequireSignature) { 'signed release' } else { 'unsigned community RC' }
Write-Host "Windows $mode fresh install, packaged v2.1.439 data migration, launch, SQLite, offline Chromium and uninstall smoke: OK"
