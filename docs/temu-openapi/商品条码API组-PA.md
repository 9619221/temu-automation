# 商品条码API组-PA

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 3 个接口


---

## bg.glo.goods.custom.label.get

bg.glo.goods.custom.label.get
定制品商品条码查询
更新时间：2025-08-27 16:57:37
接口介绍：提供查询定制品条码信息接口，用于条码打印
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
productSkuIdList	LIST	否	Product SKU ID List
$item	INTEGER	否	-
productSkcIdList	LIST	否	Product SKC ID List
$item	INTEGER	否	-
personalProductSkuIdList	LIST	否	Customized Product SKU ID List
$item	INTEGER	否	-
createTimeEnd	INTEGER	否	Creation Time End
pageSize	INTEGER	否	Page Size
page	INTEGER	否	Page Number
createTimeStart	INTEGER	否	Creation Time Start
labelCode	INTEGER	否	Tag Barcode
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
personalLabelCodePageResult	OBJECT	Paged Query Results
data	LIST	Result List
$item	OBJECT	-
productSkuSpecI18nMap	MAP	Sku Specification Multilingual Information
$key	STRING	-
$value	LIST	-
$item	OBJECT	-
specId	INTEGER	Specification ID
parentSpecName	STRING	Parent Specification Name
parentSpecId	INTEGER	Parent Specification ID
specName	STRING	Specification Name
productSkuDTO	OBJECT	SKU Information
numberOfPieces	INTEGER	Quantity
productSkuId	INTEGER	Product SKU ID
productId	INTEGER	Product ID
productSkuSpec	OBJECT	Sku Specification List, including all specification attributes of the current Sku
productSkuId	INTEGER	Product SKU ID
productId	INTEGER	Product ID
specList	LIST	Specification Information
$item	OBJECT	-
specId	INTEGER	Specification ID
parentSpecName	STRING	Parent Specification Name
parentSpecId	INTEGER	Parent Specification ID
specName	STRING	Specification Name
productSkcId	INTEGER	Product SKC ID
pieceUnitCode	INTEGER	SKU Quantity Unit
extCode	STRING	SKU Number
productSkcId	INTEGER	Product SKC ID
skuClassification	INTEGER	SKU Category
thumbUrl	STRING	Sku Preview Image
productSkcImageList	LIST	SKC Image Information
$item	OBJECT	-
imageUrl	STRING	Image URL
language	STRING	Language
imageType	INTEGER	Image Type
productSkcDTO	OBJECT	SKC Information
specIdList	LIST	Main Sales Attribute ID List
$item	INTEGER	-
extCode	STRING	SKC Item Number
productId	INTEGER	Product Id
productSkcSpec	OBJECT	Main Sales Attribute Details
productId	INTEGER	Product ID
specList	LIST	Specification Information
$item	OBJECT	-
specId	INTEGER	Specification ID
parentSpecName	STRING	Parent Specification Name
parentSpecId	INTEGER	Parent Specification ID
specName	STRING	Specification Name
productSkcId	INTEGER	Product SKC ID
productSkcId	INTEGER	Product SKC ID
productOrigin	OBJECT	Product Origin Information
region1ShortName	STRING	First-Level Region Abbreviation (Two-Character Code)
region1Name	STRING	Primary Region Name (English)
productSkuLabelCodeDTO	OBJECT	Label Barcode Basic Information
productSkuId	INTEGER	Product SKU ID
productId	INTEGER	Product ID
createTimeTs	INTEGER	Creation Timestamp (Milliseconds)
productSkcId	INTEGER	Product SKC ID
labelCode	INTEGER	Tag Barcode
productSkcSpecI18nMap	MAP	SKC Specification Multilingual Information
$key	STRING	-
$value	LIST	-
$item	OBJECT	-
specId	INTEGER	Specification ID
parentSpecName	STRING	Parent Specification Name
parentSpecId	INTEGER	Parent Specification ID
specName	STRING	Specification Name
totalCount	INTEGER	Total Count
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1000005	系统异常	尝试重试，如果还不行请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
条码API组	He uses type、Self use type


---

## bg.glo.goods.labelv2.get

