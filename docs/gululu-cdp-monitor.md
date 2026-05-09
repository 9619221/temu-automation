# 咕噜噜 CDP 接口监听

脚本位置：

```text
scripts/gululu-cdp-monitor.cjs
```

用途：通过 Chrome DevTools Protocol 监听咕噜噜运行时实际请求的接口。相比普通 Chrome 扩展监听器，这个脚本可以尝试读取响应体。

## 前提

Chrome 必须用 `--remote-debugging-port` 启动。已经打开的普通 Chrome 不能被脚本强行接入。

建议先关闭当前普通 Chrome，再用命令启动一个带调试端口的 Chrome：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:LOCALAPPDATA\Google\Chrome\User Data" `
  --profile-directory="Default"
```

如果不想影响当前 Chrome，也可以用独立测试资料目录，但需要重新加载/登录咕噜噜和 Temu：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:TEMP\gululu-cdp-profile"
```

## 监听

列出当前可监听页面/扩展目标：

```powershell
node scripts\gululu-cdp-monitor.cjs --port=9222 --list
```

持续监听：

```powershell
node scripts\gululu-cdp-monitor.cjs --port=9222
```

监听 120 秒：

```powershell
node scripts\gululu-cdp-monitor.cjs --port=9222 --duration=120
```

只保留能匹配到咕噜噜扩展 ID 的请求：

```powershell
node scripts\gululu-cdp-monitor.cjs --port=9222 --only-gululu
```

如果自动识别扩展 ID 失败，可以从 `chrome://extensions` 复制咕噜噜 ID：

```powershell
node scripts\gululu-cdp-monitor.cjs --port=9222 --extension-id=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx --only-gululu
```

## 输出

默认输出目录：

```text
logs/gululu-cdp-monitor
```

每次运行生成两个文件：

- `gululu-cdp-events-*.jsonl`：逐条接口记录，一行一个 JSON。
- `gululu-cdp-summary-*.json`：汇总统计。

每条记录包含：

- `target`：页面或扩展 service worker 信息。
- `gululuMatched`：是否匹配到咕噜噜扩展来源。
- `method`, `url`, `host`, `path`, `query`
- `initiator`：发起来源和调用栈 URL。
- `request.headers`, `request.postData`
- `response.status`, `response.headers`, `response.body`
- `error`

敏感头会被过滤：

- `cookie`
- `authorization`
- `proxy-authorization`
- `x-csrf-token`
- `x-xsrf-token`
- `set-cookie`

## 注意

- CDP 能否读取响应体取决于 Chrome 缓冲区和请求类型。脚本会调用 `Network.getResponseBody`，失败时写入 `response.bodyError`。
- 如果咕噜噜已经开着，但脚本没有记录，先用 `--list` 看是否能看到 `chrome-extension://...` 或 Temu 后台 target。
- 如果只看到云启数据等其它页面，说明当前监听的端口不是装了咕噜噜的 Chrome。

