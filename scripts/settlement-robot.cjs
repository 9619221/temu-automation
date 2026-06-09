#!/usr/bin/env node
/**
 * 结算数据 RPA 机器人
 *
 * 连接运营正在使用的 Chrome 浏览器（通过 CDP 远程调试端口），
 * 复用已有 session，定时采集全部店铺的三类结算数据
 * （收入 income-summary / 明细三态 wait·in·settled / 对账中心费用明细 fund-detail），
 * 直接 POST 到 cloud ingest API，ERP 端自动解析入库。
 *
 * ========== 运行方式 ==========
 *
 * 第一步：带调试端口启动 Chrome（只需做一次）
 *   node scripts/settlement-robot.cjs --launch-chrome
 *   （会关闭当前 Chrome 并重新启动，加 --remote-debugging-port=9222）
 *
 * 第二步：运行机器人
 *   node scripts/settlement-robot.cjs --once          # 单次采集
 *   node scripts/settlement-robot.cjs                 # 持续运行，每4小时采集
 *
 * 环境变量（也可写入 .settlement-robot.env）：
 *   CLOUD_ENDPOINT   云端地址（默认 https://erp.temu.chat）
 *   AUTH_TOKEN        云端 JWT token
 *   DEVICE_ID         设备标识（默认 settlement-robot）
 *   INTERVAL_HOURS    采集间隔小时（默认 4）
 *   CDP_PORT          Chrome 调试端口（默认 9222）
 */

"use strict";

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
const { execSync, spawn } = require("child_process");

// ============================================================
// 路径 & 配置
// ============================================================
const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".settlement-robot.env");
const LOG_DIR = path.join(ROOT, "logs");

function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const line of fs.readFileSync(ENV_FILE, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnvFile();

const CLOUD_ENDPOINT = process.env.CLOUD_ENDPOINT || "https://erp.temu.chat";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const DEVICE_ID = process.env.DEVICE_ID || "settlement-robot";
const INTERVAL_HOURS = Number(process.env.INTERVAL_HOURS) || 4;
const CDP_PORT = Number(process.env.CDP_PORT) || 9222;
const ONCE = process.argv.includes("--once");
const LAUNCH_CHROME = process.argv.includes("--launch-chrome");

const AGENTSELLER_ORIGIN = "https://agentseller.temu.com";
const INCOME_SUMMARY_PATH = "/api/merchant/front/finance/income-summary";

// Chrome 可执行路径
const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
];

// ============================================================
// 36 店 mall 列表
// ============================================================
const ALL_MALLS = [
  { mall_id: "634418224981125", store_code: "028" },
  { mall_id: "634418224983097", store_code: "029" },
  { mall_id: "634418224983548", store_code: "030" },
  { mall_id: "634418225054807", store_code: "031" },
  { mall_id: "634418225055378", store_code: "032" },
  { mall_id: "634418225083598", store_code: "035" },
  { mall_id: "634418225372884", store_code: "037" },
  { mall_id: "634418225373734", store_code: "038" },
  { mall_id: "634418225440775", store_code: "040" },
  { mall_id: "634418225514990", store_code: "042" },
  { mall_id: "634418226016579", store_code: "044" },
  { mall_id: "634418226017029", store_code: "045" },
  { mall_id: "634418226016823", store_code: "046" },
  { mall_id: "634418226025690", store_code: "047" },
  { mall_id: "634418226026279", store_code: "048" },
  { mall_id: "634418226026528", store_code: "049" },
  { mall_id: "634418226026966", store_code: "050" },
  { mall_id: "634418226026828", store_code: "051" },
  { mall_id: "634418226026300", store_code: "052" },
  { mall_id: "634418226025563", store_code: "053" },
  { mall_id: "634418226041962", store_code: "054" },
  { mall_id: "634418226219194", store_code: "062" },
  { mall_id: "634418226785687", store_code: "063" },
  { mall_id: "634418225172002", store_code: "065" },
  { mall_id: "634418225262106", store_code: "066" },
  { mall_id: "634418225262761", store_code: "067" },
  { mall_id: "634418225265035", store_code: "068" },
  { mall_id: "634418227770668", store_code: "069" },
  { mall_id: "634418227770734", store_code: "070" },
  { mall_id: "634418227770823", store_code: "071" },
  { mall_id: "634418227770845", store_code: "072" },
  { mall_id: "634418227772475", store_code: "073" },
  { mall_id: "634418228924499", store_code: "074" },
  { mall_id: "634418229097960", store_code: "075" },
  { mall_id: "634418227640222", store_code: "076" },
  { mall_id: "634418230546312", store_code: "077" },
];

