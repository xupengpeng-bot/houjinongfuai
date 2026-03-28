param(
  [switch]$ResetDb,
  [ValidateSet('none', 'reference', 'baseline', 'demo', 'test', 'all')]
  [string]$Seed = 'none'
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RootDir "backend"
$BackendEnv = Join-Path $BackendDir ".env"
$BackendEnvExample = Join-Path $BackendDir ".env.example"

function Write-Step([string]$Message) {
  Write-Host "[backend] $Message" -ForegroundColor Cyan
}

if (-not (Test-Path $BackendDir)) {
  throw "Backend directory not found: $BackendDir"
}

if (-not (Test-Path $BackendEnv) -and (Test-Path $BackendEnvExample)) {
  Copy-Item $BackendEnvExample $BackendEnv
  Write-Step "Created backend .env from .env.example"
}

if (-not (Test-Path (Join-Path $BackendDir "node_modules"))) {
  Write-Step "Installing backend dependencies"
  Push-Location $BackendDir
  try {
    npm install
  } finally {
    Pop-Location
  }
}

Push-Location $BackendDir
try {
  Write-Step "Starting PostgreSQL container"
  npm run db:up

  if ($ResetDb) {
    Write-Step "Resetting migrations"
    npm run db:migrate:reset
  } else {
    Write-Step "Running migrations"
    npm run db:migrate
  }

  if ($Seed -ne 'none') {
    Write-Step "Applying seed profile: $Seed"
    npm run "db:seed:$Seed"
  }

  Write-Step "Starting NestJS backend on http://127.0.0.1:3000"
  npm run start:dev
} finally {
  Pop-Location
}
