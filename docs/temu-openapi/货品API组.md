# 货品API组

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 12 个接口


---

## bg.goods.add

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


---

## bg.goods.warehouse.list.get

bg.goods.warehouse.list.get
根据站点查询可绑定的发货仓库信息接口
更新时间：2026-02-05 19:53:03
接口介绍：根据站点列表查询自发货模式品可绑定的发货仓信息
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
openApiUser	OBJECT	是	用户信息
supplierId	INTEGER	是	供应商id
siteIdList	LIST	是	站点列表.
$item	INTEGER	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
warehouseDTOList	LIST	站点可选发货仓列表
$item	OBJECT	-
validWarehouseList	LIST	可选发货仓列表
$item	OBJECT	-
warehouseDisable	BOOLEAN	仓库是否失效
warehouseId	STRING	仓库id
warehouseName	STRING	仓库名称
managementType	STRING	仓库类型 0: 三方仓,1:自建仓,2:家庭仓,3:其他(仅适用于9个工作日发货时效的商品)
siteId	INTEGER	站点id
siteName	STRING	站点名称
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
2000060	店铺类型不符合预期，不允许查询或变更库存操作	检查店铺ID
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
半托管库存API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.goods.topselling.soldout.get

bg.goods.topselling.soldout.get
批量查询爆款售罄商品
更新时间：2026-02-03 14:09:22
接口介绍：批量查询爆款售罄商品
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
sellOutProducts	LIST	售罄货品列表
$item	OBJECT	-
sellOutProductId	STRING	售罄货品id
productPicture	STRING	售罄货品主图
categories	OBJECT	售罄货品类目
cat4	OBJECT	四级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat5	OBJECT	五级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat2	OBJECT	二级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat3	OBJECT	三级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat1	OBJECT	一级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat10	OBJECT	十级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
leafCat	OBJECT	叶子类目
catId	INTEGER	类目ID
catName	STRING	类目名称
catType	INTEGER	类目类型 (0: 未分类, 1: 服饰)
cat8	OBJECT	八级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat9	OBJECT	九级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat6	OBJECT	六级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat7	OBJECT	七级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
bindSites	LIST	售罄货品绑定站点列表
$item	OBJECT	-
siteId	INTEGER	站点id
siteName	STRING	站点名称
productName	STRING	售罄货品名称
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1000001	服务器开小差	一般是系统抖动，可参考具体报错文案尝试解决或重试，如果还不行请联系管理员
1000005	系统异常	尝试重试，如果还不行请联系管理员
6000098	批量查询售罄货品失败	查询售罄货品信息接口抖动，请重试
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
ISV基础接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.product.search

bg.product.search
查询货品生命周期状态
更新时间：2026-03-20 14:34:14
接口介绍：外部erp系统，查询货品生命周期状态
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
productSkuIdList	LIST	否	货品skuId列表
$item	INTEGER	否	-
mallId	INTEGER	是	商家Id
pageSize	INTEGER	是	页大小
pageNum	INTEGER	是	页编号(从1开始)
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	总数
dataList	LIST	数据列表
$item	OBJECT	-
skcList	LIST	skc列表
$item	OBJECT	-
skcId	INTEGER	货品skcId
selectStatus	INTEGER	选品状态
skuList	LIST	sku列表
$item	OBJECT	-
skuId	INTEGER	货品skuId
applyJitStatus	INTEGER	申诉JIT的状态(1-可申请；3-不可申请)
suggestCloseJit	BOOLEAN	是否建议关闭JIT按钮
productId	INTEGER	货品id
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
2000000	BUSINESS_EXCEPTION	业务异常，可联系具体对接人员。
3000000	pageSize is not null; pageSize max value 100; pageSize min value 1; 等等具体的参数异常信息。	参数异常，使用正确的参数。
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.goods.brand.get