bg.glo.goods.labelv2.get
商品条码查询V2
更新时间：2025-08-27 16:57:37
接口介绍：提供查询商品条码信息接口，用于条码打印
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
productSkuIdList	LIST	否	Product SKU ID List
$item	INTEGER	否	-
skcExtCode	STRING	否	SKC Product Number
productSkcIdList	LIST	否	Product SKC ID List
$item	INTEGER	否	-
pageSize	INTEGER	否	Page Size
skuExtCode	STRING	否	Sku Number
page	INTEGER	否	Page Number
labelCode	INTEGER	否	Tag Barcode
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
labelCodePageResult	OBJECT	Tag Paginated Query Result
data	LIST	Result List
$item	OBJECT	-
productSkuSpecI18nMap	MAP	Sku specification multilingual information, including all specification attributes of the current sku
$key	STRING	-
$value	LIST	-
$item	OBJECT	-
specId	INTEGER	Specification ID
parentSpecName	STRING	Parent Specification Name
parentSpecId	INTEGER	Parent Specification ID
specName	STRING	Specification Name
productSkuDTO	OBJECT	SKU Information
productSkuId	INTEGER	Product SKU ID
supplierId	INTEGER	Supplier ID
productId	INTEGER	Product ID
productSkuSpecMap	MAP	Sku Sales Specification Map
$key	STRING	-
$value	OBJECT	-
specId	INTEGER	Specification ID
specName	STRING	Specification Name
productSkuSpec	OBJECT	Sku Specification List, including all specification attributes of the current Sku
productSkuId	INTEGER	Product SKU ID
supplierId	INTEGER	Supplier ID
productId	INTEGER	Product ID
specList	LIST	Specification Information
$item	OBJECT	-
specId	INTEGER	Specification ID
parentSpecName	STRING	Parent Specification Name
parentSpecId	INTEGER	Parent Specification ID
specName	STRING	Specification Name
productSkcId	INTEGER	Product SKC ID
thumbUrlI18n	MAP	Sku Preview Image (Multi-language)
$key	STRING	-
$value	STRING	-
version	INTEGER	Sku Product Version Number
extCode	STRING	SKU Number
valuableCargo	BOOLEAN	Whether Valuable Goods
thumbUrlI18nMap	MAP	Sku Preview Image (Multi-language)
$key	STRING	-
$value	LIST	-
$item	STRING	-
thumbUrlI18nList	LIST	SKC Carousel (Multi-Language)
$item	OBJECT	-
imgUrlList	LIST	Image List
$item	STRING	-
language	STRING	Language
productSkcId	INTEGER	Product SKC ID
thumbUrl	STRING	Sku Preview Image
productLabelCodeDTO	OBJECT	Legacy Product Label Barcode Basic Information
productSkuId	INTEGER	Product SKU ID
supplierId	INTEGER	Supplier ID
createTime	INTEGER	Create Time
purchaseOrderSn	STRING	Purchase Order SN
subPurchaseOrderSn	STRING	Sub Purchase Order SN
productSkcId	INTEGER	Product SKC ID
productSkuPurchaseQuantity	INTEGER	Product SKU Purchase Quantity (Only returned by old method)
labelCode	INTEGER	Label Code
productSkcImageList	LIST	SKC Image Information
$item	OBJECT	-
imageUrl	STRING	Image URL
language	STRING	Language
imageType	INTEGER	Image Type
productSkcDTO	OBJECT	SKC Information
specIdList	LIST	Main Sales Attribute ID List
$item	INTEGER	-
supplierId	INTEGER	Supplier ID
extCode	STRING	SKC Item Number
productId	INTEGER	Product Id
productSkcSpec	OBJECT	Main Sales Attribute Details
supplierId	INTEGER	Supplier ID
productId	INTEGER	Product ID
specList	LIST	Specification Information
$item	OBJECT	-
specId	INTEGER	Specification ID
parentSpecName	STRING	Parent Specification Name
parentSpecId	INTEGER	Parent Specification ID
specName	STRING	Specification Name
productSkcId	INTEGER	Product SKC ID
productSkcSpecMap	MAP	SKC Main Sales Specification Map
$key	STRING	-
$value	OBJECT	-
specId	INTEGER	Specification ID
specName	STRING	Specification Name
productSkcId	INTEGER	Product SKC ID
version	INTEGER	SKC Product Version Number
productOrigin	OBJECT	Product Origin Information
countryShortName	STRING	Country Abbreviation (Two-letter Code)
countryName	STRING	Country Name (English)
productDTO	OBJECT	SPU Information
imageLanguageList	LIST	Image Multilingual List
$item	STRING	-
leafCatLabel	OBJECT	Leaf Class Target Note (Please confirm with the interface provider before use whether this field will be returned)
catId	INTEGER	Category ID
bulkyCargoMarkType	INTEGER	Dumping Label Type
supplierId	INTEGER	Supplier ID
productId	INTEGER	Product ID
productI18nList	LIST	Product Multilingual Information
$item	OBJECT	-
supplierId	INTEGER	Supplier ID
productId	INTEGER	Product ID
language	STRING	Language Code
updateTime	INTEGER	Update Time
productName	STRING	Product Name
sourceType	INTEGER	Source
categoryPropDTO	OBJECT	Leaf Category Attribute (Please confirm with the interface provider before use whether this field will be returned)
catId	INTEGER	Category ID
forbidFold	BOOLEAN	Non-Collapsible
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
productName	STRING	Product Name
productType	INTEGER	Product Type
createdAtTs	INTEGER	Creation Time, Millisecond Timestamp
productSkuLabelCodeDTO	OBJECT	New Version Product Label Barcode Basic Information
productSkuId	INTEGER	Product SKU ID
supplierId	INTEGER	Supplier ID
productId	INTEGER	Product ID
createTimeTs	INTEGER	Creation Timestamp (Milliseconds)
productSkcId	INTEGER	Product SKC ID
labelCode	INTEGER	Tag Barcode
productSkcSpecI18nMap	MAP	SKC Specification Multilingual Information
$key	STRING	-
$value	LIST	-
$item	OBJECT	-
specId	INTEGER	Specification ID
parentSpecName	STRING	Parent Specification Name
parentSpecId	INTEGER	Parent Specification ID
specName	STRING	Specification Name
totalCount	INTEGER	Total Count
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1000005	系统异常	尝试重试，如果还不行请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
条码API组	He uses type、Self use type


