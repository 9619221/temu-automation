// 服务器云启抓取服务：playwright 无头登录云启 + 分页抓取 + 存云端库。
// 用法（服务器）：
//   YQ_MAX_PAGES=5 node scripts/yunqi-cloud-fetch.mjs            # 抓全托管+半托管通用feed(日销倒序)
//   YQ_KEYWORDS="手机壳,宠物玩具" node scripts/yunqi-cloud-fetch.mjs  # 按关键词抓
// 账密读自 /opt/temu-erp-data/yunqi-cred.json（{account,password}），不在脚本/命令里明文。
import { chromium } from "playwright";
import fs from "fs";

// 云端库路径：让 yunqi-db.mjs 落到数据盘
process.env.APP_USER_DATA = process.env.APP_USER_DATA || "/opt/temu-erp-data";
const { importFromApiItems, getRowCount, getDb, saveCategories } = await import("../automation/yunqi-db.mjs");

const CRED_FILE = process.env.YQ_CRED_FILE || "/opt/temu-erp-data/yunqi-cred.json";
const LOGIN_URL = "https://www.yunqishuju.com/login";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const PAGE_SIZE = 100;
const MAX_PAGES = Math.min(Math.max(Number(process.env.YQ_MAX_PAGES) || 5, 1), 20);
const KEYWORDS = (process.env.YQ_KEYWORDS || "").split(/[,，]/).map((s) => s.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

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
  if (!ok) throw new Error("登录失败：未拿到 token（账密错误或选择器变更）");
}

// 页面内发抓取请求（绕 TLS 指纹检测），返回 payload.data.data
async function fetchSearch(page, { wareHouseType, from, size, keyword }) {
  return page.evaluate(async ({ wht, from, size, keyword }) => {
    const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
    const cookie = document.cookie || ""; let token = ""; const m = cookie.match(/(?:^|;\s*)token=([^;]+)/); if (m) token = m[1];
    if (!token) for (const [k, v] of Object.entries(ls)) { if (/token|auth/i.test(k) && String(v).includes("eyJ")) { token = String(v).replace(/^"|"$/g, ""); break; } }
    const body = { from, size, sort: [{ daily_sales: "desc" }], ware_house_type: wht, regions: [], region: 0, ids: [], mall_ids: [], opt_ids: [], tags: [], brands: [], with_mall: true, sold_out: null };
    if (keyword) body.keyword = keyword;
    const res = await fetch("/api/proxytemu/good/search", { method: "POST", headers: { "Content-Type": "application/json;charset=UTF-8", "Authorization": "Bearer " + token }, body: JSON.stringify(body) });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
    const items = json?.data?.data || json?.data?.items || json?.data?.list || (Array.isArray(json?.data) ? json.data : []) || [];
    return { code: json?.code, msg: json?.msg, items: Array.isArray(items) ? items : [] };
  }, { wht: wareHouseType, from, size, keyword });
}

async function fetchAndStore(page, { wareHouseType, keyword, label }) {
  const all = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    let r;
    try { r = await fetchSearch(page, { wareHouseType, from: p * PAGE_SIZE, size: PAGE_SIZE, keyword }); }
    catch (e) { log(`  [${label}] 第${p + 1}页抓取异常:`, e.message); break; }
    if (r.code !== 0) { log(`  [${label}] 接口返回 code=${r.code} msg=${r.msg}`); break; }
    if (!r.items.length) break;
    all.push(...r.items);
    if (r.items.length < PAGE_SIZE) break;
    await sleep(1000);
  }
  // 补托管模式 + 主图改用 temu 原图(kwcdn，长期有效)，替代云启 OSS 签名图(几小时就过期、加载不出)
  const modeLabel = wareHouseType === 0 ? "全托管" : "半托管";
  for (const it of all) {
    if (!it || typeof it !== "object") continue;
    it.mall_mode = modeLabel;
    const imgs = Array.isArray(it.image_urls) ? it.image_urls : [];
    const kwcdn = imgs.find((u) => /kwcdn\.com/.test(String(u || "")));
    if (kwcdn) it.thumb_url = kwcdn; // importFromApiItems 的 main_image 优先取 thumb_url
  }
  const res = importFromApiItems(all, `cloud:${label}`);
  log(`  [${label}] 抓 ${all.length} 条 → 入库 ${res.imported} (跳过 ${res.skipped})`);
  return res.imported;
}

