import { chromium } from "playwright";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { findChromeExe } from "./browser.mjs";

const SEARCH_URL_TEMPLATE = (imageUrl) =>
  `https://air.1688.com/app/channel-fe/search/index.html#/result?image_list=${encodeURIComponent(imageUrl)}`;

const LOGIN_URL = "https://login.1688.com/member/signin.htm";
const DEFAULT_SAMPLE_SIZE = 30;
const DEFAULT_TIMEOUT_MS = 30_000;

const CARD_SELECTOR_CANDIDATES = [
  '[class*="offer-card"]',
  '[class*="offer-item"]',
  '[class*="product-card"]',
  '[data-spm*="offer"]',
];

const PRICE_SELECTOR_CANDIDATES = [
  '[class*="offer-price"]',
  '[class*="price-num"]',
  '[class*="_price"]',
  '[class*="price"]',
];

const EMPTY_TEXT_CANDIDATES = [
  "暂未找到您想要的结果",
  "为您找到0个结果",
];

const browserState1688 = {
  context: null,
  profilePath: "",
  launchPromise: null,
};

function getDefault1688ProfilePath() {
  const baseDir = process.env.APP_USER_DATA
    || path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation");
  return path.join(baseDir, "profiles", "1688");
}

export function resolve1688ProfilePath(profilePath) {
  return path.resolve(profilePath || getDefault1688ProfilePath());
}

function extractPriceFromText(txt) {
  if (!txt) return null;
  const value = String(txt).replace(/[,\s]/g, "");
  const tagged = value.match(/([0-9]+(?:\.[0-9]+)?)(?=元|￥|¥)/);
  if (tagged) return Number(tagged[1]);

  const loose = value.match(/([0-9]+(?:\.[0-9]+)?)/);
  return loose ? Number(loose[1]) : null;
}

function robustMedian(nums) {
  const sorted = nums.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length < 5) return sorted[Math.floor(sorted.length / 2)];
  const trim = Math.floor(sorted.length * 0.1);
  const trimmed = sorted.slice(trim, sorted.length - trim);
  return trimmed[Math.floor(trimmed.length / 2)];
}

export async function ensure1688Context(opts = {}) {
  const targetProfilePath = resolve1688ProfilePath(opts.profilePath);

  if (browserState1688.context && browserState1688.profilePath === targetProfilePath) {
    return browserState1688.context;
  }

  if (browserState1688.launchPromise) {
    await browserState1688.launchPromise;
    if (browserState1688.context && browserState1688.profilePath === targetProfilePath) {
      return browserState1688.context;
    }
  }

  browserState1688.launchPromise = (async () => {
    if (browserState1688.context && browserState1688.profilePath !== targetProfilePath) {
      await browserState1688.context.close().catch(() => {});
      browserState1688.context = null;
      browserState1688.profilePath = "";
    }

    fs.mkdirSync(targetProfilePath, { recursive: true });
    const executablePath = findChromeExe();
    const context = await chromium.launchPersistentContext(targetProfilePath, {
      executablePath,
      headless: false,
      viewport: null,
      locale: "zh-CN",
      ignoreHTTPSErrors: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--start-maximized",
      ],
    });

    browserState1688.context = context;
    browserState1688.profilePath = targetProfilePath;

    context.on("close", () => {
      if (browserState1688.context === context) {
        browserState1688.context = null;
        browserState1688.profilePath = "";
      }
    });

    return context;
  })().finally(() => {
    browserState1688.launchPromise = null;
  });

  return browserState1688.launchPromise;
}

export async function openOrReuse1688Page(context, url) {
  const existing = (context.pages() || []).find((page) => {
    const currentUrl = page.url() || "";
    return currentUrl.includes("1688.com") || currentUrl === "about:blank";
  });

  const page = existing || await context.newPage();
  await page.bringToFront().catch(() => {});

  if (!page.url() || page.url() === "about:blank" || url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
  }

  return page;
}

