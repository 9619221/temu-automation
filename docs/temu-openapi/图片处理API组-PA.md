# 图片处理API组-PA

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 8 个接口


---

## bg.goods.image.upload.global

bg.goods.image.upload.global
bas64图片上传-global
更新时间：2025-06-22 20:00:52
接口介绍：图片上传接口
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
image	STRING	否	支持格式有：jpg/jpeg、png等图片格式，注意入参图片必须转码为base64编码
imageBizType	INTEGER	否	枚举值：0、1，入参1返回的url用以货品发布时的外包装使用
options	OBJECT	否	-
cateId	INTEGER	否	叶子类目ID，按不同类型进行裁剪，当doIntelligenceCrop=true生效
doIntelligenceCrop	BOOLEAN	否	是否AI智能裁剪，true-根据sizeMode返回一组智能裁剪图（1张原图+3张裁剪图）
boost	BOOLEAN	否	是否AI清晰度提升
sizeMode	INTEGER	否	返回尺寸大小，0-原图大小，1-800*800（1:1），2-1350*1800（3:4）
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
urls	LIST	-
$item	STRING	-
imageUrl	STRING	-
url	STRING	-
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
120000000	系统异常，请稍后再试	一般为系统抖动，请稍后重试
120000001	请求入参非法	请检查请求入参后重试
120000021	图片Base64编码非法	请检查请求入参后重试
120000022	图片Base64编码解码失败	请检查请求入参后重试
120000023	图片上传失败，请稍后再试	一般为系统抖动，请稍后重试
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.goods.texttopicture.add.global

bg.goods.texttopicture.add.global
文字转图片-global
更新时间：2025-06-23 13:55:39
接口介绍：文字转图片
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
backColor	STRING	是	背景颜色,必须以#开头，后面的数字是十六进制，不指定透明通道的话总共7个字符，指定透明通道的话总共9个字符
text	STRING	是	文本
align	STRING	是	对齐方式,left,center,right
fontColor	STRING	是	字体颜色,必须以#开头，后面的数字是十六进制，不指定透明通道的话总共7个字符，指定透明通道的话总共9个字符
font	STRING	是	字体,Source Han Sans CN Heavy/Bold/Medium/Regular/Light/Extralight, Source Han Serif Heavy/Bold
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
imageUrl	STRING	-
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
120000000	系统异常，请稍后再试	一般为系统抖动，请稍后重试
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.glo.picturecompression.get

bg.glo.picturecompression.get
高清图片压缩处理
更新时间：2025-06-26 20:25:16
接口介绍：高清图片压缩处理
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
urls	LIST	否	图片链接数组，数量建议不超过30个
$item	STRING	否	图片链接
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	结果
results	LIST	结果数组
$item	OBJECT	结果对象
size	INTEGER	结果图片存储空间占用，单位 Byte。例如 724955，就是图片有 700 KB 左右。
originUrl	STRING	原始图片链接。
width	INTEGER	结果图片宽度，单位：像素。例如 1500。
resultUrl	STRING	结果图片链接。公网可直接访问，永久有效，但建议调用方自己转存一份。
height	INTEGER	结果图片高度，单位：像素。例如 2000。
success	BOOLEAN	调用状态。【true】成功，false【失败】
errorCode	INTEGER	错误码
errorMsg	STRING	错误信息
返回错误码说明
收起
错误码	错误描述	解决办法
100000000	unknown system error	Please retry or report the issue.
100000001	invoke failed	Please check your image and retry. If still unsuccessful, please report the issue.
100000003	image download error	Please check your image and retry. If still unsuccessful, please report the issue.
100001001	reqeust empty	Please check your reqeust.
100001002	request missing field	Please check your reqeust.
100001003	request param error	Please check your reqeust.
100100000	internal error	Please retry or report the issue
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
图片API组	He uses type、Self use type


---

## bg.glo.colorimageurl.get

