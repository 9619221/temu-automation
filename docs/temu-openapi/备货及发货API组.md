# 备货及发货API组

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 22 个接口


---

## bg.shiporder.staging.get

bg.shiporder.staging.get
查询发货台接口
更新时间：2025-03-21 20:04:34
接口介绍：新增查询发货台功能
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
settlementType	INTEGER	否	结算类型 0-非vmi 1-vmi
skcExtCode	LIST	否	货号列表
$item	STRING	否	-
productSkcIdList	LIST	否	skcId列表
$item	INTEGER	否	-
urgencyType	INTEGER	否	是否是紧急发货单，0-普通 1-急采
subWarehouseId	INTEGER	否	收货子仓
isCustomProduct	BOOLEAN	否	是否为定制品
pageSize	INTEGER	是	每页记录数不能为空
purchaseStockType	INTEGER	否	备货类型 0-普通备货 1-jit备货
inventoryRegion	LIST	否	DOMESTIC(1, "国内备货"), OVERSEAS(2, "海外备货"), BOUNDED_WAREHOUSE(3, "保税仓备货"),
$item	INTEGER	否	-
isJit	BOOLEAN	否	是否是jit，true:jit
pageNo	INTEGER	是	页号， 从1开始
isFirstOrder	BOOLEAN	否	是否首单
subPurchaseOrderSnList	LIST	否	子采购单号列表
$item	STRING	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	-
list	LIST	-
$item	OBJECT	-
orderDetailVOList	LIST	子订单详情信息
$item	OBJECT	-
productSkuId	INTEGER	货品skuId
productSkuImgUrlList	LIST	货品SKU图片URL列表
$item	STRING	-
color	STRING	颜色
size	STRING	尺码
skuDeliveryQuantityMaxLimit	INTEGER	发货数量限制最大值
productOriginalSkuId	INTEGER	原始skuId
productSkuPurchaseQuantity	INTEGER	货品sku下单数量
subPurchaseOrderBasicVO	OBJECT	子订单基本信息
supplierId	INTEGER	供应商id
isCustomProduct	BOOLEAN	是否为定制品
expectLatestArrivalTimeOrDefault	INTEGER	要求最晚到达时间带默认值（时间戳 单位：毫秒）
productSkcPicture	STRING	货品图片
productName	STRING	商品名
isFirst	BOOLEAN	是否首单
purchaseStockType	INTEGER	备货类型 0-普通备货 1-jit备货
deliverUpcomingDelayTimeMillis	INTEGER	剩余发货时间不足XX，则统计为即将逾期，前端展示标红 单位：毫秒 默认12 * 3600 * 1000
isClothCategory	BOOLEAN	是否服饰类目
productSkcId	INTEGER	skcId
settlementType	INTEGER	结算类型 0-非vmi 1-vmi
skcExtCode	STRING	货号
deliverDisplayCountdownMillis	INTEGER	剩余发货时间不足XX，则前端开始读秒 单位：毫秒 默认1小时
urgencyType	INTEGER	是否是紧急发货单，0-普通 1-急采
subWarehouseId	INTEGER	子仓id
productInventoryRegion	INTEGER	备货类型
expectLatestDeliverTimeOrDefault	INTEGER	要求最晚发货时间带默认值（时间戳 单位：毫秒）
receiveAddressInfo	OBJECT	收货仓详细地址
districtCode	INTEGER	区编码
cityName	STRING	市
districtName	STRING	区
provinceCode	INTEGER	省份编码
cityCode	INTEGER	市编码
detailAddress	STRING	详细地址
provinceName	STRING	省
arrivalUpcomingDelayTimeMillis	INTEGER	剩余到货时间不足XX，则统计为即将逾期，前端展示标红 单位：毫秒 默认6 * 3600 * 1000
autoRemoveFromDeliveryPlatformTime	INTEGER	自动移出发货台倒计时时间,毫秒
arrivalDisplayCountdownMillis	INTEGER	剩余到货时间不足XX，则前端开始读秒 单位：毫秒 默认1小时
fragileTag	BOOLEAN	易碎品打标
purchaseQuantity	INTEGER	下单数量
subWarehouseName	STRING	子仓名称
subPurchaseOrderSn	STRING	采购子单号
purchaseTime	INTEGER	下单时间：毫秒
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
暂无数据
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.shiporderv3.create

bg.shiporderv3.create
创建发货单接口v3
更新时间：2025-03-21 20:04:29
接口介绍：当前openapi为老发货流程，需要支持创建发货单、物流下单分步操作
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
deliveryOrderCreateGroupList	LIST	是	发货单创建组列表
$item	OBJECT	否	-
subWarehouseId	INTEGER	是	子仓id
deliveryOrderCreateInfos	LIST	是	采购单创建信息列表
$item	OBJECT	否	-
deliveryAddressId	INTEGER	否	发货地址ID 待灰度key_cn_BG_137831全量后 该字段不能为空
deliverOrderDetailInfos	LIST	是	发货单详情列表
$item	OBJECT	否	-
productSkuId	INTEGER	是	skuId
deliverSkuNum	INTEGER	是	发货sku数目
packageInfos	LIST	是	包裹信息列表
$item	OBJECT	否	-
packageDetailSaveInfos	LIST	是	包裹明细
$item	OBJECT	否	-
productSkuId	INTEGER	是	skuId
skuNum	INTEGER	是	发货sku数目
subPurchaseOrderSn	STRING	是	采购子单号
receiveAddressInfo	OBJECT	是	收货地址
districtCode	INTEGER	否	区编码
cityName	STRING	否	市
districtName	STRING	否	区
phone	STRING	否	联系电话
provinceCode	INTEGER	否	省份编码
cityCode	INTEGER	否	市编码
receiverName	STRING	否	收货人
detailAddress	STRING	否	详细地址
provinceName	STRING	否	省
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
cancelUrgencyTypeSubPurchaseOrderSnList	LIST	取消急采标的采购单列表
$item	STRING	-
deliveryOrders	LIST	创建成功的发货单列表
$item	STRING	-
isUrgencyType	BOOLEAN	是否是急采
cancelUrgencyType	BOOLEAN	是否有取消急采标
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
暂无数据
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.shiporder.staging.add

