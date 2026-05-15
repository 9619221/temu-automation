# Temu 开放平台 API 学习笔记

> 用 Chrome 在 https://agentpartner.temu.com/document 系统读完。
> 写笔记目的：为重写 auto-image-swap 走官方 API 做技术储备。

---

## 1. 基本信息

**接口地址**：
| 网关 | URL |
|---|---|
| CN 网关 | `https://openapi.kuajingmaihuo.com/openapi/router` |
| PA 网关 | `https://openapi-b-partner.temu.com/openapi/router` |
| 请求方式 | `POST` |

**分区站点**（partner 后台）：
- US: https://partner-us.temu.com/
- EU: https://partner-eu.temu.com/
- GLOBAL: https://partner.temu.com/
- API 文档: https://partner.kuajingmaihuo.com/document

**请求参数构成**：
- 公共参数：`type`、`timestamp`、`app_key`、`data_type`、`access_token`、`sign`
- 业务参数：每个接口自己的字段

**测试账号（全托管）**：
- 账号 1: app_key=`47bb4bb7769e12d9f7aa93cf029fe529`, store_id=`1052202882`, name=`girl clothes`
- 账号 2: app_key=`72bc9e4143e960b2134e1cdf22fec651`
- （token / secret 在文档中，调试用，不抄到这里）

**测试账号（半托管）**：3 个账号，店铺 ID 例 `634418215494106`、`634418215136420`

---

## 2. 签名规则

**步骤**：
1. **排序**：所有外层参数按 key ASCII 升序排序（内层 JSON 不排）
2. **拼接**：`key1value1key2value2...`，前后再拼 `app_secret`
3. **加密**：MD5(拼接字符串) → 32 位**大写**
4. **请求**：拼接结果作为 `sign` 字段加入

**示例**（来自文档）：
```
app_key=47bb4bb7769e12d9f7aa93cf029fe529
app_secret=ac0a3e952eaaa5b19c0e615c2ef497f50afa6e49
timestamp=1739688901
type=bg.shiporder.staging.add
data_type=JSON
access_token=1zz6vlvwq1kulyyyybkdy0bfwnlrgfls8e4ssefhxpanh1mltyodjacc
joinInfoList=[{...}]

排序拼接后 MD5 → BA49C39EFE53461582CC779CDA2ADB3E
```

**易错点**：
1. 只外层排序，内层 JSON 不参与
2. 布尔值要保持 `true/false`（不能 `True/1`），否则验签失败
3. 排序按 key，不是 key+value
4. 报错 `sign is invalid` = 验签失败

---

## 3. 鉴权信息

**两种应用类型**：

| 字段 | 自研应用（自用） | 三方应用（开发给别人） |
|---|---|---|
| **申请入口** | https://agentseller.temu.com/open/apply-app | https://agentpartner.temu.com/main/application-manage |
| **app_key** | 应用维度唯一，申请后不变 | 同左 |
| **app_secret** | 参与签名，谨慎保管 | 同左 |
| **access_token 有效期** | **365 天** | **90 天** |
| **token 获取** | 卖家中心 → 授权管理 → 选应用 → 勾接口（建议全选）→ 复制 | 卖家授权后给三方 |

**access_token 管理**：
- 店铺维度唯一
- 重新获取后旧 token 立刻失效
- 获取地址：https://agentseller.temu.com/open/system-manage/client-manage

**接口鉴权报错码表**：