export async function fetch1688CostByImage(imageUrl, opts = {}) {
  if (!imageUrl || typeof imageUrl !== "string") {
    return { cost: null, source: null, samples: [], error: "imageUrl required" };
  }

  const sampleSize = Math.max(5, Math.min(200, opts.sampleSize || DEFAULT_SAMPLE_SIZE));
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const minSamples = Math.max(1, opts.minSamples || 3);

  let page;
  try {
    const context = await ensure1688Context(opts);
    const url = SEARCH_URL_TEMPLATE(imageUrl);
    page = await openOrReuse1688Page(context, url);

    const cardSelector = CARD_SELECTOR_CANDIDATES.join(",");
    const deadline = Date.now() + timeoutMs;
    let cards = [];

    while (Date.now() < deadline) {
      const bodyText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
      const joinedText = `${bodyText}\n${page.url() || ""}`;

      if (EMPTY_TEXT_CANDIDATES.some((text) => bodyText.includes(text))) {
        return { cost: null, source: null, samples: [], error: "1688 无搜索结果" };
      }

      if (/login\.1688\.com|请登录|立即登录|扫码登录/i.test(joinedText)) {
        return { cost: null, source: null, samples: [], error: "1688 未登录，请先点击“1688 登录”完成登录" };
      }

      cards = await page.$$(cardSelector).catch(() => []);
      if (cards.length > 0) break;
      await page.waitForTimeout(500);
    }

    if (cards.length === 0) {
      return { cost: null, source: null, samples: [], error: "未定位到 1688 商品卡片，请更新选择器" };
    }

    const priceSelector = PRICE_SELECTOR_CANDIDATES.join(",");
    const samples = [];

    for (const card of cards.slice(0, sampleSize)) {
      const priceText = await card
        .$(priceSelector)
        .then((el) => (el ? el.innerText() : null))
        .catch(() => null);
      const price = extractPriceFromText(priceText);
      if (price != null) samples.push({ price });
    }

    if (samples.length < minSamples) {
      return { cost: null, source: null, samples, error: `样本不足 (${samples.length}<${minSamples})` };
    }

    const cost = robustMedian(samples.map((item) => item.price));
    return {
      cost: cost != null ? Number(cost.toFixed(2)) : null,
      source: "1688_image_search",
      samples: samples.slice(0, 10),
    };
  } catch (error) {
    return { cost: null, source: null, samples: [], error: String(error?.message || error) };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

// 用 Playwright 真 Chrome（带用户 1688 登录态）打开 1688 自家的「图搜款」页面，
// 抓 XHR / DOM 拿候选商品列表。
//
// 这条路是 1688 mtop 反爬的根因解 ——
//   - 主控端云 IP 在 cloud_ip_bl 里，裸 fetch search.1688.com 直接被 deny
//   - 客户端某些用户家用 IP 也被 1688 标黑（rgv587_flag/deny_h5/punish）
//   - 但**真 Chrome + 用户登录态 cookies + 真实 fingerprint** 跟正常用户访问一样能过
//     即使偶尔弹滑块，用户能在已经打开的浏览器窗口里手动过一下
//
// 相比 fetch1688CostByImage（只取价格中位数），这个函数返回完整 offer 列表（offerId/title/
// imageUrl/productUrl/price/supplier/sales），用于「以图搜款」候选导入。
export async function search1688OffersByImage(imageUrl, opts = {}) {
  if (!imageUrl || typeof imageUrl !== "string") {
    return { ok: false, offers: [], error: "imageUrl required" };
  }

  const limit = Math.max(1, Math.min(50, opts.limit || 20));
  const timeoutMs = opts.timeoutMs || 45_000;

  let page = null;
  let xhrOffers = null;
  try {
    const context = await ensure1688Context(opts);
    const url = SEARCH_URL_TEMPLATE(imageUrl);
    page = await openOrReuse1688Page(context, "about:blank");

    // 拦截 1688 air 频道的图搜 XHR，结构最稳，比 DOM 选择器靠谱。
    // 命中关键字之一即视为图搜返回。
    const responsePromise = page.waitForResponse(
      (res) => {
        const u = res.url() || "";
        if (!/1688\.com/.test(u)) return false;
        return /imageSearch|imgSearch|offerListByImage|offer_list|product_list/i.test(u);
      },
      { timeout: timeoutMs },
    ).then(async (res) => {
      try {
        const json = await res.json();
        return { url: res.url(), json };
      } catch {
        return null;
      }
    }).catch(() => null);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs }).catch(() => {});

    // 给 1688 前端一点时间撞反爬：如果命中 punish 滑块，URL 会跳到 /punish 或类似
    const deadline = Date.now() + timeoutMs;
    let captcha = false;
    let needsLogin = false;
    while (Date.now() < deadline) {
      const currentUrl = page.url() || "";
      if (/punish|tmd|x5secdata/i.test(currentUrl)) {
        captcha = true;
        break;
      }
      if (/login\.1688\.com|signin/i.test(currentUrl)) {
        needsLogin = true;
        break;
      }
      const bodyText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
      if (bodyText && (bodyText.includes("人机校验") || bodyText.includes("拖动滑块") || bodyText.includes("拼图验证"))) {
        captcha = true;
        break;
      }
      if (bodyText && (bodyText.includes("请登录") || bodyText.includes("立即登录") || bodyText.includes("扫码登录"))) {
        needsLogin = true;
        break;
      }
      // 找到候选卡片就跳出
      const cardCount = await page.evaluate(() => {
        const sels = [
          '[class*="offer-card"]',
          '[class*="offer-item"]',
          '[class*="product-card"]',
          '[data-offer-id]',
        ];
        let total = 0;
        for (const s of sels) total += document.querySelectorAll(s).length;
        return total;
      }).catch(() => 0);
      if (cardCount > 0) break;
      await page.waitForTimeout(500);
    }

    if (captcha) {
      return {
        ok: false,
        offers: [],
        captcha: true,
        error: "1688 弹出人机校验。请在弹出的浏览器窗口里手动过一下滑块/拼图，然后重新点「以图搜款」。",
      };
    }
    if (needsLogin) {
      return {
        ok: false,
        offers: [],
        needsLogin: true,
        error: "1688 未登录。请先点「1688 登录」完成登录后重试。",
      };
    }

    // 1) 尝试用 XHR 拦下来的结构化数据
    const xhr = await Promise.race([
      responsePromise,
      page.waitForTimeout(2000).then(() => null),
    ]);
    if (xhr?.json) {
      xhrOffers = extractOffersFromAirJson(xhr.json);
    }
    if (xhrOffers && xhrOffers.length) {
      return {
        ok: true,
        source: "1688_air_image_xhr",
        offers: xhrOffers.slice(0, limit),
      };
    }

    // 2) DOM 兜底
    const domOffers = await page.evaluate(({ max }) => {
      function pickAttr(el, names) {
        for (const n of names) {
          const v = el.getAttribute && el.getAttribute(n);
          if (v) return v;
        }
        return "";
      }
      function findAncestorOfferUrl(card) {
        const a = card.querySelector('a[href*="detail.1688.com/offer/"], a[href*="1688.com/offer"]');
        return a ? a.getAttribute("href") : "";
      }
      const cards = Array.from(document.querySelectorAll([
        '[class*="offer-card"]',
        '[class*="offer-item"]',
        '[class*="product-card"]',
        '[data-offer-id]',
      ].join(",")));
      const out = [];
      const seen = new Set();
      for (const card of cards) {
        if (out.length >= max) break;
        let offerId = pickAttr(card, ["data-offer-id", "data-offerid"])
          || (findAncestorOfferUrl(card).match(/offer\/(\d+)\.html/) || [])[1]
          || "";
        if (!offerId) continue;
        if (seen.has(offerId)) continue;
        seen.add(offerId);
        const productUrl = findAncestorOfferUrl(card)
          || `https://detail.1688.com/offer/${offerId}.html`;
        const title = (card.querySelector('[class*="title"], [class*="subject"], h3, h4')?.textContent || "").trim().replace(/\s+/g, " ");
        const img = card.querySelector('img');
        const imageUrl = img ? (img.getAttribute("data-src") || img.src || "") : "";
        const priceText = (card.querySelector('[class*="offer-price"], [class*="price-num"], [class*="_price"], [class*="price"]')?.textContent || "").trim();
        const priceMatch = priceText.replace(/[,\s¥￥元]/g, "").match(/([0-9]+(?:\.[0-9]+)?)/);
        const unitPrice = priceMatch ? Number(priceMatch[1]) : 0;
        const supplierName = (card.querySelector('[class*="supplier"], [class*="company"], a[href*="winport"]')?.textContent || "").trim();
        const soldText = (card.querySelector('[class*="sold"], [class*="sale"], [class*="trade"]')?.textContent || "").match(/([0-9.]+)\s*[万kK万]?\+?/);
        let soldOut = null;
        if (soldText) {
          let n = parseFloat(soldText[1]);
          if (/万/.test(soldText[0])) n *= 10000;
          if (/[kK]/.test(soldText[0])) n *= 1000;
          if (Number.isFinite(n)) soldOut = Math.round(n);
        }
        out.push({
          externalOfferId: String(offerId),
          externalSkuId: null,
          externalSpecId: null,
          supplierName: supplierName || "1688 Supplier",
          productTitle: title || `1688 商品 ${offerId}`,
          productUrl: productUrl.startsWith("//") ? `https:${productUrl}` : productUrl,
          imageUrl: imageUrl.startsWith("//") ? `https:${imageUrl}` : imageUrl,
          unitPrice,
          moq: 1,
          leadDays: null,
          logisticsFee: 0,
          remark: null,
          soldOut,
          sales: soldOut,
        });
      }
      return out;
    }, { max: limit }).catch(() => []);

    if (domOffers.length) {
      return { ok: true, source: "1688_air_image_dom", offers: domOffers };
    }

    return { ok: false, offers: [], error: "1688 air 图搜页加载完毕但没找到候选卡片" };
  } catch (error) {
    return { ok: false, offers: [], error: String(error?.message || error) };
  } finally {
    if (page) {
      // 故意不 close，留给用户复用同一个 tab；下一次 openOrReuse1688Page 会复用。
    }
  }
}

