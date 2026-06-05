# 编辑API组-PA

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 8 个接口


---

## bg.glo.goods.edit.task.submit

bg.glo.goods.edit.task.submit
提交货品修改单
更新时间：2025-08-27 16:57:38
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
productId	INTEGER	是	Product ID
taskUid	STRING	是	Modify Task UID
productPropertyReqs	LIST	否	Product Attributes
$item	OBJECT	否	-
vid	INTEGER	是	Basic Attribute Value ID, pass 0 if none
valueUnit	STRING	是	Unit of Attribute Value, empty string if not available
pid	INTEGER	是	Attribute ID
templatePid	INTEGER	是	Template Attribute ID
numberInputValue	STRING	否	Numerical Input
propValue	STRING	是	Basic Property Value
propName	STRING	是	Reference Property Name
refPid	INTEGER	是	Reference Property ID
taskVersion	INTEGER	是	Task Version Number
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
编辑API组	He uses type、Self use type


---

## bg.glo.goods.edit.sensitive.attr

bg.glo.goods.edit.sensitive.attr
编辑货品敏感品属性
更新时间：2025-08-27 16:57:38
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
productId	INTEGER	是	Product ID
skuReqList	LIST	是	SKU Sensitive Product Attribute Request List
$item	OBJECT	否	-
productSkuSensitiveLimitReq	OBJECT	是	Product SKU Sensitive Attribute Restriction Request (Edit Scenario, Empty Object if No Restriction)
maxBatteryCapacityHp	INTEGER	否	Maximum Battery Capacity (mWh)
maxBatteryCapacity	INTEGER	否	Maximum Battery Capacity (Wh) (Prioritizes maxBatteryCapacityHp)
maxLiquidCapacity	INTEGER	否	Maximum Liquid Capacity (mL) (Prefer using maxLiquidCapacityHp)
maxLiquidCapacityHp	INTEGER	否	Maximum Liquid Capacity (μL)
maxKnifeLength	INTEGER	否	Maximum Tool Length (mm) (Prefer using maxKnifeLengthHp)
maxKnifeLengthHp	INTEGER	否	Maximum Tool Length (μm)
knifeTipAngle	OBJECT	否	Blade Angle
degrees	INTEGER	是	Degree
productSkuId	INTEGER	是	Product SKU ID
productSkuSensitiveAttrReq	OBJECT	是	Product SKU Sensitive Attribute Request
sensitiveTypes	LIST	否	Sensitive Type PURE_ELECTRIC(1, "Pure Electric"), INTERNAL_ELECTRIC(2, "Internal Electric"), MAGNETISM(3, "Magnetism"), LIQUID(4, "Liquid"), POWDER(5, "Powder"), PASTE(6, "Paste"), CUTTER(7, "Tool")
$item	INTEGER	否	-
isSensitive	INTEGER	否	Whether Sensitive Attribute, 0: Non-Sensitive, 1: Sensitive
sensitiveList	LIST	否	Sensitive Type PURE_ELECTRIC(110001,"Pure Electric"), INTERNAL_ELECTRIC(120001, "Internal Electric"), MAGNETISM(130001, "Magnetism"), LIQUID(140001, "Liquid"), POWDER(150001, "Powder"), PASTE(160001, "Ointment"), CUTTER(170001, "Tool")
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
编辑API组	He uses type、Self use type


---

## bg.glo.goods.edit.pictures.submit

bg.glo.goods.edit.pictures.submit
修改商品素材
更新时间：2025-08-27 16:57:38
接口介绍：修改商品素材
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
productCarouseVideoReqList	LIST	否	Main Image Video, empty list implies deletion, null implies no change
$item	OBJECT	否	-
vid	STRING	是	Video VID
coverUrl	STRING	是	Video Cover Image (B-side stores the first frame image)
videoUrl	STRING	是	Video URL
width	INTEGER	是	Video Width
height	INTEGER	是	Video Height
skcList	LIST	否	SKC Information
$item	OBJECT	否	-
skcId	INTEGER	是	Product skcId
skuCommonReqList	LIST	否	SKU Information
$item	OBJECT	否	-
productSkuThumbUrlI18nReqs	LIST	否	SKU Preview Image Multilingual Information Request
$item	OBJECT	否	-
imgUrlList	LIST	否	Image List, empty list implies deletion, null implies no change
$item	STRING	否	-
language	STRING	是	Language
thumbUrl	STRING	是	Preview Image
skuId	INTEGER	是	skuId
previewImgUrls	LIST	是	Carousel List, not required for non-clothing categories
$item	STRING	否	-
productSkcCarouselImageI18nReqs	LIST	否	SKC Carousel Multi-Language Information Request
$item	OBJECT	否	-
imgUrlList	LIST	否	Image List, empty list implies deletion, null implies no change
$item	STRING	否	-
language	STRING	是	Language
colorImageUrl	STRING	否	SKC Color Block Diagram
productId	INTEGER	是	Product ID
productDetailVideoReqList	LIST	否	Detail Video, empty list implies deletion, null implies no change
$item	OBJECT	否	-
vid	STRING	是	Video VID
coverUrl	STRING	是	Video Cover Image (B-side stores the first frame image)
videoUrl	STRING	是	Video URL
width	INTEGER	是	Video Width
height	INTEGER	是	Video Height
goodsLayerDecorationReqs	LIST	否	Product Details Decoration
$item	OBJECT	否	-
floorId	INTEGER	否	Floor ID, null: Create new, otherwise Update
type	STRING	是	Component Type, image - image, text - text
priority	INTEGER	是	Floor Sorting
lang	STRING	是	Language Type
contentList	LIST	是	Floor Content
$item	OBJECT	否	-
imgUrl	STRING	否	Image Address--General
textModuleDetails	OBJECT	否	Text Module Details
backgroundColor	STRING	是	Background Color
fontFamily	INTEGER	否	Font Type
fontSize	INTEGER	是	Text Module Font Size
align	STRING	是	Text Alignment, left--Left Aligned；right--Right Aligned；center--Centered；justify--Justified
fontColor	STRING	是	Text Color
width	INTEGER	否	Image Width--General
text	STRING	否	Text Information--Text Module
height	INTEGER	否	Image Height--General
key	STRING	是	Floor Type Key, currently defaults to 'DecImage'
carouselImageUrls	LIST	否	Commodity Carousel, not required for apparel category, will be aggregated from SKC
$item	STRING	否	-
carouselImageI18nReqs	LIST	否	Commodity Carousel Multi-Language Info Request, not required for apparel category, will be aggregated from SKC
$item	OBJECT	否	-
imgUrlList	LIST	否	Image List, empty list implies deletion, null implies no change
$item	STRING	否	-
language	STRING	是	Language
materialImgUrl	STRING	否	Material Image
materialMultiLanguages	LIST	否	Image Multilingual List
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
编辑API组	He uses type、Self use type