bg.shiporder.staging.add
加入发货台接口
更新时间：2025-11-02 21:29:29
接口介绍：加入发货台接口
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
joinInfoList	LIST	否	要加入发货台的备货单信息列表
$item	OBJECT	否	-
deliveryAddressType	INTEGER	是	发货地址类型 1-内地(废弃) 2-香港 3-内地保税区 4-内地非保税区
subPurchaseOrderSn	STRING	是	备货子单号
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
existJoinErrorSubPurchase	BOOLEAN	是否存在加入发货台失败的发货单
joinErrorList	LIST	加入发货台失败的备货单明细列表
$item	OBJECT	-
joinErrorSubPurchaseOrderSn	STRING	加入发货台失败的发货单号
extraInfoMap	MAP	附加信息字段
$key	STRING	-
$value	STRING	-
errorCode	INTEGER	错误码
errorMsg	STRING	错误信息
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
暂无数据
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.shiporder.cancel

bg.shiporder.cancel
发货单取消
更新时间：2025-03-21 20:04:37
接口介绍：发货单取消
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
deliveryOrderSn	STRING	是	发货单号
返回参数说明
收起
参数接口	参数类型	说明
result	LIST	result
$item	STRING	-
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
暂无数据
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.shiporderv2.get

bg.shiporderv2.get
查询发货单v2
更新时间：2025-11-02 21:29:11
接口介绍：按批次查询对应发货单信息
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
productSkcIdList	LIST	否	skcId列表
$item	INTEGER	否	-
isCustomProduct	BOOLEAN	否	是否为定制品 false-非定制品 true-定制品
pageSize	INTEGER	是	每页记录数不能为空
expressDeliverySnList	LIST	否	快递单号列表
$item	STRING	否	-
expressWeightFeedbackStatus	LIST	否	运单计费重量异常状态 1-异常待确认 2-已提交异常反馈，待物流商处理 3-物流商处理完成 4-平台介入处理中 5-平台处理完成. 可选值含义说明:[0:未定义（数据库默认值）或无异常;1:异常待确认;2:已提交异常反馈，待物流商处理;3:物流商处理完成;4:平台介入处理中;5:平台处理完成;6:卖家已确认;7:卖家超期自动确认;8:物流商介入处理，卖家确认或超时自动确认;9:结算消息驱动卖家确认;10:无需公示;11:结算物流单计算重量查询失败;12:结算理论计费重拦截;13:SKU重量体积拦截;]
$item	INTEGER	否	-
pageNo	INTEGER	是	页号， 从1开始
isPrintBoxMark	INTEGER	否	是否已打印商品打包标签 0-未打印 1-已打印
targetDeliveryAddress	STRING	否	筛选项-发货地址（精准匹配）
onlyTaxWarehouseWaitApply	BOOLEAN	否	仅查看保税仓资料待上传
subWarehouseIdList	LIST	否	收货子仓列表
$item	INTEGER	否	-
subPurchaseOrderSnList	LIST	否	子采购单号列表
$item	STRING	否	-
latestFeedbackStatusList	LIST	否	最新反馈状态列表 0-当前无异常 1-已提交 2-物流商处理中 4-已反馈 3-已撤销
$item	INTEGER	否	-
urgencyType	INTEGER	否	是否是紧急发货单，0-普通 1-急采
targetReceiveAddress	STRING	否	筛选项-收货地址（精准匹配）
deliverTimeFrom	INTEGER	否	发货时间-开始时间
skcExtCodeList	LIST	否	货号列表
$item	STRING	否	-
deliveryOrderSnList	LIST	否	发货单号列表
$item	STRING	否	-
inventoryRegion	LIST	否	备货区域 1-国内备货，2-海外备货，3-保税仓备货
$item	INTEGER	否	-
deliverTimeTo	INTEGER	否	发货时间-结束时间
isVmi	INTEGER	否	是否是vmi 0-非VMI 1-VMI
sortType	INTEGER	否	排序类型 0-创建时间最新在上 1-要求发货时间较早在上 2-按照仓库名称排序
isJit	BOOLEAN	否	是否是jit，true:jit
sortFieldName	STRING	否	排序字段名
status	INTEGER	否	发货单状态 查询发货批次时仅支持查询发货单状态=1
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	-
list	LIST	-
$item	OBJECT	-
receiveSkcNum	INTEGER	实收skc数目
expressPackageNum	INTEGER	交接给快递公司的包裹数量
latestFeedbackStatus	INTEGER	物流异常反馈最新反馈状态
expectLatestPickTime	INTEGER	要求最晚揽收时间
expressDeliverySn	STRING	快递单号
deliveryOrderCancelLeftTime	INTEGER	发货单超时取消剩余时间,单位毫秒. 只针对非加急发货单,加急发货单(urgencyType=1)该字段为null
deliveryAddressId	INTEGER	发货地址id
expressWeightFeedbackStatus	INTEGER	运单计费重量异常状态. 可选值含义说明:[0:未定义（数据库默认值）或无异常;1:异常待确认;2:已提交异常反馈，待物流商处理;3:物流商处理完成;4:平台介入处理中;5:平台处理完成;6:卖家已确认;7:卖家超期自动确认;8:物流商介入处理，卖家确认或超时自动确认;9:结算消息驱动卖家确认;10:无需公示;11:结算物流单计算重量查询失败;12:结算理论计费重拦截;13:SKU重量体积拦截;]
expressRejectStatus	INTEGER	物流单拒收状态 0-无拒收信息 1-存在拒收，待物流商处理 2-存在拒收，物流商已处理. 可选值含义说明:[0:无拒收信息;1:存在拒收，待物流商处理;2:存在拒收，物流商已处理;]
packageReceiveInfoVOList	LIST	包裹收货信息（包裹收货时间）
$item	OBJECT	-
receiveTime	INTEGER	收货时间
packageSn	STRING	包裹号
taxWarehouseApplyOperateType	INTEGER	入保税仓申请操作类型 0-不可操作 1-可申请 2-可查看
productSkcId	INTEGER	skcId
skcExtCode	STRING	skc货号信息
inboundTime	INTEGER	发货单入库时间
subWarehouseId	INTEGER	子仓id
packageList	LIST	包裹列表
$item	OBJECT	-
skcNum	INTEGER	skc数量
packageSn	STRING	包裹号
inventoryRegion	INTEGER	备货区域 1-国内备货，2-海外备货，3-保税仓备货
deliverPackageNum	INTEGER	实发包裹数
subPurchaseOrderSn	STRING	采购子单号
driverName	STRING	司机姓名
expressCompanyId	INTEGER	快递公司id
defectiveSkcNum	INTEGER	次品skc数目
status	INTEGER	状态
expectPickUpGoodsTime	INTEGER	预约取货时间
predictTotalPackageWeight	INTEGER	预估总包裹重量，单位g
supplierId	INTEGER	供应商id
isDisplayCourier	BOOLEAN	是否可以展示快递小哥联系方式，部分快递未接入
deliveryMethod	INTEGER	发货方式. 可选值含义说明:[0:无;1:自送;2:公司指定物流;3:第三方物流;]
isCustomProduct	BOOLEAN	是否为定制品 false-非定制品 true-定制品
expressWeightFeedbackTip	STRING	运单计费重量异常提示文案 运单重量异常，待确认 || 物流商已回复重量异常，待确认. 可选值含义说明:[0:未定义（数据库默认值）或无异常;1:异常待确认;2:已提交异常反馈，待物流商处理;3:物流商处理完成;4:平台介入处理中;5:平台处理完成;6:卖家已确认;7:卖家超期自动确认;8:物流商介入处理，卖家确认或超时自动确认;9:结算消息驱动卖家确认;10:无需公示;11:结算物流单计算重量查询失败;12:结算理论计费重拦截;13:SKU重量体积拦截;]
exceptionFeedBackTotalCount	INTEGER	异常反馈总记录数
otherDeliveryPackageNum	INTEGER	其他发货单的包裹数目
purchaseStockType	INTEGER	备货类型 0-普通备货 1-jit备货
ifCanOperateDeliver	BOOLEAN	是否可以操作发货
receivePackageNum	INTEGER	实收包裹数
isPrintBoxMark	BOOLEAN	是否打印箱唛
expressCompany	STRING	快递公司名称
isClothCategory	BOOLEAN	是否服饰类目
deliveryOrderSn	STRING	发货单号
deliverTime	INTEGER	发货单发货时间
urgencyType	INTEGER	是否是紧急发货单，0-普通 1-急采
expressBatchSn	STRING	发货批次号
receiveAddressInfo	OBJECT	收货仓详细地址
districtCode	INTEGER	区编码
cityName	STRING	市
districtName	STRING	区
phone	STRING	联系电话
provinceCode	INTEGER	省份编码
cityCode	INTEGER	市编码
receiverName	STRING	收货人
detailAddress	STRING	详细地址
provinceName	STRING	省
plateNumber	STRING	车牌号
receiveTime	INTEGER	发货单收货时间
packageDetailList	LIST	包裹详情列表
$item	OBJECT	-
productSkuId	INTEGER	skuId
productOriginalSkuId	INTEGER	原skuId
personalText	STRING	定制内容
skuNum	INTEGER	sku数量
subPurchaseOrderBasicVO	OBJECT	采购单信息
supplierId	INTEGER	供应商id
isCustomProduct	BOOLEAN	是否为定制品
productSkcPicture	STRING	货品图片
isFirst	BOOLEAN	是否首单
purchaseStockType	INTEGER	备货类型 0-普通备货 1-jit备货
isClothCategory	BOOLEAN	是否服饰类目
productSkcId	INTEGER	skcId
settlementType	INTEGER	结算类型 0-非vmi 1-vmi
skcExtCode	STRING	货号
urgencyType	INTEGER	是否是紧急发货单，0-普通 1-急采
subWarehouseId	INTEGER	子仓id
fragileTag	BOOLEAN	易碎品打标
purchaseQuantity	INTEGER	下单数量
subWarehouseName	STRING	子仓名称
subPurchaseOrderSn	STRING	采购子单号
purchaseTime	INTEGER	下单时间：毫秒
subWarehouseName	STRING	子仓名称
purchaseTime	INTEGER	下单时间（时间戳：毫秒）
skcPurchaseNum	INTEGER	下单数量
deliverSkcNum	INTEGER	实发skc数目
deliveryOrderCreateTime	INTEGER	发货单创建时间
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
暂无数据
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.mall.address.add

