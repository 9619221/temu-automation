# 类目属性API组

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 11 个接口


---

## bg.goods.cats.get

bg.goods.cats.get
货品类目查询
更新时间：2025-03-13 15:57:45
接口介绍：查询类目层级接口
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
showHidden	BOOLEAN	否	是否展示隐藏类目，默认不展示
parentCatId	INTEGER	否	父类目id，查1级列表不传
siteId	INTEGER	否	站点id
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
categoryDTOList	LIST	类目子节点列表
$item	OBJECT	-
catId	INTEGER	类目ID
catName	STRING	类目名称
parentCatId	INTEGER	父类目id
catType	INTEGER	类目类型
isLeaf	BOOLEAN	是否叶子分类
catLevel	INTEGER	类目层级
isHidden	BOOLEAN	是否隐藏
hiddenType	INTEGER	隐藏类型，0：不隐藏，1：一般隐藏，2：老类目，3：废弃类目
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

## bg.goods.attrs.get

bg.goods.attrs.get
货品模板查询
更新时间：2025-03-13 15:57:46
接口介绍：用于查询发布时的类目属性模板
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
catId	INTEGER	是	叶子类目id
productCreateTime	INTEGER	否	货品创建时间 (毫秒时间戳)
supportedType	INTEGER	否	渠道类型，如果传了优先认这个字段，不识别mallId
langList	LIST	否	语言列表 (查询多语言信息, 中文不用传, 特殊场景使用, 会影响性能, 一般情况下不传)
$item	STRING	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
inputMaxSpecNum	INTEGER	模板允许的最大的自定义规格数量
chooseAllQualifySpec	BOOLEAN	限定规格是否全选:0否,1是
singleSpecValueNum	INTEGER	单个自定义规格值上限
properties	LIST	模板属性
$item	OBJECT	-
numberInputTitle	STRING	数值录入Title
templatePropertyValueParentList	LIST	属性值关联关系
$item	OBJECT	-
parentVidList	LIST	关联属性值id
$item	INTEGER	-
vidList	LIST	属性值id
$item	INTEGER	-
values	LIST	模板属性值
$item	OBJECT	-
vid	INTEGER	属性值id
specId	INTEGER	规格id
lang2Value	MAP	多语言属性值
$key	STRING	-
$value	STRING	-
parentVidList	LIST	对应的父属性值id
$item	INTEGER	-
extendInfo	STRING	扩展信息
value	STRING	属性值
group	OBJECT	分组信息
name	STRING	分组名称
id	INTEGER	分组id
valueUnit	LIST	属性值单位
$item	STRING	-
referenceType	INTEGER	属性引用类型
pid	INTEGER	基础属性id
templatePid	INTEGER	模板属性id
required	BOOLEAN	必填
inputMaxNum	INTEGER	最大可输入数目,为0时代表不可输入
propertyValueType	INTEGER	属性值类型
minValue	STRING	输入最小值
feature	INTEGER	属性特性
valueRule	INTEGER	数值规则：SUM_OF_VALUES_IS_100(1, "数值之和等于100")
propertyChooseTitle	STRING	属性勾选Title
showType	INTEGER	B端展示规则
parentTemplatePid	INTEGER	模板父属性ID
mainSale	BOOLEAN	是否为主销售属性
parentSpecId	INTEGER	规格id
maxValue	STRING	输入最大值：文本类型代表文本最长长度、 数值类型代表数字最大值、时间类型代表时间最大值
lang2Name	MAP	多语言属性名称
$key	STRING	-
$value	STRING	-
chooseMaxNum	INTEGER	最大可勾选数目
valuePrecision	INTEGER	小数点允许最大精度,为0时代表不允许输入小数
showCondition	LIST	属性展示条件，或者关系
$item	OBJECT	-
parentRefPid	INTEGER	父属性id
parentVids	LIST	若属性按条件展示,则只有parent_vids中的值被选择时属性才可使用
$item	INTEGER	-
controlType	INTEGER	控件类型： INPUT(0, "可输入"), CHOOSE(1, "可勾选"), INPUT_CHOOSE(3, "可输入又可勾选"), SINGLE_YMD_DATE(5, "单项时间选择器-年月日"), MULTIPLE_YMD_DATE(6, "双项时间选择器-年月日"), SINGLE_YM_DATE(7, "单项时间选择器-年月"), MULTIPLE_YM_DATE(8, "双项时间选择器-年月"), COLOR_SELECTOR(9, "调色盘"), SIZE_SELECTOR(10, "尺码选择器"), NUMBER_RANGE(11, "输入数值范围"), NUMBER_PRODUCT_DOUBLE(12, "输入数值乘积-2维"), NUMBER_PRODUCT_TRIPLE(13, "输入数值乘积-3维"), AUTO_COMPUTE(14, "自动计算框"), REGION_CHOOSE(15, "地区选择器"), PROPERTY_CHOOSE_AND_INPUT(16, "属性勾选和数值录入"),
name	STRING	属性名称
isSale	BOOLEAN	是否销售属性(区分普通属性与规格属性)
refPid	INTEGER	属性id
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

