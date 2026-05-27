param(
  [string]$Target = "temu-erp",
  [string]$RemoteDir = "/opt/temu-updates/releases",
  [string]$ReleaseDir = "release",
  [int]$ChunkSizeMB = 15,
  [int]$Parallel = 4,
  [int]$MaxRetries = 6,
  [int]$ResumeThresholdMB = 2,
  [int]$ScpTimeoutSeconds = 600
)

$ErrorActionPreference = "Stop"

function Invoke-NativeChecked {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  Write-Host "[trace] -> $FilePath $($Arguments -join ' | ')" -ForegroundColor DarkGray
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
}

function Resolve-NativeCommand {
  param(
    [string]$Primary,
    [string]$Fallback
  )

  $command = Get-Command $Primary -ErrorAction SilentlyContinue
  if (!$command) {
    $command = Get-Command $Fallback -ErrorAction Stop
  }
  return $command.Source
}

function Quote-Sh {
  param([string]$Value)
  return "'" + $Value.Replace("'", "'""'""'") + "'"
}

function Get-RemoteParentDir {
  param([string]$Path)
  $normalized = $Path.TrimEnd("/")
  $index = $normalized.LastIndexOf("/")
  if ($index -le 0) {
    return "/"
  }
  return $normalized.Substring(0, $index)
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

function Split-FileIntoChunks {
  param(
    [string]$FilePath,
    [string]$ChunkDir,
    [int64]$ChunkSizeBytes
  )

  Remove-Item -LiteralPath $ChunkDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $ChunkDir | Out-Null

  $inputStream = [System.IO.File]::OpenRead($FilePath)
  try {
    $buffer = New-Object byte[] $ChunkSizeBytes
    $index = 0
    while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $partPath = Join-Path $ChunkDir ("part-{0:D2}" -f $index)
      $outputStream = [System.IO.File]::Open($partPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
      try {
        $outputStream.Write($buffer, 0, $read)
      } finally {
        $outputStream.Close()
      }
      $index++
    }
  } finally {
    $inputStream.Close()
  }

  return @(Get-ChildItem -LiteralPath $ChunkDir -File | Where-Object { $_.Name -match "^part-\d+$" } | Sort-Object Name)
}

function Get-RemoteChunkSizes {
  param(
    [string]$Target,
    [string]$RemoteChunkDir
  )

  $remoteChunkDirQuoted = Quote-Sh $RemoteChunkDir
  $raw = & ssh $Target "find $remoteChunkDirQuoted -maxdepth 1 -type f -name 'part-*' -printf '%f %s\n' 2>/dev/null || true"
  $sizes = @{}
  foreach ($line in ($raw -split "`n")) {
    if ($line -match "^(part-\d+)\s+(\d+)$") {
      $sizes[$Matches[1]] = [int64]$Matches[2]
    }
  }
  return $sizes
}

function Get-MissingChunks {
  param(
    [object[]]$Parts,
    [hashtable]$RemoteSizes
  )

  $missing = @()
  foreach ($part in $Parts) {
    $remoteSize = [int64]-1
    if ($RemoteSizes.ContainsKey($part.Name)) {
      $remoteSize = [int64]$RemoteSizes[$part.Name]
    }
    if ($remoteSize -ne [int64]$part.Length) {
      $missingBytes = [int64]$part.Length - $remoteSize
      if ($remoteSize -lt 0) {
        $missingBytes = [int64]$part.Length
      }
      $missing += [pscustomobject]@{
        Name = $part.Name
        Path = $part.FullName
        Local = [int64]$part.Length
        Remote = $remoteSize
        Missing = $missingBytes
      }
    }
  }
  return $missing
}

function Invoke-ScpChunks {
  param(
    [object[]]$Chunks,
    [string]$Target,
    [string]$RemoteChunkDir,
    [int]$Parallel,
    [int]$ScpTimeoutSeconds,
    [string]$LogDir
  )

  if (!$Chunks -or $Chunks.Count -eq 0) {
    return
  }

  $scp = Resolve-NativeCommand "scp.exe" "scp"
  for ($offset = 0; $offset -lt $Chunks.Count; $offset += $Parallel) {
    $batch = @($Chunks | Select-Object -Skip $offset -First $Parallel)
    $processes = @()
    foreach ($chunk in $batch) {
      $stamp = Get-Date -Format "yyyyMMddHHmmssfff"
      $outLog = Join-Path $LogDir "$($chunk.Name).$stamp.scp.out.log"
      $errLog = Join-Path $LogDir "$($chunk.Name).$stamp.scp.err.log"
      $remotePath = "${Target}:$RemoteChunkDir/$($chunk.Name)"
      Write-Host "[publish] scp $($chunk.Name) local=$($chunk.Local) remote=$($chunk.Remote)"
      $process = Start-Process -FilePath $scp -ArgumentList @("-p", $chunk.Path, $remotePath) `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -WindowStyle Hidden
      $processes += [pscustomobject]@{ Process = $process; Chunk = $chunk; ErrLog = $errLog }
    }

    foreach ($item in $processes) {
      $timeoutMs = [int]([Math]::Min([int64]$ScpTimeoutSeconds * 1000, [int]::MaxValue))
      if (!$item.Process.WaitForExit($timeoutMs)) {
        Write-Warning "scp timed out for $($item.Chunk.Name) after ${ScpTimeoutSeconds}s; killing and retrying later"
        Stop-Process -Id $item.Process.Id -Force -ErrorAction SilentlyContinue
        continue
      }
      $item.Process.Refresh()
      if ($null -ne $item.Process.ExitCode -and $item.Process.ExitCode -ne 0) {
        Write-Warning "scp failed for $($item.Chunk.Name) with exit code $($item.Process.ExitCode)"
        if (Test-Path -LiteralPath $item.ErrLog) {
          Get-Content -LiteralPath $item.ErrLog -Tail 8 | ForEach-Object { Write-Warning $_ }
        }
      }
    }
  }
}

function Invoke-SftpResumeChunk {
  param(
    [object]$Chunk,
    [string]$Target,
    [string]$RemoteChunkDir,
    [string]$ChunkDir
  )

  $batch = New-TemporaryFile
  try {
    $chunkSftpDir = $ChunkDir.Replace("\", "/")
    Set-Content -LiteralPath $batch -Encoding ASCII -Value @(
      "lcd $chunkSftpDir",
      "cd $RemoteChunkDir",
      "-reput -p $($Chunk.Name) $($Chunk.Name)",
      "bye"
    )
    Write-Host "[publish] sftp resume $($Chunk.Name) missing=$($Chunk.Missing)"
    Invoke-NativeChecked "sftp" @("-b", $batch.FullName, $Target)
  } finally {
    Remove-Item -LiteralPath $batch -Force -ErrorAction SilentlyContinue
  }
}

function Copy-RemoteAtomic {
  param(
    [string]$LocalPath,
    [string]$RemotePath,
    [string]$Target
  )

  $scp = Resolve-NativeCommand "scp.exe" "scp"
  $tempRemotePath = "$RemotePath.tmp-$PID"
  Invoke-NativeChecked $scp @("-p", $LocalPath, "${Target}:$tempRemotePath")
  Invoke-NativeChecked "ssh" @($Target, "set -euo pipefail; mv -f $(Quote-Sh $tempRemotePath) $(Quote-Sh $RemotePath); chmod 644 $(Quote-Sh $RemotePath)")
}

if ($ChunkSizeMB -lt 1) {
  throw "ChunkSizeMB must be >= 1"
}
if ($Parallel -lt 1) {
  throw "Parallel must be >= 1"
}
if ($MaxRetries -lt 1) {
  throw "MaxRetries must be >= 1"
}
if ($ScpTimeoutSeconds -lt 30) {
  throw "ScpTimeoutSeconds must be >= 30"
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$releasePath = Resolve-Path (Join-Path $root $ReleaseDir)
$latestPath = Join-Path $releasePath "latest.yml"

if (!(Test-Path -LiteralPath $latestPath)) {
  throw "Missing latest.yml. Run npm run dist:win first."
}

$installerName = Get-InstallerNameFromLatest $latestPath
$installerPath = Join-Path $releasePath $installerName
$blockmapPath = "$installerPath.blockmap"

if (!(Test-Path -LiteralPath $installerPath)) {
  throw "Missing installer: $installerPath"
}
$blockmapExists = Test-Path -LiteralPath $blockmapPath
if (-not $blockmapExists) {
  Write-Host "[publish] blockmap not produced (differentialPackage disabled); skipping blockmap upload"
}

$installerSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $installerPath).Hash.ToLowerInvariant()
$shaPrefix = $installerSha256.Substring(0, 12)
$safeInstallerKey = ($installerName -replace "[^A-Za-z0-9._-]", "_")
$remoteChunkDir = "$RemoteDir/.upload-$safeInstallerKey-$shaPrefix-chunks"
$localChunkDir = Join-Path $releasePath ".upload-chunks-$safeInstallerKey-$shaPrefix"
$chunkSizeBytes = [int64]$ChunkSizeMB * 1MB
$resumeThresholdBytes = [int64]$ResumeThresholdMB * 1MB

Write-Host "[publish] target: ${Target}:$RemoteDir"
Write-Host "[publish] latest: $latestPath"
Write-Host "[publish] installer: $installerPath"
Write-Host "[publish] blockmap: $blockmapPath"
Write-Host "[publish] sha256: $installerSha256"
Write-Host "[publish] chunk size: ${ChunkSizeMB}MB, parallel: $Parallel"

$remoteParentDir = Get-RemoteParentDir $RemoteDir
$prepareCommand = "set -euo pipefail; sudo mkdir -p $(Quote-Sh $RemoteDir); sudo chown -R `$(id -un):`$(id -gn) $(Quote-Sh $remoteParentDir); chmod 755 $(Quote-Sh $remoteParentDir) $(Quote-Sh $RemoteDir); mkdir -p $(Quote-Sh $remoteChunkDir)"
Invoke-NativeChecked "ssh" @($Target, $prepareCommand)

$parts = @(Split-FileIntoChunks -FilePath $installerPath -ChunkDir $localChunkDir -ChunkSizeBytes $chunkSizeBytes)
Write-Host "[publish] chunks: $($parts.Count)"

for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
  $remoteSizes = Get-RemoteChunkSizes -Target $Target -RemoteChunkDir $remoteChunkDir
  $missing = @(Get-MissingChunks -Parts $parts -RemoteSizes $remoteSizes)
  if ($missing.Count -eq 0) {
    break
  }

  $missingBytes = ($missing | Measure-Object -Property Missing -Sum).Sum
  Write-Host "[publish] upload pass $attempt/$MaxRetries, missing chunks=$($missing.Count), missing bytes=$missingBytes"

  $smallPartial = @($missing | Where-Object { $_.Remote -gt 0 -and $_.Remote -lt $_.Local -and $_.Missing -gt 0 -and $_.Missing -le $resumeThresholdBytes })
  foreach ($chunk in $smallPartial) {
    Invoke-SftpResumeChunk -Chunk $chunk -Target $Target -RemoteChunkDir $remoteChunkDir -ChunkDir $localChunkDir
  }

  $remoteSizes = Get-RemoteChunkSizes -Target $Target -RemoteChunkDir $remoteChunkDir
  $missing = @(Get-MissingChunks -Parts $parts -RemoteSizes $remoteSizes)
  $needsScp = @($missing | Where-Object { $_.Remote -lt 0 -or $_.Remote -gt $_.Local -or $_.Missing -gt $resumeThresholdBytes })
  Invoke-ScpChunks -Chunks $needsScp -Target $Target -RemoteChunkDir $remoteChunkDir -Parallel $Parallel -ScpTimeoutSeconds $ScpTimeoutSeconds -LogDir $localChunkDir
}

$remoteSizes = Get-RemoteChunkSizes -Target $Target -RemoteChunkDir $remoteChunkDir
$missing = @(Get-MissingChunks -Parts $parts -RemoteSizes $remoteSizes)
foreach ($chunk in @($missing | Where-Object { $_.Remote -gt 0 -and $_.Remote -lt $_.Local })) {
  Invoke-SftpResumeChunk -Chunk $chunk -Target $Target -RemoteChunkDir $remoteChunkDir -ChunkDir $localChunkDir
}

$remoteSizes = Get-RemoteChunkSizes -Target $Target -RemoteChunkDir $remoteChunkDir
$missing = @(Get-MissingChunks -Parts $parts -RemoteSizes $remoteSizes)
if ($missing.Count -ne 0) {
  $missing | Format-Table -AutoSize
  throw "Upload did not converge after $MaxRetries retries."
}

$partArguments = ($parts | Sort-Object Name | ForEach-Object { Quote-Sh "$remoteChunkDir/$($_.Name)" }) -join " "
$remoteInstallerPath = "$RemoteDir/$installerName"
$remoteTempInstallerPath = "$remoteInstallerPath.tmp-$shaPrefix"
$concatCommand = @'
set -euo pipefail
cat __PARTS__ > __TMP__
actual=$(sha256sum __TMP__ | cut -d' ' -f1)
echo "[publish] remote sha256: $actual"
if [ "$actual" != "__SHA__" ]; then
  echo "sha mismatch expected __SHA__" >&2
  exit 1
fi
mv -f __TMP__ __FINAL__
chmod 644 __FINAL__
'@
$concatCommand = $concatCommand.Replace("__PARTS__", $partArguments)
$concatCommand = $concatCommand.Replace("__TMP__", (Quote-Sh $remoteTempInstallerPath))
$concatCommand = $concatCommand.Replace("__FINAL__", (Quote-Sh $remoteInstallerPath))
$concatCommand = $concatCommand.Replace("__SHA__", $installerSha256)
# 折成单行：Windows OpenSSH 把含真换行的 argv 传到远端时，远端 bash 会把换行
# 拼进 set 的参数里（报错 "set: pipefail<换行>: invalid option name"）。
# 其他单行 ssh 调用没踩这个坑，单独这条 concatCommand 用 here-string 多行才出问题。
# 用 "; " 串成单行，set -e 仍然让任一命令失败时整体非 0 退出，语义不变。
# 注意 then/else/do 后面的换行只能换成空格，bash 不允许 `then;` 直接接命令。
$concatCommand = $concatCommand `
  -replace "(then|else|do)`r?`n\s*", '$1 ' `
  -replace "`r?`n\s*", "; "
$concatCommand = $concatCommand.Trim("; ".ToCharArray())
Invoke-NativeChecked "ssh" @($Target, $concatCommand)

if ($blockmapExists) {
  Copy-RemoteAtomic -LocalPath $blockmapPath -RemotePath "$RemoteDir/$installerName.blockmap" -Target $Target
}
Copy-RemoteAtomic -LocalPath $latestPath -RemotePath "$RemoteDir/latest.yml" -Target $Target

$verifyTargets = @($(Quote-Sh "$RemoteDir/latest.yml"), $(Quote-Sh $remoteInstallerPath))
if ($blockmapExists) {
  $verifyTargets += $(Quote-Sh "$RemoteDir/$installerName.blockmap")
}
$verifyTargetsJoined = $verifyTargets -join " "
$verifyCommand = "set -euo pipefail; actual=`$(sha256sum $(Quote-Sh $remoteInstallerPath) | cut -d' ' -f1); test ""`$actual"" = '$installerSha256'; chmod 644 $verifyTargetsJoined; ls -lh $verifyTargetsJoined; head -5 $(Quote-Sh "$RemoteDir/latest.yml")"
Invoke-NativeChecked "ssh" @($Target, $verifyCommand)

Invoke-NativeChecked "ssh" @($Target, "rm -rf $(Quote-Sh $remoteChunkDir)")
Remove-Item -LiteralPath $localChunkDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "[publish] done: https://erp.temu.chat/releases/latest.yml"
