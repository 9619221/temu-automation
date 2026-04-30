const crypto = require("crypto");

const H5_API_HOST = "https://h5api.m.1688.com";
const SEARCH_API_HOST = "https://search.1688.com";
const MTOP_APP_KEY = "12574478";
const MTOP_VERSION = "1.0";
const MTOP_JSV = "2.7.2";
const IMAGE_UPLOAD_API = "mtop.1688.imageService.putImage";
const TOKEN_API = "mtop.ovs.traffic.landing.seotaglist.queryHotSearchWord";
const IMAGE_UPLOAD_APP_NAME = "searchImageUpload";
const IMAGE_UPLOAD_APP_KEY = "pvvljh1grxcmaay2vgpe9nb68gg9ueg2";

function optionalString(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return text || "";
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
      const nested = firstNumber(
        value.price,
        value.value,
        value.amount,
        value.integer !== undefined ? `${value.integer}.${value.decimals || 0}` : null,
        value.minPrice,
        value.min,
      );
      if (nested !== null) return nested;
      continue;
    }
    const number = Number(String(value).replace(/[^\d.-]/g, ""));
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normalizeImageUrl(value) {
  const text = optionalString(value);
  if (!text) return null;
  if (text.startsWith("//")) return `https:${text}`;
  return text;
}

function normalizeWebOffer(offer = {}) {
  const company = offer.company || {};
  const information = offer.information || {};
  const image = offer.image || {};
  const tradeQuantity = offer.tradeQuantity || {};
  const tradePrice = offer.tradePrice || {};
  const offerPrice = tradePrice.offerPrice || {};
  const priceInfo = offerPrice.priceInfo || {};
  const originalValue = offerPrice.originalValue || {};
  const firstQuantityPrice = Array.isArray(offerPrice.quantityPrices)
    ? offerPrice.quantityPrices[0]
    : null;

  const offerId = firstPresent(offer.id, offer.offerId, offer.offer_id, offer.productId);
  const productUrl = firstPresent(
    offer.productUrl,
    offer.offerUrl,
    offer.detailUrl,
    offerId ? `https://detail.1688.com/offer/${offerId}.html` : null,
  );
  const unitPrice = firstNumber(
    offer.price,
    priceInfo.price,
    priceInfo.promotionPrice,
    firstQuantityPrice?.value,
    firstQuantityPrice?.price,
    originalValue.integer !== undefined ? `${originalValue.integer}.${originalValue.decimals || 0}` : null,
  ) ?? 0;
  const moq = Math.max(1, Math.floor(firstNumber(
    offer.moq,
    tradeQuantity.quantityBegin,
    tradeQuantity.minOrderQuantity,
    tradeQuantity.startQuantity,
    information.minOrderQuantity,
  ) ?? 1));

  return {
    externalOfferId: offerId ? String(offerId) : null,
    externalSkuId: null,
    externalSpecId: null,
    supplierName: String(firstPresent(
      offer.supplierName,
      company.name,
      company.companyName,
      offer.aliTalk?.loginId,
      "1688 Supplier",
    ) || "1688 Supplier"),
    productTitle: firstPresent(
      offer.productTitle,
      offer.subject,
      information.subject,
      information.title,
      information.subjectTrans,
    ),
    productUrl: productUrl ? String(productUrl) : null,
    imageUrl: normalizeImageUrl(firstPresent(
      offer.imageUrl,
      offer.image_url,
      image.imgUrl,
      image.imageUrl,
      image.url,
      Array.isArray(offer.imageUrls) ? offer.imageUrls[0] : null,
    )),
    unitPrice,
    moq,
    leadDays: firstNumber(offer.leadDays, offer.deliveryDays, offer.shipInDays),
    logisticsFee: firstNumber(offer.logisticsFee, offer.freight, offer.shippingFee) ?? 0,
    remark: null,
    raw: offer,
  };
}

function createCookieJar() {
  const jar = {
    cna: `erp${Date.now()}${crypto.randomBytes(4).toString("hex")}`,
  };
  return {
    get(name) {
      return jar[name] || "";
    },
    set(name, value) {
      if (name && value !== undefined) jar[name] = value;
    },
    header() {
      return Object.entries(jar)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    },
  };
}

function mergeSetCookies(cookieJar, headers) {
  const rawSetCookies = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [];
  const fallback = rawSetCookies.length
    ? rawSetCookies
    : String(headers.get("set-cookie") || "").split(/,(?=[^;]+?=)/);
  for (const item of fallback) {
    const match = String(item || "").match(/^\s*([^=;]+)=([^;]*)/);
    if (match) cookieJar.set(match[1], match[2]);
  }
}

function parseJsonPayload(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {}
  const jsonpMatch = trimmed.match(/^[\w$]+\((.*)\)\s*;?$/s);
  if (jsonpMatch) return JSON.parse(jsonpMatch[1]);
  throw new Error(`1688 web response is not JSON: ${trimmed.slice(0, 160)}`);
}

async function fetchWithCookies(fetchImpl, cookieJar, url, options = {}, timeoutMs = 30000) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
      ...(options.headers || {}),
    };
    const cookieHeader = cookieJar.header();
    if (cookieHeader) headers.Cookie = cookieHeader;
    const response = await fetchImpl(url, {
      ...options,
      headers,
      signal: controller?.signal,
    });
    mergeSetCookies(cookieJar, response.headers);
    return response;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function warmCnaCookie(fetchImpl, cookieJar, timeoutMs) {
  try {
    const url = `https://log.mmstat.com/eg.js?t=${Date.now()}`;
    await fetchWithCookies(
      fetchImpl,
      cookieJar,
      url,
      { headers: { Referer: "https://www.1688.com/" } },
      Math.min(timeoutMs, 8000),
    );
  } catch {
    // The mtop token endpoint still issues a token when a cna-like cookie is present.
  }
}

