# 货品API组-PA

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 11 个接口


---

## bg.glo.goods.add

bg.glo.goods.add
上传供应商货品
更新时间：2026-04-27 16:34:27
接口介绍：用于发布货品
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
productSemiManagedReq	OBJECT	否	Semi-managed Merchant Information
semiLanguageStrategy	INTEGER	否	Semi-Managed - Material Language Strategy
bindSiteIds	LIST	是	Bound Site List
$item	INTEGER	否	-
semiManagedSiteMode	INTEGER	否	Semi-managed Site Sales Mode
carouselImageUrls	LIST	否	Commodity Carousel, not required for apparel category, will be aggregated from skc
$item	STRING	否	-
productOuterPackageImageReqs	LIST	否	Outer Packaging Image
$item	OBJECT	否	-
imageUrl	STRING	是	Image Link
copyFromProductId	INTEGER	否	Replicated Source Product ID
source	INTEGER	否	Product Source
productName	STRING	是	Product Name
productI18nReqs	LIST	否	Product Multilingual Information Request
$item	OBJECT	否	-
language	STRING	是	Language Code
productName	STRING	是	Product Name
sellOutProductIdSrc	INTEGER	否	Sold Out Product ID Src
productShipmentReq	OBJECT	否	Product Delivery Information Request
freightTemplateId	STRING	是	Shipping Template ID
shipmentLimitSecond	INTEGER	是	Promised Delivery Time (unit: s). Basic options: 86400, 172800, 259200 (available only for custom items).
cat8Id	INTEGER	是	Eight-level Category ID, pass 0 if none
cat4Id	INTEGER	是	Fourth-Level Category ID, pass 0 if none
cat6Id	INTEGER	是	Sixth-Level Category ID, pass 0 if none
showSizeTemplateIds	LIST	否	Key Display Size Table Template ID List
$item	INTEGER	否	-
cat2Id	INTEGER	是	Secondary Category ID, pass 0 if none
productSpecPropertyReqs	LIST	是	Product Specification Attribute
$item	OBJECT	否	-
vid	INTEGER	是	Basic Attribute Value ID, pass 0 if none
specId	INTEGER	是	Specification ID
valueGroupId	INTEGER	是	Attribute Value Group ID, 0 if none
parentSpecId	INTEGER	是	Parent Specification ID
valueGroupName	STRING	是	Attribute Group Name, pass empty string if none
valueUnit	STRING	是	Unit of Attribute Value, empty string if not available
pid	INTEGER	是	Attribute ID
templatePid	INTEGER	是	Template Attribute ID
numberInputValue	STRING	否	Numerical Input
propValue	STRING	是	Basic Property Value
propName	STRING	是	Reference Property Name
refPid	INTEGER	是	Reference Property ID
vehicleLibraryRelationReqList	LIST	否	Vehicle Model Library Configuration
$item	OBJECT	否	-
productPropValueDependencyReqList	LIST	否	Attribute Value Dependency Configuration
$item	OBJECT	否	-
propertyValueDependencyId5	INTEGER	否	Attribute Value Depends on id5
propertyValueDependencyId4	INTEGER	否	Attribute Value Depends on id4
propertyValueDependencyId3	INTEGER	否	Attribute Value Dependent on id3
propertyValueDependencyId2	INTEGER	否	Attribute Value Depends on id2
propertyValueDependencyId9	INTEGER	否	Attribute Value Depends on id9
propertyValueDependencyId8	INTEGER	否	Attribute Value Depends on id8
propertyValueDependencyId7	INTEGER	否	Attribute Value Depends on id7
propertyValueDependencyId6	INTEGER	否	Attribute Value Depends on id6
propertyValueDependencyId10	INTEGER	否	Attribute Value Depends on id10
propertyValueDependencyId1	INTEGER	否	Attribute Value Dependent ID 1
vehicleLibraryId	INTEGER	是	Vehicle Model ID
productCarouseVideoReqList	LIST	否	Carousel Video
$item	OBJECT	否	-
vid	STRING	是	Video VID
coverUrl	STRING	是	Video Cover Image (B-side stores the first frame image)
videoUrl	STRING	是	Video URL
width	INTEGER	是	Video Width
height	INTEGER	是	Video Height
goodsLayerDecorationReqs	LIST	否	Product Details Decoration
$item	OBJECT	否	-
floorId	INTEGER	否	Floor ID, null: Create new, otherwise Update
goodsId	INTEGER	否	Product ID
lang	STRING	是	Language Type
type	STRING	是	Component Type, image - image, text - text
priority	INTEGER	是	Floor Sorting
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
productPropertyReqs	LIST	是	Product Attributes
$item	OBJECT	否	-
vid	INTEGER	是	Basic Attribute Value ID, pass 0 if none
valueUnit	STRING	是	Unit of Attribute Value, empty string if not available
pid	INTEGER	是	Attribute ID
templatePid	INTEGER	是	Template Attribute ID
numberInputValue	STRING	否	Numerical Input
propValue	STRING	是	Basic Property Value
propName	STRING	是	Reference Property Name
refPid	INTEGER	是	Reference Property ID
productGuideFileReqs	LIST	否	Product Manual File Multilingual
$item	OBJECT	否	-
fileName	STRING	是	File Name
pdfMaterialId	INTEGER	是	PDF File ID
languages	LIST	是	Language
$item	STRING	否	-
materialMultiLanguages	LIST	否	Image Multilingual List
$item	STRING	否	-
productWarehouseRouteReq	OBJECT	否	Commodity Warehouse Routing Request
targetRouteList	LIST	是	Target Self-Delivery Site-Warehouse Relationship
$item	OBJECT	否	-
siteIdList	LIST	是	Site ID.
$item	INTEGER	否	-
warehouseId	STRING	是	Warehouse ID
currentRouteList	LIST	否	Current Self-Delivery Station-Warehouse Relationship
$item	OBJECT	否	-
siteIdList	LIST	是	Site ID.
$item	INTEGER	否	-
warehouseId	STRING	是	Warehouse ID
goodsModelReqs	LIST	否	Product Model List Request
$item	OBJECT	否	-
modelProfileUrl	STRING	是	Model Portrait
sizeSpecName	STRING	是	Trial Size Specification Name
modelId	INTEGER	是	Model ID, not transmitted for new virtual model scenarios
sizeSpecId	INTEGER	是	Fitting Size Specification ID
modelWaist	STRING	否	Model Waistline Text
modelType	INTEGER	否	Model Type, 1: Garment Model, 2: Shoe Model
modelName	STRING	是	Model Name
modelHeight	STRING	否	Model Height Text
modelFeature	INTEGER	否	Model Properties, 1: Real Model, 2: Virtual Model
modelFootWidth	STRING	否	Model Foot Width Text
modelBust	STRING	否	Model Bust Text
modelFootLength	STRING	否	Model Long Text
tryOnResult	INTEGER	否	Try-on Experience，TRUE_TO_SIZE(1, "Comfortable")TOO_SMALL(2, "Tight-fitting")TOO_LARGE(3, \"Relaxed\")
modelHip	STRING	否	Model Hip Text
sizeTemplateId	INTEGER	否	Size Chart Template ID
productOuterPackageReq	OBJECT	否	Product Outer Packaging Information
packageShape	INTEGER	否	Outer Packaging Shape
packageType	INTEGER	否	Outer Packaging Type
sourceInvitationId	INTEGER	否	Source Invitation ID
sensitiveTransNormalFileReqs	LIST	否	Sensitive Product Conversion to General Proof Document List
$item	OBJECT	否	-
fileName	STRING	是	File Name
fileUrl	STRING	是	File Path
cat7Id	INTEGER	是	Seventh-Level Category ID, pass 0 if none
sellOutProductId	STRING	否	Sold Out Product ID
cat9Id	INTEGER	是	9th Level Category ID, pass 0 if none
cat3Id	INTEGER	是	Third-Level Category ID, pass 0 if none
productDetailVideoReqList	LIST	否	Detail Video
$item	OBJECT	否	-
vid	STRING	是	Video VID
coverUrl	STRING	是	Video Cover Image (B-side stores the first frame image)
videoUrl	STRING	是	Video URL
width	INTEGER	是	Video Width
height	INTEGER	是	Video Height
cat5Id	INTEGER	是	Fifth-Level Category ID, pass 0 if none
cat1Id	INTEGER	是	First-Level Category ID
carouselImageI18nReqs	LIST	否	Product Carousel Multi-Language Info Request
$item	OBJECT	否	-
imgUrlList	LIST	否	Image List, empty list implies deletion, null implies no change
$item	STRING	否	-
language	STRING	是	Language
sizeTemplateIds	LIST	否	Size Chart Template ID List
$item	INTEGER	否	-
productWhExtAttrReq	OBJECT	否	Commodity Warehouse and Supply Chain Extension Properties Request
productOriginCertFiles	LIST	否	Product Origin Certificate Files
$item	OBJECT	否	-
fileName	STRING	是	File Name
fileUrl	STRING	是	File Url
outerGoodsUrl	STRING	是	Off-Site Product Link (Pass Empty String as Fallback)
productOrigin	OBJECT	是	Product Origin
region2Id	INTEGER	否	Secondary Region ID
region1ShortName	STRING	是	First-Level Region Abbreviation (Two-Character Code)
productSkcReqs	LIST	是	Product SKC List
$item	OBJECT	否	-
extCode	STRING	是	Product SKC External Code, pass empty string if not available
productSkuReqs	LIST	是	Product SKU List (up to 10 for Apparel Category)
$item	OBJECT	否	-
currencyType	STRING	是	Currency (CNY: Chinese Yuan, USD: US Dollar) (Default: Chinese Yuan)
productSkuMultiPackReq	OBJECT	否	Product Multi-Package Request
numberOfPieces	INTEGER	否	Quantity, default is 1 for single item
individuallyPacked	INTEGER	否	Whether to use independent packaging (pass -1 to clear)
productSkuNetContentReq	OBJECT	否	Net Content Request, passing an empty object indicates clearing
netContentUnitCode	INTEGER	否	Net Content Unit, 1: Fluid Ounce, 2: Milliliter, 3: Gallon, 4: Liter, 5: Gram, 6: Kilogram, 7: Troy Ounce, 8: Pound
netContentNumber	INTEGER	否	Net Content Value, the target value needs to be multiplied by 1000 before passing the value. For example, if you are passing "1 L", you need to pass "1000" in "netContentNumber".
mixedType	INTEGER	否	Mixed set type, 1: different products, 2: same product with different specifications
totalNetContent	OBJECT	否	Total Net Content
netContentUnitCode	INTEGER	否	Net Content Unit, 1: Fluid Ounce, 2: Milliliter, 3: Gallon, 4: Liter, 5: Gram, 6: Kilogram, 7: Troy Ounce, 8: Pound
netContentNumber	INTEGER	否	Net Content Value, the target value needs to be multiplied by 1000 before passing the value. For example, if you are passing "1 L", you need to pass "1000" in "netContentNumber".
pieceNewUnitCode	INTEGER	否	Unit, 1: piece
skuClassification	INTEGER	否	Sku Category, 1: Single Product, 2: Combination Set, 3: Mixed Suite
numberOfPiecesNew	INTEGER	否	Total quantity contained
pieceUnitCode	INTEGER	否	Unit per Item, 1: Piece, 2: Pair, 3: Pack
productSkuSuggestedPriceReq	OBJECT	否	Product SKU Suggested Price Request
suggestedPriceCurrencyType	STRING	否	Recommended Price Currency
suggestedPrice	INTEGER	否	Suggested Price
specialSuggestedPrice	STRING	否	Special Suggested Price
siteSupplierPrices	LIST	否	Site Supply Price List, for semi_managed merchant scenario only
$item	OBJECT	否	-
siteId	INTEGER	是	Declared Price Site ID
supplierPrice	INTEGER	是	Site Declared Price, Unit: RMB: Fen, USD: Cent
supplierPrice	INTEGER	否	Supply Price, deprecated in semi_managed merchant scenario
productSkuUsSuggestedPriceReq	OBJECT	否	Product SKU US Suggested Price Request
suggestedPriceCurrencyType	STRING	否	Recommended Price Currency
suggestedPrice	INTEGER	否	Suggested Price
specialSuggestedPrice	STRING	否	Special Suggested Price
productSkuStockQuantityReq	OBJECT	否	Product SKU Inventory Request
warehouseStockQuantityReqs	LIST	是	Outbound Warehouse Inventory Request List
$item	OBJECT	否	-
targetStockAvailable	INTEGER	是	Target Inventory
warehouseId	STRING	是	Warehouse ID
currentStockAvailable	INTEGER	否	Current Stock
extCode	STRING	是	Product SKC External Code, pass empty string if not available
productSkuThumbUrlI18nReqs	LIST	否	SKU Preview Image Multilingual Information Request
$item	OBJECT	否	-
imgUrlList	LIST	否	Image List, empty list implies deletion, null implies no change
$item	STRING	否	-
language	STRING	是	Language
productSkuAccessoriesReq	OBJECT	否	Product SKU Accessories Request
productSkuAccessories	LIST	是	Accessories List
$item	OBJECT	否	-
vid	INTEGER	是	Accessory Property Value ID
num	INTEGER	是	Accessory Quantity
unitCode	INTEGER	是	Unit Code
thumbUrl	STRING	是	Preview Image
productSkuWhExtAttrReq	OBJECT	是	Product SKU Extended Attributes
productSkuWeightReq	OBJECT	是	Product SKU Weight
inputUnit	STRING	否	Input Unit
inputValue	STRING	否	Input Weight Value
value	INTEGER	是	Weight Value, unit mg
productSkuSameReferPriceReq	OBJECT	否	Same Style Reference
url	STRING	否	Same Style URL
productSkuSensitiveLimitReq	OBJECT	是	Product SKU Sensitive Attribute Restriction Request
maxBatteryCapacityHp	INTEGER	否	Maximum Battery Capacity (mWh)
maxBatteryCapacity	INTEGER	否	Maximum Battery Capacity (Wh) (Prioritizes maxBatteryCapacityHp)
maxLiquidCapacity	INTEGER	否	Maximum Liquid Capacity (mL) (Prefer using maxLiquidCapacityHp)
maxLiquidCapacityHp	INTEGER	否	Maximum Liquid Capacity (μL)
maxKnifeLength	INTEGER	否	Maximum Tool Length (mm) (Prefer using maxKnifeLengthHp)
maxKnifeLengthHp	INTEGER	否	Maximum Tool Length (μm)
knifeTipAngle	OBJECT	否	Blade Angle
degrees	INTEGER	是	Degree
productSkuVolumeReq	OBJECT	是	Product SKU Volume
inputUnit	STRING	否	Input Unit
len	INTEGER	是	Shortest Side, unit mm
inputLen	STRING	否	Length of the Longest Input Side
inputHeight	STRING	否	Length of the Shortest Input Side
width	INTEGER	是	Secondary Length, unit mm
inputWidth	STRING	否	Input Secondary Length
height	INTEGER	是	Shortest Side, unit mm
productSkuBarCodeReqs	LIST	否	Product SKU Barcode
$item	OBJECT	否	-
code	STRING	否	Barcode
codeType	INTEGER	否	Barcode Type (1: EAN, 2: UPC, 3: ISBN)
productSkuSensitiveAttrReq	OBJECT	是	Product SKU Sensitive Attribute Request
sensitiveTypes	LIST	否	Sensitive Type PURE_ELECTRIC(1, "Pure Electric"), INTERNAL_ELECTRIC(2, "Internal Electric"), MAGNETISM(3, "Magnetism"), LIQUID(4, "Liquid"), POWDER(5, "Powder"), PASTE(6, "Paste"), CUTTER(7, "Tool")
$item	INTEGER	否	-
isSensitive	INTEGER	否	Whether Sensitive Attribute, 0: Non-Sensitive, 1: Sensitive
sensitiveList	LIST	否	Sensitive Type PURE_ELECTRIC(110001,"Pure Electric"), INTERNAL_ELECTRIC(120001, "Internal Electric"), MAGNETISM(130001, "Magnetism"), LIQUID(140001, "Liquid"), POWDER(150001, "Powder"), PASTE(160001, "Ointment"), CUTTER(170001, "Tool")
$item	INTEGER	否	-
productSkuSpecReqs	LIST	是	Product SKU Specification List
$item	OBJECT	否	-
specId	INTEGER	是	Specification ID
parentSpecName	STRING	是	Parent Specification Name
parentSpecId	INTEGER	是	Parent Specification ID
specName	STRING	是	Specification Name
mainProductSkuSpecReqs	LIST	是	Main Sales Specification List
$item	OBJECT	否	-
specId	INTEGER	是	Specification ID
parentSpecName	STRING	是	Parent Specification Name
parentSpecId	INTEGER	是	Parent Specification ID
specName	STRING	是	Specification Name
previewImgUrls	LIST	是	List of Preview Images, not required for non-apparel categories
$item	STRING	否	-
productSkcCarouselImageI18nReqs	LIST	否	SKC Carousel Multi-Language Information Request
$item	OBJECT	否	-
imgUrlList	LIST	否	Image List, empty list implies deletion, null implies no change
$item	STRING	否	-
language	STRING	是	Language
isBasePlate	INTEGER	否	Whether Baseplate
colorImageUrl	STRING	否	SKC Color Block Diagram
productSaleExtAttrReq	OBJECT	否	Product Sales Side Extended Attribute Request
inventoryRegion	INTEGER	否	Inventory Area
productSecondHandReq	OBJECT	否	Second-hand Goods Information
isSecondHand	BOOLEAN	否	Whether Second-hand
secondHandLevel	INTEGER	否	Second-hand Grade (Condition)
discreetShipping	BOOLEAN	否	This parameter is required for adult products (category ID: 16571). Setting this service will display the corresponding logo on the consumer order page, which can improve payment conversion rates. Merchants cannot display the details of the purchased items on the shipping packaging. If a consumer complains about failure to maintain confidentiality and the complaint is verified, the merchant may be held liable for after-sales service.
customizedTechnologyReq	OBJECT	否	Customized Craft Request
twiceType	LIST	否	Secondary Process
$item	INTEGER	否	-
firstType	INTEGER	是	Primary Process
technologyType	INTEGER	是	Craft Type
productNoChargerReq	OBJECT	否	Product No Charger Version Information (empty list must be sent to clear from has to none)
noChargerProductIds	LIST	是	No Charger Version Product ID (pass empty list to clear)
$item	INTEGER	否	-
ipCodes	LIST	否	ip code list, If ipBizType=1 (bg.glo.goods.brand.get), ipCodes is required.
$item	STRING	否	-
personalizationSwitch	INTEGER	否	Whether to Support Customized Template, 0: Not Supported, 1: Supported
productCustomReq	OBJECT	否	Commodity Customs Information
goodsLabelName	STRING	否	Product Tag
isRecommendedTag	BOOLEAN	是	Whether to select recommended tags
cat10Id	INTEGER	是	Tenth-Level Category ID, pass 0 if none
materialImgUrl	STRING	是	Material Image
productComplianceStatementReq	OBJECT	否	Compliance Signing Agreement
protocolVersion	STRING	是	Protocol Version Number
protocolUrl	STRING	是	Protocol Link
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
productSkuList	LIST	SKU List
$item	OBJECT	-
productSkuId	INTEGER	sku id
extCode	STRING	Sku External Code
skuSpecList	LIST	Sku Specification
$item	OBJECT	-
specId	INTEGER	Specification ID
parentSpecName	STRING	Parent Specification Name
parentSpecId	INTEGER	Parent Specification ID
specName	STRING	Specification Name
productSkcId	INTEGER	skc id
productId	INTEGER	Product ID
productSkcList	LIST	SKC List
$item	OBJECT	-
productSkcId	INTEGER	skc id
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
2000081	不合法或不可用的品牌	输入的品牌信息不可用或id不正确
2000096	体积内容必须遵循最长边 ≥ 次长边 ≥ 最短边原则	体积内容必须遵循最长边 ≥ 次长边 ≥ 最短边原则
2000135	当前类目净含量必填	请填写净含量
2000177	半托管商品英文标题最少需要x个字	英文标题不满足字数要求，请重新输入
2000200	属性值id[x]的属性值名称有误	属性值id与属性值不匹配，请检查入参
2000202	商品不符合大件标准，不可使用大件商品运费模版	请选择非大件运费模板，或者重新维护商品体积
6000002	货品属性校验失败	请结合校验失败具体原因检查属性入参
6000012	尺码表校验失败	请结合校验失败具体原因检查尺码表入参
6000059	童鞋适用年龄和鞋子不匹配，请确认后填写	请确认填写内容
2000004	不合法的规格属性	specId与specName不匹配，请检查入参
2000009	不合法的类目	入参类目id不合法，或者查询类目信息接口抖动，请重试，如果不行请更换类目
2000010	属性模板查询失败	接口抖动，或者当前类目未配置属性模板，请尝试重试，如果不行联系管理员处理
2000014	服饰类目skc轮播图[x]校验失败，应符合宽高比例为3:4，宽>=1340px，高>=1785px，<=2M	上传图片不符合格式要求，请重新上传
2000017	素材图[x]校验失败，应符合图片宽高比例为1:1，宽>=800px，高>=800px，<=2M	上传图片不符合格式要求，请重新上传
2000018	非服饰类目货品轮播图x校验失败，应符合宽高比例为1:1，宽>=800px，高>=800px，<=2M	上传图片不符合格式要求，请重新上传
2000020	非服饰类目sku预览图[x]校验失败，应符合宽高比例为1:1，宽>=800px，高>=800px，<=2M	上传图片不符合格式要求，请重新上传
2000021	图片[x]格式校验失败，只允许.JPG .JPEG .PNG	请上传JPG、JPEG、PNG的图片
2000025	当前图片中文字请使用销售目的地官方语言，请重新上传[x]	图片存在中文，请重新上传
2000026	图片是否存在牛皮癣校验失败,请重试	查询接口失败，请重试
2000031	服装类目skc下价格需要保持一致，请进行调整	服装类目skc下价格需要保持一致，请进行调整
2000037	市场部店铺发布货品需要外部商品链接	请补齐外部商品链接
2000060	请选择正确的币种	输入的币种入参不合法
2000061	暂不支持变更币种	报价格币种需和店铺支持币种保持一致
2000077	模特数据校验失败	请结合具体失败原因解决
2000079	录入申报价格大于x元，商品无法创建成功	达到申报价格上限，请合理输入
2000094	说明书文件[x]校验失败，单页应<=[x]M，长x宽应为1600*1200	上传说明书不符合格式要求，请重新上传
2000102	当前不支持设置备货区域	当前店铺不支持设置备货区域，如有疑问请咨询管理员
2000114	图片不合法，不支持空url	请勿传入空url
2000125	运费模板不存在	输入的运费模板id不正确，或者查询运费模板信息失败，请稍后重试，如果不行请联系管理员
2000127	货品运费模板校验失败	运费模板运费、区域信息校验失败，请结合具体错误信息解决
2000146	产地必填	请补充产地
2000148	说明书未上传	请上传说明书
2000154	说明书英文内容不合格，请重新上传	说明书英文内容不合格，请重新上传
2000158	URL域名校验不通过或URL包含不合法字符串	请检查入参位URL的字段
2000159	说明书缺少必要语言	说明书缺少必要语言
2000161	说明书语言错误	说明书语言入参不合法，请检查
2000165	商品标签未填写，请重新上传	请填写商品标签
2000168	创建失败。您已创建相同或高度相似的商品，建议您重新编辑商品信息，避免重复创建相同或高度相似的商品	重新编辑商品信息，避免重复创建相同或高度相似的商品
2000171	创建失败，存在重复的货品属性	重新编辑商品信息，避免重复创建相同或高度相似的商品
2000173	您当前帐户预留金额不足，无法发布商品，请前往【结算管理-资金中心】充值	请前往【结算管理-资金中心】充值
2000184	合规声明未签署	请签署合规声明
2000187	您当前账户预留金额不足，无法选择定制商品，请前往【结算管理-资金中心】充值	您当前账户预留金额不足，无法选择定制商品，请前往【结算管理-资金中心】充值
2000188	当前类目不支持定制	当前类目不支持定制
2000193	jit商品不允许开启定制	jit商品不允许开启定制
2000197	已超出今日发品数量限制，若有需要请联系运营	明日再发品，或者联系管理员加白
2000198	您当前账户预留金额不足，无法选择定制商品，请等待货款回款足额后再进行开启定制	您当前账户预留金额不足，无法选择定制商品，请等待货款回款足额后再进行开启定制
2000199	合规声明信息错误	合规声明信息错误，请检查入参
2000204	分站点申报价格校验失败	检查分站点报价格入参，比如站点信息是否和经营站点一致
2000301	商详装修楼层ID不合法	请检查商详装修楼层ID入参
2000302	商详装修楼层优先级不合法	商详装修楼层优先级不能重复，请检查入参
2000306	第x个楼层的商详装修图片不合法	上传图片不符合格式要求，请重新上传
2000307	第x个楼层的商详装修文字数量不合法	文字数量达到上限，具体阈值请咨询管理员
2000317	服饰类目多语言skc轮播图[x]校验失败，应符合宽高比例为3:4，宽>=1340px，高>=1785px，<=2M	上传图片不符合格式要求，请重新上传
2000318	非服饰类目货品多语言轮播图[x]校验失败，应符合宽高比例为1:1，宽>=800px，高>=800px，<=2M	上传图片不符合格式要求，请重新上传
2000319	非服饰类目sku多语言预览图[x]校验失败，应符合宽高比例为1:1，宽>=800px，高>=800px，<=2M	上传图片不符合格式要求，请重新上传
2000320	视频未转码	请先转码
2000322	当前已操作退店，发品失败	联系管理员解决
6000009	发布商品失败	请结合具体错误原因解决
6000011	所选类目不合法	类目路径不合法，请检查入参
6000018	货号不规范，请使用字母、数字和标点符号维护货号！	货号不规范，请使用字母、数字和标点符号维护货号！
6000027	视频比例仅允许1:1、 4:3、16:9	视频比例仅允许1:1、 4:3、16:9
6000033	尺码发布请按正确类型勾选后提交	尺码发布请按正确类型勾选后提交
6000056	请上传中东英语SKU预览图	请上传中东英语SKU预览图
6000058	请上传英国英语SKU预览图	请上传英国英语SKU预览图
6000064	输入内容存在违规内容，请重新调整货号后输入	输入内容存在违规内容，请重新调整货号后输入
6000081	库存信息校验失败	请结合具体报错信息解决
6000096	视频大小不能超过xMB	检查视频大小
6000097	视频时长不能超过x秒	检查视频时长
6000108	产地证明文件[x]校验失败，应符合[x]格式，且<=[x]M	上传的产地证明文件不符合格式要求，请重新上传
6000135	泛欧售卖需包含所有欧盟站点	泛欧售卖需包含所有欧盟站点
6000136	当前商品不满足非泛欧售卖条件，请提交反馈，或联系对接运营处理	当前商品不满足非泛欧售卖条件，请提交反馈，或联系对接运营处理
6000137	仅欧盟支持设置站点售卖模式	仅欧盟支持设置站点售卖模式
6000139	当前商品不支持选择未开站站点：xxx	移除提示的未开站站点
6000141	站点不合法：xxx	移除不合法的站点
7000035	多语言规格名称重复，x：规格id：x 翻译重复，请联系运营修改翻译内容	请联系运营修改翻译内容
7000048	请上传当地语种预览图	请上传当地语种预览图
7000049	请上传当地语种轮播图	请上传当地语种轮播图
7000050	请填写当地语种商品名称	请填写当地语种商品名称
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.glo.goods.list.get

bg.glo.goods.list.get
商品列表查询
更新时间：2026-04-19 12:05:59
接口介绍：货品skc列表查询
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
pageSize	INTEGER	否	Page Size
productName	STRING	否	Product Name
skcTopStatus	INTEGER	否	SKC First-Level Status，0: 未发布到站点，100: 在售中，200:已下架/已终止, 300：已删除
isSupportPersonalization	BOOLEAN	否	Whether to Support Customized Products
productSkcIds	LIST	否	Product SKC ID List
$item	INTEGER	否	-
matchJitMode	BOOLEAN	否	Whether to hit JIT mode
bindSiteIds	LIST	否	Operational Site ID List
$item	INTEGER	否	-
createdAtEnd	INTEGER	否	Creation Time End
cat7Id	INTEGER	否	Seventh-Level Category ID
createdAtStart	INTEGER	否	Creation Time Start
cat8Id	INTEGER	否	8th Level Category ID
skcExtCode	STRING	否	Product SKC External Code
cat9Id	INTEGER	否	9th Level Category ID
cat3Id	INTEGER	否	Third-Level Category ID
cat4Id	INTEGER	否	Fourth-Level Category ID
cat5Id	INTEGER	否	Fifth-Level Category ID
cat6Id	INTEGER	否	Sixth-Level Category ID
cat1Id	INTEGER	否	First-Level Category ID
cat2Id	INTEGER	否	Secondary Category ID
quickSellAgtSignStatus	INTEGER	否	Quick Sales Agreement Signing Status 0-Unsigned 1-Signed
cat10Id	INTEGER	否	Tenth-Level Category ID
skcSiteStatus	INTEGER	否	SKC Site Status
page	INTEGER	否	Page Number
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
data	LIST	Result List
$item	OBJECT	-
productProperties	LIST	Product General Attributes
$item	OBJECT	-
vid	INTEGER	Basic Attribute Value ID
valueUnit	STRING	Attribute Value Unit
language	STRING	Language
pid	INTEGER	Attribute ID
templatePid	INTEGER	Template Attribute ID
numberInputValue	STRING	Numerical Input
propValue	STRING	Basic Property Value
propName	STRING	Reference Property Name
valueExtendInfo	STRING	Attribute Value Extension Information
refPid	INTEGER	Reference Property ID
productId	INTEGER	Product Id
productJitMode	OBJECT	Product JIT Mode Information
signLatestJitVersion	BOOLEAN	Whether to sign the latest version of JIT pre-sale agreement
quickSellAgtSignStatus	INTEGER	Quick Sales Agreement Signing Status 0-Unsigned 1-Signed
matchJitMode	BOOLEAN	Whether JIT Mode
productSkuSummaries	LIST	SKU Summary Information List
$item	OBJECT	-
productSkuId	INTEGER	Product SKU ID
extCode	STRING	SKU Number
productSkuWhExtAttr	OBJECT	Product SKU Warehouse Extension Attributes
productSkuWeight	OBJECT	Weight
value	INTEGER	Weight Value (Milligrams)
productSkuWmsVolume	OBJECT	WMS Volume
len	INTEGER	Length (mm)
wmsCollectionSourceType	INTEGER	WMS Collection Source (inconsistent with WMS enum, only record sources of interest)
width	INTEGER	Width (mm)
height	INTEGER	High (mm)
productSkuBarCodes	LIST	Barcode
$item	OBJECT	-
code	STRING	Barcode
codeType	INTEGER	Barcode Type (1: EAN, 2: UPC, 3: ISBN)
productSkuSubSellMode	INTEGER	Sub-Sales Mode
productSkuSensitiveAttr	OBJECT	Sensitive Attribute
sensitiveTypes	LIST	Sensitive Type PURE_ELECTRIC(1, "Pure Electric"), INTERNAL_ELECTRIC(2, "Internal Electric"), MAGNETISM(3, "Magnetism"), LIQUID(4, "Liquid"), POWDER(5, "Powder"), PASTE(6, "Paste"), CUTTER(7, "Tool")
$item	INTEGER	-
isSensitive	INTEGER	Whether Sensitive Attribute, 0: Non-Sensitive, 1: Sensitive
productSkuFragileLabels	OBJECT	Fragile Label
isFragile	BOOLEAN	Whether Fragile Item
productSkuNewSensitiveAttr	OBJECT	Sensitive Attribute
force2NormalTypes	LIST	Force Conversion to General Type
$item	INTEGER	-
sensitiveList	LIST	Sensitive Product Type
$item	INTEGER	-
isForce2Normal	BOOLEAN	Whether to Forcefully Convert to General Goods
productSkuVolumeLabel	OBJECT	Volume Label
isSideOverLength	BOOLEAN	Whether Exceeding Length Limit
isVolumeOverSize	BOOLEAN	Whether Extremely Large Volume
productSkuWmsWeight	OBJECT	WMS Weight
wmsCollectionSourceType	INTEGER	WMS Collection Source (inconsistent with WMS enum, only record sources of interest)
value	INTEGER	Weight Value (Milligrams)
productSkuVolume	OBJECT	Volume
len	INTEGER	Length (mm)
width	INTEGER	Width (mm)
height	INTEGER	High (mm)
productSkuSensitiveLimit	OBJECT	Sensitive Property Restriction
maxBatteryCapacityHp	INTEGER	Maximum Battery Capacity (mWh)
maxBatteryCapacity	INTEGER	Maximum Battery Capacity (Wh)
maxLiquidCapacity	INTEGER	Maximum Liquid Capacity (mL)
maxLiquidCapacityHp	INTEGER	Maximum Liquid Capacity (μL)
maxKnifeLength	INTEGER	Maximum Tool Length (mm)
maxKnifeLengthHp	INTEGER	Maximum Tool Length (μm)
productSkuWmsVolumeLabel	OBJECT	WMS Volume Label
isSideOverLength	BOOLEAN	Whether Exceeding Length Limit
isVolumeOverSize	BOOLEAN	Whether Extremely Large Volume
virtualStock	INTEGER	Virtual Inventory
productSkuSpecList	LIST	Specification List
$item	OBJECT	-
specId	INTEGER	Specification ID
parentSpecName	STRING	Parent Specification Name
parentSpecId	INTEGER	Parent Specification ID
specName	STRING	Specification Name
productSkuSaleExtAttr	OBJECT	Product SKU Sales Domain Extension Attributes
productSkuShippingMode	INTEGER	Product SKU Shipping Mode
productSkuIndividuallyPacked	INTEGER	Whether the Product SKU is Independently Packaged
productName	STRING	Product Name
createdAt	INTEGER	Listing Time
productSemiManaged	OBJECT	Semi-managed Merchant Goods Information
productShipment	OBJECT	Product Delivery Information
freightTemplateId	STRING	Shipping Template ID
shipmentLimitSecond	INTEGER	Promised Delivery Time (unit: s)
warehouseRegionId1List	LIST	First-level Regional ID List for Shipping Warehouses
$item	INTEGER	-
longTransport	BOOLEAN	Long-term transportation template, null represent false
bindSites	LIST	Bound Site List
$item	OBJECT	-
siteId	INTEGER	Site ID
siteName	STRING	Site Name
isSupportPersonalization	BOOLEAN	Whether to Support Customized Products
extCode	STRING	Product SKC External Code
leafCat	OBJECT	Leaf Category
catId	INTEGER	Category ID
catName	STRING	Category Name
skcSiteStatus	INTEGER	SKC Site Status
categories	OBJECT	Category
cat4	OBJECT	Fourth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat5	OBJECT	Fifth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat2	OBJECT	Secondary Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat3	OBJECT	Third-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat1	OBJECT	First-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat10	OBJECT	Tenth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
leafCat	OBJECT	Leaf Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat8	OBJECT	8th Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat9	OBJECT	Ninth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat6	OBJECT	Sixth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat7	OBJECT	Seventh-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
productSkcId	INTEGER	Product SKC ID
mainImageUrl	STRING	SKC Main Image
matchSkcJitMode	BOOLEAN	Whether to hit SKC layer JIT mode
totalCount	INTEGER	Total Count
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
货品API组	He uses type、Self use type


---

## bg.glo.goods.detail.get

bg.glo.goods.detail.get
商品详情查询接口
更新时间：2025-08-27 16:57:39
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
productId	INTEGER	是	Product ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
productId	INTEGER	Product ID
categories	OBJECT	Category
cat4	OBJECT	Fourth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat5	OBJECT	Fifth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat2	OBJECT	Secondary Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat3	OBJECT	Third-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat1	OBJECT	First-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat10	OBJECT	Tenth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
leafCat	OBJECT	Leaf Category
catId	INTEGER	Category ID
catName	STRING	Category Name
catType	INTEGER	Category Type (0: Unclassified, 1: Apparel)
cat8	OBJECT	8th Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat9	OBJECT	Ninth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat6	OBJECT	Sixth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat7	OBJECT	Seventh-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
productWhExtAttr	OBJECT	Commodity Warehouse Logistics Supply Chain Extension Properties
productOrigin	OBJECT	Product Origin Information
region2Id	INTEGER	Secondary Region ID
region1ShortName	STRING	First-Level Region Abbreviation (Two-Character Code)
goodsLayerDecorationList	LIST	Product Detail Decoration Information
$item	OBJECT	-
floorId	INTEGER	Floor ID, null: Create new, otherwise Update
lang	STRING	Language Type
type	STRING	Component Type
priority	INTEGER	Floor Sorting
contentList	LIST	Floor Content
$item	OBJECT	-
imgUrl	STRING	Image Address--General
textModuleDetails	OBJECT	Text Module Details
backgroundColor	STRING	Background Color
fontFamily	INTEGER	Font Type
fontSize	INTEGER	Text Module Font Size
align	STRING	Text Alignment, left--Left Aligned；right--Right Aligned；center--Centered；justify--Justified
fontColor	STRING	Text Color
width	INTEGER	Image Width--General
text	STRING	Text Information--Text Module
height	INTEGER	Image Height--General
key	STRING	Floor Type Key
productName	STRING	Product Name
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

## bg.glo.goods.migrate

bg.glo.goods.migrate
货品搬运接口
更新时间：2025-08-27 16:57:38
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
migrationList	LIST	是	Copy Request List
$item	OBJECT	否	-
productSemiManagedReq	OBJECT	是	Product Semi Managed Request
bindSiteIds	LIST	是	Bound Site List
$item	INTEGER	否	-
semiManagedSiteMode	INTEGER	否	Semi-managed Site Sales Mode
productWarehouseRouteReq	OBJECT	是	Product Warehouse Route Request
targetRouteList	LIST	是	Target Self-Delivery Site-Warehouse Relationship
$item	OBJECT	否	-
siteIdList	LIST	是	Site ID.
$item	INTEGER	否	-
warehouseId	STRING	是	Warehouse ID
skcDetails	LIST	是	Skc Detail List
$item	OBJECT	否	-
skuDetails	LIST	是	Sku Detail List
$item	OBJECT	否	-
currencyType	STRING	是	Currency Type
specList	LIST	是	SKU Spec List
$item	OBJECT	否	-
specId	INTEGER	是	Specification ID
parentSpecName	STRING	是	Parent Specification Name
parentSpecId	INTEGER	是	Parent Specification ID
specName	STRING	是	Specification Name
siteSupplierPrices	LIST	是	Site Supplier Price List
$item	OBJECT	否	-
siteId	INTEGER	是	Declared Price Site ID
supplierPrice	INTEGER	是	Site Declared Price, Unit: RMB: Fen, USD: Cent
specList	LIST	是	SKC Spec List
$item	OBJECT	否	-
specId	INTEGER	是	Specification ID
parentSpecName	STRING	是	Parent Specification Name
parentSpecId	INTEGER	是	Parent Specification ID
specName	STRING	是	Specification Name
sourceProductId	INTEGER	是	Source Product ID
productShipmentReq	OBJECT	是	Product Shipment Request
freightTemplateId	STRING	是	Shipping Template ID
shipmentLimitSecond	INTEGER	是	Promised Delivery Time (unit: s)
warehouseSkuStockAvailable	INTEGER	是	Warehouse Sku Stock Available
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
migrationRetList	LIST	Copy Fully Managed Product Result List
$item	OBJECT	-
productDraftId	INTEGER	Product Draft ID
sourceProductId	INTEGER	Source Product ID`
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

## bg.glo.goods.topselling.soldout.get

bg.glo.goods.topselling.soldout.get
批量查询爆款售罄商品
更新时间：2025-08-27 16:57:38
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
sellOutProducts	LIST	Sold Out Product List
$item	OBJECT	-
sellOutProductId	STRING	Sold Out Product ID
productPicture	STRING	Sold Out Product Main Image
categories	OBJECT	Sold-out Product Categories
cat4	OBJECT	Fourth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat5	OBJECT	Fifth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat2	OBJECT	Secondary Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat3	OBJECT	Third-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat1	OBJECT	First-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat10	OBJECT	Tenth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
leafCat	OBJECT	Leaf Category
catId	INTEGER	Category ID
catName	STRING	Category Name
catType	INTEGER	Category Type (0: Unclassified, 1: Apparel)
cat8	OBJECT	8th Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat9	OBJECT	Ninth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat6	OBJECT	Sixth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
cat7	OBJECT	Seventh-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
bindSites	LIST	Sold-out Product Binding Site List
$item	OBJECT	-
siteId	INTEGER	Site ID
siteName	STRING	Site Name
productName	STRING	Sold Out Product Name
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1000005	系统异常	尝试重试，如果还不行请联系管理员
1000001	服务器开小差	一般是系统抖动，可参考具体报错文案尝试解决或重试，如果还不行请联系管理员
6000098	批量查询售罄货品失败	查询售罄货品信息接口抖动，请重试
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.btg.goods.stock.warehouse.list.get

bg.btg.goods.stock.warehouse.list.get
根据站点查询可绑定的发货仓库信息接口
更新时间：2026-01-15 14:58:57
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

## bg.glo.product.search

bg.glo.product.search
查询货品生命周期状态
更新时间：2025-12-23 16:02:46
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
pageSize	INTEGER	是	页大小
pageNum	INTEGER	是	页编号(从1开始)
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	Total Count
dataList	LIST	Data List
$item	OBJECT	-
skcList	LIST	SKC List
$item	OBJECT	-
skcId	INTEGER	Product SKC ID
selectStatus	INTEGER	Selection Status
skuList	LIST	SKU List
$item	OBJECT	-
skuId	INTEGER	Product SKU ID
applyJitStatus	INTEGER	Appeal JIT Status (1-Application Allowed; 3-Application Not Allowed)
suggestCloseJit	BOOLEAN	Whether to Suggest Closing JIT Button
productId	INTEGER	Product ID
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

## bg.glo.best.seller.invitation.query

bg.glo.best.seller.invitation.query
best seller招标单查询
更新时间：2025-09-16 23:04:22
接口介绍：best seller招标单查询
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
pageNo	INTEGER	是	范围1-100
pageSize	INTEGER	是	范围1-100
siteId	INTEGER	否	site id
catIdList	LIST	否	cat id list
$item	INTEGER	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	Specific information
total	INTEGER	total
list	LIST	list
$item	OBJECT	-
catList	LIST	Category name
$item	STRING	-
invitationName	STRING	invitation name
siteId	INTEGER	Site ID
siteName	STRING	Site Name
invitationId	INTEGER	invitation ID
endTime	INTEGER	Deadline
type	INTEGER	type 1-mallTarget 2-full2Semi 3-catTarget
imageList	LIST	Image
$item	STRING	-
catIdList	LIST	Category ID
$item	INTEGER	-
success	BOOLEAN	Whether it was successful or not
errorCode	INTEGER	Error code
errorMsg	STRING	Error message
返回错误码说明
收起
错误码	错误描述	解决办法
400000000	业务异常	重试或咨询
400000001	MallId为空	检查鉴权配置
400000002	页码、分页大小字段不符合要求	检查pageNo、pageSize是否为空，是否超出限制
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.glo.logistics.template.get

bg.glo.logistics.template.get
查询运费模板列表
更新时间：2025-08-27 16:57:43
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
siteIds	LIST	否	Site List
$item	INTEGER	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
freightTemplates	LIST	Freight Template Summary Information List
$item	OBJECT	-
freightTemplateId	STRING	Shipping Template ID
templateName	STRING	Shipping Template Name
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
2000124	查询运费模板信息失败	优先重试，如果不行请联系对接产品
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
类目属性API组	He uses type、Self use type


---

## bg.glo.goods.brand.get

bg.glo.goods.brand.get
货品品牌查询
更新时间：2026-03-24 18:14:33
接口介绍：用于货品发布前查询品牌
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
vid	INTEGER	否	Search Attribute Value ID
brandName	STRING	否	Search Brand Name
pageSize	INTEGER	是	Page Size
page	INTEGER	是	Page Number
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	Total Count
pageItems	LIST	Current Page Results
$item	OBJECT	-
vid	INTEGER	Attribute Value ID
brandId	INTEGER	Brand ID
brandNameEn	STRING	Brand English Name
pid	INTEGER	Basic Attribute Value ID
ipBizType	INTEGER	ip biz Type, If ipBizType=1, ipCodes is required in the product listing interface (bg.glo.goods.add).
regSerialCode	STRING	Registration Serial Number
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

## bg.glo.goods.removed.get

bg.glo.goods.removed.get
卖家中心已废弃列表
更新时间：2026-04-19 18:18:33
接口介绍：卖家中心已废弃列表
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
productIds	LIST	否	Product ID List
$item	INTEGER	否	-
pageSize	INTEGER	否	Page Size
page	INTEGER	否	Page Number
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
data	LIST	Result List
$item	OBJECT	-
removeStatusUpdatedAtTs	INTEGER	Remove Status Updated At Timestamp ms
extCode	STRING	Product SKC External Code
productId	INTEGER	Product Id
productSkuSummaries	LIST	SKU Summary Information List
$item	OBJECT	-
productSkuId	INTEGER	Product SKU ID
extCode	STRING	Sku Number
productSkcId	INTEGER	Product SKC ID
mainImageUrl	STRING	SKC Main Image
productName	STRING	Product Name
totalCount	INTEGER	Total Count
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
991000003	参数错误：xxxxx	根据错误原因检查入参
991000005	系统异常	尝试重试，如果还不行请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type