---

## bg.glo.goods.update

bg.glo.goods.update
货品更新接口
更新时间：2025-08-27 16:57:38
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
productWhExtAttrReq	OBJECT	否	Commodity Warehouse and Supply Chain Extension Properties Request
productOrigin	OBJECT	是	Product Origin
region2Id	INTEGER	否	Secondary Region ID
region1ShortName	STRING	是	First-Level Region Abbreviation (Two-Character Code)
supplierId	INTEGER	是	Supplier ID
productId	INTEGER	是	Product ID
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
编辑API组	He uses type、Self use type


---

## bg.glo.goods.add.property

bg.glo.goods.add.property
新增货品属性
更新时间：2025-08-27 16:57:38
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
productProperties	LIST	是	Product Attributes
$item	OBJECT	否	-
vid	INTEGER	是	Basic Attribute Value ID, pass 0 if none
valueUnit	STRING	是	Unit of Attribute Value, empty string if not available
pid	INTEGER	是	Attribute ID
templatePid	INTEGER	是	Template Attribute ID
numberInputValue	STRING	否	Numerical Input
propValue	STRING	是	Basic Property Value
propName	STRING	是	Reference Property Name
refPid	INTEGER	是	Reference Property ID
productId	INTEGER	是	Product ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
goodsCommitId	INTEGER	Product Draft ID
matchEditInAudit	BOOLEAN	Whether to Hit Modify for Review
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
2000000	不合法的货品	入参货品id不存在，或者系统抖动，请检查入参后重试
4000040	新增货品属性信息失败：xxxx	更新失败，请结合具体失败原因处理
4000041	仅支持新增属性，不支持修改	当前接口仅支持新增
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
编辑API组	He uses type、Self use type


---

## bg.glo.goods.edit.property

bg.glo.goods.edit.property
编辑货品属性
更新时间：2025-08-27 16:57:38
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
productProperties	LIST	是	Product Attributes
$item	OBJECT	否	-
vid	INTEGER	是	Basic Attribute Value ID, pass 0 if none
valueUnit	STRING	是	Unit of Attribute Value, empty string if not available
pid	INTEGER	是	Attribute ID
templatePid	INTEGER	是	Template Attribute ID
numberInputValue	STRING	否	Numerical Input
propValue	STRING	是	Basic Property Value
propName	STRING	是	Reference Property Name
refPid	INTEGER	是	Reference Property ID
productId	INTEGER	是	Product ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
goodsCommitId	INTEGER	Product Draft ID
matchEditInAudit	BOOLEAN	Whether to Hit Modify for Review
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
编辑API组	He uses type、Self use type


---

## bg.glo.goodslogistics.template.edit

bg.glo.goodslogistics.template.edit
编辑商品运费模板
更新时间：2025-08-27 16:57:38
接口介绍：编辑商品运费模板
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
productShipment	OBJECT	是	Commodity Delivery Information
freightTemplateId	STRING	是	Shipping Template ID
shipmentLimitSecond	INTEGER	是	Promised Delivery Time (unit: s)
supplierId	INTEGER	是	Supplier ID
productId	INTEGER	是	Product ID
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
编辑API组	He uses type、Self use type


---

## bg.glo.goods.edit.task.apply

bg.glo.goods.edit.task.apply
发起货品修改单
更新时间：2026-03-06 22:08:06
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
bizIdType	INTEGER	是	Business ID Type (1: Product ID)
productEditItems	LIST	是	Edit Item List
$item	OBJECT	否	-
editAdvice	STRING	是	Edit Advice
editItem	INTEGER	是	Edit Item (3: Product Property)
bizIds	LIST	是	Business ID List
$item	INTEGER	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
addFailedList	LIST	List of Failed Additions
$item	OBJECT	-
failedBizId	INTEGER	Failed Business ID
failedReason	STRING	Failure Reason
handleFailedList	LIST	Failed Processing List
$item	OBJECT	-
failedBizId	INTEGER	Failed Business ID
failedReason	STRING	Failure Reason
successBizId2TaskUidMap	MAP	Successful id -> Task uid
$key	STRING	-
$value	STRING	-
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1000001	Business Exception	Usually caused by system instability. Refer to the specific error message and retry.
1000003	Parameter Error	Refer to the specific error message and retry.
1000004	System Exception	Retry, otherwise please contact the administrator.
2000042	Illegal Edit Item	The current edit item is not supported or does not exist. Please check the input parameters.
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type
