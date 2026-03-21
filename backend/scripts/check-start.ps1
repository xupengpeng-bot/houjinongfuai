param(
  [string]$NpmScript = "start"
)

$ErrorActionPreference = "Stop"

$out = Join-Path (Get-Location) "start-dev.log"
$err = Join-Path (Get-Location) "start-dev.err.log"

if (Test-Path $out) { Remove-Item $out -Force }
if (Test-Path $err) { Remove-Item $err -Force }

$arguments = if ($NpmScript -eq "start") { @("start") } else { @("run", $NpmScript) }
$proc = Start-Process -FilePath "npm.cmd" -ArgumentList $arguments -WorkingDirectory (Get-Location) -RedirectStandardOutput $out -RedirectStandardError $err -PassThru

try {
  $ok = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/v1/health" -UseBasicParsing -TimeoutSec 5
      if ($resp.StatusCode -eq 200) {
        $ok = $true
        Write-Output $resp.Content
        break
      }
    } catch {
    }
  }

  if (-not $ok) {
    Write-Output "HEALTH_CHECK_FAILED"
    if (Test-Path $out) { Get-Content $out }
    if (Test-Path $err) { Get-Content $err }
    exit 1
  }
} finally {
  taskkill /PID $proc.Id /T /F | Out-Null
}
