// 云启搜索代理：Playwright 保持浏览器 session，接收 HTTP 搜索请求用 page.evaluate(fetch) 执行。
// 用法：node --experimental-sqlite scripts/yunqi-search-proxy.mjs
// 监听 127.0.0.1:19281  POST /search {keyword,from,size,sort,ware_house_type,...}
import { chromium } from "playwright";
import fs from "fs";
import http from "http";

const CRED_FILE = process.env.YQ_CRED_FILE || "/opt/temu-erp-data/yunqi-cred.json";
const LOGIN_URL = "https://www.yunqishuju.com/login";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const PORT = Number(process.env.YQ_PROXY_PORT) || 19281;
const log = (...a) => console.log(new Date().toISOString(), "[yunqi-proxy]", ...a);

let _browser = null;
let _page = null;
let _ready = false;
let _lastUsed = Date.now();

function readCred() {
  if (process.env.YQ_ACCOUNT && process.env.YQ_PASSWORD) return { account: process.env.YQ_ACCOUNT, password: process.env.YQ_PASSWORD };
  const j = JSON.parse(fs.readFileSync(CRED_FILE, "utf8"));
  if (!j.account || !j.password) throw new Error("凭据文件缺 account/password");
  return { account: j.account, password: j.password };
}

async function login(page, account, password) {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3500);
  await page.evaluate(async ({ account, password }) => {
    const s = (ms) => new Promise((r) => setTimeout(r, ms));
    await s(800);
    const tips1 = document.querySelector(".tips");
    if (tips1 && tips1.textContent.trim().includes("验证码登录")) { tips1.click(); await s(1500); }
    for (const tab of document.querySelectorAll(".tabItem")) { if (tab.textContent.trim() === "密码") { tab.click(); await s(1000); break; } }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const phone = document.querySelector('input[placeholder="请输入手机号码"]');
    phone.focus(); setter.call(phone, account); phone.dispatchEvent(new Event("input", { bubbles: true })); phone.dispatchEvent(new Event("change", { bubbles: true }));
    await s(500);
    const pwd = document.querySelector('input[placeholder="请输入登录密码"]');
    pwd.focus(); setter.call(pwd, password); pwd.dispatchEvent(new Event("input", { bubbles: true })); pwd.dispatchEvent(new Event("change", { bubbles: true }));
    await s(500);
    const btn = document.querySelector("button.sgin") || [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "登录" && b.offsetParent);
    btn.click();
  }, { account, password });
  await page.waitForTimeout(6000);
  const ok = await page.evaluate(() => {
    const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
    const cookie = document.cookie || ""; let token = ""; const m = cookie.match(/(?:^|;\s*)token=([^;]+)/); if (m) token = m[1];
    if (!token) for (const [k, v] of Object.entries(ls)) { if (/token|auth/i.test(k) && String(v).includes("eyJ")) { token = String(v).replace(/^"|"$/g, ""); break; } }
    return !!token;
  });
  if (!ok) throw new Error("登录失败：未拿到 token");
}

let _loginPromise = null;
async function ensureBrowser() {
  if (_ready && _page) {
    _lastUsed = Date.now();
    return _page;
  }
  // 并发锁：多个请求同时到达时只登录一次
  if (_loginPromise) return _loginPromise;
  _loginPromise = _doEnsureBrowser();
  try { return await _loginPromise; } finally { _loginPromise = null; }
}
async function _doEnsureBrowser() {
  log("启动浏览器...");
  if (_browser) try { await _browser.close(); } catch {}
  _browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  const ctx = await _browser.newContext({ userAgent: UA, locale: "zh-CN", viewport: { width: 1440, height: 900 } });
  _page = await ctx.newPage();
  const { account, password } = readCred();
  log("登录中...");
  await login(_page, account, password);
  log("登录成功");
  // 完全复制 yunqi-cloud-fetch.mjs 的流程：先导航到选品页 + 等 8s + 读 categories（触发页面 JS 初始化 session）
  await _page.goto("https://www.yunqishuju.com/temu/home", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await _page.waitForTimeout(8000);

  // 必须：读 Vue categories 组件（与原脚本完全一致，触发 session 初始化）
  try {
    await _page.evaluate(async () => {
      const findOpts = () => {
        for (const el of document.querySelectorAll("body *")) {
          const v = el.__vue__; if (!v) continue;
          if (v.$options && v.$options.name === "ElCascader") { const o = v.options || (v.$props && v.$props.options); if (Array.isArray(o) && o.length) return o; }
        }
        return null;
      };
      let opts = findOpts();
      for (let i = 0; i < 24 && !opts; i++) { await new Promise((r) => setTimeout(r, 500)); opts = findOpts(); }
      return (opts || []).length;
    });
    log("页面 categories 已加载");
  } catch { log("categories 加载跳过"); }

  // 先标记就绪（API 需要短暂 warm-up，首次搜索可能空但后续正常）
  _ready = true;
  // 异步探针：延迟 20s 再验证，不阻塞服务启动
  setTimeout(async () => {
    try {
      const probe = await _page.evaluate(async () => {
        const cookie = document.cookie || ""; let token = ""; const m = cookie.match(/(?:^|;\s*)token=([^;]+)/); if (m) token = m[1];
        if (!token) { const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); } for (const [k, v] of Object.entries(ls)) { if (/token|auth/i.test(k) && String(v).includes("eyJ")) { token = String(v).replace(/^"|"$/g, ""); break; } } }
        const body = { from: 0, size: 5, sort: [{ daily_sales: "desc" }], ware_house_type: 0, regions: [], region: 0, ids: [], mall_ids: [], opt_ids: [], tags: [], brands: [], with_mall: true, sold_out: null };
        const res = await fetch("/api/proxytemu/good/search", { method: "POST", headers: { "Content-Type": "application/json;charset=UTF-8", "Authorization": "Bearer " + token }, body: JSON.stringify(body) });
        const json = await res.json();
        return { code: json?.code, items: (json?.data?.data || []).length, total: json?.data?.total };
      });
      log(`搜索探针(延迟): code=${probe.code} items=${probe.items} total=${probe.total}`);
      if (!probe.items) log("⚠ 探针无数据，API 可能仍在 warm-up，实际请求可正常返回");
    } catch (e) { log("探针异常:", e.message); }
  }, 20000);
  _lastUsed = Date.now();
  return _page;
}

