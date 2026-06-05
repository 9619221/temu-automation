# 全托广告API组-PA

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 9 个接口


---

## bg.glo.searchrec.ad.create

bg.glo.searchrec.ad.create
创建广告接口
更新时间：2026-03-20 21:27:15
接口介绍：External service provider calls to create ads
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
createAdReqs	LIST	是	-
$item	OBJECT	否	-
productId	INTEGER	否	货品ID
roasType	INTEGER	否	目标广告投资回报率类型。0代表推广，1代表全域
roas	INTEGER	是	目标广告投资回报率，按照实际值乘10000
budget	INTEGER	是	广告日预算金额，不限制则传-1
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	Specific information
successCreateProductNum	INTEGER	创建成功商品数量
createGoodsFailObjList	LIST	-
$item	OBJECT	-
reason	STRING	-
productId	INTEGER	-
goodsId	INTEGER	-
success	BOOLEAN	-
successProductIdLists	LIST	-
$item	INTEGER	-
createProductFailMap	MAP	-
$key	STRING	-
$value	STRING	-
success	BOOLEAN	Whether it was successful or not
errorCode	INTEGER	Error code
errorMsg	STRING	Error message
返回错误码说明
收起
错误码	错误描述	解决办法
230012000	bad query params	check params
230012003	unmatch mall and goods	check mallId or goodsId
230013000	business exception	check params
230014000	system exception	try again later
230016103	not signed because of not main account	please sign with main account
230016701	has no permission	please sign agreement
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
全托广告API组	He uses type、Self use type


---

## bg.glo.searchrec.ad.modify

bg.glo.searchrec.ad.modify
修改广告接口
更新时间：2025-11-28 16:58:31
接口介绍：External service provider calls to modify ads
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
modifyAdDTO	OBJECT	是	-
productId	INTEGER	否	货品ID
roas	INTEGER	否	目标广告投资回报率
budget	INTEGER	否	广告日预算
status	INTEGER	是	修改类型：1:delete, 2:pause, 3:open, 4:modify budget, 5:modify roas
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	Specific information
successModifyProductNum	INTEGER	成功修改的商品数量
modifyGoodsRespList	LIST	-
$item	OBJECT	-
reason	STRING	-
productId	INTEGER	-
success	BOOLEAN	-
success	BOOLEAN	Whether it was successful or not
errorCode	INTEGER	Error code
errorMsg	STRING	Error message
返回错误码说明
收起
错误码	错误描述	解决办法
230012000	bad query params	check params
230012003	unmatch mall and goods	check mallId or goodsId
230013000	business exception	check params
230014000	system exception	try again later
230016103	not signed because of not main account	please sign with main account
230016701	has no permission	please sign agreement
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
全托广告API组	He uses type、Self use type


---

## bg.glo.searchrec.ad.batch.modify

bg.glo.searchrec.ad.batch.modify
批量修改广告接口
更新时间：2025-11-28 16:58:31
接口介绍：External service provider calls to batch modify ads
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
modifyAdDTOs	LIST	是	-
$item	OBJECT	否	-
productId	INTEGER	否	货品ID
roas	INTEGER	否	目标投资回报率
budget	INTEGER	否	推广日预算
status	INTEGER	否	修改类型：2:暂停, 3:开启
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	Specific information
successModifyProductNum	INTEGER	-
modifyGoodsRespList	LIST	-
$item	OBJECT	-
reason	STRING	-
productId	INTEGER	-
success	BOOLEAN	-
success	BOOLEAN	Whether it was successful or not
errorCode	INTEGER	Error code
errorMsg	STRING	Error message
返回错误码说明
收起
错误码	错误描述	解决办法
230012000	bad query params	check params
230012003	unmatch mall and goods	check mallId or goodsId
230013000	business exception	check params
230014000	system exception	try again later
230016103	not signed because of not main account	please sign with main account
230016701	has no permission	please sign agreement
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
全托广告API组	He uses type、Self use type


