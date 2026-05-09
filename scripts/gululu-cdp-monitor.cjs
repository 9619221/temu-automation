#!/usr/bin/env node

/**
 * 监听 Chrome DevTools Protocol Network 事件，记录咕噜噜/Temu 相关接口。
 *
 * 用法：
 *   node scripts/gululu-cdp-monitor.cjs --port=9222
 *   node scripts/gululu-cdp-monitor.cjs --port=9222 --duration=120
 *   node scripts/gululu-cdp-monitor.cjs --port=9222 --only-gululu
 *
 * 前提：Chrome 必须以 --remote-debugging-port=<port> 启动。
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const DEFAULT_HOSTS = [
  "agentseller.temu.com",
  "agentseller-us.temu.com",
  "agentseller-eu.temu.com",
  "seller.kuajingmaihuo.com",
  "ads.temu.com",
  "lingge.gululu.store",
];

const DEFAULT_PROFILE_PREFERENCES = path.join(
  os.homedir(),
  "AppData",
  "Local",
  "Google",
  "Chrome",
  "User Data",
  "Default",
  "Preferences",
);

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "logs", "gululu-cdp-monitor");
const SENSITIVE_HEADER_PATTERN = /^(?:cookie|authorization|proxy-authorization|x-csrf-token|x-xsrf-token|set-cookie)$/i;

function parseArgs(argv) {
  const options = {
    host: "127.0.0.1",
    port: 9222,
    outDir: DEFAULT_OUTPUT_DIR,
    durationSeconds: 0,
    maxBodyChars: 300000,
    hosts: DEFAULT_HOSTS.slice(),
    includeHeaders: true,
    includeBody: true,
    onlyGululu: false,
    extensionId: "",
    extensionName: "咕噜噜",
    preferencesPath: DEFAULT_PROFILE_PREFERENCES,
    listOnly: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--list") options.listOnly = true;
    else if (arg === "--only-gululu") options.onlyGululu = true;
    else if (arg === "--no-headers") options.includeHeaders = false;
    else if (arg === "--no-body") options.includeBody = false;
    else if (arg.startsWith("--host=")) options.host = arg.slice("--host=".length);
    else if (arg.startsWith("--port=")) options.port = Number(arg.slice("--port=".length)) || options.port;
    else if (arg.startsWith("--out=")) options.outDir = path.resolve(arg.slice("--out=".length));
    else if (arg.startsWith("--duration=")) options.durationSeconds = Number(arg.slice("--duration=".length)) || 0;
    else if (arg.startsWith("--max-body-chars=")) options.maxBodyChars = Number(arg.slice("--max-body-chars=".length)) || options.maxBodyChars;
    else if (arg.startsWith("--hosts=")) {
      options.hosts = arg.slice("--hosts=".length).split(",").map((item) => item.trim()).filter(Boolean);
    } else if (arg.startsWith("--extension-id=")) options.extensionId = arg.slice("--extension-id=".length).trim();
    else if (arg.startsWith("--extension-name=")) options.extensionName = arg.slice("--extension-name=".length).trim();
    else if (arg.startsWith("--preferences=")) options.preferencesPath = path.resolve(arg.slice("--preferences=".length));
  }

  return options;
}

function printHelp() {
  console.log(`
咕噜噜 CDP 接口监听脚本

前提：
  Chrome 必须以 --remote-debugging-port 启动。

常用命令：
  node scripts/gululu-cdp-monitor.cjs --port=9222
  node scripts/gululu-cdp-monitor.cjs --port=9222 --duration=120
  node scripts/gululu-cdp-monitor.cjs --port=9222 --only-gululu
  node scripts/gululu-cdp-monitor.cjs --port=9222 --list

参数：
  --host=127.0.0.1              CDP host
  --port=9222                   CDP port
  --out=logs/gululu-cdp-monitor 输出目录
  --duration=120                监听秒数，0 表示一直运行
  --hosts=a.com,b.com           只记录这些 host 的请求
  --only-gululu                 只保留能匹配到咕噜噜扩展 ID 的请求
  --extension-id=xxxxx          手动指定咕噜噜扩展 ID
  --extension-name=咕噜噜       从 Chrome Preferences 自动查找扩展 ID 的名称关键词
  --preferences=...             Chrome Default/Preferences 路径
  --max-body-chars=300000       单个请求/响应体最多保存字符数
  --no-body                     不保存响应体/请求体，只保存摘要
  --no-headers                  不保存请求/响应头
  --list                        只列出当前 CDP targets 后退出
`);
}

function nowIso() {
  return new Date().toISOString();
}

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function sanitizeHeaders(headers, includeHeaders) {
  if (!includeHeaders || !headers || typeof headers !== "object") return undefined;
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = String(key || "").toLowerCase();
    if (!name || SENSITIVE_HEADER_PATTERN.test(name)) continue;
    const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
    if (!text || text.length > 2000) continue;
    result[name] = text;
  }
  return result;
}

function clipText(text, maxChars) {
  const value = String(text ?? "");
  if (value.length <= maxChars) return { text: value, clipped: false };
  return { text: value.slice(0, maxChars), clipped: true };
}

function decodeBase64Body(body) {
  try {
    return Buffer.from(String(body || ""), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function normalizeUrlHost(url) {
  try {
    return new URL(String(url || "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hostMatches(url, hosts) {
  const host = normalizeUrlHost(url);
  if (!host) return false;
  return hosts.some((item) => {
    const expected = String(item || "").toLowerCase();
    return host === expected || host.endsWith(`.${expected}`);
  });
}

function findGululuExtensionIdFromPreferences(preferencesPath, extensionName) {
  if (!preferencesPath || !fs.existsSync(preferencesPath)) return "";
  const data = safeJsonParse(fs.readFileSync(preferencesPath, "utf8"), {});
  const settings = data?.extensions?.settings || {};
  const keyword = String(extensionName || "").toLowerCase();
  for (const [extensionId, setting] of Object.entries(settings)) {
    const manifestName = String(setting?.manifest?.name || setting?.manifest?.short_name || "").toLowerCase();
    const pathText = String(setting?.path || "").toLowerCase();
    if ((keyword && manifestName.includes(keyword)) || manifestName.includes("gululu") || pathText.includes("咕噜噜") || pathText.includes("gululu")) {
      return extensionId;
    }
  }
  return "";
}

function collectStackUrls(initiator) {
  const urls = [];
  const walk = (stack) => {
    if (!stack) return;
    for (const frame of stack.callFrames || []) {
      if (frame?.url) urls.push(frame.url);
    }
    if (stack.parent) walk(stack.parent);
    if (Array.isArray(stack.parentId?.debuggerId)) walk(stack.parentId);
  };
  if (initiator?.url) urls.push(initiator.url);
  walk(initiator?.stack);
  return urls;
}

function gululuMatched({ targetInfo, request, response, extensionId }) {
  if (!extensionId) return false;
  const needle = `chrome-extension://${extensionId}/`;
  const texts = [
    targetInfo?.url,
    targetInfo?.title,
    request?.documentURL,
    request?.request?.url,
    response?.response?.url,
    ...collectStackUrls(request?.initiator),
  ].map((item) => String(item || ""));
  return texts.some((item) => item.startsWith(needle) || item.includes(needle));
}

async function fetchJson(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

class CdpConnection {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventHandlers = new Set();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      const timer = setTimeout(() => reject(new Error("CDP WebSocket 连接超时")), 10000);
      this.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.ws.addEventListener("error", (event) => {
        clearTimeout(timer);
        reject(new Error(event?.message || "CDP WebSocket 连接失败"));
      }, { once: true });
      this.ws.addEventListener("message", (event) => this.handleMessage(event.data));
      this.ws.addEventListener("close", () => {
        for (const { reject: rejectPending } of this.pending.values()) {
          rejectPending(new Error("CDP WebSocket 已关闭"));
        }
        this.pending.clear();
      });
    });
  }

  handleMessage(raw) {
    const message = safeJsonParse(raw, null);
    if (!message) return;
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result || {});
      return;
    }
    for (const handler of this.eventHandlers) {
      handler(message);
    }
  }

  onEvent(handler) {
    this.eventHandlers.add(handler);
  }

  send(method, params = {}, sessionId = undefined, timeoutMs = 10000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("CDP WebSocket 未连接"));
    }
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 命令超时: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
    this.ws.send(JSON.stringify(payload));
    return promise;
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }
}

function shouldAttachTarget(targetInfo) {
  const type = String(targetInfo?.type || "");
  return ["page", "service_worker", "shared_worker", "worker", "background_page", "webview", "iframe"].includes(type);
}

function summarizeTargets(targets) {
  return targets.map((target) => ({
    id: target.id,
    type: target.type,
    title: target.title,
    url: target.url,
    webSocketDebuggerUrl: Boolean(target.webSocketDebuggerUrl),
  }));
}

function targetInfoFromJsonTarget(target) {
  return {
    targetId: target.id,
    type: target.type,
    title: target.title,
    url: target.url,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  ensureDir(options.outDir);
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const eventsPath = path.join(options.outDir, `gululu-cdp-events-${runId}.jsonl`);
  const summaryPath = path.join(options.outDir, `gululu-cdp-summary-${runId}.json`);
  const eventsStream = fs.createWriteStream(eventsPath, { flags: "a", encoding: "utf8" });

  const cdpBase = `http://${options.host}:${options.port}`;
  let version;
  try {
    version = await fetchJson(`${cdpBase}/json/version`);
  } catch (error) {
    console.error(`无法连接 Chrome CDP: ${cdpBase}`);
    console.error(`原因: ${error?.message || error}`);
    console.error("");
    console.error("请用类似命令启动 Chrome：");
    console.error(`  chrome.exe --remote-debugging-port=${options.port} --user-data-dir="%LOCALAPPDATA%\\Google\\Chrome\\User Data"`);
    console.error("");
    console.error("如果当前 Chrome 不是用 remote-debugging-port 启动，Node 脚本无法强行接入。");
    process.exitCode = 1;
    return;
  }

  const targets = await fetchJson(`${cdpBase}/json/list`).catch(() => []);
  if (options.listOnly) {
    console.log(JSON.stringify({
      browser: version.Browser,
      webSocketDebuggerUrl: version.webSocketDebuggerUrl,
      targets: summarizeTargets(Array.isArray(targets) ? targets : []),
    }, null, 2));
    return;
  }

  const detectedExtensionId = options.extensionId || findGululuExtensionIdFromPreferences(options.preferencesPath, options.extensionName);
  if (detectedExtensionId) {
    console.error(`[gululu-cdp] 咕噜噜扩展 ID: ${detectedExtensionId}`);
  } else {
    console.error("[gululu-cdp] 未自动识别咕噜噜扩展 ID，将记录所有目标里的 Temu/咕噜噜域名请求。");
  }

  if (!version.webSocketDebuggerUrl) {
    throw new Error("CDP /json/version 没有 webSocketDebuggerUrl");
  }

  const cdp = new CdpConnection(version.webSocketDebuggerUrl);
  const sessions = new Map();
  const requests = new Map();
  const summary = {
    startedAt: nowIso(),
    finishedAt: null,
    cdpBase,
    eventsPath,
    detectedExtensionId,
    onlyGululu: options.onlyGululu,
    hosts: options.hosts,
    totalEvents: 0,
    matchedGululuEvents: 0,
    byHost: {},
    byPath: {},
    byTargetType: {},
    byStatus: {},
    errors: [],
  };

  function requestKey(sessionId, requestId) {
    return `${sessionId || "browser"}:${requestId}`;
  }

  function updateCount(map, key) {
    const text = String(key || "-");
    map[text] = Number(map[text] || 0) + 1;
  }

  async function writeEvent(sessionId, requestId, finishedPayload = {}) {
    const key = requestKey(sessionId, requestId);
    const record = requests.get(key);
    if (!record) return;
    requests.delete(key);

    const requestUrl = record.request?.request?.url || record.response?.response?.url || "";
    if (!hostMatches(requestUrl, options.hosts)) return;
    const matched = gululuMatched({
      targetInfo: record.targetInfo,
      request: record.request,
      response: record.response,
      extensionId: detectedExtensionId,
    });
    if (options.onlyGululu && !matched) return;

    let responseBody = null;
    let responseBodyError = "";
    if (options.includeBody && record.response) {
      try {
        const bodyResult = await cdp.send("Network.getResponseBody", { requestId }, sessionId, 5000);
        const rawBody = bodyResult.base64Encoded ? decodeBase64Body(bodyResult.body) : String(bodyResult.body || "");
        const clipped = clipText(rawBody, options.maxBodyChars);
        responseBody = {
          body: clipped.text,
          bodyHash: stableHash(rawBody),
          bodyLength: rawBody.length,
          base64Encoded: Boolean(bodyResult.base64Encoded),
          clipped: clipped.clipped,
          json: safeJsonParse(clipped.text, undefined),
        };
        if (responseBody.json === undefined) delete responseBody.json;
      } catch (error) {
        responseBodyError = error?.message || String(error);
      }
    }

    const rawPostData = record.request?.request?.postData || "";
    const clippedPostData = clipText(rawPostData, options.maxBodyChars);
    const parsed = new URL(requestUrl);
    const event = {
      capturedAt: nowIso(),
      requestId,
      sessionId,
      target: {
        targetId: record.targetInfo?.targetId,
        type: record.targetInfo?.type,
        title: record.targetInfo?.title,
        url: record.targetInfo?.url,
      },
      gululuMatched: matched,
      method: record.request?.request?.method || record.response?.response?.requestHeadersText || "",
      url: requestUrl,
      host: parsed.hostname,
      path: parsed.pathname,
      query: parsed.search || "",
      resourceType: record.request?.type || record.response?.type || "",
      initiator: {
        type: record.request?.initiator?.type || "",
        url: record.request?.initiator?.url || "",
        stackUrls: collectStackUrls(record.request?.initiator).slice(0, 20),
      },
      request: {
        headers: sanitizeHeaders(record.request?.request?.headers, options.includeHeaders),
        postData: options.includeBody ? clippedPostData.text : undefined,
        postDataHash: stableHash(rawPostData),
        postDataLength: rawPostData.length,
        postDataClipped: clippedPostData.clipped,
        hasPostData: Boolean(record.request?.request?.hasPostData || rawPostData),
      },
      response: record.response ? {
        status: record.response.response?.status,
        statusText: record.response.response?.statusText,
        mimeType: record.response.response?.mimeType,
        remoteIPAddress: record.response.response?.remoteIPAddress,
        remotePort: record.response.response?.remotePort,
        fromDiskCache: Boolean(record.response.response?.fromDiskCache),
        fromServiceWorker: Boolean(record.response.response?.fromServiceWorker),
        headers: sanitizeHeaders(record.response.response?.headers, options.includeHeaders),
        body: responseBody,
        bodyError: responseBodyError || undefined,
      } : null,
      timing: {
        wallTime: record.request?.wallTime,
        timestamp: record.request?.timestamp,
        encodedDataLength: finishedPayload.encodedDataLength,
      },
      error: finishedPayload.errorText || "",
    };
    if (!options.includeBody) {
      delete event.request.postData;
      if (event.response?.body) delete event.response.body.body;
    }

    eventsStream.write(`${JSON.stringify(event)}\n`);
    summary.totalEvents += 1;
    if (matched) summary.matchedGululuEvents += 1;
    updateCount(summary.byHost, event.host);
    updateCount(summary.byPath, `${event.method || "-"} ${event.path}`);
    updateCount(summary.byTargetType, event.target.type);
    updateCount(summary.byStatus, event.response?.status || event.error || "-");
    console.error(`[gululu-cdp] ${event.response?.status || event.error || "-"} ${event.method || ""} ${event.url}${matched ? " [gululu]" : ""}`);
  }

  cdp.onEvent((message) => {
    const method = message.method;
    const params = message.params || {};
    const sessionId = message.sessionId || params.sessionId;

    if (method === "Target.attachedToTarget") {
      const targetInfo = params.targetInfo || {};
      if (!shouldAttachTarget(targetInfo)) return;
      sessions.set(params.sessionId, targetInfo);
      cdp.send("Network.enable", {
        maxTotalBufferSize: 100000000,
        maxResourceBufferSize: 50000000,
        maxPostDataSize: Math.min(options.maxBodyChars, 1000000),
      }, params.sessionId).catch((error) => {
        summary.errors.push(`Network.enable ${targetInfo.type} ${targetInfo.url}: ${error?.message || error}`);
      });
      cdp.send("Runtime.enable", {}, params.sessionId).catch(() => {});
      return;
    }

    if (method === "Target.detachedFromTarget") {
      sessions.delete(params.sessionId);
      return;
    }

    if (!sessionId) return;
    const targetInfo = sessions.get(sessionId) || {};
    if (method === "Network.requestWillBeSent") {
      const key = requestKey(sessionId, params.requestId);
      const current = requests.get(key) || {};
      requests.set(key, {
        ...current,
        targetInfo,
        request: params,
      });
      return;
    }

    if (method === "Network.responseReceived") {
      const key = requestKey(sessionId, params.requestId);
      const current = requests.get(key) || {};
      requests.set(key, {
        ...current,
        targetInfo,
        response: params,
      });
      return;
    }

    if (method === "Network.loadingFinished") {
      writeEvent(sessionId, params.requestId, params).catch((error) => {
        summary.errors.push(`writeEvent loadingFinished ${params.requestId}: ${error?.message || error}`);
      });
      return;
    }

    if (method === "Network.loadingFailed") {
      writeEvent(sessionId, params.requestId, params).catch((error) => {
        summary.errors.push(`writeEvent loadingFailed ${params.requestId}: ${error?.message || error}`);
      });
    }
  });

  await cdp.connect();
  await cdp.send("Target.setDiscoverTargets", { discover: true });
  await cdp.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
    filter: [
      { type: "page", exclude: false },
      { type: "service_worker", exclude: false },
      { type: "shared_worker", exclude: false },
      { type: "worker", exclude: false },
      { type: "background_page", exclude: false },
      { type: "iframe", exclude: false },
    ],
  });
  for (const target of Array.isArray(targets) ? targets : []) {
    const targetInfo = targetInfoFromJsonTarget(target);
    if (!shouldAttachTarget(targetInfo)) continue;
    cdp.send("Target.attachToTarget", { targetId: targetInfo.targetId, flatten: true }).catch(() => {});
  }

  console.error(`[gululu-cdp] 已连接 ${cdpBase}`);
  console.error(`[gululu-cdp] 事件输出: ${eventsPath}`);
  console.error(`[gululu-cdp] 汇总输出: ${summaryPath}`);
  if (options.durationSeconds > 0) {
    console.error(`[gululu-cdp] 将监听 ${options.durationSeconds} 秒`);
  } else {
    console.error("[gululu-cdp] 正在持续监听，按 Ctrl+C 停止");
  }

  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    summary.finishedAt = nowIso();
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
    eventsStream.end();
    cdp.close();
    console.error(`[gululu-cdp] 已停止，共记录 ${summary.totalEvents} 条，咕噜噜匹配 ${summary.matchedGululuEvents} 条`);
    console.error(`[gululu-cdp] 汇总: ${summaryPath}`);
  }

  process.on("SIGINT", () => {
    stop().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    stop().finally(() => process.exit(0));
  });

  if (options.durationSeconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, options.durationSeconds * 1000));
    await stop();
  } else {
    await new Promise(() => {});
  }
}

main().catch((error) => {
  console.error(`[gululu-cdp] 失败: ${error?.stack || error?.message || error}`);
  process.exitCode = 1;
});
