# Temu 多店监控扩展（M1 骨架）

一个 Chrome MV3 扩展，挂在运营自己浏览器里抓取 Temu 卖家后台业务接口，批量上报到自家云端做多店统一汇总。设计依据是对「咕噜噜」扩展的完整逆向（见 `C:\tmp\gululu-deob\` 下的解码产物）。

## 关键设计

| 维度 | 选择 | 理由 |
|---|---|---|
| 架构 | content script (loader) + page world hook + service worker | 反爬签名层（anti-content / Mallid）只有在 page world 借 Temu 自家 axios 包装层时才能拿到 |
| 注入方式 | `chrome.runtime.getURL` + `<script src>` 注入 hook.js（`web_accessible_resources`） | 与「内联 inline」相比避开 CSP 报告；与 SW `executeScript` 相比能 document_start 立即生效 |
| 跨 world 通信 | `window.dispatchEvent(new CustomEvent('temu-monitor.captured', {detail}))` | 比 `postMessage` 干净，不会与页面自有消息总线混 |
| bypass 机制 | `Symbol.for('temu-monitor.fetch.bypass')` 挂在 `init` 上 / XHR 用同名 header（不发出去） | 扩展自家请求不会被自己 hook 一遍导致死循环 |
| 反 hook 卸载 | `Object.defineProperty` + `setInterval(ensureInstalled, 2s)` | Temu 反爬如果把 `window.fetch` 改回原生，2 秒内自动接管回来 |
| 持久化 | IndexedDB 队列 + `chrome.alarms` 30s flush | MV3 SW 会被回收，setInterval 不可靠 |
| 失败重试 | 网络错误 / 5xx 退避 + max 6 次；4xx 直接丢弃 | 4xx 多半是服务端拒绝，重试无意义 |
| Origin/Referer | `declarative_net_request` 在 `rules.json` 重写 | 让从扩展上下文借 fetch 调跨子域时不被 CORS 卡 |

## 文件结构

```
extension/
  manifest.json                   ← MV3 配置
  rules.json                      ← DNR：Origin/Referer 重写
  web/
    background/
      sw.js                       ← service worker 入口
      hook-config.js              ← 218 个 endpoint 白名单 + 黑名单 + 共享常量
      ingest-queue.js             ← IndexedDB 上报队列 + 退避重试
    content/
      bridge.js                   ← isolated world，注入 hook + 转发 CustomEvent
    page/
      hook.js                     ← page world hook（fetch / XHR 拦截）
    popup/
      popup.html, popup.js        ← 扩展图标弹窗：状态、立即上报
    options/
      options.html, options.js    ← 设置页：云端 URL、Token
  README.md                       ← 本文件
```

## 安装与调试（开发模式）

1. 打开 `chrome://extensions/`
2. 右上角开「开发者模式」
3. 「加载已解压的扩展程序」→ 选这个 `extension/` 目录
4. 进入 `chrome://extensions/?id=<这个扩展id>` 详情页 → 点「Service Worker」打开 SW DevTools 看日志
5. 任意打开一个 Temu 卖家后台页面（已登录），扩展会立即开始拦截

## 配置云端

- 点扩展图标 → 「打开设置」
- 填入云端 URL 和 JWT
- 「测试连通性」会请求 `{URL}/api/ingest/v1/health`
- 队列每 30s 自动批量上报到 `{URL}/api/ingest/v1/batch`，body 形如：
  ```json
  {
    "items": [
      { "ts": 1778..., "kind": "xhr", "url": "/api/seller/...", "method": "POST",
        "status": 200, "site": "agentseller", "page": "/goods/list",
        "body": { ... }, "tab_id": 123 }
    ]
  }
  ```

## 验证清单

- [ ] popup 显示「已抓接口数」随你点 Temu 后台菜单递增
- [ ] popup 显示「待上报」非 0，30s 后变 0（云端能收到）
- [ ] SW DevTools 控制台无 `Uncaught` 错误
- [ ] 在 Temu 页面控制台执行 `window.__temuMonitor.healthy()` 返回 `true`
- [ ] 主动调一个白名单 endpoint 时，hook 加 `init[Symbol.for('temu-monitor.fetch.bypass')]=true` 不会触发自己上报

