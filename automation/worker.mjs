/**
 * 自动化 Worker - 通过 HTTP 服务通信，避免 stdio pipe 继承问题
 */
import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";

let browser = null;
let context = null;
let cookiePath = "";
let lastAccountId = "";  // 记住最近登录的 accountId

function randomDelay(min = 800, max = 2500) {
  return new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

// ---- 查找系统 Chrome ----

function findChromeExe() {
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  throw new Error("未找到系统 Chrome，请安装 Google Chrome");
}

// ---- 浏览器管理 ----

// 查找最近使用的 cookie 文件（按修改时间）
function findLatestCookie() {
  const dir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "cookies");
  try {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(".json"))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length > 0) {
      const accountId = files[0].name.replace(".json", "");
      return { accountId, cookiePath: path.join(dir, files[0].name) };
    }
  } catch {}
  return null;
}

// 确保浏览器已启动（如果没有，自动用最近的 cookie 恢复）
async function ensureBrowser() {
  if (browser && context) return;

  // 如果有上次登录的 accountId，用它
  let accountId = lastAccountId;
  if (!accountId) {
    const latest = findLatestCookie();
    if (latest) {
      accountId = latest.accountId;
      console.error(`[Worker] Auto-restoring session for: ${accountId}`);
    }
  }
  if (!accountId) {
    throw new Error("请先登录账号后再操作");
  }
  await launch(accountId, false);
}

async function launch(accountId, headless) {
  if (browser && context) return;

  lastAccountId = accountId;
  const dir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "cookies");
  fs.mkdirSync(dir, { recursive: true });
  cookiePath = path.join(dir, `${accountId}.json`);

  // 直接指定系统 Chrome 路径，避免使用损坏的 Playwright 内置 Chromium
  const chromeExe = findChromeExe();
  browser = await chromium.launch({
    executablePath: chromeExe,
    headless: !!headless,
    slowMo: 50,
    args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
  });

  context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "languages", { get: () => ["zh-CN", "zh", "en-US", "en"] });
  });

  if (fs.existsSync(cookiePath)) {
    try { await context.addCookies(JSON.parse(fs.readFileSync(cookiePath, "utf-8"))); } catch {}
  }
}

async function saveCookies() {
  if (context && cookiePath) {
    try { fs.writeFileSync(cookiePath, JSON.stringify(await context.cookies(), null, 2)); } catch {}
  }
}

async function closeBrowser() {
  await saveCookies();
  if (browser) { await browser.close(); browser = null; context = null; }
}

// ---- 登录 ----

const TEMU_LOGIN_URL = "https://seller.kuajingmaihuo.com/login";
const TEMU_BASE_URL = "https://seller.kuajingmaihuo.com";

async function login(phone, password) {
  const page = await context.newPage();
  try {
    await page.goto(TEMU_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await randomDelay(2000, 4000);

    // 1. 切换到「账号登录」tab（默认是扫码登录）
    try {
      const accountTab = page.locator('text=账号登录').first();
      if (await accountTab.isVisible({ timeout: 5000 })) {
        await accountTab.click();
        await randomDelay(1000, 2000);
      }
    } catch {}

    // 2. 输入手机号（#usernameId 或 placeholder 含"手机"）
    const ph = await page.waitForSelector('#usernameId, input[name="usernameId"], input[placeholder*="手机"]', { timeout: 10000 });
    await ph.click(); await randomDelay(200, 500);
    await ph.fill("");
    for (const c of phone) await ph.type(c, { delay: Math.random() * 100 + 50 });
    await randomDelay(800, 1500);

    // 3. 输入密码（#passwordId 或 type=password）
    const pw = await page.waitForSelector('#passwordId, input[type="password"]', { timeout: 5000 });
    await pw.click(); await randomDelay(200, 500);
    await pw.fill("");
    for (const c of password) await pw.type(c, { delay: Math.random() * 100 + 50 });
    await randomDelay(800, 1500);

    // 4. 勾选协议 checkbox（如果有的话）
    try {
      const checkbox = page.locator('input[type="checkbox"]').first();
      if (await checkbox.isVisible({ timeout: 2000 })) {
        const checked = await checkbox.isChecked();
        if (!checked) await checkbox.click();
      }
    } catch {}
    await randomDelay(300, 600);

    // 5. 点击登录按钮
    const btn = await page.waitForSelector('button:has-text("登录")', { timeout: 5000 });
    await btn.click();
    await randomDelay(2000, 3000);

    // 6. 处理隐私政策弹窗（"同意并登录"）
    try {
      const agreeBtn = page.locator('button:has-text("同意并登录"), button:has-text("同意")').first();
      if (await agreeBtn.isVisible({ timeout: 3000 })) {
        await agreeBtn.click();
        await randomDelay(1000, 2000);
      }
    } catch {}

    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    await randomDelay(3000, 5000);

    // 7. 检查登录结果
    if (page.url().includes("login")) {
      // 检查验证码
      const cap = await page.locator('[class*="captcha"], [class*="verify"], [class*="slider"], iframe[src*="captcha"]').first().isVisible().catch(() => false);
      if (cap) {
        // 等待用户手动完成验证码（最多2分钟）
        await page.waitForURL((u) => !u.toString().includes("login"), { timeout: 120000 });
      } else {
        const e = await page.locator('[class*="error"], [class*="toast"], [class*="tip"]').first().textContent().catch(() => "");
        throw new Error(e || "登录失败，请检查账号密码");
      }
    }
    await saveCookies();

    // 8. 登录后可能停留在"履约中心"页面，需处理 Seller Central 授权
    // 页面有：授权 checkbox + "进入 >" 按钮
    if (page.url().includes("seller.kuajingmaihuo.com") || page.url().includes("settle")) {
      console.error("[login] On 履约中心, handling Seller Central auth...");
      await randomDelay(2000, 3000);

      // 勾选授权 checkbox
      const cbResult = await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
        for (const cb of inputs) { if (!cb.checked) { cb.click(); return "checked"; } return "already checked"; }
        const customs = [...document.querySelectorAll('[class*="checkbox"], [class*="Checkbox"], [role="checkbox"]')];
        for (const el of customs) { el.click(); return "clicked custom"; }
        return "not found";
      });
      console.error("[login] Auth checkbox:", cbResult);
      await randomDelay(500, 1000);

      // 点击"进入 >"按钮
      const btnResult = await page.evaluate(() => {
        const keywords = ["进入", "确认授权", "确认并前往"];
        const all = [...document.querySelectorAll('button, a, [role="button"], div[class*="btn"], div[class*="Btn"]')];
        for (const kw of keywords) {
          for (const el of all) {
            const text = (el.innerText || "").trim();
            if (text.includes(kw) && text.length < 20) { el.click(); return "clicked: " + text; }
          }
        }
        return "not found";
      });
      console.error("[login] Auth enter button:", btnResult);
      if (btnResult !== "not found") {
        await randomDelay(5000, 8000);
        await saveCookies();
      }
    }

    return true;
  } catch (err) { await page.close(); throw err; }
}