| code | errorMsg | 解决方案 |
|---|---|---|
| 7000000 | there is no type in body | 没传 `type` 字段 |
| 7000002 | there is no app_key in body | 没传 `app_key` |
| 7000003 | there is no access_token in body | 没传 `access_token` |
| 7000005 | app_key don't have this api permission | 检查 app_key / 接口地址是否同一区 |
| 7000006 | access_token and app_key are not mapping | 检查 app_key 和 access_token 是否同一区 |
| 7000007 | access_token is expired | 重新授权获取新 token |
| 7000008 | there is no timestamp in body | 没传 `timestamp` |
| 7000010 | timestamp is expired | timestamp 是秒级且需 ±300s 内 |
| 7000011 | timestamp is invalid | 同上 |
| 7000013 | data_type is invalid | `data_type` 必须 `"JSON"` |
| 7000014 | there is no sign in body | 没传 sign |
| 7000015 | sign is invalid | 验签失败 |
| 7000016 | type not exists | 接口 type 拼写错 / 不在本区 |
| 7000018 | access_token not exists | 用 CN 区 token 调 CN 接口 |
| 7000019 | access_token don't have this api access | 获取 token 时勾对应接口，建议全选 |
| 7000020 | access_token invalid | token 错 |
| 7000022 | access_token don't have this api access | 同 7000019，**自研专属接口需联系招商单独申请** |

---

## 4. 自研专属接口（仅限自研应用单独申请通过后使用）

| 分组 | 接口 | 描述 |
|---|---|---|
| **申报价** | bg.goods.price.list.get | 货品申报价查询 |
| **全托核价** | bg.price.review.page.query | 分页查询核价单 |
|  | bg.price.review.confirm | 同意核价单建议价 |
|  | bg.price.review.reject | 不同意（给新申报价）|
| **半托核价**<br>(PA 网关) | bg.semi.price.review.page.query.order | 分页查询核价单 |
|  | bg.semi.price.review.confirm.order | 同意 |
|  | bg.semi.price.review.reject.order | 拒绝 |
| **全托调价** | bg.full.adjust.price.page.query | 调价单分页查询 |
|  | bg.full.adjust.price.batch.review | 批量确认调价单 |
| **半托调价**<br>(PA 网关) | bg.semi.adjust.price.page.query.order | 同上 |
|  | bg.semi.adjust.price.batch.review.order | 同上 |
| **活动报名** | bg.marketing.activity.list.get | 活动列表 |
|  | bg.marketing.activity.detail.get | 活动详情 |
|  | bg.marketing.activity.product.get | 活动商品 |
|  | bg.marketing.activity.session.list.get | 场次列表 |
|  | bg.marketing.activity.enroll.submit | 报名提交 |
|  | bg.marketing.activity.enroll.list.get | 报名记录 |

申请方式：将主体id、appkey、店铺id 提供给招商运营。
报错 "access_token don't have this api access" → 检查是否申请通过 / 重新授权勾接口 / 查 mallid 给运营核审批进度。

---

## 5. 分区说明（必读，CN/US/EU/GLOBAL 四个区分离）

⚠️ **跨区调用会被拦截**。app_key / secret / access_token / 接口地址 **必须同区**。

| 区 | 业务场景 | partner 后台 | 接口网关 | 卖家中心 |
|---|---|---|---|---|
| **CN** | 发品、库存、备货履约 | partner.kuajingmaihuo.com<br>agentpartner.temu.com | `https://openapi.kuajingmaihuo.com/openapi/router` | agentseller.temu.com/open/system-manage/client-manage |
| **PA**（半托发品/库存/调价核价）| 半托发品、库存 | 同 CN | `https://openapi-b-partner.temu.com/openapi/router` | 同 CN |
| **US**（美国半托履约）| 美国商品、履约 | partner-us.temu.com | `https://openapi-b-us.temu.com/openapi/router` | agentseller-us.temu.com/open-platform/... |
| **EU**（欧区半托履约）| 欧区商品、履约 | partner-eu.temu.com | `https://openapi-b-eu.temu.com/openapi/router` | agentseller-eu.temu.com/open-platform/... |
| **GLOBAL**（全球除美欧）| 半托履约 | partner.temu.com | `https://openapi-b-global.temu.com/openapi/router` | agentseller.temu.com/open-platform/... |

---

## 6. 接口列表（完整目录）

### 6.1 基础 API
| type | 描述 |
|---|---|
| `bg.mall.info.get` | 查询 token 对应店铺类型（全托/半托） |
| `bg.open.accesstoken.info.get.global` | 查询 token 授权信息（含店铺 uniqueId + 接口权限） |