bg.mall.address.add
卖家发货地址创建
更新时间：2025-03-21 20:04:34
接口介绍：卖家发货地址创建
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
townName	STRING	否	城镇
districtCode	INTEGER	是	区编码
districtName	STRING	是	区
townCode	INTEGER	否	城镇编码
provinceCode	INTEGER	是	省份编码
cityCode	INTEGER	是	市编码
contactPersonPhoneAreaNo	STRING	否	联系人电话区号
warehouseAreaType	INTEGER	是	仓库面积类型
contactPersonPhone	STRING	是	联系人电话
addressLabel	STRING	是	地址标签
contactPersonName	STRING	是	联系人
addressDetail	STRING	是	详细地址
cityName	STRING	是	市
warehouseType	INTEGER	是	仓库类型
provinceName	STRING	是	省
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
addressId	INTEGER	创建的地址ID
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
暂无数据
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.mall.address.get

bg.mall.address.get
卖家地址查询
更新时间：2025-01-09 23:28:31
接口介绍：-
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
暂无数据
返回参数说明
收起
参数接口	参数类型	说明
result	LIST	-
$item	OBJECT	-
isDefault	BOOLEAN	-
districtCode	INTEGER	-
addressDetail	STRING	-
cityName	STRING	-
districtName	STRING	-
mallId	INTEGER	-
provinceCode	INTEGER	-
cityCode	INTEGER	-
id	INTEGER	-
provinceName	STRING	-
addressLabel	STRING	-
success	BOOLEAN	-
errorCode	INTEGER	-
errorMsg	STRING	-
返回错误码说明
收起
错误码	错误描述	解决办法
暂无数据
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
独立站高级接口	He uses type、Self use type
寄样API组	He uses type、Self use type


