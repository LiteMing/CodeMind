param(
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Root = Split-Path -Parent $PSScriptRoot
$ExtensionDir = Join-Path $Root "vscode-extension"
$OutDir = Join-Path $Root "dist"
$VsceBin = Join-Path $ExtensionDir "node_modules\.bin\vsce.cmd"
$BackendDir = Join-Path $ExtensionDir "resources\backend"

if (-not (Test-Path $ExtensionDir)) {
  throw "VS Code extension directory not found: $ExtensionDir"
}

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

Push-Location $ExtensionDir
try {
  if (-not $SkipInstall) {
    if (Test-Path (Join-Path $ExtensionDir "package-lock.json")) {
      npm ci
    } else {
      npm install
    }
  }

  npm run compile

  # The extension is a thin client: it connects to a running Code Mind
  # backend (desktop app or `codemind serve`) and no longer bundles its own
  # server binary. Clean up any leftover bundled backend from older builds.
  if (Test-Path $BackendDir) {
    Remove-Item $BackendDir -Recurse -Force
  }

  $PackageArgs = @(
    "package",
    "--out", $OutDir,
    "--no-dependencies",
    "--allow-missing-repository",
    "--skip-license"
  )

  if (Test-Path $VsceBin) {
    & $VsceBin @PackageArgs
  } else {
    npx --yes @vscode/vsce @PackageArgs
  }
}
finally {
  Pop-Location
}
