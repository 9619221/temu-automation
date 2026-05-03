const crypto = require("crypto");

const DEFAULT_1688_GATEWAY_BASE = "https://gw.open.1688.com/openapi";

const PROCUREMENT_APIS = Object.freeze({
  KEYWORD_SEARCH: Object.freeze({
    key: "com.alibaba.fenxiao:product.keywords.search-1",
    namespace: "com.alibaba.fenxiao",
    name: "product.keywords.search",
    version: 1,
    displayName: "国内分销词搜",
  }),
  RELATION_SUPPLY_SEARCH: Object.freeze({
    key: "com.alibaba.search:alibaba.search.relation.supply-1",
    namespace: "com.alibaba.search",
    name: "alibaba.search.relation.supply",
    version: 1,
    displayName: "Related supplier search",
  }),
  RELATION_USER_INFO: Object.freeze({
    key: "com.alibaba.trade:alibaba.member.getRelationUserInfo-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.member.getRelationUserInfo",
    version: 1,
    displayName: "Purchased supplier relation info",
  }),
  PRODUCT_FOLLOW: Object.freeze({
    key: "com.alibaba.product:alibaba.product.follow.crossborder-1",
    namespace: "com.alibaba.product",
    name: "alibaba.product.follow.crossborder",
    version: 1,
    displayName: "Follow product",
  }),
  PRODUCT_UNFOLLOW: Object.freeze({
    key: "com.alibaba.product:alibaba.product.unfollow.crossborder-1",
    namespace: "com.alibaba.product",
    name: "alibaba.product.unfollow.crossborder",
    version: 1,
    displayName: "Unfollow product",
  }),
  PRODUCT_SIMPLE_GET: Object.freeze({
    key: "com.alibaba.product:alibaba.product.simple.get-1",
    namespace: "com.alibaba.product",
    name: "alibaba.product.simple.get",
    version: 1,
    displayName: "Purchased supplier simple product info",
  }),
  IMAGE_UPLOAD: Object.freeze({
    key: "com.alibaba.fenxiao.crossborder:product.image.upload-1",
    namespace: "com.alibaba.fenxiao.crossborder",
    name: "product.image.upload",
    version: 1,
    displayName: "1688 image upload",
  }),
  IMAGE_SEARCH: Object.freeze({
    key: "com.alibaba.fenxiao.crossborder:product.search.imageQuery-1",
    namespace: "com.alibaba.fenxiao.crossborder",
    name: "product.search.imageQuery",
    version: 1,
    displayName: "1688 image search",
  }),
  PRODUCT_DETAIL: Object.freeze({
    key: "com.alibaba.product:alibaba.product.get-1",
    namespace: "com.alibaba.product",
    name: "alibaba.product.get",
    version: 1,
    displayName: "1688 product detail",
  }),
  ORDER_PREVIEW: Object.freeze({
    key: "com.alibaba.trade:alibaba.createOrder.preview-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.createOrder.preview",
    version: 1,
    displayName: "创建订单前预览数据接口",
  }),
  FAST_CREATE_ORDER: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.fastCreateOrder-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.fastCreateOrder",
    version: 1,
    displayName: "快速创建1688订单",
  }),
  PAYMENT_URL: Object.freeze({
    key: "com.alibaba.trade:alibaba.alipay.url.get-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.alipay.url.get",
    version: 1,
    displayName: "批量获取订单的支付链接",
  }),
  PAY_WAY_QUERY: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.payWay.query-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.payWay.query",
    version: 1,
    displayName: "Query order payment channels",
  }),
  PROTOCOL_PAY_IS_OPEN: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.pay.protocolPay.isopen-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.pay.protocolPay.isopen",
    version: 1,
    displayName: "Query protocol payment status",
  }),
  PROTOCOL_PAY_PREPARE: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.pay.protocolPay.preparePay-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.pay.protocolPay.preparePay",
    version: 1,
    displayName: "Prepare protocol payment",
  }),
  CANCEL_ORDER: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.cancel-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.cancel",
    version: 1,
    displayName: "取消未付款订单",
  }),
  ORDER_DETAIL: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.get.buyerView-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.get.buyerView",
    version: 1,
    displayName: "订单详情查看(买家视角)",
  }),
  ORDER_LIST: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.getBuyerOrderList-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.getBuyerOrderList",
    version: 1,
    displayName: "订单列表查看(买家视角)",
  }),
  RECEIVE_ADDRESS: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.receiveAddress.get-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.receiveAddress.get",
    version: 1,
    displayName: "Buyer receive address list",
  }),
  ORDER_MEMO_ADD: Object.freeze({
    key: "com.alibaba.trade:alibaba.order.memoAdd-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.order.memoAdd",
    version: 1,
    displayName: "Buyer order memo add",
  }),
  ORDER_FEEDBACK_ADD: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.addFeedback-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.addFeedback",
    version: 1,
    displayName: "Buyer order feedback add",
  }),
  CONFIRM_RECEIVE_GOODS: Object.freeze({
    key: "com.alibaba.trade:trade.receivegoods.confirm-1",
    namespace: "com.alibaba.trade",
    name: "trade.receivegoods.confirm",
    version: 1,
    displayName: "Buyer confirm receive goods",
  }),
  LOGISTICS_INFO: Object.freeze({
    key: "com.alibaba.logistics:alibaba.trade.getLogisticsInfos.buyerView-1",
    namespace: "com.alibaba.logistics",
    name: "alibaba.trade.getLogisticsInfos.buyerView",
    version: 1,
    displayName: "获取交易订单的物流信息(买家视角)",
  }),
  LOGISTICS_TRACE: Object.freeze({
    key: "com.alibaba.logistics:alibaba.trade.getLogisticsTraceInfo.buyerView-1",
    namespace: "com.alibaba.logistics",
    name: "alibaba.trade.getLogisticsTraceInfo.buyerView",
    version: 1,
    displayName: "获取交易订单物流跟踪信息(买家视角)",
  }),
  LOGISTICS_TRACE_INFO: Object.freeze({
    key: "com.alibaba.logistics:alibaba.trade.getLogisticsTraceInfo.buyerView-1",
    namespace: "com.alibaba.logistics",
    name: "alibaba.trade.getLogisticsTraceInfo.buyerView",
    version: 1,
    displayName: "获取交易订单的物流跟踪信息(买家视角)",
  }),
  MARKETING_MIX_CONFIG: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.OpQueryMarketingMixConfig-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.OpQueryMarketingMixConfig",
    version: 1,
    displayName: "Query seller mixed batch settings",
  }),
  REFUND_REASON_LIST: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.getRefundReasonList-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.getRefundReasonList",
    version: 1,
    displayName: "查询退款退货原因",
  }),
  REFUND_VOUCHER_UPLOAD: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.uploadRefundVoucher-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.uploadRefundVoucher",
    version: 1,
    displayName: "上传退款退货凭证",
  }),
  CREATE_REFUND: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.createRefund-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.createRefund",
    version: 1,
    displayName: "创建退款退货申请",
  }),
  REFUND_LIST: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.refund.buyer.queryOrderRefundList-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.refund.buyer.queryOrderRefundList",
    version: 1,
    displayName: "查询退款单列表(买家视角)",
  }),
  REFUND_BY_ORDER: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.refund.OpQueryBatchRefundByOrderIdAndStatus-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.refund.OpQueryBatchRefundByOrderIdAndStatus",
    version: 1,
    displayName: "查询退款单详情-根据订单ID",
  }),
  REFUND_DETAIL: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.refund.OpQueryOrderRefund-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.refund.OpQueryOrderRefund",
    version: 1,
    displayName: "查询退款单详情-根据退款单ID",
  }),
  REFUND_OPERATION_LIST: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.refund.OpQueryOrderRefundOperationList-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.refund.OpQueryOrderRefundOperationList",
    version: 1,
    displayName: "退款单操作记录列表",
  }),
  REFUND_RETURN_GOODS: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.refund.returnGoods-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.refund.returnGoods",
    version: 1,
    displayName: "买家提交退款货信息",
  }),
  OFFLINE_LOGISTIC_COMPANY_LIST: Object.freeze({
    key: "com.alibaba.logistics:alibaba.logistics.OpQueryLogisticCompanyList.offline-1",
    namespace: "com.alibaba.logistics",
    name: "alibaba.logistics.OpQueryLogisticCompanyList.offline",
    version: 1,
    displayName: "物流公司列表-自联物流",
  }),
  SUPPLY_CHANGE_AGENT: Object.freeze({
    key: "com.alibaba.ai:open.agent.supplyChange-1",
    namespace: "com.alibaba.ai",
    name: "open.agent.supplyChange",
    version: 1,
    displayName: "Supply change agent",
  }),
  SUPPLY_CHANGE_DATA_FEEDBACK: Object.freeze({
    key: "com.alibaba.ai:open.agent.supplyChangeDataFeedback-1",
    namespace: "com.alibaba.ai",
    name: "open.agent.supplyChangeDataFeedback",
    version: 1,
    displayName: "Supply change agent data feedback",
  }),
  MONITOR_PRODUCT_ADD: Object.freeze({
    key: "com.alibaba.fenxiao:fenxiao.supply.addMonitorProduct-1",
    namespace: "com.alibaba.fenxiao",
    name: "fenxiao.supply.addMonitorProduct",
    version: 1,
    displayName: "Add supply monitor product",
  }),
  MONITOR_PRODUCT_DELETE: Object.freeze({
    key: "com.alibaba.fenxiao:fenxiao.supply.deleteMonitorProduct-1",
    namespace: "com.alibaba.fenxiao",
    name: "fenxiao.supply.deleteMonitorProduct",
    version: 1,
    displayName: "Delete supply monitor product",
  }),
  MONITOR_PRODUCT_LIST: Object.freeze({
    key: "com.alibaba.fenxiao:fenxiao.supply.queryMonitorProductList-1",
    namespace: "com.alibaba.fenxiao",
    name: "fenxiao.supply.queryMonitorProductList",
    version: 1,
    displayName: "Query supply monitor products",
  }),
  DEEP_SEARCH_AGENT: Object.freeze({
    key: "com.alibaba.ai:open.agent.deepSearch-1",
    namespace: "com.alibaba.ai",
    name: "open.agent.deepSearch",
    version: 1,
    displayName: "Deep search agent",
  }),
  MAX_REFUND_FEE: Object.freeze({
    key: "com.alibaba.trade:alibaba.trade.getMaxRefundFee-1",
    namespace: "com.alibaba.trade",
    name: "alibaba.trade.getMaxRefundFee",
    version: 1,
    displayName: "申请退款时查询最大可退费用",
  }),
});

function normalizeOpenApiValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function normalizeOpenApiParams(params = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (key === "_aop_signature") continue;
    const next = normalizeOpenApiValue(value);
    if (next !== null && next !== "") normalized[key] = next;
  }
  return normalized;
}

function build1688ApiPath(api, appKey, protocol = "param2") {
  if (!api?.namespace || !api?.name || !api?.version) {
    throw new Error("1688 API namespace, name and version are required");
  }
  if (!appKey) throw new Error("1688 AppKey is required");
  return `${protocol}/${api.version}/${api.namespace}/${api.name}/${appKey}`;
}

function sign1688Request(apiPath, params = {}, appSecret) {
  if (!appSecret) throw new Error("1688 AppSecret is required");
  const normalized = normalizeOpenApiParams(params);
  const signingText = Object.keys(normalized)
    .sort()
    .reduce((text, key) => `${text}${key}${normalized[key]}`, apiPath);
  return crypto
    .createHmac("sha1", appSecret)
    .update(signingText, "utf8")
    .digest("hex")
    .toUpperCase();
}

function build1688OpenApiRequest({ api, appKey, appSecret, accessToken, params = {}, gatewayBase, protocol }) {
  const apiPath = build1688ApiPath(api, appKey, protocol);
  const requestParams = normalizeOpenApiParams({
    access_token: accessToken,
    ...params,
  });
  requestParams._aop_signature = sign1688Request(apiPath, requestParams, appSecret);
  return {
    apiPath,
    url: `${(gatewayBase || DEFAULT_1688_GATEWAY_BASE).replace(/\/+$/, "")}/${apiPath}`,
    params: requestParams,
  };
}

