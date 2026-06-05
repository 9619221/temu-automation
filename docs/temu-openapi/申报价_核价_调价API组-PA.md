# 申报价/核价/调价API组-PA

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 6 个接口


---

## bg.semi.adjust.price.batch.review.order

bg.semi.adjust.price.batch.review.order
半托管批量确认/拒绝调价单
更新时间：2025-06-12 17:23:08
接口介绍：商家通过开平接口处理调价单
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
batchResult	INTEGER	是	Batch Submission Result. Optional value description:[1:Passed;2:Rejected;]
submitOrders	LIST	是	All Price Adjustment Orders for Batch Submission
$item	STRING	否	-
rejectReasons	MAP	否	Rejection Reason, key=Price Adjustment Order Number, value=Reason
$key	STRING	否	-
$value	STRING	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
successOrders	LIST	Submitted Price Adjustment Form Successfully
$item	STRING	-
failedOrders	MAP	Failed Price Adjustment Submission
$key	STRING	-
$value	STRING	-
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
500000001	请求参数有误	核对接口入参是否正确
500000002	批量处理调价单失败	检查调价单状态
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
调价API组	He uses type、Self use type


---

## bg.semi.price.review.page.query.order

bg.semi.price.review.page.query.order
分页查询半托管核价单
更新时间：2025-06-12 17:23:08
接口介绍：商家通过开平接口分页查询半托管核价单
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
idLt	INTEGER	否	id范围查询最大值
pageNo	INTEGER	是	页码
orderStatusList	LIST	否	核价单状态列表. 可选值含义说明:[0:待核价;1:待供应商确认;2:核价通过;3:核价驳回;4:废弃;5:价格同步中;]
$item	INTEGER	否	-
idGt	INTEGER	否	id范围查询最小值
pageSize	INTEGER	是	分页大小
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	Total Count
reviewSamplePriceList	LIST	Quote Sheet SKU and Reference Price
$item	OBJECT	-
productSkuIdList	LIST	Product SKU ID
$item	INTEGER	-
priceCurrency	STRING	Declared Price Currency. Only returns a value when the quotation status is 0, 2, or 3
supplyPrice	INTEGER	Declared Price (cents). Only returns a value when the pricing status is 0, 2, or 3
orderId	INTEGER	Quotation Sheet ID
suggestPriceCurrency	STRING	Reference Price Currency
suggestSupplyPrice	INTEGER	Reference Price (in cents)
orderStatus	INTEGER	Quotation Status 0-Pending Quotation 1-Pending Supplier Confirmation 2-Quotation Approved 3-Quotation Rejected
siteIds	LIST	Site ID
$item	INTEGER	-
canBargain	BOOLEAN	Whether Requotation is Allowed
siteNameList	LIST	Site Name
$item	STRING	-
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
400000001	暂无权限查询	联系产品将店铺加灰度
400000002	仅支持半托管店铺查询	核验是否半托管店铺
400000003	页码不能超过X	页码超过限制
400000010	查询待确认核价单失败	可以重试或联系产品排查原因
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
核价API组	He uses type、Self use type


---

## bg.semi.price.review.reject.order

bg.semi.price.review.reject.order
半托管不同意核价单建议价（并给出新的申报价）
更新时间：2025-06-12 17:23:08
接口介绍：商家不同意半托管核价单建议价（并给出新的申报价）
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
bargainReasonList	LIST	否	重新报价原因列表
$item	OBJECT	否	-
componentList	LIST	是	原因列表，允许录入1~20条
$item	OBJECT	否	-
reason	STRING	是	具体原因
type	INTEGER	是	重新报价原因类型. 可选值含义说明:[0:材质;1:功能;2:其他;3:品类;4:外观;5:版型;6:图案;7:规格尺寸;8:品牌;]
externalLinkList	LIST	否	外部链接，最多录入5个链接
$item	STRING	否	-
priceItemList	LIST	否	-
$item	OBJECT	否	-
productSkuId	INTEGER	是	货品skuId
price	STRING	是	价格 分
orderId	INTEGER	是	核价单id
返回参数说明
收起
参数接口	参数类型	说明
result	BOOLEAN	result
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
400000001	暂无权限查询	联系产品将店铺加灰度
400000004	缺少mallId	核对入参店铺ID
400000005	核价单不存在	核验入参核价单ID
400000006	无对应核价扩展单	核验入参核价单ID
400000008	修改价格次数超过最大次数限制	不允许操作
400000010	查询待确认核价单失败	可以重试或联系产品排查原因
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
核价API组	He uses type、Self use type


