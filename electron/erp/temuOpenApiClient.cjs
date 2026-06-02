/**
 * Temu 开放平台官方 API 调用封装（CommonJS，服务端/主控端用）。
 *
 * 与 automation/temu-open-api.mjs 同源（桌面 worker 用 ESM 版），此处为 ERP 服务端
 * （ipc.cjs / lanServer.cjs 走 CJS）提供同样的签名 + 调用能力，外加绑定店铺用的 token 校验。
 *
 * 签名规则：外层参数按 key ASCII 升序，拼 key+value，前后再拼 app_secret，MD5 32 位大写。
 * 网关：见 DEFAULT_GATEWAYS；app_key/secret/access_token/接口地址必须同区。
 */
"use strict";

const crypto = require("node:crypto");

const DEFAULT_GATEWAYS = {
  CN: "https://openapi.kuajingmaihuo.com/openapi/router",
  PA: "https://openapi-b-partner.temu.com/openapi/router",
  US: "https://openapi-b-us.temu.com/openapi/router",
  EU: "https://openapi-b-eu.temu.com/openapi/router",
  GLOBAL: "https://openapi-b-global.temu.com/openapi/router",
};

// 本 ERP 自己的三方应用「云舵AI」（CN 区，已上线）的 App Key/Secret。
// 三方应用的 app_key/app_secret 全商家共用，商家只需各自授权后提供 access_token。
//
// App Key 是应用标识（卖家侧可见、低敏感），保留内置默认值，环境变量可覆盖。
// App Secret 参与签名、属敏感凭证，**只从环境变量 TEMU_OPENAPI_APP_SECRET 读取，
// 源码不内置真实值**（避免落进 git）。生产服务器 temu-erp.service 须配置该环境变量，
// 本地开发同样需在启动前 export；未配置时绑定接口会因缺 secret 直接报错。
const DEFAULT_APP_KEY = process.env.TEMU_OPENAPI_APP_KEY || "10342bb30388adfe9926322a38ab350e";
const DEFAULT_APP_SECRET = process.env.TEMU_OPENAPI_APP_SECRET || "";

/**
 * 解析要用的应用凭证：默认用本 ERP 三方应用的 App Key/Secret，
 * 仅当显式传入（自研应用场景）时才覆盖。
 * @param {{appKey?:string, appSecret?:string}} [override]
 * @returns {{appKey:string, appSecret:string}}
 */
function resolveTemuAppCredentials(override = {}) {
  return {
    appKey: (override && override.appKey) || DEFAULT_APP_KEY,
    appSecret: (override && override.appSecret) || DEFAULT_APP_SECRET,
  };
}

/**
 * 按 Temu 签名规则计算 sign（外层升序拼接，前后夹 app_secret，MD5 大写）。
 * @param {object} params 公共参数 + 业务参数（不含 sign）
 * @param {string} appSecret
 * @returns {string} 32 位大写 MD5
 */
function signOpenApi(params, appSecret) {
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
 * @param {object} opts { type, appKey, appSecret, accessToken, bizParams?, region?, gatewayUrl?, version?, timeoutMs? }
 * @returns {Promise<{ok:boolean, status:number, response:object}>}
 */
async function callOpenApi(opts) {
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
  } = opts || {};

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
    return { ok: resp.ok, status: resp.status, response: json };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 校验一组凭证是否有效，并返回店铺归属信息。绑定店铺前调用，确保 token 真实可用、
 * 并以官方返回的 mallId 为准（防止把 token 绑错店）。
 *
 * 用 bg.open.accesstoken.info.get(.global) 拿 mallId / 过期时间 / 接口权限；
 * 再尽力用 bg.mall.info.get 拿店铺类型（全托/半托），失败不致命。
 *
 * @param {object} creds { appKey, appSecret, accessToken, region }
 * @returns {Promise<{ok:boolean, mallId?:string, expiredTime?:number, apiScopeList?:string[], semiManaged?:boolean|null, isThriftStore?:boolean|null, errorCode?:number, error?:string}>}
 */
async function validateTemuOpenApiToken(creds) {
  const { appKey, appSecret, accessToken, region = "CN" } = creds || {};
  const tokenType = region === "CN"
    ? "bg.open.accesstoken.info.get"
    : "bg.open.accesstoken.info.get.global";

  let tokenResp;
  try {
    tokenResp = await callOpenApi({ type: tokenType, appKey, appSecret, accessToken, region, bizParams: {} });
  } catch (error) {
    return { ok: false, error: `调用授权信息接口失败：${error?.message || String(error)}` };
  }
  const body = tokenResp.response || {};
  if (!body.success) {
    return {
      ok: false,
      errorCode: body.errorCode,
      error: body.errorMsg || `授权校验失败（errorCode=${body.errorCode || "未知"}）`,
    };
  }
  const result = body.result || {};
  const mallId = result.mallId != null ? String(result.mallId) : "";

  // 店铺类型：尽力而为，CN 区可用 bg.mall.info.get，其它区可能无此 type，失败忽略。
  let semiManaged = null;
  let isThriftStore = null;
  try {
    const mallResp = await callOpenApi({ type: "bg.mall.info.get", appKey, appSecret, accessToken, region, bizParams: {} });
    const mallBody = mallResp.response || {};
    if (mallBody.success && mallBody.result) {
      semiManaged = Boolean(mallBody.result.semiManagedMall);
      isThriftStore = Boolean(mallBody.result.isThriftStore);
    }
  } catch {
    // 忽略：店铺类型只是附加信息
  }

  return {
    ok: true,
    mallId,
    expiredTime: result.expiredTime != null ? Number(result.expiredTime) : null,
    apiScopeList: Array.isArray(result.apiScopeList) ? result.apiScopeList : [],
    semiManaged,
    isThriftStore,
  };
}

module.exports = {
  TEMU_OPENAPI_GATEWAYS: DEFAULT_GATEWAYS,
  resolveTemuAppCredentials,
  signOpenApi,
  callOpenApi,
  validateTemuOpenApiToken,
};