bg.goods.brand.get
货品品牌查询
更新时间：2025-08-12 14:32:35
接口介绍：大卖家，对应货品发布的时候，设置自己品牌
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
vid	INTEGER	否	搜索的属性值id
brandName	STRING	否	搜索的品牌名称
supplierId	INTEGER	是	供应商id
pageSize	INTEGER	是	页面大小
page	INTEGER	是	页码
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	总数
pageItems	LIST	当前页结果
$item	OBJECT	-
vid	INTEGER	属性值id
brandId	INTEGER	品牌id
brandNameEn	STRING	品牌英文名
pid	INTEGER	基础属性值id
regSerialCode	STRING	注册序列号
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1000001	服务器开小差	一般为系统抖动，可尝试重试，如果还是不行请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.goods.suggest.supplyprice.get

bg.goods.suggest.supplyprice.get
查询建议申报参考价
更新时间：2025-01-21 17:45:29
接口介绍：查询脱敏后建议申报参考价
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
url	STRING	是	同款url
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
sameReferPriceList	LIST	同款价格
$item	OBJECT	-
currencyType	STRING	币种 (CNY: 人民币, USD: 美元)
maskMaxPrice	STRING	最大推荐价格
maskMinPrice	STRING	最小推荐价格
uuid	STRING	唯一标识
url	STRING	同款url
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
3000002	当日请求额度已用完，请明日重试	当日请求额度已用完，请明日重试
4000006	入参店铺id不合法，或者查询店铺信息失败	重试请求，如果还是不行请联系管理员处理
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.goods.detail.get

bg.goods.detail.get
商品详情查询接口
更新时间：2026-02-03 14:06:36
接口介绍：查询商品详情信息
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
productId	LONG	是	货品ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
productId	INTEGER	货品ID
categories	OBJECT	类目
cat4	OBJECT	四级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat5	OBJECT	五级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat2	OBJECT	二级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat3	OBJECT	三级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat1	OBJECT	一级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat10	OBJECT	十级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
leafCat	OBJECT	叶子类目
catId	INTEGER	类目ID
catName	STRING	类目名称
catType	INTEGER	类目类型 (0: 未分类, 1: 服饰)
cat8	OBJECT	八级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat9	OBJECT	九级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat6	OBJECT	六级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat7	OBJECT	七级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
productWhExtAttr	OBJECT	货品仓配供应链扩展属性
productOrigin	OBJECT	货品产地信息
region2Id	INTEGER	二级区域id
region1ShortName	STRING	一级区域简称 (二字简码)
goodsLayerDecorationList	LIST	商详装修信息
$item	OBJECT	-
floorId	INTEGER	楼层id,null:新增,否则为更新
lang	STRING	语言类型
type	STRING	组件类型type
priority	INTEGER	楼层排序
contentList	LIST	楼层内容
$item	OBJECT	-
imgUrl	STRING	图片地址--通用
textModuleDetails	OBJECT	文字模块详情
backgroundColor	STRING	背景颜色
fontFamily	INTEGER	字体类型
fontSize	INTEGER	文字模块字体大小
align	STRING	文字对齐方式，left--左对齐；right--右对齐；center--居中；justify--两端对齐
fontColor	STRING	文字颜色
width	INTEGER	图片宽度--通用
text	STRING	文字信息--文字模块
height	INTEGER	图片高度--通用
key	STRING	楼层类型的key
productName	STRING	货品名称
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
991000005	系统异常	系统异常，请联系管理员
991000011	无权访问	检查是否有该货品权限
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.goods.list.get

