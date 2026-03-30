param(
  [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$backendRoot = Join-Path $here ".."

Write-Host "=== 1/3 重置库结构（DROP SCHEMA + 全部 migrations，业务与演示数据清空）===" -ForegroundColor Cyan
& (Join-Path $here "migrate.ps1") -Reset

Push-Location $backendRoot
try {
  Write-Host "=== 2/3 从 CSV 导入省/市/县/乡/村（region_reference，全国基础数据）===" -ForegroundColor Cyan
  npm run region-reference:import
  if (-not $SkipVerify) {
    Write-Host "=== 3/3 校验 region_reference ===" -ForegroundColor Cyan
    npm run region-reference:verify
  }
}
finally {
  Pop-Location
}

Write-Host "完成。库内仅保留 migrations + region_reference 基础区划；请勿在库内手工改 region_reference（已触发器锁定，维护用 import 脚本并临时放开会话）。" -ForegroundColor Green
