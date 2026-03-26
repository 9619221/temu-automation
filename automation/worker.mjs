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
let _navLiteMode = false; // scrape_all 时启用 lite 模式，弹窗交给监控器

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
let _browserLaunchPromise = null;
async function ensureBrowser() {
  if (browser && context) return;

  // 并发锁：多个请求同时到达时，只启动一次浏览器
  if (_browserLaunchPromise) {
    await _browserLaunchPromise;
    return;
  }

  _browserLaunchPromise = (async () => {
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
  })();

  try {
    await _browserLaunchPromise;
  } finally {
    _browserLaunchPromise = null;
  }
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
async function navigateToSellerCentral(page, targetPath, options = {}) {
  const lite = options.lite || _navLiteMode; // lite 模式：不处理弹窗，交给外部监控器
  const directUrl = `https://agentseller.temu.com${targetPath}`;
  console.error(`[nav] Navigating to ${directUrl} (lite=${lite})`);
  await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  // 等待可能的重定向
  await randomDelay(3000, 5000);
  // 等 URL 稳定
  await page.waitForURL(/.*/, { timeout: 10000 }).catch(() => {});
  console.error(`[nav] Current URL: ${page.url()}`);

  // lite 模式：如果被重定向到 authentication，等待弹窗监控器处理后重试
  if (lite && (page.url().includes("/main/authentication") || page.url().includes("/main/entry"))) {
    console.error("[nav-lite] On authentication page, waiting for popup monitor to handle...");
    // 先点击"商家中心 >"触发弹窗（让监控器接管）
    try {
      const gotoBtn = page.locator('[class*="authentication_goto"]').first();
      if (await gotoBtn.isVisible({ timeout: 3000 })) {
        await gotoBtn.click();
        console.error("[nav-lite] Clicked authentication_goto to trigger popup");
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
      }
    } catch {}

    // 等待弹窗被监控器处理（最多60秒）
    for (let retry = 0; retry < 12; retry++) {
      await randomDelay(5000, 5000);
      // 尝试重新导航
      try {
        await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await randomDelay(2000, 3000);
        if (!page.url().includes("/main/authentication") && !page.url().includes("/main/entry")) {
          console.error(`[nav-lite] Successfully navigated after ${retry + 1} retries, URL: ${page.url()}`);
          break;
        }
      } catch {}
      console.error(`[nav-lite] Still on auth page, retry ${retry + 1}/12...`);
    }

    // 关闭页面弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }
    console.error(`[nav-lite] Final URL: ${page.url()}`);
    return page;
  }

  // 情况1：被重定向到 agentseller 的认证/入口页面
  if (page.url().includes("/main/authentication") || page.url().includes("/main/entry")) {
    console.error("[nav] On authentication page, trying entry flow...");

    // 等待微前端加载
    for (let wait = 0; wait < 10; wait++) {
      const hasContent = await page.evaluate(() => {
        const root = document.querySelector('#root');
        return root && root.innerHTML.length > 10;
      });
      if (hasContent) { console.error(`[nav] Micro-app loaded after ${wait}s`); break; }
      await randomDelay(1000, 1500);
    }
    await randomDelay(2000, 3000);

    // 保存截图用于调试
    const debugDir2 = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
    fs.mkdirSync(debugDir2, { recursive: true });
    await page.screenshot({ path: path.join(debugDir2, "entry_page.png"), fullPage: true }).catch(() => {});

    // ★ 优先方案：在当前页面直接找"进入"按钮（Seller Central 授权页面）
    // 页面结构：勾选授权复选框 → 点击"进入 >"按钮
    console.error("[nav] Step A: Try checkbox + 进入 button on current page...");

    // A1: 勾选授权复选框
    const cbResult = await page.evaluate(() => {
      // 标准 checkbox
      const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
      for (const cb of inputs) { if (!cb.checked) { cb.click(); return "checked input"; } return "already checked"; }
      // 自定义 checkbox
      const customs = [...document.querySelectorAll('[class*="checkbox"], [class*="Checkbox"], [role="checkbox"], label')];
      for (const el of customs) {
        const text = el.innerText || el.textContent || "";
        if (text.includes("授权") || text.includes("同意") || el.className?.toString().toLowerCase().includes("checkbox")) {
          el.click(); return "clicked custom: " + el.tagName;
        }
      }
      return "no checkbox found";
    });
    console.error("[nav] Checkbox result:", cbResult);
    await randomDelay(500, 1000);

    // A2: 点击"进入 >"按钮
    const enterResult = await page.evaluate(() => {
      const keywords = ["进入", "确认授权并前往", "确认授权", "确认并前往"];
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
    console.error("[nav] Enter button result:", enterResult);

    if (enterResult !== "not found") {
      await randomDelay(5000, 8000);
      console.error(`[nav] After enter click, URL: ${page.url()}`);
    }

    // ★ 如果"进入"按钮没有找到或仍在 authentication 页面，走 popup 流程
    if (page.url().includes("/main/authentication") || page.url().includes("/main/entry")) {
      console.error("[nav] Step B: Try popup flow (authentication_goto)...");

      // ★ 先检查是否已经有 popup 窗口打开了（可能在页面加载时就弹出了）
      let popup = context.pages().find(p =>
        p !== page && (p.url().includes("kuajingmaihuo.com") || p.url().includes("seller-login"))
      );
      if (popup) {
        console.error("[nav] Found existing popup:", popup.url());
      } else {
        // 注册事件监听，然后点击触发 popup
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

        popup = await popupPromise;

        // 如果 waitForEvent 没拿到，再检查一次 context.pages()
        if (!popup) {
          popup = context.pages().find(p =>
            p !== page && (p.url().includes("kuajingmaihuo.com") || p.url().includes("seller-login"))
          );
          if (popup) console.error("[nav] Found popup via context.pages() fallback:", popup.url());
        }
      }

      if (popup) {
        console.error(`[nav] Popup opened: ${popup.url()}`);
        await popup.waitForLoadState("domcontentloaded").catch(() => {});
        await randomDelay(3000, 5000);
        console.error(`[nav] Popup URL: ${popup.url()}`);

        // 判断 popup 是登录页还是授权确认页
        if (popup.url().includes("seller-login") || popup.url().includes("/login")) {
          // Popup 打开了 seller-login，可能是：
          // A) cookie 有效 → 自动登录后弹出"确认授权并前往"弹窗（URL 不变）
          // B) cookie 过期 → 需要用户手动登录
          console.error("[nav] Popup is login page, waiting for auth dialog or login...");
          await randomDelay(3000, 5000);

          // 先检查是否已经出现了授权确认弹窗（cookie 自动登录成功的情况）
          async function tryAuthInPopup() {
            try {
              const text = await popup.evaluate(() => document.body?.innerText || "");
              console.error("[nav] Popup body text length:", text.length, "contains auth:", text.includes("确认授权"), "contains 即将前往:", text.includes("即将前往"));
              if (text.includes("确认授权") || text.includes("即将前往") || text.includes("Seller Central")) {
                console.error("[nav] Auth dialog found in popup! Handling...");

                // 方式1：用 Playwright locator 勾选 checkbox
                try {
                  const cb = popup.locator('input[type="checkbox"]').first();
                  if (await cb.isVisible({ timeout: 2000 })) {
                    const checked = await cb.isChecked().catch(() => false);
                    if (!checked) { await cb.click(); console.error("[nav] Clicked checkbox via locator"); }
                    else console.error("[nav] Checkbox already checked");
                  } else {
                    // 找包含"授权"文字的 label 或 checkbox 容器
                    const authLabel = popup.locator('text=授权').first();
                    if (await authLabel.isVisible({ timeout: 1000 })) {
                      await authLabel.click();
                      console.error("[nav] Clicked auth label");
                    }
                  }
                } catch (e) {
                  console.error("[nav] Checkbox click error:", e.message);
                  // fallback: evaluate
                  await popup.evaluate(() => {
                    const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
                    for (const cb of inputs) { if (!cb.checked) cb.click(); }
                    const customs = [...document.querySelectorAll('[class*="checkbox"], [class*="Checkbox"], [role="checkbox"], label')];
                    for (const el of customs) {
                      const t = el.innerText || "";
                      if (t.includes("授权") || t.includes("同意")) { el.click(); break; }
                    }
                  });
                }
                await randomDelay(800, 1500);

                // 方式1：用 Playwright locator 点击"确认授权并前往"
                let btnClicked = false;
                try {
                  const btn = popup.locator('button:has-text("确认授权并前往")').first();
                  if (await btn.isVisible({ timeout: 2000 })) {
                    await btn.click();
                    console.error("[nav] Clicked '确认授权并前往' via locator");
                    btnClicked = true;
                  }
                } catch {}
                if (!btnClicked) {
                  try {
                    const btn2 = popup.locator('button:has-text("确认授权")').first();
                    if (await btn2.isVisible({ timeout: 1000 })) {
                      await btn2.click();
                      console.error("[nav] Clicked '确认授权' via locator");
                      btnClicked = true;
                    }
                  } catch {}
                }
                if (!btnClicked) {
                  // fallback: evaluate
                  const btnResult = await popup.evaluate(() => {
                    const keywords = ["确认授权并前往", "确认授权", "确认并前往", "进入"];
                    const all = [...document.querySelectorAll('button, [role="button"], a, div[class*="btn"], div[class*="Btn"]')];
                    for (const kw of keywords) {
                      for (const el of all) {
                        const text = (el.innerText || "").trim();
                        if (text.includes(kw) && text.length < 20) { el.click(); return "clicked: " + text; }
                      }
                    }
                    return "not found";
                  });
                  console.error("[nav] Popup auth button (fallback):", btnResult);
                  btnClicked = btnResult !== "not found";
                }

                if (btnClicked) {
                  await randomDelay(5000, 8000);
                  await saveCookies();
                  return true;
                }
              }
            } catch (e) {
              console.error("[nav] tryAuthInPopup error:", e.message);
            }
            return false;
          }

          // 尝试最多30秒等待弹窗出现
          let authHandled = false;
          for (let attempt = 0; attempt < 6; attempt++) {
            authHandled = await tryAuthInPopup();
            if (authHandled) break;
            console.error(`[nav] Auth dialog not found yet, attempt ${attempt + 1}/6...`);
            await randomDelay(3000, 5000);
          }

          if (!authHandled) {
            // 没有授权弹窗 → cookie 真的过期了，等用户手动登录
            console.error("[nav] No auth dialog, waiting for user manual login (max 2min)...");

            // 勾选 checkbox（隐私政策）
            try {
              const cb = popup.locator('input[type="checkbox"]').first();
              if (await cb.isVisible({ timeout: 2000 })) {
                const checked = await cb.isChecked();
                if (!checked) await cb.click();
              }
            } catch {}

            try {
              // 等待 URL 变化或授权弹窗出现
              await Promise.race([
                popup.waitForURL((u) => !u.toString().includes("/login") && !u.toString().includes("seller-login"), { timeout: 120000 }),
                (async () => {
                  for (let i = 0; i < 24; i++) {
                    await randomDelay(5000, 5000);
                    if (await tryAuthInPopup()) return;
                  }
                })(),
              ]);
              console.error("[nav] Login/auth completed, popup URL:", popup.url());
              await randomDelay(3000, 5000);
            } catch {
              console.error("[nav] Login timeout");
            }
            await saveCookies();
          }
        } else {
          // Popup 是授权确认页（包括 kuajingmaihuo.com 授权页）
          console.error("[nav] Popup is auth confirmation page, URL:", popup.url());
          await randomDelay(2000, 3000);

          // 用 locator 方式勾选 checkbox
          try {
            const cb = popup.locator('input[type="checkbox"]').first();
            if (await cb.isVisible({ timeout: 3000 })) {
              const checked = await cb.isChecked().catch(() => false);
              if (!checked) { await cb.click(); console.error("[nav] Popup: checked checkbox via locator"); }
            } else {
              const authLabel = popup.locator('text=授权').first();
              if (await authLabel.isVisible({ timeout: 1000 })) await authLabel.click();
            }
          } catch {}

          // 用 locator 方式点击确认按钮
          let popupBtnClicked = false;
          try {
            const btn = popup.locator('button:has-text("确认授权并前往")').first();
            if (await btn.isVisible({ timeout: 2000 })) {
              await btn.click();
              console.error("[nav] Popup: clicked '确认授权并前往' via locator");
              popupBtnClicked = true;
            }
          } catch {}
          if (!popupBtnClicked) {
            try {
              const btn2 = popup.locator('button:has-text("确认授权")').first();
              if (await btn2.isVisible({ timeout: 1000 })) {
                await btn2.click();
                console.error("[nav] Popup: clicked '确认授权' via locator");
                popupBtnClicked = true;
              }
            } catch {}
          }

          // fallback: evaluate 方式
          if (!popupBtnClicked) {
            await popup.evaluate(() => {
              const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
              for (const cb of inputs) { if (!cb.checked) cb.click(); }
              const customs = [...document.querySelectorAll('[class*="checkbox"], [class*="Checkbox"], [role="checkbox"], label')];
              for (const el of customs) {
                const text = el.innerText || "";
                if (text.includes("授权") || text.includes("同意")) { el.click(); break; }
              }
            });
            await randomDelay(500, 1000);
            const popupBtn = await popup.evaluate(() => {
              const keywords = ["确认授权并前往", "确认授权", "确认并前往", "进入"];
              const all = [...document.querySelectorAll('button, [role="button"], a, div[class*="btn"], div[class*="Btn"], span[class*="btn"]')];
              for (const kw of keywords) {
                for (const el of all) {
                  const text = (el.innerText || "").trim();
                  if (text.includes(kw) && text.length < 20) { el.click(); return "clicked: " + text; }
                }
              }
              return "not found";
            });
            console.error("[nav] Popup confirm (fallback):", popupBtn);
            if (popupBtn !== "not found") await randomDelay(5000, 8000);
          }
        }

        // 点击确认后，等待跳转发生
        console.error("[nav] Waiting for redirect after auth confirm...");
        await randomDelay(5000, 8000);

        // 检查 popup 是否跳转了（不要关闭，让浏览器自己处理）
        try {
          if (!popup.isClosed()) {
            console.error("[nav] Popup still open, URL:", popup.url());
            // popup 可能跳转到了 agentseller
            if (popup.url().includes("agentseller.temu.com") && !popup.url().includes("authentication")) {
              console.error("[nav] Popup redirected to agentseller, using as main page");
              page = popup;
            } else {
              // 等待 popup 跳转
              try {
                await popup.waitForURL((u) => u.toString().includes("agentseller.temu.com"), { timeout: 15000 });
                console.error("[nav] Popup redirected to:", popup.url());
                if (!popup.url().includes("authentication")) {
                  page = popup;
                }
              } catch {
                console.error("[nav] Popup did not redirect, closing...");
                await popup.close().catch(() => {});
              }
            }
          }
        } catch {}

        await randomDelay(2000, 3000);

        // 检查原页面是否也跳转了
        console.error("[nav] Original page URL:", page.url());

        // 如果原页面还在 authentication，直接导航
        if (page.url().includes("/main/authentication")) {
          console.error("[nav] Still on auth, trying direct navigation...");
          await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
          await randomDelay(5000, 8000);
          console.error("[nav] After direct goto, URL:", page.url());

          // 如果现在进入了新的 authentication 页面（有进入按钮的那个）
          if (page.url().includes("/main/authentication")) {
            await randomDelay(3000, 5000);
            // 再试勾选 + 点击进入
            await page.evaluate(() => {
              const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
              for (const cb of inputs) { if (!cb.checked) cb.click(); }
              const customs = [...document.querySelectorAll('[class*="checkbox"], [class*="Checkbox"], [role="checkbox"], label')];
              for (const el of customs) {
                const t = el.innerText || "";
                if (t.includes("授权") || t.includes("同意")) { el.click(); break; }
              }
            });
            await randomDelay(500, 1000);
            const enterResult2 = await page.evaluate(() => {
              const keywords = ["进入", "确认授权并前往", "确认授权"];
              const all = [...document.querySelectorAll('button, [role="button"], a, div[class*="btn"], div[class*="Btn"], span[class*="btn"]')];
              for (const kw of keywords) {
                for (const el of all) {
                  const text = (el.innerText || "").trim();
                  if (text.includes(kw) && text.length < 20) { el.click(); return "clicked: " + text; }
                }
              }
              return "not found";
            });
            console.error("[nav] Enter button (retry):", enterResult2);
            if (enterResult2 !== "not found") await randomDelay(5000, 8000);
          }
        }

        // 最终检查所有页面
        const pages = context.pages();
        console.error(`[nav] After full auth flow, ${pages.length} pages:`);
        for (const p of pages) console.error(`  - ${p.url()}`);
        const targetPage = pages.find(p =>
          p.url().includes("agentseller.temu.com") && !p.url().includes("authentication")
        );
        if (targetPage && targetPage !== page) {
          console.error("[nav] Found target page, switching");
          page = targetPage;
        }
      } else {
        console.error("[nav] No popup, trying same-page fallback...");
        await randomDelay(2000, 3000);
      }
    }

    // 导航到目标页面
    if (page.url().includes("/main/authentication") || !page.url().includes(targetPath)) {
      console.error("[nav] Still on auth, trying direct goto...");
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

// ---- 抓取商品 (保存完整原始API数据) ----

async function scrapeProducts() {
  return scrapePageCaptureAll("/goods/list");
}


// ---- 抓取备货单 (API 方式) ----

async function scrapeOrders() {
  return scrapePageCaptureAll("/stock/fully-mgt/order-manage");
}

// ---- 抓取流量分析数据 (API 方式) ----

async function scrapeFluxAnalysis() {
  return scrapePageCaptureAll("/main/flux-analysis-full");
}

// ---- 抓取首页仪表盘数据 (API 方式) ----

async function scrapeHomeDashboard() {
  return scrapePageCaptureAll("/", { waitTime: 12000 });
}

// ---- 抓取售后管理数据 (API 方式) ----

async function scrapeAfterSales() {
  return scrapePageCaptureAll("/main/aftersales/information");
}

// ---- 抓取售罄看板数据 (API 方式) ----

async function scrapeSoldOutBoard() {
  return scrapePageCaptureAll("/stock/fully-mgt/sale-manage/board/sku-sale-out");
}

// ---- 抓取商品数据中心 (API 方式 - 通过 response 监听) ----

async function scrapeGoodsData() {
  // 保存完整原始API数据（不做字段筛选，由前端处理）
  return scrapePageCaptureAll("/newon/goods-data");
}

// ---- 抓取活动数据 (API 方式 - 通过 response 监听) ----

async function scrapeActivityData() {
  return scrapePageCaptureAll("/main/act/data-full");
}

// ---- 抓取履约看板数据 (API 方式 - 通过 response 监听) ----

async function scrapePerformanceBoard() {
  return scrapePageCaptureAll("/stock/fully-mgt/sale-manage/board/count");
}

async function scrapeMainPages() {
  return scrapePageCaptureAll("/");
}

// ---- 抓取销售管理数据 (翻页采集所有商品库存) ----

async function scrapeSales() {
  // 使用通用捕获器 + 翻页逻辑
  const page = await context.newPage();
  const capturedApis = [];
  const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];
  const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', '_stm', 'msgBox', 'hot-update', 'sockjs', 'hm.baidu', 'google', 'favicon', 'drogon-api', 'report/uin'];

  try {
    // 捕获所有 API（和 scrapePageCaptureAll 一样的通用逻辑）
    page.on("response", async (resp) => {
      try {
        const url = resp.url();
        if (staticExts.some(ext => url.includes(ext))) return;
        if (frameworkPatterns.some(p => url.includes(p))) return;
        if (resp.status() === 200) {
          const ct = resp.headers()["content-type"] || "";
          if (ct.includes("json") || ct.includes("application")) {
            const body = await resp.json().catch(() => null);
            if (body && (body.result !== undefined || body.success !== undefined)) {
              const u = new URL(url);
              capturedApis.push({ path: u.pathname, data: body });
              console.error(`[sales] Captured: ${u.pathname}`);
            }
          }
        }
      } catch {}
    });

    // 导航到销售管理页面
    console.error("[sales] Navigating to sale-manage/main...");
    await navigateToSellerCentral(page, "/stock/fully-mgt/sale-manage/main");
    await randomDelay(10000, 12000);

    // 关闭弹窗
    for (let i = 0; i < 8; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }
    await randomDelay(3000, 5000);

    // 检查第一页的 listOverall 是否有 total > 10（需要翻页）
    const firstListApi = capturedApis.find(a => a.path?.includes("listOverall"));
    const total = firstListApi?.data?.result?.total || 0;
    const pageSize = firstListApi?.data?.result?.subOrderList?.length || 10;
    const totalPages = Math.ceil(total / pageSize);
    console.error(`[sales] Total: ${total} products, ${totalPages} pages`);

    if (totalPages > 1) {
      // Temu API 需要 anti-content 签名，只能通过点击分页按钮翻页
      // 用 page.evaluate 查找并点击分页元素
      for (let pageNum = 2; pageNum <= Math.min(totalPages, 30); pageNum++) {
        try {
          const clicked = await page.evaluate((pn) => {
            // 方法1: 找所有看起来像分页的元素
            const allLinks = document.querySelectorAll('a, button, li, span');
            for (const el of allLinks) {
              // 找页码数字
              if (el.textContent?.trim() === String(pn) && el.offsetParent !== null) {
                const rect = el.getBoundingClientRect();
                // 分页通常在页面底部，宽度小于100
                if (rect.width < 100 && rect.width > 10 && rect.bottom > 300) {
                  el.click();
                  return 'page-number';
                }
              }
            }
            // 方法2: 找"下一页"按钮 (通常是一个 > 图标)
            const nextBtns = document.querySelectorAll('[class*="next"], [aria-label*="next"], [aria-label*="Next"]');
            for (const btn of nextBtns) {
              if (btn.offsetParent !== null && !btn.classList.contains('disabled') && !btn.hasAttribute('disabled')) {
                btn.click();
                return 'next-button';
              }
            }
            // 方法3: 找 SVG 右箭头
            const svgs = document.querySelectorAll('svg');
            for (const svg of svgs) {
              const parent = svg.closest('button, a, li, span');
              if (parent && parent.offsetParent !== null) {
                const rect = parent.getBoundingClientRect();
                if (rect.bottom > 400 && rect.width < 60) {
                  // 检查是否是右箭头（在分页区域的右侧）
                  const siblings = parent.parentElement?.children;
                  if (siblings && parent === siblings[siblings.length - 1]) {
                    parent.click();
                    return 'svg-arrow';
                  }
                }
              }
            }
            return null;
          }, pageNum);

          if (clicked) {
            console.error(`[sales] → page ${pageNum}/${totalPages} (via ${clicked})`);
            await randomDelay(3000, 5000);
          } else {
            console.error(`[sales] Cannot find page ${pageNum} button, stopping`);
            break;
          }
        } catch (e) {
          console.error(`[sales] Page ${pageNum} click failed: ${e.message}`);
          break;
        }
      }
    }

    console.error(`[sales] Done! Captured ${capturedApis.length} APIs`);
    await saveCookies();
    return { apis: capturedApis };
  } finally {
    await page.close();
  }
}

// ---- 通用 response-listener 采集器 ----
// 用一个通用函数，通过 response listener 抓取指定页面的 API 数据
// 通用：捕获页面所有API响应（保存完整原始数据）
async function scrapePageCaptureAll(targetPath, options = {}) {
  const { waitTime = 10000, fullUrl = null } = options;
  const page = await context.newPage();
  const capturedApis = [];
  const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];
  const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', '_stm', 'msgBox', 'hot-update', 'sockjs', 'hm.baidu', 'google', 'favicon', 'drogon-api', 'report/uin'];

  try {
    page.on("response", async (resp) => {
      try {
        const url = resp.url();
        if (staticExts.some(ext => url.includes(ext))) return;
        if (frameworkPatterns.some(p => url.includes(p))) return;
        if (resp.status() === 200) {
          const ct = resp.headers()["content-type"] || "";
          if (ct.includes("json") || ct.includes("application")) {
            const body = await resp.json().catch(() => null);
            if (body && (body.result !== undefined || body.success !== undefined)) {
              const u = new URL(url);
              capturedApis.push({ path: u.pathname, data: body });
              console.error(`[capture-all] Captured: ${u.pathname}`);
            }
          }
        }
      } catch {}
    });

    if (fullUrl) {
      console.error(`[capture-all] Navigating to ${fullUrl}...`);
      // 先进入 agentseller 获取认证上下文
      await navigateToSellerCentral(page, "/goods/list");
      await randomDelay(2000, 3000);
      await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    } else {
      console.error(`[capture-all] Navigating to ${targetPath}...`);
      await navigateToSellerCentral(page, targetPath);
    }
    await randomDelay(waitTime, waitTime + 3000);

    for (let i = 0; i < 8; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不"), button:has-text("去处理")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }
    await randomDelay(3000, 5000);

    console.error(`[capture-all] Done! Captured ${capturedApis.length} APIs`);
    await saveCookies();
    return { apis: capturedApis };
  } finally {
    await page.close();
  }
}

async function scrapePageWithListener(targetPath, apiMatchers, options = {}) {
  const { waitTime = 10000, reloadIfMissing = true } = options;
  const page = await context.newPage();
  const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  fs.mkdirSync(debugDir, { recursive: true });
  const captured = {};

  try {
    // 注册 response listener
    page.on("response", async (resp) => {
      try {
        const url = resp.url();
        for (const matcher of apiMatchers) {
          if (url.includes(matcher.pattern) && resp.status() === 200) {
            const data = await resp.json().catch(() => null);
            if (data) {
              captured[matcher.key] = data;
              console.error(`[scrape-listener] Captured: ${matcher.key}`);
            }
          }
        }
      } catch {}
    });

    // 导航
    console.error(`[scrape-listener] Navigating to ${targetPath}...`);
    await navigateToSellerCentral(page, targetPath);
    await randomDelay(waitTime, waitTime + 3000);

    // 关闭弹窗
    for (let i = 0; i < 8; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不"), button:has-text("去处理")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }
    await randomDelay(3000, 5000);

    // 检查是否所有 API 都已捕获
    const allKeys = apiMatchers.map(m => m.key);
    const missing = allKeys.filter(k => !captured[k]);
    console.error(`[scrape-listener] Captured: ${Object.keys(captured).join(",")} | Missing: ${missing.join(",") || "none"}`);

    // reload 重试
    if (reloadIfMissing && missing.length > 0) {
      console.error("[scrape-listener] Reloading to capture missing APIs...");
      await page.reload({ waitUntil: "domcontentloaded" });
      await randomDelay(waitTime, waitTime + 3000);
      for (let i = 0; i < 5; i++) {
        try {
          const btn = page.locator('button:has-text("知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
          if (await btn.isVisible({ timeout: 500 })) await btn.click();
          else break;
        } catch { break; }
      }
      await randomDelay(3000, 5000);
      const missing2 = allKeys.filter(k => !captured[k]);
      console.error(`[scrape-listener] After reload - Missing: ${missing2.join(",") || "none"}`);
    }

    await saveCookies();
    return captured;
  } finally {
    await page.close();
  }
}

// ---- 新增采集函数 ----

// 上新生命周期管理
async function scrapeProductLifecycle() {
  return scrapePageCaptureAll("/newon/product-select");
}

// 机会商品（竞标）
async function scrapeBiddingOpportunity() {
  return scrapePageWithListener("/newon/invite-bids/list", [
    { key: "isAutoBidding", pattern: "isAutoBiddingOpen" },
    { key: "recommendProducts", pattern: "recommendBiddingProducts" },
    { key: "biddingWindows", pattern: "queryAutoBiddingOrderWindows" },
    { key: "tabCount", pattern: "queryBiddingTabCount" },
    { key: "invitationList", pattern: "queryBiddingInvitationOrderList" },
  ]);
}

// 商品价格管理
async function scrapePriceCompete() {
  return scrapePageWithListener("/newon/compete-manager", [
    { key: "priceCompete", pattern: "PriceComparingOrderSupplierRpcService/searchForSupplier" },
  ]);
}

// 爆款扶持计划
async function scrapeHotPlan() {
  return scrapePageWithListener("/newon/hot-prop-plan-home", [
    { key: "hotPlanHome", pattern: "bsr/query/homepage" },
  ]);
}

// 体检中心
async function scrapeCheckupCenter() {
  return scrapePageWithListener("/goods/checkup-center", [
    { key: "checkScore", pattern: "lucina-agent-seller/check/score" },
  ]);
}

// 发货表现评估看板
async function scrapeDeliveryAssessment() {
  return scrapePageWithListener("/wms/deliver-examine-board", [
    { key: "forwardSummary", pattern: "querySupplierForwardSummary" },
    { key: "period", pattern: "queryDeliveryAssessmentPeriod" },
    { key: "record", pattern: "queryDeliveryAssessmentRecord" },
    { key: "rightPunish", pattern: "queryAssessmentRightPunish" },
    { key: "recordDetail", pattern: "queryDeliveryAssessmentRecordDetail" },
  ]);
}

// 市场分析
async function scrapeMarketAnalysis() {
  return scrapePageWithListener("/main/market-analysis", [
    { key: "categoryList", pattern: "category/index/listV2" },
    { key: "publishCategories", pattern: "category/supplier/publish/list" },
    { key: "siteList", pattern: "common/site/semi/list" },
    { key: "siteConfig", pattern: "common/site/config" },
  ]);
}

// 商品条码管理
async function scrapeLabelCode() {
  return scrapePageWithListener("/goods/label", [
    { key: "labelList", pattern: "labelcode/pageQuery" },
    { key: "countdown", pattern: "labelcode/newStyle/countdown" },
    { key: "certConfig", pattern: "label/cert/config/query" },
  ]);
}

// 备货抽真空
async function scrapeVacuumPumping() {
  return scrapePageWithListener("/goods/stocking-vacuum", [
    { key: "vacuumList", pattern: "vacuumPumping/pageQuery" },
  ]);
}

// 紧急备货建议
async function scrapeUrgentOrders() {
  return scrapePageWithListener("/stock/fully-mgt/order-manage-urgency", [
    { key: "orderList", pattern: "purchase/manager/querySubOrderList" },
    { key: "popUpNotice", pattern: "purchase/manager/queryPopUpNotice" },
    { key: "enumData", pattern: "management/common/queryEnum" },
    { key: "mergeConfig", pattern: "merge/operate/queryMergeOperateConfig" },
    { key: "businessConfig", pattern: "business/config/queryBusinessConfig" },
    { key: "protocolSigned", pattern: "queryProtocolSigned" },
    { key: "suggestCloseJit", pattern: "querySuggestCloseJitSkc" },
  ]);
}

// 商品草稿
async function scrapeGoodsDraft() {
  return scrapePageWithListener("/goods/draft", [
    { key: "draftList", pattern: "product/draft" },
  ], { waitTime: 8000 });
}

// 保税商品管理
async function scrapeBondedGoods() {
  return scrapePageWithListener("/goods/bonded", [
    { key: "bondedList", pattern: "bonded" },
  ], { waitTime: 8000 });
}

// 收货入库异常看板
async function scrapeReceiveAbnormal() {
  return scrapePageWithListener("/stock/fully-mgt/sale-manage/board/receive-abnormal", [
    { key: "weekInfo", pattern: "queryPastSeveralWeekInfo" },
    { key: "exceptionDetail", pattern: "queryWeekReceiveExceptionDetailInfo" },
    { key: "totalInfo", pattern: "queryPast12WeekReceiveExceptionTotalInfo" },
  ]);
}

// ---- 通用侧边栏全量API捕获 ----
async function scrapeSidebarCaptureAll(menuText, options = {}) {
  const { waitTime = 12000 } = options;
  const page = await context.newPage();
  const capturedApis = [];
  const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];
  const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', '_stm', 'msgBox', 'hot-update', 'sockjs', 'hm.baidu', 'google', 'favicon', 'drogon-api', 'report/uin'];

  try {
    const handler = async (resp) => {
      try {
        const url = resp.url();
        if (staticExts.some(ext => url.includes(ext))) return;
        if (frameworkPatterns.some(p => url.includes(p))) return;
        if (resp.status() === 200) {
          const ct = resp.headers()["content-type"] || "";
          if (ct.includes("json") || ct.includes("application")) {
            const body = await resp.json().catch(() => null);
            if (body && (body.result !== undefined || body.success !== undefined)) {
              const u = new URL(url);
              capturedApis.push({ path: u.pathname, data: body });
              console.error("[sidebar-capture] Captured: " + u.pathname);
            }
          }
        }
      } catch {}
    };
    page.on("response", handler);

    // 先导航到 agentseller
    console.error("[sidebar-capture] Navigating to agentseller...");
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(3000, 5000);

    // 关闭弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
        if (await btn.isVisible({ timeout: 800 })) await btn.click();
        else break;
      } catch { break; }
    }

    // 展开侧边栏菜单并点击目标
    console.error("[sidebar-capture] Looking for menu: " + menuText);
    const menuSelectors = [
      'a:has-text("' + menuText + '")',
      'span:has-text("' + menuText + '")',
      'div:has-text("' + menuText + '")',
      'li:has-text("' + menuText + '")',
    ];
    let clicked = false;
    for (const sel of menuSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) {
          await el.click();
          clicked = true;
          console.error("[sidebar-capture] Clicked menu: " + menuText);
          break;
        }
      } catch {}
    }
    if (!clicked) {
      // 尝试展开父菜单
      const parentMenus = ["备货管理", "库存管理", "商品管理", "销售管理", "质量管理"];
      for (const parent of parentMenus) {
        try {
          const parentEl = page.locator('span:has-text("' + parent + '")').first();
          if (await parentEl.isVisible({ timeout: 1000 })) {
            await parentEl.click();
            await randomDelay(1000, 2000);
          }
        } catch {}
      }
      // 再试一次
      for (const sel of menuSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 })) {
            await el.click();
            clicked = true;
            break;
          }
        } catch {}
      }
    }

    await randomDelay(waitTime, waitTime + 5000);

    // 关闭弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
        if (await btn.isVisible({ timeout: 800 })) await btn.click();
        else break;
      } catch { break; }
    }
    await randomDelay(3000, 5000);

    // 提取DOM表格
    const domData = await page.evaluate(() => {
      const result = {};
      const tables = document.querySelectorAll("table");
      if (tables.length > 0) {
        result.tables = [];
        tables.forEach((table) => {
          const headers = [...table.querySelectorAll("thead th, thead td")].map(h => h.innerText?.trim());
          const rows = [];
          table.querySelectorAll("tbody tr").forEach((tr, ri) => {
            if (ri < 200) {
              const cells = [...tr.querySelectorAll("td")].map(td => td.innerText?.trim()?.substring(0, 500));
              rows.push(cells);
            }
          });
          if (headers.length > 0 || rows.length > 0) {
            result.tables.push({ headers, rows, rowCount: rows.length });
          }
        });
      }
      return result;
    });

    page.removeListener("response", handler);
    await saveCookies();
    console.error("[sidebar-capture] Done! APIs: " + capturedApis.length + ", Tables: " + (domData.tables?.length || 0));
    return { apis: capturedApis, domData };
  } finally {
    await page.close();
  }
}