// ---- 导航辅助：从商家中心进入 Seller Central ----

// 返回实际使用的 page（可能因 popup 切换到新窗口）
async function navigateToSellerCentral(page, targetPath) {
  const directUrl = `https://agentseller.temu.com${targetPath}`;
  console.error(`[nav] Navigating to ${directUrl}`);
  await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  // 等待可能的重定向
  await randomDelay(3000, 5000);
  // 等 URL 稳定
  await page.waitForURL(/.*/, { timeout: 10000 }).catch(() => {});
  console.error(`[nav] Current URL: ${page.url()}`);

  // 情况1：被重定向到 agentseller 的认证/入口页面
  if (page.url().includes("/main/authentication") || page.url().includes("/main/entry")) {
    console.error("[nav] On authentication page, handling popup flow...");

    // 等待微前端加载
    for (let wait = 0; wait < 10; wait++) {
      const hasContent = await page.evaluate(() => {
        const root = document.querySelector('#root');
        return root && root.innerHTML.length > 10;
      });
      if (hasContent) { console.error(`[nav] Micro-app loaded after ${wait}s`); break; }
      await randomDelay(1000, 1500);
    }
    await randomDelay(1000, 2000);

    // 点击"商家中心"会打开新窗口，监听 popup
    const popupPromise = context.waitForEvent("page", { timeout: 15000 }).catch(() => null);

    // 点击"商家中心 >"
    try {
      const gotoBtn = page.locator('[class*="authentication_goto"]').first();
      if (await gotoBtn.isVisible({ timeout: 3000 })) {
        await gotoBtn.click();
        console.error("[nav] Clicked authentication_goto");
      } else {
        await page.evaluate(() => {
          const all = [...document.querySelectorAll("div, span, a")];
          for (const el of all) {
            const text = (el.textContent?.trim() || "").replace(/\s+/g, "");
            if (text.includes("商家中心") && !text.includes("其他地区") && text.length < 20) {
              el.click(); return;
            }
          }
        });
        console.error("[nav] Clicked 商家中心 via evaluate");
      }
    } catch (e) {
      console.error("[nav] Click error:", e.message);
    }

    // 等待新窗口
    const popup = await popupPromise;
    if (popup) {
      console.error(`[nav] Popup opened: ${popup.url()}`);
      await popup.waitForLoadState("domcontentloaded").catch(() => {});
      await randomDelay(3000, 5000);
      console.error(`[nav] Popup URL: ${popup.url()}`);

      // 在弹出窗口中勾选 checkbox
      const cbResult = await popup.evaluate(() => {
        const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
        for (const cb of inputs) { if (!cb.checked) { cb.click(); return "checked"; } return "already checked"; }
        const customs = [...document.querySelectorAll('[class*="checkbox"], [class*="Checkbox"], [role="checkbox"], label')];
        for (const el of customs) {
          const text = el.innerText || "";
          if (text.includes("授权") || text.includes("同意") || el.className?.toString().toLowerCase().includes("checkbox")) {
            el.click(); return "clicked custom: " + el.tagName;
          }
        }
        return "not found";
      });
      console.error("[nav] Popup checkbox:", cbResult);
      await randomDelay(500, 1000);

      // 点击"确认授权并前往"或"进入"
      const btnResult = await popup.evaluate(() => {
        const keywords = ["确认授权并前往", "确认授权", "确认并前往", "进入"];
        const all = [...document.querySelectorAll('button, [role="button"], a, div[class*="btn"], div[class*="Btn"], span[class*="btn"]')];
        for (const keyword of keywords) {
          for (const el of all) {
            const text = el.innerText?.trim() || "";
            if (text.includes(keyword) && text.length < 20) {
              el.click(); return "clicked: " + text;
            }
          }
        }
        return "not found";
      });
      console.error("[nav] Popup confirm:", btnResult);

      if (btnResult !== "not found") {
        await randomDelay(8000, 12000);
        // 检查所有页面
        const pages = context.pages();
        console.error(`[nav] After auth, ${pages.length} pages:`);
        for (const p of pages) console.error(`  - ${p.url()}`);
        // 找 agentseller 页面（非 authentication）
        const targetPage = pages.find(p =>
          p.url().includes("agentseller.temu.com") && !p.url().includes("authentication")
        );
        if (targetPage) {
          console.error("[nav] Found target page, switching");
          page = targetPage;
        }
      }
    } else {
      console.error("[nav] No popup, trying same-page auth...");
      await randomDelay(2000, 3000);
      // 同页面模态框处理
      await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
        for (const cb of inputs) { if (!cb.checked) cb.click(); }
      });
      await randomDelay(500, 1000);
      await page.evaluate(() => {
        const keywords = ["确认授权", "进入"];
        const btns = [...document.querySelectorAll('button, [role="button"], a')];
        for (const kw of keywords) {
          for (const btn of btns) {
            const text = (btn.innerText || "").trim();
            if (text.includes(kw) && text.length < 20) { btn.click(); return; }
          }
        }
      });
      await randomDelay(5000, 8000);
    }

    // 导航到目标页面
    if (page.url().includes("/main/authentication") || !page.url().includes(targetPath)) {
      await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await randomDelay(3000, 5000);
    }
  }

  // 情况2：被重定向到商家中心登录页（seller.kuajingmaihuo.com）
  if (page.url().includes("seller.kuajingmaihuo.com")) {
    console.error("[nav] Redirected to seller.kuajingmaihuo.com, handling auth...");
    await randomDelay(2000, 3000);

    // 处理授权弹窗：勾选 checkbox + 点击"确认授权并前往"
    async function handleAuthDialog() {
      // 等待弹窗出现
      await randomDelay(1000, 2000);

      // 查找并勾选 checkbox
      const cbClicked = await page.evaluate(() => {
        // 找所有 checkbox（input 和自定义组件）
        const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
        for (const cb of inputs) {
          if (!cb.checked) { cb.click(); return "checked input"; }
          return "already checked";
        }
        // 自定义 checkbox
        const customs = [...document.querySelectorAll('[class*="checkbox"], [class*="Checkbox"], [role="checkbox"]')];
        for (const el of customs) {
          el.click(); return "clicked custom: " + (el.className?.toString().slice(0, 50) || el.tagName);
        }
        // label 里的 checkbox
        const labels = [...document.querySelectorAll('label')];
        for (const label of labels) {
          const text = label.innerText || "";
          if (text.includes("授权") || text.includes("同意") || text.includes("隐私")) {
            label.click(); return "clicked label: " + text.slice(0, 30);
          }
        }
        return "not found";
      });
      console.error("[nav] Checkbox result:", cbClicked);
      await randomDelay(500, 1000);

      // 点击"确认授权并前往"或"进入"按钮
      const btnClicked = await page.evaluate(() => {
        const keywords = ["确认授权并前往", "确认授权", "确认并前往", "进入"];
        const all = [...document.querySelectorAll('button, [role="button"], a, div[class*="btn"], div[class*="Btn"], span[class*="btn"]')];
        for (const keyword of keywords) {
          for (const el of all) {
            const text = el.innerText?.trim() || "";
            if (text.includes(keyword) && text.length < 20) {
              el.click(); return "clicked: " + text;
            }
          }
        }
        return "not found";
      });
      console.error("[nav] Confirm button result:", btnClicked);
      if (btnClicked !== "not found") {
        await randomDelay(5000, 8000);
      }
    }

    // 检查是否已经有授权弹窗
    const hasDialog = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return text.includes("确认授权") || text.includes("即将前往") || text.includes("Seller Central") || text.includes("进入");
    });

    if (hasDialog) {
      console.error("[nav] Auth dialog already visible, handling...");
      await handleAuthDialog();
    } else {
      // 没有弹窗，尝试触发它（展开商品管理菜单）
      console.error("[nav] No auth dialog, trying to trigger via menu...");
      try {
        await page.getByText("商品管理", { exact: true }).first().click();
        await randomDelay(800, 1200);
        await page.getByText("商品列表", { exact: true }).first().click();
        await randomDelay(2000, 3000);
      } catch {}
      await handleAuthDialog();
    }

    // 再次访问目标页面
    if (!page.url().includes("agentseller.temu.com") || page.url().includes("authentication")) {
      await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await randomDelay(3000, 5000);
    }
  }

  console.error(`[nav] Final URL: ${page.url()}`);

  // 关闭页面上可能的弹窗
  for (let i = 0; i < 8; i++) {
    try {
      const popup = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("查看详情")').first();
      if (await popup.isVisible({ timeout: 800 })) {
        await popup.click();
        await randomDelay(300, 600);
      } else break;
    } catch { break; }
  }
  await page.evaluate(() => {
    document.querySelectorAll('[class*=close],[class*=Close]').forEach(el => { try { el.click(); } catch {} });
  });
  await randomDelay(500, 1000);
  return page;
}

