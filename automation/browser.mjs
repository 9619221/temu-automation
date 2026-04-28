/**
 * 娴忚鍣ㄧ鐞嗭細鍚姩/鍏抽棴/Cookie/鐧诲綍/瀵艰埅
 * 浠?worker.mjs 鎻愬彇锛屽叡浜?browserState 瀵硅薄
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { randomDelay, logSilent, getAppDataRoot, getDebugDir } from "./utils.mjs";
import { getDelayScale, getEffectiveHeadless, shouldCaptureErrorScreenshots } from "./runtime-config.mjs";

// 鍏变韩鐘舵€侊紙琚?worker.mjs 寮曠敤锛?
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

function normalizeFilledLoginPhone(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11) return digits;
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

async function readInputMeta(input) {
  try {
    return await input.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.id || "",
        name: node.getAttribute("name") || "",
        type: node.getAttribute("type") || "",
        placeholder: node.getAttribute("placeholder") || "",
        autocomplete: node.getAttribute("autocomplete") || "",
        value: node.value || "",
        width: Math.round(rect.width || 0),
        height: Math.round(rect.height || 0),
      };
    });
  } catch {
    return {
      id: "",
      name: "",
      type: "",
      placeholder: "",
      autocomplete: "",
      value: "",
      width: 0,
      height: 0,
    };
  }
}

function isLikelyCountryCodeInput(meta = {}) {
  const value = String(meta?.value || "").trim();
  const placeholder = String(meta?.placeholder || "").trim();
  const id = String(meta?.id || "").trim();
  const name = String(meta?.name || "").trim();
  const width = Number(meta?.width) || 0;

  if (id === "usernameId" || name === "usernameId") return false;
  if (name === "phone" || name === "mobile") return false;
  if (placeholder.includes("鎵嬫満") || placeholder.includes("鍙风爜")) return false;
  if (/^\+\d+$/.test(value)) return true;
  if (!placeholder && !id && !name && width > 0 && width <= 120) return true;
  return false;
}

async function findLoginPhoneInput(page) {
  const selectorGroups = [
    ['#usernameId', 'input[name="usernameId"]'],
    ['input[placeholder]', 'input[aria-label]'],
    ['input[name="phone"]', 'input[name="mobile"]', 'input[autocomplete="username"]'],
    ['input[type="tel"]', 'input[inputmode="numeric"]'],
  ];

  for (const selectors of selectorGroups) {
    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        const visible = await candidate.isVisible().catch(() => false);
        const editable = await candidate.isEditable().catch(() => false);
        if (!visible || !editable) continue;
        const meta = await readInputMeta(candidate);
        if (isLikelyCountryCodeInput(meta)) continue;
        return { input: candidate, meta, selector, index };
      }
    }
  }

  const fallback = await findVisibleInput(page, ['input:not([type="hidden"]):not([disabled])']);
  if (!fallback) return null;
  const meta = await readInputMeta(fallback);
  if (isLikelyCountryCodeInput(meta)) return null;
  return { input: fallback, meta, selector: 'input:not([type="hidden"]):not([disabled])', index: 0 };
}

async function fillInputVerified(input, value, options = {}) {
  const {
    label = "input",
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

  throw new Error(`${label} input verification failed`);
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

// ---- 鏌ユ壘绯荤粺 Chrome ----
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
  throw new Error("鏈壘鍒扮郴缁?Chrome锛岃瀹夎 Google Chrome");
}

// ---- Cookie 绠＄悊 ----
export function findLatestCookie() {
  const dir = path.join(getAppDataRoot(), "cookies");
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

// ---- 娴忚鍣ㄧ敓鍛藉懆鏈?----
let _browserLaunchPromise = null;

export async function ensureBrowser() {
  // 妫€鏌ユ祻瑙堝櫒鏄惁杩樻椿鐫€锛屽凡鍏抽棴鍒欐竻绌哄紩鐢ㄨ涓嬮潰閲嶆柊鍚姩
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
    if (!accountId) throw new Error("Select and log in to a Temu account before using Price Review");

    await launch(accountId);
  })();

  _browserLaunchPromise = launchPromise;
  try {
    await launchPromise;
  } finally {
    if (_browserLaunchPromise === launchPromise) _browserLaunchPromise = null;
  }

  if (!browserState.browser || !browserState.context) {
    throw new Error("browser launch failed, please retry");
  }
}

export async function launch(accountId, headless) {
  if (browserState.browser && browserState.browser.isConnected() && browserState.context) return;
  // 娓呯悊鏂紑鐨勬棫寮曠敤
  if (browserState.browser && !browserState.browser.isConnected()) {
    console.error("[launch] Browser disconnected, cleaning up before relaunch...");
    browserState.browser = null;
    browserState.context = null;
  }

  browserState.lastAccountId = accountId;
  const dir = path.join(getAppDataRoot(), "cookies");
  fs.mkdirSync(dir, { recursive: true });
  browserState.cookiePath = path.join(dir, `${accountId}.json`);

  const effectiveHeadless = getEffectiveHeadless(headless);
  const slowMo = Math.max(0, Math.round(50 * getDelayScale()));
  const chromeExe = findChromeExe();
  browserState.browser = await chromium.launch({
    executablePath: chromeExe,
    headless: effectiveHeadless,
    slowMo,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-features=PasswordManagerOnboarding,AutofillServerCommunication,PasswordLeakDetection",
      "--disable-save-password-bubble",
      "--password-store=basic",
    ],
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

// ---- 鎺堟潈寮圭獥澶勭悊锛堜緵 login 鍜?safeNewPage 鍏辩敤锛?----
const AUTH_URL_PATTERN = /seller-login|seller\.kuajingmaihuo\.com\/settle|agentseller\.temu/i;

export async function handleAuthOnPage(targetPage, tag = "main") {
  try {
    if (!targetPage || targetPage.isClosed()) return false;
    const url = targetPage.url() || "";
    if (!AUTH_URL_PATTERN.test(url)) return false;
    console.error(`[auth] [${tag}] handling Seller Central auth at ${url}`);
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
    console.error(`[auth] [${tag}] auth checkbox:`, cbResult);
    await randomDelay(400, 800);

    const btnResult = await targetPage.evaluate(() => {
      const keywords = ["纭鎺堟潈骞跺墠寰€", "纭鎺堟潈", "纭骞跺墠寰€", "鎺堟潈鐧诲綍", "鍚屾剰骞剁櫥褰?", "鍚屾剰", "杩涘叆", "鍟嗗涓績"];
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
    console.error(`[auth] [${tag}] auth enter button:`, btnResult);
    if (typeof btnResult === "string" && btnResult.startsWith("clicked")) {
      await randomDelay(3000, 5000);
      await saveCookies();
      return true;
    }
    return false;
  } catch (e) {
    console.error(`[auth] [${tag}] handler error:`, e?.message || e);
    return false;
  }
}

// Promise 瓒呮椂鍖呰鍣細瓒呮椂鍒?resolve(defaultVal)锛屼笉浼?reject
function withTimeout(promise, ms, defaultVal, label = "op") {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => {
      logSilent(`timeout.${label}`, new Error(`${label} exceeded ${ms}ms`));
      resolve(defaultVal);
    }, ms)),
  ]);
}

// 鎵弿 context 涓墍鏈夐〉闈紝澶勭悊鎺夐樆濉炵殑鎺堟潈寮圭獥锛堟暣浣?8 绉掔‖瓒呮椂锛屽崟椤?evaluate 3 绉掞級
async function drainPendingAuthPopups(context) {
  if (!context) return;
  const overallTimeoutMs = 8000;
  const perPageEvalTimeoutMs = 3000;
  const perPageAuthTimeoutMs = 4000;

  await withTimeout((async () => {
    try {
      const pages = context.pages();
      for (const p of pages) {
        if (p.isClosed()) continue;
        const url = p.url() || "";
        if (!AUTH_URL_PATTERN.test(url)) continue;
        const hasBtn = await withTimeout(
          p.evaluate(() => {
            const all = [...document.querySelectorAll('button, a, [role="button"], div[class*="btn"], div[class*="Btn"], span[class*="btn"], span[class*="Btn"]')];
            return all.some((el) => {
              const t = (el.innerText || el.textContent || "").trim();
              return t && (t.includes("??") || t.includes("??") || t.includes("??") || t.includes("????"));
            });
          }).catch(() => false),
          perPageEvalTimeoutMs,
          false,
          "drain.evaluate",
        );
        if (hasBtn) {
          await withTimeout(
            handleAuthOnPage(p, "drain").catch(() => false),
            perPageAuthTimeoutMs,
            false,
            "drain.handleAuth",
          );
        }
      }
    } catch (e) {
      logSilent("auth.drain", e);
    }
  })(), overallTimeoutMs, undefined, "drain.overall");
}

// 寮€鏂伴〉鍓嶇殑鍏ㄥ眬浜掓枼锛氬悓涓€鏃跺埢鍙湁涓€涓皟鐢ㄥ湪鎵ц drain + newPage
let _newPageMutex = Promise.resolve();
export async function safeNewPage(context, { skipDrain = false } = {}) {
  const target = context || browserState.context;
  if (!target) throw new Error("browser context unavailable");
  const previous = _newPageMutex;
  let release;
  _newPageMutex = new Promise((resolve) => { release = resolve; });
  try {
    await previous;
    if (!skipDrain) {
      await drainPendingAuthPopups(target);
    }
    return await target.newPage();
  } finally {
    release();
  }
}

// ---- 鐧诲綍 ----
export async function login(phone, password) {
  const normalizedPhone = normalizeLoginPhone(phone);
  if (!normalizedPhone || !password) {
    throw new Error("missing login credentials");
  }

  browserState.lastPhone = normalizedPhone;
  browserState.lastPassword = password;

  // 娴忚鍣ㄥ彲鑳藉凡宕╂簝鎴栨柇寮€锛屽厛纭繚閲嶅缓
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

    // 鍒囨崲鍒般€岃处鍙风櫥褰曘€峵ab
    try {
      const accountTab = page.locator('text=璐﹀彿鐧诲綍').first();
      if (await accountTab.isVisible({ timeout: 5000 })) {
        await accountTab.click();
        await randomDelay(1000, 2000);
      }
    } catch (e) { logSilent("login.tab", e); }

    // 杈撳叆鎵嬫満鍙?
    const phoneTarget = await findLoginPhoneInput(page);
    const ph = phoneTarget?.input || null;
    // Use the dedicated phone selector so we do not target the +86 country-code field.
    if (!ph) throw new Error("phone input not found");
    console.error(
      `[login] Using phone input selector=${phoneTarget.selector} index=${phoneTarget.index} id=${phoneTarget.meta?.id || "-"} name=${phoneTarget.meta?.name || "-"} width=${phoneTarget.meta?.width || 0}`
    );
    await ph.click();
    await randomDelay(200, 500);
    await fillInputVerified(ph, normalizedPhone, {
      label: "phone",
      logPrefix: "[login]",
      normalize: normalizeFilledLoginPhone,
    });
    await randomDelay(800, 1500);

    // 杈撳叆瀵嗙爜
    const pw = await findVisibleInput(page, ['#passwordId', 'input[type="password"]']);
    if (!pw) throw new Error("password input not found");
    await pw.click();
    await randomDelay(200, 500);
    await fillInputVerified(pw, password, {
      label: "瀵嗙爜",
      logPrefix: "[login]",
    });
    await randomDelay(800, 1500);

    // 鍕鹃€夊崗璁?
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
            if (text.includes("鎺堟潈") || text.includes("鍚屾剰") || text.includes("闅愮")) {
              node.click();
              return true;
            }
          }
          return false;
        }).catch(() => {});
      }
    } catch (e) { logSilent("login.checkbox", e); }
    await randomDelay(300, 600);

    // 鐐瑰嚮鐧诲綍
    const btn = await page.waitForSelector('button:has-text("鐧诲綍")', { timeout: 5000 });
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

    // 澶勭悊闅愮寮圭獥
    try {
      const agreeBtn = page.locator('button:has-text("??"), button:has-text("??"), a:has-text("????")').first();
      if (await agreeBtn.isVisible({ timeout: 3000 })) {
        await agreeBtn.click();
        await randomDelay(1000, 2000);
      }
    } catch (e) { logSilent("login.agree", e); }

    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
    await randomDelay(3000, 5000);

    // 妫€鏌ョ櫥褰曠粨鏋滐紙鎺掗櫎 seller-login 鎺堟潈椤碉紝閭ｆ槸姝ｅ父娴佺▼锛?
    if (page.url().includes("login") && !page.url().includes("seller-login")) {
      const cap = await page.locator('[class*="captcha"], [class*="verify"], [class*="slider"], iframe[src*="captcha"]').first().isVisible().catch(() => false);
      if (cap) {
        await page.waitForURL((u) => !u.toString().includes("login"), { timeout: 120000 });
      } else {
        const e = await page.locator('[class*="error"], [class*="toast"], [class*="tip"]').first().textContent().catch(() => "");
        throw new Error(e || "login failed, please check credentials");
      }
    }
    await saveCookies();

    // 澶勭悊灞ョ害涓績鎺堟潈锛堝彲鑳藉湪褰撳墠 page锛屼篃鍙兘寮瑰埌鏂扮殑 window/tab锛?
    // 褰撳墠椤靛厛璇曚竴娆?
    await handleAuthOnPage(page, "main");

    // 鎵弿 context 涓叾瀹冨凡鎵撳紑鐨勬巿鏉冪獥鍙ｏ紝骞剁瓑寰呭欢杩熷脊鍑虹殑鏂扮獥鍙ｆ渶澶?10 绉?
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
              return t && (t.includes("??") || t.includes("??") || t.includes("??") || t.includes("????"));
            });
          }).catch(() => false);
          if (hasBtn) {
            const ok = await handleAuthOnPage(p, p === page ? "main-retry" : "popup");
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
