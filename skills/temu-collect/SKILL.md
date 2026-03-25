---
name: temu-collect
description: >
  一键采集 Temu 卖家后台全部数据（62个数据源）。
  触发词：采集数据、同步Temu、抓取数据、更新店铺、拉取最新数据、collect temu、scrape temu、一键采集。
  支持全量采集和单独采集指定数据源。Agent 自主执行，无需人工干预。
user-invocable: true
metadata: {"openclaw.requires.bins": ["node", "curl"]}
---

# Temu 数据采集

自动采集 Temu 卖家后台 62 个数据源，包括商品、订单、流量、销售、质量、合规等。

## 执行流程

### 1. 检查 Worker 是否在线

```bash
curl -s -X POST http://localhost:19280 \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"ping\"}" \
  --connect-timeout 3
```

- 有响应 → Worker 在线，跳到步骤 2
- 连接失败 → 启动 Worker：

```bash
cd "<PROJECT_ROOT>" && node automation/worker.mjs &
sleep 5
```

`<PROJECT_ROOT>` 是 `temu-automation` 项目的绝对路径。

### 2. 执行采集

**全量采集**（62个数据源，耗时10-15分钟）：

```bash
curl -s -X POST http://localhost:19280 \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"scrape_all\"}" \
  --max-time 1800
```

此命令耗时较长，建议后台运行。

**单独采集**某个数据源：

```bash
curl -s -X POST http://localhost:19280 \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"scrape_<KEY>\"}" \
  --max-time 300
```

### 3. 解析返回结果

```json
{
  "action": "result",
  "data": {
    "results": { "dashboard": {"success": true, "duration": 12000} },
    "totalDuration": 590000,
    "successCount": 60,
    "failCount": 2
  }
}
```

向用户汇报：成功/失败数量、总耗时、失败任务列表。

### 4. 关闭浏览器

采集完成后浏览器自动关闭。如需手动关闭：

```bash
curl -s -X POST http://localhost:19280 \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"close_browser\"}"
```

## 可用采集 Key

| 用户说 | action | 说明 |
|--------|--------|------|
| 采集全部 | `scrape_all` | 62个数据源 |
| 采集商品 | `scrape_products` | 商品列表 |
| 采集订单 | `scrape_orders` | 订单/备货单 |
| 采集流量 | `scrape_flux` | 流量分析 |
| 采集仪表盘 | `scrape_dashboard` | 店铺概览 |
| 采集销售 | `scrape_sales` | 销售数据 |

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
| 合规中心 | 16 | governDashboard 等 |
| 广告推广 | 6 | adsHome, adsProduct, adsReport, adsFinance, adsHelp, adsNotification |

## 数据存储

采集数据保存为 JSON 文件：
- 路径：`<APP_DATA>/temu-automation/temu_*.json`
- Windows: `%APPDATA%/temu-automation/`
- 每个数据源对应一个 `temu_<name>.json` 和 `temu_raw_<name>.json`

## 故障排除

| 问题 | 解决 |
|------|------|
| Worker 无法启动 | 检查端口 19280：`netstat -ano \| grep 19280` |
| 采集超时 | Temu 需重新登录，手动登录后重试 |
| 部分失败 | 正常，某些页面临时不可用，重试即可 |
