param(
  [string]$Version = "latest"
)
$ErrorActionPreference = "Stop"
$repo = "zhravan/dbux"
$api = if ($Version -eq "latest") { "https://api.github.com/repos/$repo/releases/latest" } else { "https://api.github.com/repos/$repo/releases/tags/$Version" }
try {
  $release = Invoke-RestMethod -Uri $api -Headers @{ "User-Agent" = "DBUX-installer" }
} catch {
  throw "Could not fetch DBUX release '$Version'. Check https://github.com/$repo/releases"
}
$asset = $release.assets | Where-Object { $_.name -match '\.(msi|exe)$' } | Select-Object -First 1
if (-not $asset) { throw "No Windows installer found in this release. See https://github.com/$repo/releases/latest" }
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("dbux-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  $installer = Join-Path $temp $asset.name
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installer
  if ($asset.name.EndsWith(".msi", [StringComparison]::OrdinalIgnoreCase)) {
    $process = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/i", $installer, "/passive") -Wait -PassThru
  } else {
    $process = Start-Process -FilePath $installer -ArgumentList @("/S") -Wait -PassThru
  }
  if ($process.ExitCode -ne 0) { throw "Installer exited with code $($process.ExitCode)." }
  Write-Host "DBUX installed. Launch it from the Start menu."
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
