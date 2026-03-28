param(
  [switch]$OpenBrowser,
  [string]$FrontendDir
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DefaultFrontendDir = Join-Path (Split-Path $RootDir -Parent) "lovable"

if ([string]::IsNullOrWhiteSpace($FrontendDir)) {
  $FrontendDir = $DefaultFrontendDir
}

$FrontendDir = [System.IO.Path]::GetFullPath($FrontendDir)
$FrontendEnv = Join-Path $FrontendDir ".env"
$FrontendEnvExample = Join-Path $FrontendDir ".env.example"

function Write-Step([string]$Message) {
  Write-Host "[frontend] $Message" -ForegroundColor Green
}

if (-not (Test-Path $FrontendDir)) {
  throw "Frontend directory not found: $FrontendDir. Pass -FrontendDir <path> or place the frontend repo in the sibling folder '..\\lovable'."
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