function extractOffersFromAirJson(json) {
  if (!json || typeof json !== "object") return [];
  // air 频道返回结构经常变；这里宽松地走遍所有数组找看起来像 offer 列表的字段
  const queue = [json];
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      // 看第一个元素长得像不像 offer
      const first = cur.find((x) => x && typeof x === "object");
      if (first && (first.offerId || first.productId || first.id) && (first.subject || first.title || first.productTitle)) {
        return cur.map(normalizeAirOffer).filter((x) => x && x.externalOfferId);
      }
      for (const item of cur) queue.push(item);
      continue;
    }
    for (const key of Object.keys(cur)) queue.push(cur[key]);
  }
  return [];
}

function normalizeAirOffer(offer) {
  if (!offer || typeof offer !== "object") return null;
  const offerId = offer.offerId || offer.productId || offer.id;
  if (!offerId) return null;
  const productTitle = offer.subject || offer.title || offer.productTitle || "";
  const imageUrl = offer.imageUrl || offer.image || offer.imgUrl || offer.picUrl || (Array.isArray(offer.imageUrls) ? offer.imageUrls[0] : "");
  const productUrl = offer.detailUrl || offer.productUrl || `https://detail.1688.com/offer/${offerId}.html`;
  let unitPrice = 0;
  if (offer.price && Number.isFinite(Number(offer.price))) unitPrice = Number(offer.price);
  else if (offer.priceInfo?.price) unitPrice = Number(offer.priceInfo.price) || 0;
  else if (offer.priceRange?.min) unitPrice = Number(offer.priceRange.min) || 0;
  const supplierName = offer.supplierName || offer.companyName || offer.company?.name || "1688 Supplier";
  const soldOut = offer.soldOut || offer.sales || offer.salesVolume || offer.tradeQuantity || offer.monthSold || null;
  return {
    externalOfferId: String(offerId),
    externalSkuId: null,
    externalSpecId: null,
    supplierName,
    productTitle,
    productUrl: typeof productUrl === "string" ? productUrl : `https://detail.1688.com/offer/${offerId}.html`,
    imageUrl: imageUrl ? (String(imageUrl).startsWith("//") ? `https:${imageUrl}` : String(imageUrl)) : "",
    unitPrice,
    moq: offer.moq || offer.minOrderQuantity || 1,
    leadDays: null,
    logisticsFee: 0,
    remark: null,
    soldOut: soldOut ? Number(soldOut) || null : null,
    sales: soldOut ? Number(soldOut) || null : null,
  };
}

