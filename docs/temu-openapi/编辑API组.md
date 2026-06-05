# 编辑API组

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 10 个接口


---

## bg.goods.update

bg.goods.update
货品更新接口
更新时间：2026-02-02 20:44:35
接口介绍：这个接口作为后续的通用货品更新接口，用于“无编辑限制规则的字段”的更新编辑，本次只用于产地编辑
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
productWhExtAttrReq	OBJECT	否	货品仓配供应链侧扩展属性请求
productOrigin	OBJECT	是	货品产地
region2Id	LONG	否	省份，当region1ShortName为CN时，省份必传。枚举值：https://partner.kuajingmaihuo.com/document?cataId=875196199516&docId=894069632221
region1ShortName	STRING	是	一级区域简称 (二字简码)
supplierId	LONG	是	供应商id
productId	LONG	是	货品id
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
991000001	服务器开小差	请根据详细报错文案做相应调整，如有疑问联系管理员
991000003	bad paramater	see the detail of the parameter error
992000000	invalid product	ProductId not exist, or system busy. Check productId and retry
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.goods.edit

bg.goods.edit
货品编辑
更新时间：2026-02-02 20:42:52
接口介绍：用于编辑货品尺码表
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
productId	INTEGER	是	货品id
showSizeTemplateIds	LIST	是	重点展示尺码表模板id列表
$item	INTEGER	否	-
sizeTemplateIds	LIST	是	尺码表模板id列表
$item	INTEGER	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
success	BOOLEAN	-
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1000001	服务器开小差	一般是系统抖动，可参考具体报错文案尝试解决或重试，如果还不行请联系管理员
1000003	参数错误	结合参数错误的具体原因排查
1000005	系统异常	尝试重试，如果还不行请联系管理员
1000011	无权访问	越权访问了其他用户的数据，请联系管理员处理
2000000	不合法的货品	入参货品id不存在，或者系统抖动，请检查入参后重试
2000194	商品信息审核中，暂不支持编辑	请稍后重试，如果还不行请联系管理员
6000012	尺码表校验失败	请结合校验失败具体原因检查尺码表入参
6000019	已审版，如需修改尺码表，请联系运营	已审版，如需修改尺码表，请联系运营
6000059	童鞋适用年龄和鞋子不匹配，请确认后填写	请确认填写内容
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.goods.edit.sensitive.attr

bg.goods.edit.sensitive.attr
编辑货品敏感品属性
更新时间：2026-02-03 14:08:28
接口介绍：商家编辑货品敏感品属性
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
productId	LONG	是	货品id
skuReqList	LIST	是	sku敏感品属性请求列表
$item	OBJECT	否	-
productSkuSensitiveLimitReq	OBJECT	是	货品sku敏感属性限制请求 (编辑场景、没有限制时, 传空对象)
maxBatteryCapacityHp	LONG	否	最大电池容量 (mWh)
maxLiquidCapacityHp	LONG	否	最大液体容量 (μL)
maxKnifeLengthHp	LONG	否	最大刀具长度 (μm)
knifeTipAngle	OBJECT	否	刀尖角度
degrees	INTEGER	是	度[1, 360]
productSkuId	LONG	是	货品skuId
productSkuSensitiveAttrReq	OBJECT	是	货品sku敏感属性请求
isSensitive	INTEGER	否	是否敏感属性，0：非敏感，1：敏感
sensitiveList	LIST	否	敏感类型， PURE_ELECTRIC(110001, "纯电"), INTERNAL_ELECTRIC(120001, "内电"), MAGNETISM(130001, "磁性"), LIQUID(140001, "液体"), POWDER(150001, "粉末"), PASTE(160001, "膏体"), CUTTER(170001, "刀具")
$item	INTEGER	否	-
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
991000001	服务器开小差	请根据详细报错文案做相应调整，如有疑问联系管理员
991000002	参数错误	检查传参是否满足接口协议
991000005	system exception	try again later, if that doesn't work, contact the administrator
991000010	登录校验失败	检查登录状态
991000011	forbidden request, current supplier cannot query another supplier's data	query your own data
992000032	请填写sku敏感属性	请填写sku敏感属性
992000152	提交失败，当前商品已提交修改，请在当前信息修改完成后再行修改，本次信息修改可在商品列表页或详情页查看进度	请在当前信息修改完成后再行修改，如有疑问联系管理员
996000031	SKU敏感信息已经审批通过，不能修改	当前状态禁止修改，如有疑问联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
发货API组	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.goods.edit.task.apply

