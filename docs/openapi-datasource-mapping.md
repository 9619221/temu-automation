# 官方 OpenAPI ↔ 现有抓包数据源 精确对照表

> 2026-06-02 评估产出。基线：用沙箱全托账号 `bg.open.accesstoken.info.get` 实拉的 **159 个授权接口**（apiScopeList）+ 现有 75 个抓包数据源（[scrape-registry.mjs](../automation/scrape-registry.mjs)）。
> 决策：混合架构，先做 CN/PA 区；流量/财务继续抓包；跨区（GLOBAL 合规、US/EU 半托订单）本期不做。
>
> 图例：✅ 官方有接口可直接切 · 🟡 部分覆盖/需自拼/自研专属需单独申请 · ❌ 官方无接口（保留抓包）

## 一、核心经营

| 现有数据源 | 覆盖 | 官方接口 | 说明 |
|---|---|---|---|
| products / goodsData | ✅ | `bg.glo.goods.list.get` + `bg.glo.goods.detail.get` | 实测拿到 productId/属性/SKU(extCode/重量/体积/敏感品)。**注意 CN 的 `bg.goods.list.get` 已 type not exists，必须走 glo/PA** |
| lifecycle | ✅ | `bg.glo.product.search` | 货品生命周期状态 |
| soldout | ✅ | `bg.glo.goods.topselling.soldout.get` | 爆款售罄 |
| sales | 🟡 | `bg.goods.salesv2.get` / `bg.goods.sales.get` | 仅分仓组汇总，**无逐笔订单/逐 SKU 销量** |
| salesChart（销售趋势）| ❌ | — | 无趋势/图表接口 |
| dashboard（概览）| ❌ | — | 无概览聚合，只能自己拼 |
| performance | ❌ | — | 无 |
| flux（流量）| ❌ | — | **官方无流量接口 → 保留抓包** |
| activity | ✅ | `bg.marketing.activity.list/detail/product/session/enroll.*.global` | 全套，**优先切**（含报名提交）|
| afterSales | 🟡 | `bg.refund.returnpackage.*` | 退货售后有；客服工单类无 |

## 二、商品管理 / 编辑上架

| 现有数据源 | 覆盖 | 官方接口 |
|---|---|---|
| 商品上架/编辑 | ✅ | 编辑组 `bg.glo.goods.update / edit.property / edit.task.apply / edit.task.submit / edit.pictures.submit / edit.sensitive.attr / edit.guide.file` |
| 类目属性 | ✅ | `bg.glo.goods.cats.get / attrs.get / catsmandatory.get / category.match / parentspec.get / spec.create` |
| 尺码表 | ✅ | `bg.glo.goods.sizecharts.*`（class/get/create/meta/settings/template.create）|
| 说明书 | ✅ | `bg.glo.goods.instructions.upload / instructionslanguages.get / instructionstranslation.get / translationresult.get` |
| 模特 | ✅ | `bg.glo.modelinfo.get/add/edit` + `bg.glo.modelcats.get` |
| 图片/视频处理 | ✅ | `bg.goods.image.upload.global / texttopicture.add.global / video.upload.sign.get.global` + 翻译/压缩/色块 |
| labelCode / 条码 | ✅ | `bg.glo.goods.labelv2.get` + `bg.glo.goods.custom.label.get` |
| brand | ✅ | `bg.glo.goods.brand.get` |
| retailPrice（建议价）| 🟡 | `bg.goods.suggest.supplyprice.get` | **自研专属 + 100次/天**，授权清单里未默认带，需单独申请 |
| checkup / checkupCenter（检测分）| ❌ | — |
| goodsDraft（草稿）| ❌ | — |
| highPrice（高价品）| ❌ | — |
| usRetrieval（US 搜索排名）| ❌ | — |

## 三、价格（申报/核价/调价）

| 现有数据源 | 覆盖 | 官方接口 |
|---|---|---|
| priceDeclaration（申报价）| ✅ | `bg.glo.goods.price.list.get`（货品供货价）|
| 核价 | ✅ | 全托 `bg.price.review.page.query/confirm/reject`；半托 `bg.semi.price.review.*.order` |
| 调价 | ✅ | 全托 `bg.full.adjust.price.page.query/batch.review`；半托 `bg.semi.adjust.price.*` |
| bidding（招标）| 🟡 | `bg.glo.best.seller.invitation.query` |
| priceCompete（比价）| ❌ | — |
| flowPrice（流量价）| ❌ | — |
| hotPlan（热销榜）| ❌ | — |

