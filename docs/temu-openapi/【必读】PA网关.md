# 【必读】PA网关

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 1 个接口


---

## PA网关调用说明

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