bg.goods.edit.task.apply
发起货品修改单
更新时间：2025-03-13 15:57:43
接口介绍：支持开平发起货品修改单用于编辑货品信息
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
bizIdType	INTEGER	是	业务id类型 (1: 货品id)
productEditItems	LIST	是	货品修改项列表
$item	OBJECT	否	-
editAdvice	STRING	是	修改建议
editItem	INTEGER	是	修改项
bizIds	LIST	是	业务id列表
$item	INTEGER	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
addFailedList	LIST	新增失败列表
$item	OBJECT	-
failedBizId	INTEGER	失败业务id
failedReason	STRING	失败原因
handleFailedList	LIST	处理失败列表
$item	OBJECT	-
failedBizId	INTEGER	失败业务id
failedReason	STRING	失败原因
successBizId2TaskUidMap	MAP	成功的id -> 任务uid
$key	STRING	-
$value	STRING	-
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1000001	服务器开小差	一般是系统抖动，可参考具体报错文案尝试解决或重试，如果还不行请联系管理员
1000003	参数错误	结合参数错误的具体原因排查
1000004	系统异常	尝试重试，如果还不行请联系管理员
2000042	修改单类型不合法	当前修改类型不支持或者不存在，请检查入参
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.goods.edit.task.submit

bg.goods.edit.task.submit
提交货品修改单
更新时间：2026-02-03 14:07:29
接口介绍：支持开平提交货品修改单，用于编辑货品信息
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
productId	INTEGER	是	货品id
taskUid	STRING	是	修改任务uid
productPropertyReqs	LIST	否	货品属性
$item	OBJECT	否	-
vid	INTEGER	是	基础属性值id，没有的情况传0
valueUnit	STRING	是	属性值单位，没有的情况传空字符串
pid	INTEGER	是	属性id
templatePid	INTEGER	是	模板属性id
numberInputValue	STRING	否	数值录入
propValue	STRING	是	基础属性值
propName	STRING	是	引用属性名
refPid	INTEGER	是	引用属性id
taskVersion	INTEGER	是	任务版本号
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
1000001	服务器开小差	一般是系统抖动，可参考具体报错文案尝试解决或重试，如果还不行请联系管理员
1000003	参数错误	结合参数错误的具体原因排查
1000005	系统异常	尝试重试，如果还不行请联系管理员
2000011	自定义规格属性校验失败	请结合校验失败具体原因检查规格入参
2000044	商品体积录入有误，请遵循最长边 ≥ 次长边 ≥ 最短边	商品体积录入有误，请遵循最长边 ≥ 次长边 ≥ 最短边
2000069	商品体积异常，无法进行跨境运输	商品体积无可配送渠道，请咨询管理员
2000081	不合法或不可用的品牌	输入的品牌信息不可用或id不正确
2000096	体积内容必须遵循最长边 ≥ 次长边 ≥ 最短边原则	体积内容必须遵循最长边 ≥ 次长边 ≥ 最短边原则
2000101	货品修改任务不存在	修改任务参数异常，请检查入参
2000134	请填写sku分类信息	请填写sku分类信息
2000135	当前类目净含量必填	请填写净含量
2000177	半托管商品英文标题最少需要x个字	英文标题不满足字数要求，请重新输入
2000200	属性值id[x]的属性值名称有误	属性值id与属性值不匹配，请检查入参
2000201	属性id[x]的属性名称有误	属性id与属性名称不匹配，请检查入参
2000202	商品不符合大件标准，不可使用大件商品运费模版	请选择非大件运费模板，或者重新维护商品体积
6000002	货品属性校验失败	请结合校验失败具体原因检查属性入参
6000012	尺码表校验失败	请结合校验失败具体原因检查尺码表入参
6000047	回应货品修改任务失败	数据更新失败，请结合具体报错解决
6000048	当前场景不允许新增skc	输入的skc信息有误，请检查入参
6000049	当前场景不允许新增sku	输入的sku信息有误，请检查入参
6000055	提交失败，请修改后再行提交	数据未变更，请修改后再提交
6000059	童鞋适用年龄和鞋子不匹配，请确认后填写	请确认填写内容
6000109	sku分类信息不支持清空	sku分类已经填过则不支持清空，请检查入参
6000120	不允许该操作，请提交修改	refuseEdit字段请勿使用
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.goods.edit.pictures.submit

