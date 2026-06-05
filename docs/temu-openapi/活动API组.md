# 活动API组

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 6 个接口


---

## bg.marketing.activity.list.get

bg.marketing.activity.list.get
查询活动列表
更新时间：2026-01-08 15:10:10
接口介绍：卖家端查询活动列表接口
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
result	OBJECT	result
activityList	LIST	-
$item	OBJECT	-
benefitLabelName	LIST	权益标签
$item	STRING	-
activityContent	STRING	活动文案
sessionAssignType	INTEGER	场次分配方式. 可选值含义说明:[1:时间周期内自动分配场次;2:用户选择场次;3:主题下自动分配场次;4:主题下报名全部场次;5:报名全部场次;]
activityName	STRING	活动名称
activityLabelTag	INTEGER	活动标签tag
thematicList	LIST	活动专题（13、14、101、127使用，包含邀约和自主报名，后续邀约下线后，仅自主报名使用）
$item	OBJECT	-
benefitLabelName	LIST	权益标签
$item	STRING	-
durationDays	INTEGER	持续天数
enrollSource	INTEGER	0-邀约报名 1-自主报名. 可选值含义说明:[0:邀约报名;1:自主报名;]
salePromotionLabel	STRING	促销标签， 约定黑五：black_friday
enrollDeadLine	INTEGER	报名截至时间
activityLabelTag	INTEGER	活动标签tag
enrollStartAt	INTEGER	报名开始时间
startTime	INTEGER	开始时间
sites	LIST	站点，为空表示不限制站点
$item	OBJECT	-
siteId	INTEGER	-
siteName	STRING	-
endTime	INTEGER	结束时间
activityThematicName	STRING	活动专题名称, 如果是邀约活动，则表示invitationName
activityThematicId	INTEGER	活动专题id, 如果是邀约活动，则表示invitationId
activityType	INTEGER	活动类型. 可选值含义说明:[13:官方大促;14:限时专属资源位;21:超级秒杀;1:限时秒杀;5:大促活动;27:清仓甩卖;101:秒杀进阶;127:清仓进阶]
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
100000001	入参活动类型不能为空	检查入参
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
活动API组	He uses type、Self use type


---

## bg.marketing.activity.detail.get

bg.marketing.activity.detail.get
查询活动详情
更新时间：2025-12-18 14:38:15
接口介绍：卖家端查询活动详情接口
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
activityType	INTEGER	是	活动类型. 可选值含义说明:[13:官方大促;14:限时专属资源位;21:超级秒杀;1:限时秒杀;5:大促活动;27:清仓甩卖;101:秒杀进阶;127:清仓进阶]
activityThematicId	INTEGER	否	活动专题id
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
requirements	LIST	活动要求
$item	OBJECT	-
checkStatus	INTEGER	活动要求状态检查. 可选值含义说明:[1:符合;2:报名时检测;3:报名页面已自动过滤不满足的商品;0:不符合;]
checkStatusDesc	STRING	活动要求状态检查
requirementCode	INTEGER	活动要求枚举
requirementType	STRING	活动要求类型
requirementDesc	STRING	活动要求描述
mallAptitude	LIST	店铺资质
$item	OBJECT	-
checkStatus	INTEGER	活动要求状态检查. 可选值含义说明:[1:符合;2:报名时检测;3:报名页面已自动过滤不满足的商品;0:不符合;]
checkStatusDesc	STRING	活动要求状态检查
requirementCode	INTEGER	活动要求枚举
requirementType	STRING	活动要求类型
requirementDesc	STRING	活动要求描述
thematicInfo	OBJECT	专题信息
benefitLabelName	LIST	权益标签
$item	STRING	-
durationDays	INTEGER	持续天数
enrollSource	INTEGER	0-邀约报名 1-自主报名. 可选值含义说明:[0:邀约报名;1:自主报名;]
salePromotionLabel	STRING	促销标签， 约定黑五：black_friday
enrollDeadLine	INTEGER	报名截至时间
activityLabelTag	INTEGER	活动标签tag. 可选值含义说明:[1:最新;2:爆款;]
enrollStartAt	INTEGER	报名开始时间
startTime	INTEGER	开始时间
sites	LIST	站点，为空表示不限制站点
$item	OBJECT	-
siteId	INTEGER	-
siteName	STRING	-
endTime	INTEGER	结束时间
activityThematicName	STRING	活动专题名称, 如果是邀约活动，则表示invitationName
activityThematicId	INTEGER	活动专题id, 如果是邀约活动，则表示invitationId
activityInfo	OBJECT	活动信息
benefitLabelName	LIST	权益标签
$item	STRING	-
activityContent	STRING	活动文案
sessionAssignType	INTEGER	场次分配方式. 可选值含义说明:[1:时间周期内自动分配场次;2:用户选择场次;3:主题下自动分配场次;4:主题下报名全部场次;5:报名全部场次;]
activityName	STRING	活动名称
activityLabelTag	INTEGER	活动标签tag. 可选值含义说明:[1:最新;2:爆款;]
activityType	INTEGER	活动类型. 可选值含义说明:[13:官方大促;14:限时专属资源位;21:超级秒杀;1:限时秒杀;5:大促活动;27:清仓甩卖;]
canEnroll	BOOLEAN	是否可参与报名
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
100000001	入参活动类型不能为空	检查入参
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
活动API组	He uses type、Self use type