## bg.goods.parentspec.get

bg.goods.parentspec.get
查询父规格列表
更新时间：2026-01-27 15:34:01
接口介绍：用于发布时查询父规格列表
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
parentSpecDTOS	LIST	父规格列表
$item	OBJECT	-
parentSpecName	STRING	父规格名称
parentSpecId	INTEGER	父规格id
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

## bg.goods.spec.create

bg.goods.spec.create
创建规格
更新时间：2026-01-30 14:41:11
接口介绍：用于货品发布时创建自定义规格
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
parentSpecId	INTEGER	是	父规格id
specName	STRING	是	子规格名称
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
specId	INTEGER	子规格id
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
1000001	服务器开小差	一般是系统抖动，可参考具体报错文案尝试解决或重试，如果还不行请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
ISV基础接口	He uses type、Self use type
独立站高级接口	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.goods.category.match

bg.goods.category.match
新增建品类目映射
更新时间：2025-03-13 15:57:43
接口介绍：对接方可以根据类目名称查找到适合的类目进行发品挂靠
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
searchText	STRING	否	搜索文本
siteId	INTEGER	否	站点ID
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
categoryPathDTOS	LIST	类目路径结果列表
$item	OBJECT	-
cat9DTO	OBJECT	九级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
parentCatId	INTEGER	父类目id
catType	INTEGER	类目类型
isLeaf	BOOLEAN	是否叶子分类
catLevel	INTEGER	类目层级
isHidden	BOOLEAN	是否隐藏
hiddenType	INTEGER	隐藏类型，0：不隐藏，1：一般隐藏，2：老类目，3：废弃类目
cat8DTO	OBJECT	八级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
parentCatId	INTEGER	父类目id
catType	INTEGER	类目类型
isLeaf	BOOLEAN	是否叶子分类
catLevel	INTEGER	类目层级
isHidden	BOOLEAN	是否隐藏
hiddenType	INTEGER	隐藏类型，0：不隐藏，1：一般隐藏，2：老类目，3：废弃类目
cat6DTO	OBJECT	六级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
parentCatId	INTEGER	父类目id
catType	INTEGER	类目类型
isLeaf	BOOLEAN	是否叶子分类
catLevel	INTEGER	类目层级
isHidden	BOOLEAN	是否隐藏
hiddenType	INTEGER	隐藏类型，0：不隐藏，1：一般隐藏，2：老类目，3：废弃类目
cat7DTO	OBJECT	七级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
parentCatId	INTEGER	父类目id
catType	INTEGER	类目类型
isLeaf	BOOLEAN	是否叶子分类
catLevel	INTEGER	类目层级
isHidden	BOOLEAN	是否隐藏
hiddenType	INTEGER	隐藏类型，0：不隐藏，1：一般隐藏，2：老类目，3：废弃类目
cat10DTO	OBJECT	十级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
parentCatId	INTEGER	父类目id
catType	INTEGER	类目类型
isLeaf	BOOLEAN	是否叶子分类
catLevel	INTEGER	类目层级
isHidden	BOOLEAN	是否隐藏
hiddenType	INTEGER	隐藏类型，0：不隐藏，1：一般隐藏，2：老类目，3：废弃类目
cat2DTO	OBJECT	二级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
parentCatId	INTEGER	父类目id
catType	INTEGER	类目类型
isLeaf	BOOLEAN	是否叶子分类
catLevel	INTEGER	类目层级
isHidden	BOOLEAN	是否隐藏
hiddenType	INTEGER	隐藏类型，0：不隐藏，1：一般隐藏，2：老类目，3：废弃类目
cat5DTO	OBJECT	五级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
parentCatId	INTEGER	父类目id
catType	INTEGER	类目类型
isLeaf	BOOLEAN	是否叶子分类
catLevel	INTEGER	类目层级
isHidden	BOOLEAN	是否隐藏
hiddenType	INTEGER	隐藏类型，0：不隐藏，1：一般隐藏，2：老类目，3：废弃类目
cat3DTO	OBJECT	三级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
parentCatId	INTEGER	父类目id
catType	INTEGER	类目类型
isLeaf	BOOLEAN	是否叶子分类
catLevel	INTEGER	类目层级
isHidden	BOOLEAN	是否隐藏
hiddenType	INTEGER	隐藏类型，0：不隐藏，1：一般隐藏，2：老类目，3：废弃类目
cat4DTO	OBJECT	四级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
parentCatId	INTEGER	父类目id
catType	INTEGER	类目类型
isLeaf	BOOLEAN	是否叶子分类
catLevel	INTEGER	类目层级
isHidden	BOOLEAN	是否隐藏
hiddenType	INTEGER	隐藏类型，0：不隐藏，1：一般隐藏，2：老类目，3：废弃类目
cat1DTO	OBJECT	一级类目
catId	INTEGER	类目ID
catName	STRING	类目名称
parentCatId	INTEGER	父类目id
catType	INTEGER	类目类型
isLeaf	BOOLEAN	是否叶子分类
catLevel	INTEGER	类目层级
isHidden	BOOLEAN	是否隐藏
hiddenType	INTEGER	隐藏类型，0：不隐藏，1：一般隐藏，2：老类目，3：废弃类目
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

