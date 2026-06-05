# 寄样/质检/退货API组

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 7 个接口


---

## bg.refund.returnpackage.get

bg.refund.returnpackage.get
退货包裹查询接口
更新时间：2025-03-11 23:35:20
接口介绍：当前开平外部商家对接，需要查询发货至仓库，被退货的数据情况，确保自有库存数据准确
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
outboundTimeEnd	INTEGER	否	出库时间范围右区间
supplierId	INTEGER	是	商家id
pageSize	INTEGER	是	页面大小, 值范围：1~ 200
returnSupplierReason	STRING	否	退供原因
packageTimeStart	INTEGER	否	打包完成时间范围左区间
expressDeLiverySns	LIST	否	运单号
$item	STRING	否	-
purchaseSubOrderSns	LIST	否	订单号（对应采购子单号）
$item	STRING	否	-
returnHandOverType	INTEGER	否	退供类型枚举 0-自提,1-邮寄
pageNo	INTEGER	是	页码
payMethod	INTEGER	否	支付方式 1-寄付 2-到付
outboundTimeStart	INTEGER	否	出库时间范围左区间
packageTimeEnd	INTEGER	否	打包完成时间范围右区间
logisticsType	STRING	否	物流商类型
returnSupplierPackageNos	LIST	否	退供包裹号列表
$item	STRING	否	-
status	INTEGER	否	包裹状态(1-待提货,2-已出库)
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	数据总量
openReturnPackageDTOS	LIST	退供包裹数据
$item	OBJECT	-
purchaseSubOrderSn	STRING	订单号（对应采购子单号）
reason	STRING	备注
returnSupplierReasonDesc	STRING	退供原因描述
outboundTime	INTEGER	出库时间
expressDeLiverySn	STRING	运单号
returnSupplierPackageNo	STRING	退供包裹号
packageStatusDesc	STRING	退供包裹状态描述
logisticsTypeDesc	STRING	物流商描述
returnSupplierQuantity	INTEGER	退供数量
payMethodDesc	STRING	快递支付方式 1-寄付 2-到付
returnHandOverTypeDesc	STRING	退供方式描述
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
100000001	The number of queries exceeds 50000	reduce query page
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
退供API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.refund.returnpackagelist.get

bg.refund.returnpackagelist.get
退供包裹明细列表
更新时间：2025-03-11 23:35:20
接口介绍：当前开平外部商家对接，需要查询发货至仓库，被退货的数据情况，确保自有库存数据准确
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
purchaseSubOrderSns	LIST	否	订单号（对应采购子单号）
$item	STRING	否	-
productSkuIdList	LIST	否	sku列表
$item	INTEGER	否	-
outboundTimeEnd	INTEGER	是	出库时间范围右区间
supplierId	INTEGER	是	卖家id
pageNo	INTEGER	是	页码
outboundTimeStart	INTEGER	是	出库时间范围左区间
pageSize	INTEGER	是	页面大小, 值范围：1~ 200
returnSupplierPackageNos	LIST	否	退供包裹号
$item	STRING	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	总数
packageDetailDTOList	LIST	包裹详情列表
$item	OBJECT	-
productSkuId	INTEGER	SKU
outboundTime	INTEGER	出库时间
quantity	INTEGER	SKU件数
packageSn	STRING	退供包裹号
mainSaleSpec	STRING	主销售属性， e.g: key:颜色，value: 白色
productSpuId	INTEGER	SPU
remark	STRING	退供备注
orderTypeDesc	STRING	退供类型desc
purchaseSubOrderSn	STRING	采购子单号
secondarySaleSpec	STRING	次销售属性， e.g: key:尺寸，value: XL
thumbUrl	STRING	sku图片
productSkcId	INTEGER	SKC
reasonDesc	LIST	退供原因
$item	STRING	-
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
100000001	The number of queries exceeds 50000	reduce query page
100000003	Seller ID cannot be empty	check supplier is not empty
100000004	Participation time exceeds 31 day	check Participation time
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
退供API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.goods.qualityinspectiondetail.get