---

## bg.marketing.activity.product.get

bg.marketing.activity.product.get
查询活动商品
更新时间：2026-01-08 15:09:35
接口介绍：卖家端查询活动商品
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
searchScrollContext	STRING	否	滚动查询上下文参数，用于下次查询（第一次查询或要重置查询时请传null）
productIds	LIST	否	货品spuId
$item	INTEGER	否	-
productSkuExtCodes	LIST	否	货品sku货号
$item	STRING	否	-
productSkcIds	LIST	否	货品skcId
$item	INTEGER	否	-
productSkcExtCodes	LIST	否	货品skc货号
$item	STRING	否	-
productSkuIds	LIST	否	货品skuId
$item	INTEGER	否	-
siteId	INTEGER	否	站点id
siteIds	LIST	否	站点ids
$item	INTEGER	否	-
rowCount	INTEGER	是	行数
activityType	INTEGER	是	活动类型. 可选值含义说明:[13:官方大促;14:限时专属资源位;21:超级秒杀;1:限时秒杀;5:大促活动;27:清仓甩卖;101:秒杀进阶;127:清仓进阶]
activityThematicId	INTEGER	否	活动专题id，13、14使用
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
searchScrollContext	STRING	滚动查询上下文参数，用于下次查询（第一次查询或要重置查询时请传null）
matchList	LIST	符合报名条件的商品
$item	OBJECT	-
targetActivityStock	INTEGER	目标活动申报商品数（最低限制）
skcList	LIST	skc
$item	OBJECT	-
skcId	INTEGER	-
dailyPrice	INTEGER	（服饰类）日常价格 半托管拆分站点后，使用sitePriceList
activityPrice	INTEGER	（服饰类）活动申报价格
skuList	LIST	sku
$item	OBJECT	-
dailyPrice	INTEGER	（非服饰类）日常价格 半托管拆分站点后，使用sitePriceList
activityPrice	INTEGER	（非服饰类）活动申报价格
suggestActivityPrice	INTEGER	（非服饰类）建议活动申报价格 半托管拆分站点后，使用sitePriceList
currency	STRING	币种:CNY-人民币元;USD-美元
sitePriceList	LIST	（非服饰类）各站点价格 半托管拆分站点后，返回
$item	OBJECT	-
dailyPrice	INTEGER	日常价格
activityPrice	INTEGER	建议活动申报价格，报名记录接口返回
suggestActivityPrice	INTEGER	建议活动申报价格
siteId	INTEGER	-
siteName	STRING	-
skuId	INTEGER	skuId
suggestActivityPrice	INTEGER	（服饰类）建议活动申报价格 半托管拆分站点后，使用sitePriceList
currency	STRING	币种:CNY-人民币元;USD-美元
sitePriceList	LIST	（服饰类）各站点价格 半托管拆分站点后，返回
$item	OBJECT	-
dailyPrice	INTEGER	日常价格
activityPrice	INTEGER	建议活动申报价格，报名记录接口返回
suggestActivityPrice	INTEGER	建议活动申报价格
siteId	INTEGER	-
siteName	STRING	-
productId	INTEGER	货品id
enrollSessionIdList	LIST	已报名场次，仅半托管返回
$item	INTEGER	-
currency	STRING	币种:CNY-人民币元;USD-美元
sites	LIST	商品经营站点
$item	OBJECT	-
siteId	INTEGER	-
siteName	STRING	-
isApparel	INTEGER	是否服饰:1-是；0-否。服饰类使用skc，非服饰类使用sku
productName	STRING	货品名称
suggestActivityStock	INTEGER	建议活动申报商品数
hasMore	BOOLEAN	是否存在更多数据
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
100000001	入参活动类型不能为空	检查入参
100000003	入参行数不能为空	检查入参
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
活动API组	He uses type、Self use type


---

## bg.marketing.activity.session.list.get