// ============================================================
// 日志
// ============================================================
let logStream = null;
function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  logStream = fs.createWriteStream(path.join(LOG_DIR, "settlement-robot.log"), { flags: "a" });
}
function log(msg) {
  const ts = new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (logStream) logStream.write(line + "\n");
}

// ============================================================
// HTTP
// ============================================================
function httpGet(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.get(u, { timeout }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function httpPost(url, body, headers = {}, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, timeout }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

// ============================================================
// CDP 探测
// ============================================================
async function probeCDP() {
  try {
    const resp = await httpGet(`http://127.0.0.1:${CDP_PORT}/json/version`, 3000);
    if (resp.status === 200) return JSON.parse(resp.body);
  } catch { /* no CDP */ }
  return null;
}

// ============================================================
// --launch-chrome：重启 Chrome 带调试端口
// ============================================================
function findChromeExe() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function launchChromeWithDebugPort() {
  const chromeExe = findChromeExe();
  if (!chromeExe) {
    log("找不到 Chrome，请确认已安装 Google Chrome");
    process.exit(1);
  }

  // 先检测是否已有调试端口
  const existing = await probeCDP();
  if (existing) {
    log(`Chrome 调试端口 ${CDP_PORT} 已开启，无需重启`);
    log(`  浏览器: ${existing["Browser"] || "unknown"}`);
    return;
  }

  // 杀掉当前 Chrome（会恢复所有标签页）
  log("关闭当前 Chrome ...");
  try {
    execSync("taskkill /F /IM chrome.exe", { stdio: "ignore", timeout: 10000 });
  } catch { /* 可能没有在运行 */ }

  // 等 Chrome 进程完全退出
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const out = execSync("tasklist /FI \"IMAGENAME eq chrome.exe\" /NH", { encoding: "utf-8", timeout: 5000 });
      if (!out.includes("chrome.exe")) break;
    } catch { break; }
  }

  // 重新启动 Chrome，带调试端口 + 恢复标签页
  log(`启动 Chrome (调试端口 ${CDP_PORT}) ...`);
  const child = spawn(chromeExe, [
    `--remote-debugging-port=${CDP_PORT}`,
    "--restore-last-session",
  ], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // 等待调试端口就绪
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const info = await probeCDP();
    if (info) {
      log(`Chrome 已就绪: ${info["Browser"] || "unknown"}`);
      log(`调试端口: http://127.0.0.1:${CDP_PORT}`);
      return;
    }
  }
  log("Chrome 启动超时，请手动检查");
  process.exit(1);
}

// ============================================================
// 通过 CDP 连接 Chrome，获取可用的 agentseller page
// ============================================================
async function connectAndGetPage() {
  const cdpInfo = await probeCDP();
  if (!cdpInfo) {
    log(`Chrome 调试端口 ${CDP_PORT} 未开启`);
    log("请先运行: node scripts/settlement-robot.cjs --launch-chrome");
    process.exit(1);
  }
  log(`连接 Chrome CDP (${cdpInfo["Browser"] || "unknown"}) ...`);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const contexts = browser.contexts();
  if (!contexts.length) {
    log("没有可用的浏览器上下文");
    process.exit(1);
  }

  // 在默认 context 中找 agentseller tab
  const ctx = contexts[0];
  const pages = ctx.pages();
  let agentPage = pages.find((p) => p.url().includes("agentseller.temu.com"));

  if (agentPage) {
    log(`复用已有 agentseller tab: ${agentPage.url().slice(0, 60)}...`);
  } else {
    // 没有 agentseller tab，创建一个新的
    log("没有找到 agentseller tab，创建新标签页 ...");
    agentPage = await ctx.newPage();
    await agentPage.goto(AGENTSELLER_ORIGIN, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));
  }

  return { browser, page: agentPage };
}