// 发货台
async function scrapeShippingDesk() {
  return scrapeSidebarCaptureAll("发货台");
}

// 发货单列表
async function scrapeShippingList() {
  return scrapeSidebarCaptureAll("发货单列表");
}

// 司机/地址管理
async function scrapeAddressManage() {
  return scrapeSidebarCaptureAll("司机/地址管理");
}

// 收货/入库异常处理
async function scrapeExceptionNotice() {
  return scrapeSidebarCaptureAll("收货/入库异常处...");
}

// 退货明细
async function scrapeReturnDetail() {
  return scrapeSidebarCaptureAll("退货明细");
}

// 退货包裹管理
async function scrapeReturnOrders() {
  return scrapeSidebarCaptureAll("退货包裹管理");
}

// 退货单管理
async function scrapeReturnReceipt() {
  return scrapeSidebarCaptureAll("退货单管理");
}

// 滞销商品延迟退货
async function scrapeSalesReturn() {
  return scrapePageCaptureAll("/activity/sales-return");
}

// 商品价格申报
async function scrapePriceDeclaration() {
  return scrapePageCaptureAll("/main/adjust-price-manage/order-price");
}

// 商品价格申报
async function scrapePriceReport() {
  return scrapePageCaptureAll("/main/adjust-price-manage/order-price");
}

