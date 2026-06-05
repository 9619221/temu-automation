# 图片处理API组

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 5 个接口


---

## bg.compliancepicture.get

bg.compliancepicture.get
批量识别牛皮癣图片
更新时间：2025-03-14 17:15:14
接口介绍：批量识别牛皮癣图片
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
urlList	LIST	否	图片url的list
$item	STRING	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
list	LIST	返回结果
$item	OBJECT	-
hasSpot	STRING	返回结果true or false
imageUrl	STRING	图片url
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
货品API组	He uses type、Self use type


---

## bg.algo.dimension.image.check

bg.algo.dimension.image.check
尺寸图校验
更新时间：2025-03-10 16:10:41
接口介绍：部分类目要求在商品轮播图必须上传尺寸图，尺寸图要求必须使用公制和英制单位，需要提供对应的尺寸图校验接口给外部商家
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
mallId	STRING	否	商家Id
imageUrl	STRING	否	原始图片
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
errorCode	INTEGER	错误码
uniqueId	STRING	唯一键
errorMsg	STRING	错误信息
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1000000	成功	图片尺寸图请求校验成功
2000000	业务异常	业务异常，联系对应产品进行处理
3000000	参数错误	检查传入的业务参数是否正确
4000000	系统异常	系统异常，联系对应产品进行处理
4000004	请求超出限额	翻译配额超额，联系产品增加翻译配额
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.algo.dimension.image.check.result

bg.algo.dimension.image.check.result
尺寸图校验结果查询
更新时间：2025-03-10 16:10:41
接口介绍：部分类目要求在商品轮播图必须上传尺寸图，尺寸图要求必须使用公制和英制单位，需要提供对应的尺寸图校验接口给外部商家
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
uniqueId	STRING	否	唯一键
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
imageUrl	STRING	原始图片
errorCode	INTEGER	错误码
imageType	INTEGER	识别结果：0: 非尺寸图 1: 不符合要求尺寸图（只包含英制/公制） 2: 正确的尺寸图
uniqueId	STRING	唯一键
errorMsg	STRING	错误信息
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1000000	成功	图片尺寸图请求校验成功
2000000	业务异常	业务异常，联系对应产品进行处理
3000000	参数错误	检查传入的业务参数是否正确
4000000	系统异常	系统异常，联系对应产品进行处理
4000004	请求超出限额	翻译配额超额，联系产品增加翻译配额
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.algo.image.translate.result

bg.algo.image.translate.result
商品图片翻译接口查询
更新时间：2026-04-12 14:08:44
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
taskId	STRING	是	图片处理任务Id
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
imageBackgroundUrl	STRING	底图url
imageUrl	STRING	原图url
textBoxList	LIST	识别的所有文本框
$item	OBJECT	-
translatedText	STRING	翻译后的文本内容
polygon	LIST	文本框的四角, 为[左上x, 左上y, 右上x, 右上y, 左下x, 左下y, 右下x, 右下y]
$item	INTEGER	-
needTranslate	BOOLEAN	是否需要翻译
text	STRING	原文本内容
textColor	LIST	文本颜色, rgb颜色, 格式为[red, green, blue]
$item	INTEGER	-
resultCode	INTEGER	resultCode
needTranslate	BOOLEAN	是否需要翻译
imageResultUrl	STRING	结果图url
hasText	BOOLEAN	是否有文本
resultMsg	STRING	resultMsg
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
2000000	业务异常	业务异常，联系对应的产品进行处理
3000000	请求参数错误	检查传入的请求参数
4000000	系统异常	系统异常，联系对应的产品进行处理
4000004	请求超出限额	请求超出限额，联系产品增加配额
5000000	图片处理中	等待一定时间后，进行重试查询
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.algo.image.translate

bg.algo.image.translate
商品图片翻译
更新时间：2026-04-12 14:09:24
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
targetLang	STRING	是	目标语言
imageUrl	STRING	是	原图url
customTaskId	INTEGER	是	商家自定义Id；用于外部多次请求去重
isContainDetail	BOOLEAN	是	是否返回识别明细
language	STRING	是	源语言 zh/en
scene	STRING	否	场景名
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
resultCode	INTEGER	返回结果
taskId	STRING	图片处理任务Id
resultMsg	STRING	返回结果
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
2000000	业务异常	业务异常，联系对应的产品进行处理
3000000	请求参数错误	检查传入的请求参数
4000000	系统异常	系统异常，联系对应的产品进行处理
4000004	请求超出限额	请求超出限额，联系产品增加配额
5000000	图片处理中	等待一定时间后，进行重试查询
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type