// ============================================================
// Session 检测（CDP 模式不需要等待登录，只报告状态）
// ============================================================
async function checkSession(page) {
  try {
    const result = await page.evaluate(async (apiUrl) => {
      try {
        const resp = await fetch(apiUrl, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const data = await resp.json();
        return { ok: resp.ok, error_code: data?.error_code, error_msg: data?.error_msg };
      } catch (e) {
        return { ok: false, err: e.message };
      }
    }, `${AGENTSELLER_ORIGIN}${INCOME_SUMMARY_PATH}`);

    if (result.error_code === 40001 || result.error_code === "40001") {
      return { valid: false, reason: "session 过期 (40001)" };
    }
    if (!result.ok) {
      return { valid: false, reason: `HTTP 异常: ${result.error_code || result.err || "unknown"}` };
    }
    return { valid: true };
  } catch (e) {
    return { valid: false, reason: e.message };
  }
}

// ============================================================
// Cloud 上报
// ============================================================
async function postBatchToCloud(items) {
  if (!items.length) return { ok: true, sent: 0 };
  const resp = await httpPost(
    `${CLOUD_ENDPOINT}/api/ingest/v1/batch`,
    JSON.stringify({ items }),
    { Authorization: `Bearer ${AUTH_TOKEN}`, "X-Device-Id": DEVICE_ID }
  );
  return { ok: resp.status >= 200 && resp.status < 300, status: resp.status };
}

// ============================================================
// 采集核心：三类结算数据（收入 / 明细三态 / 费用明细），均同 agentseller 域
// 接口、body、解析路径与扩展 sw.js 一致，落 cloud.capture_events 后由 ERP 端
// syncSettlementIncomeFromCapture / syncSettlementDetailFromCapture /
// syncFundDetailFromCapture 自动物化入库。
// ============================================================

// 结算明细三态接口
const SETTLEMENT_DETAIL_ENDPOINTS = [
  { path: "/api/merchant/settle/detail/full/wait-settlement", status: "wait" },
  { path: "/api/merchant/settle/detail/full/in-settlement", status: "in" },
  { path: "/api/merchant/settle/detail/full/settled", status: "settled" },
];
// 对账中心账务明细接口（翻页）
const FUND_DETAIL_PATH = "/api/merchant/fund/detail/pageSearch";
const FUND_DETAIL_PAGE_SIZE = 50;
const FUND_DETAIL_MAX_PAGES = 20;
const FUND_DETAIL_PAGE_DELAY = 600;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function parseJsonSafe(t) { try { return JSON.parse(t); } catch { return null; } }
function isSessionExpired(body) { return body?.error_code === 40001 || body?.error_code === "40001"; }
function last30Range() {
  const ymd = (d) => d.toISOString().slice(0, 10);
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86400000);
  return { startDate: ymd(start), endDate: ymd(end) };
}

// 在页面上下文里对某店发一个 POST（带 mallid 头，复用浏览器登录态 cookie）
async function fetchInPage(page, url, mallId, bodyText) {
  return page.evaluate(
    async ({ apiUrl, mid, reqBody }) => {
      try {
        const resp = await fetch(apiUrl, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json", mallid: mid },
          body: reqBody,
        });
        const text = await resp.text();
        return { status: resp.status, text, ok: resp.ok };
      } catch (e) {
        return { status: 0, text: "", ok: false, err: e.message };
      }
    },
    { apiUrl: url, mid: mallId, reqBody: bodyText }
  );
}

// ---- 1) 结算收入概览（income-summary）----
async function collectIncomeSummary(page, batchItems) {
  const stats = { success: 0, error: 0, expired: 0 };
  const url = `${AGENTSELLER_ORIGIN}${INCOME_SUMMARY_PATH}`;
  for (const mall of ALL_MALLS) {
    const { mall_id: mallId, store_code: tag } = mall;
    try {
      const r = await fetchInPage(page, url, mallId, "{}");
      const body = parseJsonSafe(r.text);
      if (isSessionExpired(body)) { stats.expired++; log(`  [收入 ${tag}] session 过期，中止本类`); return stats; }
      const list = Array.isArray(body?.result) ? body.result : [];
      if (r.ok && list.length > 0) {
        batchItems.push({
          kind: "fetch-active-income-summary",
          url, url_path: INCOME_SUMMARY_PATH, method: "POST", status: r.status,
          ts: Date.now(), site: "agentseller", page: "robot/income-summary",
          mall_id: mallId, body, bodyText: r.text.length > 200000 ? null : r.text,
          requestBodyText: "{}", bodySize: r.text.length, activeSource: "settlement_robot",
        });
        stats.success++;
      } else {
        stats.error++;
      }
    } catch (e) {
      stats.error++;
      log(`  [收入 ${tag}] 异常: ${e.message}`);
    }
    await sleep(500);
  }
  return stats;
}

