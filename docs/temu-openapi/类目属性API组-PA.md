# 类目属性API组-PA

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 10 个接口


---

## bg.glo.goods.catsmandatory.get

bg.glo.goods.catsmandatory.get
类目必填信息接口
更新时间：2025-08-27 16:57:43
接口介绍：类目必填信息查询接口
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
bindSiteIds	LIST	否	Bound Site List
$item	INTEGER	否	-
configItems	LIST	是	Category Configuration List
$item	INTEGER	否	-
leafCatId	INTEGER	是	Leaf Category ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
needGuideFile	BOOLEAN	Whether the manual is required
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1000001	服务器开小差	一般是系统抖动，可参考具体报错文案尝试解决或重试，如果还不行请联系管理员
1000005	系统异常	尝试重试，如果还不行请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
类目属性API组	He uses type、Self use type


---

## bg.goods.redress.correctrecord.query

bg.goods.redress.correctrecord.query
查询商品类目纠正列表
更新时间：2025-12-19 22:01:40
接口介绍：提供给商家端，用于查询当前店铺的类目整改记录
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
queryNeedCorrect	BOOLEAN	否	Only query the records that need correct
productIdList	LIST	否	Product ID
$item	LONG	否	-
pageSize	INTEGER	是	Page Size, range [1, 20]
pageNum	INTEGER	是	Page Number, range [1, 500]
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	Total
pageSize	INTEGER	Page Size
list	LIST	Correct record list
$item	OBJECT	-
currentCategory	LIST	Product current category path
$item	OBJECT	-
catId	INTEGER	Category ID
catName	STRING	Category name
parentCatId	INTEGER	Parent category ID
isLeaf	BOOLEAN	Is it a leaf category
catLevel	INTEGER	Category level in category path
productId	INTEGER	Product ID
correctRecordId	INTEGER	Correct record ID
correctedCategory	LIST	Categories that have been corrected
$item	OBJECT	-
catId	INTEGER	Category ID
catName	STRING	Category name
parentCatId	INTEGER	Parent category ID
isLeaf	BOOLEAN	Is it a leaf category
catLevel	INTEGER	Category level in category path
beforeCorrectionCategory	LIST	Category path before this rectification
$item	OBJECT	-
catId	INTEGER	Category ID
catName	STRING	Category name
parentCatId	INTEGER	Parent category ID
isLeaf	BOOLEAN	Is it a leaf category
catLevel	INTEGER	Category level in category path
optionalCategories	LIST	Recommended categories list
$item	LIST	-
$item	OBJECT	-
catId	INTEGER	Category ID
catName	STRING	Category name
parentCatId	INTEGER	Parent category ID
isLeaf	BOOLEAN	Is it a leaf category
catLevel	INTEGER	Category level in category path
correctDeadline	INTEGER	Auto-correction deadline (ms)
status	INTEGER	Optional value description:[1:correction record is waiting for feedback;2:correction record is processing, cannot feedback;3:correction record is finished;4:correction record is failed;]
pageNum	INTEGER	Page Number
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
100000002	Bad params	Please check the request parameters 1. Are the pagination parameters within the limits?
100000004	The system is busy, please try again later	Please wait for a while and try again, or reduce the request frequency.
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
类目属性API组	He uses type、Self use type


---

## bg.goods.redress.optionalcategory.correct

bg.goods.redress.optionalcategory.correct
纠正商品类目
更新时间：2025-10-30 16:36:39
接口介绍：提供给商家端，用于主动选择商品的推荐类目
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
list	LIST	是	selected category list
$item	OBJECT	否	-
productId	INTEGER	是	Product ID
correctRecordId	INTEGER	是	Correct record Id
selectedCategoryId	INTEGER	是	Selected leaf category ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	The quantity of items in the batch operation
successCount	INTEGER	Count of successful operations
list	LIST	Result details list
$item	OBJECT	-
reason	STRING	The reason for the operation result
productId	INTEGER	Product ID
isSuccess	BOOLEAN	Is this operation successful
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
100000003	Batch operation partially failed	Please check the response parameter result#list#reason to get error details
100000005	Bad params	Please check the request parameters 1. selected categories size 2. selected category list item
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
类目属性API组	He uses type、Self use type