// ---- 抓取商品 ----

async function scrapeProducts() {
  let page = await context.newPage();
  const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  fs.mkdirSync(debugDir, { recursive: true });

  try {
    page = await navigateToSellerCentral(page, "/goods/list");
    await page.screenshot({ path: path.join(debugDir, "01_after_navigate.png"), fullPage: false });
    console.error("[scrape] URL after navigate:", page.url());

    // 关闭弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const popup = page.locator(
          'button:has-text("知道了"), button:has-text("我知道了"), ' +
          'button:has-text("确定"), button:has-text("关闭"), ' +
          'button:has-text("查看详情"), button:has-text("去处理")'
        ).first();
        if (await popup.isVisible({ timeout: 800 })) {
          await popup.click();
          await randomDelay(300, 600);
        } else break;
      } catch { break; }
    }
    try {
      await page.evaluate(() => {
        document.querySelectorAll('[class*="close"], [class*="Close"], [aria-label="close"]').forEach(el => {
          try { el.click(); } catch {}
        });
      });
    } catch {}
    await randomDelay(500, 800);
    await page.screenshot({ path: path.join(debugDir, "02_after_popups.png"), fullPage: false });

    // 等待表格加载（微前端页面加载较慢，多次重试）
    let tableFound = false;
    for (let retry = 0; retry < 3; retry++) {
      try {
        await page.waitForSelector("table tbody tr", { timeout: 60000 });
        console.error("[scrape] Table rows found");
        tableFound = true;
        break;
      } catch {
        console.error(`[scrape] Table not found (attempt ${retry + 1}/3), waiting...`);
        // 可能页面还在"加载中..."，等待并刷新
        if (retry < 2) {
          await randomDelay(3000, 5000);
          // 检查是否有"加载中"提示
          const loading = await page.evaluate(() => {
            const all = document.body.innerText;
            return all.includes("加载中") || all.includes("loading");
          }).catch(() => false);
          if (loading) {
            console.error("[scrape] Page still loading, waiting more...");
            await randomDelay(5000, 8000);
          }
        }
      }
    }
    if (!tableFound) {
      console.error("[scrape] Table not found after retries, trying to extract anyway...");
    }
    await randomDelay(2000, 3000);
    await page.screenshot({ path: path.join(debugDir, "03_after_table_wait.png"), fullPage: true });

    // 调试：输出表格头和第一行数据
    try {
      const tableDebug = await page.evaluate(() => {
        const table = document.querySelector("table");
        if (!table) return { error: "no table" };
        // 获取表头（含 colspan 信息）
        const ths = [...table.querySelectorAll("thead th, thead td")];
        const headers = ths.map((th, i) => ({
          index: i,
          text: th.innerText?.trim(),
          colspan: th.colSpan || 1,
        }));
        const totalColspan = headers.reduce((s, h) => s + h.colspan, 0);
        const firstRow = table.querySelector("tbody tr");
        if (!firstRow) return { headers, totalColspan, error: "no rows" };
        const cells = [...firstRow.querySelectorAll("td")].map((td, i) => ({
          index: i,
          text: td.innerText?.trim().slice(0, 100),
          colspan: td.colSpan || 1,
        }));
        return { headerCount: headers.length, totalColspan, cellCount: cells.length, headers, cells };
      });
      fs.writeFileSync(path.join(debugDir, "table_structure.json"), JSON.stringify(tableDebug, null, 2), "utf-8");
      console.error("[scrape] Table headers:", JSON.stringify(tableDebug.headers));
      console.error("[scrape] Cell count:", tableDebug.cellCount);
    } catch (e) {
      console.error("[scrape] Table debug error:", e.message);
    }

    // ---- 单页提取函数 ----
    // 表头（2026-03 实测）：
    // 0:"" (checkbox), 1:"商品信息", 2:"商品属性", 3:"尺码表", 4:"说明书信息",
    // 5:"SKU ID", 6:"商品规格", 7:"库存", 8:"是否展示库存标", 9:"商品编码",
    // 10:"体积重量信息", 11:"敏感属性信息", 12:"SKU分类", 13:"SKU货号",
    // 14:"申报价格(CNY)", 15:"销售信息", 16:"创建时间", 17:"商品优化事项",
    // 18:"操作", 19:"电子版", 20:"纸质版", 21:"卖家测量", 22:"平台测量参考",
    // 23:"今日销量", 24:"今日合计", 25:"7天销量"

    // 先动态获取列索引映射
    const headerMap = await page.evaluate(() => {
      // 只取第一行表头，避免多行表头重复 key 覆盖
      const firstRow = document.querySelector("table thead tr");
      if (!firstRow) return {};
      const ths = [...firstRow.querySelectorAll("th, td")];
      const map = {};
      let colIndex = 0;
      ths.forEach((th) => {
        const text = th.innerText?.trim().replace(/\n/g, " ");
        if (text && !map.hasOwnProperty(text)) map[text] = colIndex;
        colIndex += (th.colSpan || 1);
      });
      return map;
    }).catch(() => ({}));
    console.error("[scrape] Header map (colspan-aware):", JSON.stringify(headerMap));

    async function extractProductsPage() {
      return await page.evaluate((hMap) => {
        const tables = document.querySelectorAll("table");
        let targetTbody = null;
        for (const t of tables) {
          const tbody = t.querySelector("tbody");
          if (tbody && tbody.querySelectorAll("tr").length > 0) {
            targetTbody = tbody; break;
          }
        }
        if (!targetTbody) return [];

        const rows = targetTbody.querySelectorAll("tr");
        const results = [];

        // 辅助：安全获取 cell 文本
        function cellText(cells, colName) {
          const idx = hMap[colName];
          if (idx !== undefined && idx < cells.length) {
            return cells[idx].innerText?.trim() || "";
          }
          return "";
        }

        // 辅助：从文本行中提取字段值
        function getFieldValue(lines, label) {
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(label)) {
              const afterLabel = lines[i].split(/[：:]/);
              if (afterLabel.length > 1) {
                const val = afterLabel.slice(1).join(":").trim();
                if (val) return val;
              }
              if (i + 1 < lines.length) return lines[i + 1];
            }
          }
          return "";
        }

        for (const row of rows) {
          const cells = row.querySelectorAll("td");
          if (cells.length < 2) continue;

          // 商品信息列（标题、类目、SPU/SKC ID等）
          const infoIdx = hMap["商品信息"] ?? 1;
          const infoCell = cells[infoIdx];
          if (!infoCell) continue;

          const infoText = infoCell.innerText || "";
          const infoLines = infoText.split("\n").map(l => l.trim()).filter(Boolean);
          if (!infoText.includes("SPU ID")) continue;

          // 标题：第一行较长的文本
          const title = infoLines.find(l =>
            l.length > 5 &&
            !l.startsWith("类目") && !l.startsWith("SPU") && !l.startsWith("SKC") &&
            !l.startsWith("货号") && !l.match(/^\d+$/) && !l.includes("商品分类错误")
          ) || "";

          const category = getFieldValue(infoLines, "类目");
          const spuId = getFieldValue(infoLines, "SPU ID");
          const skcId = getFieldValue(infoLines, "SKC ID");

          // 商品属性列
          const attributes = cellText(cells, "商品属性");

          // SKU ID 列
          const skuId = cellText(cells, "SKU ID");

          // 库存列
          const stock = cellText(cells, "库存");

          // 商品编码列
          const productCode = cellText(cells, "商品编码") || getFieldValue(infoLines, "货号");

          // SKU货号列
          const skuCode = cellText(cells, "SKU货号");

          // 申报价格列
          let price = cellText(cells, "申报价格(CNY)");
          if (!price) {
            const allText = row.innerText || "";
            const priceMatch = allText.match(/¥([\d.]+)/);
            if (priceMatch) price = "¥" + priceMatch[1];
          }

          // 销售信息列
          const salesInfo = cellText(cells, "销售信息");

          // 今日销量、7天销量
          const todaySales = cellText(cells, "今日销量");
          const sales7d = cellText(cells, "7天销量");

          // 创建时间
          const createdAt = cellText(cells, "创建时间");

          // 商品规格
          const spec = cellText(cells, "商品规格");

          // 图片搜索
          let imageUrl = "";
          for (let i = 0; i < Math.min(cells.length, 3); i++) {
            const img = cells[i].querySelector("img[src]");
            if (img && img.src && !img.src.includes("data:") && img.src.startsWith("http")) {
              imageUrl = img.src; break;
            }
          }
          if (!imageUrl) {
            const rowHtml = row.innerHTML || "";
            const urlMatch = rowHtml.match(/https?:\/\/[^"'\s]*kwcdn\.com[^"'\s]*(?:\.jpg|\.png|\.webp)/i);
            if (urlMatch) imageUrl = urlMatch[0];
          }

          // 状态：从商品信息列或销售信息列提取
          let status = "";
          const statusKeywords = ["在售", "已上架", "已下架", "审核中", "已驳回", "待审核", "已停售", "缺货", "已生效", "待生效", "未发布"];
          const allRowText = row.innerText || "";
          for (const kw of statusKeywords) {
            if (allRowText.includes(kw)) { status = kw; break; }
          }

          // 仓组 & 备货模式
          let warehouse = "";
          const warehouseMatch = allRowText.match(/([\u4e00-\u9fa5]+仓组\d*)/);
          if (warehouseMatch) warehouse = warehouseMatch[1];

          let stockMode = "";
          const modeKeywords = ["国内备货", "JIT", "海外仓", "VMI"];
          for (const kw of modeKeywords) {
            if (allRowText.includes(kw)) { stockMode = kw; break; }
          }

          results.push({
            title, category, spuId, skcId, skuId,
            sku: skuCode || "", attributes, imageUrl,
            price, spec, productCode, status,
            salesInfo, todaySales, sales7d, createdAt,
          });
        }
        return results;
      }, headerMap);
    }

    // ---- 关闭所有弹窗（防止遮挡翻页按钮） ----
    async function closeModals() {
      await page.evaluate(() => {
        document.querySelectorAll('[data-testid="beast-core-modal"] [class*="close"], [class*="Modal"] [class*="close"], [class*="modal"] [class*="Close"], [class*="CloseIcon"], svg[class*="close"]').forEach(el => { try { el.click(); } catch {} });
      });
      for (let i = 0; i < 5; i++) {
        try {
          const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不处理")').first();
          if (await btn.isVisible({ timeout: 500 })) { await btn.click(); await randomDelay(300, 500); }
          else break;
        } catch { break; }
      }
    }

    // ---- 提取第一页 ----
    await closeModals();
    let allProducts = (await extractProductsPage()).filter(p => p.spuId);
    console.error(`[scrape] Page 1: ${allProducts.length} products`);

    // ---- 翻页抓取所有数据 ----
    for (let pageNum = 2; pageNum <= 200; pageNum++) {
      try {
        await closeModals();
        const nextBtn = page.locator(
          'button[class*="next"]:not([disabled]), ' +
          'li[class*="next"]:not([class*="disabled"]) button, ' +
          '[class*="pagination"] [class*="next"]:not([class*="disabled"]), ' +
          'button[aria-label="下一页"]:not([disabled]), ' +
          '[data-testid*="next"]:not([disabled])'
        ).first();

        const isVisible = await nextBtn.isVisible({ timeout: 3000 }).catch(() => false);
        if (!isVisible) {
          console.error(`[scrape] No next button after page ${pageNum - 1}`);
          break;
        }

        const isDisabled = await nextBtn.evaluate(el =>
          el.disabled ||
          el.classList.contains('disabled') ||
          el.getAttribute('aria-disabled') === 'true' ||
          el.closest('[class*="disabled"]') !== null
        ).catch(() => true);

        if (isDisabled) {
          console.error(`[scrape] Next button disabled after page ${pageNum - 1}`);
          break;
        }

        await nextBtn.click();
        // 等待表格数据更新（等 loading 消失或新行出现）
        await page.waitForSelector("table tbody tr", { timeout: 10000 }).catch(() => {});
        await randomDelay(500, 1000);

        const pageProducts = (await extractProductsPage()).filter(p => p.spuId);
        if (pageProducts.length === 0) {
          console.error(`[scrape] Page ${pageNum}: empty, stopping`);
          break;
        }
        allProducts = allProducts.concat(pageProducts);
        // 每10页输出一次日志减少噪音
        if (pageNum % 10 === 0 || pageProducts.length < 20) {
          console.error(`[scrape] Page ${pageNum}: total ${allProducts.length} products`);
        }
      } catch (e) {
        console.error(`[scrape] Pagination error at page ${pageNum}:`, e.message);
        break;
      }
    }

    console.error(`[scrape] Total: ${allProducts.length} products`);
    // 保存调试信息
    fs.writeFileSync(path.join(debugDir, "products_debug.json"), JSON.stringify({ total: allProducts.length, sample: allProducts.slice(0, 3) }, null, 2));
    await saveCookies();
    await page.close();
    return allProducts;
  } catch (err) {
    try { await page.screenshot({ path: path.join(debugDir, "error_screenshot.png"), fullPage: false }); } catch {}
    await page.close();
    throw err;
  }
}

