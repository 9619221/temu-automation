/**
 * 鏍镐环绛涢€夊櫒 - 鎵弿 Temu 鍗栧鍚庡彴鏍镐环椤? *
 * 鑱岃矗锛? *  1. 鎵撳紑 Temu 鍚庡彴鏍镐环鍒楄〃锛岀瓫閫夈€屼环鏍肩敵鎶ヤ腑銆? *  2. 缈婚〉鎶撳彇鎵€鏈?SKU 鐨勫師鐢虫姤浠?/ 鍗栧褰撳墠鎶ヤ环 / 鍙傝€冪敵鎶ヤ环 / 浠峰樊绛夊瓧娈? *  3. 瀵规瘡鏉?SKU 鏌ヨ鎴愭湰缂撳瓨锛堟墜濉紭鍏堬級锛屾棤鍒欒皟鐢?1688 鍥炬悳
 *  4. 璁＄畻 pass_175 = (鍗栧褰撳墠鎶ヤ环 >= 鎴愭湰 脳 marginRatio)
 *  5. 鏁存壒鍐欏叆 price_review_snapshot
 *
 * 涓嶅仛锛? *  - 涓嶇偣銆屾煡鐪嬪苟纭鐢虫姤浠枫€嶃€佷笉鐐广€屾帴鍙?鏀惧純銆嶆寜閽紙浜哄伐澶嶆牳锛? *
 * DOM 閫夋嫨鍣ㄧ姸鎬侊細鈿狅笍 寰呴娆¤繍琛屽鐫€鐪熷疄椤甸潰濉紙浠ｇ爜閲岀敤 TODO 鏍囧嚭锛? */

import {
  savePriceReviewSnapshot,
  getPriceReviewCost,
  upsertPriceReviewCost,
} from "./yunqi-db.mjs";
import { logSilent } from "./utils.mjs";
import { browserState, safeNewPage, handleAuthOnPage } from "./browser.mjs";
import { fetch1688CostByImage } from "./aliexpress-1688-cost.mjs";
import crypto from "crypto";

// 鏍镐环鍒楄〃椤碉紙agentseller 浠ｈ繍钀ュ悗鍙帮級
const PRICE_REVIEW_LIST_URL = "https://agentseller.temu.com/newon/product-select";

// 銆屼环鏍肩敵鎶ヤ腑銆嶇瓫閫夊弬鏁帮紙鍙兘鏄?query string 鎴?tab 鍒囨崲锛岃繍琛屾椂瀵圭収锛?
const REVIEW_STATUS_FILTER = "浠锋牸鐢虫姤涓?";

async function ensurePriceReviewPageReady(page) {
  if (!page || page.isClosed()) {
    throw new Error("Price review page is not open. Please retry.");
  }

  await handleAuthOnPage(page, "price-review").catch(() => false);
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const currentUrl = page.url() || "";
  const pageText = await page.evaluate(() => (document.body?.innerText || "").trim().slice(0, 800)).catch(() => "");
  const authBlocked = /\/auth\/authentication|\/main\/authentication|\/main\/entry/i.test(currentUrl)
    || (pageText.includes("鍟嗗涓績") && pageText.includes("涓浗鍦板尯"))
    || pageText.includes("纭鎺堟潈")
    || pageText.includes("鎺堟潈鐧诲綍");

  if (authBlocked) {
    throw new Error("Temu seller auth required. Complete auth/region selection in the opened browser, then retry scan. Page: " + (currentUrl || "unknown"));
  }
}

