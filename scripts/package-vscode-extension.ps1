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
$FrontendDist = Join-Path $Root "frontend\dist"

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

  if (-not (Test-Path $FrontendDist)) {
    npm run build --prefix (Join-Path $Root "frontend")
  }
  if (Test-Path $BackendDir) {
    Remove-Item $BackendDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $BackendDir | Out-Null
  go build -o (Join-Path $BackendDir "codemind-server.exe") (Join-Path $Root "cmd\server")
  Copy-Item $FrontendDist (Join-Path $BackendDir "dist") -Recurse -Force

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