// 体检中心
async function scrapeCheckup() {
  return scrapePageCaptureAll("/goods/checkup-center");
}

// 美国商品销售管理
async function scrapeUSRetrieval() {
  return scrapePageCaptureAll("/goods/retrieval-board");
}

// 建议零售价合规中心
async function scrapeRetailPrice() {
  return scrapePageCaptureAll("/goods/recommended-retail-price");
}

// 品质分析（全球）
async function scrapeQualityDashboard() {
  return scrapePageCaptureAll("/main/quality/dashboard");
}

// 店铺流量
async function scrapeMallFlux() {
  return scrapePageCaptureAll("/main/mall-flux-analysis-full");
}

// 报名记录
async function scrapeActivityLog() {
  return scrapePageCaptureAll("/activity/marketing-activity/log");
}

// 活动机遇商品
async function scrapeChanceGoods() {
  return scrapePageCaptureAll("/activity/marketing-activity/chance-goods");
}

// 营销活动首页
async function scrapeMarketingActivity() {
  return scrapePageCaptureAll("/activity/marketing-activity");
}

// 流量增长
async function scrapeFlowGrow() {
  return scrapePageCaptureAll("/main/flow-grow");
}

// 活动数据（美国）
async function scrapeActivityUS() {
  return scrapePageCaptureAll(null, { fullUrl: "https://agentseller-us.temu.com/main/act/data-full" });
}

// 活动数据（欧区）
async function scrapeActivityEU() {
  return scrapePageCaptureAll(null, { fullUrl: "https://agentseller-eu.temu.com/main/act/data-full" });
}

// 店铺流量（美国）
async function scrapeMallFluxUS() {
  return scrapePageCaptureAll(null, { fullUrl: "https://agentseller-us.temu.com/main/mall-flux-analysis-full" });
}

// 商品流量（美国）
async function scrapeFluxUS() {
  return scrapePageCaptureAll(null, { fullUrl: "https://agentseller-us.temu.com/main/flux-analysis-full" });
}

// 商品流量（欧区）
async function scrapeFluxEU() {
  return scrapePageCaptureAll(null, { fullUrl: "https://agentseller-eu.temu.com/main/flux-analysis-full" });
}

// 店铺流量（欧区）
async function scrapeMallFluxEU() {
  return scrapePageCaptureAll(null, { fullUrl: "https://agentseller-eu.temu.com/main/mall-flux-analysis-full" });
}

// 抽检结果明细 (kuajingmaihuo.com 侧边栏导航)
// 策略：拦截列表API获取所有商品，然后用fetch批量调用详情API
async function scrapeQcDetail() {
  const page = await context.newPage();
  const capturedApis = [];
  let listApiUrl = ""; // 记录列表API的完整URL模板
  let detailApiUrl = ""; // 记录详情API的完整URL模板

  try {
    // 拦截所有API响应
    page.on("response", async (resp) => {
      try {
        const url = resp.url();
        if (resp.status() !== 200) return;
        const ct = resp.headers()["content-type"] || "";
        if (!ct.includes("json") && !ct.includes("application")) return;
        const body = await resp.json().catch(() => null);
        if (!body) return;

        const u = new URL(url);
        // 识别列表API（通常包含 qc、check、inspect 等关键词）
        if (u.pathname.includes("qc") || u.pathname.includes("check") || u.pathname.includes("inspect") || u.pathname.includes("quality")) {
          capturedApis.push({ path: u.pathname, data: body });
          console.error(`[qc-detail] Captured: ${u.pathname} (${JSON.stringify(body).length}B)`);
          // 记录列表API URL
          if (body.result?.total || body.result?.list || body.result?.pageItems) {
            listApiUrl = url;
            console.error(`[qc-detail] Found list API: ${u.pathname}`);
          }
        }
        // 识别详情API
        if (u.pathname.includes("record") || u.pathname.includes("detail")) {
          capturedApis.push({ path: u.pathname, data: body });
          detailApiUrl = url;
          console.error(`[qc-detail] Found detail API: ${u.pathname}`);
        }
      } catch {}
    });

    console.error("[qc-detail] Navigating to /wms/qc-detail...");
    await navigateToSellerCentral(page, "/wms/qc-detail");
    await randomDelay(5000, 7000);

    // 关闭弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }
    await randomDelay(1000, 2000);

    // 点击"查询"按钮
    try {
      const queryBtn = page.locator('button:has-text("查询"), span:has-text("查询")').first();
      if (await queryBtn.isVisible({ timeout: 3000 })) {
        await queryBtn.click();
        console.error("[qc-detail] Clicked query button");
        await randomDelay(5000, 8000);
      }
    } catch (e) {
      console.error("[qc-detail] Query button not found:", e.message);
    }

    // 如果有列表API，尝试翻页获取全部数据
    if (listApiUrl) {
      console.error("[qc-detail] Fetching all pages via API...");
      const allItems = [];
      for (let pg = 1; pg <= 20; pg++) {
        try {
          const pageData = await page.evaluate(async (args) => {
            const { url, pageNum } = args;
            // 修改URL中的页码参数
            const u = new URL(url);
            u.searchParams.set("pageNo", String(pageNum));
            u.searchParams.set("pageNumber", String(pageNum));
            u.searchParams.set("page", String(pageNum));
            const resp = await fetch(u.toString(), { credentials: "include" });
            return resp.json();
          }, { url: listApiUrl, pageNum: pg });

          const items = pageData?.result?.list || pageData?.result?.pageItems || [];
          if (items.length === 0) break;
          allItems.push(...items);
          console.error(`[qc-detail] Page ${pg}: ${items.length} items (total: ${allItems.length})`);

          const total = pageData?.result?.total || pageData?.result?.totalCount || 0;
          if (allItems.length >= total) break;
        } catch (e) {
          console.error(`[qc-detail] Page ${pg} failed:`, e.message);
          break;
        }
      }
      if (allItems.length > 0) {
        capturedApis.push({ path: "/qc-detail/all-pages", data: { result: { total: allItems.length, list: allItems } } });
        console.error(`[qc-detail] Total items collected: ${allItems.length}`);
      }
    } else {
      // 没找到列表API，用翻页点击方式
      console.error("[qc-detail] No list API found, using pagination clicks...");
      for (let pg = 2; pg <= 10; pg++) {
        try {
          const nextBtn = page.locator('li.ant-pagination-next button, button[aria-label="Next"], .ant-pagination-next').first();
          const isDisabled = await nextBtn.getAttribute("disabled").catch(() => null);
          if (isDisabled !== null || !(await nextBtn.isVisible({ timeout: 1000 }))) break;
          await nextBtn.click();
          console.error(`[qc-detail] Page ${pg}`);
          await randomDelay(3000, 5000);
        } catch { break; }
      }
    }

    // 尝试点击第一个"查看抽检记录"获取详情API格式
    try {
      const viewBtn = page.locator('a:has-text("查看抽检记录"), button:has-text("查看抽检记录"), span:has-text("查看抽检记录")').first();
      if (await viewBtn.isVisible({ timeout: 3000 })) {
        await viewBtn.click();
        console.error("[qc-detail] Clicked first detail button to capture detail API");
        await randomDelay(3000, 5000);
        // 关闭弹窗
        try {
          const closeBtn = page.locator('.ant-modal-close, button:has-text("关闭"), .ant-drawer-close').first();
          if (await closeBtn.isVisible({ timeout: 1000 })) await closeBtn.click();
        } catch {}
      }
    } catch {}

    console.error(`[qc-detail] Done! Captured ${capturedApis.length} APIs`);
    await saveCookies();
    return { apis: capturedApis };
  } finally {
    await page.close();
  }
}

// 品质分析（欧区）
async function scrapeQualityDashboardEU() {
  return scrapePageCaptureAll(null, { fullUrl: "https://agentseller-eu.temu.com/main/quality/dashboard" });
}

// 样品管理 (kuajingmaihuo.com 侧边栏导航)
async function scrapeSampleManage() {
  return scrapePageCaptureAll("/main/sample-manage");
}

// 图片/视频更新任务
async function scrapeImageTask() {
  return scrapePageCaptureAll("/material/image-task");
}

// 商品流量视角
async function scrapeFlowPrice() {
  return scrapePageCaptureAll("/main/adjust-price-manage/high-price");
}

// ---- 合规中心采集 ----

// 合规看板（主页仪表盘 - 包含重要通知、补充合规材料、涉嫌违反政策等汇总数据）
async function scrapeGovernDashboard() {
  const page = await context.newPage();
  const capturedApis = [];
  const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];
  const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', '_stm', 'msgBox', 'hot-update', 'sockjs', 'hm.baidu', 'google', 'favicon', 'drogon-api', 'report/uin'];

  try {
    page.on("response", async (resp) => {
      try {
        const url = resp.url();
        if (staticExts.some(ext => url.includes(ext))) return;
        if (frameworkPatterns.some(p => url.includes(p))) return;
        if (resp.status() === 200) {
          const ct = resp.headers()["content-type"] || "";
          if (ct.includes("json") || ct.includes("application")) {
            const body = await resp.json().catch(() => null);
            if (body && (body.result !== undefined || body.success !== undefined)) {
              const u = new URL(url);
              capturedApis.push({ path: u.pathname, data: body });
              console.error(`[govern-dashboard] Captured: ${u.pathname}`);
            }
          }
        }
      } catch {}
    });

    // 先进入 agentseller 建立认证上下文
    console.error("[govern-dashboard] Navigating to govern dashboard...");
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(2000, 3000);

    // 关闭弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }

    // 导航到合规中心看板
    await page.goto("https://agentseller.temu.com/govern/dashboard", { waitUntil: "domcontentloaded", timeout: 60000 });
    await randomDelay(8000, 12000);

    // 关闭弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }
    await randomDelay(3000, 5000);

    // 提取合规看板 DOM 数据
    const domData = await page.evaluate(() => {
      const result = {};
      const bodyText = document.body?.innerText || "";
      result.pageText = bodyText.substring(0, 10000);

      // 提取统计卡片（补充合规材料、涉嫌违反政策等区域的数字）
      result.cards = [];
      const cards = document.querySelectorAll('[class*="card"], [class*="item"], [class*="block"], [class*="module"]');
      cards.forEach(card => {
        const text = card.innerText?.trim();
        if (text && text.length < 500 && /\d/.test(text)) {
          result.cards.push(text.replace(/\n+/g, ' | '));
        }
      });

      // 提取表格
      const tables = document.querySelectorAll("table");
      if (tables.length > 0) {
        result.tables = [];
        tables.forEach((table) => {
          const headers = [...table.querySelectorAll("thead th, thead td")].map(h => h.innerText?.trim());
          const rows = [];
          table.querySelectorAll("tbody tr").forEach((tr, ri) => {
            if (ri < 200) {
              const cells = [...tr.querySelectorAll("td")].map(td => td.innerText?.trim()?.substring(0, 500));
              rows.push(cells);
            }
          });
          if (headers.length > 0 || rows.length > 0) {
            result.tables.push({ headers, rows, rowCount: rows.length });
          }
        });
      }

      // 提取侧边栏菜单（获取合规中心所有子页面路径）
      result.sidebarLinks = [];
      const sideLinks = document.querySelectorAll('a[href*="govern"], [class*="menu"] a, [class*="nav"] a');
      sideLinks.forEach(a => {
        const text = a.innerText?.trim();
        const href = a.getAttribute("href") || "";
        if (text && text.length < 50) {
          result.sidebarLinks.push({ text, href });
        }
      });

      return result;
    });

    await saveCookies();
    console.error(`[govern-dashboard] Done! APIs: ${capturedApis.length}, sidebar links: ${domData.sidebarLinks?.length || 0}`);
    return { apis: capturedApis, domData };
  } finally {
    await page.close();
  }
}

// 合规中心子页面采集辅助函数（合规中心页面直接在 agentseller.temu.com 下）
async function scrapeGovernPage(governPath) {
  return scrapePageCaptureAll(null, { waitTime: 12000, fullUrl: "https://agentseller.temu.com/govern/" + governPath });
}

// 商品资质
async function scrapeGovernProductQualification() {
  return scrapeGovernPage("product-qualification");
}

// 资质上传申诉
async function scrapeGovernQualificationAppeal() {
  return scrapeGovernPage("qualification-appeal");
}

// 生产者延伸责任资质 (EPR)
async function scrapeGovernEprQualification() {
  return scrapeGovernPage("epr-qualification");
}

// 商品实拍图
async function scrapeGovernProductPhoto() {
  return scrapeGovernPage("product-photo");
}

// 商品合规信息
async function scrapeGovernComplianceInfo() {
  return scrapeGovernPage("compliance-info");
}

// 负责人信息申报
async function scrapeGovernResponsiblePerson() {
  return scrapeGovernPage("responsible-person");
}

// 制造商信息申报
async function scrapeGovernManufacturer() {
  return scrapeGovernPage("manufacturer");
}

// 投诉处理
async function scrapeGovernComplaint() {
  return scrapeGovernPage("complaint");
}

// 违规申诉
async function scrapeGovernViolationAppeal() {
  return scrapeGovernPage("violation-appeal");
}

// 违规处理商家申诉
async function scrapeGovernMerchantAppeal() {
  return scrapeGovernPage("merchant-appeal");
}

// 临时限制令 (TRO)
async function scrapeGovernTro() {
  return scrapeGovernPage("tro");
}

// EPR计费信息收集
async function scrapeGovernEprBilling() {
  return scrapeGovernPage("epr-billing");
}

// 合规性参考
async function scrapeGovernComplianceReference() {
  return scrapeGovernPage("compliance-reference");
}

// 清关属性维护
async function scrapeGovernCustomsAttribute() {
  return scrapeGovernPage("customs-attribute");
}

// 商品类目纠正
async function scrapeGovernCategoryCorrection() {
  return scrapeGovernPage("category-correction");
}

// ---- 上品核价自动化 ----

/**
 * 下载图片到本地
 */
async function downloadImage(url, outputPath) {
  const proto = url.startsWith("https") ? await import("https") : await import("http");
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    proto.default.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow redirect
        downloadImage(res.headers.location, outputPath).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(outputPath); });
    }).on("error", (e) => { fs.unlink(outputPath, () => {}); reject(e); });
  });
}

/**
 * 从 CSV 文件批量创建商品
 * @param {Object} params
 * @param {string} params.csvPath - CSV 文件路径
 * @param {number} [params.startRow] - 开始行号（0-based，默认0）
 * @param {number} [params.count] - 创建数量（默认5）
 * @param {boolean} [params.generateAI] - 是否 AI 生成图片（默认true）
 * @param {string[]} [params.aiImageTypes] - AI 图片类型
 * @param {boolean} [params.autoSubmit] - 是否自动提交
 */