export async function scanPriceReview(opts = {}) {
  const {
    marginRatio = 1.75,
    skip1688Search = false,
    onProgress = () => {},
  } = opts;

  const snapshotId = `pr_${Date.now()}`;
  const scannedAt = Date.now();
  const errors = [];

  // 1. 纭繚娴忚鍣ㄤ笂涓嬫枃瀛樺湪
  const context = browserState.context;
  if (!context) {
    throw new Error("娴忚鍣ㄦ湭鍚姩锛岃鍏堢櫥褰?Temu 鍚庡彴");
  }

  onProgress("open_page", { url: PRICE_REVIEW_LIST_URL });

  // open or reuse price-review page
  let page = null;
  const existingPages = context.pages() || [];
  for (const p of existingPages) {
    if (p.url().includes("/newon/product-select") || p.url().includes("price-management")) {
      page = p;
      break;
    }
  }
  if (!page) {
    page = await safeNewPage(context);
    await page.goto(PRICE_REVIEW_LIST_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } else {
    await page.bringToFront().catch(() => {});
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
  }
  await ensurePriceReviewPageReady(page);

  // 3. 鍒囧埌銆屼环鏍肩敵鎶ヤ腑銆嶇瓫閫?
  await applyReviewStatusFilter(page, REVIEW_STATUS_FILTER).catch((e) => {
    errors.push({ stage: "apply_filter", message: String(e?.message || e) });
  });

  // 4. 缈婚〉鎶撳彇
  const rawRows = [];
  let pageNum = 1;
  while (true) {
    onProgress("scrape_page", { pageNum });
    const pageRows = await scrapeCurrentPage(page).catch((e) => {
      errors.push({ stage: "scrape_page", pageNum, message: String(e?.message || e) });
      return [];
    });
    rawRows.push(...pageRows);
    const hasNext = await goToNextPage(page).catch(() => false);
    if (!hasNext) break;
    pageNum++;
    if (pageNum > 200) break; // 瀹夊叏涓婇檺
  }

  onProgress("scrape_done", { totalRaw: rawRows.length });

  // 5. 鍚堝苟鎴愭湰 + 璁＄畻 pass
  const finalRows = [];
  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    onProgress("resolve_cost", { index: i, total: rawRows.length, skuId: r.skuId });

    const cached = getPriceReviewCost(r.skuId);
    let cost1688 = cached?.cost_1688 ?? null;
    let costManual = cached?.cost_manual ?? null;
    let costSource = cached?.cost_source || "pending";

    // 鎵嬪～鍊兼案杩滀笉琚鐩栵紱1688 鍥炬悳浣跨敤鐙珛鎸佷箙鍖栫櫥褰曚細璇濓紝閬垮厤鍜?Temu 涓婁笅鏂囦覆椤?
    if (costManual == null && cost1688 == null && !skip1688Search && r.mainImage) {
      try {
        const searched = await fetch1688CostByImage(r.mainImage);
        if (searched && searched.cost != null) {
          cost1688 = searched.cost;
          costSource = searched.source || "1688_image_search";
          upsertPriceReviewCost({
            skuId: r.skuId,
            mainImageHash: hashImage(r.mainImage),
            cost1688,
            costSource,
          });
        } else {
          costSource = "not_found";
          upsertPriceReviewCost({
            skuId: r.skuId,
            mainImageHash: hashImage(r.mainImage),
            costSource: "not_found",
          });
          if (searched?.error) {
            errors.push({ stage: "1688_search", skuId: r.skuId, message: searched.error });
          }
        }
      } catch (e) {
        errors.push({ stage: "1688_search", skuId: r.skuId, message: String(e?.message || e) });
      }
    }

    const effectiveCost = costManual != null ? costManual : cost1688;
    let pass175 = null;
    if (effectiveCost != null && r.sellerCurrentPrice != null) {
      pass175 = r.sellerCurrentPrice >= effectiveCost * marginRatio;
    }

    finalRows.push({
      ...r,
      cost1688,
      costManual,
      costSource,
      pass175,
    });
  }

  // 6. 钀藉簱
  savePriceReviewSnapshot({
    snapshotId,
    scannedAt,
    rows: finalRows,
  });

  const summary = {
    total: finalRows.length,
    pass: finalRows.filter((r) => r.pass175 === true).length,
    fail: finalRows.filter((r) => r.pass175 === false).length,
    unknown: finalRows.filter((r) => r.pass175 == null).length,
  };

  onProgress("done", { snapshotId, summary, errors: errors.length });
  return { snapshotId, rows: finalRows, summary, errors };
}

