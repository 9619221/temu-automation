# 销售API组

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 1 个接口


---

## bg.goods.salesv2.get

bg.goods.salesv2.get
销售管理分仓组数据查询接口
更新时间：2025-03-19 21:55:09
接口介绍：卖家中心查询全托管卖家分仓组的销售数据信息
公共参数
收起
请求地址
调用地址/地区	数据存储
/openapi/router	CN
公共请求参数
参数接口	参数类型	是否必填	说明
type	STRING	是	API接口名, 形如:bg.*
app_key	STRING	是	已创建成功的应用标志
timestamp	STRING	是	时间戳，格式为UNIX时间（秒） ，长度10位，当前时间-300秒<=入参时间<=当前时间+300秒
sign	STRING	是	API入参参数签名，签名值根据如下算法给出计算过程
data_type	STRING	否	请求返回的数据格式，可选参数固定为JSON
access_token	STRING	是	用户授权令牌access_token，卖家中心—授权管理，申请授权生成
version	STRING	是	API版本，默认为V1，无要求不传此参数
请求参数说明
收起
参数接口	参数类型	是否必填	说明
productIdList	LIST	否	spu列表
$item	INTEGER	否	-
onSalesDurationOfflineLte	INTEGER	否	加入站点时长小于等于
minRemanentInventoryNum	INTEGER	否	sku最小剩余库存
selectStatusList	LIST	否	选品状态 10-待下首单 11-已下首单 12-已加入站点 13-已下架
$item	INTEGER	否	-
pageSize	INTEGER	是	每页记录数,范围[1,500]
todaySaleVolumMax	INTEGER	否	SKC今日销量最大值
maxAvailableSaleDays	STRING	否	最大可售天数
productName	STRING	否	货品名称
thirtyDaysSaleVolumMax	INTEGER	否	SKC近30天销量最大值
thirtyDaysSaleVolumMin	INTEGER	否	SKC近30天销量最小值
pageNo	INTEGER	是	页号， 从1开始
sevenDaysSaleVolumMax	INTEGER	否	SKC近7天销量最大值
stockStatusList	LIST	否	售罄状态 (0-库存充足 1-即将断码 2-已断码 3-全部售罄(已断货))
$item	INTEGER	否	-
skcExtCodeList	LIST	否	skc货号列表
$item	STRING	否	-
orderByDesc	INTEGER	否	排序，0-升序，1-降序
pictureAuditStatusList	LIST	否	图片审核状态 1-未完成；2-已完成
$item	INTEGER	否	-
supplyStatusList	LIST	否	供应状态 0-正常供货 1-暂时无货 2-停产
$item	INTEGER	否	-
minAvailableSaleDays	STRING	否	最小可售天数
closeJitStatus	LIST	否	JIT 转备货状态 0-未申请 1-调价中 2-待备货 3-备货完成，待关闭JIT 4-JIT已关闭 5-调价失败，流程结束 6-备货失败，流程结束 7-降价后又涨价，流程结束
$item	INTEGER	否	-
isLack	INTEGER	否	是否缺货 0-不缺货 1-缺货
productSkcIdList	LIST	否	skc列表
$item	INTEGER	否	-
maxRemanentInventoryNum	INTEGER	否	sku最大剩余库存
hotTag	BOOLEAN	否	是否热销款
availableProduceNumGreaterThanZero	BOOLEAN	否	剩余生产件数是否大于0
onSalesDurationOfflineGte	INTEGER	否	加入站点时长大于等于
skuExtCodeList	LIST	否	sku货号列表
$item	STRING	否	-
purchaseStockType	INTEGER	否	是否是JIT备货， 0-普通，1-JIT备货
warehouseGroupIdList	LIST	否	备货仓组id
$item	INTEGER	否	-
advancedSort	OBJECT	否	高级排序
secondOrderByParam	STRING	是	第一排序字段：传入后端返回的字段
firstOrderByDesc	INTEGER	是	第一字段排序，0-升序，1-降序
secondOrderByDesc	INTEGER	是	第二字段排序，0-升序，1-降序
firstOrderByParam	STRING	是	第一排序字段：传入后端返回的字段
settlementType	INTEGER	否	结算类型 0-非vmi 1-vmi
todaySaleVolumMin	INTEGER	否	SKC今日销量最小值
sevenDaysSaleVolumMin	INTEGER	否	SKC近7天销量最小值
inventoryRegionList	LIST	否	备货区域，1-国内备货，2-海外备货，3-保税仓备货
$item	INTEGER	否	-
isCustomGoods	BOOLEAN	否	是否为定制品
orderByParam	STRING	否	排序参数，传入后端返回的字段
suggestCloseJit	BOOLEAN	否	是否 JIT 建议转备货
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	总数
subOrderList	LIST	订单信息
$item	OBJECT	-
customInfoVO	OBJECT	定制内容
limitNum	INTEGER	定制字数限制
isCustomGoods	BOOLEAN	是否为定制品
effectPicture	STRING	定制效果图
autoCloseJit	BOOLEAN	是否会自动关闭jit
productName	STRING	货品名称
illegalReason	STRING	违规原因
pictureAuditStatus	INTEGER	图片审核状态 1-未完成；2-已完成
isFirst	BOOLEAN	是否首单 0-否 1-是
skuQuantityDetailList	LIST	sku维度数量信息
$item	OBJECT	-
stockDays	INTEGER	备货天数
canPurchase	BOOLEAN	仓组下是否可以备货
priceReviewStatus	INTEGER	核价状态
availableSaleDaysFromInventory	STRING	库存可售天数
skuExtCode	STRING	sku货号
inCartNumber7d	INTEGER	近7天用户加购数量
sevenDaysSaleReference	STRING	7日销量参考
lackQuantity	INTEGER	缺货数量
lastSevenDaysSaleVolume	INTEGER	近7天销量
warehouseGroupId	INTEGER	备货仓组
productSkuId	INTEGER	productSkuId
warehouseGroupName	STRING	备货仓组名称
isReducePricePass	BOOLEAN	是否降低供货价通过
availableSaleDays	STRING	可售天数
supplierPrice	INTEGER	申报价格
todaySaleVolume	INTEGER	今日销量
adviceQuantity	INTEGER	建议下单量
warehouseAvailableSaleDays	STRING	仓内库存可售天数:保留一位小数
inCardNumber	INTEGER	用户加购数量
isVerifyPrice	BOOLEAN	是否核价通过，默认=false，降级时=null
totalSaleVolume	INTEGER	总销量
className	STRING	尺码名称
sevenDaysReferenceSaleType	INTEGER	七日销量参考类型 1.7日最大销量 2.7日日均销量
lastThirtyDaysSaleVolume	INTEGER	近30天销量
warehouseInfoList	LIST	分仓组信息
$item	OBJECT	-
stockDays	INTEGER	备货天数
availableSaleDaysFromInventory	STRING	库存可售天数
totalSaleVolume	INTEGER	总销量
sevenDaysSaleReference	STRING	7日销量参考
lackQuantity	INTEGER	缺货数量
sevenDaysReferenceSaleType	INTEGER	七日销量参考类型 1.7日最大销量 2.7日日均销量
lastSevenDaysSaleVolume	INTEGER	近7天销量
warehouseGroupId	INTEGER	备货仓组
lastThirtyDaysSaleVolume	INTEGER	近30天销量
warehouseGroupName	STRING	备货仓组名称
safeInventoryDays	INTEGER	安全库存天数
availableSaleDays	STRING	可售天数
todaySaleVolume	INTEGER	今日销量
adviceQuantity	INTEGER	建议下单量
inventoryNumInfo	OBJECT	库存信息
waitOnShelfNum	INTEGER	待上架库存
warehouseInventoryNum	INTEGER	仓内库存
expectedOccupiedInventoryNum	INTEGER	预计占用库存
waitApproveInventoryNum	INTEGER	待审核备货库存
waitQcNum	INTEGER	已上架待质检库存
unavailableWarehouseInventoryNum	INTEGER	仓内暂不可用库存
waitInStock	INTEGER	待入库库存
waitReceiveNum	INTEGER	待收货库存
waitDeliveryInventoryNum	INTEGER	待发货库存
purchaseConfig	STRING	下单逻辑：安全库存天数+备货天数
warehouseAvailableSaleDays	STRING	仓内库存可售天数:保留一位小数
safeInventoryDays	INTEGER	安全库存天数
inventoryNumInfo	OBJECT	库存信息
waitOnShelfNum	INTEGER	待上架库存
warehouseInventoryNum	INTEGER	仓内库存
expectedOccupiedInventoryNum	INTEGER	预计占用库存
waitApproveInventoryNum	INTEGER	待审核备货库存
waitQcNum	INTEGER	已上架待质检库存
unavailableWarehouseInventoryNum	INTEGER	仓内暂不可用库存
waitInStock	INTEGER	待入库库存
waitReceiveNum	INTEGER	待收货库存
waitDeliveryInventoryNum	INTEGER	待发货库存
purchaseConfig	STRING	下单逻辑：安全库存天数+备货天数
productSkcId	INTEGER	productSkcId
expectNormalSupplyTime	INTEGER	预计正常供货时间
skcExtCode	STRING	skc货号
productId	INTEGER	productId
supplyStatus	INTEGER	供应状态
inBlackList	BOOLEAN	是否在备货黑名单内，在：禁止备货
supplyStatusRemark	STRING	供应状态备注
inventoryRegion	INTEGER	备货区域，1-国内备货，2-海外备货，3-保税仓备货
onSalesDurationOffline	INTEGER	加入站点时长
closeJitStatus	INTEGER	JIT 转备货状态 0-未申请 1-待调价 2-待备货 3-备货完成，待关闭JIT 4-JIT已关闭 5-调价失败，流程结束 6-备货失败，流程结束 7-发起涨价，流程结束
hotTag	BOOLEAN	是否热销款
isEnoughStock	BOOLEAN	是否备货充足无需下单
productSkcPicture	STRING	货品图片
purchaseStockType	INTEGER	是否是JIT备货， 0-普通，1-JIT备货
settlementType	INTEGER	结算类型 0-非vmi 1-vmi
hasHotSku	BOOLEAN	是否存在爆旺款sku
category	STRING	类目
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
100000000	query warehouse sales info error	please try again later
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
销售API组	He uses type、Self use type
