/**
 * 浏览器管理：启动/关闭/Cookie/登录/导航
 * 从 worker.mjs 提取，共享 browserState 对象
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { randomDelay, logSilent } from "./utils.mjs";

// 共享状态（被 worker.mjs 引用）
export const browserState = {
  browser: null,
  context: null,
  cookiePath: "",
  lastAccountId: "",
  navLiteMode: false,
};

const TEMU_LOGIN_URL = "https://seller.kuajingmaihuo.com/login";

// ---- 查找系统 Chrome ----
export function findChromeExe() {
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (e) { logSilent("chrome.find", e); }
  }
  throw new Error("未找到系统 Chrome，请安装 Google Chrome");
}

// ---- Cookie 管理 ----
export function findLatestCookie() {
  const dir = path.join(process.env.APPDATA || "", "temu-automation", "cookies");
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
  } catch (e) { logSilent("cookie.find", e); }
  return null;
}

export async function saveCookies() {
  const { context, cookiePath } = browserState;
  if (context && cookiePath) {
    try { fs.writeFileSync(cookiePath, JSON.stringify(await context.cookies(), null, 2)); } catch (e) { logSilent("cookie.save", e, "warn"); }
  }
}

// ---- 浏览器生命周期 ----
let _browserLaunchPromise = null;

export async function ensureBrowser() {
  if (browserState.browser && browserState.context) return;
  if (_browserLaunchPromise) { await _browserLaunchPromise; return; }

  _browserLaunchPromise = (async () => {
    let accountId = browserState.lastAccountId;
    if (!accountId) {
      const latest = findLatestCookie();
      if (latest) {
        accountId = latest.accountId;
        console.error(`[Worker] Auto-restoring session for: ${accountId}`);
      }
    }
    if (!accountId) throw new Error("请先登录账号后再操作");
    await launch(accountId, false);
  })();

  try { await _browserLaunchPromise; } finally { _browserLaunchPromise = null; }
}

export async function launch(accountId, headless) {
  if (browserState.browser && browserState.context) return;

  browserState.lastAccountId = accountId;
  const dir = path.join(process.env.APPDATA || "", "temu-automation", "cookies");
  fs.mkdirSync(dir, { recursive: true });
  browserState.cookiePath = path.join(dir, `${accountId}.json`);

  const chromeExe = findChromeExe();
  browserState.browser = await chromium.launch({
    executablePath: chromeExe,
    headless: !!headless,
    slowMo: 50,
    args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
  });

  browserState.context = await browserState.browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });

  await browserState.context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "languages", { get: () => ["zh-CN", "zh", "en-US", "en"] });
  });

  if (fs.existsSync(browserState.cookiePath)) {
    try { await browserState.context.addCookies(JSON.parse(fs.readFileSync(browserState.cookiePath, "utf-8"))); } catch (e) { logSilent("cookie.load", e, "warn"); }
  }
}

export async function closeBrowser() {
  await saveCookies();
  if (browserState.browser) {
    await browserState.browser.close();
    browserState.browser = null;
    browserState.context = null;
  }
}

// ---- 登录 ----
export async function login(phone, password) {
  const page = await browserState.context.newPage();
  try {
    await page.goto(TEMU_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await randomDelay(2000, 4000);

    // 切换到「账号登录」tab
    try {
      const accountTab = page.locator('text=账号登录').first();
      if (await accountTab.isVisible({ timeout: 5000 })) {
        await accountTab.click();
        await randomDelay(1000, 2000);
      }
    } catch (e) { logSilent("login.tab", e); }

    // 输入手机号
    const ph = await page.waitForSelector('#usernameId, input[name="usernameId"], input[placeholder*="手机"]', { timeout: 10000 });
    await ph.click(); await randomDelay(200, 500);
    await ph.fill("");
    for (const c of phone) await ph.type(c, { delay: Math.random() * 100 + 50 });
    await randomDelay(800, 1500);

    // 输入密码
    const pw = await page.waitForSelector('#passwordId, input[type="password"]', { timeout: 5000 });
    await pw.click(); await randomDelay(200, 500);
    await pw.fill("");
    for (const c of password) await pw.type(c, { delay: Math.random() * 100 + 50 });
    await randomDelay(800, 1500);

    // 勾选协议
    try {
      const checkbox = page.locator('input[type="checkbox"]').first();
      if (await checkbox.isVisible({ timeout: 2000 })) {
        if (!(await checkbox.isChecked())) await checkbox.click();
      }
    } catch (e) { logSilent("login.checkbox", e); }
    await randomDelay(300, 600);

    // 点击登录
    const btn = await page.waitForSelector('button:has-text("登录")', { timeout: 5000 });
    await btn.click();
    await randomDelay(2000, 3000);

    // 处理隐私弹窗
    try {
      const agreeBtn = page.locator('button:has-text("同意并登录"), button:has-text("同意")').first();
      if (await agreeBtn.isVisible({ timeout: 3000 })) {
        await agreeBtn.click();
        await randomDelay(1000, 2000);
      }
    } catch (e) { logSilent("login.agree", e); }

    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    await randomDelay(3000, 5000);

    // 检查登录结果
    if (page.url().includes("login")) {
      const cap = await page.locator('[class*="captcha"], [class*="verify"], [class*="slider"], iframe[src*="captcha"]').first().isVisible().catch(() => false);
      if (cap) {
        await page.waitForURL((u) => !u.toString().includes("login"), { timeout: 120000 });
      } else {
        const e = await page.locator('[class*="error"], [class*="toast"], [class*="tip"]').first().textContent().catch(() => "");
        throw new Error(e || "登录失败，请检查账号密码");
      }
    }
    await saveCookies();

    // 处理履约中心授权
    if (page.url().includes("seller.kuajingmaihuo.com") || page.url().includes("settle")) {
      console.error("[login] On 履约中心, handling Seller Central auth...");
      await randomDelay(2000, 3000);
      const cbResult = await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
        for (const cb of inputs) { if (!cb.checked) { cb.click(); return "checked"; } return "already checked"; }
        const customs = [...document.querySelectorAll('[class*="checkbox"], [class*="Checkbox"], [role="checkbox"]')];
        for (const el of customs) { el.click(); return "clicked custom"; }
        return "not found";
      });
      console.error("[login] Auth checkbox:", cbResult);
      await randomDelay(500, 1000);

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
