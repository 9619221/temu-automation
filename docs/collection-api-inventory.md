# 采集接口盘点与报表复刻准备

生成时间：2026-05-03 14:00（北京时间）

## 目标

为复刻聚水潭「采集数据汇总成报表」功能，盘点当前聚协云/Temu 自动化采集任务已经落盘的数据文件、命中的业务接口、可复用字段和第一版报表底表设计。

## 当前采集落盘位置

当前采集结果主要写入：

```text
C:\Users\Administrator\AppData\Roaming\temu-automation
```

同时存在按账号隔离的副本，例如：

```text
temu_store%3Aacc_1777015177552%3Atemu_raw_*.json
```

当前观察到最新一批采集文件集中更新在 2026-05-03 13:59:22–13:59:23（北京时间）。

## 第一版报表优先数据源

| 优先级 | 数据文件 | 用途 | 复刻价值 |
|---|---|---|---|
| P0 | `temu_dashboard.json` | 店铺经营总览、商品状态、销量、缺货、售罄、备货建议 | 高 |
| P0 | `temu_products.json` | 商品基础信息、标题、类目、SPU/SKC/goodsId、状态、销量 | 高 |
| P0 | `temu_orders.json` | 备货单/订单明细、SKU、数量、金额、仓库、时间 | 高 |
| P0 | `temu_sales.json` | 商品销售、库存、建议备货、缺货量、价格 | 高 |
| P0 | `temu_flux.json` | 商品级曝光、点击、访问、加购、支付、转化率 | 高 |
| P1 | `temu_raw_globalPerformance.json` | 动销详情、地区明细、趋势、活动商品表现 | 高 |
| P1 | `temu_raw_activity.json` | 活动主题、活动趋势、活动商品表现 | 高 |
| P1 | `temu_raw_mallFlux.json` | 店铺级流量列表 | 高 |
| P1 | `temu_raw_qualityDashboard.json` | 质量指标、售后率、质量评分、预估损失 | 高 |
| P1 | `temu_raw_delivery.json` | 发货考核、履约周期、记录、处罚权益 | 高 |

## 已确认的核心结构

### `temu_dashboard.json`

顶层结构：

```text
apis: Array
statistics: 店铺统计
productStatus: 商品状态统计
saleAnalysis: 销售分析
syncedAt: 同步时间
```

可用于报表字段：

- 在售商品数
- 近 7 日销量
- 近 30 日销量
- 缺货 SKC 数
- 已售罄数
- 即将售罄数
- 建议备货 SKC 数
- 待上架/审核/驳回/下架/禁售等商品状态
- 今日销量、售罄率、售罄预警、节日缺货统计

已确认业务接口：

| 接口 path | 返回内容方向 |
|---|---|
| `/api/kiana/mms/robin/queryProductStatusCount` | 商品状态聚合 |
| `/api/kiana/gamblers/marketing/enroll/activity/list/for/home` | 首页活动列表 |
| `/api/kiana/marvel-mms/cyborg/fully/increase/flow/homeQuery` | 流量增长推荐商品 |
| `/lich-mms/todo/video/realtime/top/query` | 视频/素材待办商品 |
| `/hawk/mms/course/page-query` | 课程/学习中心列表 |

### `temu_products.json`

当前结构为数组，单条商品包含：

```text
title, category, categories, spuId, skcId, goodsId, sku, imageUrl, status, totalSales, last7DaysSales
```

可用于「商品销售明细」「商品主数据」「商品状态汇总」。

### `temu_orders.json`

当前结构为数组，单条订单包含：

```text
key, type, purchaseOrderNo, parentOrderNo, title, skcId, skuId, skuCode, quantity, status, amount, warehouse, orderTime, urgencyInfo, attributes
```

可用于「备货单/订单明细」「SKU 需求量」「仓库维度待处理单」。

### `temu_sales.json`

顶层结构：

```text
summary, syncedAt, items
```

单条销售项包含：

```text
title, category, skcId, spuId, goodsId, imageUrl, todaySales, last7DaysSales, last30DaysSales, totalSales, warehouseStock, adviceQuantity, lackQuantity, price, skuCode, stockStatus, supplyStatus, hotTag
```

可用于「商品销售明细」「库存备货建议」「缺货预警」。

### `temu_flux.json`

顶层结构：

```text
summary, syncedAt, items
```

单条流量项包含：

```text
goodsId, goodsName, imageUrl, spuId, category, exposeNum, clickNum, detailVisitNum, addToCartUserNum, buyerNum, payGoodsNum, clickPayRate
```

可用于「商品流量转化报表」。

### `temu_raw_globalPerformance.json`

顶层结构：

```text
range, days, periodStart, periodEnd, usedEndpoint, skcCount, totalSkcSales, overallTrend, skcSales, regionDetails, activityGoods, activityCount, totalActivityAmount, avgClickRate, avgPayRate, warehouseTotal
```

可用于：

- 动销趋势
- SKC 销售排行
- 地区明细
- 活动商品销售表现
- 仓库总量

### `temu_raw_activity.json`

已确认业务接口：

| 接口 path | 返回内容方向 |
|---|---|
| `/api/activity/data/query-activity-theme-info` | 活动主题、开始/结束时间 |
| `/api/activity/data/market/trend` | 活动市场趋势、访客、点击/支付转化 |
| `/api/activity/data/goods/detail` | 活动商品明细 |
| `/api/activity/data/market/monitor` | 活动市场监控 |
| `/api/kiana/gamblers/web/marketing/enroll/activityAmbience` | 活动氛围/时间节点 |