### 6.2 货品 API（全托半托）
| type | 描述 |
|---|---|
| `bg.glo.goods.add` | 上传货品（**发品入口**） |
| `bg.glo.product.search` / `bg.product.search` | 查询货品生命周期状态 |
| `bg.glo.goods.list.get` | 商品列表 |
| `bg.glo.goods.detail.get` | 商品详情（产地、商详） |
| `bg.glo.goods.migrate` | 货品搬运（全托→半托） |
| `bg.glo.goods.topselling.soldout.get` | 爆款售罄查询 |
| `bg.goods.brand.get` | 品牌查询 |
| `bg.goods.suggest.supplyprice.get` | 建议申报参考价（**仅自研** + 100次/天） |
| `bg.btg.goods.stock.warehouse.list.get` | 站点仓库 |
| `bg.glo.logistics.template.get` | 运费模板 |

### 6.3 类目属性 API
| type | 描述 |
|---|---|
| `bg.goods.cats.get` | 类目树查询（父→子） |
| `bg.goods.attrs.get` | 类目属性/规格模板 |
| `bg.glo.goods.parentspec.get` | 父规格列表 |
| `bg.glo.goods.spec.create` | 创建自定义规格 |
| `bg.goods.category.match` | 关键词模糊匹配类目 |
| `bg.goods.category.mapping` | 中英文标题映射类目 |
| `bg.glo.goods.photorecommendationcategory.get` | 图片映射类目 |
| `bg.goods.attribute.mapping` | 内外属性映射 |

### 6.4 尺码表 API
| type | 描述 |
|---|---|
| `bg.goods.sizecharts.class.get` | 尺码分类（catId→classId） |
| `bg.goods.sizecharts.get` | 已创建的模板 |
| `bg.goods.sizecharts.template.create` | 模板 → tempBusinessId |
| `bg.goods.sizecharts.create` | 新增尺码表（reusable=true 是模板, false 是直接尺码表） |
| `bg.goods.sizecharts.settings.get` | 规则 |
| `bg.goods.sizecharts.meta.get` | 元信息 |
| `bg.goods.imagesizechart.get` | 图片提取尺码表 |

### 6.5 说明书 API
| type | 描述 |
|---|---|
| `bg.goods.catsmandatory.get` | 类目必填查询 |
| `bg.goods.instructions.upload` | 文件上传 |
| `bg.goods.instructionslanguages.get` | 语种查询 |
| `bg.goods.instructionstranslation.get` | 翻译请求 |
| `bg.goods.translationresult.get` | 翻译结果 |

### 6.6 模特试穿 API
`bg.modelinfo.get / .add / .edit`、`bg.modelcats.get`

### 6.7 ⭐ 货品编辑 API（重点 — auto-image-swap 直接相关）

⚠️ 调用编辑前需要先 `bg.product.search` 查询生命周期状态（货品选中后修改需经审核才生效）。

| type | 描述 | 备注 |
|---|---|---|
| `bg.goods.update` | 货品更新 | 产地编辑 |
| `bg.goods.edit` | 货品编辑 | 编辑尺码表 |
| `bg.goods.edit.sensitive.attr` | 敏感品属性 | 平台面单要求 |
| **`bg.goods.edit.pictures.submit`** | **修改商品素材** | ⭐ **这就是官方换图接口** |
| `bg.goodslogistics.template.edit` | 运费模板编辑 |
| `bg.goods.edit.property` | 属性修改 | 商品**选中前**用 |
| `bg.goods.edit.task.apply` | 申请编辑任务 | 商品**选中后**用，先提交申请不等审核 |
| `bg.goods.edit.task.submit` | 提交修改 | 配合 .apply 使用 |
| `bg.goods.edit.guide.file` | 编辑说明书 |

