const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");

const CONFIG_FILE_NAME = "erp-runtime.json";
const DEFAULT_PORT = 19380;
const SESSION_COOKIE_NAME = "temu_erp_lan_session";
const REMOTE_SESSION_EXPIRED_MESSAGE = "Cloud login expired, please reconnect.";

let userDataDir = null;

function configureClientRuntime(options = {}) {
  userDataDir = options.userDataDir || userDataDir || null;
}

function getConfigPath() {
  if (!userDataDir) {
    throw new Error("ERP runtime config path is not ready");
  }
  return path.join(userDataDir, CONFIG_FILE_NAME);
}

function normalizeMode(value) {
  if (value === "client") return "client";
  if (value === "host") return "host";
  return "unset";
}

function normalizeServerUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(withProtocol);
  if (!url.port) url.port = String(DEFAULT_PORT);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeConfig(config = {}) {
  return {
    mode: normalizeMode(config.mode),
    serverUrl: normalizeServerUrl(config.serverUrl),
    sessionCookie: String(config.sessionCookie || ""),
    currentUser: config.currentUser || null,
    updatedAt: config.updatedAt || null,
  };
}

function readRuntimeConfig() {
  if (!userDataDir) return normalizeConfig();
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return normalizeConfig();
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
  } catch {
    return normalizeConfig();
  }
}

function writeRuntimeConfig(nextConfig = {}) {
  const config = normalizeConfig({
    ...readRuntimeConfig(),
    ...nextConfig,
    updatedAt: new Date().toISOString(),
  });
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf8");
  return config;
}

function clearClientSession() {
  return writeRuntimeConfig({
    sessionCookie: "",
    currentUser: null,
  });
}

function getRuntimeStatus(extra = {}) {
  const config = readRuntimeConfig();
  return {
    mode: config.mode,
    isClientMode: config.mode === "client",
    serverUrl: config.serverUrl,
    currentUser: config.currentUser,
    connected: Boolean(config.serverUrl && config.sessionCookie && config.currentUser),
    updatedAt: config.updatedAt,
    ...extra,
  };
}

function isClientMode() {
  return readRuntimeConfig().mode === "client";
}

function setHostMode() {
  return writeRuntimeConfig({
    mode: "host",
    serverUrl: "",
    sessionCookie: "",
    currentUser: null,
  });
}

function setClientMode(payload = {}) {
  const serverUrl = normalizeServerUrl(payload.serverUrl);
  if (!serverUrl) throw new Error("serverUrl is required");
  return writeRuntimeConfig({
    mode: "client",
    serverUrl,
    sessionCookie: payload.sessionCookie || "",
    currentUser: payload.currentUser || null,
  });
}

function parseSetCookie(setCookieHeaders) {
  const headers = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : (setCookieHeaders ? [setCookieHeaders] : []);
  for (const header of headers) {
    const firstPart = String(header || "").split(";")[0];
    if (firstPart.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      return firstPart;
    }
  }
  return "";
}