## bg.goods.category.mapping

bg.goods.category.mapping
查询中文类目映射接口
更新时间：2025-03-14 17:15:14
接口介绍：查询中文类目映射接口
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
cate4Id	INTEGER	否	-
cate1Name	STRING	否	-
goodsNameEn	STRING	否	-
goodsId	INTEGER	否	-
cate4Name	STRING	否	-
cate3Name	STRING	否	-
cateName	STRING	否	-
cate2Name	STRING	否	-
cateId	INTEGER	否	-
goodsName	STRING	否	-
cate1Id	INTEGER	否	-
cate2Id	INTEGER	否	-
cate3Id	INTEGER	否	-
extraInfo	MAP	否	-
$key	STRING	否	-
$value	STRING	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
cateId	INTEGER	-
cateName	STRING	-
extraInfo	MAP	-
$key	STRING	-
$value	STRING	-
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

## bg.goods.attribute.mapping

bg.goods.attribute.mapping
内外属性映射
更新时间：2025-03-14 17:15:14
接口介绍：内外属性映射
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
catId	STRING	是	叶子类目id
goodsId	STRING	是	商品id
catName	STRING	否	叶子类目名
goodsProp	LIST	否	商品属性
$item	OBJECT	否	-
values	LIST	否	商品英文属性值
$item	STRING	否	-
propName	STRING	否	商品英文属性名
supportedType	INTEGER	否	渠道类型, 本对本需要传递 100，其他场景可以不传
goodsName	STRING	是	商品名
mainImageUrl	STRING	否	商品主图
返回参数说明
收起
参数接口	参数类型	说明
result	LIST	result
$item	OBJECT	-
vid	INTEGER	属性值id
refPidName	STRING	属性名称
pid	INTEGER	基础属性id
pidName	STRING	基础属性名称
templatePid	INTEGER	模板属性id
value	STRING	属性值
refPid	INTEGER	属性id
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

## bg.goods.accessories.get

bg.goods.accessories.get
货品包装清单类型查询
更新时间：2026-01-28 18:19:29
接口介绍：发品时分页查询包装清单支持的配件信息
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
fuzzyValue	STRING	否	属性值（模糊搜索）
pageSize	INTEGER	否	单页大小（最大200）
page	INTEGER	否	页码
vidList	LIST	否	属性值id列表（最多100个）
$item	INTEGER	否	属性值id
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
data	LIST	Result List
$item	OBJECT	-
vid	INTEGER	Property Value ID
unitName	STRING	Unit Name
unitCode	INTEGER	Unit Code
value	STRING	Property Value Name
totalCount	INTEGER	Total Count
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
991000001	服务器开小差	一般是系统抖动，可参考具体报错文案尝试解决或重试，如果还不行请联系管理员
991000005	系统异常	尝试重试，如果还不行请联系管理员
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.vehicle.library.prop.dependency.query

