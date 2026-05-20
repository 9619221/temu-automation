# 探针:找聚协云内置 chrome(chrome-win)进程,打印命令行 + 任何调试端口 + 监听端口
$procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'droplet-client|chrome-win|PythonEnv' }
if (-not $procs) { "NO_JUXIEYUN_CHROME (robot2 浏览器未启动或已退出)"; exit 0 }
foreach ($p in $procs) {
  "=== PID $($p.ProcessId) ==="
  $cl = $p.CommandLine
  "CMDLINE: " + ($cl.Substring(0, [Math]::Min(900, $cl.Length)))
  $port = [regex]::Match($cl, 'remote-debugging-port=(\d+)')
  if ($port.Success) { "DEBUG_PORT_FOUND=" + $port.Groups[1].Value }
  else { "NO --remote-debugging-port in cmdline" }
}
"--- chrome 进程监听的本地端口 ---"
$pids = ($procs | ForEach-Object { $_.ProcessId })
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $pids -contains $_.OwningProcess } |
  Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String
