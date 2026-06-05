# JIT组

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 3 个接口


---

## bg.jitmode.activate

bg.jitmode.activate
打开JIT
更新时间：2026-02-02 20:43:56
接口介绍：【开平】JIT开通/关闭接口 https://brook.kuajing.team/requirement/BG-317083
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
productId	INTEGER	是	货品Id
productSkcId	INTEGER	是	货品skcId
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
100000001	system error	wait and retry for a few times, otherwise contact us
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
JIT模式API组	He uses type、Self use type


---

## bg.virtualinventoryjit.rule.sign

bg.virtualinventoryjit.rule.sign
jit预售规则签署接口
更新时间：2026-02-02 20:44:16
接口介绍：jit预售规则签署接口
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
productId	LONG	是	货品id
agtVersion	INTEGER	是	JIT预售协议版本号
productAgtType	INTEGER	是	货品协议类型，1-JIT模式快速售卖协议
url	STRING	是	JIT协议链接
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
100000001	system error	wait and retry for a few times, otherwise contact us
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
JIT模式API组	He uses type、Self use type


---

## bg.virtualinventoryjit.rule.get

bg.virtualinventoryjit.rule.get
jit预售规则查询接口
更新时间：2026-02-03 14:06:02
接口介绍：jit预售规则查询接口
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
version	INTEGER	JIT最新版本
protocolUrl	STRING	协议链接
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
100000001	System error.	System error. Please wait and try again.
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
JIT模式API组	He uses type、Self use type
