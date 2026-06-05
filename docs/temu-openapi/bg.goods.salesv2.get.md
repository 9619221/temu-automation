# bg.goods.salesv2.get — 销售管理分仓组数据查询接口

> 来源: https://agentpartner.temu.com/document?cataId=875198836203&docId=877385749076
> 文档更新时间: 2025-03-19 21:55:09 ｜ 保存于: 2026-06-04
> 所属: 销售 API 组 ｜ 调用地址: `/openapi/router`（地区 CN）

## 接口介绍

卖家中心查询全托管卖家分仓组的销售数据信息。

**⚠️ 能力边界（与「逐日销量」相关，2026-06-04 核对）：**
- 销量字段只有 `todaySaleVolume`(今日) / `lastSevenDaysSaleVolume`(近7天) / `lastThirtyDaysSaleVolume`(近30天) / `totalSaleVolume`(总)——**没有任何按日期(某一天)的销量**。
- 请求参数里**没有日期/时间参数**，连「查某天」都做不到。
- 返回里的 `subOrderList`（标注"订单信息"）实为**每个商品的销量+库存行**，**不是逐笔消费者订单**。
- 全托管 API 列表里**没有「订单」接口组**，无法用订单反推逐日。结论：官方给不了逐日销量，逐日只能靠抓包（卖家后台 `listOverall`）。

## 公共请求参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| type | STRING | 是 | API 接口名，形如 `bg.*` |
| app_key | STRING | 是 | 已创建成功的应用标志 |
| timestamp | STRING | 是 | UNIX 时间（秒），10 位；当前时间-300 ≤ 入参 ≤ 当前时间+300 |
| sign | STRING | 是 | API 入参签名 |
| data_type | STRING | 否 | 返回数据格式，固定 `JSON` |
| access_token | STRING | 是 | 用户授权令牌（卖家中心—授权管理 申请生成） |
| version | STRING | 是 | API 版本，默认 V1，无要求不传 |

## 请求参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| pageNo | INTEGER | 是 | 页号，从 1 开始 |
| pageSize | INTEGER | 是 | 每页记录数，范围 [1,500] |
| productIdList | LIST<INTEGER> | 否 | spu 列表 |
| productSkcIdList | LIST<INTEGER> | 否 | skc 列表 |
| skcExtCodeList | LIST<STRING> | 否 | skc 货号列表 |
| skuExtCodeList | LIST<STRING> | 否 | sku 货号列表 |
| productName | STRING | 否 | 货品名称 |
| selectStatusList | LIST<INTEGER> | 否 | 选品状态 10-待下首单 11-已下首单 12-已加入站点 13-已下架 |
| stockStatusList | LIST<INTEGER> | 否 | 售罄状态 0-库存充足 1-即将断码 2-已断码 3-全部售罄(已断货) |
| supplyStatusList | LIST<INTEGER> | 否 | 供应状态 0-正常供货 1-暂时无货 2-停产 |
| pictureAuditStatusList | LIST<INTEGER> | 否 | 图片审核状态 1-未完成 2-已完成 |
| closeJitStatus | LIST<INTEGER> | 否 | JIT 转备货状态 0-未申请 1-调价中 2-待备货 3-备货完成待关闭JIT 4-JIT已关闭 5-调价失败 6-备货失败 7-降价后又涨价 |
| isLack | INTEGER | 否 | 是否缺货 0-不缺货 1-缺货 |
| todaySaleVolumMax / todaySaleVolumMin | INTEGER | 否 | SKC 今日销量 最大/最小值 |
| sevenDaysSaleVolumMax / sevenDaysSaleVolumMin | INTEGER | 否 | SKC 近 7 天销量 最大/最小值 |
| thirtyDaysSaleVolumMax / thirtyDaysSaleVolumMin | INTEGER | 否 | SKC 近 30 天销量 最大/最小值 |
| minRemanentInventoryNum / maxRemanentInventoryNum | INTEGER | 否 | sku 最小/最大剩余库存 |
| minAvailableSaleDays / maxAvailableSaleDays | STRING | 否 | 最小/最大可售天数 |
| onSalesDurationOfflineLte / onSalesDurationOfflineGte | INTEGER | 否 | 加入站点时长 ≤ / ≥ |
| warehouseGroupIdList | LIST<INTEGER> | 否 | 备货仓组 id |
| inventoryRegionList | LIST<INTEGER> | 否 | 备货区域 1-国内 2-海外 3-保税仓 |
| purchaseStockType | INTEGER | 否 | 是否 JIT 备货 0-普通 1-JIT |
| settlementType | INTEGER | 否 | 结算类型 0-非vmi 1-vmi |
| hotTag | BOOLEAN | 否 | 是否热销款 |
| isCustomGoods | BOOLEAN | 否 | 是否定制品 |
| availableProduceNumGreaterThanZero | BOOLEAN | 否 | 剩余生产件数是否>0 |
| suggestCloseJit | BOOLEAN | 否 | 是否 JIT 建议转备货 |
| orderByParam / orderByDesc | STRING / INTEGER | 否 | 排序字段 / 0-升 1-降 |
| advancedSort | OBJECT | 否 | 高级排序（firstOrderByParam/firstOrderByDesc/secondOrderByParam/secondOrderByDesc） |

