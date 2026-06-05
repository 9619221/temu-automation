# 说明书API组

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 5 个接口


---

## bg.goods.instructions.upload

bg.goods.instructions.upload
文件上传接口
更新时间：2026-05-27 14:21:31
接口介绍：文件上传接口
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
base64File	STRING	是	-
supplierId	INTEGER	是	供应商ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
pdfId	INTEGER	pdf id
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
2000000	BUSINESS_EXCEPTION	结合具体报错文案排查，如有疑问请联系管理员
3000000	BAD_PARAMS	参数错误，结合具体报错文案排查，如有疑问请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.goods.instructionslanguages.get

bg.goods.instructionslanguages.get
说明书语种查询信息
更新时间：2025-03-26 17:35:32
接口介绍：说明书语种查询信息
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
supplierId	INTEGER	是	供应商ID
pdfId	INTEGER	是	pdf id
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
pdfId	INTEGER	pdf id
languages	LIST	语种
$item	STRING	-
status	INTEGER	状态 2-已识别
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
2000000	BUSINESS_EXCEPTION	结合具体报错文案排查，如有疑问请联系管理员
3000000	BAD_PARAMS	参数错误，结合具体报错文案排查，如有疑问请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.goods.instructionstranslation.get

bg.goods.instructionstranslation.get
说明书翻译接口
更新时间：2025-03-26 17:35:32
接口介绍：说明书翻译接口
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
supplierId	INTEGER	是	供应商ID
targetLanguageCodeList	LIST	是	目标语言编码列表
$item	STRING	否	-
pdfId	INTEGER	是	PDF文件ID
selectedSourceLanguageCode	STRING	是	选中的源语言编码
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
translateId	INTEGER	翻译记录ID
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
2000000	BUSINESS_EXCEPTION	结合具体报错文案排查，如有疑问请联系管理员
3000000	BAD_PARAMS	参数错误，结合具体报错文案排查，如有疑问请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.goods.translationresult.get

bg.goods.translationresult.get
查询说明书翻译结果
更新时间：2025-03-26 17:35:32
接口介绍：查询说明书翻译结果
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
translateId	INTEGER	是	翻译记录ID
supplierId	INTEGER	是	供应商ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
pdfId	INTEGER	PDF文件ID
languages	LIST	语种
$item	STRING	-
finished	BOOLEAN	是否完成
failReason	STRING	失败原因
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
2000000	BUSINESS_EXCEPTION	结合具体报错文案排查，如有疑问请联系管理员
3000000	BAD_PARAMS	参数错误，结合具体报错文案排查，如有疑问请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.goods.catsmandatory.get

bg.goods.catsmandatory.get
类目必填信息接口
更新时间：2026-01-30 17:33:19
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
bindSiteIds	LIST	否	绑定站点列表
$item	INTEGER	否	-
configItems	LIST	是	类目配置项列表
$item	INTEGER	否	-
leafCatId	INTEGER	是	叶子类目id
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
needGuideFile	BOOLEAN	说明书是否必传
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
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type