bg.vehicle.library.prop.dependency.query
货品车型库属性值查询
更新时间：2025-07-08 17:35:57
接口介绍：商家填写车型库时查询模版信息
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
propValueDependencyIdList	LIST	是	车型库属性值依赖id列表 【注：查第一层的属性值，属性依赖id传0，属性值依赖id传[0]，取返回的childPropertyValueList即第一层属性值】
$item	INTEGER	否	-
vehicleLibraryId	INTEGER	是	车型库id
propDependencyId	INTEGER	是	车型库属性依赖id
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
propertyValueDependencyList	LIST	属性值依赖列表
$item	OBJECT	-
vid	INTEGER	属性值ID
childPropertyValueList	LIST	子属性值依赖列表
$item	OBJECT	-
vid	INTEGER	属性值 ID
propertyValueDependencyId	INTEGER	属性值依赖 ID
vidValue	STRING	属性值
isLeaf	BOOLEAN	是否叶子节点
propertyValueDependencyId	INTEGER	属性值依赖 ID
level	INTEGER	层级
vidValue	STRING	属性值
pid	INTEGER	属性 ID
pidName	STRING	属性名称
propertyDependencyId	INTEGER	属性依赖ID
isLeaf	BOOLEAN	是否叶子节点
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
992000054	Cannot find vehicle library	检查输入的车型库id是否有误
992000055	Cannot find property dependency	检查输入的属性依赖id是否有误
992000056	The size of the property value dependent ID list cannot exceed 50	属性值id数量超过50，请分批查询
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.vehicle.library.query

bg.vehicle.library.query
货品车型库模板查询
更新时间：2025-07-08 17:35:57
接口介绍：商家发品时查询车型库模版
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
catId	LONG	是	叶子类目id
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
vehicleLibraryList	LIST	车型库列表
$item	OBJECT	-
propDependencyList	LIST	车型库属性依赖列表
$item	OBJECT	-
pidNameEn	STRING	属性英文名称
parentPropertyDependencyId	INTEGER	父属性依赖 ID
level	INTEGER	层级
propertyDependencyId	INTEGER	属性依赖 ID
pid	INTEGER	属性 ID
pidName	STRING	属性名称
name	STRING	车型库名称
vehicleLibraryId	INTEGER	车型库 ID
status	INTEGER	状态
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
991000001	Server Downtime	业务异常，请稍后重试
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
货品API组	He uses type、Self use type


---

## bg.glo.goods.photorecommendationcategory.get

bg.glo.goods.photorecommendationcategory.get
外部商品图片映射temu类目
更新时间：2025-06-26 20:25:16
接口介绍：外部商品图片映射temu类目
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
inputSideUrls	LIST	否	可选项，侧视图图片链接数组，只能传一张图片
$item	STRING	否	可选项，侧视图图片链接
param	OBJECT	否	可选项，辅助判别参数
goodsTitle	STRING	否	可选项，商品标题
goodsDescription	STRING	否	可选项，商品描述
goodsBrand	STRING	否	可选项，商品品牌
inputMainUrls	LIST	否	主视图图片链接数组，只能传一张图片，传多张只会用第一张计算
$item	STRING	否	主视图图片链接
返回参数说明
收起
参数接口	参数类型	说明
code	INTEGER	响应码
errMsg	STRING	错误信息
goodsCatePredictResult	OBJECT	商品信息预测结果
categoryIdStack	LIST	K级类目ID，例如【27011】-【30328】-【30469】
$item	STRING	类目ID，例如【27011】
categoryProb	STRING	类别概率，例如【0.9800001234】
categoryNameStack	LIST	K级类目名称，例如【服装】-【男装】-【男装上衣】-【男装T恤】
$item	STRING	类目名，例如【男装上衣】
categoryName	STRING	商品分类，例如【男装T恤】
categoryId	STRING	商品分类的ID，例如【30469】
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
