const crypto = require("crypto");

const DEFAULT_LEGACY_BASE_URL = "https://open.erp321.com/api/open/query.aspx";
const DEFAULT_SANDBOX_BASE_URL = "https://c.jushuitan.com/api/open/query.aspx";

function md5Lower(value) {
  return crypto.createHash("md5").update(String(value), "utf8").digest("hex").toLowerCase();
}

function optionalString(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function normalizeBaseUrl(value, environment = "production") {
  const raw = optionalString(value);
  if (raw) return raw;
  return environment === "sandbox" ? DEFAULT_SANDBOX_BASE_URL : DEFAULT_LEGACY_BASE_URL;
}

function createLegacySign({ method, partnerId, partnerKey, token, ts }) {
  const source = `${method}${partnerId}token${token}ts${ts}${partnerKey}`;
  return md5Lower(source);
}

async function resolveFetch(fetchImpl) {
  if (typeof fetchImpl === "function") return fetchImpl;
  if (typeof fetch === "function") return fetch;
  const mod = await import("undici");
  return mod.fetch;
}

function parseJsonMaybe(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function looksLikeFailure(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.issuccess === false || payload.success === false || payload.ok === false) return true;
  const code = payload.code ?? payload.error_code ?? payload.errcode;
  if (code === undefined || code === null || code === "") return false;
  return !["0", "200", 0, 200].includes(code);
}

function extractErrorMessage(payload, statusCode) {
  if (payload && typeof payload === "object") {
    return optionalString(
      payload.msg
      || payload.message
      || payload.error
      || payload.error_msg
      || payload.errmsg,
    ) || `Jushuitan API failed with HTTP ${statusCode}`;
  }
  return `Jushuitan API failed with HTTP ${statusCode}`;
}

class JushuitanClient {
  constructor(options = {}) {
    this.authMode = options.authMode || "legacy";
    this.environment = options.environment || "production";
    this.baseUrl = normalizeBaseUrl(options.baseUrl, this.environment);
    this.partnerId = optionalString(options.partnerId || options.partner_id);
    this.partnerKey = optionalString(options.partnerKey || options.partner_key);
    this.token = optionalString(options.token);
    this.timeoutMs = Number(options.timeoutMs) || 30000;
    this.fetchImpl = options.fetchImpl || null;
  }

  assertLegacyCredentials() {
    if (!this.partnerId || !this.partnerKey || !this.token) {
      throw new Error("Jushuitan partnerId, partnerKey and token are required");
    }
  }

  buildLegacyUrl(method, ts = Math.floor(Date.now() / 1000)) {
    this.assertLegacyCredentials();
    const url = new URL(this.baseUrl);
    url.searchParams.set("method", method);
    url.searchParams.set("partnerid", this.partnerId);
    url.searchParams.set("token", this.token);
    url.searchParams.set("ts", String(ts));
    url.searchParams.set("sign", createLegacySign({
      method,
      partnerId: this.partnerId,
      partnerKey: this.partnerKey,
      token: this.token,
      ts,
    }));
    return url;
  }

  async request(method, body = {}, options = {}) {
    if (this.authMode !== "legacy") {
      throw new Error(`Unsupported Jushuitan auth mode: ${this.authMode}`);
    }
    const ts = Number(options.ts) || Math.floor(Date.now() / 1000);
    const url = this.buildLegacyUrl(method, ts);
    const fetcher = await resolveFetch(options.fetchImpl || this.fetchImpl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs) || this.timeoutMs);
    try {
      const response = await fetcher(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json",
          "User-Agent": "temu-erp-jushuitan-sync",
        },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = parseJsonMaybe(text);
      if (!response.ok || looksLikeFailure(payload)) {
        const error = new Error(extractErrorMessage(payload, response.status));
        error.statusCode = response.status;
        error.payload = payload;
        error.method = method;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error(`Jushuitan API timeout after ${Number(options.timeoutMs) || this.timeoutMs}ms`);
        timeoutError.code = "JST_TIMEOUT";
        timeoutError.method = method;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = {
  DEFAULT_LEGACY_BASE_URL,
  DEFAULT_SANDBOX_BASE_URL,
  JushuitanClient,
  createLegacySign,
  md5Lower,
};