// ---- 抓取订单（备货单）----

async function scrapeOrders() {
  const page = await context.newPage();
  try {
    // Temu 全托管的订单在「备货管理」>「我的备货单」
    await navigateToSellerCentral(page, "/supply/purchase-order-list");

    // 等待表格
    await page.waitForSelector("table tbody tr", { timeout: 15000 }).catch(() => {});
    await randomDelay(2000, 3000);

    const orders = await page.evaluate(() => {
      const rows = document.querySelectorAll("table tbody tr");
      return Array.from(rows).map((row) => {
        const cells = row.querySelectorAll("td");
        const allText = row.textContent || "";

        return {
          orderId: cells[0]?.textContent?.trim() || "",
          productTitle: cells[1]?.textContent?.trim()?.substring(0, 80) || "",
          quantity: parseInt(cells[2]?.textContent?.replace(/[^0-9]/g, "") || "0", 10),
          amount: parseFloat(cells[3]?.textContent?.replace(/[^0-9.]/g, "") || "0"),
          status: cells[4]?.textContent?.trim() || "unknown",
          orderTime: cells[5]?.textContent?.trim() || "",
        };
      });
    });

    await saveCookies();
    await page.close();
    return orders.filter((o) => o.orderId);
  } catch (err) { await page.close(); throw err; }
}