---

## bg.glo.searchrec.ad.roas.pred

bg.glo.searchrec.ad.roas.pred
广告投资回报率查询接口
更新时间：2025-11-28 16:58:31
接口介绍：Advertising investment return query interface
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
goodsInfoList	LIST	是	-
$item	OBJECT	否	-
productId	INTEGER	否	货品ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	Specific information
queryAdBidResult	LIST	最长50个
$item	OBJECT	-
productId	INTEGER	-
predList	LIST	分阶段roas列表，最长3个
$item	OBJECT	-
roas	STRING	推荐roas(广告投资回报率)
success	BOOLEAN	Whether it was successful or not
errorCode	INTEGER	Error code
errorMsg	STRING	Error message
返回错误码说明
收起
错误码	错误描述	解决办法
230012000	bad query params	check params
230012003	unmatch mall and goods	check mallId or goodsId
230013000	business exception	check params
230014000	system exception	try again later
230016103	not signed because of not main account	please sign with main account
230016701	has no permission	please sign agreement
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
全托广告API组	He uses type、Self use type


---

## bg.glo.searchrec.ad.detail.query

bg.glo.searchrec.ad.detail.query
广告投放状态查询接口
更新时间：2026-03-20 21:27:15
接口介绍：Advertising status query interface
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
productIdList	LIST	否	请求的货品ID列表
$item	INTEGER	否	货品id
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	Specific information
adsDetail	LIST	-
$item	OBJECT	-
summary	OBJECT	-
ctr	OBJECT	点击率
total	OBJECT	全店维度
val	INTEGER	全店维度值
ad	OBJECT	推广维度
val	INTEGER	推广维度值
netTotal	OBJECT	净全店
val	INTEGER	净全店值
netAd	OBJECT	净推广
val	INTEGER	净推广值
cartCnt	OBJECT	加入购物车数
total	OBJECT	全店维度
val	INTEGER	全店维度值
ad	OBJECT	推广维度
val	INTEGER	推广维度值
netTotal	OBJECT	净全店
val	INTEGER	净全店值
netAd	OBJECT	净推广
val	INTEGER	净推广值
clkCnt	OBJECT	点击量
total	OBJECT	全店维度
val	INTEGER	全店维度值
ad	OBJECT	推广维度
val	INTEGER	推广维度值
netTotal	OBJECT	净全店
val	INTEGER	净全店值
netAd	OBJECT	净推广
val	INTEGER	净推广值
orderPayAmt	OBJECT	申报价销售额
total	OBJECT	全店维度
val	INTEGER	全店维度值
ad	OBJECT	推广维度
val	INTEGER	推广维度值
netTotal	OBJECT	净全店
val	INTEGER	净全店值
netAd	OBJECT	净推广
val	INTEGER	净推广值
spend	OBJECT	花费
total	OBJECT	全店维度
val	INTEGER	全店维度值
ad	OBJECT	推广维度
val	INTEGER	推广维度值
netTotal	OBJECT	净全店
val	INTEGER	净全店值
netAd	OBJECT	净推广
val	INTEGER	净推广值
orderPayCnt	OBJECT	子订单量
total	OBJECT	全店维度
val	INTEGER	全店维度值
ad	OBJECT	推广维度
val	INTEGER	推广维度值
netTotal	OBJECT	净全店
val	INTEGER	净全店值
netAd	OBJECT	净推广
val	INTEGER	净推广值
roas	OBJECT	投资回报率
total	OBJECT	全店维度
val	INTEGER	全店维度值
ad	OBJECT	推广维度
val	INTEGER	推广维度值
netTotal	OBJECT	净全店
val	INTEGER	净全店值
netAd	OBJECT	净推广
val	INTEGER	净推广值
acos	OBJECT	费比
total	OBJECT	全店维度
val	INTEGER	全店维度值
ad	OBJECT	推广维度
val	INTEGER	推广维度值
netTotal	OBJECT	净全店
val	INTEGER	净全店值
netAd	OBJECT	净推广
val	INTEGER	净推广值
transactionCost	OBJECT	每笔成交花费
total	OBJECT	全店维度
val	INTEGER	全店维度值
ad	OBJECT	推广维度
val	INTEGER	推广维度值
netTotal	OBJECT	净全店
val	INTEGER	净全店值
netAd	OBJECT	净推广
val	INTEGER	净推广值
goodsNum	OBJECT	件数
total	OBJECT	全店维度
val	INTEGER	全店维度值
ad	OBJECT	推广维度
val	INTEGER	推广维度值
netTotal	OBJECT	净全店
val	INTEGER	净全店值
netAd	OBJECT	净推广
val	INTEGER	净推广值
imprCnt	OBJECT	曝光量
total	OBJECT	全店维度
val	INTEGER	全店维度值
ad	OBJECT	推广维度
val	INTEGER	推广维度值
netTotal	OBJECT	净全店
val	INTEGER	净全店值
netAd	OBJECT	净推广
val	INTEGER	净推广值
cvr	OBJECT	转化率
total	OBJECT	全店维度
val	INTEGER	全店维度值
ad	OBJECT	推广维度
val	INTEGER	推广维度值
netTotal	OBJECT	净全店
val	INTEGER	净全店值
netAd	OBJECT	净推广
val	INTEGER	净推广值
adPhase	INTEGER	广告阶段：0：一阶段，学习期；1：二阶段，平稳期
siteStatusInfoList	LIST	分站点广告状态
$item	OBJECT	-
forbidReason	STRING	站点失败原因
siteNameList	LIST	站点列表
$item	STRING	-
adShowStatus	INTEGER	广告状态：0：no balance；1：today budget 0；2：goods sold out；3：goods offline；4：goods under review；5：review rejected；6：promotion limited；7：pause；8：promoting；9：del；10：not creat；11：low traffic；12：low traffic soft roas；13：Approved；14：Reach month limit；15：Prohibited
productId	INTEGER	-
reportsSummaryDTO	OBJECT	-
clkCntAll	OBJECT	点击量
val	INTEGER	-
orderPayCntAll	OBJECT	订单量
val	INTEGER	-
adSpendAll	OBJECT	总花费
val	INTEGER	-
acosAll	OBJECT	广告费比
val	INTEGER	-
ctrAll	OBJECT	点击率
val	INTEGER	-
imprCntAll	OBJECT	曝光量
val	INTEGER	-
orderPayAmtAll	OBJECT	申报价销售额
val	INTEGER	-
cartCntAll	OBJECT	加购数
val	INTEGER	-
roasAll	OBJECT	广告投资回报率
val	INTEGER	-
roas	INTEGER	目标广告投资回报率
adShowStatus	INTEGER	广告状态：0：no balance；1：today budget 0；2：goods sold out；3：goods offline；4：goods under review；5：review rejected；6：promotion limited；7：pause；8：promoting；9：del；10：not creat；11：low traffic；12：low traffic soft roas；13：Approved；14：Reach month limit；15：Prohibited
budget	INTEGER	广告日预算
success	BOOLEAN	Whether it was successful or not
errorCode	INTEGER	Error code
errorMsg	STRING	Error message
返回错误码说明
收起
错误码	错误描述	解决办法
230012000	bad query params	check params
230012003	unmatch mall and goods	check mallId or goodsId
230013000	business exception	check params
230014000	system exception	try again later
230016103	not signed because of not main account	please sign with main account
230016701	has no permission	please sign agreement
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
全托广告API组	He uses type、Self use type


