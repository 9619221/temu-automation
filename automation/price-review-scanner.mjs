/**
 * 核价筛选器 - 扫描 Temu 卖家后台核价页
 *
 * 职责：
 *  1. 打开 Temu 后台核价列表，筛选「价格申报中」
 *  2. 翻页抓取所有 SKU 的原申报价 / 卖家当前报价 / 参考申报价 / 价差等字段
 *  3. 对每条 SKU 查询成本缓存（手填优先），无则调用 1688 图搜
 *  4. 计算 pass_175 = (卖家当前报价 >= 成本 × marginRatio)
 *  5. 整批写入 price_review_snapshot
 *
 * 不做：
 *  - 不点「查看并确认申报价」、不点「接受/放弃」按钮（人工复核）
 *
 * DOM 选择器状态：⚠️ 待首次运行对着真实页面填（代码里用 TODO 标出）
 */

import {
  savePriceReviewSnapshot,
  getPriceReviewCost,
  upsertPriceReviewCost,
} from "./yunqi-db.mjs";
import { logSilent } from "./utils.mjs";
import { browserState } from "./browser.mjs";
import { fetch1688CostByImage } from "./aliexpress-1688-cost.mjs";
import crypto from "crypto";

// ⚠️ TODO: 对着真实后台确认核价列表页 URL
//   截图侧边栏是「商品价格管理」，候选路径：
//     - https://seller.kuajingmaihuo.com/main/product/price-management
//     - https://seller.kuajingmaihuo.com/goods/price-management
//   首次跑 dev 时打开后台、复制地址栏到这里
const PRICE_REVIEW_LIST_URL = "https://seller.kuajingmaihuo.com/main/product/price-management";

// 「价格申报中」筛选参数（可能是 query string 或 tab 切换，运行时对照）
const REVIEW_STATUS_FILTER = "价格申报中";

/**
 * 主入口：执行一次完整扫描
 * @param {object} opts
 *   - marginRatio: 毛利倍率，默认 1.75
 *   - skip1688Search: 跳过图搜（一期调试时可 true，只抓列表）
 *   - onProgress: (stage, detail) => void
 * @returns {Promise<{ snapshotId, rows, summary, errors }>}
 */
