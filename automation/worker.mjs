/**
 * 自动化 Worker - 通过 HTTP 服务通信，避免 stdio pipe 继承问题
 */
import { chromium } from "playwright";
import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { randomDelay, downloadImage, saveBase64Image, getDebugDir, getTmpDir, logSilent, ERR } from "./utils.mjs";
import { browserState, ensureBrowser as _ensureBrowser, launch as _launch, login, saveCookies, closeBrowser, findLatestCookie } from "./browser.mjs";
import { buildScrapeHandlers, getScrapeFunction } from "./scrape-registry.mjs";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

// Load API keys from temu-claw .env
const envFiles = [
  path.join(process.env.APPDATA || "", "..", "temu-claw", ".env"),
  "C:/Users/Administrator/temu-claw/.env",
];
for (const envFile of envFiles) {
  try {
    if (fs.existsSync(envFile)) {
      for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
        const m = line.match(/^([^#=]+)=(.+)$/);
        if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
      }
      break;
    }
  } catch (e) { logSilent("env.load", e); }
}

// AI API 配置（从环境变量读取，不再硬编码）
const AI_API_KEY = process.env.VECTORENGINE_API_KEY || "";
const AI_BASE_URL = process.env.VECTORENGINE_BASE_URL || "https://api.vectorengine.ai/v1";
const AI_MODEL = process.env.VECTORENGINE_MODEL || "gemini-3.1-flash-lite-preview";

// browser/context 代理：旧代码通过全局 browser/context 访问，实际指向 browserState
// 使用 defineProperty 创建动态代理，读写都同步到 browserState
let browser = null;
let context = null;
let cookiePath = "";
let lastAccountId = "";
let _navLiteMode = false;

// 同步 browserState 到局部变量（ensureBrowser/launch 后自动调用）
function syncBrowserState() {
  browser = browserState.browser;
  context = browserState.context;
  cookiePath = browserState.cookiePath;
  lastAccountId = browserState.lastAccountId;
  _navLiteMode = browserState.navLiteMode;
}
async function ensureBrowser() { await _ensureBrowser(); syncBrowserState(); }
async function launch(accountId, headless) { await _launch(accountId, headless); syncBrowserState(); }

// randomDelay, findChromeExe → moved to utils.mjs / browser.mjs

// 浏览器管理函数 → moved to browser.mjs
// 通过 browserState 访问 browser/context（兼容旧代码引用）

// login → moved to browser.mjs
const TEMU_BASE_URL = "https://seller.kuajingmaihuo.com";

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
    } catch (e) { logSilent("ui.action", e); }

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
      } catch (e) { logSilent("ui.action", e); }
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
                } catch (e) { logSilent("ui.action", e); }
                if (!btnClicked) {
                  try {
                    const btn2 = popup.locator('button:has-text("确认授权")').first();
                    if (await btn2.isVisible({ timeout: 1000 })) {
                      await btn2.click();
                      console.error("[nav] Clicked '确认授权' via locator");
                      btnClicked = true;
                    }
                  } catch (e) { logSilent("ui.action", e); }
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
            } catch (e) { logSilent("ui.action", e); }

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
          } catch (e) { logSilent("ui.action", e); }

          // 用 locator 方式点击确认按钮
          let popupBtnClicked = false;
          try {
            const btn = popup.locator('button:has-text("确认授权并前往")').first();
            if (await btn.isVisible({ timeout: 2000 })) {
              await btn.click();
              console.error("[nav] Popup: clicked '确认授权并前往' via locator");
              popupBtnClicked = true;
            }
          } catch (e) { logSilent("ui.action", e); }
          if (!popupBtnClicked) {
            try {
              const btn2 = popup.locator('button:has-text("确认授权")').first();
              if (await btn2.isVisible({ timeout: 1000 })) {
                await btn2.click();
                console.error("[nav] Popup: clicked '确认授权' via locator");
                popupBtnClicked = true;
              }
            } catch (e) { logSilent("ui.action", e); }
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
        } catch (e) { logSilent("ui.action", e); }

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
      } catch (e) { logSilent("ui.action", e); }
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

// 核心采集函数已移到 scrape-registry.mjs（配置驱动）

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
      } catch (e) { logSilent("ui.action", e); }
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
      } catch (e) { logSilent("ui.action", e); }
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
      } catch (e) { logSilent("ui.action", e); }
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

// listener-based 采集函数已移到 scrape-registry.mjs

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
      } catch (e) { logSilent("ui.action", e); }
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
      } catch (e) { logSilent("ui.action", e); }
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
        } catch (e) { logSilent("ui.action", e); }
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
        } catch (e) { logSilent("ui.action", e); }
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

// 侧边栏/直接路径/多区域采集函数已移到 scrape-registry.mjs

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
      } catch (e) { logSilent("ui.action", e); }
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
        } catch (e) { logSilent("ui.action", e); }
      }
    } catch (e) { logSilent("ui.action", e); }

    console.error(`[qc-detail] Done! Captured ${capturedApis.length} APIs`);
    await saveCookies();
    return { apis: capturedApis };
  } finally {
    await page.close();
  }
}

// 品质/样品/图片/流量采集函数已移到 scrape-registry.mjs

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
      } catch (e) { logSilent("ui.action", e); }
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

// 合规中心子页面采集函数已移到 scrape-registry.mjs

// ---- 上品核价自动化 ----

/**
 * 下载图片到本地
 */