## 返回参数

`result` (OBJECT):
- `total` INTEGER — 总数
- `subOrderList` LIST<OBJECT> — **商品销量+库存行（非逐笔订单）**，每项含：
  - 标识: `productId` / `productSkcId` / `skcExtCode` / `skuExtCode` / `productName` / `className`(尺码名) / `productSkcPicture` / `category`
  - **销量**: `todaySaleVolume`(今日) / `lastSevenDaysSaleVolume`(近7天) / `lastThirtyDaysSaleVolume`(近30天) / `totalSaleVolume`(总) / `sevenDaysSaleReference`(7日销量参考) / `sevenDaysReferenceSaleType`(1-7日最大 2-7日日均)
  - 加购: `inCardNumber`(加购数) / `inCartNumber7d`(近7天加购)
  - 备货建议: `adviceQuantity`(建议下单量) / `lackQuantity`(缺货数) / `stockDays`(备货天数) / `safeInventoryDays`(安全库存天数) / `purchaseConfig`(下单逻辑) / `canPurchase` / `isEnoughStock` / `hasHotSku`(爆旺款)
  - 可售天数: `availableSaleDays` / `warehouseAvailableSaleDays`(仓内,1位小数) / `availableSaleDaysFromInventory`(库存可售)
  - 库存 `inventoryNumInfo` (OBJECT): `warehouseInventoryNum`(仓内) / `unavailableWarehouseInventoryNum`(暂不可用) / `expectedOccupiedInventoryNum`(预计占用) / `waitOnShelfNum`(待上架) / `waitApproveInventoryNum`(待审核备货) / `waitQcNum`(已上架待质检) / `waitInStock`(待入库) / `waitReceiveNum`(待收货) / `waitDeliveryInventoryNum`(待发货)
  - 价格/核价: `supplierPrice`(申报价) / `priceReviewStatus` / `isVerifyPrice` / `isReducePricePass`
  - 状态: `supplyStatus` / `supplyStatusRemark` / `closeJitStatus` / `purchaseStockType` / `settlementType` / `inventoryRegion` / `onSalesDurationOffline`(加入站点时长) / `inBlackList`(备货黑名单) / `isFirst`(是否首单) / `pictureAuditStatus` / `illegalReason`(违规原因) / `expectNormalSupplyTime`
  - 定制 `customInfoVO` (OBJECT): `isCustomGoods` / `limitNum` / `effectPicture` / `autoCloseJit`
  - `skuQuantityDetailList` LIST — sku 维度数量信息（字段同上，含 `productSkuId` / `warehouseGroupId` / `warehouseGroupName`）
  - `warehouseInfoList` LIST — 分仓组维度信息（每组同样的销量/库存/可售天数字段）
- `success` BOOLEAN — status
- `errorCode` INTEGER — error code
- `errorMsg` STRING — error message

## 错误码

| 错误码 | 描述 | 解决办法 |
|---|---|---|
| 100000000 | query warehouse sales info error | please try again later |

## 权限包

| 权限包 | 可获得/可申请的应用类型 |
|---|---|
| 销售 API 组 | He uses type、Self use type |
