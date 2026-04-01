param(
  [int]$Port = 3000,
  [switch]$ForceAnyProcess
)

$ErrorActionPreference = "Stop"

function Get-PortOwners {
  try {
    return Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique
  } catch {
    return @()
  }
}

$owners = @(Get-PortOwners)

if ($owners.Count -eq 0) {
  Write-Host "Port $Port is free."
  exit 0
}

foreach ($ownerPid in $owners) {
  try {
    $process = Get-Process -Id $ownerPid -ErrorAction Stop
  } catch {
    continue
  }

  $processName = ""
  if ($null -ne $process.ProcessName) {
    $processName = [string]$process.ProcessName
  }

  $name = $processName.ToLowerInvariant()
  $isSafeToKill = $ForceAnyProcess.IsPresent -or $name -eq "node" -or $name -eq "nest"

  if (-not $isSafeToKill) {
    Write-Warning "Port $Port is occupied by process '$($process.ProcessName)' (PID $ownerPid). Refusing to kill automatically."
    Write-Warning "Close it manually, or rerun with -ForceAnyProcess if you are sure."
    exit 1
  }

  Write-Host "Stopping process '$($process.ProcessName)' (PID $ownerPid) on port $Port..."
  Stop-Process -Id $ownerPid -Force -ErrorAction Stop
}

Start-Sleep -Milliseconds 300

$remaining = @(Get-PortOwners)
if ($remaining.Count -gt 0) {
  Write-Warning "Port $Port is still occupied after cleanup."
  exit 1
}

Write-Host "Port $Port has been cleared."