bg.marketing.activity.session.list.get
查询活动场次列表
更新时间：2026-01-08 15:10:21
接口介绍：查询活动场次列表接口
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
productIds	LIST	是	货品id
$item	INTEGER	否	-
startTime	INTEGER	否	开始时间
endTime	INTEGER	否	结束时间
activityType	INTEGER	是	可选值含义说明:[1:限时秒杀;5:官方大促;27:清仓甩卖;13:大促进阶-限时活动;14:限时专属资源位;]
activityThematicId	INTEGER	否	活动专题id，13、14使用
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
siteIds	LIST	站点列表
$item	INTEGER	-
list	LIST	活动报名场次列表
$item	OBJECT	-
durationDays	INTEGER	场次持续天数
startDateStr	STRING	场次开始日期字符串
sessionName	STRING	场次名称
sessionStatus	INTEGER	场次状态. 可选值含义说明:[1:未开始;2:进行中;3:活动已结束;4:报名失败;5:已售罄;6:已下线]
siteId	INTEGER	站点id
siteName	STRING	站点名称
startTime	INTEGER	开始时间
sessionId	INTEGER	场次id
endTime	INTEGER	结束时间
endDateStr	STRING	场次开始日期字符串
productCanEnrollSessionMap	MAP	货品SPU可报名场次，Key为货品SPU ID
$key	STRING	-
$value	LIST	-
$item	OBJECT	-
durationDays	INTEGER	场次持续天数
startDateStr	STRING	场次开始日期字符串
sessionName	STRING	场次名称
sessionStatus	INTEGER	场次状态. 可选值含义说明:[1:未开始;2:进行中;3:活动已结束;4:报名失败;5:已售罄;6:已下线]
siteId	INTEGER	站点id
siteName	STRING	站点名称
startTime	INTEGER	开始时间
sessionId	INTEGER	场次id
endTime	INTEGER	结束时间
endDateStr	STRING	场次开始日期字符串
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
100000001	入参活动类型不能为空	检查入参
100000004	入参货品id不能为空	检查入参
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
活动API组	He uses type、Self use type


---

## bg.marketing.activity.enroll.submit

bg.marketing.activity.enroll.submit
活动报名提交
更新时间：2026-01-08 15:09:50
接口介绍：卖家端活动报名提交接口
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
activityType	INTEGER	是	活动类型. 可选值含义说明:[13:官方大促;14:限时专属资源位;21:超级秒杀;1:限时秒杀;5:大促活动;27:清仓甩卖;101:秒杀进阶;127:清仓进阶]
productList	LIST	是	报名货品列表
$item	OBJECT	否	-
activityStock	INTEGER	是	活动申报商品数
skcList	LIST	是	报名货品的skc列表
$item	OBJECT	否	-
skcId	INTEGER	是	skcId
activityPrice	INTEGER	否	skc活动价，当是服饰类
skuList	LIST	是	报名货品的sku列表
$item	OBJECT	否	-
activityPrice	INTEGER	否	sku活动价，当是非服饰类
siteActivityPriceList	LIST	否	sku各站点活动价，半托管拆分站点后传
$item	OBJECT	否	-
activityPrice	INTEGER	否	活动价
siteId	INTEGER	否	-
skuId	INTEGER	是	skuId
siteActivityPriceList	LIST	否	skc各站点活动价，半托管拆分站点后传
$item	OBJECT	否	-
activityPrice	INTEGER	否	活动价
siteId	INTEGER	否	-
productId	INTEGER	是	货品id
sessionIds	LIST	否	半托管需要传，全托管自动分配
$item	INTEGER	否	-
activityThematicId	INTEGER	否	活动专题id，13、14使用
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
failCount	INTEGER	失败数
successCount	INTEGER	成功数
failList	LIST	失败列表
$item	OBJECT	-
productId	INTEGER	货品id
failMsg	STRING	失败描述
failReason	INTEGER	失败原因. 可选值含义说明:[1:系统异常;2:当前操作存在并发操作，请稍后重试;3:商品信息异常;4:活动库存低于建议库存;5:活动供货价高于建议价;6:所选商品存在sku未上架/skc未上站;7:所选商品已报名;8:所选商品存在待确认的调价单，请完成后再次报名;9:所选商品存在大额单品券;10:场次站点与商品经营站点不一致，无需重试;11:所选场次已报名或时间冲突;12:商品品质分低于60分以下，无法参加活动;13:活动供货价必须低于日常价;14:售罄率健康分、售罄率影响GMV健康分同时小于60分，已限制活动报名，请前往【数据中心-销量分析】查看售罄情况，及时补货，解除限制;15:所选商品此时报名活动不能领取服务费减免权益;16:活动库存低于可领取权益的建议库存;17:活动供货价高于可领取权益的建议价;18:该货品非清仓滞销品，禁止报入清仓活动;19:当前商品未发布;20:当前商品未加站;21:标签不满足;99:参数非法;]
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
100000001	入参活动类型不能为空	检查入参
100000002	入参货品列表不能为空	检查入参
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
活动API组	He uses type、Self use type