async function call1688OpenApi({ credentials, api, params = {}, fetchImpl = fetch, gatewayBase, protocol, timeoutMs = 30000 }) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Current runtime does not provide fetch");
  }
  const { appKey, appSecret, accessToken } = credentials || {};
  if (!accessToken) throw new Error("1688 access token is missing; authorize first");

  const request = build1688OpenApiRequest({
    api,
    appKey,
    appSecret,
    accessToken,
    params,
    gatewayBase,
    protocol,
  });
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body: new URLSearchParams(request.params).toString(),
      signal: controller?.signal,
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`1688 API response is not JSON: ${text.slice(0, 200)}`);
    }
    const errorText = get1688ApiErrorText(payload);
    if (!response.ok || is1688ApiFailure(payload)) {
      const error = new Error(errorText || `1688 API request failed with HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      error.request = request;
      error.errorCode = payload.error_code || payload.errorCode || payload.code || null;
      throw error;
    }
    return {
      request,
      response: payload,
      status: response.status,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function is1688ApiFailure(payload = {}) {
  if (!payload || typeof payload !== "object") return false;
  return Boolean(
    payload.error
      || payload.error_code
      || payload.errorCode
      || payload.success === false
      || payload.result?.success === false,
  );
}

function get1688ApiErrorText(payload = {}) {
  const direct = firstPresent(
    payload.error_message,
    payload.errorMessage,
    payload.error_description,
    payload.message,
    payload.msg,
    payload.errorMsg,
    payload.error_msg,
    payload.error,
  );
  if (direct && typeof direct !== "object") return String(direct);
  const nested = find1688ApiErrorValue(payload);
  if (nested && typeof nested !== "object") return String(nested);
  if (direct && typeof direct === "object") {
    try {
      return JSON.stringify(direct).slice(0, 500);
    } catch {}
  }
  return null;
}

function find1688ApiErrorValue(value, depth = 0) {
  if (!value || depth > 6) return null;
  if (typeof value !== "object") return null;
  for (const key of [
    "error_message",
    "errorMessage",
    "error_description",
    "message",
    "msg",
    "errorMsg",
    "error_msg",
    "returnMessage",
    "return_message",
    "reason",
  ]) {
    const candidate = value[key];
    if (candidate !== null && candidate !== undefined && candidate !== "") return candidate;
  }
  for (const item of Object.values(value)) {
    const found = find1688ApiErrorValue(item, depth + 1);
    if (found) return found;
  }
  return null;
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      const nested = firstNumber(...value);
      if (nested !== null) return nested;
      continue;
    }
    if (typeof value === "object") {
      const nested = firstNumber(value.price, value.value, value.amount, value.minPrice, value.min);
      if (nested !== null) return nested;
      continue;
    }
    const number = Number(String(value).replace(/[^\d.-]/g, ""));
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function firstBoolean(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const text = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(text)) return true;
    if (["false", "0", "no", "n"].includes(text)) return false;
  }
  return null;
}

function parseMaybeJson(value) {
  if (!value || typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeArray(value) {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return Object.values(parsed);
  return [];
}

function looksLikeOffer(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  return Boolean(
    item.offerId
    || item.offer_id
    || item.productId
    || item.id
    || item.subject
    || item.title
    || item.imageUrl
    || item.productUrl
  );
}

function findOfferArray(value, depth = 0) {
  if (!value || depth > 8) return [];
  if (Array.isArray(value)) {
    if (value.some(looksLikeOffer)) return value.filter((item) => item && typeof item === "object");
    for (const item of value) {
      const found = findOfferArray(item, depth + 1);
      if (found.length) return found;
    }
    return [];
  }
  if (typeof value !== "object") return [];
  for (const key of ["data", "items", "list", "offerList", "offer_list", "products", "result", "resultList"]) {
    const found = findOfferArray(value[key], depth + 1);
    if (found.length) return found;
  }
  for (const item of Object.values(value)) {
    const found = findOfferArray(item, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function findNested1688Value(value, keys, depth = 0) {
  if (!value || depth > 6) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNested1688Value(item, keys, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const key of keys) {
    const candidate = value[key];
    if (candidate !== null && candidate !== undefined && candidate !== "") return candidate;
  }
  for (const item of Object.values(value)) {
    const found = findNested1688Value(item, keys, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function normalize1688Offer(item = {}) {
  const offerId = firstPresent(item.offerId, item.offer_id, item.productId, item.product_id, item.id);
  const inferredSkuId = findNested1688Value(item, [
    "skuId",
    "skuID",
    "sku_id",
    "mainPriceSkuId",
    "offerSkuId",
    "offer_sku_id",
  ]);
  const inferredSpecId = findNested1688Value(item, [
    "specId",
    "specID",
    "spec_id",
    "cargoSpecId",
    "cargoSpecID",
    "cargo_spec_id",
  ]);
  const skuId = firstPresent(item.skuId, item.skuID, item.sku_id, inferredSkuId);
  const specId = firstPresent(
    item.specId,
    item.specID,
    item.spec_id,
    item.cargoSpecId,
    item.cargoSpecID,
    item.cargo_spec_id,
    inferredSpecId,
  );
  const supplierName = firstPresent(
    item.supplierName,
    item.companyName,
    item.companyInfo?.companyName,
    item.sellerDataInfo?.companyName,
    item.sellerDataInfo?.sellerCompanyName,
    item.shopName,
    item.sellerLoginId,
    item.memberName,
    item.loginId,
    "1688 Supplier",
  );
  const title = firstPresent(item.subject, item.title, item.productTitle, item.name, item.subjectTrans);
  const unitPrice = firstNumber(
    item.offerPrice,
    item.price,
    item.priceInfo,
    item.priceInfo?.promotionPrice,
    item.priceInfo?.consignPrice,
    item.salePrice,
    item.minPrice,
    item.minPriceText,
    item.priceRange,
    item.priceRanges,
  ) ?? 0;
  const moq = Math.max(1, Math.floor(firstNumber(
    item.moq,
    item.minOrderQuantity,
    item.minOrder,
    item.quantityBegin,
    item.startQuantity,
  ) ?? 1));
  const imageUrl = firstPresent(
    item.imageUrl,
    item.image,
    item.imgUrl,
    item.pictureUrl,
    item.offerImage?.imageUrl,
    Array.isArray(item.imageUrls) ? item.imageUrls[0] : null,
  );
  const productUrl = firstPresent(
    item.productUrl,
    item.promotionURL,
    item.promotionUrl,
    item.offerUrl,
    item.detailUrl,
    offerId ? `https://detail.1688.com/offer/${offerId}.html` : null,
  );
  return {
    externalOfferId: offerId ? String(offerId) : null,
    supplierName: String(supplierName || "1688 Supplier"),
    productTitle: title ? String(title) : null,
    productUrl: productUrl ? String(productUrl) : null,
    imageUrl: imageUrl ? String(imageUrl) : null,
    unitPrice,
    moq,
    leadDays: firstNumber(item.leadDays, item.deliveryDays, item.shipInDays),
    logisticsFee: firstNumber(item.logisticsFee, item.freight, item.shippingFee) ?? 0,
    externalSkuId: skuId ? String(skuId) : null,
    externalSpecId: specId ? String(specId) : null,
    raw: item,
  };
}