### 6.8 全托备货发货 API（履约）
- **备货单**: `bg.purchaseorder.apply` (3qps), `bg.purchaseorderv2.get` (3qps)
- **发货台**: `bg.shiporder.staging.add` (3qps), `bg.shiporder.staging.get` (5qps)
- **地址**: `bg.mall.address.add/.get`, `bg.shiporder.receiveaddressv2.get` (5qps)
- **发货单**: `bg.shiporderv3.create` (5qps), `bg.shiporderv2.get` (3qps), `bg.shiporder.cancel` (3qps)
- **包裹**: `bg.shiporder.package.get/.edit` (3qps)
- **条码/箱唛**: `bg.glo.goods.custom.label.get` / `.labelv2.get`, `bg.logistics.boxmarkinfo.get` (3qps)
- **装箱发货**: `bg.shiporderv3.logisticsmatch.get` (5qps), `bg.shiporder.logisticsorder.match`, `bg.logistics.company.get`, `bg.shiporder.packing.match`, `bg.shiporder.packing.send` (5qps), `bg.shiporder.logistics.change` (3qps)

### 6.9 寄样/质检/退货 API
- **寄样/退货**: `bg.refund.returnpackage.get/.returnpackagedetail.get/.returnpackagelist.get`, `bg.sample.order.get/.send`
- **质检**: `bg.goods.qualityinspection.get/.qualityinspectiondetail.get`

### 6.10 销售数据 API
`bg.goods.salesv2.get` — 销售管理分仓组数据

---

## 7. 调用流程

### 7.1 全托履约流程
（文档是一张 1874x3950 大图，文字看不到。要看请打开 docId=896173561825）

### 7.2 货品发布流程（重要）

**适用范围**：全托、半托货品发布

#### Step 1：确定发品叶子类目 id
- 方式一：`bg.goods.cats.get` 遍历，从 0 查一级 → 二级 → ... → 叶子（isLeaf=true）
- 方式二：`bg.goods.category.match` 关键词模糊匹配
- 发品入参：cat1Id ~ cat10Id，叶子级之前填 0
- 示例：cat1Id=13512, cat2Id=15303, cat3Id=15823, cat4Id=15836, cat5~10=0

#### Step 2：站点 / 仓库 / 运费（全托跳过）
- 半托：先选站点 → `bg.btg.goods.stock.warehouse.list.get` 查仓库 → `bg.logistics.template.get` 查运费模板

#### Step 3：查询属性模板
`bg.goods.attrs.get`（入参 = 叶子 catId）：
- **规格**（销售属性, isSale=true）：决定 SKU，满足笛卡尔积（颜色×尺码=SKU 数）
  - `inputMaxSpecNum=0` → 不能自定义规格，只能用模板返回的销售属性
  - `inputMaxSpecNum=n` → 可自定义：`bg.glo.goods.parentspec.get` 拿父规格 → `bg.glo.goods.spec.create` 生子规格 → 发品入参 `productSpecPropertyReqs`
- **属性**（isSale=false, required=true 为必填）：
  - 发品入参 `productPropertyReqs`：含 templatePid / pid / refPid / propName / vid / propValue / valueUnit / numberInputValue

#### Step 4：尺码表（如果类目有要求）
1. `bg.goods.sizecharts.class.get` (catId → classId)，classType=1 为套装需要 relatedClassIds，套装至少 2 个尺码表
2. 判定是否必填：接口有返回即必填
3. `bg.goods.sizecharts.meta.get` 拿 groupList/elementList（列名）
4. `bg.goods.sizecharts.settings.get` 拿 sizeList
5. 创建：
   - `bg.goods.sizecharts.create` + `reusable=true` 创建模板 → `bg.goods.sizecharts.template.create` 生 tempBusinessId 当发品入参
   - 或 `reusable=false` 直接拿 businessId 当发品入参
6. 套装（classType=1）创建尺码表**不传 catid**
7. ⚠️ 尺码表的 records 数量和值必须与发品 SKU 尺码一致

#### Step 5：图片和视频
- 先调上传接口（图片处理 API 组 docId=929743122710 / 视频上传 API 组 docId=917139576842）
- 上传接口返回的 URL 作为发品入参（**不能直接用第三方 URL**）

