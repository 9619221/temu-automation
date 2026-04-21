/**
 * 竞品评论抓取器
 * 输入：goodsId（+ 可选 region、maxReviews、minRatingSplit）
 * 输出：{ reviews: [...], stats: {...}, debug: {...} }
 *
 * 策略：
 *   不硬编码 Temu 评论接口 URL（版本多变），改用 page.on('response') 监听
 *   所有响应，用关键词白名单（review|comment|rating）过滤，再做宽松字段匹配提取评论。
 *   触发加载：page.goto → 滚动到底 → 点"See All Reviews" → 滚动触发分页。
 */

import { chromium } from "playwright";
import { randomDelay } from "./utils.mjs";
import { launchCdpChromeProcess, isCdpAlive, YUNQI_CDP_PORT } from "./yunqi-online.mjs";

// URL 关键词：只用于「优先匹配」打分（响应诊断时排在前面），不做前置过滤
const REVIEW_URL_KEYWORDS = [
  "review",
  "comment",
  "rating",
  "/bg/atlas",
  "/phoenix/",
];

// JSON 响应要跳过的（太大/无关）
const SKIP_URL_KEYWORDS = [
  ".js",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".woff",
  ".woff2",
  "/stats",
  "/metric",
  "/log",
  "google-analytics",
  "googletagmanager",
  "sentry",
];

const RATING_FIELDS = ["rating", "reviewGrade", "score", "star", "stars", "goodsScore", "starNum"];
const TEXT_FIELDS = ["reviewContentFormat", "reviewContent", "content", "comment", "text", "review"];
const DATE_FIELDS = ["reviewTime", "commentTime", "createTime", "time", "date", "publishTime"];
const SKU_FIELDS = ["specs", "skuSpecs", "propertyName", "reviewSku", "sku"];
const IMAGE_FIELDS = ["reviewImages", "images", "picUrls", "reviewPics", "imageUrls", "pictures"];
const NAME_FIELDS = ["nickName", "nickname", "userName", "reviewerName", "name"];
const COUNTRY_FIELDS = ["country", "region", "countryCode", "countryShortName"];
const USEFUL_FIELDS = ["usefulCount", "likeCount", "helpful", "thumbsUp"];

// Temu 的点赞数藏在 op_list 里 {type:4, text:"赞", num: N}
function extractTemuUsefulFromOpList(opList) {
  if (!Array.isArray(opList)) return 0;
  for (const op of opList) {
    if (op && op.type === 4 && typeof op.num === "number") return op.num;
  }
  return 0;
}

// Temu 的国家藏在 concat_rich_text.aria_label 里（如"来自西班牙 · 2026年1月19日"）
function extractTemuCountry(raw) {
  const aria = raw?.concat_rich_text?.aria_label;
  if (typeof aria !== "string") return "";
  const m = aria.match(/来自([^\s·•]+)/);
  return m ? m[1] : "";
}

function firstDefined(obj, keys) {
  for (const key of keys) {
    const v = obj?.[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function toRating(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n > 5 && n <= 50) return n / 10;
  if (n >= 0 && n <= 5) return n;
  return null;
}

function toText(v) {
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object") {
    if (typeof v.content === "string") return v.content.trim();
    if (typeof v.text === "string") return v.text.trim();
  }
  return "";
}

function toDateString(v) {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") {
    const ms = v < 1e12 ? v * 1000 : v;
    try { return new Date(ms).toISOString(); } catch { return String(v); }
  }
  return String(v);
}

function toImageArray(v) {
  if (!v) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          return item.url || item.imageUrl || item.picUrl || item.src || "";
        }
        return "";
      })
      .filter(Boolean);
  }
  return [];
}

function normalizeReview(raw) {
  if (!raw || typeof raw !== "object") return null;
  const rating = toRating(firstDefined(raw, RATING_FIELDS));
  const text = toText(firstDefined(raw, TEXT_FIELDS));
  if (rating == null && !text) return null;
  const directUseful = Number(firstDefined(raw, USEFUL_FIELDS));
  const useful = Number.isFinite(directUseful) && directUseful > 0
    ? directUseful
    : extractTemuUsefulFromOpList(raw?.op_list);
  const country = toText(firstDefined(raw, COUNTRY_FIELDS)) || extractTemuCountry(raw);
  return {
    rating: rating ?? null,
    text,
    date: toDateString(firstDefined(raw, DATE_FIELDS)),
    sku: toText(firstDefined(raw, SKU_FIELDS)),
    images: toImageArray(firstDefined(raw, IMAGE_FIELDS)),
    reviewer: toText(firstDefined(raw, NAME_FIELDS)),
    country,
    useful,
  };
}