function normalize1688SearchResponse(payload = {}) {
  const offers = findOfferArray(payload);
  return offers.map(normalize1688Offer);
}

function looksLikeProductDetail(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  return Boolean(
    item.productID
    || item.productId
    || item.offerId
    || item.subject
    || item.title
    || item.name
    || item.skuInfos
    || item.skuInfo
    || item.skuList
    || item.saleInfo
    || item.priceRanges
  );
}

function findProductDetailObject(value, depth = 0) {
  const parsed = parseMaybeJson(value);
  if (!parsed || depth > 8) return {};
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = findProductDetailObject(item, depth + 1);
      if (Object.keys(found).length) return found;
    }
    return {};
  }
  if (typeof parsed !== "object") return {};
  if (looksLikeProductDetail(parsed)) return parsed;
  for (const key of ["result", "data", "toReturn", "product", "productInfo", "returnValue", "response"]) {
    const found = findProductDetailObject(parsed[key], depth + 1);
    if (Object.keys(found).length) return found;
  }
  for (const item of Object.values(parsed)) {
    const found = findProductDetailObject(item, depth + 1);
    if (Object.keys(found).length) return found;
  }
  return {};
}

function normalize1688PriceRanges(product = {}) {
  const saleInfo = product.saleInfo && typeof product.saleInfo === "object" ? product.saleInfo : {};
  const ranges = normalizeArray(firstPresent(
    product.priceRanges,
    product.priceRange,
    saleInfo.priceRanges,
    saleInfo.priceRange,
  ));
  return ranges
    .map((range) => {
      if (!range || typeof range !== "object") return null;
      const startQuantity = firstNumber(
        range.startQuantity,
        range.beginAmount,
        range.begin,
        range.minQuantity,
        range.min,
      );
      const price = firstNumber(range.price, range.value, range.amount, range.discountPrice);
      if (price === null) return null;
      return {
        startQuantity: Math.max(1, Math.floor(startQuantity || 1)),
        price,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startQuantity - b.startQuantity);
}

function normalizeSkuAttributes(sku = {}) {
  const raw = firstPresent(sku.attributes, sku.skuAttributes, sku.attrList, sku.specAttrs, sku.attributesMap);
  const parsed = parseMaybeJson(raw);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => {
      if (!item || typeof item !== "object") return { name: "", value: String(item || "") };
      return {
        name: String(firstPresent(item.attributeName, item.name, item.prop, item.key, "") || ""),
        value: String(firstPresent(item.value, item.attributeValue, item.valueName, item.text, "") || ""),
      };
    }).filter((item) => item.name || item.value);
  }
  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed).map(([name, value]) => ({
      name: String(name),
      value: String(value),
    }));
  }
  return [];
}