// downloadImage → moved to utils.mjs

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
      // 父级分类用于过滤搜索结果（取第一级）
      const categoryParent = categoryParts[0] || "";

      // Step 3: 价格转人民币（粗略 * 7）
      const priceCNY = priceUSD > 0 ? (priceUSD * 7).toFixed(2) : "9.99";

      // Step 4: 调用 autoCreateProduct
      const result = await autoCreateProduct({
        categorySearch,
        categorySearchList: categorySearchList, // 逐级尝试的分类列表
        categoryParent, // 父级分类用于过滤搜索结果
        title: productName,
        sourceImage: localImagePath,
        generateAI: params.generateAI !== false,
        aiImageTypes: params.aiImageTypes || ["hero", "lifestyle", "closeup", "infographic", "size_chart"],
        price: parseFloat(priceCNY),
        autoSubmit: params.autoSubmit || false,
        keepOpen: params.keepOpen || false,
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
  const AI_SERVER = process.env.AI_IMAGE_SERVER || "http://localhost:3210";
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
        } catch (e) { logSilent("ui.action", e); }
      }
    }

    console.error(`[ai-image] Done! Generated ${generatedPaths.length} images`);
    return { images: generatedPaths, cnTitle: null };
  } catch (e) {
    console.error(`[ai-image] Error: ${e.message}`);
    return { images: [], cnTitle: null };
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
    } catch (e) { logSilent("ui.action", e); }
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
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("不使用"), button:has-text("关闭")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }
    await takeDebugScreenshot("01_category_page");

    // ========== Step 2: 搜索并选择分类 ==========
    console.error("[create-product] Step 2: Select category");
    const categoryInput = page.locator('input[placeholder*="搜索分类"], input[placeholder*="搜索类目"], input[placeholder*="商品名称"], input[placeholder*="可输入"]').first();

    if (await categoryInput.isVisible({ timeout: 3000 })) {
      // 搜索分类：从标题中提取关键产品词
      const searchTerms = [];

      // 从标题提取关键词（去掉数量词、尺寸、通用形容词）
      if (params.title) {
        const title = params.title;
        // 提取核心产品名（去掉数量、尺寸、品牌等修饰词）
        const stopWords = /\b(upgraded|premium|professional|portable|universal|adjustable|durable|waterproof|heavy duty|high quality|set|pack|pcs|psc|piece|inch|cm|mm|ml|oz|for|with|and|the|a|an|in|on|of|to|is|it|by)\b/gi;
        const cleaned = title
          .replace(/\d+\s*(pcs|pack|set|pairs?|pieces?|inch|cm|mm|ml|oz|g|kg|lb)\b/gi, "")
          .replace(/\d+(\.\d+)?\s*(x|×)\s*\d+(\.\d+)?/gi, "")
          .replace(/\d{3,}/g, "")
          .replace(stopWords, "")
          .replace(/[,\-|()]/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        // 取前4个有意义的词作为搜索词
        const words = cleaned.split(" ").filter(w => w.length > 2);
        if (words.length > 0) {
          searchTerms.push(words.slice(0, 4).join(" "));
        }
        // 也用前2个词试试（更宽泛）
        if (words.length > 2) {
          searchTerms.push(words.slice(0, 2).join(" "));
        }
        // 整个标题作为最后备选
        searchTerms.push(title);
      }

      // 策略：先搜标题，从结果中匹配最后一级类目关键词
      if (params.categorySearch && params.categorySearch !== params.title) {
        const lastLevel = params.categorySearch.split("/").pop()?.trim();
        // 标题优先搜索，最后一级分类作为备选
        if (lastLevel) searchTerms.push(lastLevel);
        console.error(`[create-product] Search by title first, match against: "${lastLevel}"`);
      }
      if (Array.isArray(params.categorySearchList)) searchTerms.push(...params.categorySearchList);

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
        // 用最后一级类目名作为匹配依据
        const lastLevelCat = (params.categorySearch || "").split("/").pop()?.trim() || "";
        const parentCategory = lastLevelCat || params.categoryParent || "";
        const clickResult = await page.evaluate((parentCat) => {
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
          if (candidates.length > 0) {
            candidates.sort((a, b) => a.top - b.top);
            // 如果有父级分类，优先匹配包含父级关键词的结果
            if (parentCat) {
              // parentCat 现在传的是最后一级类目名（如"磨料与抛光用品"）
              // 从中提取关键词用于匹配搜索结果
              const catKeywords = parentCat.replace(/[/、与和，,用品产品]/g, " ").split(/\s+/).filter(w => w.length >= 2);
              console.log("[category] Matching keywords:", catKeywords.join(","), "in", candidates.length, "results");
              candidates.forEach((c,i) => console.log("  [" + i + "]", c.text.slice(0,60)));

              // 找包含类目关键词最多的结果
              let bestMatch = null, bestScore = 0;
              for (const c of candidates) {
                const score = catKeywords.filter(kw => c.text.includes(kw)).length;
                if (score > bestScore) { bestScore = score; bestMatch = c; }
              }
              if (bestMatch && bestScore > 0) {
                bestMatch.el.click();
                return "[matched:" + bestScore + "] " + bestMatch.text.slice(0, 80);
              }
              // 没匹配到类目关键词，不选，继续下一个搜索词
              return null;
            }
            // 没有类目约束，选第一个
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
        }, parentCategory);

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
      } catch (e) { logSilent("ui.action", e); }
    } else {
      console.error("[create-product] Category input not found!");
      await takeDebugScreenshot("02_category_input_missing");
      return { success: false, message: "找不到分类搜索框", screenshots };
    }

    await takeDebugScreenshot("04_basic_info_page");
    console.error("[create-product] Step 2 done: Category selected");

    // ========== Step 3: 等待页面加载 ==========
    try {
      await page.waitForFunction(() => {
        const spinners = document.querySelectorAll('.ant-spin-spinning, [class*="loading"], [class*="Loading"]');
        return spinners.length === 0 || Array.from(spinners).every(s => s.offsetParent === null);
      }, { timeout: 15000 });
    } catch {
      await randomDelay(5000, 8000);
    }
    await randomDelay(2000, 3000);

    // ========== Step 3: AI 图片生成（可选） ==========
    if (params.generateAI && params.sourceImage) {
      console.error("[create-product] Step 3: Generate AI images");
      try {
        const aiResult = await generateAIImages(
          params.sourceImage,
          params.title,
          params.aiImageTypes || ["hero", "lifestyle", "closeup"]
        );
        const aiImages = aiResult.images || aiResult;
        if (aiImages.length > 0) {
          params.images = [...(params.images || []), ...aiImages];
          console.error(`[create-product] AI generated ${aiImages.length} images`);
        }
        // 用 Claude API 翻译标题为中文
        if (params.title && /[a-zA-Z]/.test(params.title)) {
          console.error("[create-product] Translating title to Chinese...");
          try {
            const apiKey = process.env.ANTHROPIC_API_KEY;
            if (apiKey) {
              const cnTitle = await new Promise((resolve, reject) => {
                // https is imported at top
                const postBody = Buffer.from(JSON.stringify({
                  model: "claude-sonnet-4-20250514",
                  max_tokens: 200,
                  messages: [{ role: "user", content: "Translate this e-commerce product title to Chinese (Temu style, concise with selling points). Return ONLY the Chinese title:\n\n" + params.title }]
                }), "utf8");
                const req = https.request({
                  hostname: "api.anthropic.com", port: 443, path: "/v1/messages", method: "POST",
                  headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json", "content-length": postBody.length }
                }, res => {
                  let data = ""; res.on("data", c => data += c);
                  res.on("end", () => { try { resolve(JSON.parse(data).content?.[0]?.text?.trim()); } catch { resolve(null); } });
                });
                req.on("error", reject);
                req.write(postBody); req.end();
              });
              if (cnTitle && cnTitle.length > 3) {
                params.title = cnTitle;
                console.error(`[create-product] Chinese title: ${cnTitle.slice(0, 40)}`);
              }
            }
          } catch (e) { console.error("[create-product] Translation failed:", e.message); }
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

      // 等待页面完全加载
      console.error("[create-product] Waiting for page to fully load before upload...");
      try {
        await page.waitForFunction(() => {
          const spinners = document.querySelectorAll('.ant-spin-spinning, [class*="loading"], [class*="Loading"]');
          return spinners.length === 0 || Array.from(spinners).every(s => s.offsetParent === null);
        }, { timeout: 20000 });
      } catch (e) { logSilent("ui.action", e); }
      await randomDelay(3000, 5000);

      // 滚动到商品轮播图/素材中心区域
      await page.evaluate(() => {
        const labels = document.querySelectorAll("span, label, div");
        for (const el of labels) {
          if (el.textContent?.includes("商品轮播图") || el.textContent?.includes("素材中心") || el.textContent?.includes("商品主图")) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            break;
          }
        }
      });
      await randomDelay(2000, 3000);
      await takeDebugScreenshot("05b_before_upload");

      let uploaded = false;

      // Temu 上传流程：点击"素材中心"按钮 → 弹出素材中心 → 本地上传
      console.error("[create-product] Looking for '素材中心' button...");

      // 用 evaluate 精确查找"素材中心"按钮（它是一个带图标+文字的div）
      const materialFound = await page.evaluate(() => {
        const allEls = document.querySelectorAll("div, span, a, button");
        for (const el of allEls) {
          const text = el.textContent?.trim() || "";
          if (text === "素材中心" && el.offsetParent !== null) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 20 && rect.width < 200 && rect.height > 20) {
              // 点击这个元素或其父元素
              const clickTarget = el.closest("[class]") || el;
              clickTarget.click();
              return { tag: el.tagName, text, top: Math.round(rect.top), left: Math.round(rect.left) };
            }
          }
        }
        return null;
      });

      if (materialFound) {
        console.error(`[create-product] 素材中心 clicked at (${materialFound.left}, ${materialFound.top})`);
      } else {
        // 备用：用 Playwright locator
        const materialBtn = page.locator('text=素材中心').first();
        if (await materialBtn.isVisible({ timeout: 3000 })) {
          await materialBtn.click();
          console.error("[create-product] 素材中心 clicked via locator");
        }
      }

      if (materialFound) {
        try {
          console.error("[create-product] 素材中心 clicked, waiting for dialog...");
          await randomDelay(3000, 5000);
          await takeDebugScreenshot("06a_material_center");

          // Step A: 探测素材中心弹窗中的DOM，找到"本地上传"并点击
          console.error("[create-product] Looking for '本地上传' in material center...");

          // 先探测弹窗中所有可点击元素
          const domInfo = await page.evaluate(() => {
            const result = { links: [], inputs: [], buttons: [] };
            // 找所有包含"上传"文字的元素
            document.querySelectorAll("a, span, div, button, label").forEach(el => {
              const text = el.textContent?.trim() || "";
              if (text.includes("上传") && el.offsetParent !== null) {
                const rect = el.getBoundingClientRect();
                result.links.push({
                  tag: el.tagName,
                  text: text.slice(0, 30),
                  class: el.className?.slice?.(0, 50) || "",
                  rect: { top: Math.round(rect.top), left: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) },
                });
              }
            });
            // 找所有 file input
            document.querySelectorAll('input[type="file"]').forEach((el, i) => {
              result.inputs.push({
                index: i,
                accept: el.accept,
                hidden: el.offsetParent === null,
                parent: el.parentElement?.className?.slice(0, 50) || "",
              });
            });
            return result;
          });
          console.error(`[create-product] DOM scan: ${domInfo.links.length} upload links, ${domInfo.inputs.length} file inputs`);
          domInfo.links.forEach(l => console.error(`  link: <${l.tag}> "${l.text}" class="${l.class}" pos=${l.rect.left},${l.rect.top}`));
          domInfo.inputs.forEach(i => console.error(`  input[${i.index}]: accept=${i.accept} hidden=${i.hidden} parent="${i.parent}"`));

          // 点击"本地上传"（用 evaluate 直接点击匹配的元素）
          const clickedUpload = await page.evaluate(() => {
            const els = document.querySelectorAll("a, span, div, button");
            for (const el of els) {
              const text = el.textContent?.trim() || "";
              if (text === "本地上传" && el.offsetParent !== null) {
                el.click();
                return el.tagName + ": " + text;
              }
            }
            return null;
          });

          if (clickedUpload) {
            console.error(`[create-product] Clicked: ${clickedUpload}`);
            await randomDelay(2000, 3000);

            // 等待 filechooser 或新的 file input 出现
            try {
              const fileChooser = await page.waitForEvent("filechooser", { timeout: 5000 });
              await fileChooser.setFiles(validImages);
              uploaded = true;
              console.error(`[create-product] Uploaded ${validImages.length} images via filechooser after click`);
            } catch {
              console.error("[create-product] No filechooser, checking new file inputs...");
              // 可能出现了新的 file input
              const newInputs = page.locator('input[type="file"]');
              const newCount = await newInputs.count();
              console.error(`[create-product] File inputs now: ${newCount}`);
              for (let i = newCount - 1; i >= 0 && !uploaded; i--) {
                try {
                  await newInputs.nth(i).setInputFiles(validImages, { timeout: 3000 });
                  uploaded = true;
                  console.error(`[create-product] Uploaded via new file input[${i}]`);
                } catch (e) { logSilent("ui.action", e); }
              }
            }

            if (uploaded) {
              await randomDelay(10000, 15000); // 等待上传完成
              await takeDebugScreenshot("06b_after_upload");

              // 处理"重复上传"弹窗 — 点击"关闭"或"在列表中查看"
              for (let retry = 0; retry < 3; retry++) {
                const dismissed = await page.evaluate(() => {
                  const btns = document.querySelectorAll("button, a, span");
                  for (const btn of btns) {
                    const text = btn.textContent?.trim() || "";
                    if ((text === "关闭" || text === "在列表中查看") && btn.offsetParent !== null) {
                      const rect = btn.getBoundingClientRect();
                      // 确保是弹窗中的按钮（在页面中间附近）
                      if (rect.top > 200 && rect.top < 700 && rect.width > 30) {
                        btn.click();
                        return text;
                      }
                    }
                  }
                  return null;
                });
                if (dismissed) {
                  console.error(`[create-product] Dismissed popup: "${dismissed}"`);
                  await randomDelay(2000, 3000);
                } else {
                  break;
                }
              }

              // 关闭"上传列表"面板 — 点击空白区域即可关闭
              console.error("[create-product] Closing upload list panel...");
              await page.mouse.click(900, 400).catch(() => {}); // 点击素材网格区域
              await randomDelay(2000, 3000);
              // 再点一次确保关闭
              await page.mouse.click(900, 300).catch(() => {});
              await randomDelay(2000, 3000);
              console.error("[create-product] Upload list closed");
            }
          } else {
            console.error("[create-product] '本地上传' element not found in DOM");
          }

          // 最终 fallback
          if (!uploaded) {
            console.error("[create-product] Fallback: trying all file inputs...");
            const allInputs = page.locator('input[type="file"]');
            const count = await allInputs.count();
            for (let i = 0; i < count && !uploaded; i++) {
              try {
                await allInputs.nth(i).setInputFiles(validImages, { timeout: 3000 });
                uploaded = true;
                console.error(`[create-product] Uploaded via fallback input[${i}]`);
                await randomDelay(8000, 12000);
              } catch (e) { logSilent("ui.action", e); }
            }
          }

          if (uploaded) {
            // Step B: 选中刚上传的图片
            console.error("[create-product] Selecting uploaded images...");
            await randomDelay(2000, 3000);
            await takeDebugScreenshot("06c_before_select");

            // 用坐标点击素材中心的图片来选中
            let selectedCount = 0;
            try {
              // 获取素材中心图片的坐标位置
              const imagePositions = await page.evaluate(() => {
                const positions = [];
                // 找素材中心弹窗
                const imgs = document.querySelectorAll("img");
                for (const img of imgs) {
                  if (!img.offsetParent) continue;
                  const rect = img.getBoundingClientRect();
                  // 素材图片通常 100-250px 宽，在弹窗区域内
                  if (rect.width > 80 && rect.width < 300 && rect.height > 80 && rect.top > 100 && rect.top < 700) {
                    positions.push({
                      x: Math.round(rect.left + rect.width / 2),
                      y: Math.round(rect.top + rect.height / 2),
                      w: Math.round(rect.width),
                      h: Math.round(rect.height),
                    });
                  }
                }
                return positions;
              });

              console.error(`[create-product] Found ${imagePositions.length} images to select`);
              const targetCount = Math.min(validImages.length, 5, imagePositions.length);

              for (let i = 0; i < targetCount; i++) {
                const pos = imagePositions[i];
                console.error(`[create-product] Clicking image at (${pos.x}, ${pos.y})`);
                await page.mouse.click(pos.x, pos.y);
                selectedCount++;
                await randomDelay(500, 800);
              }
            } catch (e) {
              console.error(`[create-product] Image click error: ${e.message?.slice(0, 50)}`);
            }
            console.error(`[create-product] Selected ${selectedCount} images`);
            await randomDelay(2000, 3000);
            await takeDebugScreenshot("06d_images_selected");

            // 检查底部"已选X个"是否变化
            const selectionStatus = await page.evaluate(() => {
              const els = document.querySelectorAll("span, div");
              for (const el of els) {
                if (el.textContent?.includes("已选") && el.textContent?.includes("个")) {
                  return el.textContent.trim();
                }
              }
              return "unknown";
            });
            console.error(`[create-product] Selection status: ${selectionStatus}`);

            // Step C: 点击"确认"按钮（底部的确认按钮）
            console.error("[create-product] Clicking confirm...");
            try {
              // 找到素材中心弹窗底部的"确认"按钮
              const confirmed = await page.evaluate(() => {
                const btns = document.querySelectorAll("button");
                for (const btn of btns) {
                  const text = btn.textContent?.trim() || "";
                  if (text === "确认" && btn.offsetParent !== null) {
                    const rect = btn.getBoundingClientRect();
                    // 确认按钮在底部（y > 600）
                    if (rect.top > 500) {
                      btn.click();
                      return true;
                    }
                  }
                }
                return false;
              });
              if (confirmed) {
                console.error("[create-product] Confirmed! Images added to product");
                await randomDelay(3000, 5000);
              } else {
                // fallback: 用 Playwright locator
                const confirmBtn = page.locator('button:has-text("确认")').last();
                if (await confirmBtn.isVisible({ timeout: 3000 })) {
                  await confirmBtn.click();
                  console.error("[create-product] Confirmed via locator");
                  await randomDelay(3000, 5000);
                }
              }
            } catch (e) {
              console.error(`[create-product] Confirm failed: ${e.message?.slice(0, 40)}`);
            }
          }
        } catch (e) {
          console.error(`[create-product] 素材中心 approach failed: ${e.message?.slice(0, 60)}`);
        }
      } /* end if materialFound */

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
          } catch (e) { logSilent("ui.action", e); }
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

    // ========== Step 5.5: 填写商品名称（只中文，不填英文） ==========
    console.error("[create-product] Step 5.5: Fill product name (Chinese only)");
    if (params.title) {
      // 找"商品名称"标签旁边的 textarea
      const titleSelectors = [
        'textarea[placeholder*="请输入"]',
        'textarea[placeholder*="标题"]',
        'textarea[placeholder*="商品名"]',
      ];
      let titleFilled = false;
      for (const sel of titleSelectors) {
        try {
          const titleInput = page.locator(sel).first();
          if (await titleInput.isVisible({ timeout: 1000 })) {
            await titleInput.click();
            await titleInput.fill("");
            await titleInput.type(params.title, { delay: 20 + Math.random() * 30 });
            titleFilled = true;
            console.error("[create-product] Title filled: " + params.title.slice(0, 30));
            break;
          }
        } catch (e) { logSilent("ui.action", e); }
      }
      if (!titleFilled) {
        await page.evaluate((title) => {
          // 找第一个可见的 textarea（商品名称，不是英文名称）
          const labels = document.querySelectorAll("span, label, div");
          for (const label of labels) {
            if (label.textContent?.trim()?.startsWith("商品名称") && label.offsetParent) {
              const parent = label.closest("[class]")?.parentElement || label.parentElement;
              const ta = parent?.querySelector("textarea");
              if (ta) {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
                setter?.call(ta, title);
                ta.dispatchEvent(new Event("input", { bubbles: true }));
                ta.dispatchEvent(new Event("change", { bubbles: true }));
                return;
              }
            }
          }
          // fallback: 第一个可见 textarea
          const textareas = document.querySelectorAll("textarea");
          for (const ta of textareas) {
            if (ta.offsetParent !== null && ta.getBoundingClientRect().top < 800) {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
              setter?.call(ta, title);
              ta.dispatchEvent(new Event("input", { bubbles: true }));
              ta.dispatchEvent(new Event("change", { bubbles: true }));
              break;
            }
          }
        }, params.title);
        console.error("[create-product] Title filled via evaluate");
      }
      await takeDebugScreenshot("05_title_filled");
      await randomDelay(1000, 2000);
    }

    // ========== Step 6: 智能填写所有必填字段 ==========
    console.error("[create-product] Step 6: Smart auto-fill required fields");

    // 默认值映射（字段关键词 → 要选择的值）
    // 产地已在 6a 单独处理，不在这里重复操作
    const defaultValues = {
      // 通用属性（不同品类可能出现不同字段）
      "可重用性": "否",
      "Reusability": "否",
      "电池属性": "无电池",
      "Battery": "无电池",
      "材质": "__FIRST__", // 选第一个选项
      "Material": "__FIRST__",
      "砂砾材料": "__FIRST__",
      "Grit": "__FIRST__",
      "颜色": "__FIRST__",
      "Color": "__FIRST__",
      "尺寸": "__FIRST__",
      "Size": "__FIRST__",
      "品牌名": null, // 跳过品牌
      "Brand": null,
      "工作电压": null, // 非必填跳过
      // 包装
      "外包装类型": "硬包装",
      "外包装形状": "长方体",
      // 敏感属性
      "敏感属性": "非敏感品",
      // 体积重量
      "最长边": params.dimensions?.length || "8",
      "次长边": params.dimensions?.width || "7",
      "最短边": params.dimensions?.height || "6",
      "重量": params.weight || "50",
    };

    // 用户自定义属性覆盖默认值
    if (params.attributes) {
      Object.assign(defaultValues, params.attributes);
    }

    try {
      // 先关闭所有可能的弹窗
      for (let i = 0; i < 5; i++) {
        try {
          const popup = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("不使用"), button:has-text("关闭"), [class*="close"]:visible').first();
          if (await popup.isVisible({ timeout: 500 })) {
            await popup.click();
            await randomDelay(500, 1000);
          } else break;
        } catch { break; }
      }

      // ---- 6a: 商品产地 ----
      console.error("[create-product] 6a: Setting origin (商品产地)...");
      const originSet = await page.evaluate(() => {
        // 找"商品产地"标签旁边的下拉框
        const labels = document.querySelectorAll("span, label, div");
        for (const label of labels) {
          if (label.textContent?.trim()?.startsWith("商品产地") && label.offsetParent) {
            // 找最近的 select 或可点击的下拉触发器
            const parent = label.closest("div[class]")?.parentElement;
            if (parent) {
              const trigger = parent.querySelector('[class*="select"], [class*="Select"], [role="combobox"], input[readonly]');
              if (trigger) {
                trigger.click();
                return "clicked";
              }
            }
          }
        }
        return "not_found";
      });

      if (originSet === "clicked") {
        await randomDelay(1000, 2000);
        // 选择"中国大陆"
        const selected = await page.evaluate(() => {
          // 找所有下拉选项，scrollIntoView 到"中国大陆"再点击
          const allEls = document.querySelectorAll('[class*="option"], [class*="Option"], [class*="item"], li[role="option"], div, span, li');
          for (const el of allEls) {
            const text = el.textContent?.trim();
            if (text === "中国大陆" || text === "中国大陆（含港澳台）") {
              el.scrollIntoView({ block: "center" });
              el.click();
              return true;
            }
          }
          return false;
        });
        if (selected) {
          console.error("[create-product] Origin: 中国大陆 selected");
          // 点击空白处关闭下拉框
          await page.keyboard.press("Escape").catch(() => {});
          await randomDelay(2000, 3000);

          // 关闭满意度评分弹窗（如果出现）
          try {
            const closePopup = page.locator('[class*="close"], button:has-text("×")').last();
            if (await closePopup.isVisible({ timeout: 1000 })) {
              await closePopup.click();
              console.error("[create-product] Closed rating popup");
              await randomDelay(500, 1000);
            }
          } catch (e) { logSilent("ui.action", e); }

          // 选择省份 "浙江省" — 先点击省份下拉框再选
          await randomDelay(1000, 2000);
          try {
            // 找第二个下拉框（省份）
            const provinceDropdown = page.locator('[class*="select"]:has-text("请选择省份"), [class*="select"]:has-text("浙江")').first();
            if (await provinceDropdown.isVisible({ timeout: 2000 })) {
              await provinceDropdown.click();
              await randomDelay(1000, 2000);
            } else {
              // 备用：找产地行中第二个下拉框
              const selects = page.locator('[class*="select"], [class*="Select"]');
              const count = await selects.count();
              for (let i = 0; i < count; i++) {
                const text = await selects.nth(i).textContent().catch(() => "");
                if (text?.includes("请选择省份") || text?.includes("请选择")) {
                  await selects.nth(i).click();
                  await randomDelay(1000, 2000);
                  break;
                }
              }
            }
          } catch (e) { logSilent("ui.action", e); }

          const provinceSet = await page.evaluate(() => {
            const allEls = document.querySelectorAll('[class*="option"], [class*="Option"], li, div, span');
            for (const el of allEls) {
              const text = el.textContent?.trim();
              if ((text === "浙江省" || text === "浙江") && el.offsetParent !== null) {
                el.scrollIntoView({ block: "center" });
                el.click();
                return true;
              }
            }
            return false;
          });
          if (provinceSet) console.error("[create-product] Province: 浙江省 selected");
          else console.error("[create-product] Province: 浙江省 not found");
        }
      }
      // 关闭所有残留下拉框和弹窗
      await page.keyboard.press("Escape").catch(() => {});
      await randomDelay(1000, 2000);
      // 关闭满意度弹窗
      try {
        await page.evaluate(() => {
          const closes = document.querySelectorAll('[class*="close"], button');
          for (const el of closes) {
            if (el.offsetParent && el.getBoundingClientRect().right > 1200 && el.getBoundingClientRect().top > 600) {
              el.click(); // 右下角的关闭按钮
              return;
            }
          }
        });
      } catch (e) { logSilent("ui.action", e); }
      await randomDelay(1000, 2000);

      // ---- 6b: 商品属性下拉框 ----
      console.error("[create-product] 6b: Filling product attributes...");

      // 扫描所有带*号的下拉框并自动选择
      const attrResults = await page.evaluate((defaults) => {
        const results = [];
        // 找所有带*号标签的表单项
        const formItems = document.querySelectorAll("[class*='form'], [class*='Form'], [class*='field'], [class*='Field']");

        // 更通用：找所有 label/span 中带 * 的
        const allLabels = document.querySelectorAll("span, label, div");
        for (const label of allLabels) {
          const text = label.textContent?.trim() || "";
          if (!label.offsetParent) continue;
          const rect = label.getBoundingClientRect();
          if (rect.width < 20 || rect.width > 300) continue;

          // 检查常见属性字段
          for (const [key, value] of Object.entries(defaults)) {
            if (value === null) continue;
            if (text.includes(key)) {
              // 找相邻的下拉框/输入框
              const parent = label.closest("div")?.parentElement || label.parentElement;
              if (parent) {
                const selectTrigger = parent.querySelector('[class*="select"], [class*="Select"], [role="combobox"], input[readonly]');
                if (selectTrigger) {
                  selectTrigger.click();
                  results.push({ field: key, action: "clicked_dropdown" });
                }
                const input = parent.querySelector('input:not([readonly]):not([type="hidden"])');
                if (input && !selectTrigger) {
                  input.value = String(value);
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                  input.dispatchEvent(new Event("change", { bubbles: true }));
                  results.push({ field: key, action: "filled", value: String(value) });
                }
              }
              break;
            }
          }
        }
        return results;
      }, defaultValues);

      for (const r of attrResults) {
        console.error(`[create-product] Attr: ${r.field} → ${r.action} ${r.value || ""}`);
        if (r.action === "clicked_dropdown") {
          await randomDelay(500, 1000);
          // 选择对应的值
          const targetValue = defaultValues[r.field];
          if (targetValue) {
            const selectFirst = targetValue === "__FIRST__";
            await page.evaluate(({ val, first }) => {
              const options = document.querySelectorAll('[class*="option"], [class*="Option"], li[role="option"], [class*="item"]');
              const visible = Array.from(options).filter(o => {
                if (!o.offsetParent) return false;
                const rect = o.getBoundingClientRect();
                return rect.height > 10 && rect.top > 0 && rect.width > 30;
              });
              if (!first && val) {
                for (const opt of visible) {
                  if (opt.textContent?.trim()?.includes(val)) { opt.click(); return; }
                }
              }
              if (visible.length > 0) { visible[0].click(); }
            }, { val: targetValue, first: selectFirst });
            // 按Escape关闭下拉框
            await page.keyboard.press("Escape").catch(() => {});
            await randomDelay(500, 1000);
          }
        }
      }

      // ---- 6b2: 商品规格（父规格随机选，子规格随机字母）----
      console.error("[create-product] 6b2: Setting product specs...");
      // 先关闭任何残留的下拉框
      await page.keyboard.press("Escape").catch(() => {});
      await randomDelay(1000, 2000);
      // 滚动到页面下方找规格区域
      await page.evaluate(() => window.scrollBy(0, 500));
      await randomDelay(1000, 2000);

      try {
        // 找"父规格1"旁边的下拉框（文本必须精确包含"父规格"）
        const specSet = await page.evaluate(() => {
          const labels = document.querySelectorAll("span, label, div");
          for (const label of labels) {
            const text = label.textContent?.trim() || "";
            if (/^\*?父规格/.test(text) && text.length < 20 && label.offsetParent) {
              const parent = label.closest("[class]")?.parentElement || label.parentElement;
              const select = parent?.querySelector('[class*="select"], [class*="Select"], [role="combobox"], input[readonly]');
              if (select) {
                select.click();
                return "clicked";
              }
            }
          }
          return "not_found";
        });

        if (specSet === "clicked") {
          await randomDelay(1500, 2500);
          // 随机选一个选项
          const specSelected = await page.evaluate(() => {
            const options = document.querySelectorAll('[class*="option"], [class*="Option"], li[role="option"]');
            const visibleOpts = Array.from(options).filter(o => o.offsetParent !== null && o.textContent?.trim()?.length > 0);
            if (visibleOpts.length > 0) {
              const randomIdx = Math.floor(Math.random() * visibleOpts.length);
              const chosen = visibleOpts[randomIdx];
              chosen.click();
              return chosen.textContent?.trim();
            }
            return null;
          });
          if (specSelected) {
            console.error(`[create-product] Parent spec selected: ${specSelected}`);
            await randomDelay(2000, 3000);

            // 等待弹窗（商品规格填写要求），等5秒再关闭
            await new Promise(r => setTimeout(r, 5000));
            try {
              const knowBtn = page.locator('button:has-text("我知道了"), button:has-text("知道了")').first();
              if (await knowBtn.isVisible({ timeout: 2000 })) {
                await knowBtn.click();
                console.error("[create-product] Closed spec format popup");
                await randomDelay(1000, 2000);
              }
            } catch (e) { logSilent("ui.action", e); }

            // 填子规格：随机一个字母
            const randomLetter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
            await page.evaluate((letter) => {
              const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
              for (const input of inputs) {
                if (input.offsetParent && !input.value && input.getBoundingClientRect().top > 400) {
                  const placeholder = input.getAttribute("placeholder") || "";
                  // 找规格表中的输入框（不是搜索框）
                  if (!placeholder.includes("搜索") && !placeholder.includes("输入素材")) {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
                    setter?.call(input, letter);
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                    input.dispatchEvent(new Event("change", { bubbles: true }));
                    return;
                  }
                }
              }
            }, randomLetter);
            console.error(`[create-product] Child spec set: ${randomLetter}`);
          }
        }
      } catch (e) {
        console.error(`[create-product] Spec error: ${e.message?.slice(0, 50)}`);
      }
      await randomDelay(1000, 2000);

      // ---- 6b3: 关闭外包装图示例弹窗 ----
      try {
        const knowBtn2 = page.locator('button:has-text("我知道了"), button:has-text("知道了")').first();
        if (await knowBtn2.isVisible({ timeout: 3000 })) {
          await knowBtn2.click();
          console.error("[create-product] Closed packaging example popup");
          await randomDelay(1000, 2000);
        }
      } catch (e) { logSilent("ui.action", e); }

      // ---- 6c: 外包装类型和形状（单选按钮）----
      console.error("[create-product] 6c: Setting packaging info...");
      await page.evaluate(() => {
        // 外包装类型：选"软包装+硬物"
        const radios = document.querySelectorAll('input[type="radio"], [role="radio"]');
        const allLabels = document.querySelectorAll("span, label");
        for (const el of allLabels) {
          const text = el.textContent?.trim();
          if (text === "软包装+硬物" || text === "长方体") {
            // 点击 radio label
            const radio = el.closest("label") || el.parentElement;
            if (radio) radio.click();
          }
        }
      });
      await randomDelay(500, 1000);

      // ---- 6d: 敏感属性下拉 ----
      console.error("[create-product] 6d: Setting sensitivity...");
      const sensitivitySet = await page.evaluate(() => {
        const labels = document.querySelectorAll("span, div, label");
        for (const label of labels) {
          if (label.textContent?.trim() === "敏感属性" && label.offsetParent) {
            const parent = label.closest("div")?.parentElement;
            if (parent) {
              const select = parent.querySelector('[class*="select"], [class*="Select"], [role="combobox"]');
              if (select) { select.click(); return "clicked"; }
            }
          }
        }
        // 也试试表格中的敏感属性下拉
        const selects = document.querySelectorAll('[class*="select"], [role="combobox"]');
        for (const s of selects) {
          const prev = s.previousElementSibling || s.closest("td")?.previousElementSibling;
          if (prev?.textContent?.includes("敏感属性")) {
            s.click();
            return "clicked";
          }
        }
        return "not_found";
      });
      if (sensitivitySet === "clicked") {
        await randomDelay(500, 1000);
        await page.evaluate(() => {
          const options = document.querySelectorAll('[class*="option"], li[role="option"]');
          for (const opt of options) {
            if (opt.textContent?.includes("非敏感") && opt.offsetParent) {
              opt.click();
              return;
            }
          }
          // 选第一个
          for (const opt of options) {
            if (opt.offsetParent) { opt.click(); return; }
          }
        });
        await randomDelay(500, 1000);
      }

      // ---- 6e: 体积重量 ----
      console.error("[create-product] 6e: Setting dimensions & weight...");
      await page.evaluate((dims) => {
        const inputs = document.querySelectorAll('input[placeholder*="请输入"]');
        const dimInputs = [];
        for (const input of inputs) {
          const parent = input.closest("td, div");
          const prevText = parent?.previousElementSibling?.textContent || "";
          const nextText = input.nextElementSibling?.textContent || "";
          // 找到体积和重量输入框（紧挨着 cm 或 g 标签的）
          if (nextText === "cm" || nextText === "g" || prevText.includes("最长") || prevText.includes("次长") || prevText.includes("最短")) {
            dimInputs.push(input);
          }
        }
        // 也通过位置查找：体积区域的输入框
        const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
        for (const input of allInputs) {
          if (!input.offsetParent) continue;
          const sibling = input.nextElementSibling;
          if (sibling?.textContent === "cm" || sibling?.textContent === "g") {
            if (!dimInputs.includes(input)) dimInputs.push(input);
          }
        }

        const values = [dims.length, dims.width, dims.height, dims.weight];
        for (let i = 0; i < Math.min(dimInputs.length, values.length); i++) {
          const input = dimInputs[i];
          const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSet.call(input, String(values[i]));
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return dimInputs.length;
      }, {
        length: params.dimensions?.length || "15",
        width: params.dimensions?.width || "10",
        height: params.dimensions?.height || "5",
        weight: params.weight || "200",
      });

      // ---- 6f: 勾选合规声明 ----
      console.error("[create-product] 6f: Checking compliance checkbox...");
      await page.evaluate(() => {
        const labels = document.querySelectorAll("span, label");
        for (const label of labels) {
          if (label.textContent?.includes("我已阅读并同意") || label.textContent?.includes("商品合规声明")) {
            const checkbox = label.closest("label")?.querySelector('input[type="checkbox"]') ||
                            label.parentElement?.querySelector('input[type="checkbox"]');
            if (checkbox && !checkbox.checked) {
              checkbox.click();
              return;
            }
            // Ant Design checkbox
            const antCb = label.closest("label") || label.parentElement;
            if (antCb) antCb.click();
            return;
          }
        }
      });

      await randomDelay(1000, 2000);
      await takeDebugScreenshot("08_smart_filled");
      console.error("[create-product] Step 6 done: Smart auto-fill complete");

    } catch (e) {
      console.error(`[create-product] Step 6 error: ${e.message?.slice(0, 80)}`);
      await takeDebugScreenshot("08_error");
    }

    // ========== Step 7: SKU 信息填写 ==========
    console.error("[create-product] Step 7: Set SKU info");

    // 7a: 点击"非定制商品"
    try {
      const nonCustom = page.locator('label:has-text("非定制商品"), span:has-text("非定制商品")').first();
      if (await nonCustom.isVisible({ timeout: 2000 })) {
        await nonCustom.click();
        await randomDelay(500, 1000);
      }
    } catch (e) { logSilent("ui.action", e); }

    // 7b: 填写申报价格
    const price = params.price || 9.99;
    try {
      await page.evaluate((p) => {
        // 找所有带"请输入"placeholder的input，在"申报价格"附近的
        const inputs = document.querySelectorAll('input[placeholder*="请输入"], input[placeholder*="价格"]');
        for (const input of inputs) {
          const row = input.closest("tr, [class*='row'], [class*='Row']") || input.parentElement?.parentElement;
          if (row && input.offsetParent) {
            const rect = input.getBoundingClientRect();
            // 申报价格输入框通常在SKU信息表格中，前面有¥符号
            const prev = input.previousElementSibling;
            if (prev?.textContent?.includes("¥") || rect.top > 500) {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
              setter?.call(input, String(p));
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
              return;
            }
          }
        }
        // fallback: 找第一个空的数字输入框在SKU区域
        const allInputs = document.querySelectorAll('input');
        for (const input of allInputs) {
          if (input.offsetParent && !input.value && input.getBoundingClientRect().top > 500) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
            setter?.call(input, String(p));
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }, price);
      console.error(`[create-product] Price set: ¥${price}`);
    } catch (e) {
      console.error(`[create-product] Price error: ${e.message?.slice(0, 50)}`);
    }
    await randomDelay(1000, 2000);

    // 7c: SKU分类选"单品"
    try {
      const skuTypeSelect = page.locator('select, [class*="select"]').filter({ hasText: /单品|同款多件装|混合套装/ }).first();
      if (await skuTypeSelect.isVisible({ timeout: 1000 })) {
        await skuTypeSelect.click();
        await randomDelay(500, 1000);
        const singleOption = page.locator('[class*="option"], li').filter({ hasText: "单品" }).first();
        if (await singleOption.isVisible({ timeout: 1000 })) {
          await singleOption.click();
        }
      }
    } catch (e) { logSilent("ui.action", e); }

    // 7d: SKU预览图 - 从素材中心选
    try {
      // 找SKU行中的"素材中心"按钮
      const skuMaterialBtn = page.locator('tr >> text=素材中心, [class*="sku"] >> text=素材中心').first();
      if (await skuMaterialBtn.isVisible({ timeout: 2000 })) {
        await skuMaterialBtn.click();
        await randomDelay(2000, 3000);
        // 选第一张图
        const imgs = page.locator('[class*="material"] img, [class*="image-list"] img, [class*="gallery"] img');
        const imgCount = await imgs.count();
        if (imgCount > 0) {
          await imgs.first().click();
          await randomDelay(500, 1000);
          // 点确认
          const confirmBtn = page.locator('button:has-text("确认"), button:has-text("确定")').last();
          if (await confirmBtn.isVisible({ timeout: 2000 })) {
            await confirmBtn.click();
            console.error("[create-product] SKU preview image selected");
          }
        }
        await randomDelay(1000, 2000);
      }
    } catch (e) { logSilent("ui.action", e); }

    // 7e: 建议零售价 = 申报价格 × 4
    const retailPrice = Math.round(price * 4);
    try {
      await page.evaluate((rp) => {
        // 找"建议零售价"附近的输入框
        const labels = document.querySelectorAll("th, td, span, div");
        for (const label of labels) {
          if (label.textContent?.includes("建议零售价") && label.offsetParent) {
            const row = label.closest("tr, [class*='row']") || label.parentElement;
            const inputs = row?.querySelectorAll("input") || [];
            for (const input of inputs) {
              if (input.offsetParent && (!input.value || input.value === "0")) {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
                setter?.call(input, String(rp));
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
                return;
              }
            }
          }
        }
      }, retailPrice);
      console.error(`[create-product] Retail price set: ¥${retailPrice} (${price}×4)`);
    } catch (e) { logSilent("ui.action", e); }

    await takeDebugScreenshot("09_sku_filled");

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
      } catch (e) { logSilent("ui.action", e); }
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
          } catch (e) { logSilent("ui.action", e); }
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
        } catch (e) { logSilent("ui.action", e); }
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
          } catch (e) { logSilent("ui.action", e); }
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
          } catch (e) { logSilent("ui.action", e); }
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
    try { await page.screenshot({ path: path.join(debugDir, "sidebar_nav_error.png"), fullPage: false }); } catch (e) { logSilent("ui.action", e); }
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
        } catch (e) { logSilent("ui.action", e); }
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
      } catch (e) { logSilent("ui.action", e); }
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