bg.goods.qualityinspectiondetail.get
质检结果详情查看
更新时间：2025-03-24 00:40:16
接口介绍：备货单质检详细信息，用于卖家跟进不合格质检备货单，优化生产
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
qcBillId	INTEGER	是	质检单id
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
historyVOS	LIST	质检历史 按时间倒序排序
$item	OBJECT	-
qcType	INTEGER	单据类型 1-质检单 2-稽查单 3-更正单
finishTime	STRING	完成时间
startTime	STRING	开始时间
qcBillNo	STRING	单号 可能是质检单,稽查单,更正单
qcResult	INTEGER	质检结果
qcDetail	OBJECT	质检详情
auditId	INTEGER	审核人id
qcType	INTEGER	单据类型
deliveryQcTime	INTEGER	送检时间
totalQuantity	INTEGER	发货单总数量
qcStatusV2	INTEGER	质检单号 v2
sizeDTOList	LIST	sku尺码表
$item	OBJECT	-
locationTypeName	STRING	部位名称
sizeName	STRING	尺码名称
maxQcSize	STRING	最大质检尺码
couldEdit	BOOLEAN	是否可编辑
locationType	INTEGER	部位类型
expectMaxSize	STRING	标准尺码最大值
expectMinSize	STRING	标准尺码最小值
minQcSize	STRING	最小质检尺码
id	INTEGER	-
expectQcQuantity	INTEGER	应检数
productSkcId	INTEGER	货品skcId
qcGroupName	STRING	质检组别名
qcBillNo	STRING	质检单号
qcOperatorName	STRING	质检人花名
qcEndTime	INTEGER	质检结束时间
defectiveQcQuantity	INTEGER	次品数
qcResult	INTEGER	质检结果
flawDTOList	LIST	疵点
$item	OBJECT	-
flawDesc	STRING	疵点类型
productSkuId	LIST	货品skuId
$item	INTEGER	-
attachments	LIST	疵点图
$item	STRING	-
flawType	INTEGER	疵点类型id
flawDegree	INTEGER	严重程度
remark	STRING	备注
flawNameDesc	STRING	疵点名称
flawDegreeDesc	STRING	疵点描述
flawNameId	INTEGER	疵点名称id
qcBillId	INTEGER	质检单id
auditTime	INTEGER	质检审核时间
receiptNo	STRING	收货单号
qcGroupId	INTEGER	质检组别id
qcStartTime	INTEGER	质检开始时间
auditName	STRING	审核人花名
skuDTOList	LIST	sku详情
$item	OBJECT	-
productSkuId	INTEGER	货品skuId
totalQuantity	INTEGER	发货数
sizeName	STRING	尺码名称
defectiveQcQuantity	INTEGER	次品数
expectQcQuantity	INTEGER	应检数
qcOperatorId	INTEGER	质检人id
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
质检API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.sample.send

bg.sample.send
寄样发货
更新时间：2025-03-10 21:47:32
接口介绍：寄样发货
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
needReturn	BOOLEAN	是	是否需要退样
notifySnList	LIST	是	通知单号
$item	STRING	否	-
expressCompany	STRING	否	快递公司
shipType	INTEGER	是	发货类型. 可选值含义说明:[1:快递;2:送货上门;]
expressCompanyId	INTEGER	否	快递公司id
expressSn	STRING	否	快递单号
addressId	INTEGER	是	地址ID
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
独立站高级接口	He uses type、Self use type
寄样API组	He uses type、Self use type


---

## bg.goods.qualityinspection.get

bg.goods.qualityinspection.get
质检列表查询
更新时间：2025-03-24 00:40:16
接口介绍：新增卖家中心直接结果查询接口，用于卖家跟进不合格质检备货单，优化生产
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
pageInfo	OBJECT	是	分页信息
pageNo	INTEGER	是	页码
pageSize	INTEGER	是	页容量
purchaseNo	LIST	否	采购单号
$item	STRING	否	-
skuQcResult	INTEGER	否	质检结果 1-合格 2-不合格
skuIdList	LIST	否	skuId
$item	INTEGER	否	-
qcResultUpdateTimeBegin	INTEGER	否	质检结果更新时间 ms 起始值
qcResultUpdateTimeEnd	INTEGER	否	质检结果更新时间 ms 结束值
skcIdList	LIST	否	skcId
$item	INTEGER	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	-
skuList	LIST	sku列表
$item	OBJECT	-
skuName	STRING	sku名称
qcResultUpdateTime	STRING	质检结果更新时间
productSkuId	INTEGER	skuId
qcBillId	INTEGER	质检子单id
catName	STRING	叶子类目名称
purchaseNo	STRING	采购单号
spuId	INTEGER	spuId
productSkcId	INTEGER	skcId
thumbUrl	STRING	sku缩略图
spec	STRING	规格
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
质检API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.refund.returnpackagedetail.get

