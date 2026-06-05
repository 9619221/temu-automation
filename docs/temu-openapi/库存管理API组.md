# 库存管理API组

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 5 个接口


---

## bg.virtualinventoryjit.get

bg.virtualinventoryjit.get
虚拟库存查询
更新时间：2026-02-05 19:53:34
接口介绍：用于jit商品的库存查询
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
productSkcId	INTEGER	是	货品SKC ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
productSkuStockList	LIST	货品SKU库存列表
$item	OBJECT	-
productSkuId	INTEGER	货品SKUId
skuStockQuantity	INTEGER	货品SKU库存, 商家不允许查看时返回null
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
2000000	业务异常	根据提示文案修改入参
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
JIT API组	He uses type、Self use type
JIT模式API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.virtualinventoryjit.edit

bg.virtualinventoryjit.edit
虚拟库存编辑
更新时间：2026-02-05 19:54:11
接口介绍：用于更新jit商品的库存
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
skuVirtualStockChangeList	LIST	是	虚拟库存模式下使用，虚拟库存调整信息.
$item	OBJECT	否	-
virtualStockDiff	INTEGER	是	虚拟库存(含商家自管库存)变更，大于0代表增加，小于0代表减少
productSkuId	INTEGER	是	货品 SKU ID.
productSkcId	INTEGER	是	货品SKC ID.
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
2000037	商品正在活动促销中，不允许库存调减	商品正在活动促销中，不允许库存调减
2000038	库存不允许减少	商家不能减少库存
23000001	当前暂不可添加预售库存，建议备货以实物库存销售	当前暂不可添加预售库存，建议备货以实物库存销售
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
JIT API组	He uses type、Self use type
JIT模式API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.goods.quantity.get

bg.goods.quantity.get
OpenApi查询半托管商品销售库存
更新时间：2026-02-05 19:52:29
接口介绍：OpenApi查询半托管商品销售库存
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
openApiUser	OBJECT	是	用户信息
supplierId	INTEGER	是	供应商id
productSkcId	INTEGER	是	货品SKC ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
productSkuStockList	LIST	货品SKU库存列表
$item	OBJECT	-
productSkuId	INTEGER	货品SKUId
skuStockQuantity	INTEGER	货品SKU库存, 商家不允许查看时返回null
warehouseId	STRING	自发货仓ID
enablePreSale	BOOLEAN	是否开启预售（true：开启，false：关闭）
preSaleDeliveryDay	INTEGER	在途库存补货日期（时间戳）
preSaleStockQuantity	INTEGER	预售库存件数
shippingMode	INTEGER	发货模式：1-卖家自发货，2-合作对接仓托管
warehouseName	STRING	发货仓名称
tempLockQuantity	INTEGER	未支付的库存数量
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
2000000	业务异常	根据提示文案修改入参
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
半托管库存API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.goods.quantity.update

bg.goods.quantity.update
OpenApi半托管销售库存更新接口
更新时间：2026-02-05 19:52:00
接口介绍：OpenApi更新半托管商品库存
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
openApiUser	OBJECT	是	用户信息
supplierId	INTEGER	是	供应商id
quantityChangeMode	INTEGER	否	更新库存数量方式（1-增减变更 2-覆盖变更）
skuStockChangeList	LIST	否	半托管SKU库存变更信息
$item	OBJECT	否	-
productSkuId	INTEGER	是	半托管货品 SKU ID.
targetStockAvailable	INTEGER	否	覆盖变更方式：覆盖变更目标库存值
warehouseId	STRING	否	发货仓ID-必填字段
stockDiff	INTEGER	否	增减变更方式：库存变更，大于0代表增加，小于0代表减少
skuPreSaleStockChangeList	LIST	否	半托管SKU预售库存信息
$item	OBJECT	否	预售信息
preSaleStockList	LIST	否	各个发货仓预售库存
$item	OBJECT	否	预售库存
productSkuId	INTEGER	是	半托管货品 SKU ID.
warehouseId	STRING	是	发货仓ID-必传
targetPreSaleStockAvailable	INTEGER	是	覆盖变更目标预售库存值
productSkuId	INTEGER	是	半托管货品 SKU ID.
enablePreSale	BOOLEAN	是	是否开启预售（true开启，false关闭）
preSaleDeliveryDay	INTEGER	否	在途库存补货日期（时间戳，仅支持传入某一日期最后一秒，关闭预售时无需传入)
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
2000000	业务异常	根据提示文案修改入参
2000039	近期不可添加虚拟库存， 建议您及时转备货	系统业务拦截，近期不可添加虚拟库存， 建议您及时转备货
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
半托管库存API组	He uses type、Self use type
独立站高级接口	He uses type、Self use type


---

## bg.goods.routestock.add

bg.goods.routestock.add
半托管新增路由绑定及库存填写接口
更新时间：2026-02-05 19:51:15
接口介绍：OpenApi新增半托管商品仓站关系和库存
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
openApiUser	OBJECT	是	用户信息
supplierId	INTEGER	是	供应商id
productId	INTEGER	是	货品ID
addwarehouseSkuStockList	LIST	是	新增发货仓库存
$item	OBJECT	否	-
productSkuId	INTEGER	否	半托管货品 SKU ID. 预校验且新增货品sku场景可以不传
targetStockAvailable	INTEGER	是	目标库存
warehouseId	STRING	是	半托管仓库ID.
addWarehouseSiteList	LIST	是	新增路由关系
$item	OBJECT	否	-
siteIdList	LIST	是	站点ID.
$item	INTEGER	否	-
warehouseId	STRING	是	仓库ID
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
2000000	业务异常	根据提示文案修改入参
2000094	泛欧商品欧盟站点绑定数量不符合预期	泛欧商品欧盟站点绑定数量不符合预期
4000004	操作频繁	操作频繁，请稍后再试
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
半托管库存API组	He uses type、Self use type