可用于「活动表现报表」。

### `temu_raw_mallFlux.json`

已确认业务接口：

| 接口 path | 返回内容方向 |
|---|---|
| `/api/seller/full/flow/analysis/mall/list` | 店铺级流量列表，包含 `total`、`list`、`updateAt` |

可用于「店铺流量趋势/店铺流量明细」。

### `temu_raw_qualityDashboard.json`

已确认业务接口：

| 接口 path | 返回内容方向 |
|---|---|
| `/bg-luna-agent-seller/goods/quality/supplyChain/qualityMetrics/query` | 质量指标、售后率、均分、成本、预估损失、统计日期 |
| `/bg-luna-agent-seller/goods/quality/supplyChain/qualityMetrics/pageQuery` | 商品级质量指标分页列表 |
| `/bg-luna-agent-seller/goods/quality/supplyChain/qualityScore/count` | 商品质量分分布 |
| `/bg-anniston-agent-seller/category/children/list` | 类目树/类目筛选 |

可用于「质量售后报表」。

### `temu_raw_delivery.json`

顶层结构：

```text
forwardSummary, period, record, rightPunish, recordDetail, syncedAt
```

可用于：

- 发货考核汇总
- 考核周期
- 履约记录
- 超期/待发/已发统计
- 处罚权益

## 低价值或噪声接口过滤规则

raw 文件中大量接口属于导航、权限、红点、弹窗、消息、灰度配置，不建议作为报表底表直接使用。当前过滤方向：

```text
/api/seller/auth/userInfo
/api/seller/auth/menu
/agora/conv/needReplyCount
/bg/detroit/api/infoTicket/searchTicket
/api/phantom/dm/wl/cg
/quick/merchant/pop/query
/bg/quick/api/merchant/rule/unreadNum
/hawk/mms/course/exam/queryTotalExam
/api/kiana/*/queryInvitationGoodsCouponCount
/api/kiana/*/FeedbackMmsQueryRpcService/checkAbleFeedback
/api/kiana/*/FeedbackMmsQueryRpcService/queryFeedbackNotReadTotal
各种 gray / privilege / popup / redNotice / todo count
```

## 第一版报表设计建议

### 1. 经营总览

数据源：`temu_dashboard.json`

字段：

- 同步时间
- 在售商品数
- 近 7 日销量
- 近 30 日销量
- 缺货 SKC 数
- 已售罄数
- 即将售罄数
- 建议备货 SKC 数
- 待提交/审核中/驳回/下架/禁售商品数

### 2. 商品销售明细

数据源：`temu_products.json` + `temu_sales.json`

关联键优先级：

```text
goodsId > skcId > spuId > skuCode/title
```

字段：

- 商品标题
- 类目
- SPU/SKC/goodsId
- SKU 编码
- 商品状态
- 今日销量
- 7 日销量
- 30 日销量
- 总销量
- 仓库库存
- 建议备货量
- 缺货量
- 价格
- 库存状态
- 供货状态

### 3. 订单/备货明细

数据源：`temu_orders.json`

字段：

- 采购单号
- 父订单号
- 商品标题
- SKC/SKU
- 数量
- 状态
- 金额
- 仓库
- 下单时间
- 紧急信息
- 属性

### 4. 流量转化明细

数据源：`temu_flux.json` + `temu_raw_mallFlux.json`

字段：

- 商品 ID
- 商品名称
- 类目
- 曝光数
- 点击数
- 详情访问数
- 加购用户数
- 买家数
- 支付件数
- 点击支付转化率

### 5. 动销/地区分析

数据源：`temu_raw_globalPerformance.json`

字段：

- 周期范围
- SKC 数
- 总 SKC 销量
- 日期趋势
- SKC 销售排行
- 地区明细
- 活动商品 GMV/销量/访客/点击率/支付率
- 仓库总量

### 6. 活动表现

数据源：`temu_raw_activity.json`

字段：

- 活动主题
- 活动 ID
- 开始时间
- 结束时间
- 活动访客
- 点击转化率
- 支付转化率
- 活动商品明细

### 7. 质量售后

数据源：`temu_raw_qualityDashboard.json`

字段：

- 统计日期
- 90 日质量售后率
- 90 日平均质量分
- 质量售后成本
- 预估损失
- 商品级质量指标
- 质量分分布

### 8. 履约发货

数据源：`temu_raw_delivery.json`

字段：

- 待发数
- 已发数
- 超期数
- 考核周期
- 履约记录
- 处罚权益

## 后续补充计划

采集仍在继续时，需要继续观察：

1. 是否有新文件更新到更晚时间戳。
2. `temu_raw_adsReport.json` 内是否存在真正广告消耗/投产相关接口，而不是仅导航噪声。
3. `temu_raw_flowPrice.json`、`temu_raw_priceCompete.json` 当前体积很小，需确认是否采集失败或页面无数据。
4. 侧边栏类文件如 `shippingDesk`、`returnOrders` 当前多数只命中 `/api/phantom/dm/wl/cg`，需判断是否需要改采集方式。
5. 后续实现报表时，优先从已解析的五个核心 JSON 入手，再逐步接入 raw 业务接口。
