# 模特API组

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 4 个接口


---

## bg.modelinfo.get

bg.modelinfo.get
模特信息查询
更新时间：2025-03-26 14:33:26
接口介绍：模特信息查询
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
modelName	STRING	否	-
pageNo	INTEGER	是	-
pageSize	INTEGER	是	-
id	INTEGER	否	-
modelType	INTEGER	是	可选值含义说明:[0:成衣模特;1:鞋模;]
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
total	INTEGER	总数
modelList	LIST	模特列表
$item	OBJECT	-
modelName	STRING	模特名称
supplierId	INTEGER	供应商ID
canEdit	BOOLEAN	是否可编辑，仅为false才不可编辑与删除
clothesModel	OBJECT	成衣模特信息
hipline	STRING	臀围
bust	STRING	胸围
waist	STRING	腰围
height	STRING	身高
shoeModel	OBJECT	鞋模信息
footLength	STRING	脚长
footWidth	STRING	脚宽
id	INTEGER	ID
modelType	INTEGER	模特类型. 可选值含义说明:[0:成衣模特;1:鞋模;]
headPortrait	STRING	头像
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
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.modelcats.get

bg.modelcats.get
可添加模特类目查询
更新时间：2025-03-26 14:33:26
接口介绍：可添加模特类目查询
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
catId	INTEGER	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
enabled	BOOLEAN	模特是否可用
enabledModelType	INTEGER	可用的模特类型. 可选值含义说明:[0:成衣模特;1:鞋模;]
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

## bg.modelinfo.add

bg.modelinfo.add
新增模特信息
更新时间：2025-03-26 14:33:26
接口介绍：新增模特信息
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
modelName	STRING	是	-
clothesModel	OBJECT	否	-
hipline	STRING	是	-
bust	STRING	是	-
waist	STRING	是	-
height	STRING	是	-
shoeModel	OBJECT	否	-
footLength	STRING	是	-
footWidth	STRING	是	-
modelType	INTEGER	是	-
headPortrait	STRING	否	-
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
2000000	BUSINESS_EXCEPTION	结合具体报错文案排查，如有疑问请联系管理员
3000000	BAD_PARAMS	参数错误，结合具体报错文案排查，如有疑问请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.modelinfo.edit

bg.modelinfo.edit
编辑模特信息
更新时间：2025-03-26 14:33:26
接口介绍：编辑模特信息
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
modelName	STRING	是	-
isDelete	BOOLEAN	否	-
clothesModel	OBJECT	否	-
hipline	STRING	是	-
bust	STRING	是	-
waist	STRING	是	-
height	STRING	是	-
shoeModel	OBJECT	否	-
footLength	STRING	是	-
footWidth	STRING	是	-
id	INTEGER	是	-
modelType	INTEGER	是	-
headPortrait	STRING	否	-
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
2000000	BUSINESS_EXCEPTION	结合具体报错文案排查，如有疑问请联系管理员
3000000	BAD_PARAMS	参数错误，结合具体报错文案排查，如有疑问请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type
