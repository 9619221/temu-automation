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
  LOGISTICS_INFO: Object.freeze({
    key: "com.alibaba.logistics:alibaba.trade.getLogisticsInfos.buyerView-1",
    namespace: "com.alibaba.logistics",
    name: "alibaba.trade.getLogisticsInfos.buyerView",
    version: 1,
    displayName: "获取交易订单的物流信息(买家视角)",
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
    const errorText = payload.error_message
      || payload.errorMessage
      || payload.error_description
      || payload.message
      || payload.error;
    if (!response.ok || payload.error || payload.error_code || payload.errorCode) {
      throw new Error(errorText || `1688 API request failed with HTTP ${response.status}`);
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

function normalize1688Offer(item = {}) {
  const offerId = firstPresent(item.offerId, item.offer_id, item.productId, item.product_id, item.id);
  const skuId = firstPresent(item.skuId, item.sku_id, item.specId, item.spec_id);
  const supplierName = firstPresent(
    item.supplierName,
    item.companyName,
    item.shopName,
    item.sellerLoginId,
    item.memberName,
    item.loginId,
    "1688 Supplier",
  );
  const title = firstPresent(item.subject, item.title, item.productTitle, item.name, item.subjectTrans);
  const unitPrice = firstNumber(
    item.price,
    item.priceInfo,
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
    Array.isArray(item.imageUrls) ? item.imageUrls[0] : null,
  );
  const productUrl = firstPresent(
    item.productUrl,
    item.offerUrl,
    item.detailUrl,
    offerId ? `https://detail.1688.com/offer/${offerId}.html` : null,
  );
  return {
    externalOfferId: offerId ? String(offerId) : null,
    externalSkuId: skuId ? String(skuId) : null,
    externalSpecId: firstPresent(item.specId, item.spec_id) ? String(firstPresent(item.specId, item.spec_id)) : null,
    supplierName: String(supplierName || "1688 Supplier"),
    productTitle: title ? String(title) : null,
    productUrl: productUrl ? String(productUrl) : null,
    imageUrl: imageUrl ? String(imageUrl) : null,
    unitPrice,
    moq,
    leadDays: firstNumber(item.leadDays, item.deliveryDays, item.shipInDays),
    logisticsFee: firstNumber(item.logisticsFee, item.freight, item.shippingFee) ?? 0,
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

module.exports = {
  DEFAULT_1688_GATEWAY_BASE,
  PROCUREMENT_APIS,
  build1688ApiPath,
  build1688OpenApiRequest,
  call1688OpenApi,
  normalize1688ProductDetailResponse,
  normalize1688SearchResponse,
  sign1688Request,
};
