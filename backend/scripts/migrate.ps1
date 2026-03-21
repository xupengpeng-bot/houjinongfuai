param(
  [switch]$Reset
)

$ErrorActionPreference = "Stop"

$composeFile = Join-Path $PSScriptRoot "..\\docker-compose.yml"
$migrationDir = Join-Path $PSScriptRoot "..\\sql\\migrations"
$envFile = Join-Path $PSScriptRoot "..\\.env"
$service = "postgres"

function Invoke-DockerCommand {
  param(
    [string]$Command
  )

  Invoke-Expression $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $Command"
  }
}

$dbUser = "postgres"
$dbName = "houji_p1"

if (Test-Path $envFile) {
  $lines = Get-Content $envFile
  foreach ($line in $lines) {
    if ($line -match '^\s*#' -or $line -notmatch '=') {
      continue
    }

    $parts = $line -split '=', 2
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()

    switch ($key) {
      'POSTGRES_USER' { if ($value) { $dbUser = $value } }
      'POSTGRES_DB' { if ($value) { $dbName = $value } }
    }
  }
}

Invoke-DockerCommand "docker compose -f `"$composeFile`" up -d $service | Out-Null"

$maxAttempts = 30
for ($i = 1; $i -le $maxAttempts; $i++) {
  try {
    Invoke-DockerCommand "docker compose -f `"$composeFile`" exec -T $service sh -lc `"pg_isready -U $dbUser -d $dbName`" | Out-Null"
    break
  } catch {
    if ($i -eq $maxAttempts) { throw }
    Start-Sleep -Seconds 2
  }
}

if ($Reset) {
  Invoke-DockerCommand "docker compose -f `"$composeFile`" exec -T $service sh -lc `"psql -U $dbUser -d $dbName -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`""
}

$files = Get-ChildItem -Path $migrationDir -Filter *.sql | Sort-Object Name
foreach ($file in $files) {
  $unixPath = "/workspace/backend/sql/migrations/$($file.Name)"
  Write-Host "Applying $($file.Name)..."
  Invoke-DockerCommand "docker compose -f `"$composeFile`" exec -T $service sh -lc `"psql -v ON_ERROR_STOP=1 -U $dbUser -d $dbName -f $unixPath`""
}

Write-Host "Migrations applied successfully."