## 当前阶段（M1）的边界

**已实现：**

- 218 个 endpoint 白名单 + 16 个反爬路径黑名单
- 双层拦截（fetch + XHR）+ guardTimer 自愈
- 离线队列 + 退避重试 + 4xx/5xx 区分
- popup / options 基础 UI

**M2 计划：**

- [ ] 远端 hook 脚本：把 `web/page/hook.js` 改成「content script 拉远端 URL → Blob → script src 注入」，让白名单和拦截规则可热更（仿咕噜噜的 `https://ttf.gululu.store/injectHOK.js`）
- [ ] `bridge.js` 中的占位白名单要么用构建脚本与 `hook-config.js` 同步，要么用 SW 启动时通过 `chrome.scripting.registerContentScripts` 动态注册
- [ ] 拉取 Temu `userInfo` 响应解出 `mallId` / `mallName`，让上报数据自带店铺归属
- [ ] 支持主动调 API（用 bypass symbol）：例如分页拉商品全量，而非依赖运营点击

**M3 计划：**

- [ ] 云端任务下发：`{URL}/api/sync/cursor` 让扩展知道「店铺 X 当前缺什么数据」
- [ ] WebSocket / Server-Sent Events 实时下行
- [ ] options 页能从云端拉白名单覆盖本地

**M4 计划：**

- [ ] 与现有 Electron 桌面端打通：UI 改读云端，本地 JSON store 退役
- [ ] 删除 `automation/worker.mjs` 中 Temu 采集分支（保留 1688 / ImageStudio / 价格巡检）

## 与咕噜噜的关键差异

| 维度 | 咕噜噜 | 本扩展 |
|---|---|---|
| 数据汇总 | 无（只 12 条白名单 URL，纯本地导出） | 218 条白名单，全部上云 |
| 上传云端 | 无（gululu.store 仅 CDN） | 自家云端 + JWT |
| 多店统一 | 无 | 有（device_id + mallId） |
| 远端 hook 脚本 | 有（`ttf.gululu.store/injectHOK.js`） | M1 内置，M2 改远端 |
| 反 hook 卸载 | guardTimer + ensureInstalled | 同款 |
| bypass key | `Symbol.for('gululu.fetch.bypass')` | `Symbol.for('temu-monitor.fetch.bypass')` |
| 完整性自检 | hash + name 强校验 | 暂无（自用扩展不防盗用） |
| 运行模式 | 用户点击触发 | 后台自动 + 周期上报 |

## 安全 / 合规

- 不收集 cookie 内容，不上传 `Authorization` 头明文
- 黑名单已剔除 phantom / pftk / thtk / titan token 等反爬埋点路径
- 上报 body > 1MB 自动截断
- 队列存在本机 IndexedDB，不离线读 cookie / 密码 / 自动填充
- 云端 URL 必须是 HTTPS

## 已知限制

- M1 阶段 `bridge.js` 中的白名单是占位空数组（避免 sync/async 时序问题），SW 回包后才热更新到 page world。**这意味着扩展首次注入到一个 tab 后的前 ~200ms 拦截可能失效**。可以在用户首次安装后让浏览器 reload 一下当前 Temu tab 解决。M2 会改成构建期同步生成 `bridge.js`。
- DNR Origin 重写当前只对同源请求开。如果你的扩展从 SW 直接 fetch Temu，要在 `rules.json` 增加 `initiatorDomains: ["{扩展ID}"]` 类型的规则。

## 开发约定

- 注释、文档、commit message 全部简体中文（依 `CLAUDE.md`）
- 代码风格：纯 ES Modules，不引入打包工具，Chrome 直接吃
- 修改白名单：编辑 `web/background/hook-config.js`，无需 reload 扩展即可在下次 SW 唤醒时生效