---

## bg.logistics.company.get

bg.logistics.company.get
快递公司查询
更新时间：2026-05-20 17:12:37
接口介绍：快递公司查询
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
partner	STRING	否	业务方编码
dataDigest	STRING	否	信息摘要
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
shipList	LIST	ship list
$item	OBJECT	-
shipName	STRING	快递名称
shipId	INTEGER	快递ID
success	BOOLEAN	status
errorCode	STRING	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
400000000	SYSTEM EXCEPTION	SYSTEM EXCEPTION
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
独立站高级接口	He uses type、Self use type
寄样API组	He uses type、Self use type


---

## bg.shiporder.packing.send

bg.shiporder.packing.send
装箱发货接口
更新时间：2025-11-20 17:02:00
接口介绍：物流下单接口
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
deliveryAddressId	INTEGER	是	发货地址id
thirdPartyExpressDeliveryInfoVO	OBJECT	否	第三方配送
expressPackageNum	INTEGER	否	发货总箱数
expressCompanyId	INTEGER	是	快递公司Id
expressDeliverySn	STRING	是	快递单号
expressCompanyName	STRING	是	快递公司名称
deliveryOrderSnList	LIST	是	发货单号
$item	STRING	否	-
predictPackageVolume	STRING	否	预估包裹总体积(立方米)
thirdPartyDeliveryInfo	OBJECT	否	公司指定物流
expectPickUpGoodsTime	INTEGER	否	预约取货时间
predictTotalPackageWeight	INTEGER	否	预估总包裹重量不能为空,单位克.总量必须大于等于1千克且为整千克值
expressPackageNum	INTEGER	否	交接给快递公司的包裹数
pickupMethod	INTEGER	否	揽收方式 : 0代表默认 1代表自送
selfDeliverSitePhone	STRING	否	自送网点电话(使用平台推荐的自送物流商时必传)
selfDeliverSiteAddress	STRING	否	自送网点地址(使用平台推荐的自送物流商时必传)
selfDeliverSiteUserCode	STRING	否	自送网点用户编码
expressDeliverySn	STRING	否	快递单号
expressCompanyName	STRING	否	快递公司名称
predictId	INTEGER	否	预测ID
selfDeliverSiteCompanyCode	STRING	否	自送网点公司编码
standbyExpress	BOOLEAN	否	是否是备用快递公司
expressCompanyId	INTEGER	否	快递公司Id
deliverMethod	INTEGER	是	发货方式
selfDeliveryInfo	OBJECT	否	自送信息
expressPackageNum	INTEGER	否	发货总箱数
deliveryContactNumber	STRING	否	电话号码
driverUid	INTEGER	否	司机uid
driverRecordId	INTEGER	否	商家发退货司机信息记录ID
driverName	STRING	是	司机姓名
plateNumber	STRING	是	车牌号
deliveryContactAreaNo	STRING	否	电话区号
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
expressBatchSn	STRING	创建生成的发货批次号
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
暂无数据
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.shiporder.packing.match

bg.shiporder.packing.match
装箱发货校验
更新时间：2025-03-21 20:04:29
接口介绍：物流发货前置校验是否满足发货条件
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
deliveryOrderSnList	LIST	是	发货单号
$item	STRING	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
shouldAddDeliveryOrderInfoList	LIST	需要勾选的相同发货地址的发货单列表（最多展示50个）
$item	OBJECT	-
supplierId	INTEGER	供应商id
deliveryOrderSn	STRING	发货单号
deliveryOrderSnNotPrintBox	LIST	未打印打包标签的发货单列表
$item	STRING	-
skuSumWeight	INTEGER	勾选的发货单对应SKU总重量（商品货品侧SKU重） 单位克
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
暂无数据
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.shiporder.package.get

