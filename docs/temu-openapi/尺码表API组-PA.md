# 尺码表API组-PA

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 7 个接口


---

## bg.glo.goods.size.template.edit

bg.glo.goods.size.template.edit
编辑货品尺码表
更新时间：2025-08-27 16:57:38
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
productId	INTEGER	是	Product ID
showSizeTemplateIds	LIST	是	Key Display Size Table Template ID List
$item	INTEGER	否	-
sizeTemplateIds	LIST	是	Size Chart Template ID List
$item	INTEGER	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
success	BOOLEAN	Edit result
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
尺码表API组	He uses type、Self use type


---

## bg.glo.goods.sizecharts.meta.get

bg.glo.goods.sizecharts.meta.get
尺码组元信息查询
更新时间：2026-04-29 22:27:23
接口介绍：查询尺码组元信息
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
catId	INTEGER	否	Category ID
classId	INTEGER	否	Classification ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
allowRange	BOOLEAN	Whether to Support Flat Quantity - Pull Quantity
sizeSpecMeta	OBJECT	Size Chart Classification Metadata
sizeTypeElementsList	LIST	Size Type Elements List
$item	OBJECT	-
sizeType	INTEGER	Size Type (0: regular; 1: wide fit)
elements	LIST	Elements
$item	OBJECT	-
necessary	BOOLEAN	Whether Necessary (default unnecessary)
name	STRING	Name
id	INTEGER	ID
groupList	LIST	Group List
$item	OBJECT	-
name	STRING	Name
unnecessary	BOOLEAN	Whether it's unnecessary (default is necessary)
id	INTEGER	ID
elementList	LIST	Element List
$item	OBJECT	-
necessary	BOOLEAN	Whether Necessary (default unnecessary)
name	STRING	Name
id	INTEGER	ID
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

## bg.glo.goods.sizecharts.class.get

bg.glo.goods.sizecharts.class.get
尺码组查询
更新时间：2026-04-29 22:27:23
接口介绍：查询尺码组
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
catId	INTEGER	否	Category ID
classId	INTEGER	否	Classification ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
sizeSpecClassCat	OBJECT	Size Chart Classification-Category Relationship
catId	INTEGER	Leaf Category ID
classId	INTEGER	Classification ID
parentClassId	INTEGER	Parent Classification ID
relatedClassIds	LIST	Related Classification ID List (Only effective for suit type)
$item	INTEGER	-
classType	INTEGER	Classification Type (0: normal, 1: suit)
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

## bg.glo.goods.sizecharts.settings.get

bg.glo.goods.sizecharts.settings.get
尺码表可选发布码查询
更新时间：2026-04-29 22:27:23
接口介绍：查询尺码表可选发布码
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
catId	INTEGER	否	Category ID
classId	INTEGER	否	Classification ID
shoeSizeType	INTEGER	否	Shoe Size Type (null/0: REGULAR; 1: Wide Fit)
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
mappingContent	OBJECT	Mapping Content
records	LIST	Size Chart Metadata-Value Mapping Records
$item	OBJECT	-
values	MAP	Metadata ID-Value Mapping
$key	STRING	-
$value	STRING	-
meta	OBJECT	Size Chart Metadata
elements	LIST	(Deprecated, please use elementList)
$item	OBJECT	-
name	STRING	Name
id	INTEGER	ID
groups	LIST	(Deprecated, please use groupList)
$item	OBJECT	-
name	STRING	Name
id	INTEGER	ID
groupList	LIST	Group List
$item	OBJECT	-
name	STRING	Name
unnecessary	BOOLEAN	Whether it's unnecessary (default is necessary)
id	INTEGER	ID
elementList	LIST	Element List
$item	OBJECT	-
necessary	BOOLEAN	Whether Necessary (default unnecessary)
name	STRING	Name
id	INTEGER	ID
code	INTEGER	Group Code
groupChName	STRING	Group Chinese Name
sizeList	LIST	Size List
$item	STRING	-
groupEnName	STRING	Group English Name
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

## bg.glo.goods.sizecharts.get

bg.glo.goods.sizecharts.get
查询尺码表模板
更新时间：2026-04-29 22:27:23
接口介绍：查询已创建的尺码表模板
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
catId	INTEGER	否	Category ID
offset	INTEGER	是	Offset
pageSize	INTEGER	否	Page Size
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
offset	INTEGER	Offset
pageSize	INTEGER	Page Size
totalCount	INTEGER	Total Count
sizeSpecDataList	LIST	List Data
$item	OBJECT	-
classId	INTEGER	Classification ID
contentDTO	OBJECT	Content
records	LIST	Size Chart Metadata-Value Mapping Records
$item	OBJECT	-
values	MAP	Metadata ID-Value Mapping
$key	STRING	-
$value	STRING	-
meta	OBJECT	Size Chart Metadata
elements	LIST	(Deprecated, please use elementList)
$item	OBJECT	-
name	STRING	Name
id	INTEGER	ID
groups	LIST	(Deprecated, please use groupList)
$item	OBJECT	-
name	STRING	Name
id	INTEGER	ID
supplierId	INTEGER	Supplier ID
businessId	INTEGER	Size Chart ID
name	STRING	Size Chart Name
reusable	BOOLEAN	Whether it's reusable
updatedAt	INTEGER	Update Time
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

## bg.glo.goods.sizecharts.template.create

bg.glo.goods.sizecharts.template.create
根据尺码表模板创建货品尺码表
更新时间：2026-04-29 22:27:23
接口介绍：根据尺码表模板创建货品尺码表
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
businessId	INTEGER	是	Template Size Chart ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
tempBusinessId	INTEGER	Temporary Size Chart ID
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
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.glo.goods.sizecharts.create

bg.glo.goods.sizecharts.create
创建尺码表
更新时间：2026-04-29 22:27:23
接口介绍：创建尺码表
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
ext	OBJECT	否	Extended Information
shoeSizeType	INTEGER	否	Shoe Size Type (null/0: Regular; 1: Wide Fit)
isDoubleSize	BOOLEAN	否	Whether it's dual size (default no if not provided)
manualGroupIdList	LIST	否	Manually Entered Size Group ID List
$item	INTEGER	否	-
catId	INTEGER	否	Category ID
classId	INTEGER	否	Classification ID
name	STRING	否	Name
content	OBJECT	是	Content
records	LIST	是	Size Chart Metadata-Value Mapping Records
$item	OBJECT	否	-
values	MAP	否	Metadata ID-Value Mapping
$key	STRING	否	-
$value	STRING	否	-
meta	OBJECT	是	Size Chart Metadata
groupList	LIST	是	Group List
$item	OBJECT	否	-
name	STRING	是	Name
id	INTEGER	是	ID
elementList	LIST	是	Element List
$item	OBJECT	否	-
name	STRING	是	Name
id	INTEGER	是	ID
generalSizeType	INTEGER	否	Release Code (same as Size Group ID)
localSizeSource	INTEGER	否	Local Size Source
bodyRecords	LIST	否	Size Chart Metadata-Value Mapping Records (Body)
$item	OBJECT	否	-
values	MAP	否	Metadata ID-Value Mapping
$key	STRING	否	-
$value	STRING	否	-
bodyMeta	OBJECT	否	Size Chart Metadata (Body)
groupList	LIST	是	Group List
$item	OBJECT	否	-
name	STRING	是	Name
id	INTEGER	是	ID
elementList	LIST	是	Element List
$item	OBJECT	否	-
name	STRING	是	Name
id	INTEGER	是	ID
reusable	BOOLEAN	是	Whether Reusable
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
businessId	INTEGER	Size Chart ID
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
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type