> 注：核价/调价/申报价多为**自研专属接口**，生产店铺需把 主体id+appkey+店铺id 给招商运营单独申请权限。

## 四、订单 / 物流 / 履约（全托链路）

| 现有数据源 | 覆盖 | 官方接口 |
|---|---|---|
| 采购备货单 | ✅ | `bg.purchaseorderv2.get` + `apply/edit/cancel` |
| shippingDesk / shippingList | ✅ | `bg.shiporder.staging.get/add` + `bg.shiporderv2.get` + `bg.shiporderv3.create` |
| addressManage | ✅ | `bg.mall.address.get/add` + `bg.shiporder.receiveaddressv2.get` |
| 包裹 | ✅ | `bg.shiporder.package.get/edit` |
| 物流/装箱 | ✅ | `bg.logistics.company.get` + `bg.shiporder.logistics.get/change` + `packing.match/send` + `logisticsmatch.get` |
| 运单标签/箱唛 | ✅ | `bg.logistics.boxmarkinfo.get` + `bg.shiporder.express.note.get` |
| returnOrders/Receipt/Detail | ✅ | `bg.refund.returnpackage.get/detail/list` |
| 寄样/质检 | ✅ | `bg.sample.order.get/send` + `bg.goods.qualityinspection.get/detail` |
| urgentOrders（加急）| 🟡 | 无加急专项，从 shiporder/purchaseorder 推导 |
| delivery（发货考核分）| ❌ | — |
| receiveAbnormal / exceptionNotice（收货异常）| ❌ | — |
| salesReturn（退货统计）| 🟡 | 退货明细可拼，无统计接口 |
| vacuumPumping（抽真空）| ❌ | — |

## 五、库存

| 现有数据源 | 覆盖 | 官方接口 |
|---|---|---|
| 半托销售库存 | ✅ | `bg.btg.goods.stock.quantity.get/update` + `warehouse.list.get` + `route.add` |
| 全托/JIT 虚拟库存 | ✅ | `bg.qtg.stock.virtualinventoryjit.get/edit` + `bg.glo.jitmode.activate` |
| 多仓库存明细聚合 | 🟡 | 无聚合接口，需自拼 |

## 六、广告（仅全托）

| 现有数据源 | 覆盖 | 官方接口 |
|---|---|---|
| 全托广告投放/报表 | ✅ | `bg.glo.searchrec.ad.create/modify/batch.modify/detail.query/roas.pred/log.query` + `reports.goods.query`(商品维度) + `reports.mall.query`(店铺维度) |
| 半托广告 / 广告财务 | ❌ | — |

## 七、官方完全无接口（确认保留抓包）

| 抓包数据源 | 数量 | 原因 |
|---|---|---|
| 流量分析 mallFlux/flux/flowGrow + EU/US 多区 | 8 | 平台业务范围不含流量 |
| 合规中心 govern*（资质/EPR/IP/海关/申诉等）| 16 | CN 区无；合规资质在 GLOBAL 区，本期不做 |
| 财务/结算/对账/回款 | — | 平台无财务接口 |
| dashboard 概览 / salesChart 趋势 / performance | 3 | 无聚合/趋势接口 |
| 比价 priceCompete / 热销榜 hotPlan / 流量价 flowPrice | 3 | 无 |
| 质量大盘 qualityDashboard/EU | 2 | 无（质检 ≠ 质量分）|
| marketAnalysis / bondedGoods / goodsDraft | 3 | 无 |

## 八、汇总结论

- **可切官方（✅，约 30+ 数据源）**：商品主数据/编辑/上架全链路、价格(申报/核价/调价)、活动报名、全托备货发货履约、退货售后/寄样质检、库存、全托广告。覆盖 ERP 最高频的「商品+履约+营销写操作」核心。
- **官方有但需单独申请/部分覆盖（🟡）**：销售(仅汇总)、建议价、招标、urgentOrders、云朵多站点聚合。
- **官方完全没有，保留抓包（❌，约 35 数据源）**：流量、合规中心、财务、概览/趋势、比价/热销榜、质量大盘。

> 最终形态 = 官方 API 接管「商品/价格/活动/履约/库存」+ 抓包保留「流量/财务/合规/质量分」。159 个授权接口里无任何流量/财务/合规中心接口，这是平台设计边界，非授权缺失。

## 附：159 个授权接口全清单
见 `scripts/probe-openapi-scopes.mjs` 实时拉取（沙箱全托账号 token 授权范围）。
