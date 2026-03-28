param(
  [switch]$StopDb
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidDir = Join-Path $RootDir ".web-test"
$BackendPidFile = Join-Path $PidDir "backend-shell.pid"
$FrontendPidFile = Join-Path $PidDir "frontend-shell.pid"
$BackendDir = Join-Path $RootDir "backend"

function Write-Step([string]$Message) {
  Write-Host "[stop] $Message" -ForegroundColor Yellow
}

function Stop-RecordedProcess([string]$Label, [string]$PidFile) {
  if (-not (Test-Path $PidFile)) {
    return $false
  }

  $raw = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
  if (-not $raw) {
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    return $false
  }

  $processId = [int]$raw
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Write-Step "Stopped $Label shell PID $processId"
  }

  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  return [bool]$process
}

function Stop-PortListeners([int]$Port, [string]$Label) {
  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) {
    return
  }

  $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($processId in $processIds) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
      Write-Step "Stopped $Label listener PID $processId on port $Port"
    }
  }
}

$stoppedShell = $false
$stoppedShell = (Stop-RecordedProcess -Label "backend" -PidFile $BackendPidFile) -or $stoppedShell
$stoppedShell = (Stop-RecordedProcess -Label "frontend" -PidFile $FrontendPidFile) -or $stoppedShell

Stop-PortListeners -Port 3000 -Label "backend"
Stop-PortListeners -Port 5173 -Label "frontend"

if ((Test-Path $PidDir) -and -not (Get-ChildItem $PidDir -Force -ErrorAction SilentlyContinue)) {
  Remove-Item $PidDir -Force -ErrorAction SilentlyContinue
}

if ($StopDb -and (Test-Path $BackendDir)) {
  Push-Location $BackendDir
  try {
    Write-Step "Stopping PostgreSQL container"
    npm run db:down
  } finally {
    Pop-Location
  }
}

if (-not $stoppedShell) {
  Write-Step "No recorded web-test shells found, applied port-based cleanup only"
}
