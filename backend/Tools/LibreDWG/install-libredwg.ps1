# Re-download LibreDWG 0.13.4 win64 from GitHub releases into this directory.
# Run from repo root:  pwsh -File backend/Tools/LibreDWG/install-libredwg.ps1
# Or:  cd backend/Tools/LibreDWG; .\install-libredwg.ps1

$ErrorActionPreference = "Stop"
$Version = "0.13.4"
$ZipName = "libredwg-$Version-win64.zip"
$Url = "https://github.com/LibreDWG/libredwg/releases/download/$Version/$ZipName"
$ExpectedSha256 = "cb46bce034296e91cb1a982cd53ec1928b11f4f7f70512dd21513a27959688b5"

$DestDir = $PSScriptRoot
$TempZip = Join-Path ([System.IO.Path]::GetTempPath()) $ZipName
$ExtractRoot = Join-Path ([System.IO.Path]::GetTempPath()) "libredwg-win64-install-$Version"

Write-Host "[LibreDWG] Downloading $Url" -ForegroundColor Cyan
Invoke-WebRequest -Uri $Url -OutFile $TempZip -UseBasicParsing

$hash = (Get-FileHash -Algorithm SHA256 -Path $TempZip).Hash.ToLowerInvariant()
if ($hash -ne $ExpectedSha256) {
  Remove-Item $TempZip -Force -ErrorAction SilentlyContinue
  throw "SHA256 mismatch: got $hash, expected $ExpectedSha256"
}

if (Test-Path $ExtractRoot) { Remove-Item $ExtractRoot -Recurse -Force }
Expand-Archive -Path $TempZip -DestinationPath $ExtractRoot -Force

$srcRoot = if (Test-Path (Join-Path $ExtractRoot "dwgread.exe")) {
  $ExtractRoot
} else {
  (Get-ChildItem $ExtractRoot -Directory | Where-Object { Test-Path (Join-Path $_.FullName "dwgread.exe") } | Select-Object -First 1).FullName
}
if (-not $srcRoot -or -not (Test-Path (Join-Path $srcRoot "dwgread.exe"))) {
  throw "Could not find dwgread.exe inside extracted archive."
}

Copy-Item (Join-Path $srcRoot "dwgread.exe") $DestDir -Force
Copy-Item (Join-Path $srcRoot "*.dll") $DestDir -Force
if (Test-Path (Join-Path $srcRoot "README.txt")) {
  Copy-Item (Join-Path $srcRoot "README.txt") (Join-Path $DestDir "LibreDWG-UPSTREAM-README.txt") -Force
}

Remove-Item $TempZip -Force -ErrorAction SilentlyContinue
Remove-Item $ExtractRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "[LibreDWG] Installed dwgread.exe + DLLs into $DestDir" -ForegroundColor Green
& (Join-Path $DestDir "dwgread.exe") --version
