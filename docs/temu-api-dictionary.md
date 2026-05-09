# Temu 接口字典

更新时间：2026-05-08

这个字典的目标是给巡店采集和店铺控制台提供统一口径：扩展抓到接口后，ERP 能知道它大概属于商品、销量、补货、活动、违规、退货、快递取消里的哪一类，也能追溯“这列数据从哪个接口字段来”。

证据分两类：

- `confirmed-local-extension`：从本机咕噜噜扩展 `background.js` 里提取到的明确 URL 或请求字段。
- `inferred-page`：根据页面路径和 URL 关键词推断，后续要用运行时抓包确认。

机器可读版本在：

- `src/config/temuApiDictionary.ts`
- `chrome-extension/temu-patrol/api-dictionary.js`

## 已确认接口

| 分类 | 接口 | 主要用途 | 关键请求字段 | 关键响应字段 | 证据 |
|---|---|---|---|---|---|
| 销量 / 补货 | `POST https://agentseller.temu.com/mms/venom/api/supplier/sales/management/listOverall` | 销售管理、SKU 履约、售罄/缺货/建议补货 | `mallid`, `anti-content`, `pageNo`, `pageSize`, `isLack`, `orderByParam`, `selectStatusList` | `subOrderList`, `pageItems`, `list`, `saleOutSkcNum`, `soonSaleOutSkcNum`, `adviceStockSkcNum`, `shortageSkcNum`, `productSkcId`, `productSkuId`, `lastSevenDaysSaleVolume`, `inventoryNumInfo` | 咕噜噜本地扩展 |
| 销量 | `POST https://agentseller.temu.com/bg-brando-mms/supplier/data/center/skc/sales/data` | SKC 分站点销售数据 | `mallid`, `anti-content`, 商品/SKC/日期参数 | `result.list`, `country`, `confirmGoodsQuantity`, `changeRate` | 咕噜噜本地扩展 |
| 活动 | `POST https://agentseller.temu.com/api/kiana/gamblers/marketing/enroll/feedback/queryValidActivity4FeedBackOffline` | 商品可报名活动查询 | `anti-content`, `productId` | 可报名活动、活动状态、反馈结果 | 咕噜噜本地扩展 |
| 活动 / 广告 | `POST https://ads.temu.com/api/v1/coconut/ad/ads_detail` | 广告活动明细 | `ad_status`, `ad_advice_types`, `page_size`, `page_number`, `specific_query_info`, `start_time`, `end_time`, `list_id` | 广告列表、曝光、点击、加购、成交、ACOS | 咕噜噜本地扩展 |
| 快递取消 / 补货 | `POST https://seller.kuajingmaihuo.com/bgSongbird-api/supplier/deliverGoods/platform/pageQuerySubPurchaseOrder` | 备货/发货子采购单查询 | `anti-content`, 发货/采购单筛选条件 | `subOrderForSupplierList`, `pageItems`, `skuQuantityDetailList`, `status` | 咕噜噜本地扩展 |
| 快递动作 | `POST https://seller.kuajingmaihuo.com/bgSongbird-api/supplier/deliverGoods/platform/createDeliveryOrderGroupSimpleByAddress` | 创建发货单 | `anti-content`, 创建发货单参数 | `success`, 发货单创建结果 | 咕噜噜本地扩展。这个是动作接口，只记录，不自动重放 |
| 资金 | `POST https://seller.kuajingmaihuo.com/api/merchant/fund/detail/pageSearch` | 资金明细查询 | `fundChangeTypeList`, `beginTime`, `endTime`, `pageSize`, `pageNum` | 资金流水、金额、时间、变动类型 | 咕噜噜本地扩展 |
| 类目 | `POST https://agentseller.temu.com/anniston-agent-seller/category/children/list` | 类目子节点列表 | `mallid`, 类目查询参数 | 类目树、`catId`, `catName`, `children` | 咕噜噜本地扩展 |
| 类目 | `POST https://agentseller.temu.com/anniston-agent-seller/category/template/query` | 类目模板属性查询 | `catId`, `langList` | `result.properties`, 属性名、多语言值 | 咕噜噜本地扩展 |
| 流量 | `POST https://agentseller-eu.temu.com/api/seller/full/flow/analysis/goods/list` | 商品流量分析列表 | 日期范围、商品/SKC 查询条件、`anti-content` | `exposeNum`, `clickNum`, `buyerNum`, `payGoodsNum` | 咕噜噜本地扩展 |

## 采集策略

扩展收到接口响应后按这个顺序处理：

1. 先用接口字典匹配路径。
2. 命中字典后写入 `apiDictionaryId`、`apiDictionaryLabel`、`apiCaptureMode`。
3. 用字典分类生成 `dataKey`，例如 `temu_ext_sales_listOverall`。
4. `capture-and-replay` 接口可以学习模板，后续后台重放。
5. `capture-only` 接口只保存页面实际请求结果，不后台重放。
6. `observe-only` 接口只记录证据，不参与自动巡店动作。

## 下一步要确认的接口

这些页面应继续通过我们的扩展运行时采集确认：

- 退货 / 售后：`/main/aftersales/information`
- 违规 / 体检：`/goods/checkup-center`, `/main/quality/dashboard`
- 活动完整列表：`/main/act/data-full`, `/activity/marketing-activity`
- 商品管理完整字段：`/goods/list`
- 库存和售罄：`/stock/fully-mgt/sale-manage/board/sku-sale-out`