---

## bg.glo.goods.price.list.get

bg.glo.goods.price.list.get
货品供货价查询
更新时间：2025-08-27 16:57:39
接口介绍：供应商批量查询货品sku的供货价
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
productSkuIds	LIST	是	Product SKU ID
$item	INTEGER	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
productSkuSupplierPriceList	LIST	Product SKU Supply Price List
$item	OBJECT	-
currencyType	STRING	Currency
productSkuId	INTEGER	Product SKU ID
productId	INTEGER	Product ID
siteSupplierPrices	LIST	Site Supply Price List, only has value for semi_managed merchant
$item	OBJECT	-
priceReviewStatus	INTEGER	Pricing Status, may be empty for existing products or outside of grey area
siteId	INTEGER	Site ID
supplierPrice	INTEGER	Supply Price
productSkcId	INTEGER	Product SKC ID
supplierPrice	INTEGER	Supply Price, this value is deprecated in semi_managed merchant scenario
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1000011	无权访问	找对接产品申请加白
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
价格API组	He uses type、Self use type
货品供货价API组	He uses type、Self use type


---

## bg.semi.price.review.confirm.order

bg.semi.price.review.confirm.order
半托管同意核价单建议价
更新时间：2025-06-12 17:23:08
接口介绍：商家同意半托管核价单建议价
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
orderId	INTEGER	是	核价单id
返回参数说明
收起
参数接口	参数类型	说明
result	BOOLEAN	result
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
400000001	暂无权限查询	联系产品将店铺加灰度
400000004	缺少mallId	核对入参店铺ID
400000005	核价单不存在	核验入参核价单ID
400000007	未查询到参考价格	核对核价单参考价格
400000010	查询待确认核价单失败	可以重试或联系产品排查原因
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
核价API组	He uses type、Self use type


---

## bg.semi.adjust.price.page.query.order

bg.semi.adjust.price.page.query.order
分页查询半托管调价单
更新时间：2025-06-12 17:23:08
接口介绍：商家通过开平接口查询调价单
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
skcId	LIST	否	Product SKC ID
$item	INTEGER	否	-
priceOrderSn	LIST	否	Price Adjustment Order Number
$item	STRING	否	-
priceType	INTEGER	否	Price Type. Optional value description:[0:Daily Price;1:Promotional Price;]
pageSize	INTEGER	是	Page Size
source	INTEGER	否	Application Source 1-Operation, 2-Supplier
trafficLowExpose	BOOLEAN	否	Insufficient Traffic Exposure
pageNo	INTEGER	是	Page Number
siteId	INTEGER	否	Site ID
createdAtEnd	INTEGER	否	Creation Date - End
createdAtBegin	INTEGER	否	Creation Date - Start
status	INTEGER	否	Status 0-Pending Pricing, 1-Pending Supplier Confirmation, 2-Pricing Successful, 3-Pricing Failed
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
priceAdjustOrderList	LIST	-
$item	OBJECT	-
skcId	INTEGER	skc id
priceOrderSn	STRING	Price Adjustment Order Number
priceType	INTEGER	Price Type. Optional value description:[0:Daily Price;1:Promotional Price;]
adjustReason	STRING	Price Adjustment Reason
source	STRING	Source
productName	STRING	Product Name
skuInfoList	LIST	SKU Information
$item	OBJECT	-
productSkuId	INTEGER	sku id
price	INTEGER	Original Currency Declaration Price
spec	STRING	Specification Information
newSupplyPrice	STRING	Reported Price After Price Adjustment
priceCurrency	STRING	Currency for Supply
rejectReason	STRING	Rejection Reason
trafficLowExpose	BOOLEAN	Insufficient Traffic Exposure
siteNameList	LIST	Semi-managed Merchant Bound Site Name List
$item	STRING	-
status	INTEGER	Price Adjustment Order Status, 0-Pending Pricing, 1-Pending Supplier Confirmation, 2-Price Adjustment Successful, 3-Price Adjustment Failed
total	INTEGER	Total Count
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
500000001	请求参数有误	核对接口入参是否正确
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
调价API组	He uses type、Self use type