(async () => {
  const { account, password } = readCred();
  log(`云端抓取开始 | 账号 ${account.slice(0, 3)}****${account.slice(-2)} | maxPages=${MAX_PAGES} | 关键词=${KEYWORDS.length ? KEYWORDS.join("/") : "(通用feed日销倒序)"}`);
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  try {
    const ctx = await browser.newContext({ userAgent: UA, locale: "zh-CN", viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    log("登录云启…");
    await login(page, account, password);
    log("登录成功 ✓");

    // 抓云启 opt_id 类目树：导航选品页，读 ElCascader 组件的 options（id=opt_id, showName=显示名, child_opts=二级）。
    // 这套 opt_id 与商品的 opt_ids 字段同体系（如 580=汽车），是「按类目筛」的真实键。
    try {
      await page.goto("https://www.yunqishuju.com/temu/home", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(8000);
      const optRows = await page.evaluate(async () => {
        const cn = (s) => { const m = String(s || "").match(/[(（]([^()（）]+)[)）]\s*$/); return m ? m[1] : String(s || ""); };
        const findOpts = () => {
          for (const el of document.querySelectorAll("body *")) {
            const v = el.__vue__; if (!v) continue;
            if (v.$options && v.$options.name === "ElCascader") { const o = v.options || (v.$props && v.$props.options); if (Array.isArray(o) && o.length) return o; }
          }
          return null;
        };
        let opts = findOpts();
        for (let i = 0; i < 24 && !opts; i++) { await new Promise((r) => setTimeout(r, 500)); opts = findOpts(); }
        if (!opts) return [];
        const rows = [];
        for (const o of opts) {
          if (!o || o.id === "全分类") continue;
          rows.push({ id: String(o.id), name: cn(o.showName || o.name), enName: String(o.name || ""), parentId: "", level: 1 });
          for (const c of (o.child_opts || [])) rows.push({ id: String(c.id), name: cn(c.showName || c.name), enName: String(c.name || ""), parentId: String(o.id), level: 2 });
        }
        return rows;
      });
      if (optRows.length) { const r = saveCategories(optRows); log(`opt_id类目树: 读到 ${optRows.length} 节点 → 存 ${r.saved}`); }
      else { log("opt_id类目树: cascader 未读到（页面未渲染或 options 未加载）"); }
    } catch (e) { log("类目树抓取失败:", e.message); }

    // 全量刷新：每轮抓取前清空 products，避免同商品跨批次重复堆积（选品广场看最新一轮）。
    // selection_pool（用户选品池）不动。
    if (!KEYWORDS.length) {
      getDb().exec("DELETE FROM products");
      log("已清空云端 products(全量刷新、去重)");
    }

    let total = 0;
    if (KEYWORDS.length) {
      for (const kw of KEYWORDS) {
        for (const wht of [0, 1]) total += await fetchAndStore(page, { wareHouseType: wht, keyword: kw, label: `${kw}-${wht === 0 ? "全托" : "半托"}` });
      }
    } else {
      for (const wht of [0, 1]) total += await fetchAndStore(page, { wareHouseType: wht, keyword: "", label: wht === 0 ? "全托管" : "半托管" });
    }
    log(`✅ 抓取完成 | 本轮入库 ${total} | 云端库现有 ${getRowCount()} 商品`);
  } finally {
    await browser.close();
  }
})().catch((e) => { log("❌ 抓取服务异常:", e.message); process.exit(1); });