// ---- 注册表采集辅助（供 scrape_all 使用） ----
const _scrapeExecutors = () => ({
  scrapePageCaptureAll,
  scrapeSidebarCaptureAll,
  scrapePageWithListener,
  scrapeGovernPage: (subPath) => scrapePageCaptureAll(null, { waitTime: 12000, fullUrl: "https://agentseller.temu.com/govern/" + subPath }),
  ensureBrowser,
});
const _registryScrape = (key) => {
  const fn = getScrapeFunction(key, _scrapeExecutors());
  if (!fn) throw new Error(`scrape registry: no entry for '${key}'`);
  return fn();
};

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
      return await _registryScrape("products");
    }
    case "scrape_orders": {
      await ensureBrowser();
      return await _registryScrape("orders");
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
                } catch (e) { logSilent("ui.action", e); }
                if (!clicked) {
                  try {
                    const btn2 = newPage.locator('button:has-text("确认授权")').first();
                    if (await btn2.isVisible({ timeout: 1000 })) {
                      await btn2.click();
                      console.error("[popup-monitor] Clicked '确认授权'");
                      clicked = true;
                    }
                  } catch (e) { logSilent("ui.action", e); }
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
      try {
      console.error("[scrape_all] Step 2: Running all scrapers (concurrency=3) with popup monitor + lite nav...");
      const tasks = [
        // ---- 核心运营数据 ----
        { key: "dashboard", fn: () => _registryScrape("dashboard") },
        { key: "products", fn: () => _registryScrape("products") },
        { key: "orders", fn: () => _registryScrape("orders") },
        { key: "sales", fn: () => scrapeSales() },
        { key: "flux", fn: () => _registryScrape("flux") },
        { key: "goodsData", fn: () => _registryScrape("goodsData") },
        { key: "activity", fn: () => _registryScrape("activity") },
        { key: "afterSales", fn: () => _registryScrape("aftersales") },
        { key: "soldout", fn: () => _registryScrape("soldout") },
        { key: "performance", fn: () => _registryScrape("performance") },
        // ---- 扩展采集 ----
        { key: "lifecycle", fn: () => _registryScrape("lifecycle") },
        { key: "priceCompete", fn: () => _registryScrape("priceCompete") },
        { key: "urgentOrders", fn: () => _registryScrape("urgentOrders") },
        { key: "shippingDesk", fn: () => _registryScrape("shippingDesk") },
        { key: "shippingList", fn: () => _registryScrape("shippingList") },
        { key: "addressManage", fn: () => _registryScrape("addressManage") },
        { key: "delivery", fn: () => _registryScrape("delivery") },
        { key: "returnOrders", fn: () => _registryScrape("returnOrders") },
        { key: "exceptionNotice", fn: () => _registryScrape("exceptionNotice") },
        { key: "returnDetail", fn: () => _registryScrape("returnDetail") },
        { key: "salesReturn", fn: () => _registryScrape("salesReturn") },
        { key: "returnReceipt", fn: () => _registryScrape("returnReceipt") },
        { key: "priceReport", fn: () => _registryScrape("priceReport") },
        { key: "imageTask", fn: () => _registryScrape("imageTask") },
        { key: "sampleManage", fn: () => _registryScrape("sampleManage") },
        { key: "checkup", fn: () => _registryScrape("checkup") },
        { key: "usRetrieval", fn: () => _registryScrape("usRetrieval") },
        { key: "retailPrice", fn: () => _registryScrape("retailPrice") },
        { key: "qualityDashboard", fn: () => _registryScrape("qualityDashboard") },
        { key: "qualityDashboardEU", fn: () => _registryScrape("qualityDashboardEU") },
        { key: "qcDetail", fn: () => scrapeQcDetail() },
        { key: "mallFlux", fn: () => _registryScrape("mallFlux") },
        { key: "mallFluxEU", fn: () => _registryScrape("mallFluxEU") },
        { key: "fluxEU", fn: () => _registryScrape("fluxEU") },
        { key: "fluxUS", fn: () => _registryScrape("fluxUS") },
        { key: "mallFluxUS", fn: () => _registryScrape("mallFluxUS") },
        { key: "activityLog", fn: () => _registryScrape("activityLog") },
        { key: "chanceGoods", fn: () => _registryScrape("chanceGoods") },
        { key: "marketingActivity", fn: () => _registryScrape("marketingActivity") },
        { key: "flowGrow", fn: () => _registryScrape("flowGrow") },
        { key: "activityUS", fn: () => _registryScrape("activityUS") },
        { key: "activityEU", fn: () => _registryScrape("activityEU") },
        // ---- 合规中心 ----
        { key: "governDashboard", fn: () => scrapeGovernDashboard() },
        { key: "governProductQualification", fn: () => _registryScrape("governProductQualification") },
        { key: "governQualificationAppeal", fn: () => _registryScrape("governQualificationAppeal") },
        { key: "governEprQualification", fn: () => _registryScrape("governEprQualification") },
        { key: "governProductPhoto", fn: () => _registryScrape("governProductPhoto") },
        { key: "governComplianceInfo", fn: () => _registryScrape("governComplianceInfo") },
        { key: "governResponsiblePerson", fn: () => _registryScrape("governResponsiblePerson") },
        { key: "governManufacturer", fn: () => _registryScrape("governManufacturer") },
        { key: "governComplaint", fn: () => _registryScrape("governComplaint") },
        { key: "governViolationAppeal", fn: () => _registryScrape("governViolationAppeal") },
        { key: "governMerchantAppeal", fn: () => _registryScrape("governMerchantAppeal") },
        { key: "governTro", fn: () => _registryScrape("governTro") },
        { key: "governEprBilling", fn: () => _registryScrape("governEprBilling") },
        { key: "governComplianceReference", fn: () => _registryScrape("governComplianceReference") },
        { key: "governCustomsAttribute", fn: () => _registryScrape("governCustomsAttribute") },
        { key: "governCategoryCorrection", fn: () => _registryScrape("governCategoryCorrection") },
        // ---- 推广平台 ----
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
            const idx = running.indexOf(p);
            if (idx !== -1) running.splice(idx, 1);
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
      } finally {
      // 关闭弹窗监控和 lite 模式（即使出错也要清理）
      _navLiteMode = false;
      popupMonitorActive = false;
      try { context.removeListener("page", handleAuthPopup); } catch (e) { console.error("[scrape_all] cleanup error:", e.message); }
      console.error("[popup-monitor] Monitor removed, lite mode off");
      }

      console.error("[scrape_all] All done!", Object.keys(results).map(k => `${k}:${results[k].success}`).join(", "));

      // 采集完成后关闭浏览器
      try {
        if (browser) { await browser.close(); browser = null; context = null; }
        console.error("[scrape_all] Browser closed.");
      } catch (e) { console.error("[scrape_all] Failed to close browser:", e.message); }

      return results;
    }
    case "read_scrape_data": {
      const taskKey = params.key;

      // CSV/XLSX 预览
      if (taskKey.startsWith("csv_preview:")) {
        const filePath = taskKey.slice("csv_preview:".length);
        if (!fs.existsSync(filePath)) return null;
        const wb = XLSX.readFile(filePath);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        return { rows };
      }

      // 从文件读取 scrape_all 保存的数据
      const debugDir2 = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
      const dataFile2 = path.join(debugDir2, `scrape_all_${taskKey}.json`);
      if (fs.existsSync(dataFile2)) {
        return JSON.parse(fs.readFileSync(dataFile2, "utf8"));
      }
      return null;
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
          } catch (e) { logSilent("ui.action", e); }
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
    // 采集命令已移到 scrape-registry.mjs（通过 default 分支的 buildScrapeHandlers 处理）
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
          } catch (e) { logSilent("ui.action", e); }
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
        let page = null;
        try {
          page = await context.newPage();
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
            } catch (e) { logSilent("ui.action", e); }
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
        } catch (e) {
          console.error(`[probe-batch] ${p} ERROR: ${e.message}`);
          results[p] = { error: e.message };
        } finally {
          if (page) await page.close().catch(() => {});
        }
      }
      return results;
    }
    case "create_product_api": {
      // 纯 API 方式创建商品（跳过 DOM 操作）
      await ensureBrowser();
      return await createProductViaAPI(params);
    }
    case "batch_create_api": {
      // 纯 API 批量创建商品
      await ensureBrowser();
      return await batchCreateViaAPI(params);
    }
    case "auto_pricing": {
      // 完整自动核价：CSV → AI生图 → 上传 → 提交核价
      await ensureBrowser();
      return await autoPricingFromCSV(params);
    }
    case "probe_create_flow": {
      // 打开商品创建页面，拦截所有 API 请求，用于发现真实端点
      await ensureBrowser();
      return await probeCreateFlow(params);
    }
    case "capture_add_payload": {
      // 专门捕获 product/add 的完整请求体（用 route 拦截）
      await ensureBrowser();
      const page = await context.newPage();
      const capturedBodies = [];
      const saveDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
      fs.mkdirSync(saveDir, { recursive: true });
      try {
        // 用 route 拦截 product/add 和 draft/add 请求
        await page.route("**/product/add", async (route) => {
          const req = route.request();
          const postBody = req.postDataJSON();
          capturedBodies.push({ path: "/product/add", body: postBody, timestamp: Date.now() });
          console.error("[capture] Got product/add body: " + JSON.stringify(postBody)?.length + " bytes");
          const outputFile = path.join(saveDir, "real_product_add_payload.json");
          fs.writeFileSync(outputFile, JSON.stringify(postBody, null, 2));
          console.error("[capture] Saved to: " + outputFile);
          await route.continue();
        });
        await page.route("**/product/draft/add", async (route) => {
          const req = route.request();
          const postBody = req.postDataJSON();
          capturedBodies.push({ path: "/draft/add", body: postBody, timestamp: Date.now() });
          console.error("[capture] Got draft/add body: " + JSON.stringify(postBody)?.length + " bytes");
          const outputFile = path.join(saveDir, "real_draft_add_payload.json");
          fs.writeFileSync(outputFile, JSON.stringify(postBody, null, 2));
          await route.continue();
        });
        await page.route("**/store_image", async (route) => {
          console.error("[capture] Got store_image request");
          capturedBodies.push({ path: "/store_image", timestamp: Date.now() });
          await route.continue();
        });

        await navigateToSellerCentral(page, "/goods/create/category");
        await randomDelay(3000, 5000);
        // 关闭弹窗
        for (let i = 0; i < 5; i++) {
          try {
            const btn = page.locator('button:has-text("知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不"), button:has-text("不使用")').first();
            if (await btn.isVisible({ timeout: 500 })) await btn.click();
            else break;
          } catch { break; }
        }

        const waitMinutes = params.waitMinutes || 10;
        console.error("[capture] Ready. Please create product and submit. Waiting " + waitMinutes + " min...");
        await new Promise(r => setTimeout(r, waitMinutes * 60000));

        return { success: true, captured: capturedBodies.length, bodies: capturedBodies };
      } finally {
        if (!params.keepOpen) await page.close();
      }
    }
    case "test_api": {
      // 在已登录页面中调用指定 API 端点，用于调试
      await ensureBrowser();
      const page = await context.newPage();
      try {
        await navigateToSellerCentral(page, params.navPath || "/goods/list");
        await randomDelay(5000, 8000);

        // 调试模式：检查 fetch/XHR 是否被 hook
        if (params.debug) {
          const hookInfo = await page.evaluate(() => {
            const info = {};
            info.fetchNative = fetch.toString().includes("native");
            info.fetchSrcLen = fetch.toString().length;
            info.xhrOpenNative = XMLHttpRequest.prototype.open.toString().includes("native");
            info.xhrSendNative = XMLHttpRequest.prototype.send.toString().includes("native");
            // 检查 window 上的签名相关对象
            const candidates = ["__ANTI__", "_AntiContent", "antiContent", "__pfb", "pfb"];
            for (const c of candidates) {
              if (window[c]) info["window." + c] = typeof window[c];
            }
            return info;
          });
          console.error("[test_api] Hook info:", JSON.stringify(hookInfo));

          // 拦截请求看 headers
          const reqHeaders = {};
          page.on("request", (req) => {
            if (req.url().includes(params.endpoint)) {
              const h = req.headers();
              reqHeaders["anti-content"] = h["anti-content"]?.slice(0, 50);
              reqHeaders["content-type"] = h["content-type"];
              reqHeaders["cookie"] = h["cookie"] ? "present" : "missing";
            }
          });

          const result = await temuXHR(page, params.endpoint, params.body || {}, { maxRetries: 1 });
          await randomDelay(500, 1000);
          return { ...result, hookInfo, capturedHeaders: reqHeaders };
        }

        const result = await temuXHR(page, params.endpoint, params.body || {}, { maxRetries: params.maxRetries || 1 });
        return result;
      } finally {
        if (!params.keepOpen) await page.close();
      }
    }
    case "eval": {
      // 在已登录页面中执行任意 JS（用于调试）
      await ensureBrowser();
      const evalCode = params.code || params.expression || "";
      const page = await context.newPage();
      try {
        await navigateToSellerCentral(page, params.navPath || "/goods/list");
        await randomDelay(3000, 5000);
        const result = await page.evaluate((code) => {
          return new Function(code)();
        }, evalCode);
        return result;
      } finally {
        if (!params.keepOpen) await page.close();
      }
    }
    case "close": await closeBrowser(); return { status: "closed" };
    case "shutdown": await closeBrowser(); setTimeout(() => process.exit(0), 100); return { status: "shutting_down" };
    case "pause_pricing":
      if (!isCurrentProgressTask(params?.taskId)) {
        return { status: currentProgress.status || "idle", taskId: currentProgress.taskId };
      }
      pricingPaused = true;
      updateCurrentProgress({
        running: true,
        paused: true,
        status: "paused",
        step: "已暂停",
        message: "批量上品任务已暂停，等待继续。",
      });
      console.error("[Worker] Pricing PAUSED");
      return { status: "paused", taskId: currentProgress.taskId };
    case "resume_pricing":
      if (!isCurrentProgressTask(params?.taskId)) {
        return { status: currentProgress.status || "idle", taskId: currentProgress.taskId };
      }
      pricingPaused = false;
      updateCurrentProgress({
        running: true,
        paused: false,
        status: "running",
        step: "继续执行",
        message: "批量上品任务已恢复。",
      });
      console.error("[Worker] Pricing RESUMED");
      return { status: "resumed", taskId: currentProgress.taskId };
    default: {
      // 注册表驱动的采集命令（替代 50+ 重复 case）
      const scrapeHandlers = buildScrapeHandlers({
        scrapePageCaptureAll, scrapeSidebarCaptureAll, scrapePageWithListener,
        scrapeGovernPage: (subPath) => scrapePageCaptureAll(null, { waitTime: 12000, fullUrl: "https://agentseller.temu.com/govern/" + subPath }),
        ensureBrowser,
      });
      if (scrapeHandlers[action]) {
        return await scrapeHandlers[action]();
      }
      throw new Error("未知命令: " + action);
    }
  }
}