bg.shiporder.package.get
发货包裹查询
更新时间：2025-03-21 20:04:29
接口介绍：用以支持商家创建发货单之后查询发货单对应的包裹信息
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
deliveryOrderSn	STRING	是	发货单号
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
packageInfo	LIST	包裹信息
$item	OBJECT	-
packageDetails	LIST	包裹明细
$item	OBJECT	-
productSkuId	INTEGER	skuId
productOriginalSkuId	INTEGER	原skuId
personalText	STRING	定制内容
skuNum	INTEGER	sku数量
skcNum	INTEGER	skc数量
packageSn	STRING	包裹号
productSkcId	INTEGER	skcId
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
暂无数据
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.shiporder.package.edit

bg.shiporder.package.edit
发货包裹编辑
更新时间：2025-03-21 20:04:29
接口介绍：用以支持商家创建发货单之后调整对应发货单的包裹信息
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
deliverOrderDetailInfos	LIST	是	发货单详情列表
$item	OBJECT	否	-
productSkuId	INTEGER	是	skuId
deliverSkuNum	INTEGER	是	发货sku数目
packageInfos	LIST	是	包裹信息列表
$item	OBJECT	否	-
packageDetailSaveInfos	LIST	是	包裹明细
$item	OBJECT	否	-
productSkuId	INTEGER	是	skuId
skuNum	INTEGER	是	发货sku数目
deliveryOrderSn	STRING	是	发货单号
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
暂无数据
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.shiporder.receiveaddressv2.get

bg.shiporder.receiveaddressv2.get
大仓收货地址查询v2
更新时间：2025-03-21 20:04:29
接口介绍：供应商创建发货单时需要先获取大仓收货地址信息
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
subPurchaseOrderSnList	LIST	是	子采购单号列表
$item	STRING	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
subPurchaseReceiveAddressGroups	LIST	子采购单收货地址分组信息列表
$item	OBJECT	-
subWarehouseId	INTEGER	子仓id
receiveAddressInfo	OBJECT	收货地址信息
districtCode	INTEGER	区编码
cityName	STRING	市
districtName	STRING	区
phone	STRING	联系电话
provinceCode	INTEGER	省份编码
cityCode	INTEGER	市编码
receiverName	STRING	收货人
detailAddress	STRING	详细地址
provinceName	STRING	省
subPurchaseOrderSnList	LIST	子采购单号列表
$item	STRING	-
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
暂无数据
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.shiporder.logisticsorder.match

bg.shiporder.logisticsorder.match
物流单号与可用物流公司校验
更新时间：2025-03-21 20:04:29
接口介绍：当发货方式为自行委托第三方物流时，商家录入物流单号后需要提供接口校验所选择的物流公司是否匹配
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
shippingId	INTEGER	否	物流公司id
expressNo	STRING	否	物流单号
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
checkResultMsg	STRING	-
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
暂无数据
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.shiporder.logistics.get

bg.shiporder.logistics.get
自行委托三方物流公司查询接口
更新时间：2025-03-21 20:04:29
接口介绍：当发货方式为自行委托第三方物流时需要提供接口给到商家查询可用的物流公司名单
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
暂无数据
返回参数说明
收起
参数接口	参数类型	说明
result	LIST	result
$item	OBJECT	-
expressCompanyId	INTEGER	快递公司Id
expressCompanyName	STRING	快递公司名称
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
暂无数据
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.shiporder.logistics.change

bg.shiporder.logistics.change
修改物流接口
更新时间：2025-11-02 21:29:11
接口介绍：修改发货单物流信息
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
thirdPartyExpressDeliveryInfoVO	OBJECT	否	第三方配送
expressPackageNum	INTEGER	否	发货总箱数
expressCompanyId	INTEGER	是	快递公司Id
expressDeliverySn	STRING	是	快递单号
expressCompanyName	STRING	是	快递公司名称
deliveryAddressId	INTEGER	是	发货地址id
predictPackageVolume	STRING	否	预估包裹总体积(立方米)
thirdPartyDeliveryInfo	OBJECT	否	公司指定物流
expectPickUpGoodsTime	INTEGER	否	预约取货时间
predictTotalPackageWeight	INTEGER	否	预估总包裹重量不能为空,单位克.总量必须大于等于1千克且为整千克值
expressPackageNum	INTEGER	否	交接给快递公司的包裹数
pickupMethod	INTEGER	否	揽收方式 : 0代表默认 1代表自送
tmsChannelId	INTEGER	否	TMS快递产品类型ID
selfDeliverSitePhone	STRING	否	自送网点电话(使用平台推荐的自送物流商时必传)
selfDeliverSiteAddress	STRING	否	自送网点地址(使用平台推荐的自送物流商时必传)
selfDeliverSiteUserCode	STRING	否	自送网点用户编码
expressDeliverySn	STRING	否	快递单号
expressCompanyName	STRING	否	快递公司名称
predictId	INTEGER	否	预测ID
selfDeliverSiteCompanyCode	STRING	否	自送网点公司编码
standbyExpress	BOOLEAN	否	是否是备用快递公司
expressCompanyId	INTEGER	否	快递公司Id
deliverMethod	INTEGER	是	发货方式
selfDeliveryInfo	OBJECT	否	自送信息
expressPackageNum	INTEGER	否	发货总箱数
deliveryContactNumber	STRING	否	电话号码
driverUid	INTEGER	否	司机uid
driverRecordId	INTEGER	否	商家发退货司机信息记录ID
driverName	STRING	是	司机姓名
plateNumber	STRING	是	车牌号
deliveryContactAreaNo	STRING	否	电话区号
expressBatchSn	STRING	是	发货批次
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
expressBatchSn	STRING	创建生成的发货批次号
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
暂无数据
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.purchaseorderv2.get