// ============ DOM 鎶撳彇 ============
//
// 鈿狅笍 涓嬪垪閫夋嫨鍣ㄥ潎涓哄崰浣?鈥斺€?棣栨璺?dev 鏃讹紝鎵撳紑鏍镐环椤?F12锛屾妸鐪熷疄
// 閫夋嫨鍣ㄥ～杩涙潵銆傛埅鍥惧弬鑰冪殑瀛楁锛?//   鍟嗗搧淇℃伅鍒楋細SPU / 鏍囬 / 涓诲浘
//   SKC灞炴€у垪锛歋KC ID
//   SKU灞炴€ч泦鍒楋細SKU ID / 瑙勬牸
//   浠锋牸淇℃伅鍒楋細鍘熺敵鎶ヤ环 / 鍗栧褰撳墠鎶ヤ环 / 鍙傝€冪敵鎶ヤ环 / 浠峰樊 / 浠峰樊%
//   鎿嶄綔鍒楋細銆屾煡鐪嬪苟纭鐢虫姤浠枫€嶉摼鎺ワ紙浣滀负 detailUrl锛?//   鍒嗛〉锛氬簳閮ㄣ€屽叡 N 鏉?姣忛〉 10 鏉?1/X銆?
async function applyReviewStatusFilter(page, statusText) {
  // 椤甸潰椤堕儴绛涢€?tab 缁撴瀯锛?  //   div.TAB_line_5-120-1 > div.TAB_tabItem_5-120-1
  //   innerText 褰㈠銆屽叏閮?1234銆嶃€屼环鏍煎緟纭 56銆嶃€屽緟涓婃灦 78銆?..
  // 鎴戜滑瑕佺偣銆屼环鏍煎緟纭銆嶈繖涓?tab
  await page.waitForTimeout(800);
  const clicked = await page.evaluate(() => {
    const tabs = document.querySelectorAll('[class*="TAB_tabItem"]');
    for (const t of tabs) {
      const txt = (t.textContent || "").trim();
      // match review-status tabs only
      if (!txt.includes("??") || (!txt.includes("??") && !txt.includes("??"))) continue;
      t.click();
      return txt;
    }
    return null;
  }).catch(() => null);
  if (clicked) {
    logSilent(`[price-review] 鍒囧埌绛涢€?tab: ${clicked}`);
    await page.waitForTimeout(1500);
  } else {
    logSilent(`[price-review] 鏈壘鍒般€?{statusText}銆峵ab锛岀户缁敤榛樿瑙嗗浘`);
  }
}