---

## bg.glo.searchrec.ad.goods.create.query

bg.glo.searchrec.ad.goods.create.query
广告商品可创建查询接口
更新时间：2026-01-14 23:13:37
接口介绍：Advertising goods can create query
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
productIdList	LIST	否	货品ID列表
$item	INTEGER	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	Specific information
goodsInfoList	LIST	-
$item	OBJECT	-
grayReason	LIST	-
$item	OBJECT	-
reason	STRING	不可投原因
type	INTEGER	不可投原因类型：1：Not Sale On Site；2：Already Online；3：Review Rejected；4：Review Exception
productId	INTEGER	-
success	BOOLEAN	Whether it was successful or not
errorCode	INTEGER	Error code
errorMsg	STRING	Error message
返回错误码说明
收起
错误码	错误描述	解决办法
230012000	bad query params	check params
230012003	unmatch mall and goods	check mallId or goodsId
230013000	business exception	check params
230014000	system exception	try again later
230016103	not signed because of not main account	please sign with main account
230016701	has no permission	please sign agreement
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
全托广告API组	He uses type、Self use type


---

## bg.glo.searchrec.ad.log.query

bg.glo.searchrec.ad.log.query
操作日志查询接口
更新时间：2025-11-28 16:58:31
接口介绍：Log query interface
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
productId	INTEGER	否	货品ID
startTime	INTEGER	是	查询开始时间，毫秒级时间戳（值以当地时间0点为开始时间）
endTime	INTEGER	是	查询结束时间，毫秒级时间戳（值以当地时间23点59分59秒999毫秒为结束时间）
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	Specific information
result	LIST	-
$item	OBJECT	-
changeInfo	STRING	修改详细内容
eventType	STRING	修改类型：目前有新增，更新，删除三种类型
updateSellerName	STRING	商家名称
updatedAt	STRING	修改时间
success	BOOLEAN	Whether it was successful or not
errorCode	INTEGER	Error code
errorMsg	STRING	Error message
返回错误码说明
收起
错误码	错误描述	解决办法
230012000	bad query params	check params
230012003	unmatch mall and goods	check mallId or goodsId
230013000	business exception	check params
230014000	system exception	try again later
230016103	not signed because of not main account	please sign with main account
230016701	has no permission	please sign agreement
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
全托广告API组	He uses type、Self use type


