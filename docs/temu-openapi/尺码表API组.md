# 尺码表API组

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 7 个接口


---

## bg.goods.sizecharts.get

bg.goods.sizecharts.get
查询尺码表模板
更新时间：2025-03-13 15:57:43
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
catId	INTEGER	否	类目ID
offset	INTEGER	是	锚点（第一页传0）
pageSize	INTEGER	否	页面大小
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
offset	INTEGER	锚点（第一页传0）
pageSize	INTEGER	页面大小
totalCount	INTEGER	总数
sizeSpecDataList	LIST	列表数据
$item	OBJECT	-
classId	INTEGER	分类ID
contentDTO	OBJECT	内容
records	LIST	商品尺码表元数据-值映射关系
$item	OBJECT	-
values	MAP	元数据ID与值的映射关系
$key	STRING	-
$value	STRING	-
meta	OBJECT	尺码组与尺码参数组元数据
elements	LIST	(废弃, 请使用 elementList)
$item	OBJECT	-
name	STRING	name
id	INTEGER	id
groups	LIST	(废弃, 请使用 groupList)
$item	OBJECT	-
name	STRING	name
id	INTEGER	id
supplierId	INTEGER	供应商ID
businessId	INTEGER	模板ID
name	STRING	模板名称
reusable	BOOLEAN	是否可复用
updatedAt	INTEGER	更新时间
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

## bg.goods.sizecharts.template.create

bg.goods.sizecharts.template.create
创建尺码表货品模板
更新时间：2025-03-13 15:57:43
接口介绍：用于创建尺码表模板
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
businessId	INTEGER	是	基础模板ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
tempBusinessId	INTEGER	临时模板ID
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
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.goods.sizecharts.class.get

bg.goods.sizecharts.class.get
查询尺码分类接口
更新时间：2025-03-13 15:57:43
接口介绍：用于查询尺码分组配置
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
catId	INTEGER	否	类目ID
classId	INTEGER	否	尺码组ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
sizeSpecClassCat	OBJECT	尺码组-类目关联关系
catId	INTEGER	叶子类目ID
classId	INTEGER	子分类ID
parentClassId	INTEGER	父分类ID
relatedClassIds	LIST	关联的分类ID列表 (仅对套装类型生效)
$item	INTEGER	-
classType	INTEGER	分类类型 (0: 普通类型, 1: 套装类型)
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

## bg.goods.sizecharts.create

bg.goods.sizecharts.create
新增尺码表接口
更新时间：2025-11-04 11:36:16
接口介绍：用于新增尺码表
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
ext	OBJECT	否	附加信息
isDoubleSize	BOOLEAN	否	是否为双码 (不传默认否)
manualGroupIdList	LIST	否	手动录入的尺码组
$item	INTEGER	否	-
catId	INTEGER	否	类目ID
classId	INTEGER	否	尺码分类ID
name	STRING	否	模板名称
content	OBJECT	是	内容
records	LIST	是	商品尺码表元数据-值映射关系
$item	OBJECT	否	-
values	MAP	否	元数据ID与值的映射关系
$key	STRING	否	元数据ID
$value	STRING	否	值
meta	OBJECT	是	尺码组与尺码参数元数据
groupList	LIST	是	尺码组元数据
$item	OBJECT	否	-
name	STRING	是	名称
id	INTEGER	是	ID
elementList	LIST	是	尺码参数元数据
$item	OBJECT	否	-
name	STRING	是	名称
id	INTEGER	是	ID
generalSizeType	INTEGER	否	发布码类型 (同尺码组id)
localSizeSource	INTEGER	否	本地码来源
bodyRecords	LIST	否	基码表元数据-值映射关系
$item	OBJECT	否	-
values	MAP	否	元数据ID与值的映射关系
$key	STRING	否	元数据ID
$value	STRING	否	值
bodyMeta	OBJECT	否	基码表尺码组与尺码参数元数据
groupList	LIST	是	尺码组元数据
$item	OBJECT	否	-
name	STRING	是	名称
id	INTEGER	是	ID
elementList	LIST	是	尺码参数元数据
$item	OBJECT	否	-
name	STRING	是	名称
id	INTEGER	是	ID
reusable	BOOLEAN	是	是否可复用
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
businessId	INTEGER	模板ID
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
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.goods.sizecharts.settings.get

bg.goods.sizecharts.settings.get
查询尺码模板规则
更新时间：2025-03-13 15:57:43
接口介绍：查询尺码模板规则
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
catId	INTEGER	否	类目ID
classId	INTEGER	否	尺码组ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
mappingContent	OBJECT	映射内容
records	LIST	商品尺码表元数据-值映射关系
$item	OBJECT	-
values	MAP	元数据ID与值的映射关系
$key	STRING	-
$value	STRING	-
meta	OBJECT	尺码组与尺码参数组元数据
elements	LIST	(废弃, 请使用 elementList)
$item	OBJECT	-
name	STRING	名称
id	INTEGER	id
groups	LIST	(废弃, 请使用 groupList)
$item	OBJECT	-
name	STRING	名称
id	INTEGER	id
groupList	LIST	尺码组元数据
$item	OBJECT	-
name	STRING	名称
unnecessary	BOOLEAN	是否非必填 (默认必填)
id	INTEGER	id
elementList	LIST	尺码参数组元数据
$item	OBJECT	-
necessary	BOOLEAN	是否必填 (默认非必填)
name	STRING	名称
id	INTEGER	id
code	INTEGER	编码
groupChName	STRING	中文代号
sizeList	LIST	尺码列表
$item	STRING	-
groupEnName	STRING	英文代号
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

## bg.goods.imagesizechart.get

bg.goods.imagesizechart.get
图片提取尺码表
更新时间：2026-04-12 14:19:05
接口介绍：图片提取尺码表
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
imageUrl	STRING	否	尺码表图片URL，需要通过图片上传接口转内网
sizeParameters	LIST	否	要抽取的尺码参数，填 '裤长', '袖长', '裙摆宽' 'Waist' 等等
$item	STRING	否	-
sizeEnums	LIST	否	要抽取哪些尺码，填 'XS'，'S'，'M'等
$item	STRING	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
detailsMap	MAP	-
$key	STRING	-
$value	MAP	-
$key	STRING	-
$value	OBJECT	-
extraData	MAP	-
$key	STRING	-
$value	STRING	-
value	STRING	-
unit	STRING	-
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
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.goods.sizecharts.meta.get

bg.goods.sizecharts.meta.get
查询尺码表元信息
更新时间：2025-03-13 15:57:43
接口介绍：查询尺码表元信息
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
catId	INTEGER	否	类目ID
classId	INTEGER	否	尺码组ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
allowRange	BOOLEAN	是否支持平量-拉量
sizeSpecMeta	OBJECT	尺码组元数据
groupList	LIST	尺码组元数据
$item	OBJECT	-
name	STRING	名称
unnecessary	BOOLEAN	是否非必填 (默认必填)
id	INTEGER	id
elementList	LIST	尺码参数组元数据
$item	OBJECT	-
necessary	BOOLEAN	是否必填 (默认非必填)
name	STRING	名称
id	INTEGER	id
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