// ============================================================
// 纯 API 方式创建商品（跳过 DOM 操作）
// ============================================================

async function uploadImageToMaterial(page, localImagePath, options = {}) {
  const { maxRetries = 3 } = options;
  const imageBuffer = fs.readFileSync(localImagePath);
  const base64 = imageBuffer.toString("base64");
  const ext = path.extname(localImagePath).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
  const fileName = path.basename(localImagePath);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await page.evaluate(async ({ base64Data, mime, name }) => {
      const mallid = document.cookie.match(/mallid=([^;]+)/)?.[1] || "";

      try {
        // Step 1: 获取上传签名
        const sigResp = await fetch("/general_auth/get_signature?sdk_version=js-0.0.40&tag_name=product-material-tag&scene_id=agent-seller", {
          method: "POST",
          headers: { "Content-Type": "application/json", "mallid": mallid },
          credentials: "include",
          body: JSON.stringify({ bucket_tag: "product-material-tag" }),
        });
        const sigData = await sigResp.json();
        if (!sigData.signature) {
          return { success: false, error: "get_signature failed: " + JSON.stringify(sigData).slice(0, 200) };
        }

        // Step 2: 将 base64 转为 File
        const byteChars = atob(base64Data);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
        const blob = new Blob([byteArray], { type: mime });
        const file = new File([blob], name, { type: mime });

        // Step 3: 上传图片到 galerie
        const formData = new FormData();
        formData.append("url_width_height", "true");
        formData.append("image", file);
        formData.append("upload_sign", sigData.signature);

        const uploadResp = await fetch("/api/galerie/v3/store_image?sdk_version=js-0.0.40&tag_name=product-material-tag", {
          method: "POST",
          body: formData,
          credentials: "include",
          headers: { "mallid": mallid },
        });
        const uploadData = await uploadResp.json();

        if (uploadData.url) {
          return { success: true, url: uploadData.url, width: uploadData.width, height: uploadData.height };
        }
        return { success: false, error: "store_image no url: " + JSON.stringify(uploadData).slice(0, 200) };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }, { base64Data: base64, mime: mimeType, name: fileName });

    if (result.success) {
      console.error(`[upload] OK: ${result.url?.slice(0, 80)} (${result.width}x${result.height})`);
      return result;
    }

    console.error(`[upload] Attempt ${attempt}/${maxRetries} failed: ${result.error}`);
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }

  return { success: false, error: `Upload failed after ${maxRetries} attempts` };
}

/**
 * 搜索分类 — 通过逐级遍历分类树匹配中文分类路径
 * @param {Page} page
 * @param {string} searchTerm - 分类搜索词，支持 "一级/二级/三级" 格式或单个关键词
 */
async function searchCategoryAPI(page, searchTerm) {
  const cleanStr = (s) => s.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "").replace(/[、，]/g, "");

  // 判断搜索词类型：包含 "/" 说明是分类路径，否则是标题/关键词
  const isPathSearch = searchTerm.includes("/");
  let searchParts;

  if (isPathSearch) {
    searchParts = searchTerm.split("/").map(s => cleanStr(s.trim())).filter(Boolean);
    console.error(`[category] Path search: "${searchParts.join(" > ")}"`);
  } else {
    // 标题搜索模式：在所有一级分类的二级子分类中模糊匹配
    console.error(`[category] Title search: "${searchTerm.slice(0, 40)}"`);
    const rootResult = await temuXHR(page, "/anniston-agent-seller/category/children/list", { parentCatId: 0 }, { maxRetries: 2 });
    if (!rootResult.success) return null;
    const rootCats = rootResult.data?.categoryNodeVOS || [];

    // 提取标题中的核心关键词（用分隔符切分后直接匹配）
    const titleClean = cleanStr(searchTerm);
    const segments = titleClean.split(/[|｜,，;；>》\s]+/).filter(s => s.length >= 2);
    console.error(`[category] Segments: ${segments.slice(0, 8).join(", ")}`);

    let bestCat = null;
    let bestScore = 0;
    let bestPath = "";

    for (const root of rootCats) {
      const childResult = await temuXHR(page, "/anniston-agent-seller/category/children/list", { parentCatId: root.catId }, { maxRetries: 1 });
      if (!childResult.success) continue;
      const children = childResult.data?.categoryNodeVOS || [];

      for (const child of children) {
        const childName = cleanStr(child.catName);
        let score = 0;
        for (const seg of segments) {
          // 双向匹配：分类名包含片段，或片段包含分类名
          if (childName.includes(seg)) score += seg.length * 2;
          else if (seg.includes(childName)) score += childName.length * 2;
          else {
            // 子串匹配：片段中的任意2+字子串出现在分类名中
            for (let len = Math.min(4, seg.length); len >= 2; len--) {
              for (let i = 0; i <= seg.length - len; i++) {
                if (childName.includes(seg.slice(i, i + len))) {
                  score += len;
                  break;
                }
              }
            }
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestCat = child;
          bestPath = `${root.catName} > ${child.catName}`;
        }
      }
    }

    if (bestCat && bestScore > 0) {
      console.error(`[category] Best title match: ${bestPath} (score=${bestScore})`);
      // 直接用找到的二级分类 catId 继续展开到叶子，跳过路径匹配
      const catIds = {};
      const rootCat = rootCats.find(r => {
        // 找到包含 bestCat 的一级分类
        return bestPath.startsWith(r.catName);
      });
      if (rootCat) {
        catIds.cat1Id = rootCat.catId;
        catIds.cat1Name = rootCat.catName;
        catIds.cat2Id = bestCat.catId;
        catIds.cat2Name = bestCat.catName;

        // 继续展开到叶子 — 每层用标题关键词匹配最佳子分类
        let parentId = bestCat.catId;
        for (let level = 3; level <= 10; level++) {
          const childResult = await temuXHR(page, "/anniston-agent-seller/category/children/list", { parentCatId: parentId }, { maxRetries: 1 });
          if (!childResult.success || !childResult.data?.categoryNodeVOS?.length) break;
          const children = childResult.data.categoryNodeVOS;

          // 优先选"其他"兜底分类，其次用标题关键词匹配
          let bestChild = null;
          let bestChildScore = -1;
          let otherChild = null;
          for (const child of children) {
            const cn = cleanStr(child.catName);
            if (/^其[他它]/.test(cn)) { otherChild = child; }
            let score = 0;
            for (const seg of segments) {
              if (cn.includes(seg)) score += seg.length * 3;
              else if (seg.includes(cn)) score += cn.length * 2;
              else {
                for (let len = Math.min(4, seg.length); len >= 2; len--) {
                  for (let j = 0; j <= seg.length - len; j++) {
                    if (cn.includes(seg.slice(j, j + len))) { score += len; break; }
                  }
                }
              }
            }
            if (score > bestChildScore) { bestChildScore = score; bestChild = child; }
          }
          // 如果没有好的匹配（score=0），选"其他"兜底
          const selectedChild = bestChildScore > 0 ? bestChild : (otherChild || children[0]);
          catIds[`cat${level}Id`] = selectedChild.catId;
          catIds[`cat${level}Name`] = selectedChild.catName;
          parentId = selectedChild.catId;
          console.error(`[category] Level ${level}: auto-select → ${selectedChild.catId}:${selectedChild.catName}`);
        }

        // 补齐
        for (let i = 1; i <= 10; i++) {
          if (!catIds[`cat${i}Id`]) catIds[`cat${i}Id`] = 0;
        }
        catIds._path = Object.keys(catIds).filter(k => k.endsWith("Name") && catIds[k]).map(k => catIds[k]).join(" > ");
        console.error(`[category] Final: ${catIds._path}`);
        return { list: [catIds] };
      }
      // 如果没找到一级分类，走 fallback
      searchParts = [bestPath.split(" > ")[0], bestPath.split(" > ")[1]];
    } else {
      searchParts = [searchTerm];
      console.error(`[category] No title match, falling back to path search`);
    }
  }

  // 模糊匹配函数：支持部分匹配
  function fuzzyMatch(catName, searchName) {
    const a = cleanStr(catName).toLowerCase();
    const b = searchName.toLowerCase();
    if (a === b) return 3; // 完全匹配
    if (a.includes(b) || b.includes(a)) return 2; // 包含匹配
    // 关键词重叠匹配（至少2个字符重叠）
    for (let len = Math.min(a.length, b.length); len >= 2; len--) {
      for (let i = 0; i <= b.length - len; i++) {
        if (a.includes(b.slice(i, i + len))) return 1;
      }
    }
    return 0;
  }

  // 逐级遍历分类树
  let parentCatId = 0;
  const catIds = {};
  let lastMatchedCatId = 0;

  for (let level = 0; level < searchParts.length && level < 10; level++) {
    const result = await temuXHR(page, "/anniston-agent-seller/category/children/list", { parentCatId }, { maxRetries: 2 });
    if (!result.success || !result.data?.categoryNodeVOS?.length) {
      console.error(`[category] No children for parentCatId=${parentCatId} at level ${level + 1}`);
      break;
    }

    const cats = result.data.categoryNodeVOS;
    const searchName = searchParts[level];

    // 找最佳匹配
    let bestMatch = null;
    let bestScore = 0;
    for (const cat of cats) {
      const score = fuzzyMatch(cat.catName, searchName);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = cat;
      }
    }

    if (bestMatch && bestScore > 0) {
      catIds[`cat${level + 1}Id`] = bestMatch.catId;
      catIds[`cat${level + 1}Name`] = bestMatch.catName;
      parentCatId = bestMatch.catId;
      lastMatchedCatId = bestMatch.catId;
      console.error(`[category] Level ${level + 1}: "${searchName}" → ${bestMatch.catId}:${bestMatch.catName} (score=${bestScore})`);
    } else {
      console.error(`[category] Level ${level + 1}: "${searchName}" no match in ${cats.length} categories`);
      // 列出可用分类方便调试
      console.error(`[category]   Available: ${cats.slice(0, 8).map(c => c.catName).join(", ")}...`);
      break;
    }
  }

  // 继续展开到叶子节点（如果还有子分类，选第一个）
  const matchedLevels = Object.keys(catIds).filter(k => k.match(/^cat\d+Id$/)).length;
  for (let level = matchedLevels; level < 10; level++) {
    const result = await temuXHR(page, "/anniston-agent-seller/category/children/list", { parentCatId }, { maxRetries: 1 });
    if (!result.success || !result.data?.categoryNodeVOS?.length) break;
    const firstChild = result.data.categoryNodeVOS[0];
    catIds[`cat${level + 1}Id`] = firstChild.catId;
    catIds[`cat${level + 1}Name`] = firstChild.catName;
    parentCatId = firstChild.catId;
    lastMatchedCatId = firstChild.catId;
    console.error(`[category] Level ${level + 1}: auto-select → ${firstChild.catId}:${firstChild.catName}`);
  }

  // 补齐剩余层级为 0
  for (let i = 1; i <= 10; i++) {
    if (!catIds[`cat${i}Id`]) catIds[`cat${i}Id`] = 0;
  }

  if (lastMatchedCatId > 0) {
    catIds._path = Object.keys(catIds)
      .filter(k => k.endsWith("Name") && catIds[k])
      .map(k => catIds[k])
      .join(" > ");
    console.error(`[category] Final: ${catIds._path}`);
    return { list: [catIds] };
  }

  console.error(`[category] No results for: "${searchTerm}"`);
  return null;
}

// ============================================================
// 统一 API 调用层 — 利用 Temu 前端 XHR 拦截器自动添加 anti-content
// ============================================================

/**
 * 在 Temu 页面中通过 XHR 调用后端 API（自动携带签名）
 * @param {import('playwright').Page} page - 已登录的 Temu 页面
 * @param {string} endpoint - API 路径，如 "/visage-agent-seller/product/add"
 * @param {Object} body - 请求体
 * @param {Object} [options]
 * @param {number} [options.maxRetries=3] - 最大重试次数
 * @param {boolean} [options.isFormData=false] - 是否为 FormData 上传
 * @returns {Object} { success, data, errorCode, errorMsg, raw }
 */
async function temuXHR(page, endpoint, body, options = {}) {
  const { maxRetries = 3 } = options;
  const NON_RETRYABLE = [1000001, 1000002, 1000003, 1000004, 40001, 40003, 50001, 6000002]; // 参数错误/无权限/属性不匹配（外层专用重试处理）

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const raw = await page.evaluate(async ({ ep, bd }) => {
        // 优先用 fetch（Temu 前端拦截器 hook 了 fetch 添加 anti-content）
        // mallid header 是必须的认证字段
        const mallid = document.cookie.match(/mallid=([^;]+)/)?.[1] || "";
        try {
          const resp = await fetch(ep, {
            method: "POST",
            headers: { "Content-Type": "application/json", "mallid": mallid },
            credentials: "include",
            body: JSON.stringify(bd),
          });
          const text = await resp.text();
          try {
            return { status: resp.status, body: JSON.parse(text) };
          } catch {
            return { status: resp.status, body: null, text: text?.slice(0, 500) };
          }
        } catch (fetchErr) {
          // fetch 失败，fallback 到 XHR
          return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", ep, true);
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.setRequestHeader("mallid", mallid);
            xhr.withCredentials = true;
            xhr.timeout = 30000;
            xhr.onreadystatechange = function () {
              if (xhr.readyState === 4) {
                try {
                  resolve({ status: xhr.status, body: JSON.parse(xhr.responseText) });
                } catch {
                  resolve({ status: xhr.status, body: null, text: xhr.responseText?.slice(0, 500) });
                }
              }
            };
            xhr.onerror = () => resolve({ status: 0, body: null, error: "XHR error: " + fetchErr.message });
            xhr.ontimeout = () => resolve({ status: 0, body: null, error: "XHR timeout" });
            xhr.send(JSON.stringify(bd));
          });
        }
      }, { ep: endpoint, bd: body });

      // 解析结果
      if (!raw.body) {
        console.error(`[temuXHR] ${endpoint} attempt ${attempt}/${maxRetries}: HTTP ${raw.status} - ${raw.error || raw.text?.slice(0, 100)}`);
        if (attempt < maxRetries) {
          const wait = Math.pow(3, attempt) * 1000; // 3s, 9s, 27s
          console.error(`[temuXHR] Retrying in ${wait / 1000}s...`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        return { success: false, errorMsg: raw.error || "Empty response", raw };
      }

      const resp = raw.body;
      const isOk = resp.success === true || resp.errorCode === 1000000;

      if (isOk) {
        console.error(`[temuXHR] ${endpoint} OK (attempt ${attempt})`);
        return { success: true, data: resp.result, errorCode: resp.errorCode, raw: resp };
      }

      // 不可重试的错误
      if (NON_RETRYABLE.includes(resp.errorCode)) {
        console.error(`[temuXHR] ${endpoint} NON-RETRYABLE error: ${resp.errorCode} - ${resp.errorMsg}`);
        return { success: false, errorCode: resp.errorCode, errorMsg: resp.errorMsg, raw: resp };
      }

      // 可重试的错误
      console.error(`[temuXHR] ${endpoint} attempt ${attempt}/${maxRetries}: errorCode=${resp.errorCode} - ${resp.errorMsg}`);
      if (attempt < maxRetries) {
        const wait = Math.pow(3, attempt) * 1000;
        console.error(`[temuXHR] Retrying in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      return { success: false, errorCode: resp.errorCode, errorMsg: resp.errorMsg, raw: resp };

    } catch (e) {
      console.error(`[temuXHR] ${endpoint} attempt ${attempt} exception: ${e.message}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, Math.pow(3, attempt) * 1000));
        continue;
      }
      return { success: false, errorMsg: e.message };
    }
  }
}

// ============================================================
// 探测创建商品流程 — 拦截真实 API 请求用于调试
// ============================================================