function normalize1688SkuOptions(product = {}) {
  const skus = normalizeArray(firstPresent(product.skuInfos, product.skuInfo, product.skuList, product.skus));
  return skus.map((sku) => {
    const attributes = normalizeSkuAttributes(sku);
    const skuId = firstPresent(sku.skuId, sku.skuID, sku.sku_id, sku.id);
    const specId = firstPresent(sku.specId, sku.specID, sku.spec_id, sku.cargoSkuId, sku.cargoSkuID);
    const price = firstNumber(
      sku.price,
      sku.salePrice,
      sku.discountPrice,
      sku.priceCent ? Number(sku.priceCent) / 100 : null,
    );
    return {
      externalSkuId: skuId ? String(skuId) : null,
      externalSpecId: specId ? String(specId) : null,
      specText: attributes.map((item) => `${item.name}:${item.value}`).join("; "),
      attributes,
      price,
      stock: firstNumber(sku.amountOnSale, sku.canBookCount, sku.stock, sku.inventory),
      raw: sku,
    };
  }).filter((sku) => sku.externalSkuId || sku.externalSpecId || sku.price !== null || sku.specText);
}

function normalize1688ProductDetailResponse(payload = {}) {
  const product = findProductDetailObject(payload);
  const saleInfo = product.saleInfo && typeof product.saleInfo === "object" ? product.saleInfo : {};
  const priceRanges = normalize1688PriceRanges(product);
  const skuOptions = normalize1688SkuOptions(product);
  const offerId = firstPresent(product.productID, product.productId, product.offerId, product.id);
  const supplierName = firstPresent(
    product.supplierName,
    product.companyName,
    product.shopName,
    product.sellerLoginId,
    product.memberName,
    product.loginId,
    product.supplier?.name,
    "1688 Supplier",
  );
  const title = firstPresent(product.subject, product.title, product.productTitle, product.name);
  const imageUrl = firstPresent(
    product.imageUrl,
    product.mainImage,
    product.pictureUrl,
    Array.isArray(product.imageUrls) ? product.imageUrls[0] : null,
    Array.isArray(product.images) ? product.images[0] : null,
  );
  const productUrl = firstPresent(
    product.productUrl,
    product.detailUrl,
    product.offerUrl,
    offerId ? `https://detail.1688.com/offer/${offerId}.html` : null,
  );
  const unitPrice = firstNumber(
    skuOptions.map((item) => item.price),
    priceRanges.map((item) => item.price),
    product.price,
    product.minPrice,
    saleInfo.price,
    saleInfo.retailPrice,
  ) ?? 0;
  const moq = Math.max(1, Math.floor(firstNumber(
    product.moq,
    product.minOrderQuantity,
    product.minOrder,
    saleInfo.minOrderQuantity,
    priceRanges[0]?.startQuantity,
  ) ?? 1));

  return {
    externalOfferId: offerId ? String(offerId) : null,
    supplierName: String(supplierName || "1688 Supplier"),
    productTitle: title ? String(title) : null,
    productUrl: productUrl ? String(productUrl) : null,
    imageUrl: imageUrl ? String(imageUrl) : null,
    unitPrice,
    moq,
    priceRanges,
    skuOptions,
    raw: product,
  };
}