function requestJson(serverUrl, requestPath, options = {}) {
  const url = new URL(requestPath, `${normalizeServerUrl(serverUrl)}/`);
  const body = options.body === undefined ? null : JSON.stringify(options.body || {});
  const transport = url.protocol === "https:" ? https : http;
  const headers = {
    Accept: "application/json",
    "User-Agent": "temu-erp-electron-client",
    ...(options.headers || {}),
  };
  if (body !== null) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    headers["Content-Length"] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: options.method || (body === null ? "GET" : "POST"),
      timeout: Number(options.timeoutMs) || 8000,
      headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = { ok: false, error: text || `HTTP ${res.statusCode}` };
        }

        const cookie = parseSetCookie(res.headers["set-cookie"]);
        if (res.statusCode < 200 || res.statusCode >= 300 || payload?.ok === false) {
          const error = new Error(payload?.error || `HTTP ${res.statusCode}`);
          error.statusCode = res.statusCode;
          error.payload = payload;
          error.sessionCookie = cookie;
          reject(error);
          return;
        }
        resolve({
          payload,
          sessionCookie: cookie,
          statusCode: res.statusCode,
        });
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("连接主控端超时"));
    });
    req.on("error", reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

async function remoteRequest(requestPath, options = {}) {
  const config = readRuntimeConfig();
  if (config.mode !== "client") throw new Error("当前不是客户端模式");
  if (!config.serverUrl) throw new Error("尚未配置主控端地址");
  const headers = {};
  if (config.sessionCookie) headers.Cookie = config.sessionCookie;
  let result = null;
  try {
    result = await requestJson(config.serverUrl, requestPath, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    if (error?.statusCode === 401) {
      clearClientSession();
      const nextError = new Error(REMOTE_SESSION_EXPIRED_MESSAGE);
      nextError.statusCode = 401;
      nextError.payload = error.payload;
      throw nextError;
    }
    throw error;
  }
  if (result.sessionCookie) {
    writeRuntimeConfig({ sessionCookie: result.sessionCookie });
  }
  return result.payload;
}

async function remoteLogin(payload = {}) {
  const serverUrl = normalizeServerUrl(payload.serverUrl || readRuntimeConfig().serverUrl);
  if (!serverUrl) throw new Error("请先选择或填写主控端地址");
  const result = await requestJson(serverUrl, "/api/login", {
    method: "POST",
    body: {
      login: payload.login,
      accessCode: payload.accessCode,
    },
  });
  const user = result.payload?.user || null;
  if (!user) throw new Error("主控端未返回登录用户");
  writeRuntimeConfig({
    mode: "client",
    serverUrl,
    sessionCookie: result.sessionCookie || "",
    currentUser: user,
  });
  return {
    hasUsers: true,
    currentUser: user,
  };
}

async function remoteLogout() {
  const config = readRuntimeConfig();
  if (config.mode === "client" && config.serverUrl && config.sessionCookie) {
    try {
      await requestJson(config.serverUrl, "/logout", {
        method: "GET",
        headers: { Cookie: config.sessionCookie },
        timeoutMs: 3000,
      });
    } catch {}
  }
  writeRuntimeConfig({
    sessionCookie: "",
    currentUser: null,
  });
  return {
    hasUsers: true,
    currentUser: null,
  };
}

async function remoteAuthStatus() {
  const config = readRuntimeConfig();
  if (config.mode !== "client") {
    return {
      hasUsers: true,
      currentUser: null,
    };
  }
  if (!config.serverUrl || !config.sessionCookie) {
    return {
      hasUsers: true,
      currentUser: null,
    };
  }
  try {
    const status = await remoteRequest("/api/status");
    const user = status?.user || null;
    if (!user) {
      clearClientSession();
      return {
        hasUsers: true,
        currentUser: null,
      };
    }
    writeRuntimeConfig({ currentUser: user });
    return {
      hasUsers: true,
      currentUser: user,
    };
  } catch {
    clearClientSession();
    return {
      hasUsers: true,
      currentUser: null,
    };
  }
}

function getPrivateSubnetPrefixes() {
  const prefixes = new Set();
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (!entry || entry.family !== "IPv4" || entry.internal) continue;
      const parts = String(entry.address || "").split(".");
      if (parts.length !== 4) continue;
      prefixes.add(parts.slice(0, 3).join("."));
    }
  }
  return Array.from(prefixes);
}

async function probeController(serverUrl, timeoutMs) {
  try {
    const result = await requestJson(serverUrl, "/health", {
      method: "GET",
      timeoutMs,
    });
    if (result.payload?.service !== "temu-erp-lan") return null;
    return {
      url: normalizeServerUrl(serverUrl),
      service: result.payload.service,
      name: result.payload.name || null,
      startedAt: result.payload.startedAt || null,
    };
  } catch {
    return null;
  }
}

async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const result = await worker(items[index]);
      if (result) results.push(result);
    }
  });
  await Promise.all(workers);
  return results;
}

async function discoverControllers(params = {}) {
  const port = Number(params.port) || DEFAULT_PORT;
  const timeoutMs = Number(params.timeoutMs) || 700;
  const candidates = new Set([
    `http://127.0.0.1:${port}`,
  ]);
  for (const prefix of getPrivateSubnetPrefixes()) {
    for (let host = 1; host <= 254; host += 1) {
      candidates.add(`http://${prefix}.${host}:${port}`);
    }
  }

  const found = await runWithConcurrency(Array.from(candidates), Number(params.concurrency) || 64, (url) => (
    probeController(url, timeoutMs)
  ));
  const unique = new Map();
  for (const item of found) unique.set(item.url, item);
  return Array.from(unique.values()).sort((left, right) => left.url.localeCompare(right.url));
}

module.exports = {
  configureClientRuntime,
  discoverControllers,
  getRuntimeStatus,
  isClientMode,
  normalizeServerUrl,
  remoteAuthStatus,
  remoteLogin,
  remoteLogout,
  remoteRequest,
  setClientMode,
  setHostMode,
};