async function batchCreateFromCSV(params) {
  const csvPath = params.csvPath;
  if (!csvPath || !fs.existsSync(csvPath)) {
    return { success: false, message: "CSV 文件不存在: " + csvPath };
  }

  // 解析 CSV
  const csvContent = fs.readFileSync(csvPath, "utf8");
  const lines = csvContent.split("\n").filter(l => l.trim());
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  console.error(`[batch] CSV headers: ${headers.join(", ")}`);
  console.error(`[batch] Total rows: ${lines.length - 1}`);

  // 找到关键列的索引
  const colIndex = (name) => headers.findIndex(h => h.includes(name));
  const nameIdx = colIndex("商品名称");
  const imageIdx = colIndex("商品原图");
  const catCnIdx = colIndex("分类（中文）");
  const catEnIdx = colIndex("分类（英文）");
  const priceIdx = colIndex("美元价格");
  const salesIdx = colIndex("总销量");
  const linkIdx = colIndex("商品链接");
  const ali1688Idx = colIndex("1688链接");

  console.error(`[batch] Columns: name=${nameIdx}, image=${imageIdx}, catCn=${catCnIdx}, price=${priceIdx}`);

  // 解析 CSV 行（处理引号内的逗号）
  function parseCSVLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  const startRow = params.startRow || 0;
  const count = params.count || 5;
  const results = [];

  // 创建下载目录
  const downloadDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "downloads");
  fs.mkdirSync(downloadDir, { recursive: true });

  for (let i = startRow; i < Math.min(startRow + count, lines.length - 1); i++) {
    const row = parseCSVLine(lines[i + 1]); // +1 跳过 header
    const productName = row[nameIdx] || "";
    const imageUrl = row[imageIdx] || "";
    const categoryCn = row[catCnIdx] || "";
    const priceUSD = parseFloat(row[priceIdx] || "0");
    const totalSales = parseInt(row[salesIdx] || "0");

    console.error(`\n[batch] ===== Product ${i + 1}/${startRow + count} =====`);
    console.error(`[batch] Name: ${productName.slice(0, 50)}`);
    console.error(`[batch] Category: ${categoryCn}`);
    console.error(`[batch] Price: $${priceUSD}, Sales: ${totalSales}`);

    try {
      // Step 1: 下载主图
      let localImagePath = null;
      if (imageUrl) {
        const imgFileName = `product_${i}_${Date.now()}.jpg`;
        localImagePath = path.join(downloadDir, imgFileName);
        try {
          await downloadImage(imageUrl, localImagePath);
          console.error(`[batch] Downloaded image: ${imgFileName}`);
        } catch (e) {
          console.error(`[batch] Image download failed: ${e.message}`);
          localImagePath = null;
        }
      }

      // Step 2: 从中文分类提取搜索关键词（逐级尝试）
      const categoryParts = categoryCn.split("/").map(s => s.trim()).filter(Boolean);
      // 优先最后一级，逐级往上尝试
      const categorySearchList = [...categoryParts].reverse();
      const categorySearch = categorySearchList[0] || "商品";

      // Step 3: 价格转人民币（粗略 * 7）
      const priceCNY = priceUSD > 0 ? (priceUSD * 7).toFixed(2) : "9.99";

      // Step 4: 调用 autoCreateProduct
      const result = await autoCreateProduct({
        categorySearch,
        categorySearchList: categorySearchList, // 逐级尝试的分类列表
        title: productName,
        sourceImage: localImagePath,
        generateAI: params.generateAI !== false,
        aiImageTypes: params.aiImageTypes || ["hero", "lifestyle", "closeup"],
        price: parseFloat(priceCNY),
        autoSubmit: params.autoSubmit || false,
        keepOpen: false, // 批量模式不保持打开
      });

      results.push({
        index: i,
        name: productName.slice(0, 40),
        category: categorySearch,
        price: priceCNY,
        success: result.success,
        message: result.message,
      });

      console.error(`[batch] Result: ${result.success ? "✅" : "❌"} ${result.message}`);

      // 每个商品间隔
      await randomDelay(3000, 5000);
    } catch (e) {
      console.error(`[batch] Error: ${e.message}`);
      results.push({
        index: i,
        name: productName.slice(0, 40),
        success: false,
        message: e.message,
      });
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.error(`\n[batch] Done! ${successCount}/${results.length} succeeded`);

  return {
    success: true,
    total: results.length,
    successCount,
    failCount: results.length - successCount,
    results,
  };
}

/**
 * 调用 AI 图片生成服务生成商品图片
 * @param {string} sourceImagePath - 原图路径（商品实拍图）
 * @param {string} productTitle - 商品标题（用于生成 prompt）
 * @param {string[]} imageTypes - 需要生成的图片类型 ["hero","lifestyle","closeup","features"]
 * @returns {string[]} 生成的图片文件路径数组
 */
async function generateAIImages(sourceImagePath, productTitle, imageTypes = ["hero", "lifestyle"]) {
  const AI_SERVER = process.env.AI_IMAGE_SERVER || "http://localhost:3001";
  const outputDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "ai-images");
  fs.mkdirSync(outputDir, { recursive: true });

  console.error(`[ai-image] Generating ${imageTypes.length} images for: ${productTitle?.slice(0, 30)}`);

  // 构建 plans
  const plans = imageTypes.map(type => ({
    imageType: type,
    title: `${type} image`,
    description: `Professional ${type} product photo`,
    prompt: `Professional e-commerce ${type} photo of: ${productTitle}. High quality, white background, studio lighting.`,
  }));

  // 构建 FormData
  const FormData = (await import("node:buffer")).Blob ? null : null;
  // 用 http 模块发送 multipart request
  const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
  const parts = [];

  // 添加 plans
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="plans"\r\n\r\n${JSON.stringify(plans)}`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="productMode"\r\n\r\nsingle`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="imageLanguage"\r\n\r\nen`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="imageSize"\r\n\r\n800x800`);

  // 添加源图片文件
  if (sourceImagePath && fs.existsSync(sourceImagePath)) {
    const imageData = fs.readFileSync(sourceImagePath);
    const ext = path.extname(sourceImagePath).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${path.basename(sourceImagePath)}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
    // 需要特殊处理二进制数据
  }

  parts.push(`--${boundary}--`);

  // 使用 Node 内置 fetch + FormData
  try {
    const { FormData: NodeFormData, File } = await import("node:buffer");
    const formData = new globalThis.FormData();
    formData.append("plans", JSON.stringify(plans));
    formData.append("productMode", "single");
    formData.append("imageLanguage", "en");
    formData.append("imageSize", "800x800");

    if (sourceImagePath && fs.existsSync(sourceImagePath)) {
      const fileBuffer = fs.readFileSync(sourceImagePath);
      const ext = path.extname(sourceImagePath).toLowerCase();
      const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
      const blob = new Blob([fileBuffer], { type: mimeType });
      formData.append("images", blob, path.basename(sourceImagePath));
    }

    const response = await fetch(`${AI_SERVER}/api/generate`, {
      method: "POST",
      body: formData,
    });

    // 解析 SSE 流
    const text = await response.text();
    const generatedPaths = [];

    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.status === "done" && data.imageUrl) {
            // data URL → 保存为文件
            const match = data.imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
            if (match) {
              const ext = match[1] === "png" ? "png" : "jpg";
              const fileName = `${data.imageType}_${Date.now()}.${ext}`;
              const filePath = path.join(outputDir, fileName);
              fs.writeFileSync(filePath, Buffer.from(match[2], "base64"));
              generatedPaths.push(filePath);
              console.error(`[ai-image] Generated: ${fileName}`);
            }
          }
        } catch {}
      }
    }

    console.error(`[ai-image] Done! Generated ${generatedPaths.length} images`);
    return generatedPaths;
  } catch (e) {
    console.error(`[ai-image] Error: ${e.message}`);
    // 备用方案：直接用 http 模块
    return [];
  }
}

/**
 * 自动创建商品并提交核价
 * @param {Object} params
 * @param {string} params.categorySearch - 分类搜索关键词（如 "汽车贴花"）
 * @param {string} params.title - 商品标题
 * @param {string[]} params.images - 主图文件路径数组（本地绝对路径）
 * @param {string[]} [params.detailImages] - 详情图文件路径数组
 * @param {Object} [params.attributes] - 商品属性 {key: value}
 * @param {Array} [params.skus] - SKU列表 [{name, price, stock}]
 * @param {number} [params.price] - 申报价格（分）
 * @param {string} [params.description] - 商品描述
 * @returns {Object} { success, message, productId?, screenshots[] }
 */
async function autoCreateProduct(params) {
  const page = await context.newPage();
  const screenshots = [];
  const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  fs.mkdirSync(debugDir, { recursive: true });

  async function takeDebugScreenshot(name) {
    try {
      const filePath = path.join(debugDir, `create_product_${name}_${Date.now()}.png`);
      await page.screenshot({ path: filePath, fullPage: false });
      screenshots.push(filePath);
      console.error(`[create-product] Screenshot: ${name}`);
    } catch {}
  }

  try {
    console.error("[create-product] Starting product creation...");
    console.error(`[create-product] Category: ${params.categorySearch}, Title: ${params.title?.slice(0, 40)}`);

    // ========== Step 1: 导航到创建商品页面 ==========
    console.error("[create-product] Step 1: Navigate to create page");
    await navigateToSellerCentral(page, "/goods/create/category");
    await randomDelay(5000, 7000);

    // 关闭可能的弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }
    await takeDebugScreenshot("01_category_page");

    // ========== Step 2: 搜索并选择分类 ==========
    console.error("[create-product] Step 2: Select category");
    const categoryInput = page.locator('input[placeholder*="搜索分类"], input[placeholder*="搜索类目"], input[placeholder*="商品名称"], input[placeholder*="可输入"]').first();

    if (await categoryInput.isVisible({ timeout: 3000 })) {
      // 搜索分类：优先用商品标题搜索（Temu搜索框支持用商品名匹配分类）
      const searchTerms = [];
      // 标题优先
      if (params.title) {
        searchTerms.push(params.title.slice(0, 50));
      }
      // 分类关键词作为备选
      if (Array.isArray(params.categorySearchList)) searchTerms.push(...params.categorySearchList);
      else if (params.categorySearch) searchTerms.push(params.categorySearch);

      let categorySelected = false;

      for (const searchTerm of searchTerms) {
        if (categorySelected) break;
        console.error(`[create-product] Searching category: "${searchTerm.slice(0, 30)}"`);

        // 清空并输入
        await categoryInput.click({ clickCount: 3 });
        await randomDelay(200, 300);
        await page.keyboard.press("Backspace");
        await randomDelay(200, 300);
        await categoryInput.fill(searchTerm);
        await randomDelay(2000, 3000);

        await takeDebugScreenshot("02_category_search");

        // 检查搜索结果：Temu 分类页搜索后会显示推荐分类行
        // 格式通常是 "一级分类 > 二级分类 > 三级分类" 的可点击链接
        const clickResult = await page.evaluate(() => {
          // 策略1: 找"常用推荐"区域下的分类链接
          const links = document.querySelectorAll("a, span, div");
          const candidates = [];
          for (const el of links) {
            const text = el.textContent?.trim() || "";
            // 分类推荐通常包含 ">" 分隔符
            if (text.includes(">") && text.length > 5 && text.length < 200 && el.offsetParent !== null) {
              const rect = el.getBoundingClientRect();
              if (rect.height > 10 && rect.height < 50 && rect.top > 100 && rect.top < 600) {
                candidates.push({ el, text, top: rect.top });
              }
            }
          }
          // 点击第一个推荐分类
          if (candidates.length > 0) {
            candidates.sort((a, b) => a.top - b.top);
            candidates[0].el.click();
            return candidates[0].text.slice(0, 60);
          }

          // 策略2: 找分类树的叶子节点（最深层的可点击分类）
          const allClickable = document.querySelectorAll("td, li, a");
          for (const el of allClickable) {
            const text = el.textContent?.trim() || "";
            if (text.length > 2 && text.length < 30 && el.offsetParent !== null && !text.includes("全部分类") && !text.includes("搜索")) {
              const rect = el.getBoundingClientRect();
              // 分类树通常在页面中部
              if (rect.top > 200 && rect.top < 700 && rect.left > 100 && rect.height > 15 && rect.height < 50) {
                el.click();
                return "tree:" + text;
              }
            }
          }
          return null;
        });

        if (clickResult) {
          console.error(`[create-product] Category selected: "${clickResult}"`);
          categorySelected = true;
          await randomDelay(1000, 2000);

          // 搜索后可能需要进一步选择子分类
          // 等待子分类列表加载
          await randomDelay(1000, 2000);

          // 不再自动选子分类——搜索推荐的结果已经是完整分类路径
          // 等待分类确认
        } else {
          console.error(`[create-product] No category results for "${searchTerm.slice(0, 20)}"`);
        }
      }

      if (!categorySelected) {
        console.error("[create-product] WARNING: Category selection failed, will try to continue");
      }

      await takeDebugScreenshot("03_category_selected");

      // 点击确认/下一步按钮
      try {
        const confirmBtn = page.locator('button:has-text("确认"), button:has-text("下一步"), button:has-text("确定选择"), button:has-text("开始创建")').first();
        if (await confirmBtn.isVisible({ timeout: 3000 })) {
          await confirmBtn.click();
          console.error("[create-product] Clicked next, waiting for page load...");
          // 等待页面加载完成（加载中消失 + 标题输入框出现）
          try {
            await page.waitForSelector('textarea, input[placeholder*="标题"], input[placeholder*="商品名"]', { timeout: 30000 });
          } catch {
            // 备选：等待加载动画消失
            await randomDelay(10000, 15000);
          }
          await randomDelay(2000, 3000);
        }
      } catch {}
    } else {
      console.error("[create-product] Category input not found!");
      await takeDebugScreenshot("02_category_input_missing");
      return { success: false, message: "找不到分类搜索框", screenshots };
    }

    await takeDebugScreenshot("04_basic_info_page");
    console.error("[create-product] Step 2 done: Category selected");

    // ========== Step 3: 填写商品标题 ==========
    console.error("[create-product] Step 3: Fill title");
    // 等待页面完全加载（loading消失）
    try {
      await page.waitForFunction(() => {
        const spinners = document.querySelectorAll('.ant-spin-spinning, [class*="loading"], [class*="Loading"]');
        return spinners.length === 0 || Array.from(spinners).every(s => s.offsetParent === null);
      }, { timeout: 15000 });
    } catch {
      await randomDelay(5000, 8000);
    }
    await randomDelay(2000, 3000);

    // 寻找标题输入框
    const titleSelectors = [
      'textarea[placeholder*="标题"]',
      'textarea[placeholder*="商品名"]',
      'input[placeholder*="标题"]',
      'input[placeholder*="商品名"]',
      'textarea[placeholder*="Title"]',
      'textarea[placeholder*="title"]',
    ];

    let titleFilled = false;
    for (const sel of titleSelectors) {
      try {
        const titleInput = page.locator(sel).first();
        if (await titleInput.isVisible({ timeout: 1000 })) {
          await titleInput.click();
          await titleInput.fill("");
          // 模拟真人输入
          await titleInput.type(params.title, { delay: 20 + Math.random() * 30 });
          titleFilled = true;
          console.error("[create-product] Title filled");
          break;
        }
      } catch {}
    }

    if (!titleFilled) {
      // 备用方案：用 evaluate 直接填写
      await page.evaluate((title) => {
        const textareas = document.querySelectorAll("textarea");
        for (const ta of textareas) {
          if (ta.offsetParent !== null && ta.getBoundingClientRect().top < 800) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
            nativeInputValueSetter?.call(ta, title);
            ta.dispatchEvent(new Event("input", { bubbles: true }));
            ta.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }, params.title);
      console.error("[create-product] Title filled via evaluate");
    }

    await takeDebugScreenshot("05_title_filled");

    // ========== Step 3.5: AI 图片生成（可选） ==========
    if (params.generateAI && params.sourceImage) {
      console.error("[create-product] Step 3.5: Generate AI images");
      try {
        const aiImages = await generateAIImages(
          params.sourceImage,
          params.title,
          params.aiImageTypes || ["hero", "lifestyle", "closeup"]
        );
        if (aiImages.length > 0) {
          params.images = [...(params.images || []), ...aiImages];
          console.error(`[create-product] AI generated ${aiImages.length} images`);
        }
      } catch (e) {
        console.error(`[create-product] AI image generation failed: ${e.message}`);
      }
    }

    // ========== Step 4: 上传主图 ==========
    console.error("[create-product] Step 4: Upload images");
    if (params.images && params.images.length > 0) {
      const validImages = params.images.filter(img => fs.existsSync(img));
      if (validImages.length === 0) {
        console.error("[create-product] No valid image files found!");
        return { success: false, message: "图片文件不存在: " + params.images.join(", "), screenshots };
      }

      // 滚动到图片上传区域
      await page.evaluate(() => {
        const labels = document.querySelectorAll("span, label, div");
        for (const el of labels) {
          if (el.textContent?.includes("商品轮播图") || el.textContent?.includes("商品主图")) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            break;
          }
        }
      });
      await randomDelay(1000, 2000);

      let uploaded = false;

      // Temu 上传流程：点击"素材中心"按钮 → 弹出素材中心 → 在素材中心里上传图片
      console.error("[create-product] Clicking '素材中心' button...");
      try {
        const materialBtn = page.locator('div:has-text("素材中心"), span:has-text("素材中心"), button:has-text("素材中心")').first();
        if (await materialBtn.isVisible({ timeout: 3000 })) {
          await materialBtn.click();
          console.error("[create-product] 素材中心 clicked, waiting for dialog...");
          await randomDelay(3000, 5000);
          await takeDebugScreenshot("06a_material_center");

          // 素材中心弹窗中找上传按钮或 file input
          // 方法1: 弹窗中的 file input
          const dialogFileInput = page.locator('.ant-modal input[type="file"], [class*="dialog"] input[type="file"], [class*="modal"] input[type="file"], [class*="Dialog"] input[type="file"], [class*="Modal"] input[type="file"]').first();
          if (await dialogFileInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await dialogFileInput.setInputFiles(validImages);
            uploaded = true;
            console.error("[create-product] Uploaded via dialog file input");
          }

          // 方法2: 弹窗中的"上传图片"按钮 + filechooser
          if (!uploaded) {
            try {
              const uploadInDialog = page.locator('button:has-text("上传"), div:has-text("上传图片"), span:has-text("上传图片"), div:has-text("点击上传"), [class*="upload"]').last();
              if (await uploadInDialog.isVisible({ timeout: 2000 })) {
                const [fileChooser] = await Promise.all([
                  page.waitForEvent("filechooser", { timeout: 8000 }),
                  uploadInDialog.click(),
                ]);
                await fileChooser.setFiles(validImages);
                uploaded = true;
                console.error("[create-product] Uploaded via dialog filechooser");
              }
            } catch (e) {
              console.error(`[create-product] Dialog filechooser failed: ${e.message?.slice(0, 60)}`);
            }
          }

          // 方法3: 弹窗中任意 file input（包括隐藏的）
          if (!uploaded) {
            const allInputs = page.locator('input[type="file"]');
            const count = await allInputs.count();
            console.error(`[create-product] Found ${count} file inputs in page`);
            for (let i = 0; i < count && !uploaded; i++) {
              try {
                await allInputs.nth(i).setInputFiles(validImages, { timeout: 3000 });
                uploaded = true;
                console.error(`[create-product] Uploaded via file input[${i}]`);
              } catch {}
            }
          }

          if (uploaded) {
            await randomDelay(5000, 8000); // 等待上传完成

            // 上传完成后点击"确认"选择图片
            try {
              const confirmBtn = page.locator('button:has-text("确认"), button:has-text("确定"), button:has-text("使用"), button:has-text("选择")').last();
              if (await confirmBtn.isVisible({ timeout: 5000 })) {
                await confirmBtn.click();
                console.error("[create-product] Confirmed image selection");
                await randomDelay(2000, 3000);
              }
            } catch {}
          }
        } else {
          console.error("[create-product] 素材中心 button not found");
        }
      } catch (e) {
        console.error(`[create-product] 素材中心 approach failed: ${e.message?.slice(0, 60)}`);
      }

      // 备用方案：直接找页面上的 file input
      if (!uploaded) {
        console.error("[create-product] Fallback: trying direct file input...");
        const allInputs = page.locator('input[type="file"]');
        const count = await allInputs.count();
        for (let i = 0; i < count && !uploaded; i++) {
          try {
            await allInputs.nth(i).setInputFiles(validImages, { timeout: 3000 });
            uploaded = true;
            console.error(`[create-product] Uploaded via fallback file input[${i}]`);
            await randomDelay(5000, 8000);
          } catch {}
        }
      }

      if (!uploaded) {
        console.error("[create-product] WARNING: All upload methods failed!");
      }

      await takeDebugScreenshot("06_images_uploaded");
    }

    // ========== Step 5: 上传详情图 ==========
    if (params.detailImages && params.detailImages.length > 0) {
      console.error("[create-product] Step 5: Upload detail images");
      const validDetailImages = params.detailImages.filter(img => fs.existsSync(img));
      if (validDetailImages.length > 0) {
        const fileInputs = page.locator('input[type="file"]');
        const count = await fileInputs.count();
        // 第二个 file input 通常是详情图
        if (count > 1) {
          await fileInputs.nth(1).setInputFiles(validDetailImages);
          console.error(`[create-product] Uploaded ${validDetailImages.length} detail images`);
          await randomDelay(3000, 5000);
        }
      }
      await takeDebugScreenshot("07_detail_images");
    }

    // ========== Step 6: 填写商品属性 ==========
    if (params.attributes && Object.keys(params.attributes).length > 0) {
      console.error("[create-product] Step 6: Fill attributes");
      for (const [key, value] of Object.entries(params.attributes)) {
        try {
          // 找到标签文字对应的输入框
          const label = page.locator(`text=${key}`).first();
          if (await label.isVisible({ timeout: 1000 })) {
            // 找标签旁边的 input/select
            const parent = label.locator("xpath=../..");
            const input = parent.locator("input, select, textarea").first();
            if (await input.isVisible({ timeout: 500 })) {
              const tagName = await input.evaluate(el => el.tagName.toLowerCase());
              if (tagName === "select") {
                await input.selectOption(String(value));
              } else {
                await input.fill(String(value));
              }
              console.error(`[create-product] Attribute set: ${key} = ${value}`);
            }
          }
        } catch (e) {
          console.error(`[create-product] Failed to set attribute ${key}: ${e.message}`);
        }
      }
      await takeDebugScreenshot("08_attributes_filled");
    }

    // ========== Step 7: SKU / 价格设置 ==========
    console.error("[create-product] Step 7: Set SKU/price");
    if (params.skus && params.skus.length > 0) {
      // SKU 设置较复杂，需要根据实际页面结构调整
      for (const sku of params.skus) {
        try {
          // 找到价格输入框
          const priceInputs = page.locator('input[placeholder*="价格"], input[placeholder*="申报"], input[placeholder*="Price"]');
          const priceCount = await priceInputs.count();
          if (priceCount > 0) {
            await priceInputs.first().fill(String(sku.price || params.price || ""));
            console.error(`[create-product] Price set: ${sku.price || params.price}`);
          }
        } catch (e) {
          console.error(`[create-product] SKU setup error: ${e.message}`);
        }
      }
    } else if (params.price) {
      // 单一价格模式
      try {
        const priceInput = page.locator('input[placeholder*="价格"], input[placeholder*="申报"], input[placeholder*="Price"]').first();
        if (await priceInput.isVisible({ timeout: 2000 })) {
          await priceInput.fill(String(params.price));
          console.error(`[create-product] Price set: ${params.price}`);
        }
      } catch {}
    }
    await takeDebugScreenshot("09_price_set");

    // ========== Step 8: 提交核价 ==========
    console.error("[create-product] Step 8: Submit for pricing review");
    await takeDebugScreenshot("10_before_submit");

    // 先不自动点提交，让用户确认
    if (params.autoSubmit) {
      try {
        const submitBtn = page.locator('button:has-text("提交"), button:has-text("提交核价"), button:has-text("提交审核"), button:has-text("Submit")').first();
        if (await submitBtn.isVisible({ timeout: 3000 })) {
          await submitBtn.click();
          await randomDelay(3000, 5000);
          await takeDebugScreenshot("11_submitted");
          console.error("[create-product] Submitted for pricing review!");
        }
      } catch (e) {
        console.error(`[create-product] Submit error: ${e.message}`);
        return { success: false, message: "提交失败: " + e.message, screenshots };
      }
    } else {
      console.error("[create-product] Auto-submit disabled. Product form filled, waiting for manual review.");
    }

    await saveCookies();

    return {
      success: true,
      message: params.autoSubmit ? "商品已提交核价" : "商品信息已填写完成，请手动检查并提交",
      screenshots,
    };
  } catch (e) {
    console.error(`[create-product] Error: ${e.message}`);
    await takeDebugScreenshot("error");
    return { success: false, message: e.message, screenshots };
  } finally {
    // 不关闭页面，让用户可以检查
    if (!params.keepOpen) {
      await page.close();
    }
  }
}