// ---- 抓取销售管理数据 ----

async function scrapeSales() {
  const page = await context.newPage();
  const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  fs.mkdirSync(debugDir, { recursive: true });

  try {
    // 策略：先通过 navigateToSellerCentral 进入商品列表（已验证可用）
    // 然后在同一个页面上通过左侧菜单导航到销售管理
    console.error("[sales] Step 1: Navigate to goods/list first...");
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(2000, 3000);
    console.error("[sales] After navigateToSellerCentral, URL:", page.url());
    await page.screenshot({ path: path.join(debugDir, "sales_01_navigate.png"), fullPage: false });

    // 如果成功进入了 agentseller，通过左侧菜单导航到销售管理
    if (page.url().includes("agentseller.temu.com") && !page.url().includes("authentication")) {
      console.error("[sales] Step 2: Navigating via left menu...");

      // 方法1：直接在同一个已认证的页面上修改URL（同源，不会重新认证）
      const salesUrl = "https://agentseller.temu.com/stock/fully-mgt/sale-manage/main";
      await page.goto(salesUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await randomDelay(3000, 5000);
      console.error("[sales] After goto sales URL:", page.url());

      // 如果直接 goto 又被重定向到 authentication，换方法：点击菜单
      if (page.url().includes("authentication")) {
        console.error("[sales] Redirect to auth, trying menu click...");
        // 回到商品列表
        await page.goBack();
        await randomDelay(2000, 3000);

        // 如果 goBack 不行，重新导航
        if (!page.url().includes("agentseller.temu.com") || page.url().includes("authentication")) {
          await navigateToSellerCentral(page, "/goods/list");
          await randomDelay(2000, 3000);
        }

        // 尝试通过侧栏菜单点击
        try {
          // 销售管理 在 Temu Seller Central 左侧菜单中
          // 先点击"销售管理"一级菜单
          console.error("[sales] Clicking menu: 销售管理");
          await page.locator('text=销售管理').first().click({ timeout: 10000 });
          await randomDelay(1000, 2000);
          // 再点击"销售管理"二级菜单（同名）
          await page.locator('text=销售管理').nth(1).click({ timeout: 10000 });
          await randomDelay(3000, 5000);
        } catch (menuErr) {
          console.error("[sales] Menu click failed:", menuErr.message);
          // 尝试 evaluate 直接修改 window.location（同源 SPA 路由）
          try {
            console.error("[sales] Trying SPA navigation via history.pushState...");
            await page.evaluate(() => {
              window.history.pushState({}, "", "/stock/fully-mgt/sale-manage/main");
              window.dispatchEvent(new PopStateEvent("popstate"));
            });
            await randomDelay(3000, 5000);
          } catch {}
          // 如果 pushState 不行，直接 window.location
          if (!page.url().includes("sale-manage")) {
            await page.evaluate(() => {
              window.location.href = "/stock/fully-mgt/sale-manage/main";
            });
            await randomDelay(5000, 8000);
          }
        }
        console.error("[sales] After menu nav, URL:", page.url());
      }
    } else {
      // navigateToSellerCentral 也没能进入，直接尝试用 URL
      console.error("[sales] navigateToSellerCentral failed, trying direct URL...");
      const salesUrl = "https://agentseller.temu.com/stock/fully-mgt/sale-manage/main";
      await page.goto(salesUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await randomDelay(3000, 5000);

      // 处理入口页面
      if (page.url().includes("/main/authentication")) {
        // 尝试所有可能的点击方式
        console.error("[sales] On auth page, trying click strategies...");
        try {
          await page.locator('a:has-text("商家中心")').last().click({ force: true });
          await randomDelay(5000, 8000);
        } catch {}
        if (page.url().includes("authentication")) {
          try {
            await page.locator('text=商家中心').last().click({ force: true });
            await randomDelay(5000, 8000);
          } catch {}
        }
      }
    }

    await page.screenshot({ path: path.join(debugDir, "sales_02_ready.png"), fullPage: false });
    console.error("[sales] Final URL:", page.url());

    // 关闭所有弹窗
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 8; i++) {
        try {
          const popup = page.locator(
            'button:has-text("知道了"), button:has-text("我知道了"), ' +
            'button:has-text("确定"), button:has-text("关闭"), ' +
            'button:has-text("查看详情"), button:has-text("去处理")'
          ).first();
          if (await popup.isVisible({ timeout: 800 })) {
            await popup.click();
            await randomDelay(300, 600);
          } else break;
        } catch { break; }
      }
      try {
        await page.evaluate(() => {
          document.querySelectorAll('[class*="close"], [class*="Close"], [aria-label="close"], [aria-label="Close"]').forEach(el => {
            try { el.click(); } catch {}
          });
        });
      } catch {}
      await randomDelay(500, 800);
    }

    // 等待表格加载
    try {
      await page.waitForSelector("table tbody tr", { timeout: 15000 });
    } catch {
      console.error("[sales] No table found, trying to extract page data...");
      await randomDelay(3000, 5000);
    }

    // ---- 提取单页表格数据的函数 ----
    async function extractSalesPage() {
      return await page.evaluate(() => {
        const items = [];
        const tables = document.querySelectorAll("table");
        for (const t of tables) {
          const tbody = t.querySelector("tbody");
          if (!tbody) continue;
          const rows = tbody.querySelectorAll("tr");
          if (rows.length === 0) continue;

          // 获取表头
          const headers = [];
          const thead = t.querySelector("thead");
          if (thead) {
            thead.querySelectorAll("th").forEach(th => {
              headers.push(th.innerText?.trim()?.replace(/\n/g, " ") || "");
            });
          }

          for (const row of rows) {
            const cells = row.querySelectorAll("td");
            if (cells.length < 2) continue;

            const allText = row.innerText || "";
            // 跳过"合计"行
            if (allText.startsWith("合计")) continue;

            const rowData = {};
            // 表头映射
            if (headers.length > 0) {
              for (let i = 0; i < cells.length && i < headers.length; i++) {
                if (headers[i]) {
                  rowData[headers[i]] = cells[i].innerText?.trim()?.substring(0, 200) || "";
                }
              }
            }

            // 提取 SPU/SKC/SKU
            let spuId = "", skcId = "", skuId = "", title = "", price = "";
            const spuMatch = allText.match(/SPU(?:\s*ID)?[：:]\s*(\d+)/);
            if (spuMatch) spuId = spuMatch[1];
            const skcMatch = allText.match(/SKC(?:\s*ID)?[：:]\s*(\d+)/);
            if (skcMatch) skcId = skcMatch[1];
            const skuMatch = allText.match(/SKU\s*ID[：:]\s*(\d+)/);
            if (skuMatch) skuId = skuMatch[1];
            const priceMatch = allText.match(/¥([\d.]+)/);
            if (priceMatch) price = "¥" + priceMatch[1];

            // 提取库存相关数据
            let stock = "", warehouse = "", stockStatus = "";
            const stockMatch = allText.match(/(\d+)\s*\+\s*(\d+)/);  // "4 + 3" 格式
            if (stockMatch) stock = stockMatch[0];
            const warehouseMatch = allText.match(/([\u4e00-\u9fa5]+仓组\d*)/);
            if (warehouseMatch) warehouse = warehouseMatch[1];
            // 备货状态
            const statusKeywords = ["国内备货", "已生效", "待生效", "已停售", "缺货中", "备货中"];
            for (const kw of statusKeywords) {
              if (allText.includes(kw)) { stockStatus = kw; break; }
            }

            // 标题
            for (let i = 0; i < cells.length; i++) {
              const text = cells[i].innerText || "";
              const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
              const candidate = lines.find(l =>
                l.length > 10 &&
                !l.startsWith("SPU") && !l.startsWith("SKC") && !l.startsWith("SKU") &&
                !l.startsWith("类目") && !l.startsWith("货号") && !l.match(/^\d+$/) &&
                !l.startsWith("合计") && !l.includes("暂无评分") && !l.includes("加入站点") &&
                !l.includes("备货仓组") && !l.includes("节日/季节")
              );
              if (candidate && candidate.length > (title?.length || 0)) {
                title = candidate;
              }
            }

            // 各列数字（销量、库存等）
            const nums = [];
            for (let i = 2; i < cells.length; i++) {
              const cellText = cells[i].innerText?.trim() || "";
              // 只取纯数字或短数字串
              if (/^\d+$/.test(cellText)) nums.push(parseInt(cellText));
            }

            rowData._spuId = spuId;
            rowData._skcId = skcId;
            rowData._skuId = skuId;
            rowData._title = title;
            rowData._price = price;
            rowData._stock = stock;
            rowData._warehouse = warehouse;
            rowData._stockStatus = stockStatus;
            rowData._nums = nums;
            rowData._fullText = allText.substring(0, 500);

            items.push(rowData);
          }
          break; // 只处理第一个有数据的表格
        }
        return items;
      });
    }

    // ---- 提取汇总数据 ----
    const summary = await page.evaluate(() => {
      const result = {};
      // 从卡片提取
      const cards = document.querySelectorAll('[class*="card"], [class*="Card"], [class*="stat"], [class*="summary"], [class*="overview"], [class*="indicator"]');
      cards.forEach(card => {
        const text = card.innerText?.trim();
        if (text && text.length < 200) {
          const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
          if (lines.length >= 2) result[lines[0]] = lines.slice(1).join(" ");
        }
      });
      // 从页面文本提取指标
      const bodyText = document.body?.innerText || "";
      const metrics = ["今日销量", "今日销售额", "7天销量", "7天销售额", "30天销量", "30天销售额", "总销量", "总销售额", "在售商品数", "待发货"];
      for (const m of metrics) {
        const regex = new RegExp(m + "[：:\\s]*([\\d,\\.]+)");
        const match = bodyText.match(regex);
        if (match) result[m] = match[1];
      }
      return result;
    });

    // ---- 提取第一页数据 ----
    let allItems = await extractSalesPage();
    console.error(`[sales] Page 1: ${allItems.length} items`);

    // ---- 翻页抓取所有数据 ----
    for (let pageNum = 2; pageNum <= 200; pageNum++) {
      try {
        const nextBtn = page.locator(
          'button[class*="next"]:not([disabled]), ' +
          'li[class*="next"]:not([class*="disabled"]) button, ' +
          '[class*="pagination"] [class*="next"]:not([class*="disabled"]), ' +
          'button[aria-label="下一页"]:not([disabled]), ' +
          '[data-testid*="next"]:not([disabled])'
        ).first();

        const isVisible = await nextBtn.isVisible({ timeout: 3000 }).catch(() => false);
        if (!isVisible) {
          console.error(`[sales] No next button after page ${pageNum - 1}`);
          break;
        }

        const isDisabled = await nextBtn.evaluate(el =>
          el.disabled ||
          el.classList.contains('disabled') ||
          el.getAttribute('aria-disabled') === 'true' ||
          el.closest('[class*="disabled"]') !== null
        ).catch(() => true);

        if (isDisabled) {
          console.error(`[sales] Next button disabled after page ${pageNum - 1}`);
          break;
        }

        await nextBtn.click();
        await page.waitForSelector("table tbody tr", { timeout: 10000 }).catch(() => {});
        await randomDelay(500, 1000);

        const pageItems = await extractSalesPage();
        if (pageItems.length === 0) {
          console.error(`[sales] Empty page ${pageNum}, stopping`);
          break;
        }
        allItems = allItems.concat(pageItems);
        console.error(`[sales] Page ${pageNum}: +${pageItems.length} items (total: ${allItems.length})`);
      } catch (e) {
        console.error(`[sales] Pagination error at page ${pageNum}:`, e.message);
        break;
      }
    }

    const salesData = { summary, items: allItems };
    console.error(`[sales] Summary keys: ${Object.keys(summary).join(", ")}`);
    console.error(`[sales] Total items: ${allItems.length}`);

    // 保存调试信息
    fs.writeFileSync(path.join(debugDir, "sales_debug.json"), JSON.stringify(salesData, null, 2));

    await page.screenshot({ path: path.join(debugDir, "sales_03_done.png"), fullPage: false });
    await saveCookies();
    await page.close();
    return salesData;
  } catch (err) {
    try { await page.screenshot({ path: path.join(debugDir, "sales_error.png"), fullPage: false }); } catch {}
    await page.close();
    throw err;
  }
}