---

## bg.glo.goods.parentspec.get

bg.glo.goods.parentspec.get
查询父规格列表
更新时间：2026-01-11 14:19:11
接口介绍：用于发布时查询父规格列表
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
parentSpecDTOS	LIST	Parent Specification List
$item	OBJECT	-
parentSpecName	STRING	Parent Specification Name
parentSpecId	INTEGER	Parent Specification ID
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
类目属性API组	He uses type、Self use type


---

## bg.glo.goods.spec.create

bg.glo.goods.spec.create
创建规格
更新时间：2026-01-11 14:19:11
接口介绍：用于货品发布时创建自定义规格
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
parentSpecId	INTEGER	是	Parent Specification ID
specName	STRING	是	Sub Specification Name
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
specId	INTEGER	Sub-specification ID
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1000001	服务器开小差	一般是系统抖动，可参考具体报错文案尝试解决或重试，如果还不行请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
类目属性API组	He uses type、Self use type


---

## bg.glo.goods.accessories.get

bg.glo.goods.accessories.get
货品包装清单类型查询
更新时间：2025-09-17 11:01:15
接口介绍：货品包装清单类型查询
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
fuzzyValue	STRING	否	Fuzzy Value
pageSize	INTEGER	否	Page Size
page	INTEGER	否	Page Number
vidList	LIST	否	Property Value ID List
$item	INTEGER	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
data	LIST	Result List
$item	OBJECT	-
vid	INTEGER	Property Value ID
unitName	STRING	Unit Name
unitCode	INTEGER	Unit Code
value	STRING	Property Value Name
totalCount	INTEGER	Total Count
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
991000001	服务器开小差	一般是系统抖动，可参考具体报错文案尝试解决或重试，如果还不行请联系管理员
991000005	系统异常	尝试重试，如果还不行请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
类目属性API组	He uses type、Self use type


---

## bg.goods.attribute.mapping.global

bg.goods.attribute.mapping.global
内外属性映射
更新时间：2026-03-20 17:32:36
接口介绍：内外属性映射
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
catId	STRING	是	Leaf Category ID
catName	STRING	否	Leaf Category Name
goodsProp	LIST	否	Product Attributes
$item	OBJECT	否	-
values	LIST	否	Product English Attribute Values
$item	STRING	否	-
propName	STRING	否	Product English Attribute Name
goodsName	STRING	是	Product Name
mainImageUrl	STRING	否	Product Main Image
返回参数说明
收起
参数接口	参数类型	说明
result	LIST	result
$item	OBJECT	-
vid	INTEGER	Value ID
refPidName	STRING	Attribute Name
pid	INTEGER	Base property ID
pidName	STRING	Base property name
templatePid	INTEGER	Template property ID
value	STRING	Value
refPid	INTEGER	Attribute ID
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
2000000	Business anomaly	If there is a service error, please contact the relevant product manager for assistance.
3000000	Incorrect request parameters	Check the incoming request parametersCheck the incoming request parameters
4000000	System malfunction	System malfunction, please contact the relevant product manager for assistance.
4000004	Requests exceeded the limit	The request exceeded the limit; please contact the product manager to increase the quota.
5000000	Image processing in progress	Retry the query after a certain period of time.
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.glo.goods.cats.get

bg.glo.goods.cats.get
子类目查询
更新时间：2026-05-06 18:04:01
接口介绍：按层级查询类目
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
parentCatId	INTEGER	否	Parent Category ID, not passed when querying 1st level list
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
categoryDTOList	LIST	Category Subnode List
$item	OBJECT	-
catId	INTEGER	Category ID
catName	STRING	Category Name
parentCatId	INTEGER	Parent Category ID
catType	INTEGER	Category Type
isLeaf	BOOLEAN	Whether Leaf Category
catLevel	INTEGER	Category Hierarchy
isHidden	BOOLEAN	Whether to Hide
hiddenType	INTEGER	Hidden Type, 0: Not Hidden, 1: Normally Hidden, 2: Old Category, 3: Abandoned Category
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
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.glo.goods.attrs.get