// ---- 推广平台采集 (ads.temu.com) ----

// 推广平台通用采集函数：捕获 API + DOM 数据 + 支持 Tab 内导航
async function scrapeAdsPage(tabName, options = {}) {
  const { waitTime = 10000 } = options;
  const page = await context.newPage();
  const capturedApis = [];
  const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];
  const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', '_stm', 'msgBox', 'hot-update', 'sockjs', 'hm.baidu', 'google', 'favicon', 'drogon-api', 'report/uin'];

  try {
    page.on("response", async (resp) => {
      try {
        const url = resp.url();
        if (staticExts.some(ext => url.includes(ext))) return;
        if (frameworkPatterns.some(p => url.includes(p))) return;
        if (resp.status() === 200) {
          const ct = resp.headers()["content-type"] || "";
          if (ct.includes("json") || ct.includes("application")) {
            const body = await resp.json().catch(() => null);
            if (body && (body.result !== undefined || body.success !== undefined || body.data !== undefined || body.errorCode !== undefined)) {
              const u = new URL(url);
              capturedApis.push({ path: u.pathname, data: body });
              console.error(`[ads-${tabName}] Captured: ${u.pathname}`);
            }
          }
        }
      } catch {}
    });

    // 先进入 agentseller 建立认证上下文
    console.error(`[ads-${tabName}] Establishing auth context...`);
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(2000, 3000);

    // 关闭弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }

    // 导航到推广平台首页（需要通过 ads.temu.com 入口）
    console.error(`[ads-${tabName}] Navigating to ads.temu.com...`);
    await page.goto("https://ads.temu.com/index.html", { waitUntil: "domcontentloaded", timeout: 60000 });
    await randomDelay(5000, 8000);

    // 关闭推广平台弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不"), button:has-text("我已知晓")').first();
        if (await btn.isVisible({ timeout: 800 })) await btn.click();
        else break;
      } catch { break; }
    }
    await randomDelay(1000, 2000);

    // 如果不是首页，点击对应 Tab 导航
    if (tabName !== "home") {
      const tabLabels = {
        "product": "商品推广",
        "report": "数据报表",
        "finance": "财务管理",
        "help": "帮助中心",
        "notification": "消息通知",
      };
      const label = tabLabels[tabName];
      if (label) {
        console.error(`[ads-${tabName}] Clicking tab: ${label}`);
        let clicked = false;
        // 尝试点击顶部导航 Tab
        const tabSelectors = [
          `nav a:has-text("${label}")`,
          `a:has-text("${label}")`,
          `div[role="tab"]:has-text("${label}")`,
          `span:has-text("${label}")`,
          `li:has-text("${label}")`,
        ];
        for (const sel of tabSelectors) {
          try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 2000 })) {
              await el.click();
              clicked = true;
              console.error(`[ads-${tabName}] Tab clicked: ${label}`);
              break;
            }
          } catch {}
        }
        if (!clicked) {
          console.error(`[ads-${tabName}] Tab not found via locator, trying evaluate...`);
          await page.evaluate((lbl) => {
            const all = [...document.querySelectorAll('a, div, span, li')];
            for (const el of all) {
              if (el.innerText?.trim() === lbl && el.offsetParent !== null) {
                el.click();
                return true;
              }
            }
            return false;
          }, label);
        }
        await randomDelay(waitTime, waitTime + 3000);

        // 关闭弹窗
        for (let i = 0; i < 5; i++) {
          try {
            const btn = page.locator('button:has-text("知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
            if (await btn.isVisible({ timeout: 500 })) await btn.click();
            else break;
          } catch { break; }
        }
      }
    }

    await randomDelay(3000, 5000);

    // 提取 DOM 数据
    const domData = await page.evaluate(() => {
      const result = {};
      const bodyText = document.body?.innerText || "";
      result.pageText = bodyText.substring(0, 15000);

      // 提取统计卡片
      result.stats = [];
      const cards = document.querySelectorAll('[class*="card"], [class*="stat"], [class*="summary"], [class*="overview"], [class*="metric"]');
      cards.forEach(card => {
        const text = card.innerText?.trim();
        if (text && text.length < 500 && /\d/.test(text)) {
          result.stats.push(text.replace(/\n+/g, ' | '));
        }
      });

      // 提取表格
      const tables = document.querySelectorAll("table");
      if (tables.length > 0) {
        result.tables = [];
        tables.forEach((table) => {
          const headers = [...table.querySelectorAll("thead th, thead td")].map(h => h.innerText?.trim());
          const rows = [];
          table.querySelectorAll("tbody tr").forEach((tr, ri) => {
            if (ri < 200) {
              const cells = [...tr.querySelectorAll("td")].map(td => td.innerText?.trim()?.substring(0, 500));
              rows.push(cells);
            }
          });
          if (headers.length > 0 || rows.length > 0) {
            result.tables.push({ headers, rows, rowCount: rows.length });
          }
        });
      }

      return result;
    });

    await saveCookies();
    console.error(`[ads-${tabName}] Done! APIs: ${capturedApis.length}`);
    return { apis: capturedApis, domData };
  } finally {
    await page.close();
  }
}

// 推广平台 - 首页（今日花费、申报价销售额、推广建议、推荐投放商品）
async function scrapeAdsHome() {
  return scrapeAdsPage("home", { waitTime: 10000 });
}

// 推广平台 - 商品推广（投放中、到达日预算、审核驳回、待推广商品数）
async function scrapeAdsProduct() {
  return scrapeAdsPage("product", { waitTime: 12000 });
}

// 推广平台 - 数据报表（推广效果数据报表）
async function scrapeAdsReport() {
  return scrapeAdsPage("report", { waitTime: 12000 });
}

// 推广平台 - 财务管理（推广账户余额、充值、消耗明细）
async function scrapeAdsFinance() {
  return scrapeAdsPage("finance", { waitTime: 12000 });
}

// 推广平台 - 帮助中心
async function scrapeAdsHelp() {
  return scrapeAdsPage("help", { waitTime: 8000 });
}

// 推广平台 - 消息通知
async function scrapeAdsNotification() {
  return scrapeAdsPage("notification", { waitTime: 10000 });
}

// ---- 通过侧边栏采集 qiankun 子应用数据 ----
// 这些 /main/* 页面无法直接 page.goto，需要通过侧边栏点击导航
async function scrapeSidebarPages() {
  const page = await context.newPage();
  const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  fs.mkdirSync(debugDir, { recursive: true });

  const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', 'get-leo-config', '_stm', 'msgBox', 'auth/userInfo', 'auth/menu', 'queryTotalExam', 'feedback/entrance', 'rule/unreadNum', 'suggestedPrice', 'checkAbleFeedback', 'queryFeedbackNotReadTotal', 'pop/query', '.js', '.css', '.png', '.svg', '.woff', '.ico', '.jpg', '.gif', '.map', '.webp', 'hm.baidu', 'google', 'favicon', 'hot-update', 'sockjs', 'drogon-api', 'agora/conv', 'detroit/api', 'report/uin', 'privilege/query-privilege', 'coupon/queryInvitation', 'optimize/order/wait', 'batchMatch', 'bert/api'];
  const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];

  const results = {};

  // 目标页面（通过侧边栏点击导航加载）
  const sidebarTargets = [
    { menuTexts: ["收货入库异常看板", "收货入库异常"], key: "receiveAbnormal", apis: [] },
    { menuTexts: ["商品价格申报"], key: "priceDeclaration", apis: [] },
    { menuTexts: ["样品管理"], key: "sampleManage", apis: [] },
    { menuTexts: ["模特信息模版"], key: "modelTemplate", apis: [] },
    { menuTexts: ["司机/地址管理", "司机"], key: "driverAddress", apis: [] },
    { menuTexts: ["发货台"], key: "deliveryDesk", apis: [] },
    { menuTexts: ["发货单列表"], key: "deliveryList", apis: [] },
    { menuTexts: ["AB实验平台"], key: "abTest", apis: [] },
  ];

  try {
    // Step 1: 加载 shell
    console.error("[sidebar-scrape] Step 1: Loading shell...");
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(5000, 7000);

    // 关闭弹窗
    for (let i = 0; i < 10; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不"), button:has-text("去处理")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
      await randomDelay(200, 400);
    }

    // Step 2: 展开所有侧边栏子菜单
    console.error("[sidebar-scrape] Step 2: Expanding all sidebar menus...");
    await page.evaluate(() => {
      document.querySelectorAll('[class*="menu-submenu-title"], [class*="submenu-title"], [class*="ant-menu-submenu-title"]').forEach(item => {
        const parent = item.closest('[class*="submenu"]') || item.parentElement;
        const isOpen = parent?.classList?.toString().includes('open') || parent?.classList?.toString().includes('active');
        if (!isOpen) item.click();
      });
    });
    await randomDelay(2000, 3000);
    // 再展开一次
    await page.evaluate(() => {
      document.querySelectorAll('[class*="menu-submenu-title"], [class*="submenu-title"], [class*="ant-menu-submenu-title"]').forEach(item => {
        const parent = item.closest('[class*="submenu"]') || item.parentElement;
        const isOpen = parent?.classList?.toString().includes('open') || parent?.classList?.toString().includes('active');
        if (!isOpen) item.click();
      });
    });
    await randomDelay(1500, 2000);

    // Step 3: 逐个通过侧边栏点击导航
    for (const target of sidebarTargets) {
      console.error(`[sidebar-scrape] Navigating to: ${target.menuTexts[0]}`);
      const capturedApis = [];

      // 设置 response listener
      const handler = async (resp) => {
        try {
          const url = resp.url();
          if (staticExts.some(ext => url.includes(ext))) return;
          if (frameworkPatterns.some(p => url.includes(p))) return;
          if (resp.status() === 200) {
            const ct = resp.headers()["content-type"] || "";
            if (ct.includes("json") || ct.includes("application")) {
              const body = await resp.json().catch(() => null);
              if (body && (body.result !== undefined || body.success !== undefined)) {
                const u = new URL(url);
                capturedApis.push({ path: u.pathname, data: body.result || body });
                console.error(`[sidebar-scrape] Captured: ${u.pathname}`);
              }
            }
          }
        } catch {}
      };
      page.on("response", handler);

      try {
        // 点击目标菜单项（使用与 scrapeViaSidebarClick 一致的选择器）
        let clicked = false;
        for (const menuText of target.menuTexts) {
          try {
            const menuLink = page.locator(`nav a:has-text("${menuText}"), [class*="sider"] a:has-text("${menuText}"), [class*="sidebar"] a:has-text("${menuText}"), [class*="menu"] a:has-text("${menuText}"), [class*="menu-item"]:has-text("${menuText}")`).first();
            if (await menuLink.isVisible({ timeout: 3000 }).catch(() => false)) {
              await menuLink.click();
              clicked = true;
              console.error(`[sidebar-scrape] Clicked: ${menuText}`);
              break;
            }
          } catch {}
          // fallback: evaluate
          if (!clicked) {
            clicked = await page.evaluate((text) => {
              const links = document.querySelectorAll('a, [class*="menu-item"] span, [class*="menu-item"]');
              for (const el of links) {
                if (el.innerText?.trim() === text) { el.click(); return true; }
              }
              return false;
            }, menuText);
            if (clicked) {
              console.error(`[sidebar-scrape] Clicked via evaluate: ${menuText}`);
              break;
            }
          }
        }

        if (clicked) {
          await randomDelay(8000, 12000);

          // 关闭弹窗
          for (let i = 0; i < 3; i++) {
            try {
              const btn = page.locator('button:has-text("知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
              if (await btn.isVisible({ timeout: 500 })) await btn.click();
              else break;
            } catch { break; }
          }
          await randomDelay(3000, 5000);

          // 从 DOM 提取数据
          const domData = await page.evaluate(() => {
            const data = {};
            // iframe 中的内容
            const iframes = document.querySelectorAll("iframe");
            data.iframeCount = iframes.length;
            // 主容器和 #container
            const container = document.querySelector("#container, #subapp-viewport, [id*='container']");
            if (container) {
              data.containerText = container.innerText?.substring(0, 3000);
            }
            // 表格
            const tables = document.querySelectorAll("table");
            if (tables.length > 0) {
              data.tables = [];
              tables.forEach((table) => {
                const headers = [...table.querySelectorAll("thead th, thead td")].map(h => h.innerText?.trim());
                const rows = [];
                table.querySelectorAll("tbody tr").forEach((tr, ri) => {
                  if (ri < 50) {
                    const cells = [...tr.querySelectorAll("td")].map(td => td.innerText?.trim()?.substring(0, 200));
                    rows.push(cells);
                  }
                });
                if (headers.length > 0 || rows.length > 0) {
                  data.tables.push({ headers, rowCount: table.querySelectorAll("tbody tr").length, rows });
                }
              });
            }
            // 统计数字
            const nums = document.querySelectorAll('[class*="num"], [class*="count"], [class*="amount"], [class*="total"], [class*="value"], [class*="stat"]');
            if (nums.length > 0) {
              data.numbers = [...nums].slice(0, 30).map(n => ({ text: n.innerText?.trim()?.substring(0, 100) }));
            }
            // 全页面文本摘要
            data.pageText = document.body?.innerText?.substring(0, 5000);
            return data;
          }).catch(() => ({}));

          results[target.key] = {
            apis: capturedApis,
            domData,
            url: page.url(),
          };
          console.error(`[sidebar-scrape] ${target.key}: ${capturedApis.length} APIs, DOM text: ${(domData.pageText || '').length} chars`);
        } else {
          console.error(`[sidebar-scrape] Could not find menu: ${target.menuTexts.join(", ")}`);
          results[target.key] = { error: "menu not found" };
        }
      } finally {
        page.removeListener("response", handler);
      }
    }

    await saveCookies();
    fs.writeFileSync(path.join(debugDir, "sidebar_scrape_result.json"), JSON.stringify(results, null, 2));
    return results;
  } finally {
    await page.close();
  }
}