// ---- 2) 结算明细三态（wait / in / settled）----
async function collectSettlementDetail(page, batchItems) {
  const stats = { success: 0, error: 0, expired: 0 };
  const range = last30Range();
  for (const mall of ALL_MALLS) {
    const { mall_id: mallId, store_code: tag } = mall;
    for (const ep of SETTLEMENT_DETAIL_ENDPOINTS) {
      const url = `${AGENTSELLER_ORIGIN}${ep.path}`;
      // settled 端点必须带 startDate/endDate，否则报参数错；其余空 body
      const reqBodyText = ep.status === "settled" ? JSON.stringify(range) : "{}";
      try {
        const r = await fetchInPage(page, url, mallId, reqBodyText);
        const body = parseJsonSafe(r.text);
        if (isSessionExpired(body)) { stats.expired++; log(`  [明细 ${tag}/${ep.status}] session 过期，中止本类`); return stats; }
        if (r.ok && body && typeof body === "object") {
          batchItems.push({
            kind: "fetch-active-settlement",
            url, url_path: ep.path, method: "POST", status: r.status,
            ts: Date.now(), site: "agentseller", page: "robot/settlement-detail",
            mall_id: mallId, body, bodyText: r.text.length > 200000 ? null : r.text,
            requestBodyText: reqBodyText, bodySize: r.text.length, activeSource: "settlement_robot",
          });
          stats.success++;
        } else {
          stats.error++;
        }
      } catch (e) {
        stats.error++;
        log(`  [明细 ${tag}/${ep.status}] 异常: ${e.message}`);
      }
      await sleep(500);
    }
  }
  return stats;
}

// ---- 3) 对账中心账务明细（fund detail，翻页）----
async function collectFundDetail(page, batchItems) {
  const stats = { success: 0, error: 0, expired: 0 };
  const range = last30Range();
  const url = `${AGENTSELLER_ORIGIN}${FUND_DETAIL_PATH}`;
  for (const mall of ALL_MALLS) {
    const { mall_id: mallId, store_code: tag } = mall;
    let total = null;
    for (let pageNo = 1; pageNo <= FUND_DETAIL_MAX_PAGES; pageNo++) {
      const reqBodyText = JSON.stringify({ pageNo, pageSize: FUND_DETAIL_PAGE_SIZE, ...range });
      let listLen = 0;
      try {
        const r = await fetchInPage(page, url, mallId, reqBodyText);
        const body = parseJsonSafe(r.text);
        if (isSessionExpired(body)) { stats.expired++; log(`  [费用 ${tag}] session 过期，中止本类`); return stats; }
        if (r.ok && body && typeof body === "object" && body.success !== false) {
          batchItems.push({
            kind: "fetch-active-fund-detail",
            url, url_path: FUND_DETAIL_PATH, method: "POST", status: r.status,
            ts: Date.now(), site: "agentseller", page: "robot/fund-detail",
            mall_id: mallId, body, bodyText: r.text.length > 200000 ? null : r.text,
            requestBodyText: reqBodyText, bodySize: r.text.length, activeSource: "settlement_robot",
          });
          stats.success++;
          const result = body.result || {};
          if (total == null && Number.isFinite(Number(result.total))) total = Number(result.total);
          listLen = Array.isArray(result.resultList) ? result.resultList.length : 0;
        } else {
          stats.error++;
        }
      } catch (e) {
        stats.error++;
        log(`  [费用 ${tag} p${pageNo}] 异常: ${e.message}`);
      }
      await sleep(FUND_DETAIL_PAGE_DELAY);
      if (listLen < FUND_DETAIL_PAGE_SIZE) break;       // 不足一页 = 最后一页
      if (total != null && pageNo * FUND_DETAIL_PAGE_SIZE >= total) break;
    }
  }
  return stats;
}