bg.glo.colorimageurl.get
色块图获取
更新时间：2025-06-26 20:25:16
接口介绍：色块图获取
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
rgba	OBJECT	否	可选项，颜色值。
a	INTEGER	否	可选项，透明度，冗余参数，默认赋值为1。
r	INTEGER	否	可选项，red，红色色值，范围为0到255。
b	INTEGER	否	可选项，blue，蓝色色值，范围为0到255。
g	INTEGER	否	可选项，green，绿色色值，范围为0到255。
coor	OBJECT	否	可选项，商品服饰的中心点坐标，如果不传会自动计算。如果图片尺寸为 400 × 500，服装中心点在 200×300， 那 x 就传 200， y 就传 300。
x	INTEGER	否	可选项，商品服饰中心点横坐标。例如传 200。
y	INTEGER	否	可选项，商品服饰中心点纵坐标。例如传 300。
imageUrl	STRING	否	图片链接。
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	结果对象
rgbaRec	OBJECT	结果对象的颜色信息
a	INTEGER	透明度，默认赋值为1。
r	INTEGER	red，红色色值，范围为0到255。
b	INTEGER	blue，蓝色色值，范围为0到255。
g	INTEGER	green，绿色色值，范围为0到255。
confidence	STRING	置信度，[0, 1]，为 1 时置信度最高。
resultUrl	STRING	结果图片 URL，公网可直接访问，永久有效，但建议调用方自己转存一份。
success	BOOLEAN	调用状态。【true】成功，false【失败】
errorCode	INTEGER	错误码
errorMsg	STRING	错误信息
返回错误码说明
收起
错误码	错误描述	解决办法
100000000	unknown system error	Please retry or report the issue.
100000001	invoke failed	Please check your image and retry. If still unsuccessful, please report the issue.
100000003	image download error	Please check your image and retry. If still unsuccessful, please report the issue.
100001001	reqeust empty	Please check your reqeust.
100001002	request missing field	Please check your reqeust.
100001003	request param error	Please check your reqeust.
100100000	internal error	Please retry or report the issue
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
图片API组	He uses type、Self use type


---

## bg.glo.fancy.image.cm2in

bg.glo.fancy.image.cm2in
图片中cm转inch
更新时间：2025-06-26 20:25:16
接口介绍：接口可以把公制单位的图片，自动转换成英制单位的图片，适配销售国
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
imageUrl	STRING	是	图片链接
返回参数说明
收起
参数接口	参数类型	说明
code	INTEGER	错误码
errMsg	STRING	错误信息
resultUrl	STRING	图片链接，无需加签，永久有效期，但建议自己转存一份
返回错误码说明
收起
错误码	错误描述	解决办法
100000000	unknown system error	Please retry or report the issue.
100000001	invoke failed	Please check your image and retry. If still unsuccessful, please report the issue.
100000002	invode time out	Please wait a moment and retry.
100001001	request is null	Please check your reqeust.
100001002	imageUrl is empty	Please check your reqeust.
100100000	internal error	Please retry or report the issue.
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
图片API组	He uses type、Self use type


---

## bg.compliancepicture.get.global

bg.compliancepicture.get.global
批量识别牛皮癣图片
更新时间：2025-12-29 23:57:47
接口介绍：Batch recognition of psoriasis images
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
urlList	LIST	否	List of image URLs
$item	STRING	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
list	LIST	Return result
$item	OBJECT	-
hasSpot	STRING	Return result true or false
imageUrl	STRING	Image URL
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
图片API组	He uses type、Self use type


---

## bg.algo.image.translate.global

bg.algo.image.translate.global
商品图片翻译
更新时间：2025-12-29 23:57:30
接口介绍：ERP商家的搬品，需要翻译商品图片到对应的语言
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
targetLang	STRING	是	Target language:['es', 'de', 'fr', 'nl', 'it', 'ja', 'ko', 'en','ar']
imageUrl	STRING	是	Original image URL
customTaskId	INTEGER	是	Merchant custom ID; used for de-duplication in multiple external requests
isContainDetail	BOOLEAN	是	Whether to return recognition details
language	STRING	是	Source language ['zh','en'
scene	STRING	否	Scene name
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
resultCode	INTEGER	Return result
taskId	STRING	Image processing task Id
resultMsg	STRING	Return result
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
图片API组	He uses type、Self use type


---

## bg.algo.image.translate.result.global

bg.algo.image.translate.result.global
商品图片翻译接口查询
更新时间：2025-12-29 23:56:58
接口介绍：erp商家搬品，需要提供商品图片翻译能力
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
taskId	STRING	是	Image processing task Id
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
imageBackgroundUrl	STRING	Background image URL
imageUrl	STRING	original image url
textBoxList	LIST	All recognized text boxes
$item	OBJECT	-
translatedText	STRING	Translated text content
polygon	LIST	The four corners of the text box, as [top-left x, top-left y, top-right x, top-right y, bottom-left x, bottom-left y, bottom-right x, bottom-right y]
$item	INTEGER	-
needTranslate	BOOLEAN	Whether translation is needed
text	STRING	Original text content
textColor	LIST	Text color, rgb color, format is [red, green, blue]
$item	INTEGER	-
resultCode	INTEGER	resultCode
needTranslate	BOOLEAN	Needs translation
imageResultUrl	STRING	Result image URL
hasText	BOOLEAN	Has text
resultMsg	STRING	resultMsg
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
图片API组	He uses type、Self use type