---

## bg.glo.searchrec.ad.reports.goods.query

bg.glo.searchrec.ad.reports.goods.query
广告商品投放数据效果（商品维度）
更新时间：2026-03-20 21:27:15
接口介绍：Advertising product delivery data effect (product dimension)
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
productId	INTEGER	否	货品ID
endTs	INTEGER	是	查询结束时间，毫秒级时间戳（值以当地时间23点59分59秒999毫秒为结束时间）
startTs	INTEGER	是	查询开始时间，毫秒级时间戳（值以当地时间0点为开始时间）
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	Specific information
reportInfo	OBJECT	-
summary	OBJECT	-
ctr	OBJECT	点击率
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
cartCnt	OBJECT	加入购物车数
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
clkCnt	OBJECT	点击量
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
orderPayAmt	OBJECT	申报价销售额
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
spend	OBJECT	花费
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
orderPayCnt	OBJECT	子订单量
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
roas	OBJECT	投资回报率
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
acos	OBJECT	费比
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
transactionCost	OBJECT	每笔成交花费
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
goodsNum	OBJECT	件数
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
imprCnt	OBJECT	曝光量
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
cvr	OBJECT	转化率
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
reportsItemList	LIST	分时间段报表信息，按照天级或小时级划分的报表信息（请求时间跨度大于一天按照天级划分，等于一天按照小时级划分）
$item	OBJECT	-
totalRoas	OBJECT	全店广告投资回报率
val	INTEGER	-
orderPayCnt	OBJECT	订单量
val	INTEGER	-
transactionCost	OBJECT	每笔成交花费
val	INTEGER	-
netAcos	OBJECT	净广告费比
val	INTEGER	-
totalOrderPayAmt	OBJECT	全店申报价销售额
val	INTEGER	-
totalGoodsNum	OBJECT	全店件数
val	INTEGER	-
roas	OBJECT	广告投资回报率
val	INTEGER	-
adSpend	OBJECT	花费
val	INTEGER	-
goodsNum	OBJECT	件数
val	INTEGER	-
netOrderPayCnt	OBJECT	净订单量
val	INTEGER	-
totalImprCnt	OBJECT	全店曝光量
val	INTEGER	-
cvr	OBJECT	转化率
val	INTEGER	-
ctr	OBJECT	点击率
val	INTEGER	-
cartCnt	OBJECT	加购数
val	INTEGER	-
productId	INTEGER	货品id
totalAcos	OBJECT	全店广告费比
val	INTEGER	-
netGoodsNum	OBJECT	净件数
val	INTEGER	-
orderPayAmt	OBJECT	申报价销售额
val	INTEGER	-
netAdSpend	OBJECT	净花费
val	INTEGER	-
totalCtr	OBJECT	全店点击率
val	INTEGER	-
acos	OBJECT	广告费比
val	INTEGER	-
totalCvr	OBJECT	全店转化率
val	INTEGER	-
totalClkCnt	OBJECT	全店点击量
val	INTEGER	-
imprCnt	OBJECT	曝光量
val	INTEGER	-
totalTransactionCost	OBJECT	全店每笔成交花费
val	INTEGER	-
totalOrderPayCnt	OBJECT	全店订单量
val	INTEGER	-
netTransactionCost	OBJECT	净每笔成交花费
val	INTEGER	-
clkCnt	OBJECT	点击量
val	INTEGER	-
netRoas	OBJECT	净广告投资回报率
val	INTEGER	-
netOrderPayAmt	OBJECT	净申报价销售额
val	INTEGER	-
ts	INTEGER	时间段开始
reportsSummary	OBJECT	整体报表信息
clkCntAll	OBJECT	点击量
val	INTEGER	-
orderPayCntAll	OBJECT	订单量
val	INTEGER	-
adSpendAll	OBJECT	总花费
val	INTEGER	-
acosAll	OBJECT	广告费比
val	INTEGER	-
ctrAll	OBJECT	点击率
val	INTEGER	-
imprCntAll	OBJECT	曝光量
val	INTEGER	-
orderPayAmtAll	OBJECT	申报价销售额
val	INTEGER	-
cartCntAll	OBJECT	加购数
val	INTEGER	-
roasAll	OBJECT	广告投资回报率
val	INTEGER	-
goodsInfo	OBJECT	-
grayReason	LIST	-
$item	OBJECT	-
reason	STRING	-
type	INTEGER	-
productId	INTEGER	-
success	BOOLEAN	Whether it was successful or not
errorCode	INTEGER	Error code
errorMsg	STRING	Error message
返回错误码说明
收起
错误码	错误描述	解决办法
230012000	bad query params	check params
230012003	unmatch mall and goods	check mallId or goodsId
230013000	business exception	check params
230014000	system exception	try again later
230016103	not signed because of not main account	please sign with main account
230016701	has no permission	please sign agreement
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
全托广告API组	He uses type、Self use type


