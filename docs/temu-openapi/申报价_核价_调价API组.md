# 申报价/核价/调价API组

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 8 个接口


---

## bg.goods.price.list.get

bg.goods.price.list.get
货品供货价查询
更新时间：2026-02-10 15:11:58
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
productSkuIds	LIST	是	货品sku ID
$item	INTEGER	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
productSkuSupplierPriceList	LIST	货品sku供货价列表
$item	OBJECT	-
currencyType	STRING	币种
productSkuId	INTEGER	货品sku ID
productId	INTEGER	货品ID
siteSupplierPrices	LIST	站点供货价列表，仅半托管有值
$item	OBJECT	-
priceReviewStatus	INTEGER	核价状态，存量品，或者灰度外可能为空
siteId	INTEGER	站点id
supplierPrice	INTEGER	供货价
productSkcId	INTEGER	货品skc ID
supplierPrice	INTEGER	供货价
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
货品供货价API组	He uses type、Self use type


---

## bg.price.review.confirm

bg.price.review.confirm
同意核价单建议价
更新时间：2025-07-31 11:27:39
接口介绍：同意核价单建议价
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
核价API组	He uses type、Self use type


---

## bg.semi.adjust.price.page.query

bg.semi.adjust.price.page.query
分页查询半托管调价单
更新时间：2025-03-20 20:03:46
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
skcId	LIST	否	货品skcId
$item	LONG	否	-
priceOrderSn	LIST	否	调价单号
$item	STRING	否	-
priceType	INTEGER	否	价格类型. 可选值含义说明:[0:日常价;1:活动价;]
pageSize	INTEGER	是	分页大小
source	INTEGER	否	申请来源 1-运营，2-供应商
trafficLowExpose	BOOLEAN	否	流量曝光不足
pageNo	INTEGER	是	页码
siteId	INTEGER	否	站点id
createdAtEnd	LONG	否	创建日期-结束
createdAtBegin	LONG	否	创建日期-开始
status	INTEGER	否	状态 0-待调价，1-待供应商确认，2-调价成功，3-调价失败
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
priceAdjustOrderList	LIST	-
$item	OBJECT	-
skcId	INTEGER	skc id
priceOrderSn	STRING	调价单号
priceType	INTEGER	价格类型. 可选值含义说明:[0:日常价;1:活动价;]
adjustReason	STRING	调价原因
source	STRING	来源
productName	STRING	货品名称
skuInfoList	LIST	sku信息
$item	OBJECT	-
productSkuId	INTEGER	sku id
price	INTEGER	原币种申报价格
spec	STRING	规格信息
newSupplyPrice	STRING	调价后申报价格
priceCurrency	STRING	供货币种
rejectReason	STRING	驳回原因
trafficLowExpose	BOOLEAN	流量曝光不足
siteNameList	LIST	半托管绑定站点名称列表
$item	STRING	-
status	INTEGER	调价单状态，0-待调价，1-待供应商确认，2-调价成功，3-调价失败
total	INTEGER	总数
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


---

## bg.full.adjust.price.batch.review

bg.full.adjust.price.batch.review
全托管批量确认调价单
更新时间：2025-03-27 20:36:48
接口介绍：支持大卖自研商家批量操作调价单
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
adjustList	LIST	否	调价列表
$item	OBJECT	否	-
result	INTEGER	是	审核结果 1-通过
priceOrderSn	STRING	是	调价单号
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
500000001	请求参数有误	核对接口入参是否正确
500000003	批量处理调价单失败	检查调价单状态
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
调价API组	He uses type、Self use type


---

## bg.price.review.reject

bg.price.review.reject
不同意核价单建议价（并给出新的申报价）
更新时间：2025-07-31 11:30:29
接口介绍：支持商家不同意全托管核价单建议价（并给出新的申报价）
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
productSkuId	INTEGER	是	skuId
price	STRING	是	价格 分
orderId	INTEGER	是	核价单id
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
核价API组	He uses type、Self use type


---

## bg.full.adjust.price.page.query