---

## 条码打印说明

条码打印说明
更新时间：2025-12-10 21:49:17




一、参数说明




以下接口可通过传入return_data_key=true直接打印

bg.glo.goods.custom.label.get

bg.glo.goods.labelv2.get







参数名称 



	

类型 



	

是否必须 



	

说明 






return_data_key



	

boolean



	

否



	

是否以打印页面url返回，如果入参是，则不返回参数信息，返回dataKey，通过拼接https://openapi-b-partner.temu.com/tool/print?dataKey={返回的dataKey}，访问组装的url即可打印，打印的条码按照入参参数所得结果进行打印

链接10min内单次有效，请求过立即失效

二、请求样例
{
    "type": "temu.goods.labelv2.get",
    "timestamp": 1765374246,
    "app_key": "xx",
    "data_type": "JSON",
    "access_token": "xx",
    "productSkuIdList": [
        6993876813
    ],
    "return_data_key": "true",
    "sign": "E567432BB3AF4EDBB171C75FBE0095A7"
}




三、返回样例
{
    "result": "07a48ee7-0e21-4519-bf3d-1c5f1d5c928019b088371f0h1YnyhWbOvf7fCL5Be6SqD1BqZXayf2MWPYpfLZ2HVul0HgpuaprOeVVPpVWNnn6pyL18jtBm7R8tIIqpYgrht3Dnk9NIDeLTC051f7tOrmRUDAvTuHfb6cLOnslkuEPzxLV4sBBpIHzbL7pd1Oh6812HKC03kDQs4BNvXxfPTId0CfpXewXY1y6MJFojGzj8z5GhbBH",
    "success": true,
    "requestId": "pa-04760245-a30e-436a-8e6d-88e6e97c59c1",
    "errorCode": 1000000,
    "errorMsg": ""
}







四、条码打印样例




https://openapi-b-partner.temu.com/tool/print?dataKey=07a48ee7-0e21-4519-bf3d-1c5f1d5c928019b088371f0h1YnyhWbOvf7fCL5Be6SqD1BqZXayf2MWPYpfLZ2HVul0HgpuaprOeVVPpVWNnn6pyL18jtBm7R8tIIqpYgrht3Dnk9NIDeLTC051f7tOrmRUDAvTuHfb6cLOnslkuEPzxLV4sBBpIHzbL7pd1Oh6812HKC03kDQs4BNvXxfPTId0CfpXewXY1y6MJFojGzj8z5GhbBH










五、链接单次有效，再次访问后失效







一、参数说明
二、请求样例
三、返回样例
四、条码打印样例
五、链接单次有效，再次访问后失效