bg.purchaseorderv2.get
采购单查询v2
更新时间：2025-03-19 21:55:09
接口介绍：查询卖家的备货单列表
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
purchaseTimeTo	INTEGER	否	下单时间-结束：毫秒
originalPurchaseOrderSnList	LIST	否	母订单号列表
$item	STRING	否	-
deliverOrArrivalDelayStatusList	LIST	否	发货或者到货逾期状态 101-发货即将逾期，102-发货已逾期，201-到货即将逾期，202-到货已逾期
$item	INTEGER	否	-
pageSize	INTEGER	是	每页记录数,范围[1,500]
isSystemAutoPurchaseSource	BOOLEAN	否	是否系统下单 是-系统自动下单 否-其他
isFirst	BOOLEAN	否	是否首单 0-否 1-是
pageNo	INTEGER	是	页号， 从1开始
customizationType	INTEGER	否	定制类型,0-文字，1-图片. 可选值含义说明:[0:文字;1:图片;]
isCloseJit	BOOLEAN	否	是否JIT转备货
productSnList	LIST	否	货号列表
$item	STRING	否	-
expectLatestDeliverTimeTo	INTEGER	否	要求最晚发货时间-结束（时间戳 单位：毫秒）
supplierIdList	LIST	否	店铺id列表
$item	INTEGER	否	-
qcOption	INTEGER	否	是否存在质检不合格的sku，10-是，20-否
productSkcIdList	LIST	否	skc列表
$item	INTEGER	否	-
expectLatestArrivalTimeFrom	INTEGER	否	要求最晚到达时间-开始（时间戳 单位：毫秒）
isDelayArrival	BOOLEAN	否	是否延迟到货
lackOrSoldOutTagList	LIST	否	标签：1-含缺货SKU；2-含售罄SKU
$item	INTEGER	否	-
qcReject	INTEGER	否	创单时是否存在质检不合格sku，0-不存在 1-存在
purchaseStockType	INTEGER	否	是否是JIT备货， 0-普通，1-JIT备货
isDelayDeliver	BOOLEAN	否	是否延迟发货
warehouseGroupIdList	LIST	否	备货仓组列表
$item	INTEGER	否	-
subPurchaseOrderSnList	LIST	否	订单号（采购子单号）
$item	STRING	否	-
productLabelCodeStyle	INTEGER	否	筛选的商品条码样式，0-全选，1-旧样式，2-新样式
skuLackSnapshot	INTEGER	否	创单时是否存在缺货sku，0-不存在 1-存在
settlementType	INTEGER	否	结算类型 0-非vmi(采购) 1-vmi(备货)
supplierName	STRING	否	店铺名称
purchaseTimeFrom	INTEGER	否	下单时间-开始：毫秒
urgencyType	INTEGER	否	是否紧急 0-否 1-是
sourceList	LIST	否	下单来源，0-运营下单，1-卖家下单，9999-平台下单
$item	INTEGER	否	-
deliverOrderSnList	LIST	否	发货单号列表
$item	STRING	否	-
expectLatestDeliverTimeFrom	INTEGER	否	要求最晚发货时间-开始（时间戳 单位：毫秒）
todayCanDeliver	BOOLEAN	否	是否今日可发货
expectLatestArrivalTimeTo	INTEGER	否	要求最晚到达时间-结束（时间戳 单位：毫秒）
statusList	LIST	否	订单状态 0-待接单；1-已接单，待发货；2-已送货；3-已收货；4-已拒收；5-已验收，全部退回；6-已验收；7-已入库；8-作废；9-已超时
$item	INTEGER	否	-
isCustomGoods	BOOLEAN	否	是否为定制品
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	总数
subOrderForSupplierList	LIST	订单信息
$item	OBJECT	-
originalPurchaseOrderSn	STRING	母订单号（原始采购母单号）
source	INTEGER	下单来源；0-运营，1-供应商，2-系统, 3-excel上传, 4-系统规则
productName	STRING	货品名称
fulfilmentFormStatus	INTEGER	关联履约函状态，0-待确认，1-已确认，2-已拒绝，3-已取消
isFirst	BOOLEAN	是否首单
skuQuantityDetailList	LIST	sku维度数量信息-非定制品
$item	OBJECT	-
currencyType	STRING	货币类型(参考 ISO 4217) CNY-人民币 USD-美元
processTypeVO	OBJECT	定制品工艺信息
processTypeDesc	STRING	工艺类型名称
firstProcessTypeDesc	STRING	一级工艺名称
secondProcessTypeDesc	LIST	二级工艺
$item	STRING	-
className	STRING	尺码名称
supportIncreaseNum	BOOLEAN	是否支持上浮
realReceiveAuthenticQuantity	INTEGER	入库数量
fulfilmentProductSkuId	INTEGER	履约货品skuId
customizationType	INTEGER	定制类型,0-文字，1-图片
productSkuId	INTEGER	productSkuId
deliverQuantity	INTEGER	已送货待收货数量
thumbUrlList	LIST	sku缩略图列表
$item	STRING	-
qcResult	INTEGER	质检结果，0-暂无结果，1-合格，2-不合格，3-无需质检，4-质检让步，5-重新上床视频，6-部分合格
extCode	STRING	sku货号
adviceQuantity	INTEGER	下单时建议量
purchaseUpLimit	INTEGER	下单上限（系统自动下单时按照规则设置）
purchaseQuantity	INTEGER	下单数量
deliverInfo	OBJECT	发货信息
receiveTime	INTEGER	收货时间（单位：毫秒）
deliverTime	INTEGER	发货时间（单位：毫秒）
receiveWarehouseId	INTEGER	实际收货仓库Id
receiveWarehouseName	STRING	实际收货仓库名称
expectLatestDeliverTimeOrDefault	INTEGER	要求最晚发货时间带默认值（时间戳 单位：毫秒）
expectLatestArrivalTimeOrDefault	INTEGER	要求最晚到达时间带默认值（时间戳 单位：毫秒）
deliveryOrderSn	STRING	发货单号
productSkcId	INTEGER	skcId
isCloseJit	BOOLEAN	是否JIT转备货
warehouseGroupId	INTEGER	备货仓组
productId	INTEGER	productId
hasQcBill	INTEGER	是否有质检报告，0-否，1-是
supplyStatus	INTEGER	供应状态 0-正常供货 1-暂时无货 2-停产
applyDeleteStatus	INTEGER	申请作废状态 0-未申请作废，1-作废审核中，2-作废审核通过, 3-作废审核不通过
skuQuantityTotalInfo	OBJECT	sku维度数量汇总信息
currencyType	STRING	货币类型(参考 ISO 4217) CNY-人民币 USD-美元
processTypeVO	OBJECT	定制品工艺信息
processTypeDesc	STRING	工艺类型名称
firstProcessTypeDesc	STRING	一级工艺名称
secondProcessTypeDesc	LIST	二级工艺
$item	STRING	-
className	STRING	尺码名称
supportIncreaseNum	BOOLEAN	是否支持上浮
realReceiveAuthenticQuantity	INTEGER	入库数量
customizationType	INTEGER	定制类型,0-文字，1-图片
productSkuId	INTEGER	productSkuId
deliverQuantity	INTEGER	已送货待收货数量
extCode	STRING	sku货号
adviceQuantity	INTEGER	下单时建议量
purchaseQuantity	INTEGER	下单数量
isCanJoinDeliverPlatform	BOOLEAN	是否可以加入发货台
categoryType	INTEGER	类目类型, 0-未分类、1-服饰
subPurchaseOrderSn	STRING	采购子单号
status	INTEGER	状态
supplierId	INTEGER	卖家id
isCustomProduct	BOOLEAN	是否定制品，0-否，1-是
appealStatus	INTEGER	申述状态，1000-审核中,1010-审核通过,1020-审核驳回
fulfilmentFormId	INTEGER	关联履约函id
productSkcPicture	STRING	货品图片
supportIncreaseNum	BOOLEAN	是否支持上浮
lackOrSoldOutTagList	LIST	是否含缺货或售罄sku
$item	OBJECT	-
isLack	BOOLEAN	是否缺货
skuDisplay	STRING	属性
soldOut	INTEGER	售罄状态
qcReject	INTEGER	创单时是否存在质检不合格sku，0-不存在 1-存在
purchaseStockType	INTEGER	是否是JIT备货， 0-普通，1-JIT备货
skuLackItemList	LIST	缺货sku列表
$item	OBJECT	-
skuDisplay	STRING	-
deliveryOrderSn	STRING	发货单号
skuLackSnapshot	INTEGER	创单时是否存在缺货sku，0-不存在 1-存在
supplierName	STRING	卖家名称
settlementType	INTEGER	结算类型 0-非vmi(采购) 1-vmi(备货)
productSn	STRING	货号
urgencyType	INTEGER	是否紧急，0-否，1-是
skuQcRejectItemList	LIST	质量隐患sku列表
$item	OBJECT	-
skuDisplay	STRING	-
expectLatestArrivalIntervalDays	INTEGER	预计最晚送达间隔天数
defectiveTime	INTEGER	退货时间（时间戳 单位：毫秒）
todayCanDeliver	BOOLEAN	是否今日可发货
purchaseTime	INTEGER	下单时间（时间戳：毫秒）
applyChangeSupplyStatus	INTEGER	申请变更供应状态的审批状态, 0-无需审核，1-审核中，2-审核通过，3-审核驳回，4-撤销
category	STRING	类目
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
2000000	业务异常，请稍后再试。	调用依赖接口有异常，一般短期内会恢复，建议稍后再试。
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
采购API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.purchaseorder.apply