bg.goods.edit.pictures.submit
修改商品素材
更新时间：2026-02-03 14:08:54
接口介绍：[B] BG-289653 【OPENAPI】新增-商品图片更新API
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
productCarouseVideoReqList	LIST	否	轮播视频, 空list视为删除，null视为不改动
$item	OBJECT	否	-
vid	STRING	是	视频VID
coverUrl	STRING	是	视频封面图(B端存储的是首侦图)
videoUrl	STRING	是	视频url
width	INTEGER	是	视频宽度
height	INTEGER	是	视频高度
skcList	LIST	否	skc信息
$item	OBJECT	否	-
skcId	LONG	是	商品skcId
skuCommonReqList	LIST	否	sku信息
$item	OBJECT	否	-
productSkuThumbUrlI18nReqs	LIST	否	SKU预览图多语言信息请求
$item	OBJECT	否	-
imgUrlList	LIST	否	图片列表, 空list视为删除，null视为不改动
$item	STRING	否	-
language	STRING	是	语言
thumbUrl	STRING	是	预览图
skuId	LONG	是	skuId
previewImgUrls	LIST	是	轮播图列表，非服饰类目不用传
$item	STRING	否	-
productSkcCarouselImageI18nReqs	LIST	否	SKC轮播图多语言信息请求
$item	OBJECT	否	-
imgUrlList	LIST	否	图片列表, 空list视为删除，null视为不改动
$item	STRING	否	-
language	STRING	是	语言
colorImageUrl	STRING	否	SKC色块图
productId	LONG	是	货品ID
productDetailVideoReqList	LIST	否	商详视频, 空list视为删除，null视为不改动
$item	OBJECT	否	-
vid	STRING	是	视频VID
coverUrl	STRING	是	视频封面图(B端存储的是首侦图)
videoUrl	STRING	是	视频url
width	INTEGER	是	视频宽度
height	INTEGER	是	视频高度
goodsLayerDecorationReqs	LIST	否	商详装饰
$item	OBJECT	否	-
floorId	LONG	否	楼层id,null:新增,否则为更新
type	STRING	是	组件类型type,图片-image,文本-text
priority	INTEGER	是	楼层排序
lang	STRING	是	语言类型
contentList	LIST	是	楼层内容
$item	OBJECT	否	-
imgUrl	STRING	否	图片地址--通用
textModuleDetails	OBJECT	否	文字模块详情
backgroundColor	STRING	是	背景颜色
fontFamily	INTEGER	否	字体类型
fontSize	INTEGER	是	文字模块字体大小
align	STRING	是	文字对齐方式，left--左对齐；right--右对齐；center--居中；justify--两端对齐
fontColor	STRING	是	文字颜色
width	INTEGER	否	图片宽度--通用
text	STRING	否	文字信息--文字模块
height	INTEGER	否	图片高度--通用
key	STRING	是	楼层类型的key,目前默认传'DecImage'
carouselImageUrls	LIST	否	货品轮播图，服饰类目不用传，会从skc上聚合
$item	STRING	否	-
carouselImageI18nReqs	LIST	否	货品轮播图多语言信息请求，服饰类目不用传，会从skc上聚合
$item	OBJECT	否	-
imgUrlList	LIST	否	图片列表, 空list视为删除，null视为不改动
$item	STRING	否	-
language	STRING	是	语言
materialImgUrl	STRING	否	素材图
materialMultiLanguages	LIST	否	图片多语言列表
$item	STRING	否	-
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
100000200	The parameters are incorrect. Please modify the parameters and submit again.	Please note that the image size, proportion and quantity meet the requirements.
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.goodslogistics.template.edit

bg.goodslogistics.template.edit
编辑商品运费模板
更新时间：2026-02-03 14:08:00
接口介绍：编辑
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
productShipment	OBJECT	是	货品配送信息
freightTemplateId	STRING	是	运费模板id
shipmentLimitSecond	INTEGER	是	承诺发货时间(单位:s)
supplierId	INTEGER	是	供应商id
productId	INTEGER	是	货品id
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
991000003	bad paramater	see the detail of the parameter error
991000005	system exception	try again later, if that doesn't work, contact the administrator
991000011	forbidden request, current supplier cannot query another supplier's data	query your own data
991000012	system busy, please try again later	try again later
992000125	illegal freightTemplateId or query freightTemplateId failed	set correct freightTemplateId, then retry
992000127	freight template verification failed	check the cause of the verification failure
992000202	goods do not meet the bulky freight template standard	only bulky goods can use bulky freight template
994000006	illegal supplierId or query supplier information failed	set correct supplierId, then retry
994000052	freight template synchronization with goods failed	check the cause of the synchronization failure
996000080	query product warehouse and router information failed	please retry
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.goods.edit.property