function walkForReviews(node, collector, depth = 0) {
  if (depth > 6 || !node) return;
  if (Array.isArray(node)) {
    for (const item of node) walkForReviews(item, collector, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const hasReviewShape =
    (firstDefined(node, RATING_FIELDS) !== undefined || firstDefined(node, TEXT_FIELDS) !== undefined) &&
    (firstDefined(node, DATE_FIELDS) !== undefined ||
      firstDefined(node, NAME_FIELDS) !== undefined ||
      firstDefined(node, IMAGE_FIELDS) !== undefined ||
      firstDefined(node, SKU_FIELDS) !== undefined);
  if (hasReviewShape) {
    const r = normalizeReview(node);
    if (r) collector.push(r);
    return;
  }
  for (const key of Object.keys(node)) walkForReviews(node[key], collector, depth + 1);
}

function dedupeReviews(list) {
  const seen = new Set();
  const out = [];
  for (const r of list) {
    const key = `${r.rating}|${(r.text || "").slice(0, 80)}|${r.date || ""}|${r.reviewer || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function buildStats(reviews) {
  const total = reviews.length;
  if (!total) return { total: 0, avgRating: null, badCount: 0, goodCount: 0, ratingDist: {} };
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let rated = 0;
  for (const r of reviews) {
    if (r.rating != null) {
      const bucket = Math.max(1, Math.min(5, Math.round(r.rating)));
      dist[bucket] = (dist[bucket] || 0) + 1;
      sum += r.rating;
      rated += 1;
    }
  }
  return {
    total,
    avgRating: rated ? Number((sum / rated).toFixed(2)) : null,
    badCount: (dist[1] || 0) + (dist[2] || 0) + (dist[3] || 0),
    goodCount: (dist[4] || 0) + (dist[5] || 0),
    ratingDist: dist,
  };
}

/**
 * 关掉 Temu 前台常见的拦路弹窗：
 *   - Privacy & cookie setting（Reject All）
 *   - Security Verification（X / Close / ESC）
 *   - Google Translate 提示
 *   - 登录 / 区域选择弹窗
 * 策略：先点文本匹配的按钮，再按 ESC 兜底。多次重试覆盖延迟弹出的场景。
 */
async function dismissOverlays(page) {
  try {
    await page.evaluate(() => {
      const clickIfMatch = (el, keywords, opts = {}) => {
        const t = (el.textContent || "").trim().toLowerCase();
        if (!t || t.length > 40) return false;
        if (opts.exact) {
          if (!keywords.includes(t)) return false;
        } else if (!keywords.some((kw) => t === kw || t.includes(kw))) {
          return false;
        }
        try { el.click(); return true; } catch { return false; }
      };
      // 1. Cookie banner → Reject All
      const cookieKws = ["reject all", "decline all", "reject", "拒绝全部", "拒绝"];
      document.querySelectorAll("button,a,div[role='button'],span[role='button']").forEach((el) => {
        clickIfMatch(el, cookieKws);
      });
      // 2. 关闭按钮（X）— 找 aria-label/class 带 close 的元素
      const closeSelectors = [
        "[aria-label='Close']",
        "[aria-label='close']",
        "[aria-label*='Close']",
        "[aria-label*='关闭']",
        "button[title*='Close' i]",
        "[class*='close-btn']",
        "[class*='CloseBtn']",
        "[class*='Close_']",
        "[class*='_close']",
        "svg[class*='close']",
      ];
      closeSelectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          try { el.click(); } catch {}
        });
      });
      // 3. Not now / Later / No thanks（翻译、登录等软弹窗）
      const softKws = ["not now", "no thanks", "maybe later", "later", "稍后", "暂不", "不再提示"];
      document.querySelectorAll("button,a,div[role='button']").forEach((el) => {
        clickIfMatch(el, softKws);
      });
    }).catch(() => {});
  } catch {}
  // ESC 兜底
  try { await page.keyboard.press("Escape"); } catch {}
  await randomDelay(300, 600);
}

/**
 * 判断当前页面是否处于登录拦截状态。
 * 信号：URL 被重定向到登录路径；或页面文本出现明确的"登录后才能查看"提示。
 */
async function detectLoginRequired(page) {
  try {
    const url = page.url();
    if (/\/login|sign[_-]?in|\/bgt_login|\/bg\/login|\/auth\/login/i.test(url)) return "url_redirect";
  } catch {}
  try {
    const hit = await page.evaluate(() => {
      const text = (document.body?.innerText || "").slice(0, 3000).toLowerCase();
      if (!text) return null;
      const kws = [
        "sign in to see review",
        "sign in to view review",
        "log in to see review",
        "log in to view review",
        "please sign in to continue",
        "please log in to continue",
        "sign in to continue",
        "log in to continue",
        "登录后查看",
        "请登录",
      ];
      return kws.find((kw) => text.includes(kw)) || null;
    });
    if (hit) return `text:${hit}`;
  } catch {}
  return null;
}

/**
 * 判断页面上是否还有 Security Verification / CAPTCHA 这类强校验弹窗。
 */
async function hasBlockingVerification(page) {
  try {
    return await page.evaluate(() => {
      const text = (document.body?.innerText || "").toLowerCase();
      const kws = ["security verification", "verify to continue", "please verify", "captcha", "slide to verify", "安全验证", "滑动验证"];
      return kws.some((kw) => text.includes(kw));
    });
  } catch {
    return false;
  }
}

function buildTemuProductUrl(goodsId, region = "UK") {
  const id = String(goodsId || "").trim();
  if (!id) return "";
  const regionPath = { UK: "uk/", US: "", DE: "de/", FR: "fr/", ES: "es/", IT: "it/" };
  const prefix = regionPath[String(region || "UK").toUpperCase()] ?? "uk/";
  return `https://www.temu.com/${prefix}goods.html?goods_id=${id}`;
}

/**
 * 启动 CDP Chrome 并打开 Temu 登录页，让用户手动登录。
 * 登录后 cookie 持久化到 yunqi-chrome-profile，后续抓取自动带登录态。
 */
export async function openTemuLoginPage(params = {}) {
  const { region = "UK" } = params || {};
  const regionPath = { UK: "uk/", US: "", DE: "de/", FR: "fr/", ES: "es/", IT: "it/" };
  const prefix = regionPath[String(region).toUpperCase()] ?? "uk/";
  const loginUrl = `https://www.temu.com/${prefix}login.html`;
  const alreadyAlive = await isCdpAlive();
  if (!alreadyAlive) {
    await launchCdpChromeProcess(loginUrl);
    return { launched: true, loginUrl };
  }
  // Chrome 已在跑：在同一 context 里新开一个 tab 进入 login 页
  try {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${YUNQI_CDP_PORT}`);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    try { await browser.close(); } catch {}
  } catch {
    // 忽略：至少保证 Chrome 已在，用户可以手动输入 URL
  }
  return { launched: false, loginUrl };
}

/**
 * 打开 Temu 搜索结果页（keyword 去 URL 里），扩展会自动把搜索结果响应上报到 worker。
 */
export async function openTemuSearchPage(params = {}) {
  const { keyword = "", region = "UK" } = params || {};
  const kw = String(keyword || "").trim();
  if (!kw) throw new Error("openTemuSearchPage 需要 keyword");
  const regionPath = { UK: "uk/", US: "", DE: "de/", FR: "fr/", ES: "es/", IT: "it/" };
  const prefix = regionPath[String(region).toUpperCase()] ?? "uk/";
  const searchUrl = `https://www.temu.com/${prefix}search_result.html?search_key=${encodeURIComponent(kw)}`;
  const alreadyAlive = await isCdpAlive();
  if (!alreadyAlive) {
    await launchCdpChromeProcess(searchUrl);
    return { launched: true, searchUrl, keyword: kw };
  }
  try {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${YUNQI_CDP_PORT}`);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    try { await browser.close(); } catch {}
  } catch {
    // 忽略
  }
  return { launched: false, searchUrl, keyword: kw };
}

/**
 * 抓取一个竞品商品的买家评论
 * @param {Object} params
 * @param {string} params.goodsId - 必填
 * @param {string} [params.region="UK"] - 站点
 * @param {number} [params.maxReviews=30] - 最多抓多少条
 * @param {number} [params.maxScrolls=12] - 最多滚动次数（防死循环）
 * @param {number} [params.gotoTimeoutMs=45000]
 * @returns {Promise<{goodsId:string, region:string, url:string, reviews:Array, stats:Object, debug:Object}>}
 */
export async function scrapeCompetitorReviews(params = {}) {
  const {
    goodsId,
    region = "UK",
    maxReviews = 30,
    maxScrolls = 12,
    gotoTimeoutMs = 45000,
    manualVerifyWaitMs = 120000, // Security Verification 若无法自动关闭，等用户手动过验证（CAPTCHA 可能要 1-2 分钟）
    loginWaitMs = 15000, // 兜底等待（登录应提前通过「打开 Temu 登录」完成，不再主抓取时等长时间）
  } = params || {};

  const id = String(goodsId || "").trim();
  if (!id) throw new Error("scrapeCompetitorReviews 需要 goodsId");

  const url = buildTemuProductUrl(id, region);
  if (!url) throw new Error("无法构造 Temu 商品 URL");

  // 复用项目现有的 CDP Chrome（独立进程，cookie 持久化到 yunqi-chrome-profile）
  // 真实浏览器指纹 + 用户登录态能绕过 Temu 反爬
  if (!(await isCdpAlive())) {
    await launchCdpChromeProcess(url);
  }
  const cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${YUNQI_CDP_PORT}`);
  let cdpContext = cdpBrowser.contexts()[0];
  if (!cdpContext) {
    cdpContext = await cdpBrowser.newContext();
  }
  // 优先复用用户已经打开的、URL 包含当前 goodsId 的 Temu 标签页
  // 这样用户可以手动登录 / 过验证 / 滚到评论区，再点抓取；代码只做响应拦截 + 轻量补滚
  let page = null;
  let reusedExistingPage = false;
  for (const p of cdpContext.pages()) {
    try {
      const pUrl = p.url() || "";
      if (pUrl.includes("temu.com") && pUrl.includes(id)) {
        page = p;
        reusedExistingPage = true;
        break;
      }
    } catch {}
  }
  if (!page) {
    page = await cdpContext.newPage();
  }
  const collected = [];
  const captured = []; // 所有被探测的 JSON 响应（不限关键词）

  const onResponse = async (response) => {
    try {
      const respUrl = response.url();
      const lower = respUrl.toLowerCase();
      if (SKIP_URL_KEYWORDS.some((kw) => lower.includes(kw))) return;
      // 只关心 XHR/fetch 的 JSON 响应
      const ct = (response.headers()["content-type"] || "").toLowerCase();
      if (!ct.includes("json")) return;
      const json = await response.json().catch(() => null);
      if (!json) return;
      const before = collected.length;
      walkForReviews(json, collected);
      const added = collected.length - before;
      const priority = REVIEW_URL_KEYWORDS.some((kw) => lower.includes(kw)) ? 1 : 0;
      captured.push({
        url: respUrl,
        status: response.status(),
        added,
        priority,
      });
    } catch {
      // 忽略单次响应解析异常
    }
  };

  page.on("response", onResponse);

  let gotoOk = false;
  let gotoError = "";
  if (reusedExistingPage) {
    // 复用用户已打开的 tab：不导航，避免触发二次验证；只把它 bringToFront 以便用户看见
    gotoOk = true;
    try { await page.bringToFront(); } catch {}
  } else {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: gotoTimeoutMs });
      gotoOk = true;
    } catch (e) {
      gotoError = String(e?.message || e);
    }
  }

  // SPA 初始化
  await randomDelay(1500, 2500);

  // 反复 dismiss 覆盖层，连续两轮无检测到阻塞即认为清理完成
  for (let i = 0; i < 4; i += 1) {
    await dismissOverlays(page);
    const stillBlocked = await hasBlockingVerification(page);
    if (!stillBlocked) break;
    await randomDelay(600, 1200);
  }

  // 如果 Security Verification 还在，给用户手动过验证的窗口
  let verificationWaitedMs = 0;
  if (await hasBlockingVerification(page)) {
    const sliceMs = 1500;
    const rounds = Math.max(1, Math.floor(manualVerifyWaitMs / sliceMs));
    for (let i = 0; i < rounds; i += 1) {
      await randomDelay(sliceMs - 100, sliceMs + 100);
      verificationWaitedMs += sliceMs;
      await dismissOverlays(page);
      if (!(await hasBlockingVerification(page))) break;
    }
  }

  // 登录检测：如果 Temu 要求登录才能看评论，暂停等用户在同一个 Chrome 里手动登录
  let loginRequiredSignal = await detectLoginRequired(page);
  let loginWaitedMs = 0;
  let loggedInAfterWait = false;
  if (loginRequiredSignal) {
    const sliceMs = 2000;
    const rounds = Math.max(1, Math.floor(loginWaitMs / sliceMs));
    for (let i = 0; i < rounds; i += 1) {
      await randomDelay(sliceMs - 100, sliceMs + 100);
      loginWaitedMs += sliceMs;
      const sig = await detectLoginRequired(page);
      if (!sig) {
        loggedInAfterWait = true;
        break;
      }
    }
    // 登录后（或超时后）重新加载，触发评论接口
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: gotoTimeoutMs });
    } catch {}
    await randomDelay(1500, 2500);
    await dismissOverlays(page);
  }

  const clickReviewEntry = async () => {
    return page.evaluate(() => {
      const keywords = [
        "see all review",
        "view all review",
        "all reviews",
        "read reviews",
        "查看全部评论",
        "全部评价",
        "更多评价",
        "更多评论",
      ];
      const nodes = Array.from(document.querySelectorAll("a,button,span,div"));
      for (const el of nodes) {
        const t = (el.textContent || "").trim().toLowerCase();
        if (!t || t.length > 40) continue;
        if (keywords.some((kw) => t.includes(kw))) {
          try { el.click(); return true; } catch { return false; }
        }
      }
      return false;
    }).catch(() => false);
  };

  let scrolls = 0;
  let stagnantRounds = 0;
  let midLoopVerifyWaitedMs = 0;
  // 若一条评论都没抓到，放宽 stagnant 阈值（可能评论区在更深处）
  while (scrolls < maxScrolls && dedupeReviews(collected).length < maxReviews) {
    // 滚动阶段也轮询验证——Temu 常在二次请求时再弹验证，这里再等一轮用户手动过掉
    if (await hasBlockingVerification(page)) {
      const sliceMs = 1500;
      const maxRoundsMid = Math.max(1, Math.floor(60000 / sliceMs)); // 循环中单次最多等 60s
      for (let i = 0; i < maxRoundsMid; i += 1) {
        await randomDelay(sliceMs - 100, sliceMs + 100);
        midLoopVerifyWaitedMs += sliceMs;
        await dismissOverlays(page);
        if (!(await hasBlockingVerification(page))) break;
      }
    }
    const before = dedupeReviews(collected).length;
    await page.evaluate(() => {
      window.scrollBy(0, Math.max(600, window.innerHeight * 0.8));
    }).catch(() => {});
    await randomDelay(1400, 2400);
    scrolls += 1;
    if (scrolls % 2 === 0) {
      await dismissOverlays(page);
      await clickReviewEntry();
    }
    const after = dedupeReviews(collected).length;
    const stagnantLimit = after === 0 ? 6 : 3;
    if (after === before) {
      stagnantRounds += 1;
      if (stagnantRounds >= stagnantLimit) break;
    } else {
      stagnantRounds = 0;
    }
  }

  page.off("response", onResponse);
  if (!reusedExistingPage) {
    await page.close().catch(() => {});
  }
  // 只 disconnect（不调用 browser.close()，否则会关掉用户的 CDP Chrome）
  try { await cdpBrowser.close(); } catch {}

  const reviews = dedupeReviews(collected).slice(0, maxReviews);
  const stats = buildStats(reviews);

  return {
    goodsId: id,
    region,
    url,
    reviews,
    stats,
    debug: {
      gotoOk,
      gotoError,
      scrolls,
      reusedExistingPage,
      verificationWaitedMs,
      midLoopVerifyWaitedMs,
      loginRequired: Boolean(loginRequiredSignal),
      loginRequiredSignal: loginRequiredSignal || "",
      loginWaitedMs,
      loggedInAfterWait,
      capturedResponses: captured.length,
      // 优先展示命中关键词的，再展示其他（便于发现新的评论端点）
      responseSamples: [...captured]
        .sort((a, b) => (b.priority - a.priority) || (b.added - a.added))
        .slice(0, 25)
        .map(({ url, status, added, priority }) => ({ url, status, added, priority })),
      rawCollected: collected.length,
    },
  };
}

