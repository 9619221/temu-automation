/**
 * 浏览器管理：启动/关闭/Cookie/登录/导航
 * 从 worker.mjs 提取，共享 browserState 对象
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { randomDelay, logSilent, getDebugDir } from "./utils.mjs";
import { getDelayScale, getEffectiveHeadless, shouldCaptureErrorScreenshots } from "./runtime-config.mjs";

// 共享状态（被 worker.mjs 引用）
export const browserState = {
  browser: null,
  context: null,
  cookiePath: "",
  lastAccountId: "",
  navLiteMode: false,
  lastPhone: "",
  lastPassword: "",
};

const TEMU_LOGIN_URL = "https://seller.kuajingmaihuo.com/login";

function getTypingDelay() {
  const scale = getDelayScale();
  const min = Math.max(20, Math.round(50 * scale));
  const max = Math.max(min, Math.round(150 * scale));
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalizeLoginPhone(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11) return digits;
  if (digits.length > 11) return digits.slice(-11);
  return digits || raw;
}

async function findVisibleInput(page, selectors = []) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      const visible = await candidate.isVisible().catch(() => false);
      const editable = await candidate.isEditable().catch(() => false);
      if (visible && editable) return candidate;
    }
  }
  return null;
}

async function fillInputVerified(input, value, options = {}) {
  const {
    label = "输入框",
    logPrefix = "[input]",
    normalize = (next) => String(next ?? "").trim(),
    delayProvider = () => getTypingDelay(),
  } = options;
  const expected = normalize(value);
  const readValue = async () => normalize(
    await input.inputValue().catch(async () => input.evaluate((node) => node?.value || ""))
  );
  const clearInput = async () => {
    await input.click({ clickCount: 3 }).catch(() => {});
    await input.press("Control+A").catch(() => {});
    await input.press("Backspace").catch(() => {});
    await input.fill("").catch(() => {});
    await input.evaluate((node) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(node, "");
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }).catch(() => {});
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await clearInput();
    await randomDelay(120, 240);

    if (attempt < 2) {
      for (const char of String(value ?? "")) {
        await input.type(char, { delay: delayProvider() });
      }
    } else {
      await input.evaluate((node, nextValue) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(node, nextValue);
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
        node.dispatchEvent(new Event("blur", { bubbles: true }));
      }, String(value ?? ""));
    }

    await randomDelay(150, 320);
    const actual = await readValue();
    if (actual === expected) return true;
    console.error(`${logPrefix} ${label} mismatch on attempt ${attempt + 1}: expected=${expected} actual=${actual || "<empty>"}`);
  }

  throw new Error(`${label}输入后校验失败`);
}

async function captureBrowserErrorScreenshot(page, prefix) {
  if (!page || page.isClosed?.() || !shouldCaptureErrorScreenshots()) return "";
  try {
    const filename = `${String(prefix || "browser_error").replace(/[^a-z0-9_-]/gi, "_")}_${Date.now()}.png`;
    const filePath = path.join(getDebugDir(), filename);
    await page.screenshot({ path: filePath, fullPage: true });
    console.error(`[browser] Error screenshot saved: ${filePath}`);
    return filePath;
  } catch (error) {
    logSilent("browser.screenshot", error);
    return "";
  }
}

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
  // 检查浏览器是否还活着，已关闭则清空引用让下面重新启动
  if (browserState.browser && !browserState.browser.isConnected()) {
    console.error("[Browser] Browser disconnected, clearing references...");
    browserState.browser = null;
    browserState.context = null;
  }
  if (browserState.browser && browserState.context) return;
  if (_browserLaunchPromise) {
    await _browserLaunchPromise;
    if (browserState.browser && browserState.context) return;
  }

  const launchPromise = (async () => {
    let accountId = browserState.lastAccountId;
    if (!accountId) {
      const latest = findLatestCookie();
      if (latest) {
        accountId = latest.accountId;
        console.error(`[Worker] Auto-restoring session for: ${accountId}`);
      }
    }
    if (!accountId) throw new Error("请先登录账号后再操作");

    await launch(accountId);
  })();

  _browserLaunchPromise = launchPromise;
  try {
    await launchPromise;
  } finally {
    if (_browserLaunchPromise === launchPromise) _browserLaunchPromise = null;
  }

  if (!browserState.browser || !browserState.context) {
    throw new Error("浏览器启动失败，请重试");
  }
}

export async function launch(accountId, headless) {
  if (browserState.browser && browserState.browser.isConnected() && browserState.context) return;
  // 清理断开的旧引用
  if (browserState.browser && !browserState.browser.isConnected()) {
    console.error("[launch] Browser disconnected, cleaning up before relaunch...");
    browserState.browser = null;
    browserState.context = null;
  }

  browserState.lastAccountId = accountId;
  const dir = path.join(process.env.APPDATA || "", "temu-automation", "cookies");
  fs.mkdirSync(dir, { recursive: true });
  browserState.cookiePath = path.join(dir, `${accountId}.json`);

  const effectiveHeadless = getEffectiveHeadless(headless);
  const slowMo = Math.max(0, Math.round(50 * getDelayScale()));
  const chromeExe = findChromeExe();
  browserState.browser = await chromium.launch({
    executablePath: chromeExe,
    headless: effectiveHeadless,
    slowMo,
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
  const normalizedPhone = normalizeLoginPhone(phone);
  if (!normalizedPhone || !password) {
    throw new Error("缺少登录凭据");
  }

  browserState.lastPhone = normalizedPhone;
  browserState.lastPassword = password;

  // 浏览器可能已崩溃或断开，先确保重建
  if (!browserState.browser || !browserState.browser.isConnected() || !browserState.context) {
    console.error("[login] Browser not available, restarting...");
    browserState.browser = null;
    browserState.context = null;
    await ensureBrowser();
  }

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
    const ph = await findVisibleInput(page, [
      '#usernameId',
      'input[name="usernameId"]',
      'input[placeholder*="手机"]',
      'input[placeholder*="号码"]',
      'input[type="tel"]',
      'input[inputmode="numeric"]',
    ]);
    if (!ph) throw new Error("未找到手机号输入框");
    await ph.click();
    await randomDelay(200, 500);
    await fillInputVerified(ph, normalizedPhone, {
      label: "手机号",
      logPrefix: "[login]",
      normalize: normalizeLoginPhone,
    });
    await randomDelay(800, 1500);

    // 输入密码
    const pw = await findVisibleInput(page, ['#passwordId', 'input[type="password"]']);
    if (!pw) throw new Error("未找到密码输入框");
    await pw.click();
    await randomDelay(200, 500);
    await fillInputVerified(pw, password, {
      label: "密码",
      logPrefix: "[login]",
    });
    await randomDelay(800, 1500);

    // 勾选协议
    try {
      const checkbox = page.locator('input[type="checkbox"]').first();
      if (await checkbox.isVisible({ timeout: 2000 })) {
        if (!(await checkbox.isChecked())) await checkbox.click();
      } else {
        await page.evaluate(() => {
          const setChecked = (input) => {
            try {
              const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
              descriptor?.set?.call(input, true);
            } catch {}
            try { input.checked = true; } catch {}
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          };

          const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
          for (const input of inputs) {
            if (input.checked) return true;
            setChecked(input);
            if (input.checked) return true;
          }

          const candidates = [...document.querySelectorAll('label, [role="checkbox"], [class*="checkbox"], [class*="Checkbox"], span, div')];
          for (const node of candidates) {
            const text = (node.textContent || "").replace(/\s+/g, "");
            if (!text) continue;
            if (text.includes("授权") || text.includes("同意") || text.includes("隐私")) {
              node.click();
              return true;
            }
          }
          return false;
        }).catch(() => {});
      }
    } catch (e) { logSilent("login.checkbox", e); }
    await randomDelay(300, 600);

    // 点击登录
    const btn = await page.waitForSelector('button:has-text("登录")', { timeout: 5000 });
    await btn.click();
    await randomDelay(2000, 3000);

    try {
      const loginHint = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('[class*="error"], [class*="toast"], [class*="tip"], [class*="message"], [role="alert"]')];
        const text = nodes
          .map((node) => (node.textContent || "").trim())
          .filter(Boolean)
          .join(" | ");
        return text.slice(0, 160);
      });
      if (loginHint) {
        console.error(`[login] Hint after submit: ${loginHint}`);
      }
    } catch (e) {
      logSilent("login.hint", e);
    }

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

    // 检查登录结果（排除 seller-login 授权页，那是正常流程）
    if (page.url().includes("login") && !page.url().includes("seller-login")) {
      const cap = await page.locator('[class*="captcha"], [class*="verify"], [class*="slider"], iframe[src*="captcha"]').first().isVisible().catch(() => false);
      if (cap) {
        await page.waitForURL((u) => !u.toString().includes("login"), { timeout: 120000 });
      } else {
        const e = await page.locator('[class*="error"], [class*="toast"], [class*="tip"]').first().textContent().catch(() => "");
        throw new Error(e || "登录失败，请检查账号密码");
      }
    }
    await saveCookies();

    // 处理履约中心授权（可能在当前 page，也可能弹到新的 window/tab）
    const tryHandleAuthOnPage = async (targetPage, tag = "main") => {
      try {
        if (!targetPage || targetPage.isClosed()) return false;
        const url = targetPage.url() || "";
        if (!/seller-login|seller\.kuajingmaihuo\.com|settle|agentseller\.temu/i.test(url)) return false;
        console.error(`[login] [${tag}] handling Seller Central auth at ${url}`);
        await targetPage.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
        await randomDelay(1200, 2200);

        const cbResult = await targetPage.evaluate(() => {
          const tryCheck = (input) => {
            try {
              if (!input.checked) input.click();
              if (!input.checked) {
                const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
                d?.set?.call(input, true);
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
              }
              return input.checked;
            } catch { return false; }
          };
          const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
          for (const cb of inputs) { if (tryCheck(cb)) return "checked input"; }
          const customs = [...document.querySelectorAll('[class*="checkbox"], [class*="Checkbox"], [role="checkbox"]')];
          for (const el of customs) { el.click(); return "clicked custom"; }
          return "not found";
        }).catch(() => "error");
        console.error(`[login] [${tag}] auth checkbox:`, cbResult);
        await randomDelay(400, 800);

        const btnResult = await targetPage.evaluate(() => {
          const keywords = ["确认授权并前往", "确认授权", "确认并前往", "授权登录", "同意并登录", "同意", "进入"];
          const all = [...document.querySelectorAll('button, a, [role="button"], div[class*="btn"], div[class*="Btn"], span[class*="btn"], span[class*="Btn"]')];
          for (const kw of keywords) {
            for (const el of all) {
              const text = (el.innerText || el.textContent || "").trim();
              if (text && text.includes(kw) && text.length < 30) {
                el.click();
                return "clicked: " + text;
              }
            }
          }
          return "not found";
        }).catch(() => "error");
        console.error(`[login] [${tag}] auth enter button:`, btnResult);
        if (typeof btnResult === "string" && btnResult.startsWith("clicked")) {
          await randomDelay(3000, 5000);
          await saveCookies();
          return true;
        }
        return false;
      } catch (e) {
        console.error(`[login] [${tag}] auth handler error:`, e?.message || e);
        return false;
      }
    };

    // 当前页先试一次
    await tryHandleAuthOnPage(page, "main");

    // 扫描 context 中其它已打开的授权窗口，并等待延迟弹出的新窗口最多 10 秒
    const authWaitStart = Date.now();
    let authHandled = false;
    while (Date.now() - authWaitStart < 10000) {
      try {
        const pages = browserState.context.pages();
        for (const p of pages) {
          if (p.isClosed()) continue;
          const u = p.url() || "";
          if (!/seller-login|seller\.kuajingmaihuo\.com\/settle|agentseller\.temu/i.test(u)) continue;
          const hasBtn = await p.evaluate(() => {
            const all = [...document.querySelectorAll('button, a, [role="button"], div[class*="btn"], div[class*="Btn"], span[class*="btn"], span[class*="Btn"]')];
            return all.some((el) => {
              const t = (el.innerText || el.textContent || "").trim();
              return t && (t.includes("确认授权") || t.includes("同意并登录") || t.includes("授权登录"));
            });
          }).catch(() => false);
          if (hasBtn) {
            const ok = await tryHandleAuthOnPage(p, p === page ? "main-retry" : "popup");
            if (ok) { authHandled = true; break; }
          }
        }
      } catch (e) { logSilent("login.auth-scan", e); }
      if (authHandled) break;
      await randomDelay(600, 900);
    }
    console.error(`[login] auth loop done, handled=${authHandled}`);

    return { success: true };
  } catch (err) {
    await captureBrowserErrorScreenshot(page, "login_error");
    throw err;
  } finally {
    if (!page.isClosed()) await page.close().catch(() => {});
  }
}