bg.goods.edit.property
编辑货品属性
更新时间：2026-02-02 20:43:33
接口介绍：支持开平编辑货品上的属性信息
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
productProperties	LIST	是	货品属性
$item	OBJECT	否	-
vid	INTEGER	是	基础属性值id，没有的情况传0
valueUnit	STRING	是	属性值单位，没有的情况传空字符串
pid	INTEGER	是	属性id
templatePid	INTEGER	是	模板属性id
numberInputValue	STRING	否	数值录入
propValue	STRING	是	基础属性值
propName	STRING	是	引用属性名
refPid	INTEGER	是	引用属性id
productId	INTEGER	是	货品id
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
goodsCommitId	INTEGER	商品草稿ID
matchEditInAudit	BOOLEAN	是否命中修改送审
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1000003	参数错误	结合参数错误的具体原因排查
1000011	无权访问	越权访问了其他用户的数据，请联系管理员处理
2000000	不合法的货品	入参货品id不存在，或者系统抖动，请检查入参后重试
2000010	属性模板查询失败	接口抖动，或者当前类目未配置属性模板，请尝试重试，如果不行联系管理员处理
2000011	自定义规格属性校验失败	请结合校验失败具体原因检查规格入参
2000152	提交失败，当前商品已提交修改，请在当前信息修改完成后再行修改，本次信息修改可在商品列表页或详情页查看进度	货品当前处于治理审核中/待卖家确认的状态，需等先审后发流程结束才能编辑货品
2000166	没有对应的认证，请补充后再提交	店铺缺少HDML/MFI相关资质，请先补充
2000194	商品信息审核中，暂不支持编辑	请稍后重试，如果还不行请联系管理员
4000051	编辑货品属性信息失败	请结合具体的失败原因进行排查与调整
6000002	货品属性校验失败	请结合校验失败具体原因检查属性入参
6000059	童鞋适用年龄和鞋子不匹配，请确认后填写	请确认填写内容
991000000	根据属性模板校验属性失败	请结合校验失败具体原因检查属性入参
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.goods.edit.guide.file

bg.goods.edit.guide.file
编辑货品说明书
更新时间：2026-02-03 14:07:03
接口介绍：编辑货品说明书
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
productId	INTEGER	是	货品id
productGuideFileReqs	LIST	是	货品说明书文件[删除说明书传空List]
$item	OBJECT	否	-
fileName	STRING	是	文件名称
pdfMaterialId	INTEGER	是	pdf文件id
languages	LIST	是	语言
$item	STRING	否	-
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
1000001	服务器开小差	一般是系统抖动，可参考具体报错文案尝试解决或重试，如果还不行请联系管理员
1000003	参数错误	结合参数错误的具体原因排查
1000005	系统异常	尝试重试，如果还不行请联系管理员
1000010	登录校验失败	请检查登录状态
1000011	无权访问	越权访问了其他用户的数据，请联系管理员处理
2000094	说明书文件[x]校验失败，单页应<=[x]M，长x宽应为1600*1200	上传说明书不符合格式要求，请重新上传
2000161	说明书语言错误	说明书语言入参不合法，请检查
2000162	查询素材中心pdf文件信息失败	pdfId错误或者pdf语言后台识别中，请稍后再试
2000163	必须包含英文内容，请重新上传	请检查说明书是否包含英语内容，如有疑问请联系管理员
2000164	无法识别说明内容，请重新上传	说明书不规范，请联系管理员
2000194	商品信息审核中，暂不支持编辑	请稍后重试，如果还不行请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.goods.add.property

bg.goods.add.property
新增货品属性
更新时间：2026-02-02 20:43:11
接口介绍：支持开平新增货品上的属性信息
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
productProperties	LIST	是	货品属性
$item	OBJECT	否	-
vid	INTEGER	是	基础属性值id，没有的情况传0
valueUnit	STRING	是	属性值单位，没有的情况传空字符串
pid	INTEGER	是	属性id
templatePid	INTEGER	是	模板属性id
numberInputValue	STRING	否	数值录入
propValue	STRING	是	基础属性值
propName	STRING	是	引用属性名
refPid	INTEGER	是	引用属性id
productId	INTEGER	是	货品id
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
goodsCommitId	INTEGER	商品草稿ID
matchEditInAudit	BOOLEAN	是否命中修改送审
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
货品API组	He uses type、Self use type