/**
 * 调试用：dump feed 里匹配指定 goodsId 的原始 body（截取前 N 字符）
 */
export function dumpFeedForGoods(params = {}, feed = []) {
  const { goodsId, bodyLimit = 1200, max = 30 } = params || {};
  const id = String(goodsId || "").trim();
  if (!id) throw new Error("dumpFeedForGoods 需要 goodsId");
  const matched = [];
  for (const entry of feed) {
    const url = entry?.url || "";
    const pageUrl = entry?.pageUrl || "";
    if (!url.includes(id) && !pageUrl.includes(id)) continue;
    matched.push({
      url,
      pageUrl,
      status: entry?.status,
      receivedAt: entry?.receivedAt,
      bodyLength: (entry?.body || "").length,
      bodyPreview: (entry?.body || "").slice(0, bodyLimit),
    });
    if (matched.length >= max) break;
  }
  return { goodsId: id, matched, totalFeed: feed.length };
}

/**
 * 从浏览器扩展 feed 里抽取指定 goodsId 的评论
 * @param {Object} params
 * @param {string} params.goodsId
 * @param {number} [params.maxReviews=30]
 * @param {Array} feed - worker 侧的 extFeedBuffer 快照，元素形如 { url, body, pageUrl, ... }
 */
export function extractReviewsFromFeed(params = {}, feed = []) {
  const { goodsId, maxReviews = 30 } = params || {};
  const id = String(goodsId || "").trim();
  if (!id) throw new Error("extractReviewsFromFeed 需要 goodsId");

  const matched = [];
  const collected = [];
  const perEntryDebug = [];
  for (const entry of feed) {
    const url = entry?.url || "";
    const pageUrl = entry?.pageUrl || "";
    // 注意：SKIP 只能看响应 URL 本身，不能看 pageUrl
    // pageUrl 的 query string 里常带 top_gallery_url=xxx.jpg 等图片链接，会把所有 entry 误伤
    const urlLower = url.toLowerCase();
    if (SKIP_URL_KEYWORDS.some((kw) => urlLower.includes(kw))) continue;
    if (!url.includes(id) && !pageUrl.includes(id)) continue;
    matched.push(entry);

    const bodyStr = entry?.body;
    const before = collected.length;
    let parseOk = false;
    let parseErr = null;
    let jsonType = "none";
    let topKeys = [];
    try {
      if (typeof bodyStr === "string" && bodyStr.length > 0) {
        const json = JSON.parse(bodyStr);
        parseOk = true;
        jsonType = Array.isArray(json) ? "array" : typeof json;
        if (json && typeof json === "object" && !Array.isArray(json)) {
          topKeys = Object.keys(json).slice(0, 10);
        }
        if (json) walkForReviews(json, collected);
      }
    } catch (e) {
      parseErr = String(e?.message || e).slice(0, 120);
    }
    perEntryDebug.push({
      url,
      bodyType: typeof bodyStr,
      bodyLength: typeof bodyStr === "string" ? bodyStr.length : 0,
      parseOk,
      parseErr,
      jsonType,
      topKeys,
      extracted: collected.length - before,
    });
  }
  const reviews = dedupeReviews(collected).slice(0, maxReviews);
  const stats = buildStats(reviews);
  return {
    goodsId: id,
    reviews,
    stats,
    debug: {
      matchedEntries: matched.length,
      totalFeed: feed.length,
      rawCollected: collected.length,
      perEntry: perEntryDebug.slice(-20),
      matchedSamples: matched.slice(-10).map((m) => ({
        url: m.url,
        status: m.status,
        pageUrl: m.pageUrl,
        receivedAt: m.receivedAt,
      })),
    },
  };
}