---

## bg.glo.searchrec.ad.reports.mall.query

bg.glo.searchrec.ad.reports.mall.query
整体投放数据效果（店铺维度）
更新时间：2026-03-20 21:27:15
接口介绍：Overall delivery data effect (mall dimension)
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
endTs	INTEGER	是	查询结束时间，毫秒级时间戳（值以当地时间23点59分59秒999毫秒为结束时间）
startTs	INTEGER	是	查询开始时间，毫秒级时间戳（值以当地时间0点为开始时间）
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	Specific information
summary	OBJECT	-
ctr	OBJECT	点击率
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
cartCnt	OBJECT	加入购物车数
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
clkCnt	OBJECT	点击量
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
orderPayAmt	OBJECT	申报价销售额
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
spend	OBJECT	花费
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
orderPayCnt	OBJECT	子订单量
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
roas	OBJECT	投资回报率
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
acos	OBJECT	费比
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
transactionCost	OBJECT	每笔成交花费
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
goodsNum	OBJECT	件数
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
imprCnt	OBJECT	曝光量
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
cvr	OBJECT	转化率
total	OBJECT	全店维度
val	INTEGER	-
ad	OBJECT	推广维度
val	INTEGER	-
netTotal	OBJECT	净全店
val	INTEGER	-
netAd	OBJECT	净推广
val	INTEGER	-
reportsItemList	LIST	分时间段报表信息，按照天级或小时级划分的报表信息（请求时间跨度大于一天按照天级划分，等于一天按照小时级划分）
$item	OBJECT	-
totalRoas	OBJECT	全店广告投资回报率
val	INTEGER	-
orderPayCnt	OBJECT	订单量
val	INTEGER	-
transactionCost	OBJECT	每笔成交花费
val	INTEGER	-
netAcos	OBJECT	净广告费比
val	INTEGER	-
totalOrderPayAmt	OBJECT	全店申报价销售额
val	INTEGER	-
totalGoodsNum	OBJECT	全店件数
val	INTEGER	-
roas	OBJECT	广告投资回报率
val	INTEGER	-
adSpend	OBJECT	总花费
val	INTEGER	-
goodsNum	OBJECT	件数
val	INTEGER	-
netOrderPayCnt	OBJECT	净订单量
val	INTEGER	-
totalImprCnt	OBJECT	全店曝光量
val	INTEGER	-
cvr	OBJECT	转化率
val	INTEGER	-
ctr	OBJECT	点击率
val	INTEGER	-
cartCnt	OBJECT	加购数
val	INTEGER	-
productId	INTEGER	货品id
totalAcos	OBJECT	全店广告费比
val	INTEGER	-
netGoodsNum	OBJECT	净件数
val	INTEGER	-
orderPayAmt	OBJECT	申报价销售额
val	INTEGER	-
netAdSpend	OBJECT	净花费
val	INTEGER	-
totalCtr	OBJECT	全店点击率
val	INTEGER	-
acos	OBJECT	广告费比
val	INTEGER	-
totalCvr	OBJECT	全店转化率
val	INTEGER	-
totalClkCnt	OBJECT	全店点击量
val	INTEGER	-
imprCnt	OBJECT	曝光量
val	INTEGER	-
totalTransactionCost	OBJECT	全店每笔成交花费
val	INTEGER	-
totalOrderPayCnt	OBJECT	全店订单量
val	INTEGER	-
netTransactionCost	OBJECT	净每笔成交花费
val	INTEGER	-
clkCnt	OBJECT	点击量
val	INTEGER	-
netRoas	OBJECT	净广告投资回报率
val	INTEGER	-
netOrderPayAmt	OBJECT	净申报价销售额
val	INTEGER	-
ts	INTEGER	时间段开始时间戳
reportsSummary	OBJECT	整体报表信息
clkCntAll	OBJECT	点击量
val	INTEGER	-
orderPayCntAll	OBJECT	订单量
val	INTEGER	-
adSpendAll	OBJECT	总花费
val	INTEGER	-
acosAll	OBJECT	广告费比
val	INTEGER	-
ctrAll	OBJECT	点击率
val	INTEGER	-
imprCntAll	OBJECT	曝光量
val	INTEGER	-
orderPayAmtAll	OBJECT	申报价销售额
val	INTEGER	-
cartCntAll	OBJECT	加购数
val	INTEGER	-
roasAll	OBJECT	广告投资回报率
val	INTEGER	-
success	BOOLEAN	Whether it was successful or not
errorCode	INTEGER	Error code
errorMsg	STRING	Error message
返回错误码说明
收起
错误码	错误描述	解决办法
230012000	bad query params	check params
230012003	unmatch mall and goods	check mallId or goodsId
230013000	business exception	check params
230014000	system exception	try again later
230016103	not signed because of not main account	please sign with main account
230016701	has no permission	please sign agreement
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
全托广告API组	He uses type、Self use type