bg.glo.goods.attrs.get
货品发布类目属性模板查询
更新时间：2026-04-29 22:27:22
接口介绍：货品发布时查询类目属性模板
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
catId	INTEGER	是	Leaf Category ID
productCreateTime	INTEGER	否	Product Creation Time (Millisecond Timestamp)
supportedType	INTEGER	否	Channel Type (if provided, this field takes priority, ignoring mallId)
langList	LIST	否	Language List (Query multi-language information, Chinese is not required, used in special scenarios, affects performance, generally not transmitted)
$item	STRING	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
inputMaxSpecNum	INTEGER	Maximum Custom Specification Quantity Allowed by Template
chooseAllQualifySpec	BOOLEAN	Whether to select all specifications (0: No; 1: Yes)
singleSpecValueNum	INTEGER	Single Custom Specification Value Upper Limit
templateId	INTEGER	Template ID
properties	LIST	Template Properties
$item	OBJECT	-
numberInputTitle	STRING	Number Input Title
templatePropertyValueParentList	LIST	Property Value Association Relationship
$item	OBJECT	-
parentVidList	LIST	Associated Property Value ID
$item	INTEGER	-
vidList	LIST	Property Value ID
$item	INTEGER	-
values	LIST	Template Property Values
$item	OBJECT	-
vid	INTEGER	Property Value ID
specId	INTEGER	Specification ID
lang2Value	MAP	Multilingual Property Value
$key	STRING	-
$value	STRING	-
parentVidList	LIST	Corresponding Parent Property Value ID
$item	INTEGER	-
extendInfo	STRING	Extended Information
value	STRING	Property Value
group	OBJECT	Group Information
name	STRING	Group Name
id	INTEGER	Group ID
valueUnit	LIST	Property Value Unit
$item	STRING	-
referenceType	INTEGER	Property Reference Type
pid	INTEGER	Basic Property ID
templatePid	INTEGER	Template Property ID
required	BOOLEAN	Whether Required
inputMaxNum	INTEGER	Maximum Input Quantity (0 means input is not allowed)
propertyValueType	INTEGER	Property Value Type
minValue	STRING	Input Minimum Value
feature	INTEGER	Property Feature
valueRule	INTEGER	Value Rule
propertyChooseTitle	STRING	Property Selection Title
showType	INTEGER	Show Type
parentTemplatePid	INTEGER	Parent Template Property ID
mainSale	BOOLEAN	Whether it is the Main Sales Property
parentSpecId	INTEGER	Parent Specification ID
maxValue	STRING	Input Maximum Value (Text type represents maximum text length; Numeric type represents maximum number value; Time type represents maximum time value)
lang2Name	MAP	Multilingual Property Name
$key	STRING	-
$value	STRING	-
chooseMaxNum	INTEGER	Maximum Number of Selectable Items
valuePrecision	INTEGER	Maximum allowed decimal precision (0 means decimal input is not allowed)
showCondition	LIST	Property Display Condition or Relationship
$item	OBJECT	-
parentRefPid	INTEGER	Parent Reference Property ID
parentVids	LIST	Parent Value IDs (If the property is showed conditionally, the property can only be used when the value in parentVids is selected)
$item	INTEGER	-
controlType	INTEGER	Control Type
name	STRING	Property Name
isSale	BOOLEAN	Whether it's a Sales Property (distinguishes between ordinary properties and specification properties)
refPid	INTEGER	Reference Property ID
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
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.glo.goods.category.match