// ---- 通过侧边栏点击导航来加载子应用并抓取 API ----

async function scrapeViaSidebarClick() {
  const page = await context.newPage();
  const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  fs.mkdirSync(debugDir, { recursive: true });

  const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];
  const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', 'get-leo-config', '_stm', 'msgBox', 'auth/userInfo', 'auth/menu', 'queryTotalExam', 'feedback/entrance', 'rule/unreadNum', 'suggestedPrice', 'checkAbleFeedback', 'queryFeedbackNotReadTotal', 'pop/query'];

  const allResults = [];
  const consoleErrors = [];

  // 目标页面（侧边栏菜单名 → 期望的 URL 路径片段）
  const targetPages = [
    { menuTexts: ["数据中心"], expectedPath: "/main/data-center", group: "数据中心" },
    { menuTexts: ["商品数据"], expectedPath: "/main/goods-analysis", group: "数据中心" },
    { menuTexts: ["活动数据"], expectedPath: "/main/activity-analysis", group: "数据中心" },
    { menuTexts: ["流量分析"], expectedPath: "/main/flux-analysis", group: "数据中心" },
    { menuTexts: ["账户资金"], expectedPath: "/main/finance/account-center", group: "账户资金" },
    { menuTexts: ["收入明细"], expectedPath: "/main/finance/income-detail", group: "账户资金" },
    { menuTexts: ["账单"], expectedPath: "/main/finance/bill", group: "账户资金" },
    { menuTexts: ["质量中心"], expectedPath: "/main/quality-center", group: "质量管理" },
    { menuTexts: ["质量分"], expectedPath: "/main/quality-score", group: "质量管理" },
    { menuTexts: ["优惠券中心"], expectedPath: "/main/coupon-center", group: "店铺营销" },
    { menuTexts: ["店铺装修"], expectedPath: "/main/shop-decoration", group: "店铺营销" },
    { menuTexts: ["库存管理"], expectedPath: "/goods/inventory", group: "库存管理" },
    { menuTexts: ["仓库库存管理", "仓库库存"], expectedPath: "/wms/inventory", group: "库存管理" },
    { menuTexts: ["履约看板"], expectedPath: "promise-board", group: "履约管理" },
  ];

  try {
    // Step 1: 先导航到一个已知能正常加载的页面
    console.error("[sidebar-nav] Step 1: Loading shell via /goods/list...");
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(5000, 7000);

    // 关闭所有弹窗
    for (let i = 0; i < 10; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("去处理"), button:has-text("暂不")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
      await randomDelay(200, 400);
    }

    // 监听控制台消息
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push({ text: msg.text()?.substring(0, 500), url: page.url() });
      }
    });
    page.on("pageerror", (err) => {
      consoleErrors.push({ text: `PAGE_ERROR: ${err.message?.substring(0, 500)}`, url: page.url() });
    });

    // 确认 shell 已加载
    const shellOk = await page.evaluate(() => {
      const sidebar = document.querySelector('[class*="sidebar"], [class*="menu"], nav, [class*="sider"]');
      return !!sidebar;
    });
    console.error(`[sidebar-nav] Shell loaded: ${shellOk}`);
    await page.screenshot({ path: path.join(debugDir, "sidebar_shell.png"), fullPage: false });

    // Step 2: 展开所有侧边栏分组
    console.error("[sidebar-nav] Step 2: Expanding all sidebar groups...");
    const expandResult = await page.evaluate(() => {
      const results = [];
      // 查找所有可展开的菜单项（有箭头图标的）
      const menuItems = document.querySelectorAll('[class*="menu-submenu-title"], [class*="submenu-title"], [class*="menu-item-group-title"], [class*="ant-menu-submenu-title"]');
      for (const item of menuItems) {
        const text = item.innerText?.trim();
        // 检查是否已展开
        const parent = item.closest('[class*="submenu"]') || item.parentElement;
        const isOpen = parent?.classList?.toString().includes('open') || parent?.classList?.toString().includes('active');
        results.push({ text: text?.substring(0, 30), isOpen });
        if (!isOpen) {
          item.click();
        }
      }
      return results;
    });
    console.error(`[sidebar-nav] Found ${expandResult.length} menu groups:`, expandResult.map(r => `${r.text}(${r.isOpen ? 'open' : 'closed'})`).join(', '));
    await randomDelay(2000, 3000);

    // 再次展开
    await page.evaluate(() => {
      document.querySelectorAll('[class*="menu-submenu-title"], [class*="submenu-title"], [class*="ant-menu-submenu-title"]').forEach(item => {
        const parent = item.closest('[class*="submenu"]') || item.parentElement;
        const isOpen = parent?.classList?.toString().includes('open') || parent?.classList?.toString().includes('active');
        if (!isOpen) item.click();
      });
    });
    await randomDelay(1500, 2000);

    // Step 3: 获取所有侧边栏菜单项
    const allMenuItems = await page.evaluate(() => {
      const items = [];
      // 选择所有可点击的菜单链接
      const links = document.querySelectorAll('a[href], [class*="menu-item"] > span, [class*="menu-item"] > a, [class*="menu-item-content"], li[class*="menu-item"]');
      for (const el of links) {
        const text = el.innerText?.trim();
        const href = el.getAttribute("href") || el.closest("a")?.getAttribute("href") || "";
        if (text && text.length < 30 && text.length > 0) {
          items.push({ text, href, tag: el.tagName });
        }
      }
      return items;
    });
    console.error(`[sidebar-nav] Found ${allMenuItems.length} menu items`);

    // Step 4: 逐个点击目标页面
    for (const target of targetPages) {
      console.error(`\n[sidebar-nav] ===== Navigating to: ${target.menuTexts[0]} (${target.group}) =====`);

      const capturedRequests = [];
      const responseHandler = async (resp) => {
        const reqUrl = resp.url();
        const method = resp.request().method();
        const ct = resp.headers()["content-type"] || "";
        const isStatic = staticExts.some(ext => reqUrl.includes(ext));
        const isFramework = frameworkPatterns.some(pat => reqUrl.includes(pat));

        if (!isStatic && !isFramework && (method === "POST" || (method === "GET" && reqUrl.includes("/api/"))) && (ct.includes("json") || reqUrl.includes("/api/"))) {
          try {
            const body = await resp.text();
            capturedRequests.push({
              method,
              url: reqUrl,
              postData: resp.request().postData()?.substring(0, 2000) || null,
              status: resp.status(),
              responseBody: body.substring(0, 5000),
            });
          } catch {}
        }
      };
      page.on("response", responseHandler);

      let clicked = false;
      let actualUrl = "";
      try {
        // 尝试通过文本匹配点击侧边栏
        for (const menuText of target.menuTexts) {
          // 方法1: 直接用文本匹配侧边栏链接
          const menuLink = page.locator(`nav a:has-text("${menuText}"), [class*="sider"] a:has-text("${menuText}"), [class*="sidebar"] a:has-text("${menuText}"), [class*="menu"] a:has-text("${menuText}"), [class*="menu-item"]:has-text("${menuText}")`).first();
          if (await menuLink.isVisible({ timeout: 2000 }).catch(() => false)) {
            console.error(`[sidebar-nav] Found menu item: "${menuText}", clicking...`);
            await menuLink.click();
            clicked = true;
            break;
          }

          // 方法2: 查找包含文本的 li 元素
          const menuLi = page.locator(`li:has-text("${menuText}")`).first();
          if (await menuLi.isVisible({ timeout: 1000 }).catch(() => false)) {
            console.error(`[sidebar-nav] Found li item: "${menuText}", clicking...`);
            await menuLi.click();
            clicked = true;
            break;
          }

          // 方法3: 用 evaluate 精确查找
          const found = await page.evaluate((text) => {
            const allElements = document.querySelectorAll('a, span, li, div');
            for (const el of allElements) {
              if (el.innerText?.trim() === text && el.offsetWidth > 0 && el.offsetHeight > 0) {
                // 确保是菜单中的元素
                const inMenu = el.closest('[class*="menu"], [class*="sider"], [class*="sidebar"], nav');
                if (inMenu) {
                  el.click();
                  return { found: true, tag: el.tagName, class: el.className?.substring?.(0, 80) };
                }
              }
            }
            return { found: false };
          }, menuText);

          if (found.found) {
            console.error(`[sidebar-nav] Found via evaluate: "${menuText}" (${found.tag})`);
            clicked = true;
            break;
          }
        }

        if (!clicked) {
          // 方法4: 如果侧边栏找不到，尝试父菜单先展开
          for (const menuText of target.menuTexts) {
            const groupName = target.group;
            console.error(`[sidebar-nav] Trying to expand group "${groupName}" first...`);
            await page.evaluate((group) => {
              const items = document.querySelectorAll('[class*="menu-submenu-title"], [class*="submenu-title"]');
              for (const item of items) {
                if (item.innerText?.trim().includes(group)) {
                  item.click();
                  return true;
                }
              }
              return false;
            }, groupName);
            await randomDelay(1000, 1500);

            // 再次尝试点击
            const found = await page.evaluate((text) => {
              const allElements = document.querySelectorAll('a, span, li, div');
              for (const el of allElements) {
                if (el.innerText?.trim() === text && el.offsetWidth > 0) {
                  el.click();
                  return true;
                }
              }
              return false;
            }, menuText);
            if (found) {
              clicked = true;
              console.error(`[sidebar-nav] Found after expanding group: "${menuText}"`);
              break;
            }
          }
        }

        if (!clicked) {
          console.error(`[sidebar-nav] Could not find menu item for: ${target.menuTexts[0]}, falling back to goto`);
          const fullUrl = `https://agentseller.temu.com${target.expectedPath}`;
          await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        }

        // 等待页面/子应用加载
        await randomDelay(3000, 5000);

        // 关闭弹窗
        for (let i = 0; i < 5; i++) {
          try {
            const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
            if (await btn.isVisible({ timeout: 400 })) await btn.click();
            else break;
          } catch { break; }
          await randomDelay(200, 300);
        }

        // 等待子应用内容加载（最多30秒）
        console.error(`[sidebar-nav] Waiting for sub-app content to load...`);
        let loaded = false;
        for (let wait = 0; wait < 30; wait++) {
          await randomDelay(1000, 1000);
          const state = await page.evaluate(() => {
            const spinners = [...document.querySelectorAll('[class*="spin"], [class*="loading"], [class*="skeleton"]')]
              .filter(el => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 50 && rect.height > 50 && style.display !== 'none' && style.visibility !== 'hidden';
              });
            const hasTable = document.querySelector('table') !== null;
            const hasChart = document.querySelector('canvas, [class*="chart"], [class*="echarts"]') !== null;
            const hasCards = document.querySelectorAll('[class*="card"], [class*="stat"], [class*="summary"]').length > 3;
            const contentEl = document.querySelector('[class*="content"], [class*="main-content"], main, [id*="subApp"], [id*="root"]');
            const textLen = (contentEl?.innerText || '').trim().length;
            return { spinnerCount: spinners.length, hasTable, hasChart, hasCards, textLen };
          });

          if (wait % 5 === 0) {
            console.error(`[sidebar-nav]   Wait ${wait}s: spinners=${state.spinnerCount} table=${state.hasTable} chart=${state.hasChart} cards=${state.hasCards} text=${state.textLen}`);
          }

          if (state.spinnerCount === 0 && (state.hasTable || state.hasChart || state.hasCards || state.textLen > 200)) {
            console.error(`[sidebar-nav]   Sub-app loaded after ${wait}s!`);
            loaded = true;
            break;
          }
        }

        if (!loaded) {
          console.error(`[sidebar-nav]   Sub-app did NOT load after 30s`);
        }

        // 额外等待 API 请求完成
        await randomDelay(3000, 4000);

        actualUrl = page.url();
        console.error(`[sidebar-nav] Current URL: ${actualUrl}`);
        console.error(`[sidebar-nav] Captured ${capturedRequests.length} business APIs`);

        // 截图
        const safeName = target.menuTexts[0].replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_");
        await page.screenshot({ path: path.join(debugDir, `sidebar_${safeName}.png`), fullPage: false });

        // 获取页面内容概览
        const contentInfo = await page.evaluate(() => {
          const result = {};
          result.title = document.title;
          result.url = location.href;
          const tables = document.querySelectorAll("table");
          result.tableCount = tables.length;
          if (tables.length > 0) {
            result.tableHeaders = [...tables[0].querySelectorAll("th")].map(th => th.innerText?.trim()).slice(0, 15);
          }
          const cards = document.querySelectorAll('[class*="card"], [class*="stat"]');
          result.cardCount = cards.length;
          result.bodyText = document.body?.innerText?.trim()?.substring(0, 1000) || "";
          // 检查 qiankun 容器
          const qiankunContainers = document.querySelectorAll('[id*="__qiankun"], [id*="subApp"], [class*="micro-app"]');
          result.qiankunContainers = [...qiankunContainers].map(el => ({
            id: el.id, class: el.className?.substring?.(0, 100), childCount: el.children.length,
            innerHTML: el.innerHTML?.substring(0, 300)
          }));
          return result;
        });

        allResults.push({
          name: target.menuTexts[0],
          group: target.group,
          expectedPath: target.expectedPath,
          actualUrl,
          clicked,
          loaded,
          apiCount: capturedRequests.length,
          apis: capturedRequests.map(r => {
            let p;
            try { p = new URL(r.url).pathname; } catch { p = r.url; }
            return {
              method: r.method,
              path: p,
              postData: r.postData?.substring(0, 800),
              status: r.status,
              responsePreview: r.responseBody?.substring(0, 1000),
            };
          }),
          contentInfo: {
            tableCount: contentInfo.tableCount,
            tableHeaders: contentInfo.tableHeaders,
            cardCount: contentInfo.cardCount,
            qiankunContainers: contentInfo.qiankunContainers,
            bodyTextLen: contentInfo.bodyText?.length || 0,
          },
        });

      } catch (e) {
        console.error(`[sidebar-nav] Error navigating to ${target.menuTexts[0]}: ${e.message}`);
        allResults.push({
          name: target.menuTexts[0],
          group: target.group,
          error: e.message,
          apis: [],
        });
      }

      page.removeListener("response", responseHandler);
      await randomDelay(1000, 2000);
    }

    // 保存结果
    const output = {
      timestamp: new Date().toISOString(),
      totalPages: allResults.length,
      pagesWithApis: allResults.filter(r => r.apiCount > 0).length,
      pagesLoaded: allResults.filter(r => r.loaded).length,
      consoleErrors: consoleErrors.slice(0, 50),
      results: allResults,
    };
    fs.writeFileSync(path.join(debugDir, "sidebar_nav_results.json"), JSON.stringify(output, null, 2));
    console.error(`[sidebar-nav] Done! ${allResults.length} pages, ${output.pagesWithApis} with APIs, ${output.pagesLoaded} loaded`);

    await page.close();
    return output;
  } catch (err) {
    console.error(`[sidebar-nav] Fatal error: ${err.message}`);
    fs.writeFileSync(path.join(debugDir, "sidebar_nav_results.json"), JSON.stringify({ error: err.message, results: allResults, consoleErrors }, null, 2));
    try { await page.screenshot({ path: path.join(debugDir, "sidebar_nav_error.png"), fullPage: false }); } catch {}
    await page.close();
    throw err;
  }
}

