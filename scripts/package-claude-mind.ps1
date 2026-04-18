$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = Split-Path -Parent $PSScriptRoot
$wailsConfigPath = Join-Path $projectRoot 'wails.json'
$wailsConfig = Get-Content -Raw -Encoding UTF8 $wailsConfigPath | ConvertFrom-Json

$version = [string]$wailsConfig.info.productVersion
if (-not $version -or $version -notmatch '^\d+\.\d+\.\d+$') {
  throw "wails.json info.productVersion must use x.y.z format."
}

function Write-WindowsVersionInfo {
  param(
    [string]$Path,
    [string]$ProductVersion,
    [string]$CompanyName,
    [string]$ProductName,
    [string]$Comments
  )

  $fileVersion = "$ProductVersion.0"
  $versionInfo = [ordered]@{
    fixed = [ordered]@{
      file_version = $fileVersion
      product_version = $fileVersion
    }
    info = [ordered]@{
      '0000' = [ordered]@{
        ProductVersion = $ProductVersion
        FileVersion = $fileVersion
        CompanyName = $CompanyName
        FileDescription = $ProductName
        LegalCopyright = "Copyright $CompanyName"
        ProductName = $ProductName
        Comments = $Comments
      }
      '0409' = [ordered]@{
        ProductVersion = $ProductVersion
        FileVersion = $fileVersion
        CompanyName = $CompanyName
        FileDescription = $ProductName
        LegalCopyright = "Copyright $CompanyName"
        ProductName = $ProductName
        Comments = $Comments
      }
    }
  }

  $json = $versionInfo | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

$iconPath = Join-Path $projectRoot 'build\\windows\\icon.ico'
$manifestTemplatePath = Join-Path $projectRoot 'build\\windows\\wails.exe.manifest'
if (-not (Test-Path $iconPath)) {
  throw "Missing app icon: $iconPath"
}
if (-not (Test-Path $manifestTemplatePath)) {
  throw "Missing Windows manifest template: $manifestTemplatePath"
}

$baseName = [System.IO.Path]::GetFileNameWithoutExtension([string]$wailsConfig.outputfilename)
$companyName = [string]$wailsConfig.info.companyName
if ([string]::IsNullOrWhiteSpace($companyName)) {
  $companyName = $baseName
}
$productName = [string]$wailsConfig.info.productName
if ([string]::IsNullOrWhiteSpace($productName)) {
  $productName = $baseName
}
$comments = [string]$wailsConfig.info.comments
$sourceExe = Join-Path $projectRoot "build\\bin\\$baseName.exe"

# Output as claude-mind{version}.exe
$outputName = "claude-mind$version"
$versionedExe = Join-Path $projectRoot "build\\bin\\$outputName.exe"
$pendingExe = Join-Path $projectRoot "build\\bin\\$outputName.pending.exe"

$generatedInfoPath = Join-Path $projectRoot 'build\\windows\\info.generated.json'
$generatedManifestPath = Join-Path $projectRoot 'build\\windows\\wails.generated.manifest'

Write-WindowsVersionInfo -Path $generatedInfoPath -ProductVersion $version -CompanyName $companyName -ProductName $productName -Comments $comments
$manifestTemplate = Get-Content -Raw -Encoding UTF8 $manifestTemplatePath
$manifestContent = $manifestTemplate.Replace('{{.Name}}', [string]$wailsConfig.name).Replace('{{.Info.ProductVersion}}', $version)
[System.IO.File]::WriteAllText($generatedManifestPath, $manifestContent, [System.Text.UTF8Encoding]::new($false))

Push-Location $projectRoot
try {
  wails build -nopackage
  go run .\\scripts\\patch_windows_resources -exe $sourceExe -icon $iconPath -manifest $generatedManifestPath -info $generatedInfoPath
} finally {
  Pop-Location
  if (Test-Path $generatedInfoPath) {
    Remove-Item $generatedInfoPath -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $generatedManifestPath) {
    Remove-Item $generatedManifestPath -Force -ErrorAction SilentlyContinue
  }
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
    throw "Target exe is in use. Close $versionedExe and rerun. The new build was kept at $pendingExe"
  }
}

Move-Item $sourceExe $versionedExe -Force

go run .\\scripts\\check_windows_resources -exe $versionedExe -icon $iconPath

$versionInfo = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($versionedExe)
if ($versionInfo.ProductVersion -ne $version -and $versionInfo.ProductVersion -ne ($version + '.0')) {
  throw "Packaged exe ProductVersion mismatch. Expected $version, got $($versionInfo.ProductVersion)"
}

Write-Host "Packaged: $versionedExe"