bg.goods.list.get
商品列表查询
更新时间：2025-11-24 16:31:35
接口介绍：1、新增创建时间出入参查询 2、增加SKC维度JIT状态查询
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
cat7Id	INTEGER	否	七级类目id
createdAtStart	INTEGER	否	创建时间开始
cat8Id	INTEGER	否	八级类目id
skcExtCode	STRING	否	货品skc外部编码
cat9Id	INTEGER	否	九级类目id
cat3Id	INTEGER	否	三级类目id
cat4Id	INTEGER	否	四级类目id
cat5Id	INTEGER	否	五级类目id
cat6Id	INTEGER	否	六级类目id
pageSize	INTEGER	否	页面大小
cat1Id	INTEGER	否	一级类目id
cat2Id	INTEGER	否	二级类目id
productName	STRING	否	货品名称
isSupportPersonalization	BOOLEAN	否	是否支持定制品
productSkcIds	LIST	否	货品skcId列表
$item	INTEGER	否	-
quickSellAgtSignStatus	INTEGER	否	快速售卖协议签署状态 0-未签署 1-已签署
matchJitMode	BOOLEAN	否	是否命中JIT模式
cat10Id	INTEGER	否	十级类目id
bindSiteIds	LIST	否	经营站点id列表
$item	INTEGER	否	-
skcSiteStatus	INTEGER	否	skc加站点状态 (0: 未加入站点, 1: 已加入站点)
page	INTEGER	否	页码
createdAtEnd	INTEGER	否	创建时间结束
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
data	LIST	结果列表
$item	OBJECT	-
productProperties	LIST	货品普通属性
$item	OBJECT	-
vid	INTEGER	基础属性值id
valueUnit	STRING	属性值单位
language	STRING	语种
pid	INTEGER	属性id
templatePid	INTEGER	模板属性id
numberInputValue	STRING	数值录入
propValue	STRING	基础属性值
propName	STRING	引用属性名
valueExtendInfo	STRING	属性值扩展信息
refPid	INTEGER	引用属性id
productId	INTEGER	货品Id
productJitMode	OBJECT	货品JIT模式信息
signLatestJitVersion	BOOLEAN	是否签署最新版本JIT预售协议
quickSellAgtSignStatus	INTEGER	快速售卖协议签署状态 0-未签署 1-已签署
matchJitMode	BOOLEAN	是否JIT模式
productSkuSummaries	LIST	sku概要信息列表
$item	OBJECT	-
productSkuId	INTEGER	货品skuId
extCode	STRING	sku货号
productSkuWhExtAttr	OBJECT	货品sku仓配侧扩展属性
productSkuWeight	OBJECT	重量
value	INTEGER	重量值 (毫米)
productSkuWmsVolume	OBJECT	WMS体积
len	INTEGER	长 (毫米)
wmsCollectionSourceType	INTEGER	WMS采集来源 (和WMS的枚举不一致, 只记录感兴趣的来源)
width	INTEGER	宽 (毫米)
height	INTEGER	高 (毫米)
productSkuBarCodes	LIST	条码
$item	OBJECT	-
code	STRING	条码
codeType	INTEGER	条码类型 (1: EAN, 2: UPC, 3: ISBN)
productSkuSubSellMode	INTEGER	子销售模式
productSkuSensitiveAttr	OBJECT	敏感属性
sensitiveTypes	LIST	敏感类型， PURE_ELECTRIC(1, "纯电"), INTERNAL_ELECTRIC(2, "内电"), MAGNETISM(3, "磁性"), LIQUID(4, "液体"), POWDER(5, "粉末"), PASTE(6, "膏体"), CUTTER(7, "刀具")
$item	INTEGER	-
isSensitive	INTEGER	是否敏感属性，0：非敏感，1：敏感
productSkuFragileLabels	OBJECT	易损标签
isFragile	BOOLEAN	是否易损品
productSkuNewSensitiveAttr	OBJECT	敏感属性
force2NormalTypes	LIST	强转普类型
$item	INTEGER	-
sensitiveList	LIST	敏感品类型
$item	INTEGER	-
isForce2Normal	BOOLEAN	是否强制转普货
productSkuVolumeLabel	OBJECT	体积标签
isSideOverLength	BOOLEAN	是否超长边
isVolumeOverSize	BOOLEAN	是否超大体积
productSkuWmsWeight	OBJECT	WMS重量
wmsCollectionSourceType	INTEGER	WMS采集来源 (和WMS的枚举不一致, 只记录感兴趣的来源)
value	INTEGER	重量值 (毫克)
productSkuVolume	OBJECT	体积
len	INTEGER	长 (毫米)
width	INTEGER	宽 (毫米)
height	INTEGER	高 (毫米)
productSkuSensitiveLimit	OBJECT	敏感属性限制
maxBatteryCapacityHp	INTEGER	最大电池容量 (mWh)
maxBatteryCapacity	INTEGER	最大电池容量 (Wh)
maxLiquidCapacity	INTEGER	最大液体容量 (mL)
maxLiquidCapacityHp	INTEGER	最大液体容量 (μL)
maxKnifeLength	INTEGER	最大刀具长度 (mm)
maxKnifeLengthHp	INTEGER	最大刀具长度 (μm)
productSkuWmsVolumeLabel	OBJECT	WMS体积标签
isSideOverLength	BOOLEAN	是否超长边
isVolumeOverSize	BOOLEAN	是否超大体积
virtualStock	INTEGER	虚拟库存
productSkuSpecList	LIST	规格列表
$item	OBJECT	-
specId	INTEGER	规格id
parentSpecName	STRING	父规格名称
parentSpecId	INTEGER	父规格id
specName	STRING	规格名称
productSkuSaleExtAttr	OBJECT	货品sku销售域扩展属性
productSkuShippingMode	INTEGER	货品sku发货模式
productName	STRING	货品名称
createdAt	INTEGER	上架时间
productSemiManaged	OBJECT	货品半托管信息
productShipment	OBJECT	货品配送信息
freightTemplateId	STRING	运费模板id
shipmentLimitSecond	INTEGER	承诺发货时间(单位:s)
warehouseRegionId1List	LIST	发货仓一级区域id列表
$item	INTEGER	-
bindSites	LIST	绑定站点列表
$item	OBJECT	-
siteId	INTEGER	站点id
siteName	STRING	站点名称
isSupportPersonalization	BOOLEAN	是否支持定制品
extCode	STRING	货品skc外部编码
leafCat	OBJECT	叶子类目
catId	INTEGER	类目ID
catName	STRING	类目名称
skcSiteStatus	INTEGER	skc加站点状态
categories	OBJECT	类目
cat4	OBJECT	四级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat5	OBJECT	五级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat2	OBJECT	二级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat3	OBJECT	三级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat1	OBJECT	一级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat10	OBJECT	十级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
leafCat	OBJECT	叶子类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat8	OBJECT	八级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat9	OBJECT	九级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat6	OBJECT	六级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
cat7	OBJECT	七级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
productSkcId	INTEGER	货品skcId
mainImageUrl	STRING	skc主图
matchSkcJitMode	BOOLEAN	是否命中skc层JIT模式
totalCount	INTEGER	总数
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1000001	服务器开小差	一般是系统抖动，可参考具体报错文案尝试解决或重试，如果还不行请联系管理员
1000003	参数错误	结合参数错误的具体原因排查，比如页面大小不能大于100等
1000005	系统异常	尝试重试，如果还不行请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.goods.migrate

