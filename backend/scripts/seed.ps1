param(
  [ValidateSet('reference', 'baseline', 'demo', 'test', 'all')]
  [string]$Group = 'reference'
)

$ErrorActionPreference = "Stop"

$composeFile = Join-Path $PSScriptRoot "..\\docker-compose.yml"
$seedDir = Join-Path $PSScriptRoot "..\\sql\\seed"
$service = "postgres"

$seedGroups = @{
  reference = @(
    '001a_region_reference.sql'
  )
  baseline = @(
    '001_reference.sql'
  )
  demo = @(
    '002_assets.sql',
    '002b_project_asset_contract.sql',
    '003_billing_policy_topology.sql'
  )
  test = @(
    '010_smoke_runtime_order.sql',
    '020_uat_events.sql',
    '030_edge_cases.sql'
  )
}

function Resolve-SeedSequence([string]$RequestedGroup) {
  switch ($RequestedGroup) {
    'reference' { return @('reference') }
    'baseline' { return @('baseline') }
    'demo' { return @('baseline', 'demo') }
    'test' { return @('baseline', 'demo', 'test') }
    'all' { return @('baseline', 'demo', 'test') }
    default { throw "Unsupported seed group: $RequestedGroup" }
  }
}

$resolvedGroups = Resolve-SeedSequence $Group
$seedFileNames = New-Object System.Collections.Generic.List[string]
foreach ($resolvedGroup in $resolvedGroups) {
  foreach ($fileName in $seedGroups[$resolvedGroup]) {
    if (-not $seedFileNames.Contains($fileName)) {
      $seedFileNames.Add($fileName)
    }
  }
}

$files = foreach ($fileName in $seedFileNames) {
  $fullPath = Join-Path $seedDir $fileName
  if (-not (Test-Path $fullPath)) {
    throw "Seed file not found: $fileName"
  }
  Get-Item $fullPath
}

Write-Host "Applying seed group '$Group'..." -ForegroundColor Cyan
foreach ($file in $files) {
  Write-Host "Applying seed $($file.Name)..."
  Get-Content -Path $file.FullName -Raw | docker compose -f $composeFile exec -T $service sh -lc "psql -v ON_ERROR_STOP=1 -U postgres -d houji_p1"
  if ($LASTEXITCODE -ne 0) {
    throw "Seed failed: $($file.Name)"
  }
}

Write-Host "Seed group '$Group' applied successfully."