---

## bg.marketing.activity.enroll.list.get

bg.marketing.activity.enroll.list.get
查询活动报名记录
更新时间：2026-01-08 15:09:21
接口介绍：活动报名记录查询接口
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
enrollTimeBegin	INTEGER	否	报名时间开始
mallId	INTEGER	是	店铺id
sessionStatus	INTEGER	否	1-未开始 2-进行中 3-已结束
pageSize	INTEGER	是	分页大小
activityThematicId	INTEGER	否	活动主题id
enrollTimeEnd	INTEGER	否	报名时间结束
productIds	LIST	否	货品spuId
$item	INTEGER	否	-
productSkuExtCodes	LIST	否	货品sku货号
$item	STRING	否	-
productSkcIds	LIST	否	货品skcId
$item	INTEGER	否	-
pageNo	INTEGER	是	页码
productSkcExtCodes	LIST	否	货品skc货号
$item	STRING	否	-
productSkuIds	LIST	否	货品skuId
$item	INTEGER	否	-
activityType	INTEGER	否	活动类型 1-秒杀 5-官方大促 27-清仓 13-大促进阶（专题）
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	总数
list	LIST	活动报名记录列表
$item	OBJECT	-
assignSessionList	LIST	已分配活动场次
$item	OBJECT	-
durationDays	INTEGER	场次持续天数
startDateStr	STRING	场次开始日期字符串，当地时区
sessionName	STRING	场次名称
sessionStatus	INTEGER	场次状态
siteId	INTEGER	站点id
siteName	STRING	站点名称
startTime	INTEGER	开始时间
sessionId	INTEGER	场次id
endTime	INTEGER	结束时间
endDateStr	STRING	场次开始日期字符串，当地时区
productId	INTEGER	货品id
goodsId	INTEGER	商品id
activityTypeName	STRING	活动类型名称
sessionEndTime	INTEGER	活动结束时间
sessionStartTime	INTEGER	活动开始时间
isApparel	INTEGER	是否服饰:1-是；0-否。服饰类使用skc，非服饰类使用sku
soldStatus	INTEGER	售罄状态 0-正常 1-即将售罄 2-已售罄
remainingActivityStock	INTEGER	剩余活动库存
activityThematicId	INTEGER	活动主题id
enrollTime	INTEGER	报名时间
activityStock	INTEGER	活动申报商品数
skcList	LIST	skc列表
$item	OBJECT	-
skcId	INTEGER	-
dailyPrice	INTEGER	（服饰类）全托管日常价格
activityPrice	INTEGER	（服饰类）全托管活动申报价格
skuList	LIST	sku
$item	OBJECT	-
dailyPrice	INTEGER	（非服饰类）全托管日常价格
activityPrice	INTEGER	（非服饰类）全托管活动申报价格
currency	STRING	币种:CNY-人民币元;USD-美元
sitePriceList	LIST	（非服饰类）半托管各站点价格
$item	OBJECT	-
dailyPrice	INTEGER	日常价格
activityPrice	INTEGER	活动申报价格，报名记录接口返回
siteId	INTEGER	站点id
siteName	STRING	站点名称
skuId	INTEGER	skuId
currency	STRING	币种:CNY-人民币元;USD-美元
sitePriceList	LIST	（服饰类）半托管各站点价格
$item	OBJECT	-
dailyPrice	INTEGER	日常价格
activityPrice	INTEGER	活动申报价格，报名记录接口返回
siteId	INTEGER	站点id
siteName	STRING	站点名称
enrollStatus	INTEGER	报名状态 1-报名中 2-报名失败 3-报名成功待分配场次 4-报名成功已分配场次 5-报名活动已结束 6-报名活动已下线
enrollId	INTEGER	报名id
currency	STRING	币种:CNY-人民币元;USD-美元
activityType	INTEGER	活动类型
activityThematicName	STRING	活动专题名称
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
100000005	分页大小支持1-50	检查分页大小参数
100000006	页码参数非法	检查页码参数
100000007	活动类型参数非法	检查activityType参数
100000008	活动主题不存在	检查activityThematicId参数
100000009	sessionStatus参数非法	检查sessionStatus参数
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
活动API组	He uses type、Self use type
