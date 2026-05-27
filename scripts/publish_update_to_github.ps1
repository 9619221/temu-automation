param(
  [string]$Repo = "9619221/temu-automation",
  [string]$ReleaseDir = "release",
  [string]$ReleaseBody = "Desktop auto-update release. Primary update feed: https://erp.temu.chat/releases/"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Invoke-GitHubJson {
  param(
    [string]$Method,
    [string]$Uri,
    [hashtable]$Headers,
    [object]$Body = $null
  )

  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers
  }

  $json = $Body | ConvertTo-Json -Depth 8
  return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers -ContentType "application/json" -Body $json
}

function Get-InstallerNameFromLatest {
  param([string]$LatestPath)

  foreach ($line in Get-Content -LiteralPath $LatestPath) {
    if ($line -match "^path:\s*(.+)$") {
      return $Matches[1].Trim()
    }
  }
  throw "Cannot find installer path in latest.yml."
}

function Get-VersionFromLatest {
  param([string]$LatestPath)

  foreach ($line in Get-Content -LiteralPath $LatestPath) {
    if ($line -match "^version:\s*(.+)$") {
      return $Matches[1].Trim()
    }
  }
  throw "Cannot find version in latest.yml."
}

function Get-GitHubToken {
  $credentialInput = "protocol=https`nhost=github.com`n`n"
  $credential = $credentialInput | git credential fill 2>$null
  $tokenLine = $credential | Where-Object { $_ -like "password=*" } | Select-Object -First 1
  if (!$tokenLine) {
    throw "No GitHub token found in git credential manager."
  }
  return $tokenLine.Substring("password=".Length)
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$releasePath = Resolve-Path (Join-Path $root $ReleaseDir)
$latestPath = Join-Path $releasePath "latest.yml"

if (!(Test-Path -LiteralPath $latestPath)) {
  throw "Missing latest.yml. Run npm run dist:win first."
}

$version = Get-VersionFromLatest $latestPath
$tag = "v$version"
$installerName = Get-InstallerNameFromLatest $latestPath
$installerPath = Join-Path $releasePath $installerName
$blockmapPath = "$installerPath.blockmap"

if (!(Test-Path -LiteralPath $installerPath)) {
  throw "Missing installer: $installerPath"
}
$blockmapExists = Test-Path -LiteralPath $blockmapPath
if (-not $blockmapExists) {
  Write-Host "[github] blockmap not produced (differentialPackage disabled); skipping blockmap upload"
}

$assets = @(
  @{ Name = "latest.yml"; Path = $latestPath; ContentType = "text/yaml" }
)
if ($blockmapExists) {
  $assets += @{ Name = "$installerName.blockmap"; Path = $blockmapPath; ContentType = "application/octet-stream" }
}
$assets += @{ Name = $installerName; Path = $installerPath; ContentType = "application/octet-stream" }

$token = Get-GitHubToken
$headers = @{
  Authorization = "Bearer $token"
  Accept = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent" = "temu-automation-release-publisher"
}

Write-Host "[github] repo: $Repo"
Write-Host "[github] tag: $tag"

$release = $null
try {
  $release = Invoke-GitHubJson -Method GET -Uri "https://api.github.com/repos/$Repo/releases/tags/$tag" -Headers $headers
  Write-Host "[github] release exists: $($release.html_url)"
} catch {
  $statusCode = $null
  if ($_.Exception.Response) {
    $statusCode = $_.Exception.Response.StatusCode.value__
  }
  if ($statusCode -ne 404) {
    throw
  }

  $release = Invoke-GitHubJson -Method POST -Uri "https://api.github.com/repos/$Repo/releases" -Headers $headers -Body @{
    tag_name = $tag
    name = $tag
    body = $ReleaseBody
    draft = $false
    prerelease = $false
  }
  Write-Host "[github] release created: $($release.html_url)"
}

$uploadBase = $release.upload_url
if ($uploadBase.Contains("{")) {
  $uploadBase = $uploadBase.Substring(0, $uploadBase.IndexOf("{"))
}

foreach ($asset in $assets) {
  $release = Invoke-GitHubJson -Method GET -Uri "https://api.github.com/repos/$Repo/releases/tags/$tag" -Headers $headers
  $existingAssets = @($release.assets | Where-Object { $_.name -eq $asset.Name })
  foreach ($existingAsset in $existingAssets) {
    Invoke-GitHubJson -Method DELETE -Uri "https://api.github.com/repos/$Repo/releases/assets/$($existingAsset.id)" -Headers $headers | Out-Null
    Write-Host "[github] deleted existing asset: $($existingAsset.name)"
  }

  $encodedName = [uri]::EscapeDataString($asset.Name)
  $size = (Get-Item -LiteralPath $asset.Path).Length
  Write-Host "[github] uploading $($asset.Name) bytes=$size"
  $uploaded = Invoke-RestMethod -Method POST -Uri ($uploadBase + "?name=" + $encodedName) -Headers $headers -ContentType $asset.ContentType -InFile $asset.Path
  Write-Host "[github] uploaded $($uploaded.name)"
}

$final = Invoke-GitHubJson -Method GET -Uri "https://api.github.com/repos/$Repo/releases/tags/$tag" -Headers $headers
Write-Host "[github] done: $($final.html_url)"