export async function scanPriceReview(opts = {}) {
  const {
    marginRatio = 1.75,
    skip1688Search = false,
    onProgress = () => {},
  } = opts;

  const snapshotId = `pr_${Date.now()}`;
  const scannedAt = Date.now();
  const errors = [];

  // 1. 确保浏览器上下文存在
  const context = browserState.context;
  if (!context) {
    throw new Error("浏览器未启动，请先登录 Temu 后台");
  }

  onProgress("open_page", { url: PRICE_REVIEW_LIST_URL });

  // 2. 打开/复用核价页
  let page = null;
  const existingPages = context.pages() || [];
  for (const p of existingPages) {
    if (p.url().includes("price-management")) {
      page = p;
      break;
    }
  }
  if (!page) {
    page = await context.newPage();
    await page.goto(PRICE_REVIEW_LIST_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } else {
    await page.bringToFront().catch(() => {});
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
  }

  // 3. 切到「价格申报中」筛选
  await applyReviewStatusFilter(page, REVIEW_STATUS_FILTER).catch((e) => {
    errors.push({ stage: "apply_filter", message: String(e?.message || e) });
  });

  // 4. 翻页抓取
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
    if (pageNum > 200) break; // 安全上限
  }

  onProgress("scrape_done", { totalRaw: rawRows.length });

  // 5. 合并成本 + 计算 pass
  const finalRows = [];
  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    onProgress("resolve_cost", { index: i, total: rawRows.length, skuId: r.skuId });

    const cached = getPriceReviewCost(r.skuId);
    let cost1688 = cached?.cost_1688 ?? null;
    let costManual = cached?.cost_manual ?? null;
    let costSource = cached?.cost_source || "pending";

    // 手填值永远不被覆盖
    if (costManual == null && cost1688 == null && !skip1688Search && r.mainImage) {
      try {
        const searched = await fetch1688CostByImage(r.mainImage);
        if (searched && searched.price != null) {
          cost1688 = searched.price;
          costSource = "1688_image_search";
          upsertPriceReviewCost({
            skuId: r.skuId,
            mainImageHash: hashImage(r.mainImage),
            cost1688,
            costSource: "1688_image_search",
          });
        } else {
          costSource = "not_found";
          upsertPriceReviewCost({
            skuId: r.skuId,
            mainImageHash: hashImage(r.mainImage),
            costSource: "not_found",
          });
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

  // 6. 落库
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

// ============ DOM 抓取 ============
//
// ⚠️ 下列选择器均为占位 —— 首次跑 dev 时，打开核价页 F12，把真实
// 选择器填进来。截图参考的字段：
//   商品信息列：SPU / 标题 / 主图
//   SKC属性列：SKC ID
//   SKU属性集列：SKU ID / 规格
//   价格信息列：原申报价 / 卖家当前报价 / 参考申报价 / 价差 / 价差%
//   操作列：「查看并确认申报价」链接（作为 detailUrl）
//   分页：底部「共 N 条 每页 10 条 1/X」

async function applyReviewStatusFilter(page, statusText) {
  // TODO: 实测后填入真实切换动作。可能是：
  //   - 点击某个 tab `role=tab[name="价格申报中"]`
  //   - 或改 query string `?reviewStatus=IN_REVIEW` 后 goto
  logSilent(`[price-review] TODO applyReviewStatusFilter(${statusText})`);
}

async function scrapeCurrentPage(page) {
  // 等待表格渲染
  await page.waitForTimeout(1200);

  // TODO: 替换为真实列表容器选择器
  //   截图里每一行是一个大卡片，主图 + 标题 + 多条 SKU 行
  //   这里建议用 page.evaluate 一次性把整个列表序列化出来
  const rows = await page.evaluate(() => {
    // TODO: 实际选择器。下面是结构范例，运行时改
    const out = [];
    const rowEls = document.querySelectorAll("[data-testid='price-review-row'], .price-review-row");
    rowEls.forEach((el) => {
      const pick = (sel) => el.querySelector(sel)?.textContent?.trim() || "";
      const pickAttr = (sel, attr) => el.querySelector(sel)?.getAttribute(attr) || "";
      const parseNum = (txt) => {
        const m = String(txt || "").replace(/[^\d.-]/g, "");
        const n = parseFloat(m);
        return Number.isFinite(n) ? n : null;
      };
      const parsePct = (txt) => {
        const m = String(txt || "").replace(/[^\d.-]/g, "");
        const n = parseFloat(m);
        return Number.isFinite(n) ? n : null;
      };

      out.push({
        spuId: pick(".col-spu .spu-id"),
        skuId: pick(".col-sku .sku-id"),
        skcId: pick(".col-skc .skc-id"),
        title: pick(".col-goods .title"),
        mainImage: pickAttr(".col-goods img", "src"),
        skuSpec: pick(".col-sku .spec"),
        originalPrice: parseNum(pick(".col-price .original")),
        sellerCurrentPrice: parseNum(pick(".col-price .current")),
        referencePrice: parseNum(pick(".col-price .reference")),
        priceDiff: parseNum(pick(".col-price .diff-amount")),
        priceDiffPct: parsePct(pick(".col-price .diff-pct")),
        reviewStatus: pick(".col-price .status"),
        changeCount: parseNum(pick(".col-price .change-count")) || 0,
        detailUrl: pickAttr(".col-action a", "href"),
      });
    });
    return out;
  }).catch(() => []);

  return rows.filter((r) => r.skuId);
}

async function goToNextPage(page) {
  // TODO: 判断是否有下一页按钮可点
  //   截图右下角是数字分页 + 下一页箭头
  //   候选：page.locator('.ant-pagination-next:not(.ant-pagination-disabled)')
  const hasNext = await page.evaluate(() => {
    const btn = document.querySelector(".ant-pagination-next:not(.ant-pagination-disabled) button");
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  }).catch(() => false);
  if (hasNext) {
    await page.waitForTimeout(1500);
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