async function probeCreateFlow(params) {
  const page = await context.newPage();
  const captured = [];
  const frameworkPatterns = [
    'phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', 'get-leo-config',
    '_stm', 'msgBox', 'auth/userInfo', 'auth/menu', 'queryTotalExam',
    'feedback/entrance', 'rule/unreadNum', 'checkAbleFeedback',
    'queryFeedbackNotReadTotal', 'pop/query', '.js', '.css', '.png', '.svg',
    '.woff', '.ico', '.jpg', '.gif', '.map', '.webp', 'hm.baidu', 'google',
    'favicon', 'hot-update', 'sockjs', 'batchMatchBySupplierIds', 'gray/agent',
  ];

  // 保存完整的请求和响应数据
  const saveDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "api-probe");
  fs.mkdirSync(saveDir, { recursive: true });

  try {
    // 拦截所有 POST 请求
    page.on("request", (req) => {
      try {
        if (req.method() !== "POST") return;
        const url = req.url();
        if (frameworkPatterns.some(p => url.includes(p))) return;
        if (!url.includes("agentseller.temu.com") && !url.includes("kuajingmaihuo.com") && !url.includes("temu.com")) return;

        const u = new URL(url);
        const postData = req.postData();
        let body = null;
        try { body = JSON.parse(postData); } catch (e) { logSilent("ui.action", e); }

        captured.push({
          timestamp: Date.now(),
          method: "POST",
          path: u.pathname,
          bodyPreview: postData?.slice(0, 500),
          bodyParsed: body,
          headers: {
            "content-type": req.headers()["content-type"],
            "anti-content": req.headers()["anti-content"]?.slice(0, 50) + "...",
          },
        });
        console.error(`[probe] POST ${u.pathname} (body: ${postData?.length || 0} bytes)`);
      } catch (e) { logSilent("ui.action", e); }
    });

    page.on("response", async (resp) => {
      try {
        if (resp.request().method() !== "POST") return;
        const url = resp.url();
        if (frameworkPatterns.some(p => url.includes(p))) return;

        const u = new URL(url);
        const ct = resp.headers()["content-type"] || "";
        if (ct.includes("json") || ct.includes("application")) {
          const body = await resp.json().catch(() => null);
          if (body) {
            // 找到对应的请求记录，补充响应数据
            const req = [...captured].reverse().find(c => c.path === u.pathname && !c.response);
            if (req) {
              req.response = {
                status: resp.status(),
                errorCode: body.errorCode,
                errorMsg: body.errorMsg,
                success: body.success,
                resultKeys: body.result ? Object.keys(body.result).slice(0, 20) : [],
                resultPreview: JSON.stringify(body.result)?.slice(0, 500),
              };
            }
          }
        }
      } catch (e) { logSilent("ui.action", e); }
    });

    // 导航到创建商品页面
    const targetPath = params.path || "/goods/create/category";
    console.error(`[probe] Navigating to ${targetPath}...`);
    await navigateToSellerCentral(page, targetPath);
    await randomDelay(5000, 8000);

    // 关闭弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不"), button:has-text("不使用")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }

    // 等待用户手动操作（创建商品、填写信息、提交核价）
    const waitMinutes = params.waitMinutes || 10;
    console.error(`[probe] Page ready. Waiting ${waitMinutes} minutes for manual operations...`);
    console.error(`[probe] Please manually create a product in the browser. All API calls will be captured.`);

    await new Promise(r => setTimeout(r, waitMinutes * 60000));

    // 保存捕获的数据
    const outputFile = path.join(saveDir, `probe_${Date.now()}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(captured, null, 2), "utf8");
    console.error(`[probe] Captured ${captured.length} API calls. Saved to: ${outputFile}`);

    return {
      success: true,
      totalApis: captured.length,
      apis: captured,
      savedTo: outputFile,
    };
  } finally {
    if (!params.keepOpen) await page.close();
  }
}

// ============================================================
// 完整自动核价：CSV → AI生图 → 上传素材 → 提交核价
// ============================================================

// 上品链路：原图只做参考，最终只提交 9 张 AI 图
const AI_DETAIL_IMAGE_TYPE_ORDER = [
  "scene_a",    // 1. 核价场景图A
  "scene_b",    // 2. 核价场景图B
  "features",   // 3. 卖点图
  "closeup",    // 4. 细节图
  "dimensions", // 5. 尺寸规格图
  "lifestyle",  // 6. 场景结果图
  "packaging",  // 7. 包装图
  "comparison", // 8. 对比图
  "lifestyle2", // 9. A+ 收束图
];
const REQUIRED_AI_DETAIL_IMAGE_COUNT = AI_DETAIL_IMAGE_TYPE_ORDER.length;

const AI_IMAGE_GEN_URL = (process.env.AI_IMAGE_SERVER || "http://localhost:3210").replace(/\/+$/, "");
const AI_IMAGE_GEN_ORIGIN = (() => {
  try {
    return new URL(AI_IMAGE_GEN_URL).origin;
  } catch {
    return AI_IMAGE_GEN_URL;
  }
})();
const AI_AUTH_HEADERS = { "sec-fetch-site": "same-origin", "origin": AI_IMAGE_GEN_ORIGIN };

async function formatAiImageError(prefix, response) {
  try {
    const payload = (await response.text()).trim();
    if (payload) {
      return `${prefix}: ${response.status} ${payload.slice(0, 240)}`;
    }
  } catch {}
  return `${prefix}: ${response.status}`;
}

function formatAiImageFetchError(prefix, error, routePath) {
  const reason = error?.message || String(error || "");
  return `${prefix}: 请求 ${AI_IMAGE_GEN_URL}${routePath} 失败 (${reason})`;
}

/**
 * 调用 AI 生图服务：分析 + 生成 10 张图
 * @param {string} sourceImagePath - 商品原图本地路径
 * @param {string} productTitle - 商品标题（用于分析）
 * @returns {Object} { success, images: { [imageType]: base64DataUrl } }
 */
async function generateImagesWithAI(sourceImagePath, productTitle, extraImagePaths = []) {
  const imageBuffer = fs.readFileSync(sourceImagePath);
  const base64 = imageBuffer.toString("base64");
  const ext = path.extname(sourceImagePath).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : "image/jpeg";

  // 构建所有图片 blob 列表（主图 + 轮播图）
  const imageBlob = new Blob([imageBuffer], { type: mimeType });
  const allImageBlobs = [{ blob: imageBlob, name: path.basename(sourceImagePath) }];
  for (const ep of extraImagePaths.slice(0, 4)) {  // 最多额外4张（总共5张）
    try {
      if (fs.existsSync(ep)) {
        const buf = fs.readFileSync(ep);
        const eExt = path.extname(ep).toLowerCase();
        const eMime = eExt === ".png" ? "image/png" : "image/jpeg";
        allImageBlobs.push({ blob: new Blob([buf], { type: eMime }), name: path.basename(ep) });
      }
    } catch (e) { logSilent("ui.action", e); }
  }
  console.error(`[ai-gen] Source images: ${allImageBlobs.length} (1 main + ${allImageBlobs.length - 1} carousel)`);

  // Step 1: 分析产品（传所有图片）
  console.error("[ai-gen] Step 1: Analyzing product...");
  const analyzeForm = new FormData();
  for (const img of allImageBlobs) {
    analyzeForm.append("images", img.blob, img.name);
  }
  analyzeForm.append("productMode", "single");

  let analyzeResp;
  try {
    analyzeResp = await fetch(`${AI_IMAGE_GEN_URL}/api/analyze`, {
      method: "POST",
      body: analyzeForm,
      headers: AI_AUTH_HEADERS,
    });
  } catch (error) {
    return { success: false, error: formatAiImageFetchError("Analyze failed", error, "/api/analyze") };
  }
  if (!analyzeResp.ok) {
    return { success: false, error: await formatAiImageError("Analyze failed", analyzeResp) };
  }
  const analysis = await analyzeResp.json();
  console.error(`[ai-gen] Analysis: ${analysis.productName?.slice(0, 40)}, category: ${analysis.category?.slice(0, 30)}`);

  // Step 2: 生成 plans（调用 /api/plans 获取带 prompt 的方案）
  console.error("[ai-gen] Step 2: Generating plans with prompts...");
  let plansResp;
  try {
    plansResp = await fetch(`${AI_IMAGE_GEN_URL}/api/plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AI_AUTH_HEADERS },
      body: JSON.stringify({
        analysis,
        imageTypes: AI_DETAIL_IMAGE_TYPE_ORDER,
        salesRegion: "us",
        imageSize: "1000x1000",
        productMode: "single",
      }),
    });
  } catch (error) {
    return { success: false, error: formatAiImageFetchError("Plans API failed", error, "/api/plans") };
  }
  if (!plansResp.ok) {
    return { success: false, error: await formatAiImageError("Plans API failed", plansResp) };
  }
  const { plans } = await plansResp.json();
  console.error(`[ai-gen] Got ${plans.length} plans with prompts`);

  // Step 3: 并发生成图片（分成多组并行请求）
  const CONCURRENCY = 10; // 10并发，失败自动重试
  const images = {};
  let lastGenerateError = "";

  // 将 plans 分组
  const planGroups = [];
  for (let i = 0; i < plans.length; i += CONCURRENCY) {
    planGroups.push(plans.slice(i, i + CONCURRENCY));
  }

  console.error(`[ai-gen] Step 3: Generating ${plans.length} images (${planGroups.length} batches, ${CONCURRENCY} concurrent)...`);

  // SSE 流处理函数
  async function processSSE(resp) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const result = {};
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.status === "done" && data.imageUrl) {
            result[data.imageType] = data.imageUrl;
            console.error(`[ai-gen] Generated: ${data.imageType} (${Object.keys(images).length + Object.keys(result).length}/${plans.length})`);
          } else if (data.status === "error") {
            console.error(`[ai-gen] Error: ${data.imageType}: ${data.error}`);
          }
        } catch (e) { logSilent("ui.action", e); }
      }
    }
    return result;
  }

  // 单个 plan 请求函数（带重试）
  async function generateSinglePlan(plan, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const form = new FormData();
        for (const img of allImageBlobs) {
          form.append("images", img.blob, img.name);
        }
        form.append("plans", JSON.stringify([plan]));
        form.append("productMode", "single");
        form.append("imageLanguage", "en");
        form.append("imageSize", "1000x1000");
        const resp = await fetch(`${AI_IMAGE_GEN_URL}/api/generate`, { method: "POST", body: form, headers: AI_AUTH_HEADERS });
        if (resp.ok) {
          const r = await processSSE(resp);
          if (Object.keys(r).length > 0) return r;
          console.error(`[ai-gen] Empty result for ${plan.imageType}, attempt ${attempt + 1}/${retries + 1}`);
        } else {
          lastGenerateError = await formatAiImageError(`Generate failed (${plan.imageType})`, resp);
          console.error(`[ai-gen] HTTP ${resp.status} for ${plan.imageType}, attempt ${attempt + 1}/${retries + 1}`);
        }
      } catch (e) {
        lastGenerateError = formatAiImageFetchError(`Generate failed (${plan.imageType})`, e, "/api/generate");
        console.error(`[ai-gen] Error for ${plan.imageType}: ${e.message}, attempt ${attempt + 1}/${retries + 1}`);
      }
      if (attempt < retries) await new Promise(r => setTimeout(r, 3000)); // 重试前等3秒
    }
    return {};
  }

  for (const group of planGroups) {
    const promises = group.map(plan => generateSinglePlan(plan));
    const results = await Promise.all(promises);
    for (const r of results) Object.assign(images, r);
  }

  // 检查缺失的图片，单独重试
  const missingPlans = plans.filter(p => !images[p.imageType]);
  if (missingPlans.length > 0) {
    console.error(`[ai-gen] Missing ${missingPlans.length} images, retrying individually...`);
    for (const plan of missingPlans) {
      const r = await generateSinglePlan(plan, 1);
      Object.assign(images, r);
    }
  }

  console.error(`[ai-gen] Total generated: ${Object.keys(images).length}/${plans.length}`);
  const success = Object.keys(images).length >= REQUIRED_AI_DETAIL_IMAGE_COUNT;
  return { success, images, analysis, error: success ? "" : lastGenerateError };
}

/**
 * 将 base64 图片保存为本地文件
 */
// saveBase64Image → moved to utils.mjs

/**
 * 在 Temu 页面中上传图片到素材中心，获取 kwcdn URL
 */
async function uploadImageToKwcdn(page, localImagePath) {
  const result = await uploadImageToMaterial(page, localImagePath);
  if (result.success && result.url) {
    return result.url;
  }
  return null;
}

/**
 * 完整自动核价流程
 * @param {Object} params
 * @param {string} params.csvPath - CSV 文件路径
 * @param {number} [params.startRow=0] - 起始行
 * @param {number} [params.count=1] - 处理数量
 * @param {number} [params.intervalMin=0.5] - 最小间隔（分钟）
 * @param {number} [params.intervalMax=1] - 最大间隔（分钟）
 */
