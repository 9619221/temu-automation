# 1688 采购解决方案接入流程

来源：`solutionKey=1613638539385`，1688 开放平台「采购解决方案（买家自用版）」。

## 官方方案能力

该方案面向需要系统化批量采购的 1688 专业买家，方案接口按业务分为：

- 获取供应商信息
- 获取商品信息
- 采购下单
- 物流同步
- 退款售后
- 换供 agent
- 选品

当前 ERP 第一版先落地低风险闭环：商品寻源、候选报价落库、采购单生成、官方下单推送骨架。付款仍保留在现有财务审批流程，不自动触发免密支付。

## ERP 动作映射

1. 运营创建采购需求：`create_pr`
2. 采购用 1688 官方接口寻源：`source_1688_keyword`
   - 官方 API：`com.alibaba.fenxiao:product.keywords.search-1`
   - 结果写入 `erp_sourcing_candidates`
   - 记录 `external_offer_id`、`external_sku_id`、`external_spec_id`、`source_payload_json`
3. 采购选择候选并生成采购单：`generate_po`
4. 采购单推送到 1688：`push_1688_order`
   - 官方 API：`com.alibaba.trade:alibaba.trade.fastCreateOrder-1`
   - 需要真实 `addressParam` 后才会发起正式下单
   - 支持 `dryRun` 生成请求参数，便于先核对地址、货品和数量
5. 财务审批付款：沿用现有 `submit_payment_approval`、`approve_payment`、`confirm_paid`

## 后续接口预留

- 支付链接：`com.alibaba.trade:alibaba.alipay.url.get-1`
- 买家订单详情：`com.alibaba.trade:alibaba.trade.get.buyerView-1`
- 买家订单列表：`com.alibaba.trade:alibaba.trade.getBuyerOrderList-1`
- 物流信息：`com.alibaba.logistics:alibaba.trade.getLogisticsInfos.buyerView-1`

这些接口已经在 `electron/erp/1688Client.cjs` 建模，后续可直接加同步动作。

## 生产消息回调

ERP LAN 服务提供公开 HTTP 回调入口：

- `GET /api/1688/message/health`：用于平台连通性检查
- `POST /api/1688/message`：接收订单、物流、售后等 1688 消息

回调会先写入 `erp_1688_message_events`，保留 headers、query、原始 body 和解析后的 payload。当前版本只做可靠接收和留痕，后续再按 `topic/messageType` 映射成订单同步、物流同步和售后任务。

生产环境不能使用 `127.0.0.1`，需要把这个路径部署到公网 HTTPS 域名下，例如：

`https://erp.example.com/api/1688/message`

## Detail, Address, Preview Add-on

Added ERP actions for the safer pre-order path:

- `refresh_1688_product_detail`
  - API: `com.alibaba.product:alibaba.product.get-1`
  - Params: `productID`, `webSite=1688`
  - Updates sourcing candidate detail, SKU/spec options, price ranges, selected SKU/spec, and unit price.
- `save_1688_address`
  - Stores reusable delivery addresses in `erp_1688_delivery_addresses`.
  - The default active address is used by preview/order push when no explicit `addressParam` is supplied.
- `preview_1688_order`
  - API: `com.alibaba.trade:alibaba.createOrder.preview-1`
  - Uses the same cargo/address params as `push_1688_order`.
  - Writes preview payload to `erp_purchase_orders.external_order_preview_json`.

Real order creation still goes through `push_1688_order`; preview and dry-run are intended to catch bad offer/spec/address data first.