#### Step 6：货品 skc 结构
- **spu → skc → sku** 三层结构
- 一个 SPU 最多 25 个 SKC，一个 SPU 最多 500 个 SKU
- 发品返回 `productId` / `productSkcId` / `productSkuId`
- **主销售属性 `mainProductSkuSpecReqs`**：
  - 非服饰固定空值：`{parentSpecId:0, parentSpecName:"", specId:0, specName:""}`
  - 服饰传颜色：`{parentSpecId:1001, parentSpecName:"颜色", specId:3002, specName:"黑色"}`

#### 发品 FAQ（13 个常见错）
| 错误 | 解决 |
|---|---|
| 主销售属性不合法 | 非服饰传空 parentSpecId=0/specId=0 |
| 尺码表包含不合法尺码规格 | 尺码表的尺码必须和发品 SKU 一致 |
| URL 域名校验不通过 | 必须用平台上传接口返回的 URL |
| 主销售规格属性值列表重复 | 非服饰只能传一个 SKC |
| 服饰类目 SKC 轮播图校验失败 | 检查图片宽高比 |
| 不合法的尺码模板 id：[0] | showSizeTemplateIds/sizeTemplateIds 没尺码表时传 `[]` |
| 不合法的尺码模板 id：[123456] | `.sizecharts.get` 返回的 id 不能直接用，要 `.template.create` 转 tempBusinessId |
| 仅允许填写分站点申报价格 | 半托只传 siteSupplierPrices，全托只传 supplierPrice |
| 半托分站点申报价格错误 | 检查 productSemiManagedReq |
| 属性模板返回空 | catId 必须是叶子（isLeaf=true）|
| 不允许创建套装模板 | 套装 classType=1 时不传 catid |
| 货品类目属性更新 | 重新拉 `.attrs.get` 比对找缺失属性 |
| Semi-managed delivery info empty | 半托必传 productShipmentReq（freightTemplateId + shipmentLimitSecond）|

---

## 8. 数据字典（速读）

| 项 | 用途 | 关键内容 |
|---|---|---|
| **发品-省份枚举值** | `productOrigin.region2Id` | 31 个中国省份 ID（北京 `43000000000002` ~ 重庆 `43000000000032`）|
| **部分类目模特信息必填** | catId 列表 | 列出哪些类目发品必须传模特信息 |
| **定制品定制工艺层级关系** | `productSaleExtAttrReq.customizedTechnologyReq` | 一级工艺/二级工艺（木竹/金属/皮具/有机材料/...）×（激光雕刻/烫画/丝印/UV/...）|
| **半托管站点列表** | siteId/siteName | 100 美国 / 101 加拿大 / 105 德国(泛欧) / ... 泛欧 27 个 |
| **货品名称长度限制规则** | `productName` 长度限制 | 默认 500；CD 100；办公 200；多数 250 |
| **（单码）鞋类尺码&脚长映射** | 鞋类尺码表 records | euSize/ukSize/usSize/brSize/mxSize/jpSize/krSize/clSize/coSize + footLength（mm）|
| **（双码）鞋类尺码&脚长映射** | 同上 | 尺码为区间（如 "30.5-31"）|
| **车型库必填类目** | catId 列表 | 这些类目发品必填车型信息 |
| **支持底板套板的类目** | catId 列表 | 用底板套板的类目 |
| **半托管 SKU 分类&净含量必填叶子类目** | catId 列表 | 半托管必填净含量的类目 |
| **承诺发货时效说明** | 站点对应工作日 | 美国 1/2/7/9 工作日 普通 / 1/2/3/7/9/10 定制 |
| **尺码规格分组** | sizeType + groupIds + specIds | 尺码类型 → 规格 ID 映射（1: 服装；2/3/4: 其他类型）|
| **尺码表分类** | classId/className | 3 男上装、4 男下装、5 女上装、6 女下装、11 男鞋、12 女鞋... |

---

## 9. 常见问题（开发指南目录下）

