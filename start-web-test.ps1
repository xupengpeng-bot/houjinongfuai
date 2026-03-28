param(
  [switch]$ResetDb,
  [ValidateSet('none', 'reference', 'baseline', 'demo', 'test', 'all')]
  [string]$Seed = 'none',
  [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendScript = Join-Path $RootDir "start-backend.ps1"
$FrontendScript = Join-Path $RootDir "start-frontend.ps1"
$PidDir = Join-Path $RootDir ".web-test"
$BackendPidFile = Join-Path $PidDir "backend-shell.pid"
$FrontendPidFile = Join-Path $PidDir "frontend-shell.pid"

if (-not (Test-Path $PidDir)) {
  New-Item -ItemType Directory -Path $PidDir | Out-Null
}

function Start-Window([string]$Title, [string]$ScriptPath, [string[]]$Arguments) {
  $joinedArguments = if ($Arguments -and $Arguments.Count -gt 0) {
    " " + ($Arguments -join " ")
  } else {
    ""
  }

  $argumentLine = "-NoExit -ExecutionPolicy Bypass -File `"$ScriptPath`"$joinedArguments"

  $process = Start-Process -FilePath "powershell.exe" -ArgumentList $argumentLine -WorkingDirectory $RootDir -WindowStyle Normal -PassThru
  Write-Host "[$Title] started" -ForegroundColor Yellow
  return $process.Id
}

$backendArgs = @()
if ($ResetDb) { $backendArgs += "-ResetDb" }
if ($Seed -ne 'none') {
  $backendArgs += "-Seed"
  $backendArgs += $Seed
}

$frontendArgs = @()
if ($OpenBrowser) { $frontendArgs += "-OpenBrowser" }

$backendPid = Start-Window -Title "backend" -ScriptPath $BackendScript -Arguments $backendArgs
Set-Content -Path $BackendPidFile -Value $backendPid
Start-Sleep -Seconds 2
$frontendPid = Start-Window -Title "frontend" -ScriptPath $FrontendScript -Arguments $frontendArgs
Set-Content -Path $FrontendPidFile -Value $frontendPid

Write-Host ""
Write-Host "Backend:  http://127.0.0.1:3000/api/v1/health" -ForegroundColor Cyan
Write-Host "Frontend: http://127.0.0.1:5173" -ForegroundColor Green
Write-Host ""
Write-Host "Tips:" -ForegroundColor White
Write-Host "1. Clean startup (no business/demo/test seed): .\start-web-test.ps1 -ResetDb"
Write-Host "2. Reference-only startup: .\start-web-test.ps1 -ResetDb -Seed reference"
Write-Host "3. Explicit demo startup: .\start-web-test.ps1 -ResetDb -Seed demo"
Write-Host "4. Close the two PowerShell windows to stop the servers"
