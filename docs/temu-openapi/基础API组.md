# 基础API组

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 2 个接口


---

## bg.mall.info.get

bg.mall.info.get
查询当前token对应店铺类型信息
更新时间：2025-02-25 11:20:45
接口介绍：查询当前token对应店铺类型信息
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
semiManagedMall	BOOLEAN	是否是半托管店铺，true-是，false-否
isThriftStore	BOOLEAN	是否是二手店, true-是, false-否
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
200000001	店铺未找到	检查店铺是否有效
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
ISV基础接口	He uses type、Self use type


---

## bg.open.accesstoken.info.get

bg.open.accesstoken.info.get
查询当前token对应授权信息
更新时间：2026-06-02 23:30:41
接口介绍：按token查询授权信息接口
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
access_token	STRING	是	accessToken
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	-
mallId	INTEGER	店铺id
expiredTime	INTEGER	过期时间，时间戳，秒
apiScopeList	LIST	当前token已授权的接口信息，以apiName形式展示
$item	STRING	-
success	BOOLEAN	-
errorCode	INTEGER	-
errorMsg	STRING	-
返回错误码说明
收起
错误码	错误描述	解决办法
暂无数据
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
ISV基础接口	He uses type、Self use type
