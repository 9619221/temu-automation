# JIT组-PA

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 1 个接口


---

## bg.glo.jitmode.activate

bg.glo.jitmode.activate
打开JIT
更新时间：2025-08-27 16:57:38
接口介绍：【开平】JIT开通/关闭接口
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
productId	INTEGER	是	Product Id
productSkcId	INTEGER	是	Product SKC ID
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
JIT API组	He uses type、Self use type