// ---- 捕获 API 请求 ----

async function captureApiRequests(targetUrl) {
  const page = await context.newPage();
  const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  fs.mkdirSync(debugDir, { recursive: true });

  const capturedRequests = [];
  // 静态资源后缀过滤
  const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];

  try {
    // 先登录
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(2000, 3000);

    // 捕获所有 POST 请求（去掉 URL 关键词过滤，只排除静态资源）
    await page.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      const isStatic = staticExts.some(ext => url.includes(ext));
      if (!isStatic && (method === "POST" || (method === "GET" && url.includes("/api/")))) {
        capturedRequests.push({
          method,
          url,
          postData: req.postData()?.substring(0, 5000) || null,
        });
      }
      await route.continue();
    });

    // 捕获所有 JSON 响应
    page.on("response", async (resp) => {
      const url = resp.url();
      const ct = resp.headers()["content-type"] || "";
      const isStatic = staticExts.some(ext => url.includes(ext));
      if (!isStatic && (ct.includes("json") || url.includes("/api/"))) {
        try {
          const body = await resp.text();
          const req = capturedRequests.find(r => r.url === url && !r.responseBody);
          if (req) {
            req.status = resp.status();
            req.responseBody = body.substring(0, 15000);
          }
        } catch {}
      }
    });

    // 导航到目标页面
    console.error("[capture] Navigating to:", targetUrl);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await randomDelay(8000, 12000);

    // 关闭弹窗（多轮）
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 8; i++) {
        try {
          const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("去处理")').first();
          if (await btn.isVisible({ timeout: 800 })) await btn.click();
          else break;
        } catch { break; }
        await randomDelay(300, 500);
      }
      try {
        await page.evaluate(() => {
          document.querySelectorAll('[class*="close"], [class*="Close"], [aria-label="close"]').forEach(el => {
            try { el.click(); } catch {}
          });
        });
      } catch {}
      await randomDelay(500, 800);
    }

    // 等待表格加载
    await page.waitForSelector("table tbody tr", { timeout: 20000 }).catch(() => {
      console.error("[capture] No table rows found, waiting more...");
    });
    await randomDelay(3000, 5000);

    // 滚动页面触发懒加载
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await randomDelay(2000, 3000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await randomDelay(2000, 3000);

    console.error(`[capture] Captured ${capturedRequests.length} API requests`);

    // 过滤出有响应体的 POST 请求
    const postRequests = capturedRequests.filter(r => r.method === "POST" && r.responseBody);
    console.error(`[capture] POST requests with response: ${postRequests.length}`);

    // 保存到文件
    const filename = targetUrl.includes("sale") ? "captured_api_sales.json" :
                     targetUrl.includes("goods") ? "captured_api_goods.json" : "captured_api.json";
    fs.writeFileSync(path.join(debugDir, filename), JSON.stringify(capturedRequests, null, 2));

    await page.close();

    // 返回摘要（只返回 POST 请求的摘要以缩短输出）
    return {
      total: capturedRequests.length,
      postCount: postRequests.length,
      requests: postRequests.map(r => ({
        method: r.method,
        url: r.url,
        status: r.status,
        postData: r.postData?.substring(0, 500),
        responsePreview: r.responseBody?.substring(0, 800),
      })),
    };
  } catch (err) {
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
    case "capture_api": {
      // 捕获页面加载时的 API 请求
      await ensureBrowser();
      const targetUrl = params.url || "https://agentseller.temu.com/stock/fully-mgt/order-manage-urgency";
      return await captureApiRequests(targetUrl);
    }
    case "discover_pages": {
      // 自动发现所有页面和 API
      await ensureBrowser();
      return await discoverAllPages();
    }
    case "deep_probe": {
      // 深度探测 iframe 页面
      await ensureBrowser();
      const defaultPages = [
        { name: "数据中心", url: "https://agentseller.temu.com/main/data-center" },
        { name: "账户资金", url: "https://agentseller.temu.com/main/finance/account-center" },
        { name: "收入明细", url: "https://agentseller.temu.com/main/finance/income-detail" },
        { name: "账单", url: "https://agentseller.temu.com/main/finance/bill" },
        { name: "质量中心", url: "https://agentseller.temu.com/main/quality-center" },
        { name: "质量分", url: "https://agentseller.temu.com/main/quality-score" },
        { name: "优惠券中心", url: "https://agentseller.temu.com/main/coupon-center" },
        { name: "店铺装修", url: "https://agentseller.temu.com/main/shop-decoration" },
        { name: "库存管理", url: "https://agentseller.temu.com/goods/inventory/manage" },
        { name: "仓库库存管理", url: "https://agentseller.temu.com/wms/inventory-manage" },
        { name: "履约看板", url: "https://agentseller.temu.com/stock/fully-mgt/sale-manage/board/promise-board" },
        { name: "商品数据", url: "https://agentseller.temu.com/main/goods-analysis" },
        { name: "活动数据", url: "https://agentseller.temu.com/main/activity-analysis" },
        { name: "流量分析", url: "https://agentseller.temu.com/main/flux-analysis" },
      ];
      return await deepProbePages(params.pages || defaultPages);
    }
    case "scrape_sales": {
      await ensureBrowser();
      return { sales: await scrapeSales() };
    }
    case "create_product": {
      await ensureBrowser();
      return await autoCreateProduct(params);
    }
    case "batch_create_from_csv": {
      await ensureBrowser();
      return await batchCreateFromCSV(params);
    }
    case "generate_ai_images": {
      const images = await generateAIImages(
        params.sourceImage,
        params.title,
        params.imageTypes || ["hero", "lifestyle"]
      );
      return { success: true, images, count: images.length };
    }
    case "scrape_flux": {
      await ensureBrowser();
      return { flux: await scrapeFluxAnalysis() };
    }
    case "scrape_dashboard": {
      await ensureBrowser();
      return { dashboard: await scrapeHomeDashboard() };
    }
    case "scrape_aftersales": {
      await ensureBrowser();
      return { afterSales: await scrapeAfterSales() };
    }
    case "scrape_soldout": {
      await ensureBrowser();
      return { soldOut: await scrapeSoldOutBoard() };
    }
    case "sidebar_nav": {
      await ensureBrowser();
      return await scrapeViaSidebarClick();
    }
    case "scrape_all": {
      // 一键采集：并发执行（限制3个），用弹窗监控器自动处理授权弹窗
      await ensureBrowser();
      console.error("[scrape_all] Step 1: Setup popup monitor + establish session...");

      // ★ 弹窗监控器：监听所有新窗口，自动处理授权弹窗
      let popupMonitorActive = true;
      const handleAuthPopup = async (newPage) => {
        if (!popupMonitorActive) return;
        try {
          const url = newPage.url();
          console.error(`[popup-monitor] New page detected: ${url}`);

          // 等待页面加载
          await newPage.waitForLoadState("domcontentloaded").catch(() => {});
          await randomDelay(2000, 4000);

          const currentUrl = newPage.url();
          console.error(`[popup-monitor] Page loaded, URL: ${currentUrl}`);

          // 只处理 kuajingmaihuo.com 授权弹窗
          if (!currentUrl.includes("kuajingmaihuo.com") && !currentUrl.includes("seller-login")) {
            console.error("[popup-monitor] Not an auth popup, ignoring");
            return;
          }

          // 等待授权弹窗内容出现（最多30秒）
          for (let attempt = 0; attempt < 10; attempt++) {
            try {
              const text = await newPage.evaluate(() => document.body?.innerText || "");
              if (text.includes("确认授权") || text.includes("即将前往") || text.includes("Seller Central")) {
                console.error(`[popup-monitor] Auth dialog found on attempt ${attempt + 1}!`);

                // 勾选 checkbox
                try {
                  const cb = newPage.locator('input[type="checkbox"]').first();
                  if (await cb.isVisible({ timeout: 2000 })) {
                    const checked = await cb.isChecked().catch(() => false);
                    if (!checked) {
                      await cb.click();
                      console.error("[popup-monitor] Checkbox checked");
                    }
                  }
                } catch (e) {
                  // fallback
                  await newPage.evaluate(() => {
                    const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
                    for (const cb of inputs) { if (!cb.checked) cb.click(); }
                  }).catch(() => {});
                }
                await randomDelay(500, 1000);

                // 点击"确认授权并前往"
                let clicked = false;
                try {
                  const btn = newPage.locator('button:has-text("确认授权并前往")').first();
                  if (await btn.isVisible({ timeout: 2000 })) {
                    await btn.click();
                    console.error("[popup-monitor] Clicked '确认授权并前往'");
                    clicked = true;
                  }
                } catch {}
                if (!clicked) {
                  try {
                    const btn2 = newPage.locator('button:has-text("确认授权")').first();
                    if (await btn2.isVisible({ timeout: 1000 })) {
                      await btn2.click();
                      console.error("[popup-monitor] Clicked '确认授权'");
                      clicked = true;
                    }
                  } catch {}
                }
                if (!clicked) {
                  // evaluate fallback
                  const result = await newPage.evaluate(() => {
                    const keywords = ["确认授权并前往", "确认授权", "确认并前往", "进入"];
                    const all = [...document.querySelectorAll('button, [role="button"], a, div[class*="btn"]')];
                    for (const kw of keywords) {
                      for (const el of all) {
                        const text = (el.innerText || "").trim();
                        if (text.includes(kw) && text.length < 20) { el.click(); return "clicked: " + text; }
                      }
                    }
                    return "not found";
                  });
                  console.error("[popup-monitor] Fallback button result:", result);
                }

                await saveCookies();
                console.error("[popup-monitor] Auth popup handled successfully!");
                return;
              }
            } catch (e) {
              if (newPage.isClosed()) return;
            }
            await randomDelay(2000, 3000);
          }
          console.error("[popup-monitor] Auth dialog not found after 10 attempts");
        } catch (e) {
          console.error("[popup-monitor] Error handling popup:", e.message);
        }
      };

      // 注册弹窗监控
      context.on("page", handleAuthPopup);
      console.error("[popup-monitor] Monitor registered");

      // Step 1: 用一个页面先完成授权流程（warmup 用完整模式）
      const warmupPage = await context.newPage();
      try {
        await navigateToSellerCentral(warmupPage, "/goods/list", { lite: false });
        await randomDelay(2000, 3000);
        // 关闭页面弹窗
        for (let i = 0; i < 5; i++) {
          try {
            const btn = warmupPage.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
            if (await btn.isVisible({ timeout: 500 })) await btn.click();
            else break;
          } catch { break; }
        }
        await saveCookies();
        console.error("[scrape_all] Session established, URL:", warmupPage.url());
      } finally {
        await warmupPage.close();
      }

      // Step 2: 并发执行采集，最多3个同时
      const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
      fs.mkdirSync(debugDir, { recursive: true });
      // ★ 启用 lite 模式：后续所有 navigateToSellerCentral 都用简化流程
      _navLiteMode = true;
      console.error("[scrape_all] Step 2: Running all scrapers (concurrency=3) with popup monitor + lite nav...");
      const tasks = [
        // ---- 核心运营数据 (8个) ----
        { key: "dashboard", fn: () => scrapeHomeDashboard() },
        { key: "products", fn: () => scrapeProducts() },
        { key: "orders", fn: () => scrapeOrders() },
        { key: "sales", fn: () => scrapeSales() },
        { key: "flux", fn: () => scrapeFluxAnalysis() },
        { key: "goodsData", fn: () => scrapeGoodsData() },
        { key: "activity", fn: () => scrapeActivityData() },
        { key: "afterSales", fn: () => scrapeAfterSales() },
        // ---- 用户选择 (5个) ----
        { key: "lifecycle", fn: () => scrapeProductLifecycle() },
        { key: "priceCompete", fn: () => scrapePriceCompete() },
        { key: "urgentOrders", fn: () => scrapeUrgentOrders() },
        { key: "shippingDesk", fn: () => scrapeShippingDesk() },
        { key: "shippingList", fn: () => scrapeShippingList() },
        { key: "addressManage", fn: () => scrapeAddressManage() },
        { key: "returnOrders", fn: () => scrapeReturnOrders() },
        { key: "exceptionNotice", fn: () => scrapeExceptionNotice() },
        { key: "returnDetail", fn: () => scrapeReturnDetail() },
        { key: "salesReturn", fn: () => scrapeSalesReturn() },
        { key: "returnReceipt", fn: () => scrapeReturnReceipt() },
        { key: "priceReport", fn: () => scrapePriceReport() },
        { key: "flowPrice", fn: () => scrapeFlowPrice() },
        { key: "imageTask", fn: () => scrapeImageTask() },
        { key: "sampleManage", fn: () => scrapeSampleManage() },
        { key: "checkup", fn: () => scrapeCheckup() },
        { key: "usRetrieval", fn: () => scrapeUSRetrieval() },
        { key: "retailPrice", fn: () => scrapeRetailPrice() },
        { key: "qualityDashboard", fn: () => scrapeQualityDashboard() },
        { key: "qualityDashboardEU", fn: () => scrapeQualityDashboardEU() },
        { key: "qcDetail", fn: () => scrapeQcDetail() },
        { key: "mallFlux", fn: () => scrapeMallFlux() },
        { key: "mallFluxEU", fn: () => scrapeMallFluxEU() },
        { key: "fluxEU", fn: () => scrapeFluxEU() },
        { key: "fluxUS", fn: () => scrapeFluxUS() },
        { key: "mallFluxUS", fn: () => scrapeMallFluxUS() },
        { key: "activityLog", fn: () => scrapeActivityLog() },
        { key: "chanceGoods", fn: () => scrapeChanceGoods() },
        { key: "marketingActivity", fn: () => scrapeMarketingActivity() },
        { key: "flowGrow", fn: () => scrapeFlowGrow() },
        { key: "activityUS", fn: () => scrapeActivityUS() },
        { key: "activityEU", fn: () => scrapeActivityEU() },
        // ---- 合规中心 (16个) ----
        { key: "governDashboard", fn: () => scrapeGovernDashboard() },
        { key: "governProductQualification", fn: () => scrapeGovernProductQualification() },
        { key: "governQualificationAppeal", fn: () => scrapeGovernQualificationAppeal() },
        { key: "governEprQualification", fn: () => scrapeGovernEprQualification() },
        { key: "governProductPhoto", fn: () => scrapeGovernProductPhoto() },
        { key: "governComplianceInfo", fn: () => scrapeGovernComplianceInfo() },
        { key: "governResponsiblePerson", fn: () => scrapeGovernResponsiblePerson() },
        { key: "governManufacturer", fn: () => scrapeGovernManufacturer() },
        { key: "governComplaint", fn: () => scrapeGovernComplaint() },
        { key: "governViolationAppeal", fn: () => scrapeGovernViolationAppeal() },
        { key: "governMerchantAppeal", fn: () => scrapeGovernMerchantAppeal() },
        { key: "governTro", fn: () => scrapeGovernTro() },
        { key: "governEprBilling", fn: () => scrapeGovernEprBilling() },
        { key: "governComplianceReference", fn: () => scrapeGovernComplianceReference() },
        { key: "governCustomsAttribute", fn: () => scrapeGovernCustomsAttribute() },
        { key: "governCategoryCorrection", fn: () => scrapeGovernCategoryCorrection() },
        // ---- 推广平台 (6个) ----
        { key: "adsHome", fn: () => scrapeAdsHome() },
        { key: "adsProduct", fn: () => scrapeAdsProduct() },
        { key: "adsReport", fn: () => scrapeAdsReport() },
        { key: "adsFinance", fn: () => scrapeAdsFinance() },
        { key: "adsHelp", fn: () => scrapeAdsHelp() },
        { key: "adsNotification", fn: () => scrapeAdsNotification() },
      ];
      const results = {};
      const CONCURRENCY = 4;
      const queue = [...tasks];
      const running = [];

      const runNext = () => {
        const task = queue.shift();
        if (!task) return null;
        const startMs = Date.now();
        console.error(`[scrape_all] Starting: ${task.key}`);
        const p = task.fn()
          .then(data => {
            const dur = Math.round((Date.now() - startMs) / 1000);
            console.error(`[scrape_all] ✓ ${task.key} done in ${dur}s`);
            // 保存数据到文件（避免返回超大JSON导致IPC失败）
            const dataFile = path.join(debugDir, `scrape_all_${task.key}.json`);
            try { fs.writeFileSync(dataFile, JSON.stringify(data)); } catch (e) { console.error(`[scrape_all] Failed to save ${task.key}:`, e.message); }
            const dataSize = JSON.stringify(data || {}).length;
            results[task.key] = { success: true, duration: dur, dataFile, dataSize };
          })
          .catch(err => {
            const dur = Math.round((Date.now() - startMs) / 1000);
            console.error(`[scrape_all] ✗ ${task.key} failed in ${dur}s: ${err.message}`);
            results[task.key] = { success: false, error: err.message, duration: dur };
          })
          .then(() => {
            running.splice(running.indexOf(p), 1);
            const next = runNext();
            if (next) running.push(next);
          });
        return p;
      };

      for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
        const p = runNext();
        if (p) running.push(p);
      }
      while (running.length > 0) await Promise.race(running);

      // 关闭弹窗监控和 lite 模式
      _navLiteMode = false;
      popupMonitorActive = false;
      context.removeListener("page", handleAuthPopup);
      console.error("[popup-monitor] Monitor removed, lite mode off");

      console.error("[scrape_all] All done!", Object.keys(results).map(k => `${k}:${results[k].success}`).join(", "));

      // 采集完成后关闭浏览器
      try {
        if (browser) { await browser.close(); browser = null; context = null; }
        console.error("[scrape_all] Browser closed.");
      } catch (e) { console.error("[scrape_all] Failed to close browser:", e.message); }

      return results;
    }
    case "read_scrape_data": {
      // 从文件读取 scrape_all 保存的数据
      const taskKey = params.key;
      const debugDir2 = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
      const dataFile2 = path.join(debugDir2, `scrape_all_${taskKey}.json`);
      if (fs.existsSync(dataFile2)) {
        return JSON.parse(fs.readFileSync(dataFile2, "utf8"));
      }
      return null;
    }
    case "scrape_goods_data": {
      await ensureBrowser();
      return { goodsData: await scrapeGoodsData() };
    }
    case "scrape_activity": {
      await ensureBrowser();
      return { activity: await scrapeActivityData() };
    }
    case "scrape_performance": {
      await ensureBrowser();
      return { performance: await scrapePerformanceBoard() };
    }
    case "scrape_main_pages": {
      await ensureBrowser();
      return { mainPages: await scrapeMainPages() };
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
    case "scan_menu": {
      // 扫描侧边栏所有菜单项，返回文本和链接
      await ensureBrowser();
      const pg = context.pages().find(p => p.url().includes("agentseller.temu.com") && !p.url().includes("authentication"));
      const scanPage = pg || await context.newPage();
      if (!pg) {
        await navigateToSellerCentral(scanPage, "/goods/list");
        await randomDelay(3000, 5000);
      }
      // 关闭弹窗
      for (let i = 0; i < 5; i++) {
        try {
          const btn = scanPage.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
          if (await btn.isVisible({ timeout: 500 })) await btn.click();
          else break;
        } catch { break; }
      }
      // 展开所有子菜单
      await scanPage.evaluate(() => {
        document.querySelectorAll('[class*="menu-submenu-title"], [class*="submenu-title"], [class*="ant-menu-submenu-title"]').forEach(el => {
          const p = el.closest('[class*="submenu"]') || el.parentElement;
          const isOpen = p?.classList?.toString().includes('open') || p?.classList?.toString().includes('active');
          if (!isOpen) el.click();
        });
      });
      await randomDelay(2000, 3000);
      // 再展开一次
      await scanPage.evaluate(() => {
        document.querySelectorAll('[class*="menu-submenu-title"], [class*="submenu-title"]').forEach(el => {
          const p = el.closest('[class*="submenu"]') || el.parentElement;
          const isOpen = p?.classList?.toString().includes('open') || p?.classList?.toString().includes('active');
          if (!isOpen) el.click();
        });
      });
      await randomDelay(1000, 1500);
      // 收集菜单
      const menuItems = await scanPage.evaluate(() => {
        const results = [];
        const seen = new Set();
        // 所有 a 标签
        document.querySelectorAll('a[href]').forEach(a => {
          const inMenu = a.closest('[class*="menu"], [class*="sider"], [class*="sidebar"], nav');
          if (!inMenu) return;
          const text = a.innerText?.trim();
          const href = a.getAttribute('href');
          if (text && href && text.length < 40 && !seen.has(href)) {
            seen.add(href);
            results.push({ text, href, visible: a.offsetWidth > 0 && a.offsetHeight > 0 });
          }
        });
        return results;
      });
      if (!pg) await scanPage.close();
      return { menuItems, total: menuItems.length };
    }
    case "explore_page": {
      // 探索指定页面的所有 API
      await ensureBrowser();
      const { targetUrl, menuText } = params;
      const ep = await context.newPage();
      const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
      fs.mkdirSync(debugDir, { recursive: true });

      const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];
      const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', 'get-leo-config', '_stm', 'msgBox', 'auth/userInfo', 'auth/menu', 'queryTotalExam', 'feedback/entrance', 'rule/unreadNum', 'suggestedPrice', 'checkAbleFeedback', 'queryFeedbackNotReadTotal', 'pop/query', 'batchMatchBySupplierIds', 'gray/agent'];
      const capturedApis = [];

      ep.on("response", async (resp) => {
        const url = resp.url();
        const method = resp.request().method();
        const ct = resp.headers()["content-type"] || "";
        const isStatic = staticExts.some(ext => url.includes(ext));
        const isFramework = frameworkPatterns.some(pat => url.includes(pat));
        if (!isStatic && !isFramework && (method === "POST" || (method === "GET" && url.includes("/api/"))) && (ct.includes("json") || url.includes("/api/"))) {
          try {
            const body = await resp.text();
            capturedApis.push({
              method,
              path: new URL(url).pathname,
              status: resp.status(),
              postData: resp.request().postData()?.substring(0, 2000) || null,
              responsePreview: body.substring(0, 3000),
            });
          } catch {}
        }
      });

      try {
        await navigateToSellerCentral(ep, targetUrl);
        await randomDelay(3000, 5000);
        // 关闭弹窗
        for (let i = 0; i < 5; i++) {
          try {
            const btn = ep.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不"), button:has-text("去处理")').first();
            if (await btn.isVisible({ timeout: 500 })) await btn.click();
            else break;
          } catch { break; }
        }
        await randomDelay(5000, 8000);
        // 截图
        const safeName = (menuText || targetUrl).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_").substring(0, 30);
        await ep.screenshot({ path: path.join(debugDir, `explore_${safeName}.png`), fullPage: false }).catch(() => {});

        const contentInfo = await ep.evaluate(() => ({
          url: location.href,
          title: document.title,
          tableCount: document.querySelectorAll('table').length,
          tableHeaders: [...(document.querySelector('table')?.querySelectorAll('th') || [])].map(th => th.innerText?.trim()).slice(0, 20),
          cardCount: document.querySelectorAll('[class*="card"], [class*="stat"]').length,
          bodyTextLen: (document.body?.innerText || '').trim().length,
          bodyTextPreview: (document.body?.innerText || '').trim().substring(0, 500),
        }));

        console.error(`[explore] ${menuText || targetUrl}: URL=${contentInfo.url}, APIs=${capturedApis.length}, tables=${contentInfo.tableCount}, text=${contentInfo.bodyTextLen}`);
        return { contentInfo, apis: capturedApis, apiCount: capturedApis.length };
      } finally {
        await ep.close();
      }
    }
    case "scrape_lifecycle": { await ensureBrowser(); return { lifecycle: await scrapeProductLifecycle() }; }
    case "scrape_bidding": { await ensureBrowser(); return { bidding: await scrapeBiddingOpportunity() }; }
    case "scrape_price_compete": { await ensureBrowser(); return { priceCompete: await scrapePriceCompete() }; }
    case "scrape_hot_plan": { await ensureBrowser(); return { hotPlan: await scrapeHotPlan() }; }
    case "scrape_checkup": { await ensureBrowser(); return { checkup: await scrapeCheckupCenter() }; }
    case "scrape_us_retrieval": { await ensureBrowser(); return { usRetrieval: await scrapeUSRetrieval() }; }
    case "scrape_delivery": { await ensureBrowser(); return { delivery: await scrapeDeliveryAssessment() }; }
    case "scrape_retail_price": { await ensureBrowser(); return { retailPrice: await scrapeRetailPrice() }; }
    case "scrape_market_analysis": { await ensureBrowser(); return { marketAnalysis: await scrapeMarketAnalysis() }; }
    case "scrape_label_code": { await ensureBrowser(); return { labelCode: await scrapeLabelCode() }; }
    case "scrape_vacuum": { await ensureBrowser(); return { vacuumPumping: await scrapeVacuumPumping() }; }
    case "scrape_urgent_orders": { await ensureBrowser(); return { urgentOrders: await scrapeUrgentOrders() }; }
    case "scrape_goods_draft": { await ensureBrowser(); return { goodsDraft: await scrapeGoodsDraft() }; }
    case "scrape_bonded_goods": { await ensureBrowser(); return { bondedGoods: await scrapeBondedGoods() }; }
    case "scrape_receive_abnormal": { await ensureBrowser(); return { receiveAbnormal: await scrapeReceiveAbnormal() }; }
    case "scrape_delivery_desk": { await ensureBrowser(); return { deliveryDesk: await scrapeDeliveryDesk() }; }
    case "scrape_sidebar_pages": { await ensureBrowser(); return { sidebarPages: await scrapeSidebarPages() }; }
    // ---- 合规中心 ----
    case "scrape_govern_dashboard": { await ensureBrowser(); return { governDashboard: await scrapeGovernDashboard() }; }
    case "scrape_govern_product_qualification": { await ensureBrowser(); return { governProductQualification: await scrapeGovernProductQualification() }; }
    case "scrape_govern_qualification_appeal": { await ensureBrowser(); return { governQualificationAppeal: await scrapeGovernQualificationAppeal() }; }
    case "scrape_govern_epr_qualification": { await ensureBrowser(); return { governEprQualification: await scrapeGovernEprQualification() }; }
    case "scrape_govern_product_photo": { await ensureBrowser(); return { governProductPhoto: await scrapeGovernProductPhoto() }; }
    case "scrape_govern_compliance_info": { await ensureBrowser(); return { governComplianceInfo: await scrapeGovernComplianceInfo() }; }
    case "scrape_govern_responsible_person": { await ensureBrowser(); return { governResponsiblePerson: await scrapeGovernResponsiblePerson() }; }
    case "scrape_govern_manufacturer": { await ensureBrowser(); return { governManufacturer: await scrapeGovernManufacturer() }; }
    case "scrape_govern_complaint": { await ensureBrowser(); return { governComplaint: await scrapeGovernComplaint() }; }
    case "scrape_govern_violation_appeal": { await ensureBrowser(); return { governViolationAppeal: await scrapeGovernViolationAppeal() }; }
    case "scrape_govern_merchant_appeal": { await ensureBrowser(); return { governMerchantAppeal: await scrapeGovernMerchantAppeal() }; }
    case "scrape_govern_tro": { await ensureBrowser(); return { governTro: await scrapeGovernTro() }; }
    case "scrape_govern_epr_billing": { await ensureBrowser(); return { governEprBilling: await scrapeGovernEprBilling() }; }
    case "scrape_govern_compliance_reference": { await ensureBrowser(); return { governComplianceReference: await scrapeGovernComplianceReference() }; }
    case "scrape_govern_customs_attribute": { await ensureBrowser(); return { governCustomsAttribute: await scrapeGovernCustomsAttribute() }; }
    case "scrape_govern_category_correction": { await ensureBrowser(); return { governCategoryCorrection: await scrapeGovernCategoryCorrection() }; }
    // ---- 推广平台 (ads.temu.com) ----
    case "scrape_ads_home": { await ensureBrowser(); return { adsHome: await scrapeAdsHome() }; }
    case "scrape_ads_product": { await ensureBrowser(); return { adsProduct: await scrapeAdsProduct() }; }
    case "scrape_ads_report": { await ensureBrowser(); return { adsReport: await scrapeAdsReport() }; }
    case "scrape_ads_finance": { await ensureBrowser(); return { adsFinance: await scrapeAdsFinance() }; }
    case "scrape_ads_help": { await ensureBrowser(); return { adsHelp: await scrapeAdsHelp() }; }
    case "scrape_ads_notification": { await ensureBrowser(); return { adsNotification: await scrapeAdsNotification() }; }
    case "probe_page": {
      // 探测指定页面的所有业务 API
      await ensureBrowser();
      const targetPath = params.path || "/goods/list";
      const page = await context.newPage();
      const allApis = [];
      const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', 'get-leo-config', '_stm', 'msgBox', 'auth/userInfo', 'auth/menu', 'queryTotalExam', 'feedback/entrance', 'rule/unreadNum', 'suggestedPrice', 'checkAbleFeedback', 'queryFeedbackNotReadTotal', 'pop/query', '.js', '.css', '.png', '.svg', '.woff', '.ico', '.jpg', '.gif', '.map', '.webp', 'hm.baidu', 'google', 'favicon', 'hot-update', 'sockjs'];
      try {
        page.on("response", async (resp) => {
          try {
            const url = resp.url();
            if (frameworkPatterns.some(p => url.includes(p))) return;
            if (!url.includes("agentseller.temu.com") && !url.includes("kuajingmaihuo.com") && !url.includes("bg-")) return;
            if (resp.status() === 200) {
              const ct = resp.headers()["content-type"] || "";
              if (ct.includes("json") || ct.includes("application")) {
                const body = await resp.json().catch(() => null);
                if (body) {
                  // 提取 URL 路径
                  const u = new URL(url);
                  allApis.push({ path: u.pathname, hasResult: !!body.result, success: body.success, dataKeys: body.result ? Object.keys(body.result).slice(0, 10) : [] });
                }
              }
            }
          } catch {}
        });
        await navigateToSellerCentral(page, targetPath);
        await randomDelay(10000, 15000);
        // 关闭弹窗
        for (let i = 0; i < 5; i++) {
          try {
            const btn = page.locator('button:has-text("知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
            if (await btn.isVisible({ timeout: 500 })) await btn.click();
            else break;
          } catch { break; }
        }
        await randomDelay(3000, 5000);
        console.error(`[probe] ${targetPath} => ${allApis.length} APIs captured`);
        return { path: targetPath, apis: allApis };
      } finally {
        await page.close();
      }
    }
    case "probe_batch": {
      // 批量探测多个页面
      await ensureBrowser();
      const paths = params.paths || [];
      const results = {};
      for (const p of paths) {
        try {
          const page = await context.newPage();
          const apis = [];
          const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', 'get-leo-config', '_stm', 'msgBox', 'auth/userInfo', 'auth/menu', 'queryTotalExam', 'feedback/entrance', 'rule/unreadNum', 'suggestedPrice', 'checkAbleFeedback', 'queryFeedbackNotReadTotal', 'pop/query', '.js', '.css', '.png', '.svg', '.woff', '.ico', '.jpg', '.gif', '.map', '.webp', 'hm.baidu', 'google', 'favicon', 'hot-update', 'sockjs'];
          page.on("response", async (resp) => {
            try {
              const url = resp.url();
              if (frameworkPatterns.some(pat => url.includes(pat))) return;
              if (resp.status() === 200) {
                const ct = resp.headers()["content-type"] || "";
                if (ct.includes("json") || ct.includes("application")) {
                  const body = await resp.json().catch(() => null);
                  if (body) {
                    const u = new URL(url);
                    apis.push({ path: u.pathname, hasResult: !!body.result, success: body.success, dataKeys: body.result ? Object.keys(body.result).slice(0, 10) : [] });
                  }
                }
              }
            } catch {}
          });
          await navigateToSellerCentral(page, p);
          await randomDelay(8000, 12000);
          for (let i = 0; i < 3; i++) {
            try {
              const btn = page.locator('button:has-text("知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
              if (await btn.isVisible({ timeout: 500 })) await btn.click();
              else break;
            } catch { break; }
          }
          await randomDelay(2000, 3000);
          console.error(`[probe-batch] ${p} => ${apis.length} APIs`);
          results[p] = apis;
          await page.close();
        } catch (e) {
          console.error(`[probe-batch] ${p} ERROR: ${e.message}`);
          results[p] = { error: e.message };
        }
      }
      return results;
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
server.timeout = 1800000; // 30分钟超时
server.keepAliveTimeout = 1800000;
server.headersTimeout = 1810000;
server.listen(PORT, "127.0.0.1", () => {
  // 把端口写到文件
  const portFile = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "worker-port");
  fs.mkdirSync(path.dirname(portFile), { recursive: true });
  fs.writeFileSync(portFile, String(PORT));
  console.error(`WORKER_PORT=${PORT}`);
  console.log(`Worker ready on port ${PORT}`);
});

process.on("SIGTERM", async () => { await closeBrowser(); server.close(); process.exit(0); });
