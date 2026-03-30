param(
  [switch]$OpenBrowser,
  [string]$FrontendDir
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkspaceParent = Split-Path $RootDir -Parent
$LovableWorking = Join-Path $WorkspaceParent "lovable-working"
$LovableLegacy = Join-Path $WorkspaceParent "lovable"

if ([string]::IsNullOrWhiteSpace($FrontendDir)) {
  if (Test-Path (Join-Path $LovableWorking "package.json")) {
    $FrontendDir = $LovableWorking
  } elseif (Test-Path (Join-Path $LovableLegacy "package.json")) {
    $FrontendDir = $LovableLegacy
  } else {
    $FrontendDir = $LovableWorking
  }
}

$FrontendDir = [System.IO.Path]::GetFullPath($FrontendDir)
$FrontendEnv = Join-Path $FrontendDir ".env"
$FrontendEnvExample = Join-Path $FrontendDir ".env.example"

function Write-Step([string]$Message) {
  Write-Host "[frontend] $Message" -ForegroundColor Green
}

if (-not (Test-Path $FrontendDir) -or -not (Test-Path (Join-Path $FrontendDir "package.json"))) {
  throw @"
Frontend not found or missing package.json: $FrontendDir

Fix one of:
  1) Clone/checkout the Vite app next to this repo, e.g.:
     $LovableWorking
  2) Or pass an explicit path:
     .\start-frontend.ps1 -FrontendDir 'D:\path\to\your-frontend'

Expected sibling folder names (under $WorkspaceParent): lovable-working (preferred) or lovable.
"@
}

if (-not (Test-Path $FrontendEnv) -and (Test-Path $FrontendEnvExample)) {
  Copy-Item $FrontendEnvExample $FrontendEnv
  Write-Step "Created frontend .env from .env.example"
}

if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
  Write-Step "Installing frontend dependencies"
  Push-Location $FrontendDir
  try {
    npm install
  } finally {
    Pop-Location
  }
}

if ($OpenBrowser) {
  Start-Process "http://127.0.0.1:5173"
}

Push-Location $FrontendDir
try {
  Write-Step "Starting Vite on http://127.0.0.1:5173 from $FrontendDir"
  npm run dev -- --host 127.0.0.1 --port 5173
} finally {
  Pop-Location
}