export async function open1688LoginWindow(profilePath) {
  try {
    const context = await ensure1688Context({ profilePath });
    const page = await openOrReuse1688Page(context, LOGIN_URL);
    await page.bringToFront().catch(() => {});
    return {
      ok: true,
      method: "persistent_1688_profile",
      profilePath: resolve1688ProfilePath(profilePath),
      url: page.url(),
    };
  } catch (error) {
    return {
      ok: false,
      reason: String(error?.message || error),
      profilePath: resolve1688ProfilePath(profilePath),
    };
  }
}

async function focus1688Page(page, profilePath) {
  await page.bringToFront().catch(() => {});

  const session = await page.context().newCDPSession(page).catch(() => null);
  if (session) {
    try {
      const windowInfo = await session.send("Browser.getWindowForTarget").catch(() => null);
      if (windowInfo?.windowId) {
        await session.send("Browser.setWindowBounds", {
          windowId: windowInfo.windowId,
          bounds: { windowState: "maximized" },
        }).catch(() => {});
      }
      await session.send("Page.bringToFront").catch(() => {});
      const targetInfo = await session.send("Target.getTargetInfo").catch(() => null);
      const targetId = targetInfo?.targetInfo?.targetId;
      if (targetId) await session.send("Target.activateTarget", { targetId }).catch(() => {});
    } finally {
      await session.detach().catch(() => {});
    }
  }

  if (process.platform !== "win32") return;
  const script = `
$profile = [System.IO.Path]::GetFullPath($env:TEMU_1688_PROFILE_PATH)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TemuWin32Focus {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@
$topmost = [IntPtr]::new(-1)
$notTopmost = [IntPtr]::new(-2)
$flags = 0x0001 -bor 0x0002 -bor 0x0040
$rows = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^(chrome|msedge)\\.exe$' -and $_.CommandLine -and $_.CommandLine.Contains($profile)
}
foreach ($row in $rows) {
  $proc = Get-Process -Id $row.ProcessId -ErrorAction SilentlyContinue
  if ($proc -and $proc.MainWindowHandle -and $proc.MainWindowHandle -ne 0) {
    [TemuWin32Focus]::ShowWindowAsync($proc.MainWindowHandle, 3) | Out-Null
    [TemuWin32Focus]::SetWindowPos($proc.MainWindowHandle, $topmost, 0, 0, 0, 0, $flags) | Out-Null
    [TemuWin32Focus]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    [TemuWin32Focus]::SetWindowPos($proc.MainWindowHandle, $notTopmost, 0, 0, 0, 0, $flags) | Out-Null
    break
  }
}
`;
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      timeout: 3000,
      stdio: "ignore",
      env: { ...process.env, TEMU_1688_PROFILE_PATH: profilePath },
    });
  } catch {
    // Best-effort focus only; opening the tab is the important part.
  }
}