function looksLikeBuyerOrder(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  return Boolean(
    item.orderId
    || item.order_id
    || item.tradeId
    || item.trade_id
    || item.id
    || item.orderStatus
    || item.status
    || item.sellerCompany
    || item.sellerCompanyName
    || item.sellerLoginId
    || item.buyerOrder
  );
}

function findBuyerOrderArray(value, depth = 0) {
  const parsed = parseMaybeJson(value);
  if (!parsed || depth > 8) return [];
  if (Array.isArray(parsed)) {
    if (parsed.some(looksLikeBuyerOrder)) return parsed.filter((item) => item && typeof item === "object");
    for (const item of parsed) {
      const found = findBuyerOrderArray(item, depth + 1);
      if (found.length) return found;
    }
    return [];
  }
  if (typeof parsed !== "object") return [];
  for (const key of [
    "result",
    "data",
    "orders",
    "orderList",
    "tradeList",
    "trades",
    "items",
    "list",
    "toReturn",
    "returnValue",
  ]) {
    const found = findBuyerOrderArray(parsed[key], depth + 1);
    if (found.length) return found;
  }
  for (const item of Object.values(parsed)) {
    const found = findBuyerOrderArray(item, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function normalizeOrderLineIds(rawLine = {}) {
  const productId = firstPresent(
    rawLine.offerId,
    rawLine.offerID,
    rawLine.productId,
    rawLine.productID,
    rawLine.product_id,
    rawLine.itemId,
    rawLine.itemID,
  );
  const skuId = firstPresent(rawLine.skuId, rawLine.skuID, rawLine.sku_id, rawLine.cargoSkuId, rawLine.cargoSkuID);
  const specId = firstPresent(rawLine.specId, rawLine.specID, rawLine.spec_id, rawLine.cargoSpecId, rawLine.cargoSpecID);
  return {
    productId: productId ? String(productId) : null,
    skuId: skuId ? String(skuId) : null,
    specId: specId ? String(specId) : null,
    quantity: firstNumber(rawLine.quantity, rawLine.num, rawLine.amount, rawLine.count),
    title: firstPresent(rawLine.productName, rawLine.title, rawLine.name, rawLine.subject),
    raw: rawLine,
  };
}

function normalize1688BuyerOrder(item = {}) {
  const nested = item.buyerOrder && typeof item.buyerOrder === "object" ? item.buyerOrder : item;
  const externalOrderId = firstPresent(
    nested.orderId,
    nested.order_id,
    nested.tradeId,
    nested.trade_id,
    nested.id,
    nested.orderid,
  );
  const rawLines = normalizeArray(firstPresent(
    nested.products,
    nested.productItems,
    nested.orderEntries,
    nested.cargoList,
    nested.cargoParamList,
    nested.items,
    nested.itemList,
  ));
  const lines = rawLines.map(normalizeOrderLineIds).filter((line) => (
    line.productId || line.skuId || line.specId || line.quantity || line.title
  ));
  return {
    externalOrderId: externalOrderId ? String(externalOrderId) : null,
    status: firstPresent(nested.orderStatus, nested.status, nested.baseStatus, nested.tradeStatus),
    supplierName: firstPresent(
      nested.sellerCompany,
      nested.sellerCompanyName,
      nested.supplierName,
      nested.companyName,
      nested.sellerLoginId,
      nested.sellerMemberId,
    ),
    totalAmount: firstNumber(
      nested.totalAmount,
      nested.sumPayment,
      nested.actualPayFee,
      nested.orderAmount,
      nested.payment,
      nested.price,
    ),
    freight: firstNumber(nested.freight, nested.postFee, nested.shippingFee, nested.carriage),
    createdAt: firstPresent(nested.createTime, nested.gmtCreate, nested.orderCreateTime, nested.tradeCreateTime),
    productIds: Array.from(new Set(lines.map((line) => line.productId).filter(Boolean))),
    skuIds: Array.from(new Set(lines.map((line) => line.skuId).filter(Boolean))),
    specIds: Array.from(new Set(lines.map((line) => line.specId).filter(Boolean))),
    lines,
    raw: item,
  };
}

function normalize1688BuyerOrderListResponse(payload = {}) {
  const orders = findBuyerOrderArray(payload);
  return orders.map(normalize1688BuyerOrder).filter((order) => order.externalOrderId);
}

function looksLikeMarketingMixConfig(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  return Boolean(
    Object.prototype.hasOwnProperty.call(item, "generalHunpi")
    || Object.prototype.hasOwnProperty.call(item, "general_hunpi")
    || Object.prototype.hasOwnProperty.call(item, "mixAmount")
    || Object.prototype.hasOwnProperty.call(item, "mix_amount")
    || Object.prototype.hasOwnProperty.call(item, "mixNumber")
    || Object.prototype.hasOwnProperty.call(item, "mix_number")
    || Object.prototype.hasOwnProperty.call(item, "memberId")
    || Object.prototype.hasOwnProperty.call(item, "member_id")
  );
}

function findMarketingMixConfigObject(value, depth = 0) {
  const parsed = parseMaybeJson(value);
  if (!parsed || depth > 8) return {};
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = findMarketingMixConfigObject(item, depth + 1);
      if (Object.keys(found).length) return found;
    }
    return {};
  }
  if (typeof parsed !== "object") return {};
  if (looksLikeMarketingMixConfig(parsed)) return parsed;
  for (const key of ["result", "data", "toReturn", "returnValue", "response"]) {
    const found = findMarketingMixConfigObject(parsed[key], depth + 1);
    if (Object.keys(found).length) return found;
  }
  for (const item of Object.values(parsed)) {
    const found = findMarketingMixConfigObject(item, depth + 1);
    if (Object.keys(found).length) return found;
  }
  return {};
}

function normalize1688MarketingMixConfigResponse(payload = {}) {
  const config = findMarketingMixConfigObject(payload);
  const memberId = firstPresent(config.memberId, config.member_id);
  return {
    generalHunpi: firstBoolean(config.generalHunpi, config.general_hunpi) ?? false,
    mixAmount: firstNumber(config.mixAmount, config.mix_amount),
    mixNumber: firstNumber(config.mixNumber, config.mix_number),
    memberId: memberId ? String(memberId) : null,
    gmtCreate: firstPresent(config.gmtCreate, config.gmt_create) || null,
    gmtModified: firstPresent(config.gmtModified, config.gmt_modified) || null,
    raw: config,
  };
}

function looksLikeRefund(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  return Boolean(
    item.refundId
    || item.refund_id
    || item.refundID
    || item.orderRefundId
    || item.refundStatus
    || item.refund_status
    || item.refundPayment
    || item.applyPayment
    || item.refundType
    || item.reason
  );
}

function findRefundArray(value, depth = 0) {
  const parsed = parseMaybeJson(value);
  if (!parsed || depth > 8) return [];
  if (Array.isArray(parsed)) {
    if (parsed.some(looksLikeRefund)) return parsed.filter((item) => item && typeof item === "object");
    for (const item of parsed) {
      const found = findRefundArray(item, depth + 1);
      if (found.length) return found;
    }
    return [];
  }
  if (typeof parsed !== "object") return [];
  for (const key of [
    "result",
    "data",
    "refunds",
    "refundList",
    "refund_list",
    "orderRefundList",
    "items",
    "list",
    "toReturn",
    "returnValue",
  ]) {
    const found = findRefundArray(parsed[key], depth + 1);
    if (found.length) return found;
  }
  if (looksLikeRefund(parsed)) return [parsed];
  for (const item of Object.values(parsed)) {
    const found = findRefundArray(item, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function normalize1688Refund(item = {}) {
  const nested = item.refund && typeof item.refund === "object" ? item.refund : item;
  const refundId = firstPresent(
    nested.refundId,
    nested.refundID,
    nested.refund_id,
    nested.orderRefundId,
    nested.id,
  );
  const externalOrderId = firstPresent(
    nested.orderId,
    nested.orderID,
    nested.order_id,
    nested.tradeId,
    nested.tradeID,
    nested.trade_id,
    nested.mainOrderId,
  );
  const amount = firstNumber(
    nested.refundPayment,
    nested.applyPayment,
    nested.refundAmount,
    nested.amount,
    nested.payment,
  );
  return {
    refundId: refundId ? String(refundId) : null,
    externalOrderId: externalOrderId ? String(externalOrderId) : null,
    status: firstPresent(nested.refundStatus, nested.refund_status, nested.status, nested.bizStatus),
    refundType: firstPresent(nested.refundType, nested.refund_type, nested.disputeType),
    reason: firstPresent(nested.reason, nested.refundReason, nested.refund_reason, nested.applyReason),
    amount,
    currency: firstPresent(nested.currency, nested.currencyCode) || "CNY",
    createdAt: firstPresent(nested.gmtCreate, nested.createTime, nested.createdAt),
    modifiedAt: firstPresent(nested.gmtModified, nested.modifiedTime, nested.updatedAt),
    raw: item,
  };
}

function normalize1688RefundListResponse(payload = {}) {
  return findRefundArray(payload).map(normalize1688Refund).filter((refund) => (
    refund.refundId || refund.externalOrderId
  ));
}

module.exports = {
  DEFAULT_1688_GATEWAY_BASE,
  PROCUREMENT_APIS,
  build1688ApiPath,
  build1688OpenApiRequest,
  call1688OpenApi,
  normalize1688BuyerOrderListResponse,
  normalize1688MarketingMixConfigResponse,
  normalize1688ProductDetailResponse,
  normalize1688RefundListResponse,
  normalize1688SearchResponse,
  sign1688Request,
};
