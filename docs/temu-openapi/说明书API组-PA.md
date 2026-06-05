# 说明书API组-PA

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 5 个接口


---

## bg.glo.goods.edit.guide.file

bg.glo.goods.edit.guide.file
编辑货品说明书
更新时间：2025-09-14 11:20:51
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
productId	INTEGER	是	Product ID
productGuideFileReqs	LIST	是	Product Manual File [Pass empty List to delete manual]
$item	OBJECT	否	-
fileName	STRING	是	File Name
pdfMaterialId	INTEGER	是	PDF File ID
languages	LIST	是	Language
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
说明书API组	He uses type、Self use type


---

## bg.glo.goods.instructions.upload

bg.glo.goods.instructions.upload
文件上传接口
更新时间：2026-04-13 10:58:55
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
base64File	STRING	是	PDF file in base64 format
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

## bg.glo.goods.instructionstranslation.get

bg.glo.goods.instructionstranslation.get
说明书翻译接口
更新时间：2026-04-19 18:18:33
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
targetLanguageCodeList	LIST	是	Target Language Code List
$item	STRING	否	-
pdfId	INTEGER	是	PDF File ID
selectedSourceLanguageCode	STRING	是	Selected Source Language Code
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
translateId	INTEGER	Translation Record ID
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

## bg.glo.goods.translationresult.get

bg.glo.goods.translationresult.get
查询说明书翻译结果
更新时间：2026-04-19 18:18:33
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
translateId	INTEGER	是	Translation Record ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
pdfId	INTEGER	PDF File ID
languages	LIST	Language
$item	STRING	-
finished	BOOLEAN	Whether Completed
failReason	STRING	Failure Reason
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

## bg.glo.goods.instructionslanguages.get

bg.glo.goods.instructionslanguages.get
说明书语种查询信息
更新时间：2026-04-19 18:18:33
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
pdfId	INTEGER	是	pdf id
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
pdfId	INTEGER	pdf id
languages	LIST	Language
$item	STRING	-
status	INTEGER	Status 2 - Identified
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
