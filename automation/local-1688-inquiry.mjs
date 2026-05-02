import fs from "fs";
import path from "path";
import { ensure1688Context, openOrReuse1688Page, resolve1688ProfilePath } from "./aliexpress-1688-cost.mjs";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MESSAGE = "商品包装方式是什么？商品需要提供哪些资质文件？可以优惠吗？整箱包装尺寸和重量是多少？下单需要注意什么？";
const INQUIRY_ENTRY_TEXTS = [
  "批量询盘",
  "发起询盘",
  "立即询盘",
  "我要询价",
  "立即询价",
  "询盘",
  "联系供应商",
  "旺旺咨询",
  "联系客服",
];
const INQUIRY_SUBMIT_TEXTS = [
  "发起询盘",
  "发送询盘",
  "提交询盘",
  "立即发送",
  "发送",
  "提交",
  "确定",
  "确认",
];
const LOGIN_TEXT_RE = /请登录|扫码登录|密码登录|登录后|login\.1688\.com/i;
const SUCCESS_TEXT_RE = /询盘成功|询盘已发送|发送成功|提交成功|已发送|商家.*回复|我们将代询商家/i;
const FAILURE_TEXT_RE = /发送失败|提交失败|询盘失败|网络异常|系统繁忙|稍后再试|参数错误|请选择|不能为空/i;

function getRuntimeDataDir() {
  return process.env.APP_USER_DATA
    || path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation");
}

function safeText(value, fallback = "") {
  const text = value == null ? "" : String(value).trim();
  return text || fallback;
}

function compactText(value, max = 240) {
  const text = safeText(value).replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function firstText(...values) {
  return values.map((item) => safeText(item)).find(Boolean) || "";
}

function normalizeOfferId(candidate = {}) {
  const direct = firstText(candidate.offerId, candidate.externalOfferId, candidate.external_offer_id);
  if (/^\d{8,}$/.test(direct)) return direct;
  const url = firstText(candidate.productUrl, candidate.product_url, candidate.url);
  const match = url.match(/(?:offer|item)\/(\d{8,})/i) || url.match(/[?&](?:offerId|id)=(\d{8,})/i);
  return match ? match[1] : direct;
}

function buildProductUrl(candidate = {}) {
  const explicit = firstText(candidate.productUrl, candidate.product_url, candidate.url);
  if (/^https?:\/\//i.test(explicit)) return explicit;
  const offerId = normalizeOfferId(candidate);
  if (/^\d{8,}$/.test(offerId)) {
    return `https://detail.1688.com/offer/${offerId}.html`;
  }
  return "";
}

function getCandidateId(candidate = {}) {
  return firstText(candidate.candidateId, candidate.id, candidate.candidate_id, candidate.externalOfferId);
}

function ensureDebugDir(taskId) {
  const debugDir = path.join(getRuntimeDataDir(), "debug", "local-1688-inquiry", safeText(taskId, `task_${Date.now()}`));
  fs.mkdirSync(debugDir, { recursive: true });
  return debugDir;
}

async function getPageText(page) {
  return await page.evaluate(() => document.body?.innerText || "").catch(() => "");
}

async function pageLooksLoggedOut(page) {
  const url = page.url() || "";
  if (/login\.1688\.com|passport\.1688\.com|login\.taobao\.com/i.test(url)) return true;
  const text = await getPageText(page);
  return LOGIN_TEXT_RE.test(`${url}\n${text}`);
}

async function screenshotFailure(page, debugDir, candidateId, suffix) {
  if (!page || !debugDir) return "";
  try {
    const file = path.join(debugDir, `${safeText(candidateId, "candidate").replace(/[^\w.-]+/g, "_")}_${suffix}.png`);
    await page.screenshot({ path: file, fullPage: true, timeout: 10_000 });
    return file;
  } catch {
    return "";
  }
}

async function waitAfterAction(page, timeoutMs = 1200) {
  await page.waitForTimeout(timeoutMs).catch(() => {});
}

async function clickLocator(locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
  try {
    await locator.click({ timeout: 2500 });
    return true;
  } catch {
    try {
      await locator.evaluate((element) => {
        const target = element.closest("button,a,[role='button'],[class*='button'],[class*='btn']") || element;
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      });
      return true;
    } catch {
      return false;
    }
  }
}

async function clickFirstVisibleByText(page, texts, options = {}) {
  const root = options.root || page;
  const selector = [
    "button",
    "a",
    "[role='button']",
    "[class*='button']",
    "[class*='Button']",
    "[class*='btn']",
    "[class*='Btn']",
    "[class*='contact']",
    "[class*='inquiry']",
    "span",
  ].join(",");
  for (const text of texts) {
    const locator = root.locator(selector).filter({ hasText: text });
    const count = Math.min(await locator.count().catch(() => 0), 30);
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      const visible = await item.isVisible({ timeout: 800 }).catch(() => false);
      if (!visible) continue;
      const box = await item.boundingBox().catch(() => null);
      if (!box || box.width < 4 || box.height < 4) continue;
      if (await clickLocator(item)) {
        return { clicked: true, text };
      }
    }
  }
  return { clicked: false, text: "" };
}

async function maybeSwitchToNewestPage(context, page, beforePageCount) {
  await waitAfterAction(page, 800);
  const pages = context.pages();
  if (pages.length > beforePageCount) {
    const nextPage = pages[pages.length - 1];
    await nextPage.bringToFront().catch(() => {});
    await nextPage.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
    return nextPage;
  }
  return page;
}

async function fillInquiryMessage(page, message) {
  const selectors = [
    "textarea",
    "input[placeholder*='询']",
    "input[placeholder*='需求']",
    "input[placeholder*='留言']",
    "input[placeholder*='内容']",
    "[contenteditable='true']",
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 20);
    for (let index = count - 1; index >= 0; index -= 1) {
      const item = locator.nth(index);
      const visible = await item.isVisible({ timeout: 800 }).catch(() => false);
      if (!visible) continue;
      try {
        if (selector.includes("contenteditable")) {
          await item.evaluate((element, value) => {
            element.focus();
            element.textContent = value;
            element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
          }, message);
        } else {
          await item.fill(message, { timeout: 2500 });
        }
        return true;
      } catch {
        try {
          await item.click({ timeout: 1000 });
          await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
          await page.keyboard.type(message, { delay: 5 });
          return true;
        } catch {}
      }
    }
  }
  return false;
}