async function doSearchOnce(page, params) {
  return page.evaluate(async (p) => {
    const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
    const cookie = document.cookie || ""; let token = ""; const m = cookie.match(/(?:^|;\s*)token=([^;]+)/); if (m) token = m[1];
    if (!token) for (const [k, v] of Object.entries(ls)) { if (/token|auth/i.test(k) && String(v).includes("eyJ")) { token = String(v).replace(/^"|"$/g, ""); break; } }
    const body = {
      from: p.from || 0, size: p.size || 48,
      sort: p.sort || [{ daily_sales: "desc" }],
      ware_house_type: p.ware_house_type ?? 0,
      regions: [], region: 0, ids: [], mall_ids: [], opt_ids: p.opt_ids || [], tags: [], brands: [],
      with_mall: true, sold_out: null,
    };
    if (p.keyword) body.title = p.keyword;
    const res = await fetch("/api/proxytemu/good/search", {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", "Authorization": "Bearer " + token },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return { code: json?.code, message: json?.message, total: json?.data?.total || 0, items: json?.data?.data || [] };
  }, params);
}

async function doSearch(params) {
  const page = await ensureBrowser();
  let result = await doSearchOnce(page, params);

  // code=1 或 401 = session 过期，自动重连一次
  if (result.code !== 0 && (result.code === 1 || result.code === 401 || (result.message || "").includes("登录"))) {
    log("搜索返回 code=" + result.code + "，自动重连...");
    _ready = false;
    const newPage = await ensureBrowser();
    result = await doSearchOnce(newPage, params);
  }

  if (result.code !== 0) {
    throw new Error(`API error: code=${result.code} msg=${result.message || ""}`);
  }
  return result;
}

// HTTP 服务
const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ready: _ready, lastUsed: _lastUsed }));
    return;
  }
  if (req.method === "POST" && req.url === "/search") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      try {
        const params = JSON.parse(Buffer.concat(chunks).toString());
        const result = await doSearch(params);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (e) {
        const code = e.message.includes("过期") ? 401 : 500;
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: -1, message: e.message, items: [], total: 0 }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/relogin") {
    _ready = false;
    try {
      await ensureBrowser();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }
  res.writeHead(404); res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  log(`搜索代理监听 127.0.0.1:${PORT}`);
  ensureBrowser().catch((e) => log("首次登录失败:", e.message));
});

// 闲置 30 分钟自动关闭浏览器节省内存（下次请求自动重启）
setInterval(() => {
  if (_ready && Date.now() - _lastUsed > 30 * 60 * 1000) {
    log("闲置 30 分钟，关闭浏览器");
    _ready = false;
    if (_browser) _browser.close().catch(() => {});
    _browser = null; _page = null;
  }
}, 60000);

process.on("SIGTERM", async () => { log("收到 SIGTERM"); if (_browser) await _browser.close().catch(() => {}); process.exit(0); });
process.on("SIGINT", async () => { log("收到 SIGINT"); if (_browser) await _browser.close().catch(() => {}); process.exit(0); });