// ---- HTTP 服务 ----

async function handleRequest(body) {
  const { action, params = {} } = body;
  switch (action) {
    case "ping": return { status: "pong" };
    case "launch": await launch(params.accountId, params.headless); return { status: "launched" };
    case "login": await launch(params.accountId, false); return { success: await login(params.phone, params.password) };
    case "scrape_products": {
      console.error("[Worker] scrape_products called, browser:", !!browser, "context:", !!context);
      try {
        await ensureBrowser();
        console.error("[Worker] ensureBrowser done, browser:", !!browser, "context:", !!context);
      } catch (e) {
        console.error("[Worker] ensureBrowser error:", e.message);
        throw new Error("浏览器启动失败: " + e.message);
      }
      return { products: await scrapeProducts() };
    }
    case "scrape_orders": {
      await ensureBrowser();
      return { orders: await scrapeOrders() };
    }
    case "scrape_sales": {
      await ensureBrowser();
      return { sales: await scrapeSales() };
    }
    case "debug_page": {
      await ensureBrowser();
      let pg = context.pages().find(p => p.url().includes("goods") || p.url().includes("product"));
      if (!pg) {
        pg = context.pages()[0] || await context.newPage();
      }
      // 无论如何都导航到商品管理页
      await pg.goto("https://agentseller.temu.com/goods/list", { waitUntil: "domcontentloaded", timeout: 30000 });
      await pg.waitForSelector("table", { timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 5000));
      if (!pg) throw new Error("No page found");
      const info = await pg.evaluate(() => {
        const result = {};
        // 1. 表头
        const ths = [...document.querySelectorAll("table thead th, table thead td")];
        result.headers = ths.map((th, i) => ({ index: i, text: th.innerText?.trim().replace(/\n/g, " ") }));
        // 2. 第一行数据
        const tbody = document.querySelector("table tbody");
        if (tbody) {
          const firstRow = tbody.querySelector("tr");
          if (firstRow) {
            const cells = firstRow.querySelectorAll("td");
            result.firstRow = [...cells].map((td, i) => ({
              index: i,
              text: (td.innerText || "").trim().substring(0, 200),
              html: td.innerHTML.substring(0, 300)
            }));
          }
        }
        // 3. URL
        result.url = location.href;
        return result;
      });
      return info;
    }
    case "close": await closeBrowser(); return { status: "closed" };
    case "shutdown": await closeBrowser(); setTimeout(() => process.exit(0), 100); return { status: "shutting_down" };
    default: throw new Error("未知命令: " + action);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") { res.writeHead(404); res.end(); return; }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const cmd = JSON.parse(body);
      const result = await handleRequest(cmd);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "result", data: result }));
    } catch (err) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", message: err.message || String(err) }));
    }
  });
});

const PORT = parseInt(process.env.WORKER_PORT || "19280");
server.listen(PORT, "127.0.0.1", () => {
  // 把端口写到文件
  const portFile = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "worker-port");
  fs.mkdirSync(path.dirname(portFile), { recursive: true });
  fs.writeFileSync(portFile, String(PORT));
  console.error(`WORKER_PORT=${PORT}`);
  console.log(`Worker ready on port ${PORT}`);
});

process.on("SIGTERM", async () => { await closeBrowser(); server.close(); process.exit(0); });