async function scrapeCurrentPage(page) {
  // 绛夊緟琛ㄦ牸娓叉煋
  await page.waitForTimeout(1500);
  await page.waitForSelector('table tbody tr', { timeout: 15_000 }).catch(() => {});

  const rows = await page.evaluate(() => {
    const out = [];
    const firstNum = (txt) => {
      const m = String(txt || "").match(/(\d{6,})/);
      return m ? m[1] : "";
    };
    const parseMoney = (txt, key) => {
      // 濡?"鍘熺敵鎶ヤ环锛毬?5.60"
      const re = new RegExp(key + "[锛?]\\s*楼?\\s*([0-9]+(?:\\.[0-9]+)?)");
      const m = String(txt || "").match(re);
      return m ? Number(m[1]) : null;
    };
    const parsePctKey = (txt, key) => {
      const re = new RegExp(key + "[锛?]\\s*([0-9]+(?:\\.[0-9]+)?)\\s*%");
      const m = String(txt || "").match(re);
      return m ? Number(m[1]) : null;
    };
    const parseIntKey = (txt, key) => {
      const re = new RegExp(key + "[锛?]\\s*(\\d+)");
      const m = String(txt || "").match(re);
      return m ? Number(m[1]) : null;
    };

    // 琛岋細table tbody tr锛坈lass 鍙兘甯?TB_tr_5-120-1 鐗堟湰鍚庣紑锛屽鏉惧尮閰嶏級
    const trEls = document.querySelectorAll('table tbody tr');
    trEls.forEach((tr) => {
      const tds = tr.querySelectorAll("td");
      if (tds.length < 7) return;

      const td1 = tds[1]; // product info
      const td4 = tds[4]; // review status
      const td5 = tds[5]; // sku info
      const td6 = tds[6]; // 浠锋牸淇℃伅
      const td7 = tds[7]; // 鎿嶄綔 / 鏀逛环娆℃暟

      const td4Text = (td4?.innerText || "").replace(/\s+/g, " ").trim();
      // keep only price-review rows
      if (!td4Text.includes("??") || (!td4Text.includes("??") && !td4Text.includes("??"))) return;

      const td1Text = (td1?.innerText || "").replace(/\s+/g, " ").trim();
      const td6Text = (td6?.innerText || "").replace(/\s+/g, " ").trim();
      const td7Text = (td7?.innerText || "").replace(/\s+/g, " ").trim();

      // SPU
      const spuMatch = td1Text.match(/SPU[锛?]\s*(\d+)/);
      const spuId = spuMatch ? spuMatch[1] : firstNum(td1Text);

      // 涓诲浘
      const img = td1?.querySelector("img");
      const mainImage = img?.getAttribute("src") || img?.getAttribute("data-src") || "";

      // 鏍囬锛氬幓鎺?SPU 娈佃惤
      let title = td1Text.replace(/SPU[锛?]\s*\d+/g, "").replace(/楼\s*[0-9.]+/g, "").trim();
      if (title.length > 120) title = title.slice(0, 120);

      const skcId = firstNum(td4Text);
      const skuId = firstNum((td5?.innerText || "").trim());

      // 璇︽儏閾炬帴
      const detailA = td7?.querySelector("a");
      const detailUrl = detailA?.getAttribute("href") || "";

      out.push({
        spuId,
        skuId,
        skcId,
        title,
        mainImage,
        skuSpec: "",
        originalPrice: parseMoney(td6Text, "鍘熺敵鎶ヤ环"),
        sellerCurrentPrice: parseMoney(td6Text, "鍗栧褰撳墠鎶ヤ环"),
        referencePrice: parseMoney(td6Text, "鍙傝€冪敵鎶ヤ环"),
        priceDiff: parseMoney(td6Text, "浠峰樊"),
        priceDiffPct: null,
        reviewStatus: td4Text || td7Text || "",
        changeCount: parseIntKey(td7Text, "鏀逛环娆℃暟") || 0,
        detailUrl,
      });
    });
    return out;
  }).catch(() => []);

  return rows.filter((r) => r.skuId);
}

async function goToNextPage(page) {
  // Temu 鍒嗛〉锛氳嫢骞?.PGT_pagerItem_5-120-1 鏁板瓧鎸夐挳锛屽綋鍓嶉〉澶氫竴涓?PGT_pagerItemActive_5-120-1
  // 绛栫暐锛氭壘鍒?active 鐨?pagerItem锛岀偣鍑诲畠鍚庨潰鐨勯偅涓厔寮熻妭鐐癸紙鍗充笅涓€椤碉級
  const hasNext = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[class*="PGT_pagerItem"]'));
    if (items.length === 0) return false;
    const activeIdx = items.findIndex((el) =>
      /PGT_pagerItemActive/.test(el.className || "")
    );
    if (activeIdx < 0) return false;
    // 涓嬩竴涓厔寮熷繀椤讳篃鏄暟瀛楅〉锛堜笉鏄?"..." 涔熶笉鏄 disable 鐨勭澶达級
    const next = items[activeIdx + 1];
    if (!next) return false;
    const txt = (next.textContent || "").trim();
    if (!/^\d+$/.test(txt)) return false;
    next.click();
    return true;
  }).catch(() => false);
  if (hasNext) {
    await page.waitForTimeout(1800);
  }
  return hasNext;
}

function hashImage(url) {
  try {
    return crypto.createHash("md5").update(String(url)).digest("hex");
  } catch {
    return "";
  }
}