async function autoPricingFromCSV(params) {
  console.error("[auto-pricing] Starting full auto pricing flow...");
  const taskId = typeof params?.taskId === "string" && params.taskId.trim()
    ? params.taskId.trim()
    : `pricing_${Date.now()}`;
  const csvPath = params.csvPath;
  if (!csvPath || !fs.existsSync(csvPath)) {
    const message = "CSV文件不存在: " + csvPath;
    const failedAt = getProgressTimestamp();
    replaceCurrentProgress({
      taskId,
      status: "failed",
      running: false,
      paused: false,
      current: "失败",
      step: "校验文件",
      message,
      csvPath: typeof csvPath === "string" ? csvPath : "",
      startRow: Number(params?.startRow) || 0,
      count: Number(params?.count) || 0,
      updatedAt: failedAt,
      finishedAt: failedAt,
    });
    return { success: false, taskId, message };
  }

  const startRow = params.startRow || 0;
  const count = params.count || 1;
  const intervalMin = params.intervalMin || 0.5;
  const intervalMax = params.intervalMax || 1;
  const results = [];

  // 支持 XLSX 和 CSV 两种格式
  let headers, dataRows;
  const isXlsx = csvPath.endsWith(".xlsx") || csvPath.endsWith(".xls");
  if (isXlsx) {
    const wb = XLSX.readFile(csvPath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const allRows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    // 跳过可能的标题行（如"店铺信息"），找到真正的列头（包含"商品标题"或"商品名称"）
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(10, allRows.length); i++) {
      const row = allRows[i];
      if (row && row.some(c => typeof c === "string" && (c.includes("商品标题") || c.includes("商品名称") || c.includes("美元价格")))) {
        headerRowIdx = i;
        break;
      }
    }
    headers = (allRows[headerRowIdx] || []).map(h => String(h || ""));
    dataRows = allRows.slice(headerRowIdx + 1).filter(r => r && r.length > 0);
    console.error(`[auto-pricing] XLSX: header row=${headerRowIdx}, data rows=${dataRows.length}, headers=${headers.slice(0, 8).join("|")}`);
  } else {
    const csvContent = fs.readFileSync(csvPath, "utf8");
    const lines = csvContent.split("\n").filter(l => l.trim());
    function parseCSVLine(line) {
      const result = [];
      let current = "", inQuotes = false;
      for (const ch of line) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ""; }
        else current += ch;
      }
      result.push(current.trim());
      return result;
    }
    headers = parseCSVLine(lines[0]);
    dataRows = lines.slice(1).map(l => parseCSVLine(l));
  }

  const colIndex = (names) => {
    for (const name of names) {
      const idx = headers.findIndex(h => h && h.includes(name));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const nameIdx = colIndex(["商品标题（中文）", "商品名称", "title"]);
  const nameEnIdx = colIndex(["商品标题（英文）", "title_en"]);
  const imageIdx = colIndex(["商品主图", "商品原图", "image"]);
  const carouselIdx = colIndex(["商品轮播图"]);
  const catCnIdx = colIndex(["后台分类", "前台分类（中文）", "分类（中文）", "分类"]);
  const priceIdx = colIndex(["美元价格($)", "美元价格", "price"]);

  console.error(`[auto-pricing] Columns: name=${nameIdx}, image=${imageIdx}, cat=${catCnIdx}, price=${priceIdx}`);

  const total = Math.max(0, Math.min(count, dataRows.length - startRow));
  console.error(`[auto-pricing] Will process ${total} products (dataRows=${dataRows.length})`);
  console.error(`[auto-pricing] Columns: name=${nameIdx}, nameEn=${nameEnIdx}, image=${imageIdx}, carousel=${carouselIdx}, cat=${catCnIdx}, price=${priceIdx}`);

  // 创建临时目录
  const tmpDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "auto-pricing-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  pricingPaused = false;
  const startedAt = getProgressTimestamp();
  replaceCurrentProgress({
    taskId,
    status: "running",
    running: true,
    paused: false,
    total,
    completed: 0,
    current: "准备中...",
    step: "初始化",
    message: "批量上品任务运行中",
    csvPath,
    startRow,
    count,
    createdAt: startedAt,
    startedAt,
    updatedAt: startedAt,
  });

  for (let i = startRow; i < startRow + total; i++) {
    const cols = dataRows[i] || [];
    const getCol = (idx) => idx >= 0 ? String(cols[idx] || "") : "";
    const productName = getCol(nameIdx) || getCol(nameEnIdx) || "";
    const imageUrl = getCol(imageIdx) || "";
    const carouselUrls = getCol(carouselIdx).split(",").map(s => s.trim()).filter(s => s.startsWith("http"));
    const categoryCn = getCol(catCnIdx) || "";
    const priceUSD = priceIdx >= 0 ? parseFloat(getCol(priceIdx)) || 0 : 0;
    const priceCNY = priceUSD > 0 ? priceUSD * 7 : 9.99;

    const itemNum = i - startRow + 1;

    // 暂停检查：等待恢复
    while (pricingPaused) {
      syncCurrentProgressResults(results, {
        running: true,
        paused: true,
        status: "paused",
        total,
        completed: itemNum - 1,
        current: `${itemNum}/${total} ${productName.slice(0, 30)}`,
        step: "已暂停",
        message: "批量上品任务已暂停，等待继续。",
      });
      await new Promise(r => setTimeout(r, 1000));
    }

    // 更新实时进度
    syncCurrentProgressResults(results, {
      running: true,
      paused: false,
      status: "running",
      total,
      completed: itemNum - 1,
      current: `${itemNum}/${total} ${productName.slice(0, 30)}`,
      step: "开始处理",
      message: "批量上品任务运行中",
    });
    console.error(`\n[auto-pricing] ======== ${itemNum}/${total} ========`);
    console.error(`[auto-pricing] Title: ${productName.slice(0, 50)}`);
    console.error(`[auto-pricing] Category: ${categoryCn}`);
    console.error(`[auto-pricing] Price: $${priceUSD} → ¥${priceCNY.toFixed(2)}`);

    try {
      // Step 1: 下载商品原图
      updateCurrentProgress({ step: "下载原图" });
      let sourceImagePath = null;
      if (imageUrl?.startsWith("http")) {
        const imgFile = path.join(tmpDir, `source_${i}_${Date.now()}.jpg`);
        try {
          await downloadImage(imageUrl, imgFile);
          sourceImagePath = imgFile;
          console.error(`[auto-pricing] Source image downloaded`);
        } catch (e) {
          console.error(`[auto-pricing] Image download failed: ${e.message}`);
        }
      }

      if (!sourceImagePath) {
        results.push({ index: i, name: productName.slice(0, 40), success: false, message: "无法下载商品原图" });
        syncCurrentProgressResults(results, { current: `${itemNum}/${total} ${productName.slice(0, 30)}`, step: "原图下载失败" });
        continue;
      }

      // Step 1.5: 下载轮播图作为 AI 额外参考
      const carouselLocalPaths = [];
      if (carouselUrls.length > 0) {
        console.error(`[auto-pricing] Downloading ${Math.min(carouselUrls.length, 4)} carousel images for AI reference...`);
        for (let ci = 0; ci < Math.min(carouselUrls.length, 4); ci++) {
          try {
            const cFile = path.join(tmpDir, `carousel_${i}_${ci}_${Date.now()}.jpg`);
            await downloadImage(carouselUrls[ci], cFile);
            carouselLocalPaths.push(cFile);
          } catch (e) { logSilent("ui.action", e); }
        }
        console.error(`[auto-pricing] Downloaded ${carouselLocalPaths.length} carousel images`);
      }

      // Step 2: AI 生成 9 张详情图（原主图只做参考，不参与最终提交）
      updateCurrentProgress({ step: "AI生图中..." });
      console.error(`[auto-pricing] Generating AI images (${1 + carouselLocalPaths.length} source images)...`);
      const aiResult = await generateImagesWithAI(sourceImagePath, productName, carouselLocalPaths);
      if (!aiResult.success) {
        results.push({
          index: i,
          name: productName.slice(0, 40),
          success: false,
          message: "AI生图失败: " + (aiResult.error || `图片不足${REQUIRED_AI_DETAIL_IMAGE_COUNT}张`),
        });
        syncCurrentProgressResults(results, { current: `${itemNum}/${total} ${productName.slice(0, 30)}`, step: "AI生图失败" });
        continue;
      }

      // Step 3: 保存 base64 图片到本地文件
      const localImages = {};
      for (const type of AI_DETAIL_IMAGE_TYPE_ORDER) {
        if (aiResult.images[type]) {
          const imgPath = path.join(tmpDir, `${i}_${type}_${Date.now()}.png`);
          saveBase64Image(aiResult.images[type], imgPath);
          localImages[type] = imgPath;
        }
      }
      console.error(`[auto-pricing] Saved ${Object.keys(localImages).length} images locally`);

      // Step 4: 上传到素材中心获取 kwcdn URL
      updateCurrentProgress({ step: "上传图片..." });
      console.error(`[auto-pricing] Uploading to material center...`);
      const page = await context.newPage();
      try {
      await navigateToSellerCentral(page, "/goods/list");
      await randomDelay(3000, 5000);

      const kwcdnUrls = {};
      // 并发上传（3张一组）
      const uploadTypes = AI_DETAIL_IMAGE_TYPE_ORDER.filter(t => localImages[t]);
      for (let u = 0; u < uploadTypes.length; u += 3) {
        const batch = uploadTypes.slice(u, u + 3);
        const uploadResults = await Promise.all(batch.map(async (type) => {
          const url = await uploadImageToKwcdn(page, localImages[type]);
          return { type, url };
        }));
        for (const { type, url } of uploadResults) {
          if (url) {
            kwcdnUrls[type] = url;
            console.error(`[auto-pricing] Uploaded ${type}: ${url.slice(0, 60)}`);
          } else {
            console.error(`[auto-pricing] Upload failed for ${type}`);
          }
        }
      }
      } finally { await page.close().catch(() => {}); }

      // 按指定顺序排列图片 URL
      const orderedImageUrls = AI_DETAIL_IMAGE_TYPE_ORDER
        .map(type => kwcdnUrls[type])
        .filter(Boolean);

      console.error(`[auto-pricing] Total uploaded: ${orderedImageUrls.length}`);

      if (orderedImageUrls.length < REQUIRED_AI_DETAIL_IMAGE_COUNT) {
        results.push({
          index: i,
          name: productName.slice(0, 40),
          success: false,
          message: `上传图片不足${REQUIRED_AI_DETAIL_IMAGE_COUNT}张 (${orderedImageUrls.length})`,
        });
        syncCurrentProgressResults(results, { current: `${itemNum}/${total} ${productName.slice(0, 30)}`, step: "图片上传失败" });
        continue;
      }

      // Step 5: AI 生成中文标题
      updateCurrentProgress({ step: "生成标题..." });
      let finalTitle = productName;
      if (aiResult.analysis) {
        try {
          console.error(`[auto-pricing] Generating Chinese title...`);
          const titleResp = await fetch(`${AI_IMAGE_GEN_URL}/api/title`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...AI_AUTH_HEADERS },
            body: JSON.stringify({ analysis: aiResult.analysis }),
          });
          if (titleResp.ok) {
            const titleData = await titleResp.json();
            // 用第一个标题（关键词优化版），去掉 [品牌名] 和数字（如250ml）
            finalTitle = (titleData.titles?.[0]?.title || productName)
              .replace(/\[.*?\]\s*/g, "")          // 去掉所有 [xxx] 包括品牌名
              .replace(/（.*?）/g, "")               // 去掉中文括号内容
              .replace(/\d+(\.\d+)?\s*(ml|g|kg|cm|mm|m|l|oz|inch|ft|pcs|件|个|只|片|包|瓶|支|毫升|厘米|毫米|英寸|磅|盎司|卷|套|组|双|对|块|条|根|张|把|台|袋)/gi, "")  // 去掉数字+单位
              .replace(/\d+\s*[x×]\s*\d*/gi, "")    // 去掉 30x、10x20 等
              .replace(/\d+p\b/gi, "")               // 去掉 100p 等
              .replace(/\b\d{2,}\b/g, "")            // 去掉独立的2位以上数字
              .replace(/，\s*，/g, "，")              // 修复连续中文逗号
              .replace(/\|\s*\|/g, "|")              // 修复连续分隔符
              .replace(/^\s*[|，,]\s*/g, "")          // 去掉开头的分隔符
              .replace(/\s*[|，,]\s*$/g, "")          // 去掉结尾的分隔符
              .replace(/\s+/g, " ")
              .trim();
            console.error(`[auto-pricing] Title: ${finalTitle.slice(0, 60)}`);
          }
        } catch (e) {
          console.error(`[auto-pricing] Title generation failed: ${e.message}, using original`);
        }
      }

      // 标题末尾追加后台分类最后一级
      if (categoryCn) {
        const lastCat = categoryCn.split(/[/>]/).map(s => s.trim()).filter(Boolean).pop();
        if (lastCat && !finalTitle.includes(lastCat)) {
          finalTitle = `${finalTitle}，${lastCat}`;
          console.error(`[auto-pricing] Title + category: ${finalTitle.slice(0, 80)}`);
        }
      }

      // Step 6: 提交核价
      // 分类搜索词优先级：CSV分类路径（含/，最精确） > AI分析分类 > 标题
      const aiCategory = aiResult.analysis?.category?.split("(")?.[0]?.trim() || ""; // 取中文部分，如 "家庭清洁用品"
      // 优先用CSV中的分类路径（如 "商用、工业与科技/职业安全用品"），再用AI分析的分类
      const categorySearch = categoryCn || aiCategory || productName;
      console.error(`[auto-pricing] Category search: CSV="${categoryCn}" AI="${aiCategory}" → using "${categorySearch}"`);

      updateCurrentProgress({ step: "提交核价..." });
      console.error(`[auto-pricing] Submitting pricing with ${orderedImageUrls.length} images...`);
      const createResult = await createProductViaAPI({
        title: finalTitle,
        imageUrls: orderedImageUrls,
        price: priceCNY,
        categorySearch,
        keepOpen: false,
        config: params.config,
      });

      results.push({
        index: i,
        name: productName.slice(0, 40),
        ...createResult,
      });
      syncCurrentProgressResults(results, {
        current: `${itemNum}/${total} ${productName.slice(0, 30)}`,
        step: createResult.success ? "提交成功" : "提交失败",
        message: createResult.success ? "当前商品提交成功" : (createResult.message || "当前商品提交失败"),
      });
      console.error(`[auto-pricing] ${createResult.success ? "SUCCESS productId=" + createResult.productId : "FAIL: " + createResult.message}`);

      // 清理临时文件
      for (const f of Object.values(localImages)) {
        try { fs.unlinkSync(f); } catch (e) { logSilent("ui.action", e); }
      }
      try { fs.unlinkSync(sourceImagePath); } catch (e) { logSilent("ui.action", e); }

    } catch (e) {
      results.push({ index: i, name: productName.slice(0, 40), success: false, message: e.message });
      syncCurrentProgressResults(results, {
        current: `${itemNum}/${total} ${productName.slice(0, 30)}`,
        step: "执行失败",
        message: e.message || "当前商品执行失败",
      });
      console.error(`[auto-pricing] ERROR: ${e.message}`);
    }

    // 间隔控制
    if (itemNum < total) {
      const waitMin = intervalMin + Math.random() * (intervalMax - intervalMin);
      console.error(`[auto-pricing] Progress: ${itemNum}/${total} (${results.filter(r => r.success).length} ok). Next in ${waitMin.toFixed(1)}min...`);
      await new Promise(r => setTimeout(r, waitMin * 60000));
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failedItems = results.filter(r => !r.success);
  console.error(`\n[auto-pricing] DONE: ${successCount}/${results.length} succeeded`);

  // 保存结果
  const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  fs.mkdirSync(debugDir, { recursive: true });
  const resultFile = path.join(debugDir, `auto_pricing_result_${Date.now()}.json`);
  fs.writeFileSync(resultFile, JSON.stringify({ total: results.length, successCount, failCount: failedItems.length, results }, null, 2));

  // 重置进度
  const finishedAt = getProgressTimestamp();
  syncCurrentProgressResults(results, {
    running: false,
    paused: false,
    status: "completed",
    total: results.length,
    completed: results.length,
    current: "完成",
    step: "完成",
    message: `批量上品完成：${successCount} 成功，${failedItems.length} 失败`,
    updatedAt: finishedAt,
    finishedAt,
  });
  return { success: true, taskId, total: results.length, successCount, failCount: failedItems.length, results, resultFile };
}

// ============================================================
// 核价配置 — 可通过 params.config 覆盖
// ============================================================
const PRICING_CONFIG = {
  retailPriceMultiplier: 1,        // 建议零售价 = 申报价 × N（默认1:1）
  defaultWeight: 50000,            // 默认重量 (mg)，50g
  defaultDimensions: { len: 80, width: 70, height: 60 },  // 默认尺寸 (mm)
  defaultRegion: { countryShortName: "CN", region2Id: 43000000000031 }, // 浙江
  currency: "CNY",
  createEndpoint: "/visage-agent-seller/product/add",
  draftEndpoint: "/visage-agent-seller/product/draft/add",
  categoryTemplateEndpoint: "/anniston-agent-seller/category/template/query",
  specQueryEndpoint: "/anniston-agent-seller/sku/spec/byName/queryOrAdd",
  specParentEndpoint: "/anniston-agent-seller/sku/spec/parent/list",
  // 通用默认属性（当分类模板无法获取时使用）
  defaultProperties: [
    { valueUnit: "", propValue: "其它塑料制", propName: "主体材质", refPid: 1920, vid: 63161, numberInputValue: "", controlType: 1, pid: 1, templatePid: 962980, valueExtendInfo: "" },
    { valueUnit: "", propValue: "详见商品详情", propName: "适用车型", refPid: 1941, vid: 118290, numberInputValue: "", controlType: 1, pid: 1459, templatePid: 1249501, valueExtendInfo: "" },
  ],
  // 默认规格（风格 A）
  defaultSpec: { parentSpecId: 18012, parentSpecName: "风格", specId: 20640, specName: "A" },
};

/**
 * 查询分类的属性模板，用 AI 智能分析填充属性值
 */
async function getCategoryProperties(page, leafCatId, productTitle) {
  const result = await temuXHR(page, PRICING_CONFIG.categoryTemplateEndpoint, { catId: leafCatId }, { maxRetries: 2 });
  if (!result.success || !result.data) return null;

  const props = result.data.properties
    || result.data.productPropertyTemplateList
    || result.data.propertyList
    || result.data.templatePropertyList
    || [];

  if (props.length === 0) {
    const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const debugFile = path.join(debugDir, `template_response_${leafCatId}_${Date.now()}.json`);
    fs.writeFileSync(debugFile, JSON.stringify(result.data, null, 2));
    console.error(`[getCategoryProperties] No properties found. Debug: ${debugFile}`);
    return null;
  }

  console.error(`[getCategoryProperties] Template has ${props.length} properties for catId=${leafCatId}`);

  // 构建属性列表供 AI 分析
  const propsForAI = [];
  const propsMap = new Map(); // propName → { prop, values }

  for (const p of props) {
    const propName = p.name || p.propertyName || p.propName || "";
    const propValues = p.values || p.propertyValueList || p.valueList || [];
    const isRequired = p.required === true || p.required === 1 || p.isRequired === true || p.isRequired === 1;
    if (!propValues || propValues.length === 0) continue;
    // 只分析必填属性
    if (!isRequired) continue;

    const valueTexts = propValues.map(v => v.value || v.propValue || "").filter(Boolean);
    propsForAI.push({ name: propName, required: isRequired, values: valueTexts.slice(0, 30) });
    propsMap.set(propName, { prop: p, values: propValues });
  }

  if (propsForAI.length === 0) return null;

  // 调用 AI 分析属性
  let aiDecisions = null;
  try {
    const prompt = `你是一个电商商品属性填写专家。

商品标题: "${productTitle}"

以下是该分类的属性列表，每个属性有可选值。请判断哪些属性与该商品相关，并选择最合适的值。

属性列表:
${propsForAI.map((p, i) => `${i + 1}. ${p.name}${p.required ? '(必填)' : '(选填)'}: [${p.values.join(', ')}]`).join('\n')}

规则:
1. 必填属性必须填值，禁止skip！即使不确定也要选"其他"、"其它"等安全值
2. 选填属性如果与商品无关可以 "skip"
3. 优先选择"其他"、"其它"、"不适用"等安全值，除非商品明确属于某个具体选项
4. 每个必填属性都必须返回一个具体的值

请用 JSON 数组格式回复，每项格式: {"name": "属性名", "value": "选择的值"} 或 {"name": "属性名", "value": "skip"}
只返回 JSON 数组，不要其他文字。`;

    console.error(`[getCategoryProperties] Calling AI to analyze ${propsForAI.length} required properties...`);

    // 调用 AI API（从顶部常量读取配置）
    if (!AI_API_KEY) {
      console.error(`[getCategoryProperties] AI_API_KEY not configured, using safe defaults`);
      throw new Error("skip_ai");
    }

    const aiResp = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
    });

    if (aiResp.ok) {
      const aiData = await aiResp.json();
      const content = aiData.choices?.[0]?.message?.content || "";
      console.error(`[getCategoryProperties] AI raw response: ${content.slice(0, 300)}`);
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        aiDecisions = JSON.parse(jsonMatch[0]);
        console.error(`[getCategoryProperties] AI returned ${aiDecisions.length} decisions`);
      }
    } else {
      console.error(`[getCategoryProperties] AI API error: ${aiResp.status} ${await aiResp.text().catch(() => '')}`);
    }
  } catch (e) {
    console.error(`[getCategoryProperties] AI analysis failed: ${e.message}, falling back to safe defaults`);
  }

  // 安全值优先级（AI 失败时的 fallback）
  const safeValuePriority = [
    /^其[他它]$/,
    /其[他它]/,
    /不适用|N\/A/,
    /^无$|^无\s/,
    /通用/,
    /详见/,
    /不含|不需要|不涉及/,
    /混合|混纺|复合/,
  ];

  const output = [];

  for (const p of props) {
    const propName = p.name || p.propertyName || p.propName || "";
    const propValues = p.values || p.propertyValueList || p.valueList || [];
    const isRequired = p.required === true || p.required === 1 || p.isRequired === true || p.isRequired === 1;
    const propPid = p.pid || p.propertyId || 0;
    const propRefPid = p.refPid || p.refPropertyId || 0;
    const propTemplatePid = p.templatePid || p.templatePropertyId || 0;

    if (!propValues || propValues.length === 0) continue;

    let selectedVal = null;

    if (aiDecisions) {
      // AI 模式：按 AI 建议选值
      const decision = aiDecisions.find(d => d.name === propName);
      if (decision) {
        if (decision.value === "skip") {
          if (isRequired) {
            // 必填属性不允许 skip，fallback 到安全值
            console.error(`[getCategoryProperties] AI tried to skip REQUIRED "${propName}", using safe value instead`);
            // selectedVal 保持 null，后续走安全值 fallback
          } else {
            console.error(`[getCategoryProperties] AI skip: "${propName}"`);
            continue;
          }
        }
        // 在可选值中找 AI 推荐的值
        selectedVal = propValues.find(v => (v.value || v.propValue || "") === decision.value);
        if (!selectedVal) {
          // 模糊匹配
          selectedVal = propValues.find(v => (v.value || v.propValue || "").includes(decision.value) || decision.value.includes(v.value || v.propValue || ""));
        }
        if (selectedVal) {
          console.error(`[getCategoryProperties] AI select: "${propName}" = "${decision.value}"`);
        }
      } else {
        // AI 没提到的属性：必填用安全值，选填跳过
        if (!isRequired) continue;
      }
    }

    // Fallback：没有 AI 决策或 AI 没匹配到值时
    if (!selectedVal) {
      if (!isRequired) continue; // 非必填跳过
      // 必填：用安全值
      for (const pattern of safeValuePriority) {
        selectedVal = propValues.find(v => pattern.test(v.value || v.propValue || ""));
        if (selectedVal) break;
      }
      if (!selectedVal) {
        selectedVal = propValues[0];
        console.error(`[getCategoryProperties] Fallback first value: "${propName}" = "${selectedVal?.value || selectedVal?.propValue}"`);
      }
    }

    const valText = selectedVal.value || selectedVal.propValue || "";
    let valVid = selectedVal.vid || selectedVal.valueId || 0;
    if (valVid <= 0) {
      // vid 为0：尝试从其他可选值中找一个有 vid 的
      if (isRequired) {
        const altVal = propValues.find(v => (v.vid || v.valueId || 0) > 0);
        if (altVal) {
          valVid = altVal.vid || altVal.valueId;
          console.error(`[getCategoryProperties] vid=0 for "${propName}", using alt: "${altVal.value || altVal.propValue}" vid=${valVid}`);
        } else {
          console.error(`[getCategoryProperties] WARNING: "${propName}" has no valid vid, skipping`);
          continue;
        }
      } else {
        continue;
      }
    }

    output.push({
      valueUnit: (Array.isArray(p.valueUnit) ? p.valueUnit[0] : p.valueUnit) || "",
      propValue: valText,
      propName: propName,
      refPid: propRefPid,
      vid: valVid,
      numberInputValue: "",
      controlType: p.propertyValueType === 0 ? 1 : (p.controlType || 0),
      pid: propPid,
      templatePid: propTemplatePid,
      valueExtendInfo: "",
    });
  }

  // 后处理：检查父子关系冲突
  // 如果电源方式=不带电/无 或 电池属性=不带电池，则移除所有电相关子属性
  const powerProp = output.find(p => p.propName === "电源方式" || p.propName === "电池属性");
  if (powerProp && /不带电|无|不需要|不含/.test(powerProp.propValue)) {
    const electricChildProps = ["工作电压", "插头规格", "额定功率", "电压", "功率", "瓦数", "电池数量", "电池类型", "电池容量", "充电时间", "充电方式", "可充电电池", "不可充电电池", "太阳能电池", "电池属性"];
    for (let i = output.length - 1; i >= 0; i--) {
      if (electricChildProps.some(n => output[i].propName.includes(n))) {
        console.error(`[getCategoryProperties] Remove child prop "${output[i].propName}" (parent 电源方式=不带电)`);
        output.splice(i, 1);
      }
    }
  }

  // 电池数量=无电池/不含电池 → 直接移除（无意义且可能缺少父属性）
  for (let i = output.length - 1; i >= 0; i--) {
    if (output[i].propName === "电池数量" && /无电池|不含|不需要|^无$/.test(output[i].propValue)) {
      console.error(`[getCategoryProperties] Remove "电池数量" = "${output[i].propValue}" (无电池无需提交)`);
      output.splice(i, 1);
    }
  }

  // 通用电池子属性兜底：如果有电池相关子属性但没有对应父属性，移除子属性
  const batteryChildNames = ["电池数量", "电池类型", "电池容量", "充电时间", "充电方式", "可充电电池", "不可充电电池", "太阳能电池", "电池属性"];
  const hasBatteryParent = output.some(p => p.propName === "电源方式" || p.propName === "是否含电池");
  if (!hasBatteryParent) {
    for (let i = output.length - 1; i >= 0; i--) {
      if (batteryChildNames.some(n => output[i].propName.includes(n))) {
        console.error(`[getCategoryProperties] Remove orphan battery prop "${output[i].propName}" (no parent 电源方式/是否含电池)`);
        output.splice(i, 1);
      }
    }
  }

  // 如果主体材质不是皮革/木材相关，移除真皮种类/木材类型/木种
  const materialProp = output.find(p => ["主体材质", "材料", "材质"].includes(p.propName));
  if (materialProp && !/皮革|真皮|牛皮|羊皮|猪皮/.test(materialProp.propValue)) {
    for (let i = output.length - 1; i >= 0; i--) {
      if (["真皮种类"].includes(output[i].propName)) {
        console.error(`[getCategoryProperties] Remove "${output[i].propName}" (材质非皮革)`);
        output.splice(i, 1);
      }
    }
  }
  if (materialProp && !/木|竹|藤/.test(materialProp.propValue)) {
    for (let i = output.length - 1; i >= 0; i--) {
      if (["木材类型", "木种"].includes(output[i].propName)) {
        console.error(`[getCategoryProperties] Remove "${output[i].propName}" (材质非木材)`);
        output.splice(i, 1);
      }
    }
  }

  console.error(`[getCategoryProperties] Final ${output.length} properties: ${output.map(p => `${p.propName}=${p.propValue}`).join(", ")}`);
  return output;
}

/**
 * 查询分类的规格信息（颜色/风格/尺寸等）
 */
async function getCategorySpec(page, leafCatId) {
  const result = await temuXHR(page, PRICING_CONFIG.specParentEndpoint, { catId: leafCatId }, { maxRetries: 1 });
  if (result.success && result.data?.parentSpecVOList?.length > 0) {
    const spec = result.data.parentSpecVOList[0]; // 取第一个规格维度
    return { parentSpecId: spec.parentSpecId, parentSpecName: spec.parentSpecName };
  }
  return null;
}

/**
 * AI 自修复：分析提交错误并返回修复指令
 */
