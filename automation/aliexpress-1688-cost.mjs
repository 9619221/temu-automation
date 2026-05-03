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