bg.purchaseorder.apply
采购备货申请
更新时间：2025-03-19 21:55:27
接口介绍：卖家创建备货单
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
purchaseDetailList	LIST	是	sku下单量
$item	OBJECT	否	-
productSkuId	INTEGER	是	货品skuId
productSkuPurchaseQuantity	INTEGER	是	货品sku下单数量
expectLatestDeliverTime	INTEGER	否	要求最晚发货时间（时间戳 单位：毫秒）
productSkcId	INTEGER	是	skcId
expectLatestArrivalTime	INTEGER	否	要求最晚到达时间（时间戳 单位：毫秒）
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1001	核价未通过不支持(批量)备货	等核价通过才能操作备货。
1002	超过建议备货量	调整备货量，不要超过建议备货量。
1007	下单量不能为0	下单量不能为0
1008	货品SKU已下架	货品SKU已下架
1009	货品SKU不缺货	货品SKU不缺货
1011	货品SKU因核价限制备货	货品SKU因核价限制备货
2001	图片审核状态未通过不支持(批量)备货	图片审核状态未通过不支持(批量)备货
2002	库存被锁不支持(批量)备货	库存被锁不支持(批量)备货
2004	SKC下没有需要下单的SKU	SKC下没有需要下单的SKU
2008	按照返单规则，SKC下没有需要下单的SKU	按照返单规则，SKC下没有需要下单的SKU
2010	竞价失败SKC不支持备货	竞价失败SKC不支持备货
2016	货品SKC因核价限制备货	货品SKC因核价限制备货
4007	已申请退店，不支持下单	已申请退店，不支持下单
5005	该商品存在违规情形，不可加入发货台/不可申请备货	该商品存在违规情形，不可加入发货台/不可申请备货
61001	当日备货总额已超出上限值，下单失败	当日备货总额已超出上限值，下单失败
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
采购API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.shiporderv3.logisticsmatch.get