/* ============ 商品详情 + 销量/人气信号 提取 ============ */

// 递归找第一个 key 在 target obj 里值
function deepFind(node, predicate, depth = 0, path = "") {
  if (depth > 8 || !node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const r = deepFind(node[i], predicate, depth + 1, `${path}[${i}]`);
      if (r) return r;
    }
    return null;
  }
  if (predicate(node)) return { node, path };
  for (const key of Object.keys(node)) {
    const r = deepFind(node[key], predicate, depth + 1, `${path}.${key}`);
    if (r) return r;
  }
  return null;
}

function parsePriceTriple(priceArr) {
  if (!Array.isArray(priceArr) || priceArr.length < 2) return { currency: "", amount: null, text: "" };
  const currency = String(priceArr[0] || "").trim();
  const amountStr = String(priceArr[1] || "").trim();
  const suffix = String(priceArr[2] || "").trim();
  const amount = Number(amountStr.replace(/,/g, ""));
  const text = `${currency}${amountStr}${suffix}`.trim();
  return { currency, amount: Number.isFinite(amount) ? amount : null, text };
}

// 从 score_num_info_list 算均分（加权）
function deriveAvgFromScoreDist(list) {
  if (!Array.isArray(list) || !list.length) return null;
  let sum = 0;
  let weight = 0;
  for (const item of list) {
    const s = Number(item?.score);
    const p = Number(item?.percent);
    if (Number.isFinite(s) && Number.isFinite(p)) {
      sum += s * p;
      weight += p;
    }
  }
  if (weight <= 0) return null;
  return Number((sum / weight).toFixed(2));
}