// 上报 cloud（分块）
async function uploadBatch(batchItems) {
  if (!batchItems.length) { log("  无数据可上报"); return; }
  if (!AUTH_TOKEN) { log("  (未配置 AUTH_TOKEN，跳过上报)"); return; }
  const CHUNK = 30;
  let uploaded = 0;
  for (let i = 0; i < batchItems.length; i += CHUNK) {
    try {
      const resp = await postBatchToCloud(batchItems.slice(i, i + CHUNK));
      if (resp.ok) uploaded += Math.min(CHUNK, batchItems.length - i);
      else log(`  上报失败 HTTP ${resp.status}`);
    } catch (e) {
      log(`  上报异常: ${e.message}`);
    }
  }
  log(`  上报 cloud: ${uploaded}/${batchItems.length} 条`);
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  ensureLogDir();

  // --launch-chrome 模式：重启 Chrome 带调试端口
  if (LAUNCH_CHROME) {
    await launchChromeWithDebugPort();
    log("Chrome 已就绪。现在可以运行机器人:");
    log("  node scripts/settlement-robot.cjs --once");
    return;
  }

  if (!AUTH_TOKEN) {
    log("未配置 AUTH_TOKEN，数据不会上报 cloud");
    log("(token 已在 .settlement-robot.env 中配置过则忽略此提示)");
  }

  log("=".repeat(60));
  log("结算 RPA 机器人启动");
  log(`  店铺: ${ALL_MALLS.length} | 间隔: ${ONCE ? "单次" : INTERVAL_HOURS + "h"} | Cloud: ${CLOUD_ENDPOINT}`);
  log("=".repeat(60));

  // 连接 Chrome CDP
  const { browser, page } = await connectAndGetPage();

  // 检查 session
  const session = await checkSession(page);
  if (!session.valid) {
    log(`Session 无效: ${session.reason}`);
    log("请在 Chrome 中登录 agentseller.temu.com，然后重新运行机器人");
    await browser.close();
    process.exit(1);
  }
  log("Session 有效，开始采集");

  // 采集：三类依次跑，统一上报
  const runCycle = async () => {
    const start = Date.now();
    log(`开始采集 (${ALL_MALLS.length} 店 × 三类：收入 / 明细三态 / 费用明细) ...`);
    const batchItems = [];

    const inc = await collectIncomeSummary(page, batchItems);
    log(`  收入: 成功=${inc.success} 失败=${inc.error}${inc.expired ? ` 过期=${inc.expired}` : ""}`);
    const det = await collectSettlementDetail(page, batchItems);
    log(`  明细: 成功=${det.success} 失败=${det.error}${det.expired ? ` 过期=${det.expired}` : ""}`);
    const fund = await collectFundDetail(page, batchItems);
    log(`  费用: 成功=${fund.success} 失败=${fund.error}${fund.expired ? ` 过期=${fund.expired}` : ""}`);

    await uploadBatch(batchItems);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const expired = inc.expired + det.expired + fund.expired;
    log(`采集完成 (${elapsed}s): 共上报 ${batchItems.length} 条${expired ? `，有 session 过期` : ""}`);
    if (expired > 0) {
      log("Session 已过期。请在 Chrome 中刷新 agentseller 登录后，机器人下次循环会自动重试。");
    }
    return { count: batchItems.length, expired };
  };

  await runCycle();

  if (ONCE) {
    log("单次模式，退出");
    await browser.close();
    process.exit(0);
  }

  // 持续循环
  const intervalMs = INTERVAL_HOURS * 3600 * 1000;
  log(`下次采集: ${new Date(Date.now() + intervalMs).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}`);

  setInterval(async () => {
    try {
      // 每次循环重新检查 session
      const s = await checkSession(page);
      if (!s.valid) {
        log(`跳过本轮: ${s.reason}`);
        return;
      }
      await runCycle();
      log(`下次采集: ${new Date(Date.now() + intervalMs).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}`);
    } catch (e) {
      log(`本轮异常: ${e.message}`);
    }
  }, intervalMs);

  process.on("SIGINT", async () => { log("关闭"); await browser.close(); process.exit(0); });
  process.on("SIGTERM", async () => { log("关闭"); await browser.close(); process.exit(0); });
}

main().catch((e) => {
  console.error(`[致命错误] ${e.message}`);
  process.exit(1);
});
