/**
 * Temu 开放平台官方 API 调用封装
 *
 * 文档：https://agentpartner.temu.com/document?cataId=875196199516
 *
 * 调用流程：
 *   1. 拼请求体（公共参数 + 业务参数）
 *   2. 按签名规则计算 sign：外层 key ASCII 升序排序，拼 key+value，前后再拼 app_secret，MD5 大写
 *   3. 把 sign 加入请求体
 *   4. POST 到 /openapi/router
 */

import crypto from "node:crypto";

const DEFAULT_GATEWAYS = {
  CN: "https://openapi.kuajingmaihuo.com/openapi/router",
  PA: "https://openapi-b-partner.temu.com/openapi/router",
  US: "https://openapi-b-us.temu.com/openapi/router",
  EU: "https://openapi-b-eu.temu.com/openapi/router",
  GLOBAL: "https://openapi-b-global.temu.com/openapi/router",
};

/**
 * 按 Temu 签名规则计算 sign。
 *
 * 规则：
 *   1. 外层参数按 key ASCII 升序（内层 JSON 不排序）
 *   2. 拼接 key1value1key2value2...，前后再拼 app_secret
 *   3. MD5 加密 32 位大写
 *
 * @param {object} params 包含公共参数和业务参数的对象（不含 sign）
 * @param {string} appSecret
 * @returns {string} 32 位大写 MD5
 */
export function signOpenApi(params, appSecret) {
  if (!appSecret) throw new Error("signOpenApi: missing appSecret");
  const keys = Object.keys(params).filter((k) => k !== "sign").sort();
  let raw = appSecret;
  for (const k of keys) {
    const v = params[k];
    if (v === undefined || v === null) continue;
    const valStr = typeof v === "string" ? v : JSON.stringify(v);
    raw += k + valStr;
  }
  raw += appSecret;
  return crypto.createHash("md5").update(raw, "utf8").digest("hex").toUpperCase();
}

/**
 * 通用调用 Temu 开放平台接口。
 *
 * @param {object} opts
 * @param {string} opts.type            API 接口名，如 "bg.mall.info.get"
 * @param {string} opts.appKey
 * @param {string} opts.appSecret
 * @param {string} opts.accessToken
 * @param {object} [opts.bizParams]     业务参数对象
 * @param {string} [opts.region="CN"]   分区：CN / PA / US / EU / GLOBAL
 * @param {string} [opts.gatewayUrl]    自定义网关 URL（覆盖 region）
 * @param {string} [opts.version="V1"]  API 版本
 * @param {number} [opts.timeoutMs=30000]
 * @returns {Promise<{ok: boolean, status: number, response: object, signedParams: object}>}
 */
export async function callOpenApi(opts) {
  const {
    type,
    appKey,
    appSecret,
    accessToken,
    bizParams = {},
    region = "CN",
    gatewayUrl,
    version = "V1",
    timeoutMs = 30000,
  } = opts;

  if (!type) throw new Error("callOpenApi: missing type");
  if (!appKey) throw new Error("callOpenApi: missing appKey");
  if (!appSecret) throw new Error("callOpenApi: missing appSecret");
  if (!accessToken) throw new Error("callOpenApi: missing accessToken");

  const url = gatewayUrl || DEFAULT_GATEWAYS[region];
  if (!url) throw new Error(`callOpenApi: unknown region ${region}`);

  const params = {
    type,
    app_key: appKey,
    timestamp: String(Math.floor(Date.now() / 1000)),
    data_type: "JSON",
    access_token: accessToken,
    version,
    ...bizParams,
  };
  params.sign = signOpenApi(params, appSecret);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { _raw: text }; }
    return { ok: resp.ok, status: resp.status, response: json, signedParams: params };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * bg.mall.info.get — 查询当前 token 对应店铺类型信息。
 * 用作签名 + 鉴权的最小验证接口。
 */
export async function bgMallInfoGet(creds) {
  return await callOpenApi({ ...creds, type: "bg.mall.info.get", bizParams: {} });
}

/**
 * bg.goods.edit.pictures.submit (CN) / bg.glo.goods.edit.pictures.submit (PA)
 *  — 修改商品素材（替换图片/视频/楼层装饰）。
 *
 * @param {object} creds            { appKey, appSecret, accessToken, region? }
 * @param {object} bizParams        见文档 docId=899314893477
 */
export async function bgGoodsEditPicturesSubmit(creds, bizParams) {
  const apiType = (creds.region || "CN") === "PA"
    ? "bg.glo.goods.edit.pictures.submit"
    : "bg.goods.edit.pictures.submit";
  return await callOpenApi({ ...creds, type: apiType, bizParams });
}

/**
 * bg.goods.detail.get (CN) / bg.glo.goods.detail.get (PA)
 *  — 查询商品详情，拿 productSkcList + productSkuList 结构。
 */
export async function bgGoodsDetailGet(creds, productId) {
  const apiType = (creds.region || "CN") === "PA"
    ? "bg.glo.goods.detail.get"
    : "bg.goods.detail.get";
  return await callOpenApi({
    ...creds,
    type: apiType,
    bizParams: { productId: Number(productId) },
  });
}

/**
 * 高层封装：换图整链路。
 *
 * 实测结论（沙箱账号 girl clothes + bg.glo.goods.edit.pictures.submit）：
 *   - 顶层 productId 是必填（官方文档漏写）
 *   - 不需要 detail.get 先拿 SKC（接口能自己解析）
 *   - 不需要 skcList（非服饰场景）
 *   - 只要传 productId + materialImgUrl + carouselImageUrls 即可
 *   - 图片必须 .jpg/.jpeg/.png 真实 URL（占位 URL 后端会校验扩展名失败 992000021）
 *
 * @param {object} creds   { appKey, appSecret, accessToken, region }
 * @param {string|number} productId
 * @param {string[]} newImageUrls  新轮播图 URL 数组（5-10 张，kwcdn 域名）
 * @param {object} [extra]         附加字段（skcList / videoReqList / 楼层装饰等）
 * @returns {Promise<{success, errorCode, errorMsg, result, payload}>}
 */
export async function swapProductImagesViaOpenApi(creds, productId, newImageUrls, extra = {}) {
  const urls = Array.isArray(newImageUrls) ? newImageUrls.filter(Boolean) : [];
  if (urls.length < 5 || urls.length > 10) {
    return { success: false, errorMsg: `轮播图必须 5-10 张，实际 ${urls.length}` };
  }
  const bizParams = {
    productId: Number(productId),
    materialImgUrl: urls[0],
    carouselImageUrls: urls,
    ...extra, // 允许调用方塞 skcList / productCarouseVideoReqList / goodsLayerDecorationReqs / carouselImageI18nReqs / materialMultiLanguages
  };
  const editResp = await bgGoodsEditPicturesSubmit(creds, bizParams);
  return {
    success: !!editResp.response?.success,
    errorCode: editResp.response?.errorCode,
    errorMsg: editResp.response?.errorMsg,
    result: editResp.response?.result,
    payload: editResp.signedParams,
  };
}

// 测试账号常量（来自官方文档"基本信息"页公开测试账号）
// 仅用于开发期验证，正式商家授权后用真实 access_token
export const SANDBOX_ACCOUNT_FULL_1 = {
  appKey: "47bb4bb7769e12d9f7aa93cf029fe529",
  appSecret: "ac0a3e952eaaa5b19c0e615c2ef497f50afa6e49",
  accessToken: "vmw8chdzvvk2e4y2wjniiq9zzppptozcibhw6tg2ptslbtkcuotgxcyx",
  region: "CN",
  storeId: "1052202882",
  storeName: "girl clothes",
};