// labels 里提 "来自英国 141 条评价"
function parseLabelCountry(label) {
  const text = String(label?.readable_text || label?.text || "");
  const m = text.match(/来自([^\s·•的]+).*?(\d+)/);
  if (!m) return null;
  return { country: m[1], num: Number(m[2]) };
}

function applyReviewsInfo(product, json) {
  if (!json || typeof json !== "object") return;
  const gi = json.goods_info;
  if (gi && typeof gi === "object") {
    if (!product.title && gi.goods_name) product.title = String(gi.goods_name);
    if (!product.thumbUrl && gi.thumb_url) product.thumbUrl = String(gi.thumb_url);
    if (!product.seoLinkUrl && gi.seo_link_url) product.seoLinkUrl = String(gi.seo_link_url);
    const price = parsePriceTriple(gi.price);
    if (price.amount != null && product.price == null) {
      product.price = price.amount;
      product.currency = price.currency;
      product.priceText = price.text;
    }
  }
  if (typeof json.review_num === "number" && product.reviewNum == null) {
    product.reviewNum = json.review_num;
    product.reviewNumStr = String(json.review_num_str || json.review_num);
  }
  if (Array.isArray(json.score_num_info_list) && !Object.keys(product.scoreDist).length) {
    for (const item of json.score_num_info_list) {
      const s = Number(item?.score);
      const p = Number(item?.percent);
      if (Number.isFinite(s) && Number.isFinite(p)) product.scoreDist[s] = p;
    }
    const avg = deriveAvgFromScoreDist(json.score_num_info_list);
    if (avg != null) product.avgRating = avg;
  }
  if (Array.isArray(json.labels) && !product.labels.length) {
    for (const label of json.labels) {
      const text = String(label?.readable_text || label?.text || "").trim();
      const num = Number(label?.num);
      if (text) product.labels.push({ text, num: Number.isFinite(num) ? num : null });
      const country = parseLabelCountry(label);
      if (country) product.countryBreakdown.push(country);
    }
  }
}

