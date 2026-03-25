---
name: temu-collect
description: >
  一键采集 Temu 卖家后台全部数据（62个数据源）。当用户说"采集数据"、"同步Temu"、"抓取Temu数据"、
  "更新店铺数据"、"拉取最新数据"、"collect temu data"、"scrape temu" 时触发。
  也适用于用户提到"temu采集"、"数据同步"、"一键采集"等场景。
---

# Temu 数据采集 Skill

自动化采集 Temu 卖家后台（agentseller.temu.com）和商家中心（seller.kuajingmaihuo.com）的全部运营数据。

## 工作流程

### 1. 检查 Worker 状态

Worker 是运行在 `localhost:19280` 的 HTTP 服务，负责控制 Puppeteer 浏览器。

```bash
# 检查 worker 是否在运行
curl -s -X POST http://localhost:19280 -d '{"type":"ping"}' --connect-timeout 3
```

如果无法连接，启动 worker：

```bash
cd C:/Users/Administrator/temu-automation && node automation/worker.mjs &
```

等待 worker 就绪（出现 `WORKER_PORT=19280`）。

### 2. 执行全量采集

向 worker 发送 `scrape_all` 命令：

```bash
curl -s -X POST http://localhost:19280 \
  -H "Content-Type: application/json" \
  -d '{"type":"scrape_all"}' \
  --max-time 1800
```

这将：
- 启动 Chrome 浏览器（使用已登录的 session）
- 并发采集 62 个数据源（concurrency=3）
- 自动处理登录弹窗和验证
- 数据保存到 `%APPDATA%/temu-automation/debug/scrape_all_*.json`
- 采集完成后自动关闭浏览器

### 3. 保存到 Store

采集完成后，调用各解析器将原始数据转换为结构化格式：

```bash
# 读取指定任务的采集结果
curl -s -X POST http://localhost:19280 \
  -H "Content-Type: application/json" \
  -d '{"type":"read_scrape_data","key":"dashboard"}'
```

数据保存在：`C:/Users/Administrator/AppData/Roaming/temu-automation/`

### 4. 数据源清单（62个）

#### 核心数据（5个）
| Key | 说明 | 来源 |
|-----|------|------|
| dashboard | 仪表盘概览 | agentseller.temu.com |
| products | 商品列表 | agentseller.temu.com |
| orders | 备货单 | agentseller.temu.com |
| sales | 销售数据 | agentseller.temu.com |
| flux | 流量分析 | agentseller.temu.com |

#### 商品数据（4个）
| Key | 说明 |
|-----|------|
| goodsData | 商品数据中心 |
| lifecycle | 上新生命周期 |
| imageTask | 商品图片任务 |
| sampleManage | 样品管理 |

#### 销售管理（6个）
| Key | 说明 |
|-----|------|
| activity | 活动数据 |
| activityLog | 活动日志 |
| activityUS | 美国活动 |
| activityEU | 欧盟活动 |
| chanceGoods | 机会商品 |
| marketingActivity | 营销活动 |

#### 订单物流（4个）
| Key | 说明 |
|-----|------|
| urgentOrders | 紧急备货 |
| shippingDesk | 发货台 |
| shippingList | 发货单列表 |
| addressManage | 发退货地址 |

#### 退货管理（5个）
| Key | 说明 |
|-----|------|
| returnOrders | 退货订单 |
| returnDetail | 退货详情 |
| salesReturn | 销售退货 |
| returnReceipt | 收货入库 |
| exceptionNotice | 异常通知 |

#### 售后质量（5个）
| Key | 说明 |
|-----|------|
| afterSales | 售后数据 |
| checkup | 体检中心 |
| qualityDashboard | 质量看板 |
| qualityDashboardEU | 质量看板(欧盟) |
| qcDetail | 抽检结果明细 |

#### 价格管理（4个）
| Key | 说明 |
|-----|------|
| priceReport | 价格申报 |
| priceCompete | 价格竞争 |
| flowPrice | 高价限流 |
| retailPrice | 建议零售价 |

#### 流量分析（7个）
| Key | 说明 |
|-----|------|
| mallFlux | 店铺流量(全球) |
| mallFluxEU | 店铺流量(欧盟) |
| mallFluxUS | 店铺流量(美国) |
| fluxEU | 商品流量(欧盟) |
| fluxUS | 商品流量(美国) |
| flowGrow | 流量增长 |
| usRetrieval | 美国找回 |

#### 合规中心（16个）
governDashboard, governProductQualification, governQualificationAppeal,
governProductPhoto, governComplianceInfo, governResponsiblePerson,
governManufacturer, governComplaint, governViolationAppeal,
governMerchantAppeal, governTro, governEprQualification,
governEprBilling, governComplianceReference, governCustomsAttribute,
governCategoryCorrection

#### 广告推广（6个）
adsHome, adsProduct, adsReport, adsFinance, adsHelp, adsNotification

## 返回值

`scrape_all` 返回格式：

```json
{
  "results": {
    "dashboard": { "success": true, "duration": 12.3 },
    "products": { "success": true, "duration": 8.7 },
    ...
  },
  "totalDuration": 590,
  "successCount": 60,
  "failCount": 2
}
```

## 采集单个数据源

如果只需要采集特定数据：

```bash
curl -s -X POST http://localhost:19280 \
  -H "Content-Type: application/json" \
  -d '{"type":"scrape_products"}'
```

支持的单独采集命令：scrape_products, scrape_orders, scrape_flux, scrape_dashboard, scrape_sales 等。

## 注意事项

- 首次采集需要在浏览器中手动登录 Temu 卖家后台
- 全量采集约需 10-15 分钟
- 采集过程中会自动处理 Temu 的授权弹窗
- 采集使用 `--user-data-dir` 保持登录状态，无需重复登录
- Worker 默认端口 19280，可通过 `WORKER_PORT` 环境变量修改