### 9.1 鉴权报错
- `"type not exists"` → 检查接口 type 是否在 CN 区，可用 `bg.open.accesstoken.info.get` 查接口范围

### 9.2 货品报错
- 主销售属性不合法 → 非服饰固定 `[{parentSpecId:0,parentSpecName:"",specId:0,specName:""}]`
- 尺码表包含不合法尺码规格 → 发品 SKU 尺码必须跟尺码表 records 一致
- URL 域名校验不通过 → 必须用 `bg.goods.image.upload` 上传后的 URL
- 属性模板返回空 → catId 必须是叶子（isLeaf=true）
- 主销售规格属性值列表重复 → 非服饰只能 1 个 SKC
- 服饰 SKC 轮播图校验失败 → 检查比例（3:4, ≥1340×1785, ≤2M）
- 不合法的尺码模板 id：[0] → 没尺码表传 `[]`

### 9.3 全托备货发货
- 大仓收货地址返回空 → 备货单先加入发货台再查地址

---

## 10. 入驻流程

### 角色

| 角色 | 说明 | 流程 |
|---|---|---|
| **电商软件服务商**（三方 ERP）| 为 Temu 商家提供 ERP 应用 | 主体入驻 → 应用创建 → 应用上线 |
| **Temu 商家**（自研应用）| 商家自己用，授权只限自己店铺 | **联系招商运营申请** → 主账号登录卖家中心绑定 |

### 三方入驻 SOP（4 步）
1. **资质审核**：选合作伙伴类型 → 提交主体入驻申请（中国内地企业 / 香港企业）→ 等审核 → 资质变更走单独申请
2. **创建应用**：每个主体只能创建 **1 个货品管理三方应用**；驳回常因应用说明缺失
3. **应用开发和测试**：审核通过后才能看 API 文档；docId 875196199516 / 875198836203
4. **发布上线**：提供测试地址 + 测试账号（外网可访问）→ 上线后 Temu 商家可在卖家中心搜索授权

### 自研应用入驻 SOP（Temu 商家）
1. 联系招商运营申请自研应用
2. **主账号**登录 https://seller.kuajingmaihuo.com/
3. 登 https://agentpartner.temu.com → 应用管理 → "Temu 商家自研软件" → 卖家中心授权

---

## 11. ⭐ 重点接口 `bg.goods.edit.pictures.submit` 完整 schema

接口介绍：**[B] BG-289653 商品图片更新 API**
请求地址：`/openapi/router`（CN）

### 请求参数（业务）

```
{
  "type": "bg.goods.edit.pictures.submit",
  // ... 公共参数 (app_key/timestamp/sign/data_type/access_token/version)
  
  // —— 主图 ——
  "materialImgUrl": "https://...",     // STRING 否 — 素材图(主图)
  "materialMultiLanguages": ["..."],   // LIST<STRING> 否 — 图片多语言列表

  // —— 货品轮播图（服饰不传, 会从 SKC 聚合）——
  "carouselImageUrls": ["url1", ...],  // LIST<STRING> 否 — 注意是 carouselImageUrls！跟 queryForImage 一致
  "carouselImageI18nReqs": [           // LIST 否 — 多语言
    {
      "imgUrlList": ["..."],           // 空list=删除, null=不改动
      "language": "en"
    }
  ],

  // —— SKC 信息 ——
  "skcList": [
    {
      "skcId": 12345,                  // LONG 是
      "previewImgUrls": ["..."],       // LIST<STRING> 是 — SKC 轮播图（非服饰不用传）
      "skuCommonReqList": [
        {
          "skuId": 67890,              // LONG 是
          "productSkuThumbUrlI18nReqs": [
            {
              "imgUrlList": ["..."],
              "language": "en",
              "thumbUrl": "https://..."  // 预览图
            }
          ]
        }
      ],
      "productSkcCarouselImageI18nReqs": [    // SKC 轮播图多语言
        { "imgUrlList": [...], "language": "..." }
      ]
    }
  ],

  // —— 轮播视频 ——
  "productCarouseVideoReqList": [
    {
      "vid": "...",       // 视频 VID
      "coverUrl": "...",  // 封面图（B 端存首帧图）
      "videoUrl": "...",
      "width": 1080,
      "height": 1920
    }
  ],

  // —— 楼层装饰（详图楼层）——
  "goodsLayerDecorationReqs": [
    {
      "key": "DecImage",     // 楼层类型 key, 目前默认 "DecImage"
      "backgroundColor": "#ffffff",
      "fontFamily": 0,
      "fontSize": 14,
      "align": "left",        // left/right/center/justify
      "fontColor": "#000000",
      "width": 800,
      "height": 600,
      "text": "..."
    }
  ]
}
```