// 商品详情接口（多种命名）：抽 title / price / images / specs / skus / sellingPoints
function applyGoodsDetail(product, json) {
  if (!json || typeof json !== "object") return;

  // title
  if (!product.title) {
    const hit = deepFind(json, (n) => typeof n?.goods_name === "string" && n.goods_name.length > 0);
    if (hit) product.title = String(hit.node.goods_name);
  }
  // price（数组形式 ["£", "1.22", ""]）
  if (product.price == null) {
    const hit = deepFind(json, (n) => Array.isArray(n?.price) && n.price.length >= 2 && typeof n.price[1] === "string");
    if (hit) {
      const p = parsePriceTriple(hit.node.price);
      if (p.amount != null) {
        product.price = p.amount;
        product.currency = p.currency;
        product.priceText = p.text;
      }
    }
  }
  // 主图列表
  if (!product.images.length) {
    const hit = deepFind(
      json,
      (n) => Array.isArray(n?.detail_gallery) || Array.isArray(n?.gallery) || Array.isArray(n?.hd_url_list),
    );
    if (hit) {
      const arr = hit.node.detail_gallery || hit.node.gallery || hit.node.hd_url_list || [];
      for (const it of arr) {
        const u = typeof it === "string" ? it : (it?.url || it?.hd_url || it?.image_url || "");
        if (u) product.images.push(String(u));
      }
    }
  }
  // SKU 列表
  if (!product.skus.length) {
    const hit = deepFind(json, (n) => Array.isArray(n?.sku_list) && n.sku_list.length && typeof n.sku_list[0] === "object");
    if (hit) {
      for (const sk of hit.node.sku_list) {
        const priceInfo = parsePriceTriple(sk?.price || sk?.sku_price);
        product.skus.push({
          skuId: String(sk?.sku_id || sk?.skuId || ""),
          specs: sk?.specs || sk?.spec_list || sk?.spec_value_list || null,
          price: priceInfo.amount,
          priceText: priceInfo.text,
          stock: Number(sk?.stock_num ?? sk?.stock ?? 0) || null,
          thumbUrl: String(sk?.thumb_url || sk?.image_url || ""),
        });
      }
    }
  }
  // 规格维度（颜色/尺寸等）
  if (!product.specs.length) {
    const hit = deepFind(json, (n) => Array.isArray(n?.spec_list) && n.spec_list.length && n.spec_list[0]?.spec_key);
    if (hit) {
      for (const sp of hit.node.spec_list) {
        product.specs.push({
          specKey: String(sp?.spec_key || ""),
          specValues: Array.isArray(sp?.spec_values)
            ? sp.spec_values.map((v) => String(v?.spec_value || v?.value || v || "")).filter(Boolean)
            : [],
        });
      }
    }
  }
  // 卖点 / selling points / 标题下的短标语
  if (!product.sellingPoints.length) {
    const hit = deepFind(
      json,
      (n) => Array.isArray(n?.selling_point_list) || Array.isArray(n?.selling_points) || Array.isArray(n?.highlight_list),
    );
    if (hit) {
      const arr = hit.node.selling_point_list || hit.node.selling_points || hit.node.highlight_list || [];
      for (const it of arr) {
        const t = typeof it === "string" ? it : (it?.text || it?.content || it?.title || "");
        if (t) product.sellingPoints.push(String(t));
      }
    }
  }
}