async function detectFailureReason(page) {
  const text = await getPageText(page);
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const matched = lines.find((line) => FAILURE_TEXT_RE.test(line));
  return matched ? compactText(matched) : "";
}

async function runInquiryForCandidate({ context, page, candidate, message, debugDir, timeoutMs }) {
  const candidateId = getCandidateId(candidate);
  const offerId = normalizeOfferId(candidate);
  const productUrl = buildProductUrl(candidate);
  const startedAt = new Date().toISOString();

  if (!candidateId) {
    return { status: "failed", candidateId: "", offerId, productUrl, startedAt, failureReason: "候选商品缺少 candidateId" };
  }
  if (!productUrl) {
    return { status: "failed", candidateId, offerId, productUrl, startedAt, failureReason: "候选商品缺少 1688 链接或 offerId" };
  }

  let activePage = page;
  try {
    await activePage.goto(productUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await activePage.bringToFront().catch(() => {});
    await activePage.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});

    if (await pageLooksLoggedOut(activePage)) {
      return {
        status: "failed",
        loginRequired: true,
        candidateId,
        offerId,
        productUrl,
        startedAt,
        failureReason: "1688 未登录，请先在弹出的 1688 浏览器完成登录后重试",
        screenshotFile: await screenshotFailure(activePage, debugDir, candidateId, "login"),
      };
    }

    const beforePageCount = context.pages().length;
    const entry = await clickFirstVisibleByText(activePage, INQUIRY_ENTRY_TEXTS);
    if (!entry.clicked) {
      return {
        status: "failed",
        candidateId,
        offerId,
        productUrl,
        startedAt,
        failureReason: "未找到 1688 询盘或联系供应商入口",
        screenshotFile: await screenshotFailure(activePage, debugDir, candidateId, "no_entry"),
      };
    }

    activePage = await maybeSwitchToNewestPage(context, activePage, beforePageCount);
    if (await pageLooksLoggedOut(activePage)) {
      return {
        status: "failed",
        loginRequired: true,
        candidateId,
        offerId,
        productUrl,
        startedAt,
        failureReason: "点击询盘后进入登录页，请先完成 1688 登录",
        screenshotFile: await screenshotFailure(activePage, debugDir, candidateId, "login_after_click"),
      };
    }

    const filled = await fillInquiryMessage(activePage, message);
    if (!filled) {
      return {
        status: "failed",
        candidateId,
        offerId,
        productUrl,
        startedAt,
        failureReason: "未找到询盘内容输入框，可能 1688 页面结构已变化",
        screenshotFile: await screenshotFailure(activePage, debugDir, candidateId, "no_input"),
      };
    }

    const submit = await clickFirstVisibleByText(activePage, INQUIRY_SUBMIT_TEXTS);
    if (!submit.clicked) {
      return {
        status: "failed",
        candidateId,
        offerId,
        productUrl,
        startedAt,
        failureReason: "未找到询盘提交按钮",
        screenshotFile: await screenshotFailure(activePage, debugDir, candidateId, "no_submit"),
      };
    }

    await waitAfterAction(activePage, 2500);
    const bodyText = await getPageText(activePage);
    const failureReason = await detectFailureReason(activePage);
    if (failureReason && !SUCCESS_TEXT_RE.test(bodyText)) {
      return {
        status: "failed",
        candidateId,
        offerId,
        productUrl,
        startedAt,
        failureReason,
        screenshotFile: await screenshotFailure(activePage, debugDir, candidateId, "submit_failed"),
      };
    }

    const sentAt = new Date().toISOString();
    return {
      status: "sent",
      candidateId,
      offerId,
      productUrl,
      startedAt,
      sentAt,
      taskId: `local1688_${Date.now()}_${candidateId}`,
      entryText: entry.text,
      submitText: submit.text,
      confirmation: SUCCESS_TEXT_RE.test(bodyText) ? "页面返回成功提示" : "已点击提交按钮，页面未返回失败提示",
    };
  } catch (error) {
    const messageText = safeText(error?.message || error, "本地 1688 浏览器询盘失败");
    return {
      status: "failed",
      candidateId,
      offerId,
      productUrl,
      startedAt,
      failureReason: compactText(messageText, 500),
      screenshotFile: await screenshotFailure(activePage, debugDir, candidateId, "error"),
    };
  }
}

