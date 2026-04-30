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
  const productUrl = firstText(
    item.productUrl,
    item.detailUrl,
    item.offerUrl,
    item.url,
    productId ? `https://detail.1688.com/offer/${productId}.html` : null,
  );
  return {
    externalOfferId: productId,
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

async function imageSearchProduct({ accessKey, secretKey, imgUrl, beginPage = 1, pageSize = 10, timeoutMs }) {
  const token = signAlphaShopToken(accessKey, secretKey);
  const serverUrl = `${MCP_SERVER_BASE}?key=${encodeURIComponent(token)}`;
  const result = await callMcpTool({
    serverUrl,
    toolName: "imageSearchProduct",
    args: { imgUrl, beginPage, pageSize },
    timeoutMs,
  });
  const decoded = decodeToolResult(result);
  const products = findProductArray(decoded).map(normalizeAlphaShopProduct);
  return { rawResponse: decoded, products };
}

module.exports = {
  imageSearchProduct,
  signAlphaShopToken,
};
