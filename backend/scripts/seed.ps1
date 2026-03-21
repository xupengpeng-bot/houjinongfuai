$ErrorActionPreference = "Stop"

$composeFile = Join-Path $PSScriptRoot "..\\docker-compose.yml"
$seedDir = Join-Path $PSScriptRoot "..\\sql\\seed"
$service = "postgres"

$files = Get-ChildItem -Path $seedDir -Filter *.sql | Sort-Object Name
foreach ($file in $files) {
  $unixPath = "/workspace/backend/sql/seed/$($file.Name)"
  Write-Host "Applying seed $($file.Name)..."
  docker compose -f $composeFile exec -T $service sh -lc "psql -v ON_ERROR_STOP=1 -U postgres -d houji_p1 -f $unixPath"
  if ($LASTEXITCODE -ne 0) {
    throw "Seed failed: $($file.Name)"
  }
}

Write-Host "Seed applied successfully."
