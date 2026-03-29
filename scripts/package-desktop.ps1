$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = Split-Path -Parent $PSScriptRoot
$wailsConfigPath = Join-Path $projectRoot 'wails.json'
$wailsConfig = Get-Content -Raw -Encoding UTF8 $wailsConfigPath | ConvertFrom-Json

$version = [string]$wailsConfig.info.productVersion
if (-not $version -or $version -notmatch '^\d+\.\d+\.\d+$') {
  throw "wails.json info.productVersion must use x.y.z format."
}

$iconPath = Join-Path $projectRoot 'build\\windows\\icon.ico'
if (-not (Test-Path $iconPath)) {
  throw "Missing app icon: $iconPath"
}

$baseName = [System.IO.Path]::GetFileNameWithoutExtension([string]$wailsConfig.outputfilename)
$sourceExe = Join-Path $projectRoot "build\\bin\\$baseName.exe"
$versionedExe = Join-Path $projectRoot "build\\bin\\$baseName-$version.exe"
$pendingExe = Join-Path $projectRoot "build\\bin\\$baseName-$version.pending.exe"

Push-Location $projectRoot
try {
  wails build -nopackage
} finally {
  Pop-Location
}

if (-not (Test-Path $sourceExe)) {
  throw "Packaged exe not found: $sourceExe"
}

if (Test-Path $versionedExe) {
  try {
    Remove-Item $versionedExe -Force -ErrorAction Stop
  } catch {
    if (Test-Path $pendingExe) {
      Remove-Item $pendingExe -Force -ErrorAction SilentlyContinue
    }
    Move-Item $sourceExe $pendingExe -Force
    throw "Target exe is in use. Close $versionedExe and rerun npm run build:desktop. The new build was kept at $pendingExe"
  }
}

Move-Item $sourceExe $versionedExe -Force

Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($versionedExe)
if (-not $icon) {
  throw "Failed to extract app icon from: $versionedExe"
}

Write-Host "Packaged: $versionedExe"