async function aiSelfRepair(errorMsg, errorCode, payload, params) {
  if (!AI_API_KEY) { console.error("[selfRepair] AI_API_KEY not configured"); return null; }

  const propsInfo = (payload.productPropertyReqs || []).map(p => `${p.propName}=${p.propValue}`).join(", ");
  const catInfo = Object.entries(payload).filter(([k, v]) => k.startsWith("cat") && k.endsWith("Id") && v > 0).map(([k, v]) => `${k}=${v}`).join(", ");

  const prompt = `你是 Temu 卖家后台商品上架错误修复专家。分析以下错误并给出修复指令。

商品标题: "${params.title || ""}"
提交的类目: ${catInfo}
提交的属性: ${propsInfo}
错误码: ${errorCode}
错误信息: "${errorMsg}"

常见错误模式和修复方法:
1. "属性[X]校验错误:属性值:Y不满足父子关系" → 移除属性X（父属性不匹配时子属性应被删除）
2. "属性[X]校验错误:缺少父属性值" → 移除属性X（缺少父属性时子属性不应提交）
3. "货品类目属性更新" → 重新获取属性模板（retry_template）
4. "不能为空" → 重新获取属性模板
5. "Category is illegal" → 重新搜索类目（retry_category）
6. "Outer packaging information is incomplete" → 补全包装信息（fix_packaging）

请返回JSON（不要其他文字）:
{
  "analysis": "一句话分析错误原因",
  "actions": [
    {"type": "remove_prop", "propName": "属性名"},
    {"type": "retry_template"},
    {"type": "retry_category"},
    {"type": "fix_packaging"},
    {"type": "give_up", "reason": "原因"}
  ]
}
只返回需要的action，不要返回所有类型。`;

  try {
    const resp = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({ model: AI_MODEL, messages: [{ role: "user", content: prompt }], temperature: 0.1 }),
    });

    if (!resp.ok) {
      console.error(`[selfRepair] AI API error: ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || "";
    console.error(`[selfRepair] AI response: ${content.slice(0, 300)}`);

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.error(`[selfRepair] Analysis: ${parsed.analysis}`);
      console.error(`[selfRepair] Actions: ${JSON.stringify(parsed.actions)}`);
      return parsed;
    }
  } catch (e) {
    console.error(`[selfRepair] AI call failed: ${e.message}`);
  }
  return null;
}

/**
 * 规则兜底修复（AI 失败时的 fallback）
 */
function ruleBasedRepair(errorMsg) {
  const actions = [];

  // 属性校验错误：提取属性名并移除
  const attrMatch = errorMsg.match(/属性\[(.+?)\]/);
  if (attrMatch) {
    actions.push({ type: "remove_prop", propName: attrMatch[1] });
    return actions;
  }

  // 类目属性更新 → 重新获取模板
  if (errorMsg.includes("货品类目属性更新")) {
    actions.push({ type: "retry_template" });
    return actions;
  }

  // 类目非法 → 重新搜索
  if (errorMsg.includes("Category is illegal")) {
    actions.push({ type: "retry_category" });
    return actions;
  }

  // 包装不完整 → 补全
  if (errorMsg.includes("Outer packaging") || errorMsg.includes("packaging information")) {
    actions.push({ type: "fix_packaging" });
    return actions;
  }

  // 不能为空 → 重新获取模板
  if (errorMsg.includes("不能为空")) {
    actions.push({ type: "retry_template" });
    return actions;
  }

  // 主销售属性不合法 → 重新获取规格并重试
  if (errorMsg.includes("主销售属性不合法")) {
    actions.push({ type: "retry_spec" });
    return actions;
  }

  // 说明书未上传 → 保存草稿（无法自动上传说明书）
  if (errorMsg.includes("说明书未上传")) {
    actions.push({ type: "give_up", reason: "该类目要求上传说明书，需手动处理" });
    return actions;
  }

  return actions;
}

async function createProductViaAPI(params) {
  console.error("[api-create] Starting API-based product creation...");
  const config = { ...PRICING_CONFIG, ...params.config };

  // Step 1: 打开 Temu 页面获取认证上下文
  const page = await context.newPage();
  try {
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(2000, 3000);
    await saveCookies();

    // Step 2: 准备图片（至少 5 张）
    let imageUrls = params.imageUrls || [];
    if (params.generateAI && params.sourceImage) {
      console.error("[api-create] Generating AI images...");
      try {
        const aiResult = await generateAIImages(
          params.sourceImage,
          params.title,
          params.aiImageTypes || ["hero", "lifestyle", "closeup", "infographic", "size_chart"]
        );
        const aiImages = aiResult.images || aiResult || [];
        console.error(`[api-create] AI generated ${aiImages.length} images`);

        // 并发上传图片（3个一批）
        for (let i = 0; i < aiImages.length; i += 3) {
          const batch = aiImages.slice(i, i + 3);
          const results = await Promise.allSettled(
            batch.map(imgPath => uploadImageToMaterial(page, imgPath))
          );
          for (const r of results) {
            if (r.status === "fulfilled" && r.value.success && r.value.url) {
              imageUrls.push(r.value.url);
            }
          }
        }
      } catch (e) {
        console.error(`[api-create] AI image generation failed: ${e.message}`);
      }
    }

    if (imageUrls.length === 0) {
      return { success: false, message: "没有可用的商品图片", step: "images" };
    }
    if (imageUrls.length < 5) {
      console.error(`[api-create] Warning: only ${imageUrls.length} images (need 5+). Duplicating...`);
      while (imageUrls.length < 5) {
        imageUrls.push(imageUrls[imageUrls.length % imageUrls.length]);
      }
    }

    // Step 3: 搜索分类 — 刷新页面确保 anti-content 有效
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    console.error(`[api-create] Page refreshed before category search`);

    let catIds = params.catIds;
    let leafCatId = params.leafCatId;
    if (!catIds) {
      // 后台分类路径搜索 + 逐级 fallback
      const searchTerms = [];
      if (params.categorySearch) {
        searchTerms.push(params.categorySearch);
        // fallback: 逐级从最后一级往上搜
        const parts = params.categorySearch.split("/").map(s => s.trim()).filter(Boolean);
        for (let i = parts.length - 1; i >= 0; i--) {
          if (!searchTerms.includes(parts[i])) searchTerms.push(parts[i]);
        }
      }
      if (params.title && !searchTerms.includes(params.title)) searchTerms.push(params.title);
      if (searchTerms.length === 0) searchTerms.push("通用商品");

      // 辅助函数：从 queryCatHints 响应中提取 catIds
      function extractCatIdsFromHints(hintsResult, categoryPath) {
        const hints = Array.isArray(hintsResult.data)
          ? hintsResult.data
          : (hintsResult.data?.list || hintsResult.data?.catHints || hintsResult.data?.categoryList || []);
        console.error(`[api-create] queryCatHints response keys: ${hintsResult.data ? Object.keys(hintsResult.data).join(",") : "null"}, hints count: ${hints.length}`);
        if (hints.length === 0) return null;

        // 智能匹配：从多个结果中找路径最匹配的
        let hint = hints[0];
        if (hints.length > 1 && categoryPath) {
          const pathParts = categoryPath.split(/[/>]/).map(s => s.trim()).filter(Boolean);
          let bestScore = -1;
          for (const h of hints) {
            // 构建完整路径
            const hPath = [];
            for (let j = 1; j <= 10; j++) {
              const catName = h[`cat${j}`]?.catName || "";
              if (catName) hPath.push(catName);
            }
            const fullPath = hPath.join(">");
            // 计算匹配分数
            let score = 0;
            for (const part of pathParts) {
              if (fullPath.includes(part)) score += 2;
              // 部分匹配
              for (const hp of hPath) {
                if (hp.includes(part.substring(0, 2)) || part.includes(hp.substring(0, 2))) score += 0.5;
              }
            }
            console.error(`[api-create] hint candidate: ${fullPath} score=${score}`);
            if (score > bestScore) { bestScore = score; hint = h; }
          }
          console.error(`[api-create] Best match score: ${bestScore}`);
        }
        console.error(`[api-create] hint[0] keys: ${Object.keys(hint).join(",")}, sample: ${JSON.stringify(hint).slice(0, 300)}`);
        const ids = {};
        for (let i = 1; i <= 10; i++) {
          // Support both flat (hint.cat1Id) and nested (hint.cat1.catId) formats
          ids[`cat${i}Id`] = hint[`cat${i}Id`] || (hint[`cat${i}`] && hint[`cat${i}`].catId) || 0;
        }
        let leaf = null;
        for (let i = 10; i >= 1; i--) {
          if (ids[`cat${i}Id`] > 0) { leaf = ids[`cat${i}Id`]; break; }
        }
        // If all catIds are 0, try alternative field names
        if (!leaf) {
          // Try catIdList array format
          if (hint.catIdList && Array.isArray(hint.catIdList)) {
            hint.catIdList.forEach((id, idx) => { if (id > 0) ids[`cat${idx+1}Id`] = id; });
            for (let i = 10; i >= 1; i--) { if (ids[`cat${i}Id`] > 0) { leaf = ids[`cat${i}Id`]; break; } }
          }
          // Try leafCatId directly
          if (!leaf && hint.leafCatId) { leaf = hint.leafCatId; ids.cat3Id = hint.leafCatId; }
          if (!leaf && hint.catId) { leaf = hint.catId; ids.cat3Id = hint.catId; }
          console.error(`[api-create] Alternative extraction: leaf=${leaf}`);
        }
        if (!leaf) return null; // Don't return all-zero catIds
        const hintPath = hint.catPath || hint._path || Object.keys(ids).filter(k => ids[k] > 0).map(k => `${k}=${ids[k]}`).join(",");
        return { catIds: ids, leafCatId: leaf, path: hintPath };
      }

      // 方法1: 分类树遍历（主方法）— 用后台分类路径精确匹配
      {
        for (const term of searchTerms) {
          if (catIds) break;
          console.error(`[api-create] Fallback searchCategoryAPI: "${term.slice(0, 50)}"`);
          const catResult = await searchCategoryAPI(page, term);
          if (catResult?.list?.[0]) {
            const cat = catResult.list[0];
            catIds = {};
            for (let i = 1; i <= 10; i++) {
              catIds[`cat${i}Id`] = cat[`cat${i}Id`] || 0;
            }
            for (let i = 10; i >= 1; i--) {
              if (catIds[`cat${i}Id`] > 0) { leafCatId = catIds[`cat${i}Id`]; break; }
            }
            console.error(`[api-create] Category: ${cat._path || JSON.stringify(catIds)}, leaf=${leafCatId}`);
          }
        }
      }
    }

    if (!catIds || !leafCatId) {
      // Final check: all catIds zero means search failed
      const allZero = catIds && Object.values(catIds).every(v => v === 0);
      if (!catIds || allZero || !leafCatId) {
        return { success: false, message: `分类搜索失败: "${params.categorySearch || params.title}"`, step: "category" };
      }
    }

    // 确保 leafCatId 不为 undefined
    if (!leafCatId) {
      for (let i = 10; i >= 1; i--) {
        if (catIds[`cat${i}Id`] > 0) { leafCatId = catIds[`cat${i}Id`]; break; }
      }
      console.error(`[api-create] Re-extracted leafCatId=${leafCatId} from catIds`);
    }

    // Step 3.5: AI 验证分类是否匹配商品标题
    if (catIds && params.title && AI_API_KEY) {
      const catPath = Object.keys(catIds)
        .filter(k => k.endsWith("Name") && catIds[k])
        .map(k => catIds[k]).join(" > ");
      if (catPath) {
        try {
          console.error(`[api-create] AI verifying category: "${catPath}" for "${params.title.slice(0, 30)}..."`);
          const verifyResp = await fetch(`${AI_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${AI_API_KEY}` },
            body: JSON.stringify({
              model: AI_MODEL,
              messages: [{ role: "user", content: `商品标题: "${params.title.slice(0, 80)}"\n分类路径: "${catPath}"\n\n这个分类是否适合该商品？只回答 "yes" 或 "no"。如果商品明显不属于这个分类就回答no。` }],
              temperature: 0,
              max_tokens: 10,
            }),
          });
          if (verifyResp.ok) {
            const vData = await verifyResp.json();
            const answer = (vData.choices?.[0]?.message?.content || "").trim().toLowerCase();
            console.error(`[api-create] Category verify: ${answer}`);
            if (answer.includes("no")) {
              console.error(`[api-create] Category mismatch! Re-searching with product title...`);
              // 用标题重新搜索分类
              const titleCatResult = await searchCategoryAPI(page, params.title);
              if (titleCatResult?.list?.[0]) {
                const cat = titleCatResult.list[0];
                catIds = {};
                for (let i = 1; i <= 10; i++) {
                  catIds[`cat${i}Id`] = cat[`cat${i}Id`] || 0;
                  if (cat[`cat${i}Name`]) catIds[`cat${i}Name`] = cat[`cat${i}Name`];
                }
                for (let i = 10; i >= 1; i--) {
                  if (catIds[`cat${i}Id`] > 0) { leafCatId = catIds[`cat${i}Id`]; break; }
                }
                const newPath = Object.keys(catIds).filter(k => k.endsWith("Name") && catIds[k]).map(k => catIds[k]).join(" > ");
                console.error(`[api-create] Re-searched category: ${newPath}, leaf=${leafCatId}`);
              }
            }
          }
        } catch (e) { logSilent("category.verify", e); }
      }
    }

    // Step 4: 获取分类属性和规格
    let properties = params.properties;
    if (!properties) {
      if (leafCatId) {
        console.error(`[api-create] Fetching category template for leaf=${leafCatId}...`);
        properties = await getCategoryProperties(page, leafCatId, params.title || "");
        if (properties) {
          console.error(`[api-create] Got ${properties.length} properties from template`);
        }
      }
      if (!properties || properties.length === 0) {
        properties = config.defaultProperties;
        console.error(`[api-create] Using default properties (${properties.length})`);
      }
    }

    // 获取规格信息
    let specInfo = config.defaultSpec;
    if (leafCatId) {
      const catSpec = await getCategorySpec(page, leafCatId);
      if (catSpec) {
        specInfo = { ...specInfo, ...catSpec };
        console.error(`[api-create] Spec: ${specInfo.parentSpecName} (${specInfo.parentSpecId})`);
      }
    }

    // 查询/创建规格值 - 26个字母随机
    const randomLetter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const specName = params.specName || randomLetter;
    const specResult = await temuXHR(page, config.specQueryEndpoint, { parentSpecId: specInfo.parentSpecId, specName }, { maxRetries: 2 });
    if (specResult.success && specResult.data?.specId) {
      specInfo.specId = specResult.data.specId;
      specInfo.specName = specName;
    } else {
      // specId 获取失败，尝试用默认值 "A"
      console.error(`[api-create] Spec query failed, retrying with "A"...`);
      const retrySpec = await temuXHR(page, config.specQueryEndpoint, { parentSpecId: specInfo.parentSpecId, specName: "A" }, { maxRetries: 1 });
      if (retrySpec.success && retrySpec.data?.specId) {
        specInfo.specId = retrySpec.data.specId;
        specInfo.specName = "A";
      } else {
        console.error(`[api-create] WARNING: specId unavailable, using default`);
      }
    }

    // Step 5: 构造 payload（基于真实抓包结构）
    const priceInCents = Math.round((params.price || 9.99) * 100 * 2);  // 申报价 ×2
    const retailPrice = Math.round(priceInCents * config.retailPriceMultiplier);

    const payload = {
      ...catIds,
      materialMultiLanguages: [],
      productName: params.title || "商品",
      productPropertyReqs: properties,
      productSkcReqs: [{
        previewImgUrls: [imageUrls[0]],
        productSkcCarouselImageI18nReqs: [],
        extCode: "",
        mainProductSkuSpecReqs: [{ parentSpecId: 0, parentSpecName: "", specId: 0, specName: "" }],
        productSkuReqs: [{
          thumbUrl: imageUrls[0],
          productSkuThumbUrlI18nReqs: [],
          extCode: "",
          supplierPrice: priceInCents,
          currencyType: config.currency,
          productSkuSpecReqs: [{
            parentSpecId: specInfo.parentSpecId,
            parentSpecName: specInfo.parentSpecName,
            specId: specInfo.specId,
            specName: specInfo.specName,
            specLangSimpleList: [],
          }],
          productSkuId: 0,
          productSkuSuggestedPriceReq: { suggestedPrice: retailPrice, suggestedPriceCurrencyType: config.currency },
          productSkuUsSuggestedPriceReq: {},
          productSkuWhExtAttrReq: {
            productSkuVolumeReq: params.dimensions || config.defaultDimensions,
            productSkuWeightReq: { value: params.weight || config.defaultWeight },
            productSkuBarCodeReqs: [],
            productSkuSensitiveAttrReq: { isSensitive: 0, sensitiveList: [] },
            productSkuSensitiveLimitReq: {},
          },
          productSkuMultiPackReq: {
            skuClassification: 1, numberOfPieces: 1, pieceUnitCode: 1,
            productSkuNetContentReq: {},
            totalNetContent: {},
          },
          productSkuAccessoriesReq: { productSkuAccessories: [] },
          productSkuNonAuditExtAttrReq: {},
        }],
        productSkcId: 0,
        isBasePlate: 0,
      }],
      productSpecPropertyReqs: [{
        parentSpecId: specInfo.parentSpecId, parentSpecName: specInfo.parentSpecName,
        specId: specInfo.specId, specName: specInfo.specName,
        vid: 0, specLangSimpleList: [], refPid: 0, pid: 0, templatePid: 0,
        propName: specInfo.parentSpecName, propValue: specInfo.specName,
        valueUnit: "", valueGroupId: 0, valueGroupName: "", valueExtendInfo: "",
      }],
      carouselImageUrls: imageUrls.slice(0, 5),
      carouselImageI18nReqs: [],
      materialImgUrl: imageUrls[0],
      goodsLayerDecorationReqs: [],
      goodsLayerDecorationCustomizeI18nReqs: [],
      sizeTemplateIds: [],
      showSizeTemplateIds: [],
      goodsModelReqs: [],
      productWhExtAttrReq: {
        outerGoodsUrl: params.outerGoodsUrl || "",
        productOrigin: params.productOrigin || config.defaultRegion,
      },
      productCarouseVideoReqList: [],
      goodsAdvantageLabelTypes: [],
      productDetailVideoReqList: [],
      productOuterPackageImageReqs: params.outerPackageImages || [
        { imageUrl: "https://pfs.file.temu.com/product-material-private-tag/211a2a4a582/cb2fce63-cb55-4ea4-a43d-2754fcdd7c19_300x225.jpeg" },
        { imageUrl: "https://pfs.file.temu.com/product-material-private-tag/211a2a4a582/ee94a810-071b-41ab-8079-55c0d394da78_300x225.jpeg" },
        { imageUrl: "https://pfs.file.temu.com/product-material-private-tag/211a2a4a582/a8a2ebbd-e72d-4a33-bbee-703112dad786_300x225.jpeg" },
      ],
      productOuterPackageReq: params.outerPackageReq || { packageShape: 1, packageType: 0 },
      sensitiveTransNormalFileReqs: [],
      productGuideFileNewReqList: [],
      productGuideFileI18nReqs: [],
      productSaleExtAttrReq: {},
      productNonAuditExtAttrReq: { california65WarningInfoReq: {}, cosmeticInfoReq: {} },
      personalizationSwitch: 0,
      productComplianceStatementReq: {
        protocolVersion: "V2.0",
        protocolUrl: "https://dl.kwcdn.com/seller-public-file-us-tag/2079f603b6/56888d17d8166a6700c9f3e82972e813.html",
      },
      productOriginCertFileReqs: [],
    };

    // Step 6: 提交核价
    console.error(`[api-create] Submitting to ${config.createEndpoint}...`);
    console.error(`[api-create] Price: ¥${(priceInCents / 100).toFixed(2)}, Retail: ¥${(retailPrice / 100).toFixed(2)}, Images: ${imageUrls.length}, Props: ${properties.length}`);

    let result = await temuXHR(page, config.createEndpoint, payload, { maxRetries: 1 });

    // ============ AI 自修复系统：最多5轮，根据错误类型智能修复 ============
    for (let attempt = 1; attempt <= 5 && !result.success; attempt++) {
      const errMsg = result.errorMsg || "";
      const errCode = result.errorCode || 0;

      // 只处理可修复的错误
      if (![6000002, 1000001, 1000003, 2000148].includes(errCode) && !errMsg.includes("不能为空") && !errMsg.includes("Category") && !errMsg.includes("packaging") && !errMsg.includes("Invalid image")) {
        console.error(`[selfRepair] Error ${errCode} not repairable, stopping`);
        break;
      }

      console.error(`[selfRepair] ===== Attempt ${attempt}/5: error=${errCode} "${errMsg}" =====`);

      // 保存调试信息
      const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
      fs.mkdirSync(debugDir, { recursive: true });
      fs.writeFileSync(path.join(debugDir, `selfrepair_${attempt}_${Date.now()}.json`), JSON.stringify({
        attempt, errorCode: errCode, errorMsg: errMsg,
        submittedProps: payload.productPropertyReqs?.map(p => ({ name: p.propName, value: p.propValue })),
        leafCatId, catIds: Object.fromEntries(Object.entries(catIds).filter(([k,v]) => v > 0)),
      }, null, 2));

      // 先尝试 AI 分析，失败则用规则兜底
      let repair = await aiSelfRepair(errMsg, errCode, payload, params);
      let actions = repair?.actions || [];
      if (actions.length === 0) {
        console.error(`[selfRepair] AI returned no actions, falling back to rules`);
        actions = ruleBasedRepair(errMsg);
      }
      if (actions.length === 0) {
        console.error(`[selfRepair] No repair strategy found, stopping`);
        break;
      }

      // 智能升级：如果连续2次 retry_template 都失败（同一错误），自动升级到 retry_category
      if (attempt >= 2 && errMsg.includes("货品类目属性更新") && actions.every(a => a.type === "retry_template")) {
        console.error(`[selfRepair] retry_template failed ${attempt} times, upgrading to retry_category`);
        actions = [{ type: "retry_category" }];
      }

      // 检查是否放弃
      const giveUp = actions.find(a => a.type === "give_up");
      if (giveUp) {
        console.error(`[selfRepair] AI says give up: ${giveUp.reason}`);
        break;
      }

      // 执行修复动作
      let needResubmit = false;
      for (const action of actions) {
        switch (action.type) {
          case "remove_prop": {
            const before = payload.productPropertyReqs.length;
            payload.productPropertyReqs = payload.productPropertyReqs.filter(p => p.propName !== action.propName);
            const removed = before - payload.productPropertyReqs.length;
            console.error(`[selfRepair] remove_prop: "${action.propName}" (removed ${removed})`);
            if (removed > 0) needResubmit = true;
            break;
          }
          case "retry_template": {
            console.error(`[selfRepair] retry_template: refreshing page and re-fetching...`);
            await page.goto(page.url(), { waitUntil: "domcontentloaded" });
            await randomDelay(2000, 3500);
            const newProps = await getCategoryProperties(page, leafCatId, params.title || "");
            if (newProps && newProps.length > 0) {
              payload.productPropertyReqs = newProps;
              console.error(`[selfRepair] Got ${newProps.length} refreshed properties`);
              needResubmit = true;
            } else {
              console.error(`[selfRepair] retry_template failed to get properties`);
            }
            break;
          }
          case "retry_category": {
            console.error(`[selfRepair] retry_category: re-searching with different terms...`);
            await page.goto(page.url(), { waitUntil: "domcontentloaded" });
            await randomDelay(2000, 3500);

            // 尝试多种搜索词：原标题 → 类目路径中的关键词 → 标题前20字
            const searchTerms = [];
            if (params.title) searchTerms.push(params.title);
            if (params.categorySearch) {
              const parts = params.categorySearch.split("/").map(s => s.trim()).filter(Boolean);
              // 从最后一级开始尝试
              for (let i = parts.length - 1; i >= 0; i--) searchTerms.push(parts[i]);
            }
            if (params.title && params.title.length > 20) searchTerms.push(params.title.substring(0, 20));

            let found = false;
            for (const term of searchTerms) {
              if (found) break;
              console.error(`[selfRepair] Trying category search: "${term.substring(0, 30)}..."`);
              const catResult = await searchCategoryAPI(page, term);
              if (catResult?.list?.[0]) {
                const cat = catResult.list[0];
                let newLeaf = null;
                let depth = 0;
                for (let i = 1; i <= 10; i++) {
                  const cid = cat[`cat${i}Id`] || 0;
                  catIds[`cat${i}Id`] = cid;
                  payload[`cat${i}Id`] = cid;
                  if (cid > 0) { newLeaf = cid; depth = i; }
                }
                // 只接受比当前更深或不同的类目
                if (newLeaf && (newLeaf !== leafCatId || depth > 3)) {
                  leafCatId = newLeaf;
                  console.error(`[selfRepair] New category: leaf=${leafCatId}, depth=${depth}`);
                  const newProps = await getCategoryProperties(page, leafCatId, params.title || "");
                  if (newProps && newProps.length > 0) payload.productPropertyReqs = newProps;
                  needResubmit = true;
                  found = true;
                } else {
                  console.error(`[selfRepair] Same/shallow category (depth=${depth}), trying next term...`);
                }
              }
            }
            break;
          }
          case "fix_packaging": {
            payload.productOuterPackageReq = { packageShape: 1, packageType: 0 };
            console.error(`[selfRepair] fix_packaging: set default packaging`);
            needResubmit = true;
            break;
          }
          case "retry_spec": {
            console.error(`[selfRepair] retry_spec: re-querying spec...`);
            await page.goto(page.url(), { waitUntil: "domcontentloaded" });
            await randomDelay(2000, 3000);
            // 重新获取规格
            const newSpec = await getCategorySpec(page, leafCatId);
            if (newSpec) {
              const newSpecName = "A";
              const newSpecResult = await temuXHR(page, config.specQueryEndpoint, { parentSpecId: newSpec.parentSpecId, specName: newSpecName }, { maxRetries: 1 });
              if (newSpecResult.success && newSpecResult.data?.specId) {
                const sid = newSpecResult.data.specId;
                // 更新 payload 中所有 spec 相关字段
                payload.productSpecPropertyReqs = [{ ...payload.productSpecPropertyReqs[0], parentSpecId: newSpec.parentSpecId, parentSpecName: newSpec.parentSpecName, specId: sid, specName: newSpecName, propName: newSpec.parentSpecName, propValue: newSpecName }];
                payload.productSkcReqs[0].productSkuReqs[0].productSkuSpecReqs = [{ parentSpecId: newSpec.parentSpecId, parentSpecName: newSpec.parentSpecName, specId: sid, specName: newSpecName, specLangSimpleList: [] }];
                console.error(`[selfRepair] New spec: ${newSpec.parentSpecName} id=${sid}`);
                needResubmit = true;
              }
            }
            break;
          }
          default:
            console.error(`[selfRepair] Unknown action: ${action.type}`);
        }
      }

      if (!needResubmit) {
        console.error(`[selfRepair] No effective repair action, stopping`);
        break;
      }

      console.error(`[selfRepair] Re-submitting after repair...`);
      result = await temuXHR(page, config.createEndpoint, payload, { maxRetries: 1 });
    }

    if (result.success) {
      console.error(`[api-create] SUCCESS! productId=${result.data?.productId}`);
      await saveCookies();
      return {
        success: true,
        message: "商品已创建并提交核价",
        productId: result.data?.productId,
        skcId: result.data?.productSkcList?.[0]?.productSkcId,
        skuId: result.data?.productSkuList?.[0]?.productSkuId,
        result: result.data,
      };
    } else {
      console.error(`[api-create] Failed: ${result.errorCode} - ${result.errorMsg}`);

      // 保存失败的 payload 用于调试
      const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
      fs.mkdirSync(debugDir, { recursive: true });
      const debugFile = path.join(debugDir, `failed_payload_${Date.now()}.json`);
      fs.writeFileSync(debugFile, JSON.stringify({ params: { title: params.title, price: params.price, categorySearch: params.categorySearch }, payload, response: result.raw }, null, 2));
      console.error(`[api-create] Debug payload saved to: ${debugFile}`);

      // 尝试保存到 Temu 草稿箱（用 draft/add 接口）
      let draftSaved = false;
      try {
        console.error(`[api-create] Saving to Temu drafts...`);
        const draftResult = await temuXHR(page, config.draftEndpoint, payload, { maxRetries: 1 });
        if (draftResult.success) {
          draftSaved = true;
          console.error(`[api-create] Saved to Temu drafts! draftId=${draftResult.data?.productId || draftResult.data?.draftId || "unknown"}`);
        } else {
          console.error(`[api-create] Temu draft save failed: ${draftResult.errorMsg}`);
        }
      } catch (e) {
        console.error(`[api-create] Temu draft save error: ${e.message}`);
      }

      return {
        success: false,
        message: draftSaved
          ? "核价失败，已保存到Temu草稿箱"
          : (result.errorMsg || "核价提交失败"),
        errorCode: result.errorCode,
        step: "submit",
        debugFile,
        draftSaved,
        uploadedImageUrls: imageUrls,
      };
    }

  } finally {
    if (!params.keepOpen) await page.close();
  }
}

/**
 * 批量 API 核价
 * @param {Object} params
 * @param {string} params.csvPath - CSV 文件路径
 * @param {number} [params.startRow=0] - 起始行号（0-based）
 * @param {number} [params.count=1] - 处理数量
 * @param {number} [params.intervalMin=0.5] - 最小间隔（分钟）
 * @param {number} [params.intervalMax=1] - 最大间隔（分钟）
 * @param {string[]} [params.defaultImageUrls] - 默认图片 URL 列表（CSV 中无图时使用）
 * @param {boolean} [params.generateAI=true] - 是否 AI 生成图片
 * @param {Object} [params.config] - 覆盖 PRICING_CONFIG
 *
 * CSV 列：商品名称, 商品原图, 分类（中文）, 美元价格
 * 也支持：imageUrls（多图，用 | 分隔）, 分类关键词
 */
async function batchCreateViaAPI(params) {
  console.error("[batch-api] Starting batch API creation...");
  const csvPath = params.csvPath;
  if (!csvPath || !fs.existsSync(csvPath)) {
    return { success: false, message: "CSV文件不存在: " + csvPath };
  }

  const csvContent = fs.readFileSync(csvPath, "utf8");
  const lines = csvContent.split("\n").filter(l => l.trim());
  const headers = lines[0];
  const startRow = params.startRow || 0;
  const count = params.count || 1;
  const intervalMin = params.intervalMin || 0.5;
  const intervalMax = params.intervalMax || 1;
  const results = [];

  // 解析CSV列（支持多种列名）
  const colIndex = (names) => {
    const cols = headers.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    for (const name of names) {
      const idx = cols.findIndex(c => c.includes(name));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const nameIdx = colIndex(["商品名称", "title", "productName", "name"]);
  const imageIdx = colIndex(["商品原图", "image", "imageUrl", "图片"]);
  const imagesIdx = colIndex(["imageUrls", "多图", "images"]); // 多图列（用 | 分隔）
  const catIdx = colIndex(["分类（中文）", "分类关键词", "category", "分类"]);
  const priceIdx = colIndex(["美元价格", "price", "价格", "USD"]);
  const priceCnyIdx = colIndex(["人民币价格", "priceCNY", "申报价"]);

  console.error(`[batch-api] Columns: name=${nameIdx}, image=${imageIdx}, images=${imagesIdx}, cat=${catIdx}, price=${priceIdx}, priceCNY=${priceCnyIdx}`);

  function parseCSVLine(line) {
    const result = [];
    let current = "", inQuotes = false;
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ""; }
      else current += ch;
    }
    result.push(current.trim());
    return result;
  }

  const total = Math.max(0, Math.min(count, lines.length - 1 - startRow));
  console.error(`[batch-api] Processing ${total} products (rows ${startRow}-${startRow + total - 1})`);

  for (let i = startRow; i < startRow + total; i++) {
    const cols = parseCSVLine(lines[i + 1]);
    const productName = (nameIdx >= 0 ? cols[nameIdx] : "") || "";
    const categoryCn = (catIdx >= 0 ? cols[catIdx] : "") || "";
    const priceUSD = priceIdx >= 0 ? parseFloat(cols[priceIdx]) || 0 : 0;
    const priceCNY = priceCnyIdx >= 0 ? parseFloat(cols[priceCnyIdx]) || 0 : (priceUSD > 0 ? priceUSD * 7 : 9.99);

    // 图片处理：优先多图列，否则单图列，最后用默认图
    let imageUrls = [];
    if (imagesIdx >= 0 && cols[imagesIdx]) {
      imageUrls = cols[imagesIdx].split("|").map(u => u.trim()).filter(Boolean);
    } else if (imageIdx >= 0 && cols[imageIdx]) {
      imageUrls = [cols[imageIdx].trim()];
    }

    // 如果只有 1 张或没有图，尝试用 AI 生成或用默认图补齐
    if (imageUrls.length === 0 && params.defaultImageUrls?.length > 0) {
      imageUrls = [...params.defaultImageUrls];
    }

    const itemNum = i - startRow + 1;
    console.error(`\n[batch-api] === ${itemNum}/${total}: ${productName.slice(0, 40)} ¥${priceCNY.toFixed(2)} imgs=${imageUrls.length} ===`);

    // 如果只有外部图片 URL（非 kwcdn），需要下载后用 AI 生成
    let sourceImage = null;
    if (imageUrls.length > 0 && !imageUrls[0].includes("kwcdn.com") && imageUrls[0].startsWith("http")) {
      try {
        const imgResp = await fetch(imageUrls[0]);
        const imgBuf = Buffer.from(await imgResp.arrayBuffer());
        const imgDir = path.join(process.env.APPDATA || "", "temu-automation", "ai-images");
        fs.mkdirSync(imgDir, { recursive: true });
        sourceImage = path.join(imgDir, `csv_${i}_${Date.now()}.jpg`);
        fs.writeFileSync(sourceImage, imgBuf);
        imageUrls = []; // 清空，让 createProductViaAPI 用 AI 生成
        console.error(`[batch-api] Source image downloaded for AI generation`);
      } catch (e) {
        console.error(`[batch-api] Image download failed: ${e.message}`);
      }
    }

    try {
      const createParams = {
        title: productName,
        price: priceCNY,
        categorySearch: categoryCn || productName, // 用分类名或标题搜索
        keepOpen: false,
        config: params.config,
      };

      // 图片来源：已有 kwcdn URLs 或 AI 生成
      if (imageUrls.length > 0) {
        createParams.imageUrls = imageUrls;
      } else if (sourceImage) {
        createParams.sourceImage = sourceImage;
        createParams.generateAI = params.generateAI !== false;
        createParams.aiImageTypes = params.aiImageTypes || ["hero", "lifestyle", "closeup", "infographic", "size_chart"];
      } else if (params.defaultImageUrls?.length > 0) {
        createParams.imageUrls = params.defaultImageUrls;
      } else {
        results.push({ index: i, name: productName.slice(0, 40), success: false, message: "无可用图片" });
        console.error(`[batch-api] SKIP: no images available`);
        continue;
      }

      let result = await createProductViaAPI(createParams);

      // 失败自动重试（不重新生成图片，复用已上传的图片）
      if (!result.success && result.errorCode === 6000002) {
        console.error(`[batch-api] RETRY: 6000002 error, retrying with same images...`);
        await randomDelay(2000, 3000);

        // 重试时用已有图片URL，不重新生成AI图
        const retryParams = { ...createParams };
        if (result.uploadedImageUrls?.length > 0) {
          retryParams.imageUrls = result.uploadedImageUrls;
          delete retryParams.sourceImage;
          delete retryParams.generateAI;
        }
        result = await createProductViaAPI(retryParams);
        if (!result.success) {
          console.error(`[batch-api] RETRY 2: trying different category...`);
          await randomDelay(1000, 2000);
          // 第二次重试：用商品标题搜索分类
          const retryParams2 = { ...retryParams, categorySearch: productName.slice(0, 20) };
          result = await createProductViaAPI(retryParams2);
        }
      }

      results.push({ index: i, name: productName.slice(0, 40), productId: result.productId, ...result });
      console.error(`[batch-api] ${result.success ? "OK productId=" + result.productId : "FAIL: " + result.message}`);
    } catch (e) {
      results.push({ index: i, name: productName.slice(0, 40), success: false, message: e.message });
      console.error(`[batch-api] ERROR: ${e.message}`);
    }

    // 间隔控制
    if (itemNum < total) {
      const waitMin = intervalMin + Math.random() * (intervalMax - intervalMin);
      console.error(`[batch-api] Progress: ${itemNum}/${total} (${results.filter(r => r.success).length} ok). Next in ${waitMin.toFixed(1)}min...`);
      await new Promise(r => setTimeout(r, waitMin * 60000));
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failedItems = results.filter(r => !r.success);
  console.error(`\n[batch-api] Completed: ${successCount}/${results.length} succeeded`);

  // 保存结果
  const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  fs.mkdirSync(debugDir, { recursive: true });
  const resultFile = path.join(debugDir, `batch_result_${Date.now()}.json`);
  fs.writeFileSync(resultFile, JSON.stringify({ total: results.length, successCount, failCount: failedItems.length, results }, null, 2));
  console.error(`[batch-api] Results saved to: ${resultFile}`);

  return { success: true, total: results.length, successCount, failCount: failedItems.length, results, failedItems, resultFile };
}

// 全局进度追踪
function getProgressTimestamp() {
  return new Date().toLocaleString("zh-CN");
}

function summarizeProgressResults(results) {
  const list = Array.isArray(results) ? results : [];
  const successCount = list.filter((item) => item?.success).length;
  return {
    successCount,
    failCount: list.length - successCount,
  };
}

function createProgressState(patch = {}) {
  const results = Array.isArray(patch.results) ? [...patch.results] : [];
  const summary = summarizeProgressResults(results);
  return {
    taskId: typeof patch.taskId === "string" ? patch.taskId : "",
    running: Boolean(patch.running),
    paused: Boolean(patch.paused),
    status: typeof patch.status === "string" ? patch.status : "idle",
    total: Number(patch.total) || 0,
    completed: Number(patch.completed) || 0,
    current: typeof patch.current === "string" ? patch.current : "",
    step: typeof patch.step === "string" ? patch.step : "",
    results,
    successCount: summary.successCount,
    failCount: summary.failCount,
    message: typeof patch.message === "string" ? patch.message : "",
    csvPath: typeof patch.csvPath === "string" ? patch.csvPath : "",
    startRow: Number(patch.startRow) || 0,
    count: Number(patch.count) || 0,
    createdAt: typeof patch.createdAt === "string" ? patch.createdAt : "",
    startedAt: typeof patch.startedAt === "string" ? patch.startedAt : "",
    updatedAt: typeof patch.updatedAt === "string" ? patch.updatedAt : "",
    finishedAt: typeof patch.finishedAt === "string" ? patch.finishedAt : "",
  };
}

const PROGRESS_HISTORY_LIMIT = 10;
let currentProgress = createProgressState();
let progressHistory = [];
let pricingPaused = false;  // 暂停标志

function shouldTrackProgressSnapshot(task) {
  return Boolean(
    task?.taskId
    || task?.running
    || task?.paused
    || task?.completed
    || (Array.isArray(task?.results) && task.results.length > 0)
    || (typeof task?.status === "string" && task.status !== "idle")
  );
}

function rememberProgressSnapshot(task) {
  if (!shouldTrackProgressSnapshot(task)) return;
  const snapshot = createProgressState(task);
  progressHistory = [
    snapshot,
    ...progressHistory.filter((item) => item?.taskId !== snapshot.taskId),
  ].slice(0, PROGRESS_HISTORY_LIMIT);
}

function replaceCurrentProgress(patch = {}) {
  currentProgress = createProgressState(patch);
  rememberProgressSnapshot(currentProgress);
  return currentProgress;
}

function getProgressSnapshot(taskId) {
  if (taskId) {
    if (currentProgress.taskId === taskId) return currentProgress;
    return progressHistory.find((item) => item?.taskId === taskId) || createProgressState({ taskId });
  }
  return currentProgress;
}

function listProgressSnapshots() {
  if (!shouldTrackProgressSnapshot(currentProgress)) {
    return [...progressHistory];
  }
  return [
    currentProgress,
    ...progressHistory.filter((item) => item?.taskId !== currentProgress.taskId),
  ].slice(0, PROGRESS_HISTORY_LIMIT);
}

function updateCurrentProgress(patch = {}) {
  const nextResults = Array.isArray(patch.results) ? [...patch.results] : currentProgress.results;
  const summary = summarizeProgressResults(nextResults);
  currentProgress = {
    ...currentProgress,
    ...patch,
    results: nextResults,
    successCount: summary.successCount,
    failCount: summary.failCount,
    updatedAt: typeof patch.updatedAt === "string" ? patch.updatedAt : getProgressTimestamp(),
  };
  rememberProgressSnapshot(currentProgress);
  return currentProgress;
}

function syncCurrentProgressResults(results, patch = {}) {
  return updateCurrentProgress({
    ...patch,
    completed: Array.isArray(results) ? results.length : currentProgress.completed,
    results: Array.isArray(results) ? [...results] : currentProgress.results,
  });
}

function isCurrentProgressTask(taskId) {
  return !taskId || !currentProgress.taskId || currentProgress.taskId === taskId;
}

const server = http.createServer(async (req, res) => {
  // GET /progress - 实时进度查询
  if (req.method === "GET") {
    const requestUrl = new URL(req.url, "http://127.0.0.1");
    if (requestUrl.pathname === "/progress") {
      const taskId = requestUrl.searchParams.get("taskId");
      const snapshot = getProgressSnapshot(taskId);
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(snapshot));
      return;
    }
    if (requestUrl.pathname === "/tasks") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(listProgressSnapshots()));
      return;
    }
  }

  if (req.method !== "POST") { res.writeHead(404); res.end(); return; }

  const chunks = [];
  req.on("error", (err) => { console.error("[Worker] Request error:", err.message); });
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const startTime = Date.now();
    let action = "unknown";
    try {
      const body = Buffer.concat(chunks).toString("utf8");
      const cmd = JSON.parse(body);
      action = cmd.action || "unknown";
      const result = await handleRequest(cmd);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`[Worker] ${action} completed in ${duration}s`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "result", data: result }));
    } catch (err) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const errCode = err.code || ERR.UNKNOWN;
      console.error(`[Worker] ${action} FAILED in ${duration}s: [${errCode}] ${err.message}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", code: errCode, message: err.message || String(err), action, duration: parseFloat(duration) }));
    }
  });
});

const PORT = parseInt(process.env.WORKER_PORT || "19280");
server.timeout = 86400000; // 24小时超时
server.keepAliveTimeout = 86400000;
server.headersTimeout = 86410000;
server.listen(PORT, "127.0.0.1", () => {
  // 把端口写到文件
  const portFile = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "worker-port");
  fs.mkdirSync(path.dirname(portFile), { recursive: true });
  fs.writeFileSync(portFile, String(PORT));
  console.error(`WORKER_PORT=${PORT}`);
  console.log(`Worker ready on port ${PORT}`);
});

process.on("SIGTERM", async () => { await closeBrowser(); server.close(); process.exit(0); });
process.on("uncaughtException", (err) => { console.error("[Worker] Uncaught exception:", err.message, err.stack); });
process.on("unhandledRejection", (reason) => { console.error("[Worker] Unhandled rejection:", reason); });
