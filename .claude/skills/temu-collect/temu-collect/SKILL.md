---
name: temu-collect
description: >
  一键采集 Temu 卖家后台全部数据（62个数据源）。当用户说"采集数据"、"同步Temu"、"抓取Temu数据"、
  "更新店铺数据"、"拉取最新数据"、"collect temu data"、"scrape temu"、"一键采集" 时触发。
  这是一个可执行的自动化 skill，Agent 会自主完成全部采集流程。
---

# Temu 数据采集 Agent Skill

收到指令后，按以下步骤自主执行，无需用户额外确认。

## 步骤 1：检查 Worker

使用 `scripts/worker-call.mjs` 脚本（解决 Windows curl 引号问题）：

```bash
node C:/Users/Administrator/.claude/skills/temu-collect/scripts/worker-call.mjs ping
```

- 如果返回 `{"status":"pong"}` → Worker 在线，跳到步骤 2
- 如果报 "Worker 连接失败" → 执行步骤 1b

### 步骤 1b：启动 Worker

```bash
cd "C:/Users/Administrator/temu-automation" && node automation/worker.mjs &
```

等待 5 秒后重新检查连接，最多重试 6 次（30秒）。

## 步骤 2：执行全量采集

运行以下命令（后台执行，超时30分钟）：

```bash
node C:/Users/Administrator/.claude/skills/temu-collect/scripts/worker-call.mjs scrape_all
```

这会：
- 打开 Chrome 浏览器（使用已保存的登录态）
- 并发采集 62 个数据源（3个并发）
- 自动处理 Temu 授权弹窗
- 完成后自动关闭浏览器

**重要**：此命令耗时 10-15 分钟，必须使用 `run_in_background: true` 运行。

## 步骤 3：解析结果

命令返回 JSON 格式：

```json
{
  "action": "result",
  "data": {
    "results": { "dashboard": {"success":true,"duration":12}, ... },
    "totalDuration": 590000,
    "successCount": 60,
    "failCount": 2
  }
}
```

向用户汇报：
- 总采集数
- 成功/失败数量
- 总耗时
- 失败的任务列表（如有）

## 步骤 4：保存到前端 Store

采集完成后，通知用户在 Electron 应用中点击"仅同步仪表盘"或重新打开应用即可看到最新数据。

数据存储位置：`C:/Users/Administrator/AppData/Roaming/temu-automation/`

## 单独采集某个数据源

如果用户只要采集特定数据，替换 action 即可：

| 用户说 | type 值 |
|--------|---------|
| 采集商品 | `scrape_products` |
| 采集订单 | `scrape_orders` |
| 采集流量 | `scrape_flux` |
| 采集仪表盘 | `scrape_dashboard` |
| 采集销售 | `scrape_sales` |

```bash
curl -s -X POST http://localhost:19280 -H "Content-Type: application/json" -d '{"action":"scrape_products"}' --max-time 300
```

## 62个数据源分类

| 分类 | 数量 | Keys |
|------|------|------|
| 核心数据 | 5 | dashboard, products, orders, sales, flux |
| 商品数据 | 4 | goodsData, lifecycle, imageTask, sampleManage |
| 销售管理 | 6 | activity, activityLog, activityUS, activityEU, chanceGoods, marketingActivity |
| 订单物流 | 4 | urgentOrders, shippingDesk, shippingList, addressManage |
| 退货管理 | 5 | returnOrders, returnDetail, salesReturn, returnReceipt, exceptionNotice |
| 售后质量 | 5 | afterSales, checkup, qualityDashboard, qualityDashboardEU, qcDetail |
| 价格管理 | 4 | priceReport, priceCompete, flowPrice, retailPrice |
| 流量分析 | 7 | mallFlux, mallFluxEU, mallFluxUS, fluxEU, fluxUS, flowGrow, usRetrieval |
| 合规中心 | 16 | governDashboard 等 16 个 |
| 广告推广 | 6 | adsHome, adsProduct, adsReport, adsFinance, adsHelp, adsNotification |

## 故障排除

| 问题 | 解决 |
|------|------|
| Worker 无法启动 | 检查端口 19280 是否被占用：`netstat -ano \| grep 19280` |
| 采集超时 | Temu 可能需要重新登录，手动打开浏览器登录后重试 |
| 部分失败 | 正常现象，某些页面可能临时不可用，重试即可 |
| 浏览器未关闭 | `curl -s -X POST http://localhost:19280 -H "Content-Type: application/json" -d '{"action":"close_browser"}'` |