/**
 * 从扩展 feed 里抽取指定 goodsId 的商品详情 + 销量/人气信号
 */
export function extractProductFromFeed(params = {}, feed = []) {
  const { goodsId } = params || {};
  const id = String(goodsId || "").trim();
  if (!id) throw new Error("extractProductFromFeed 需要 goodsId");

  const product = {
    goodsId: id,
    title: "",
    price: null,
    currency: "",
    priceText: "",
    thumbUrl: "",
    seoLinkUrl: "",
    skus: [],
    specs: [],
    images: [],
    sellingPoints: [],
    reviewNum: null,
    reviewNumStr: "",
    scoreDist: {},
    avgRating: null,
    labels: [],
    countryBreakdown: [],
  };

  const matched = [];
  const sourceTally = {};
  for (const entry of feed) {
    const url = entry?.url || "";
    const pageUrl = entry?.pageUrl || "";
    const urlLower = url.toLowerCase();
    if (SKIP_URL_KEYWORDS.some((kw) => urlLower.includes(kw))) continue;
    if (!url.includes(id) && !pageUrl.includes(id)) continue;

    let json = null;
    try { json = JSON.parse(entry?.body || "null"); } catch {}
    if (!json) continue;
    matched.push({ url, pageUrl });

    let tag = "other";
    if (urlLower.includes("/engels/reviews/info")) { applyReviewsInfo(product, json); tag = "reviews_info"; }
    else if (/(goods_detail|goods_info|pc_goods_detail|mall\/detail|sku_info|spec_info|goods\/info)/i.test(urlLower)) {
      applyGoodsDetail(product, json);
      tag = "goods_detail";
    }
    else {
      // fallback：任意响应都尝试找 goods_info / sku_list
      applyGoodsDetail(product, json);
      tag = "fallback";
    }
    sourceTally[tag] = (sourceTally[tag] || 0) + 1;
  }

  return {
    goodsId: id,
    product,
    debug: {
      matchedEntries: matched.length,
      totalFeed: feed.length,
      sourceTally,
      matchedUrls: matched.slice(-20).map((m) => m.url),
    },
  };
}

/* ============ 从 feed 抽取搜索结果页商品列表 ============ */