bg.full.adjust.price.page.query
分页查询全托管调价单
更新时间：2025-03-24 20:50:52
接口介绍：支持大卖自研商家查询调价单
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
skcId	LIST	否	skcid
$item	INTEGER	否	-
extCodeType	INTEGER	否	货号类型 1-skc货号 2-sku货号
priceOrderSn	LIST	否	调价单号
$item	STRING	否	-
priceType	INTEGER	否	价格类型, 0-日常价，1-活动价
filterProductSource	INTEGER	否	调价来源. 可选值含义说明:[1:超越爆款计划;2:绿通优先发货;3:其他;47:广告渠道补贴;]
pageSize	INTEGER	是	页容量, 1-100
source	INTEGER	否	申请来源 1-运营，2-供应商
productName	STRING	否	货品名称
supportPersonal	INTEGER	否	是否支持定制化商品，1的时候是定制,0 是查非定制，为空不做筛选
pageNo	INTEGER	是	页码，1-100
extCodes	LIST	否	货号列表
$item	STRING	否	-
createdAtEnd	INTEGER	否	创建日期-结束，精确到毫秒(13位)
status	INTEGER	是	状态 0-待调价，1-带供应商确认，2-调价成功，3-调价失败
createdAtBegin	INTEGER	否	创建日期-开始，精确到毫秒(13位)
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	总数
list	LIST	list
$item	OBJECT	-
skcId	INTEGER	skc id
skcExtCode	STRING	skc 货号
priceOrderSn	STRING	调价单号
productId	INTEGER	货品id
orderCreateTime	INTEGER	调价单创建时间
priceType	INTEGER	价格类型, 0-日常价；1-活动价
adjustReason	STRING	调价原因
source	STRING	来源
productName	STRING	货品名称
newSupplyPrice	STRING	调价后申报价格
priceCurrency	STRING	币种
skuInfoItemList	LIST	sku信息
$item	OBJECT	-
productSkuId	INTEGER	sku id
priceCurrency	STRING	币种
price	INTEGER	价格
skuExtCode	STRING	sku 货号
spec	STRING	规格信息
imageList	LIST	图片列表
$item	STRING	-
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
500000001	请求参数有误	核对接口入参是否正确
500000003	批量处理调价单失败	检查调价单状态
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
调价API组	He uses type、Self use type


---

## bg.semi.adjust.price.batch.review

bg.semi.adjust.price.batch.review
半托管批量确认/拒绝调价单
更新时间：2025-03-20 20:03:42
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
batchResult	INTEGER	是	批量提交的结果. 可选值含义说明:[1:通过;2:驳回;]
submitOrders	LIST	是	批量提交的所有调价单
$item	STRING	否	-
rejectReasons	MAP	否	拒绝原因, key=调价单号, value=原因
$key	STRING	否	调价单号
$value	STRING	否	拒绝原因
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
successOrders	LIST	提交成功的调价单
$item	STRING	-
failedOrders	MAP	提交失败的调价单
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

## bg.price.review.page.query

bg.price.review.page.query
分页查询核价单
更新时间：2025-07-31 11:28:46
接口介绍：支持商家查询核价单
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
total	INTEGER	总数
reviewSamplePriceList	LIST	核价单sku及建议价
$item	OBJECT	-
productSkuIdList	LIST	货品skuId
$item	INTEGER	-
priceCurrency	STRING	申报价格币种
supplyPrice	INTEGER	申报价格（分）
orderId	INTEGER	核价单id
suggestPriceCurrency	STRING	建议价格币种
suggestSupplyPrice	INTEGER	建议价格（分）
orderStatus	INTEGER	核价单的状态. 可选值含义说明:[0:待核价;1:待供应商确认;2:核价通过;3:核价驳回;4:废弃;5:价格同步中;]
siteIds	LIST	站点id
$item	INTEGER	-
canBargain	BOOLEAN	是否可重新报价
siteNameList	LIST	站点名称
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
核价API组	He uses type、Self use type
