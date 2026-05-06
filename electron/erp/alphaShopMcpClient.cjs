const crypto = require("crypto");
const { fetch } = require("undici");

const MCP_SERVER_BASE = "https://mcp.alphashop.cn/sse";
const MCP_PROTOCOL_VERSION = "2024-11-05";

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function signAlphaShopToken(accessKey, secretKey) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256" };
  const payload = {
    iss: accessKey,
    exp: nowSeconds + 1800,
    nbf: nowSeconds - 5,
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = crypto.createHmac("sha256", secretKey).update(signingInput).digest();
  return `${signingInput}.${base64Url(signature)}`;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const matched = String(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!matched) return null;
  const parsed = Number(matched[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstPresent(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return null;
}

function firstNumber(...values) {
  for (const value of values.flat(Infinity)) {
    const number = toNumber(value);
    if (number !== null) return number;
  }
  return null;
}

function findNestedText(value, keys, depth = 0) {
  if (!value || depth > 6) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedText(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const key of keys) {
    const found = firstText(value[key]);
    if (found) return found;
  }
  for (const item of Object.values(value)) {
    const found = findNestedText(item, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) return parsed;
  return [];
}

function normalizeList(value) {
  if (!value) return [];
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return Object.values(parsed);
  return [];
}

function looksLikeProduct(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  return Boolean(
    item.productId
      || item.productID
      || item.offerId
      || item.offerID
      || item.goodsId
      || item.itemId
      || item.title
      || item.subject
      || item.productTitle
      || item.price
      || item.imageUrl
      || item.imgUrl
  );
}

function findProductArray(value, depth = 0) {
  const parsed = parseMaybeJson(value);
  if (!parsed || depth > 10) return [];
  if (Array.isArray(parsed)) {
    const objectItems = parsed.filter((item) => item && typeof item === "object" && !Array.isArray(item));
    if (objectItems.some(looksLikeProduct)) return objectItems;
    for (const item of parsed) {
      const found = findProductArray(item, depth + 1);
      if (found.length) return found;
    }
    return [];
  }
  if (typeof parsed !== "object") return [];

  for (const key of [
    "products",
    "productList",
    "items",
    "itemList",
    "offers",
    "offerList",
    "data",
    "list",
    "result",
    "results",
    "records",
  ]) {
    const found = findProductArray(parsed[key], depth + 1);
    if (found.length) return found;
  }
  for (const item of Object.values(parsed)) {
    const found = findProductArray(item, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function firstImage(...values) {
  for (const value of values) {
    const parsed = parseMaybeJson(value);
    if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
    if (Array.isArray(parsed)) {
      const nested = firstImage(...parsed);
      if (nested) return nested;
    }
    if (parsed && typeof parsed === "object") {
      const nested = firstImage(parsed.imageUrl, parsed.url, parsed.imgUrl, parsed.picUrl);
      if (nested) return nested;
    }
  }
  return null;
}

function normalizeAlphaShopProduct(item = {}) {
  const productId = firstText(
    item.productId,
    item.productID,
    item.offerId,
    item.offerID,
    item.goodsId,
    item.itemId,
    item.id,
  );
  const skuId = findNestedText(item, [
    "skuId",
    "skuID",
    "sku_id",
    "offerSkuId",
    "offer_sku_id",
    "mainPriceSkuId",
  ]);
  // specId 必须来自真正的 spec/cargoSku 字段，不能回退到 skuId——
  // 否则 1688 下单 API 会拒绝（cargoSkuId ≠ skuId 是 1688 体系内的两个概念）。
  const specId = findNestedText(item, [
    "specId",
    "specID",
    "spec_id",
    "cargoSkuId",
    "cargoSkuID",
    "cargo_sku_id",
  ]);
  const productUrl = firstText(
    item.productUrl,
    item.detailUrl,
    item.offerUrl,
    item.url,
    productId ? `https://detail.1688.com/offer/${productId}.html` : null,
  );
  return {
    externalOfferId: productId,
    externalSkuId: skuId,
    externalSpecId: specId,
    supplierName: firstText(
      item.supplierName,
      item.companyName,
      item.shopName,
      item.sellerName,
      item.storeName,
      item.companyInfo && item.companyInfo.companyName,
    ) || "1688 Supplier",
    productTitle: firstText(
      item.productTitle,
      item.originTitle,
      item.aiTitle,
      item.title,
      item.subject,
      item.name,
      item.titleCn,
      item.titleZh,
      item.subjectTrans,
    ),
    productUrl,
    imageUrl: firstImage(
      item.imageUrl,
      item.originImageUrl,
      item.aiImageUrl,
      item.imgUrl,
      item.picUrl,
      item.pictureUrl,
      item.mainImage,
      item.productImage,
      item.offerImage,
      item.images,
      item.imageList,
      item.imageUrls,
    ),
    unitPrice: toNumber(item.price ?? item.offerPrice ?? item.salePrice ?? item.minPrice ?? item.priceText ?? item.priceRange ?? item.priceInfo),
    moq: Math.max(1, Math.floor(toNumber(item.moq ?? item.minOrderQuantity ?? item.minimumOrderQuantity ?? item.startQuantity ?? item.beginAmount) || 1)),
    remark: firstText(item.sales, item.salesVolume, item.saleQuantity, item.soldCount),
    raw: item,
  };
}

function looksLikeProductDetail(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  return Boolean(
    item.productId
      || item.productID
      || item.offerId
      || item.offerID
      || item.goodsId
      || item.itemId
      || item.productTitle
      || item.subject
      || item.title
      || item.productSkuInfos
      || item.productSkuInfoList
      || item.skuInfos
      || item.skuInfo
      || item.skuInfoList
      || item.skuList
      || item.skus
      || item.productAttributeList
      || item.productAttributes
      || item.imageList
      || item.productImageList
      || item.priceRanges
  );
}

function findProductDetailObject(value, depth = 0) {
  const parsed = parseMaybeJson(value);
  if (!parsed || depth > 10) return {};
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = findProductDetailObject(item, depth + 1);
      if (Object.keys(found).length) return found;
    }
    return {};
  }
  if (typeof parsed !== "object") return {};
  if (looksLikeProductDetail(parsed)) return parsed;
  for (const key of [
    "product",
    "productInfo",
    "productDetail",
    "detail",
    "data",
    "result",
    "response",
    "returnValue",
    "toReturn",
  ]) {
    const found = findProductDetailObject(parsed[key], depth + 1);
    if (Object.keys(found).length) return found;
  }
  for (const item of Object.values(parsed)) {
    const found = findProductDetailObject(item, depth + 1);
    if (Object.keys(found).length) return found;
  }
  return {};
}

function looksLikeSku(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  return Boolean(
    item.skuId
      || item.skuID
      || item.sku_id
      || item.specId
      || item.specID
      || item.spec_id
      || item.cargoSkuId
      || item.cargoSkuID
      || item.cargo_sku_id
      || item.offerSkuId
      || item.offer_sku_id
      || item.specAttrs
      || item.skuAttributes
      || item.attrList
  );
}

function findSkuArray(value, depth = 0) {
  const parsed = parseMaybeJson(value);
  if (!parsed || depth > 8) return [];
  if (Array.isArray(parsed)) {
    const objectItems = parsed.filter((item) => item && typeof item === "object" && !Array.isArray(item));
    if (objectItems.some(looksLikeSku)) return objectItems;
    for (const item of parsed) {
      const found = findSkuArray(item, depth + 1);
      if (found.length) return found;
    }
    return [];
  }
  if (typeof parsed !== "object") return [];
  for (const key of [
    "productSkuInfos",
    "productSkuInfoList",
    "skuInfos",
    "skuInfo",
    "skuInfoList",
    "skuList",
    "skus",
    "skuMap",
    "offerSkuList",
    "saleSkuList",
    "cargoSkuList",
  ]) {
    const values = normalizeList(parsed[key]);
    if (values.some(looksLikeSku)) return values.filter((item) => item && typeof item === "object");
    const found = findSkuArray(parsed[key], depth + 1);
    if (found.length) return found;
  }
  for (const item of Object.values(parsed)) {
    const found = findSkuArray(item, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function normalizeSkuAttributes(sku = {}) {
  const raw = firstPresent(
    sku.attributes,
    sku.skuAttributes,
    sku.attrList,
    sku.specAttrs,
    sku.specList,
    sku.productSkuAttributeInfos,
    sku.productSkuAttributes,
    sku.skuAttributeInfos,
    sku.properties,
    sku.saleAttributes,
    sku.skuProps,
    sku.specName,
    sku.specText,
  );
  const parsed = parseMaybeJson(raw);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => {
      if (!item || typeof item !== "object") return { name: "", value: String(item || "") };
      return {
        name: String(firstText(
          item.attributeName,
          item.attributeNameTrans,
          item.name,
          item.prop,
          item.key,
          item.propertyName,
          "",
        ) || ""),
        value: String(firstText(
          item.value,
          item.valueTrans,
          item.attributeValue,
          item.valueName,
          item.text,
          item.propertyValue,
          "",
        ) || ""),
      };
    }).filter((item) => item.name || item.value);
  }
  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed).map(([name, value]) => ({
      name: String(name),
      value: String(value),
    }));
  }
  const text = firstText(parsed);
  return text ? [{ name: "", value: text }] : [];
}

function normalizeAlphaShopSkuOptions(product = {}) {
  const skus = findSkuArray(product);
  // [DIAG] 暂存——确认遨虾返回里 SKU 上有哪些字段，有没有真正的 cargoSkuId/specId
  if (skus.length && process.env.ERP_DIAG_ALPHASHOP === "1") {
    try {
      console.error("[alphashop-diag] sku[0] keys:", Object.keys(skus[0] || {}));
      console.error("[alphashop-diag] sku[0] full:", JSON.stringify(skus[0], null, 2).slice(0, 4000));
    } catch {}
  }
  return skus.map((sku) => {
    const attributes = normalizeSkuAttributes(sku);
    const skuId = firstText(
      sku.skuId,
      sku.skuID,
      sku.sku_id,
      sku.id,
      sku.offerSkuId,
      sku.offer_sku_id,
    );
    // specId 必须来自 spec/cargoSku 字段。不再回退到 skuId/offerSkuId——
    // 1688 下单接口校验时 cargoSkuId 和 skuId 是两个独立概念，混用会被拒绝。
    const specId = firstText(
      sku.specId,
      sku.specID,
      sku.spec_id,
      sku.cargoSkuId,
      sku.cargoSkuID,
      sku.cargo_sku_id,
    );
    const specText = attributes
      .map((item) => (item.name ? `${item.name}:${item.value}` : item.value))
      .filter(Boolean)
      .join("; ") || firstText(sku.specText, sku.specName, sku.name);
    return {
      externalSkuId: skuId,
      externalSpecId: specId,
      specText,
      attributes,
      price: firstNumber(
        sku.price,
        sku.salePrice,
        sku.discountPrice,
        sku.priceCent ? Number(sku.priceCent) / 100 : null,
        sku.priceInfo,
      ),
      stock: firstNumber(sku.amountOnSale, sku.canBookCount, sku.stock, sku.inventory, sku.availableStock),
      raw: sku,
    };
  }).filter((sku) => sku.externalSkuId || sku.externalSpecId || sku.price !== null || sku.specText);
}

function normalizeAlphaShopPriceRanges(product = {}) {
  const ranges = normalizeList(firstPresent(
    product.priceRanges,
    product.priceRange,
    product.priceRangeList,
    product.ladderPrices,
    product.ladderPriceList,
    product.productPriceList,
    product.priceInfo && product.priceInfo.priceRanges,
  ));
  return ranges
    .map((range) => {
      if (!range || typeof range !== "object") return null;
      const price = firstNumber(range.price, range.value, range.amount, range.discountPrice, range.salePrice);
      if (price === null) return null;
      return {
        startQuantity: Math.max(1, Math.floor(firstNumber(
          range.startQuantity,
          range.beginAmount,
          range.begin,
          range.minQuantity,
          range.min,
        ) || 1)),
        price,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.startQuantity - right.startQuantity);
}

function normalizeAlphaShopProductDetail(rawResponse = {}, fallbackProductId = null) {
  const product = findProductDetailObject(rawResponse);
  const productId = firstText(
    product.productId,
    product.productID,
    product.offerId,
    product.offerID,
    product.goodsId,
    product.itemId,
    product.id,
    fallbackProductId,
  );
  const skuOptions = normalizeAlphaShopSkuOptions(product);
  const priceRanges = normalizeAlphaShopPriceRanges(product);
  const productUrl = firstText(
    product.productUrl,
    product.detailUrl,
    product.offerUrl,
    product.url,
    productId ? `https://detail.1688.com/offer/${productId}.html` : null,
  );
  return {
    externalOfferId: productId,
    supplierName: firstText(
      product.supplierName,
      product.companyName,
      product.shopName,
      product.sellerName,
      product.storeName,
      product.companyInfo && product.companyInfo.companyName,
    ) || "1688 Supplier",
    productTitle: firstText(
      product.productTitle,
      product.originTitle,
      product.title,
      product.subject,
      product.name,
      product.titleCn,
      product.titleZh,
      product.subjectTrans,
    ),
    productUrl,
    imageUrl: firstImage(
      product.imageUrl,
      product.originImageUrl,
      product.mainImage,
      product.imgUrl,
      product.picUrl,
      product.pictureUrl,
      product.images,
      product.imageList,
      product.imageUrls,
      product.productImageList,
      product.productImages,
    ),
    unitPrice: firstNumber(
      skuOptions.map((item) => item.price),
      priceRanges.map((item) => item.price),
      product.price,
      product.offerPrice,
      product.salePrice,
      product.minPrice,
      product.priceText,
      product.priceRange,
      product.priceInfo,
    ) ?? 0,
    moq: Math.max(1, Math.floor(firstNumber(
      product.moq,
      product.minOrderQuantity,
      product.minimumOrderQuantity,
      product.startQuantity,
      product.beginAmount,
    ) || 1)),
    priceRanges,
    skuOptions,
    raw: product,
  };
}

function decodeToolResult(result) {
  if (!result) return {};
  if (result.structuredContent) return result.structuredContent;
  if (Array.isArray(result.content)) {
    const textParts = result.content
      .map((item) => (item && item.type === "text" ? item.text : ""))
      .filter(Boolean);
    if (textParts.length) return parseMaybeJson(textParts.join("\n"));
  }
  return result;
}

function waitFor(ms, message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

function parseSseBlock(block) {
  let event = "message";
  const data = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    const separatorIndex = line.indexOf(":");
    const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
    const value = separatorIndex >= 0 ? line.slice(separatorIndex + 1).replace(/^ /, "") : "";
    if (field === "event") event = value || "message";
    if (field === "data") data.push(value);
  }
  return { event, data: data.join("\n") };
}

async function callMcpTool({ serverUrl, toolName, args, timeoutMs = 120000 }) {
  const controller = new AbortController();
  const pending = new Map();
  let endpointResolver;
  let endpointRejecter;
  let messageUrl = null;
  let nextId = 1;
  const endpointPromise = new Promise((resolve, reject) => {
    endpointResolver = resolve;
    endpointRejecter = reject;
  });

  const response = await fetch(serverUrl, {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      "User-Agent": "MCP-Client/1.0.0",
    },
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`MCP 连接失败：HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const readLoop = (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separatorIndex = buffer.search(/\r?\n\r?\n/);
        while (separatorIndex >= 0) {
          const block = buffer.slice(0, separatorIndex);
          const matched = buffer.match(/\r?\n\r?\n/);
          buffer = buffer.slice(separatorIndex + (matched ? matched[0].length : 2));
          const parsed = parseSseBlock(block);
          if (parsed.event === "endpoint" && parsed.data) {
            messageUrl = new URL(parsed.data, serverUrl).toString();
            endpointResolver(messageUrl);
          } else if (parsed.data) {
            const payload = parseMaybeJson(parsed.data);
            const pendingKey = payload && payload.id !== undefined ? String(payload.id) : null;
            if (pendingKey && pending.has(pendingKey)) {
              const { resolve, reject } = pending.get(pendingKey);
              pending.delete(pendingKey);
              if (payload.error) reject(new Error(payload.error.message || "MCP 调用失败"));
              else resolve(payload.result);
            }
          }
          separatorIndex = buffer.search(/\r?\n\r?\n/);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      for (const { reject } of pending.values()) reject(error);
      pending.clear();
      endpointRejecter(error);
    }
  })();

  async function post(payload) {
    if (!messageUrl) messageUrl = await Promise.race([endpointPromise, waitFor(15000, "MCP 未返回消息端点")]);
    const postResponse = await fetch(messageUrl, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "User-Agent": "MCP-Client/1.0.0",
      },
      body: JSON.stringify(payload),
    });
    if (!postResponse.ok) throw new Error(`MCP 消息发送失败：HTTP ${postResponse.status}`);
    const text = await postResponse.text();
    return parseMaybeJson(text);
  }

  async function request(method, params) {
    const id = String(nextId++);
    const resultPromise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    const direct = await post({ jsonrpc: "2.0", id, method, params });
    if (direct && typeof direct === "object" && String(direct.id) === id) {
      pending.delete(id);
      if (direct.error) throw new Error(direct.error.message || "MCP 调用失败");
      return direct.result;
    }
    return Promise.race([resultPromise, waitFor(timeoutMs, `MCP 调用超时：${method}`)]);
  }

  try {
    await Promise.race([endpointPromise, waitFor(15000, "MCP 连接超时")]);
    await request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "temu-erp", version: "1.0.0" },
    });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    return await request("tools/call", { name: toolName, arguments: args });
  } finally {
    controller.abort();
    try {
      await readLoop;
    } catch {
      // ignore shutdown errors
    }
  }
}

function alphaShopServerUrl(accessKey, secretKey) {
  const token = signAlphaShopToken(accessKey, secretKey);
  return `${MCP_SERVER_BASE}?key=${encodeURIComponent(token)}`;
}

async function imageSearchProduct({ accessKey, secretKey, imgUrl, beginPage = 1, pageSize = 10, timeoutMs }) {
  const result = await callMcpTool({
    serverUrl: alphaShopServerUrl(accessKey, secretKey),
    toolName: "imageSearchProduct",
    args: { imgUrl, beginPage, pageSize },
    timeoutMs,
  });
  const decoded = decodeToolResult(result);
  const products = findProductArray(decoded).map(normalizeAlphaShopProduct);
  return { rawResponse: decoded, products };
}

async function productDetailQuery({ accessKey, secretKey, productId, timeoutMs }) {
  const result = await callMcpTool({
    serverUrl: alphaShopServerUrl(accessKey, secretKey),
    toolName: "productDetailQuery",
    args: { productId: firstText(productId) },
    timeoutMs,
  });
  const decoded = decodeToolResult(result);
  return {
    rawResponse: decoded,
    detail: normalizeAlphaShopProductDetail(decoded, productId),
  };
}

module.exports = {
  imageSearchProduct,
  productDetailQuery,
  normalizeAlphaShopProductDetail,
  signAlphaShopToken,
};