bg.goods.migrate
货品搬运接口
更新时间：2026-02-02 20:44:54
接口介绍：半托管店铺搬运同主体下全托管店铺的货品
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
migrationList	LIST	是	搬运列表
$item	OBJECT	否	搬运内容
productSemiManagedReq	OBJECT	是	半托管货品信息
bindSiteIds	LIST	是	绑定站点列表
$item	INTEGER	否	站点id
semiManagedSiteMode	INTEGER	否	半托管站点售卖模式
productWarehouseRouteReq	OBJECT	是	货品仓库路由信息
targetRouteList	LIST	是	目标自发货站点-仓关系列表
$item	OBJECT	否	自发货站点-仓关系
siteIdList	LIST	是	站点ID列表
$item	INTEGER	否	站点ID
warehouseId	STRING	是	仓库ID
skcDetails	LIST	是	skc明细列表
$item	OBJECT	否	skc明细
skuDetails	LIST	是	sku明细列表
$item	OBJECT	否	sku明细
currencyType	STRING	是	币种
specList	LIST	是	sku规格列表
$item	OBJECT	否	sku规格
specId	INTEGER	是	规格id
parentSpecName	STRING	是	父规格名称
parentSpecId	INTEGER	是	父规格id
specName	STRING	是	规格名称
siteSupplierPrices	LIST	是	站点供货价列表
$item	OBJECT	否	站点供货价
siteId	INTEGER	是	申报价格站点id
supplierPrice	INTEGER	是	站点申报价格，单位 人民币：分，美元：美分
specList	LIST	是	skc规格列表
$item	OBJECT	否	skc规格
specId	INTEGER	是	规格id
parentSpecName	STRING	是	父规格名称
parentSpecId	INTEGER	是	父规格id
specName	STRING	是	规格名称
sourceProductId	INTEGER	是	来源货品id
productShipmentReq	OBJECT	是	货品配送信息
freightTemplateId	STRING	是	运费模板id
shipmentLimitSecond	INTEGER	是	承诺发货时间(单位:s)
warehouseSkuStockAvailable	INTEGER	是	仓内每个sku的库存
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
migrationRetList	LIST	搬运结果列表
$item	OBJECT	-
productDraftId	INTEGER	货品草稿id (搬品成功后, productDraftId=productId)
sourceProductId	INTEGER	源货品id
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
991000001	服务器开小差	请根据详细报错文案做相应调整，如有疑问联系管理员
991000002	参数错误	检查传参是否满足接口协议
991000003	bad paramater	see the detail of the parameter error
991000005	system exception	try again later, if that doesn't work, contact the administrator
991000011	forbidden request, current supplier cannot query another supplier's data	query your own data
991000012	system busy, please try again later	try again later
992000000	invalid product	ProductId not exist, or system busy. Check productId and retry
992000125	illegal freightTemplateId or query freightTemplateId failed	set correct freightTemplateId, then retry
992000127	freight template verification failed	check the cause of the verification failure
992000202	goods do not meet the bulky freight template standard	only bulky goods can use bulky freight template
996000080	query product warehouse and router information failed	please retry
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.logistics.template.get