function parseSearchKeyFromUrl(urlStr) {
  if (!urlStr) return "";
  try {
    const u = new URL(urlStr);
    const raw =
      u.searchParams.get("search_key") ||
      u.searchParams.get("q") ||
      u.searchParams.get("keyword") ||
      u.searchParams.get("k") ||
      "";
    return raw ? decodeURIComponent(raw).trim() : "";
  } catch {
    const m = String(urlStr).match(/[?&](search_key|q|keyword|k)=([^&#]+)/i);
    return m ? decodeURIComponent(m[2]).trim() : "";
  }
}

function isSearchResultUrl(url, pageUrl) {
  const u = String(url || "").toLowerCase();
  const p = String(pageUrl || "").toLowerCase();
  if (p.includes("search_result.html") || p.includes("/search")) return true;
  if (/search[_/-]?(goods|result|items|opt|recommend)/i.test(u)) return true;
  if (u.includes("/bg/atlas/search")) return true;
  return false;
}

function pickStr(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

function pickNum(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

function looksLikeGoodsEntry(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const hasId = Boolean(pickStr(node, ["goods_id", "goodsId", "productId", "product_id", "skcId", "skc_id"]));
  const hasTitle = Boolean(pickStr(node, ["goods_name", "goodsName", "title", "product_name", "productName", "subject"]));
  return hasId && hasTitle;
}

// Temu 搜索结果常把 price/review/rating 装在嵌套 wrapper 里，打平到顶层再 pick。
const GOODS_WRAPPERS = [
  "priceInfo", "priceStyle", "priceTag", "price_info",
  "commentTag", "comment_tag", "reviewInfo", "review_info",
  "starInfo", "star_info", "goodsScore",
  "goodsTag", "goods_tag", "baseInfo", "base_info", "goodsProperty",
  "salesTag", "sales_tag", "goodsDesc", "goodsLabel",
];

function flattenGoodsWrappers(node) {
  const flat = { ...node };
  for (const w of GOODS_WRAPPERS) {
    const sub = node?.[w];
    if (sub && typeof sub === "object" && !Array.isArray(sub)) {
      for (const k of Object.keys(sub)) {
        if (flat[k] === undefined) flat[k] = sub[k];
      }
    }
  }
  return flat;
}

// Temu 搜索 API 里的 price 是"分"（整数，如 446 = $4.46）
// 判据：整数且 >= 100 一律按分处理；非整数（带小数）按原值
function normalizePrice(val, _currency) {
  if (val == null || !Number.isFinite(val)) return null;
  if (Number.isInteger(val) && val >= 100) return val / 100;
  return val;
}

function normalizeSearchGoods(rawNode) {
  const node = flattenGoodsWrappers(rawNode);
  const goodsId = pickStr(node, ["goods_id", "goodsId", "productId", "product_id", "skcId", "skc_id"]);
  const title = pickStr(node, ["goods_name", "goodsName", "title", "product_name", "productName", "subject"]);
  const imageUrl =
    pickStr(node, ["hd_thumb_url", "thumb_url", "imageUrl", "image_url", "thumbUrl", "hdThumbUrl", "picUrl"]) ||
    (Array.isArray(node?.images) ? String(node.images[0] || "") : "");
  // price 可能是数组 [currency, text] 或 {price, currency} 或纯数字
  let priceText = "";
  let priceVal = null;
  let currency = pickStr(node, ["currency", "currencyCode", "currency_code"]);
  const priceArr = node?.price;
  if (Array.isArray(priceArr) && priceArr.length >= 2) {
    currency = currency || String(priceArr[0] || "");
    priceText = String(priceArr[1] || "");
    const m = priceText.match(/([\d.]+)/);
    if (m) priceVal = Number(m[1]);
  } else {
    priceVal = pickNum(node, [
      "price", "realPrice", "salePrice", "minOnSalePrice", "minPrice",
      "priceValue", "price_value", "lowPrice", "low_price", "currentPrice",
      "finalPrice", "activityPrice", "retailPrice",
    ]);
    priceText = pickStr(node, [
      "priceStr", "priceText", "priceDesc", "priceDisplay",
      "minOnSalePriceStr", "minPriceStr", "salePriceDesc",
    ]);
    priceVal = normalizePrice(priceVal, currency);
    if (!priceText && priceVal != null) priceText = String(priceVal);
  }
  const reviewNum = pickNum(node, [
    "commentNum", "comment_num", "reviewNum", "review_num", "commentsNum",
    "goodsReviewNum", "goodsCommentNum", "commentCount", "reviewCount",
    "totalReviewNum", "positiveReviewNum",
  ]);
  const avgRating = pickNum(node, [
    "goodsScore", "avgScore", "avg_score", "averageRating", "average_rating", "score", "rating",
    "goodsStar", "avgStarNum", "starScore", "goodsRatingScore", "starNum", "avgStar",
  ]);
  const seoUrl = pickStr(node, ["link_url", "linkUrl", "seoLinkUrl", "seo_link_url", "goodsUrl"]);
  const mallId = pickStr(node, ["mall_id", "mallId", "shop_id", "shopId"]);
  const firstCartTime = pickNum(node, ["first_cart_time", "firstCartTime", "onlineTime", "online_time"]);
  return {
    goodsId,
    title,
    imageUrl,
    priceText,
    price: priceVal,
    currency,
    reviewNum,
    avgRating,
    seoUrl,
    mallId,
    firstCartTime,
  };
}

function collectGoodsFromJson(node, out, depth = 0, rawOut = null) {
  if (depth > 8 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectGoodsFromJson(item, out, depth + 1, rawOut);
    return;
  }
  if (looksLikeGoodsEntry(node)) {
    const g = normalizeSearchGoods(node);
    if (g.goodsId) {
      out.push(g);
      if (rawOut && rawOut.length < 2) rawOut.push(node);
    }
    // 继续深入，避免漏掉同层 list
  }
  for (const key of Object.keys(node)) {
    collectGoodsFromJson(node[key], out, depth + 1, rawOut);
  }
}

/**
 * 从扩展 feed 里抽取所有"搜索结果页"捕获到的商品列表，按 search_key 分组。
 * 前端轮询调用，每次拿到当前 feed 里累积的全部搜索结果。
 */
export function extractSearchResultsFromFeed(_params = {}, feed = []) {
  const resultsByKeyword = {};
  const goodsIdSeenByKw = {};
  let matchedEntries = 0;
  const rawSamples = [];

  for (const entry of feed) {
    const url = entry?.url || "";
    const pageUrl = entry?.pageUrl || "";
    const urlLower = url.toLowerCase();
    if (SKIP_URL_KEYWORDS.some((kw) => urlLower.includes(kw))) continue;
    if (!isSearchResultUrl(url, pageUrl)) continue;

    const kw =
      parseSearchKeyFromUrl(pageUrl) ||
      parseSearchKeyFromUrl(url) ||
      "__unknown__";

    let json = null;
    try { json = JSON.parse(entry?.body || "null"); } catch {}
    if (!json) continue;

    const bucket = [];
    collectGoodsFromJson(json, bucket, 0, rawSamples);
    if (!bucket.length) continue;
    matchedEntries += 1;

    if (!resultsByKeyword[kw]) resultsByKeyword[kw] = [];
    if (!goodsIdSeenByKw[kw]) goodsIdSeenByKw[kw] = new Set();
    for (const g of bucket) {
      if (!g.goodsId || goodsIdSeenByKw[kw].has(g.goodsId)) continue;
      goodsIdSeenByKw[kw].add(g.goodsId);
      resultsByKeyword[kw].push(g);
    }
  }

  const summary = Object.entries(resultsByKeyword).map(([k, list]) => ({
    keyword: k,
    count: list.length,
  }));

  // 诊断用：暴露第一条 raw goods 节点的顶层字段名，便于补齐 normalize 字段候选
  let sampleKeys = [];
  let sampleFlat = {};
  if (rawSamples[0]) {
    sampleKeys = Object.keys(rawSamples[0]).slice(0, 80);
    const flat = flattenGoodsWrappers(rawSamples[0]);
    for (const k of Object.keys(flat).slice(0, 80)) {
      const v = flat[k];
      if (v == null) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        sampleFlat[k] = typeof v === "string" && v.length > 60 ? v.slice(0, 60) + "…" : v;
      }
    }
  }

  return {
    resultsByKeyword,
    summary,
    debug: {
      matchedEntries,
      totalFeed: feed.length,
      sampleKeys,
      sampleFlat,
    },
  };
}