### 返回参数
```
{
  "success": true,
  "errorCode": 1000000,
  "errorMsg": null,
  "result": { "success": true/false }
}
```

### 错误码
- `100000200` — The parameters are incorrect. Please modify the parameters and submit again. **Please note that the image size, proportion and quantity meet the requirements.**

### 权限包
- **货品 API 组** — He uses type / Self use type

### ⚠️ 跟 web 内部接口的关键差异
1. **字段名是 `carouselImageUrls`**（**不是** web 内部接口的 `carouselGalleryList`！）—— 跟 `queryForImage` 返回字段一致
2. **没有 `imageTaskInfo` 字段** —— 不需要先 selfTask 创建图片任务
3. **没有 `businessType` 字段** —— 不需要这个魔法值
4. **多语言场景更丰富**（`carouselImageI18nReqs`、`productSkcCarouselImageI18nReqs`、`materialMultiLanguages`）

---

## 12. 重写 auto-image-swap 用官方 API 的方案

### 12.1 工作量评估

| 阶段 | 任务 | 工作量 |
|---|---|---|
| **A. 申请凭据** | 联系招商运营申请自研应用 → 拿 app_key/app_secret/access_token | 1-2 天等审批 |
| **B. 实现签名** | worker.mjs 加 `signOpenApi(params, secret)` 工具函数，按签名规则做 MD5 | 30 分钟 |
| **C. 实现核心接口** | `bgGoodsEditPicturesSubmit({skcList, carouselImageUrls, materialImgUrl, ...})` | 1 小时 |
| **D. 图片上传** | 用官方上传接口（图片处理 API 组 docId=929743122710）替换 web 素材中心上传 | 1-2 小时 |
| **E. 配合查询** | `bgProductSearch` 查货品生命周期、`bgGloGoodsDetailGet` 查 SKC/SKU 结构 | 1 小时 |
| **F. 改 worker dispatcher** | 在 `runAutoImageSwap` 加 `useOpenApi: true` 开关 | 30 分钟 |

**总计**：4-6 小时编码 + 1-2 天等审批

### 12.2 与现状对比

| 维度 | 现状（web 内部接口） | 官方 API |
|---|---|---|
| 鉴权 | cookie + Playwright 浏览器登录态 | app_key + secret + access_token（HTTP 直调）|
| 反爬签名 | anti-content header（需要 Playwright 自动签）| MD5 签名（自己实现）|
| 字段名风险 | Temu 改字段名整个失效（已踩 `carouselImageUrls`→`carouselGalleryList`）| 官方契约，stability 强 |
| selfTask | 必须先模拟 UI 创建 selfTask | 不需要 |
| 速率限制 | 没说明 | 3-5 qps/店铺 |
| 调试 | hook fetch / Playwright capture，复杂 | 直接 curl + 看返回 |
| 业务范围 | 单店铺 | 多店铺都行（CN 区） |

### 12.3 推荐迁移路径

**Phase 1**（保留 web 路径不动）：
1. 申请 app_key（招商运营）
2. 写 `automation/temu-open-api.mjs`：实现签名 + bg.goods.edit.pictures.submit 单接口
3. worker.mjs 加 case `auto_image_swap_v2`（不替换原 case）
4. 跑同一商品对比两条路径结果