bg.glo.goods.category.match
类目搜索
更新时间：2026-04-29 22:27:22
接口介绍：对接方可以根据类目名称查找到适合的类目进行发品挂靠
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
searchText	STRING	否	Search Text (max length: 200)
siteId	INTEGER	否	Site ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
categoryPathDTOS	LIST	Category Path Result List
$item	OBJECT	-
cat9DTO	OBJECT	Ninth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
parentCatId	INTEGER	Parent Category ID
catType	INTEGER	Category Type
isLeaf	BOOLEAN	Whether Leaf Category
catLevel	INTEGER	Category Hierarchy
isHidden	BOOLEAN	Whether to Hide
hiddenType	INTEGER	Hidden Type, 0: Not Hidden, 1: Normally Hidden, 2: Old Category, 3: Abandoned Category
cat8DTO	OBJECT	8th Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
parentCatId	INTEGER	Parent Category ID
catType	INTEGER	Category Type
isLeaf	BOOLEAN	Whether Leaf Category
catLevel	INTEGER	Category Hierarchy
isHidden	BOOLEAN	Whether to Hide
hiddenType	INTEGER	Hidden Type, 0: Not Hidden, 1: Normally Hidden, 2: Old Category, 3: Abandoned Category
cat6DTO	OBJECT	Sixth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
parentCatId	INTEGER	Parent Category ID
catType	INTEGER	Category Type
isLeaf	BOOLEAN	Whether Leaf Category
catLevel	INTEGER	Category Hierarchy
isHidden	BOOLEAN	Whether to Hide
hiddenType	INTEGER	Hidden Type, 0: Not Hidden, 1: Normally Hidden, 2: Old Category, 3: Abandoned Category
cat7DTO	OBJECT	Seventh-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
parentCatId	INTEGER	Parent Category ID
catType	INTEGER	Category Type
isLeaf	BOOLEAN	Whether Leaf Category
catLevel	INTEGER	Category Hierarchy
isHidden	BOOLEAN	Whether to Hide
hiddenType	INTEGER	Hidden Type, 0: Not Hidden, 1: Normally Hidden, 2: Old Category, 3: Abandoned Category
cat10DTO	OBJECT	Tenth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
parentCatId	INTEGER	Parent Category ID
catType	INTEGER	Category Type
isLeaf	BOOLEAN	Whether Leaf Category
catLevel	INTEGER	Category Hierarchy
isHidden	BOOLEAN	Whether to Hide
hiddenType	INTEGER	Hidden Type, 0: Not Hidden, 1: Normally Hidden, 2: Old Category, 3: Abandoned Category
cat2DTO	OBJECT	Secondary Category
catId	INTEGER	Category ID
catName	STRING	Category Name
parentCatId	INTEGER	Parent Category ID
catType	INTEGER	Category Type
isLeaf	BOOLEAN	Whether Leaf Category
catLevel	INTEGER	Category Hierarchy
isHidden	BOOLEAN	Whether to Hide
hiddenType	INTEGER	Hidden Type, 0: Not Hidden, 1: Normally Hidden, 2: Old Category, 3: Abandoned Category
cat5DTO	OBJECT	Fifth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
parentCatId	INTEGER	Parent Category ID
catType	INTEGER	Category Type
isLeaf	BOOLEAN	Whether Leaf Category
catLevel	INTEGER	Category Hierarchy
isHidden	BOOLEAN	Whether to Hide
hiddenType	INTEGER	Hidden Type, 0: Not Hidden, 1: Normally Hidden, 2: Old Category, 3: Abandoned Category
cat3DTO	OBJECT	Third-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
parentCatId	INTEGER	Parent Category ID
catType	INTEGER	Category Type
isLeaf	BOOLEAN	Whether Leaf Category
catLevel	INTEGER	Category Hierarchy
isHidden	BOOLEAN	Whether to Hide
hiddenType	INTEGER	Hidden Type, 0: Not Hidden, 1: Normally Hidden, 2: Old Category, 3: Abandoned Category
cat4DTO	OBJECT	Fourth-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
parentCatId	INTEGER	Parent Category ID
catType	INTEGER	Category Type
isLeaf	BOOLEAN	Whether Leaf Category
catLevel	INTEGER	Category Hierarchy
isHidden	BOOLEAN	Whether to Hide
hiddenType	INTEGER	Hidden Type, 0: Not Hidden, 1: Normally Hidden, 2: Old Category, 3: Abandoned Category
cat1DTO	OBJECT	First-Level Category
catId	INTEGER	Category ID
catName	STRING	Category Name
parentCatId	INTEGER	Parent Category ID
catType	INTEGER	Category Type
isLeaf	BOOLEAN	Whether Leaf Category
catLevel	INTEGER	Category Hierarchy
isHidden	BOOLEAN	Whether to Hide
hiddenType	INTEGER	Hidden Type, 0: Not Hidden, 1: Normally Hidden, 2: Old Category, 3: Abandoned Category
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
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type