bg.refund.returnpackagedetail.get
退货包裹详情查询
更新时间：2025-03-11 23:35:20
接口介绍：当前开平外部商家对接，需要查询发货至仓库，被退货的数据情况，确保自有库存数据准确
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
supplierId	INTEGER	是	商家id
returnSupplierPackageNo	STRING	是	包裹号
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
returnPackageInfos	LIST	-
$item	OBJECT	-
secondarySaleSpec	STRING	次销售属性， e.g: key:尺寸，value: XL
returnSupplierQuantity	INTEGER	退供数量
mainSaleSpec	STRING	主销售属性， e.g: key:颜色，value: 白色
thumbUrl	STRING	sku图片
productSkcId	INTEGER	SKC
returnSupplierPackageNo	STRING	包裹号
returnSupplierQuantity	INTEGER	退供数量
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
100000002	No operation permission	check supplierId
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
退供API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.sample.order.get

bg.sample.order.get
寄样单查询
更新时间：2025-03-10 21:47:32
接口介绍：寄样单查询
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
productSkuId	INTEGER	否	SKU
productCode	STRING	否	货品编码
statusList	LIST	否	状态列表
$item	INTEGER	否	-
productId	INTEGER	否	SPU
sampleSn	STRING	否	样品单号
notifySnList	LIST	否	寄样通知单号
$item	STRING	否	-
pageInfo	OBJECT	是	分页信息
pageNo	INTEGER	是	页容量
pageSize	INTEGER	是	页码
productSkcId	INTEGER	否	SKC
shipSn	STRING	否	寄样单号
expressSn	STRING	否	快递单号
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	总数
list	LIST	配置列表
$item	OBJECT	-
receivingUsername	STRING	收货人名
receivingDetailAddress	STRING	收货人详细地址
salesProperty	MAP	销售属性
$key	STRING	-
$value	STRING	-
shipTime	INTEGER	寄样日期
receivingProvinceCode	INTEGER	收货人省编号
receivingAreaCode	INTEGER	收货人区编号
sampleType	INTEGER	样品类型 1-大货样品
sampleStatus	INTEGER	样品状态. 可选值含义说明:[1:待寄送;2:已寄送;3:无货异常;4:包裹已签收;5:已退样;6:仓库已签收;11:非退样完成;]
productName	STRING	商品名称
receivingCity	STRING	收货人城市
receivingCityCode	INTEGER	收货人城市编号
returnReason	INTEGER	退样原因. 可选值含义说明:[1:质检不合格;2:核价不通过;]
expressCompany	STRING	快递公司
id	INTEGER	业务主键
productSkcId	INTEGER	SKC
shipSn	STRING	寄样单号
receivingPhone	STRING	收货人联系方式
supplierName	STRING	供应商名
image	STRING	货品图片
productSkuId	INTEGER	SKU
quantity	INTEGER	数量
productId	INTEGER	SPU
sampleSn	STRING	样品编号
notifyTime	INTEGER	通知时间
returnExpressSn	STRING	退货快递单号
receivingArea	STRING	收货人区
shipSampleQuantity	INTEGER	寄样单样品数量
buyerName	STRING	通知人名称
returnTime	INTEGER	退样时间
productCode	STRING	SKU货号
productSkcCode	STRING	SKC货号
shipType	INTEGER	发货方式. 可选值含义说明:[1:快递;2:送货上门;]
returnShipType	INTEGER	退货发货方式. 可选值含义说明:[1:快递;2:送货上门;]
returnExpressCompany	STRING	退货快递公司
notifySn	STRING	通知单号
expressSn	STRING	快递单号
receivingProvince	STRING	收货人省
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
独立站高级接口	He uses type、Self use type
寄样API组	He uses type、Self use type