**Phase 2**（验证稳定后）：
5. 加 UI 开关：runAutoImageSwap 收 `mode: "web" | "openapi"`
6. 默认走 openapi，失败 fallback web

**Phase 3**（最终）：
7. 弃用 web 路径代码，全切官方 API

### 12.4 风险点
1. **app_key 申请审批不通过** — 应用说明要写清楚 + 提供测试地址
2. **官方 API 不支持某些边缘场景**（楼层装饰自定义？）— 先 dry-run 比对
3. **access_token 365 天过期** — 自动监控 + 主动刷新
4. **跨区限制** — CN 区 token 只能调 CN 区接口，不能跨用
5. **rate limit** — 5qps/店铺，批量换图要节流

---

## 13. 后续 TODO

### 实测验证结论（2026-05-14 沙箱账号跑通）

**已用 girl clothes 沙箱账号实测**：
- ✅ 签名算法正确 — `bg.mall.info.get` 返回 success:true
- ✅ `bg.glo.goods.list.get` 在 PA 区可用 — 拿到商品 SPU 列表
- ✅ `bg.glo.goods.edit.pictures.submit` 接受 payload，走到了图片校验阶段（沙箱 token 权限够）
- ⚠️ **官方文档漏写**：submit 接口实际**必须传顶层 `productId`**（文档 schema 没列）
- ⚠️ **非服饰场景**可以不传 `skcList`，仅 `productId + materialImgUrl + carouselImageUrls` 即可
- ⚠️ **OpenAPI `goods.detail.get` 不返回 SKC/图片**（只返产地+类目+商详视频）—— 跟 web `queryForImage` 完全不同结构
- ⚠️ 图片 URL 必须真实 `.jpg/.jpeg/.png`，占位 URL 报 `992000021 图片格式校验失败`

### 真实最小 payload（实测可达图片校验阶段）

```json
POST https://openapi-b-partner.temu.com/openapi/router
{
  "type": "bg.glo.goods.edit.pictures.submit",
  "app_key": "...",
  "timestamp": "...",
  "sign": "...",
  "data_type": "JSON",
  "access_token": "...",
  "version": "V1",

  "productId": 8141774459,
  "materialImgUrl": "https://img.kwcdn.com/product/.../xxx_800x800.jpeg",
  "carouselImageUrls": [
    "https://img.kwcdn.com/product/.../1_800x800.jpeg",
    "https://img.kwcdn.com/product/.../2_800x800.jpeg",
    "https://img.kwcdn.com/product/.../3_800x800.jpeg",
    "https://img.kwcdn.com/product/.../4_800x800.jpeg",
    "https://img.kwcdn.com/product/.../5_800x800.jpeg"
  ]
}
```

### 沿用现有代码

`automation/temu-open-api.mjs` 已实现：
- `signOpenApi(params, secret)` 签名工具
- `callOpenApi({type, appKey, appSecret, accessToken, region, bizParams})` 通用调用
- `bgMallInfoGet(creds)` 验证签名最小接口
- `bgGoodsEditPicturesSubmit(creds, bizParams)`
- `bgGoodsDetailGet(creds, productId)`
- `swapProductImagesViaOpenApi(creds, productId, urls, extra)` 高层封装

`automation/worker.mjs` 新增 case：
- `openapi_call`（通用调用任意 type）
- `auto_image_swap_openapi`（换图专用）

测试脚本：
- `scripts/test_openapi.ps1`（任意接口）
- `scripts/test_openapi_swap.ps1`（换图链路）

### 后续 TODO

- [ ] 在 https://agentseller.temu.com/open/apply-app 申请货品管理自研应用
- [ ] 拿到 app_key 后在 https://agentseller.temu.com/open/system-manage/client-manage 获取 access_token（勾全部接口）
- [ ] 实现 `automation/temu-open-api.mjs` 签名工具 + bg.goods.edit.pictures.submit 调用
- [ ] 抓官方 API 真实返回 vs web 接口返回，确认行为等价
- [ ] 切换默认路径到 openapi