bg.logistics.template.get
查询运费模板列表
更新时间：2026-02-10 15:12:33
接口介绍：查询运费模版，用于半托管商品的API发布时关联运费模版ID
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
siteIds	LIST	否	站点列表
$item	INTEGER	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
freightTemplates	LIST	运费模板概要信息列表
$item	OBJECT	-
freightTemplateId	STRING	运费模板id
templateName	STRING	运费模板名称
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
半托管物流API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.goods.file.upload

bg.goods.file.upload
货品文件上传接口
更新时间：2026-02-09 14:16:07
接口介绍：货品文件上传接口
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
fileName	STRING	是	文件名称，需要带文件扩展，eg: test.pdf
bizScene	STRING	是	文件使用场景. 可选值含义说明:[CERTIFICATE_OF_ORIGIN:产地证明，支持文件格式：['pdf', 'png', 'jpeg', 'jpg']，文件最大3MB;]
fileBase64	STRING	是	文件base64
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
fileUrl	STRING	文件链接
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
120000000	系统异常，请稍后再试	一般为系统抖动，请稍后重试
120000024	文件上传传入使用场景非法	请检查上传文件使用场景是否支持
120000025	文件类型非法	请检查文件类型是否支持
120000026	文件大小超过限制	请检查文件大小是否满足条件
120000027	文件上传失败，请稍后再试	一般为系统抖动，请稍后重试
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.goods.customs.property.check

bg.goods.customs.property.check
货品清关属性校验接口
更新时间：2026-04-12 14:08:13
接口介绍：新增货品清关属性校验接口
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
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
checkResultList	LIST	校验结果列表
$item	OBJECT	-
productSkuId	INTEGER	货品skuId
text	STRING	说明文案
checkResult	BOOLEAN	校验结果
url	STRING	跳转链接
checkCode	INTEGER	校验结果编码
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
991000005	系统异常	系统异常，请联系管理员
991000011	无权访问	检查是否有该货品权限
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type