async function acquireMtopToken(fetchImpl, cookieJar, timeoutMs) {
  const url = new URL(`${H5_API_HOST}/h5/${TOKEN_API.toLowerCase()}/${MTOP_VERSION}/`);
  url.search = new URLSearchParams({
    jsv: MTOP_JSV,
    appKey: MTOP_APP_KEY,
    t: String(Date.now()),
    api: TOKEN_API,
    v: MTOP_VERSION,
    type: "jsonp",
    dataType: "jsonp",
    callback: "mtopjsonp1",
    preventFallback: "true",
    data: "{}",
  }).toString();
  const response = await fetchWithCookies(
    fetchImpl,
    cookieJar,
    url,
    {
      headers: {
        Origin: "https://www.1688.com",
        Referer: "https://www.1688.com/",
      },
    },
    timeoutMs,
  );
  await response.text();
  const token = optionalString(cookieJar.get("_m_h5_tk")).split("_")[0];
  if (!token) throw new Error("1688 web image search token is missing");
  return token;
}

async function uploadImage(fetchImpl, cookieJar, token, imageBuffer, timeoutMs) {
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length) {
    throw new Error("1688 web image search image is empty");
  }
  const dataString = JSON.stringify({
    imageBase64: imageBuffer.toString("base64"),
    appName: IMAGE_UPLOAD_APP_NAME,
    appKey: IMAGE_UPLOAD_APP_KEY,
  });
  const timestamp = String(Date.now());
  const sign = crypto
    .createHash("md5")
    .update(`${token}&${timestamp}&${MTOP_APP_KEY}&${dataString}`)
    .digest("hex");
  const url = new URL(`${H5_API_HOST}/h5/${IMAGE_UPLOAD_API.toLowerCase()}/${MTOP_VERSION}/`);
  url.search = new URLSearchParams({
    jsv: MTOP_JSV,
    appKey: MTOP_APP_KEY,
    t: timestamp,
    sign,
    api: IMAGE_UPLOAD_API,
    ignoreLogin: "true",
    prefix: "h5api",
    v: MTOP_VERSION,
    ecode: "0",
    dataType: "jsonp",
    jsonpIncPrefix: "search1688",
    timeout: "20000",
    type: "originaljson",
  }).toString();
  const response = await fetchWithCookies(
    fetchImpl,
    cookieJar,
    url,
    {
      method: "POST",
      headers: {
        Origin: "https://www.1688.com",
        Referer: "https://www.1688.com/",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: new URLSearchParams({ data: dataString }).toString(),
    },
    timeoutMs,
  );
  const payload = parseJsonPayload(await response.text());
  const imageId = optionalString(payload?.data?.imageId);
  if (!response.ok || !imageId) {
    const ret = Array.isArray(payload?.ret) ? payload.ret.join("; ") : "";
    throw new Error(ret || `1688 web image upload failed with HTTP ${response.status}`);
  }
  return {
    imageId,
    requestId: optionalString(payload?.data?.requestId),
    sessionId: optionalString(payload?.data?.sessionId),
    rawResponse: payload,
  };
}

function findOfferList(payload = {}) {
  const candidates = [
    payload?.data?.data?.offerList,
    payload?.data?.offerList,
    payload?.offerList,
    payload?.result?.offerList,
  ];
  for (const value of candidates) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

async function searchOffers(fetchImpl, cookieJar, upload, beginPage, pageSize, timeoutMs) {
  const url = new URL(`${SEARCH_API_HOST}/service/imageSearchOfferResultViewService`);
  url.search = new URLSearchParams({
    tab: "imageSearch",
    imageAddress: "",
    imageId: upload.imageId,
    imageIdList: upload.imageId,
    beginPage: String(beginPage),
    pageSize: String(pageSize),
    pageName: "image",
    sessionId: upload.sessionId || "",
  }).toString();
  const response = await fetchWithCookies(
    fetchImpl,
    cookieJar,
    url,
    {
      headers: {
        Origin: "https://s.1688.com",
        Referer: "https://s.1688.com/",
      },
    },
    timeoutMs,
  );
  const payload = parseJsonPayload(await response.text());
  if (!response.ok) throw new Error(`1688 web image search failed with HTTP ${response.status}`);
  const offerList = findOfferList(payload);
  return {
    rawResponse: payload,
    offerList,
    products: offerList.map(normalizeWebOffer),
  };
}

async function imageSearch1688Web({
  imageBuffer,
  beginPage = 1,
  pageSize = 10,
  fetchImpl = fetch,
  timeoutMs = 60000,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Current runtime does not provide fetch");
  }
  const cookieJar = createCookieJar();
  await warmCnaCookie(fetchImpl, cookieJar, timeoutMs);
  const token = await acquireMtopToken(fetchImpl, cookieJar, timeoutMs);
  const upload = await uploadImage(fetchImpl, cookieJar, token, imageBuffer, timeoutMs);
  const search = await searchOffers(fetchImpl, cookieJar, upload, beginPage, pageSize, timeoutMs);
  return {
    imageId: upload.imageId,
    requestId: upload.requestId,
    sessionId: upload.sessionId,
    products: search.products,
    rawResponse: {
      upload: upload.rawResponse,
      search: search.rawResponse,
    },
  };
}

module.exports = {
  imageSearch1688Web,
  normalizeWebOffer,
};