export async function runLocal1688Inquiry(params = {}) {
  const candidates = Array.isArray(params.candidates) ? params.candidates.filter(Boolean) : [];
  if (!candidates.length) {
    throw new Error("local_1688_inquiry requires candidates");
  }

  const timeoutMs = Number(params.timeoutMs) > 0 ? Number(params.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const message = safeText(params.inquiryMessage || params.message || params.inquiryTemplate, DEFAULT_MESSAGE).slice(0, 1000);
  const taskId = safeText(params.taskId, `local_1688_inquiry_${Date.now()}`);
  const debugDir = ensureDebugDir(taskId);
  const profilePath = resolve1688ProfilePath(params.profilePath);
  const context = await ensure1688Context({ profilePath });
  let page = await openOrReuse1688Page(context, "https://www.1688.com/");
  await page.bringToFront().catch(() => {});

  const results = [];
  for (const candidate of candidates) {
    const result = await runInquiryForCandidate({ context, page, candidate, message, debugDir, timeoutMs });
    results.push(result);
    const pages = context.pages();
    page = pages.find((item) => item.url().includes("1688.com")) || page;
    if (result.loginRequired) break;
    await waitAfterAction(page, 800);
  }

  const sentCount = results.filter((item) => item.status === "sent").length;
  const failedCount = results.filter((item) => item.status !== "sent").length;
  const loginRequired = results.some((item) => item.loginRequired);
  return {
    ok: sentCount > 0 && !loginRequired,
    mode: "local_1688_browser",
    taskId,
    profilePath,
    debugDir,
    total: candidates.length,
    sentCount,
    failedCount,
    loginRequired,
    results,
  };
}