export async function open1688DetailPage(url, opts = {}) {
  const targetUrl = String(url || "").trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    return { ok: false, reason: "url required" };
  }

  const parsed = new URL(targetUrl);
  if (!/(\.|^)1688\.com$/i.test(parsed.hostname)) {
    return { ok: false, reason: "only 1688 detail urls are supported" };
  }

  try {
    const targetProfilePath = resolve1688ProfilePath(opts.profilePath);
    const hadOpenContext = Boolean(
      browserState1688.context
      && browserState1688.profilePath === targetProfilePath,
    );
    const context = await ensure1688Context({ profilePath: targetProfilePath });
    const pages = (context.pages() || []).filter((page) => !page.isClosed?.());
    const openedAs = hadOpenContext && pages.length > 0 ? "tab" : "window";
    const page = openedAs === "tab"
      ? await context.newPage()
      : (pages.find((item) => item.url() === "about:blank") || pages[0] || await context.newPage());

    await focus1688Page(page, targetProfilePath);
    await page.goto(parsed.toString(), { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS }).catch(() => {});
    await focus1688Page(page, targetProfilePath);

    return {
      ok: true,
      method: "persistent_1688_profile",
      openedAs,
      profilePath: targetProfilePath,
      url: page.url(),
    };
  } catch (error) {
    return {
      ok: false,
      reason: String(error?.message || error),
      url: targetUrl,
    };
  }
}

export async function close1688Browser() {
  if (!browserState1688.context) {
    return { ok: true, alreadyClosed: true };
  }

  try {
    await browserState1688.context.close();
    browserState1688.context = null;
    browserState1688.profilePath = "";
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) };
  }
}