bg.shiporderv3.logisticsmatch.get
平台推荐物流商匹配接口V3
更新时间：2026-04-02 11:47:31
接口介绍：卖家发货-装箱发货-获取推荐物流承运商
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
deliveryAddressId	INTEGER	是	发货地址
predictTotalPackageWeight	INTEGER	是	预估总包裹重量，单位g
predictVolume	STRING	否	预估体积，立方米
urgencyType	INTEGER	否	是否是紧急发货单，0-普通 1-急采
subWarehouseId	INTEGER	是	收货子仓id
totalPackageNum	INTEGER	是	包裹件数
receiveAddressInfo	OBJECT	是	收货地址
districtCode	INTEGER	否	区编码
cityName	STRING	否	市
districtName	STRING	否	区
phone	STRING	否	联系电话
provinceCode	INTEGER	否	省份编码
cityCode	INTEGER	否	市编码
receiverName	STRING	否	收货人
detailAddress	STRING	否	详细地址
provinceName	STRING	否	省
deliveryOrderSns	LIST	是	发货单列表
$item	STRING	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
mostUsedExpressCompany	OBJECT	常用物流 可能为空
servicerCode	STRING	服务商编码
expressCompanyId	INTEGER	快递公司Id
canSaveChargeAmount	STRING	可节省费用 单位元
expressCompanyName	STRING	快递公司名称[后续迭代为服务商名称]
usePricePrivileges	BOOLEAN	是否使用供价侧权益
list	LIST	TMS平台推荐物流列表
$item	OBJECT	-
maxSupplierChargeAmount	STRING	最大预估商家承担运费（单位元）
advantageDescList	LIST	该物流相比常用物流的优势点 可能为空
$item	STRING	-
hasUsedThisLogistics	BOOLEAN	供应商是否使用过该物流
tmsPickupVOList	LIST	揽收信息列表
$item	OBJECT	-
selfDeliverSiteCompanyCode	STRING	自送网点公司编码
selfDeliverSitePhone	STRING	自送网点电话
selfDeliverSiteAddress	STRING	自送网点地址
selfDeliverSiteUserCode	STRING	自送网点用户编码
pickupMethod	INTEGER	揽收方式 : 0代表默认 1代表自送
carrierAttention	STRING	承运注意事项
expressCompanyName	STRING	快递公司名称
channelScheduleTimeList	LIST	可预约揽收时间
$item	OBJECT	-
bjDate	STRING	可预约日期 北京时间 格式yyyy-MM-dd
bjStartTime	STRING	可预约日期的时间起点 北京时间 格式HH:mm
bjEndTime	STRING	可预约日期的时间终点 北京时间 格式HH:mm
predictId	INTEGER	预测ID
promisedDeliveryHourTime	STRING	承诺送达时间
minSupplierChargeAmount	STRING	最小预估商家承担运费（单位元）
expressCompanyId	INTEGER	快递公司Id
courierTimeType	INTEGER	报价单预计时效类型:1-次日达，2-隔日达，99-其它
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
500000001	query recommend express company error, please try again later	please try again later
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type


---

## bg.purchaseorder.edit

bg.purchaseorder.edit
修改备货单下单数量
更新时间：2025-03-19 21:55:27
接口介绍：[B] BG-318905 【OPEN API】支持待创建备货单修改数量
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
purchaseDetailList	LIST	是	采购详情列表
$item	OBJECT	否	-
productSkuId	INTEGER	是	货品skuId
productSkuPurchaseQuantity	INTEGER	是	货品sku下单数量
subPurchaseOrderSn	STRING	是	采购子单号（订单号）
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
100000001	adjust purchase order info error	please check adjust config is correct.
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
采购API组	He uses type、Self use type
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.predict.volume.get

bg.predict.volume.get
获取预估体积
更新时间：2025-09-16 23:05:10
接口介绍：ERP在下发货单前调用该接口获取预估体积
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
deliveryOrderSnList	LIST	是	发货单号列表，数量在1-50之间
$item	STRING	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
predictVolume	STRING	预估体积，单位为立方米。部分场景下，无法提供预估体积，返回数据为空
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
500000002	获取预估体积失败，请稍后重试	获取预估体积失败，请稍后重试
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type


---

## bg.purchaseorder.cancel

bg.purchaseorder.cancel
批量取消待接单的备货单
更新时间：2025-03-19 21:55:27
接口介绍：批量取消待接单的备货单
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
subPurchaseOrderSnList	LIST	否	备货单号列表
$item	STRING	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
successInfoList	LIST	-
$item	OBJECT	-
errorInfoList	LIST	-
$item	OBJECT	-
extraInfoMap	MAP	附加信息字段
$key	STRING	-
$value	STRING	-
errorCode	INTEGER	错误码
id	STRING	id
errorMsg	STRING	错误信息
isSuccess	BOOLEAN	-
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
100000002	cancel purchase order info error	请检查备货单状态
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type
