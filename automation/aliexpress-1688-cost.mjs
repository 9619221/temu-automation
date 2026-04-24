/**
 * 1688 图搜成本查询
 *
 * 策略：
 *  1. 打开独立 Chrome profile（避免污染主账号），访问 1688 图搜页
 *  2. 下载 Temu 主图到临时文件 → 上传到图搜框
 *  3. 抓前 N 个结果的单价，去掉最高/最低后取中位数
 *
 * ⚠️ 当前是骨架 —— chromium 启动、DOM 选择器、价格解析均待首次
 * 跑 dev 时对着真实页面填（代码里用 TODO 标出）
 *
 * 兜底：首次运行 profile 还没登录时，调用方会拿到 null，
 * UI 显示「未找到同款」灰色标，用户自己去 Settings 里触发一次登录
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

// 1688 图搜入口（截至本文档真实）
const SEARCH_ENTRY_URL = "https://s.1688.com/youyuan/index.htm";

// 从 Temu 图片 CDN 下载到本地的临时目录
const TMP_DIR = path.join(os.tmpdir(), "temu-auto-1688-search");

let _browser = null;
let _context = null;
let _profilePath = "";

/**
 * 外部可调：首次使用前登录 1688 账号
 * 调用时会弹出一个有头浏览器，用户手动扫码登录，登录态持久化到 profile
 */
export async function open1688LoginWindow(profilePath) {
  const effectivePath = profilePath || getDefaultProfilePath();
  fs.mkdirSync(effectivePath, { recursive: true });
  const browser = await chromium.launchPersistentContext(effectivePath, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.goto("https://login.1688.com/", { waitUntil: "domcontentloaded" });
  // 不关闭，让用户登录完自行关
  return { profilePath: effectivePath };
}

/**
 * 核心函数：用图片 URL 换 1688 成本价
 * @param {string} imageUrl - Temu 主图 URL
 * @param {object} opts - { profilePath, topN, priceStrategy: 'median'|'min' }
 * @returns {Promise<{ price: number|null, sampleCount: number, sampleUrl: string }>}
 */
export async function fetch1688CostByImage(imageUrl, opts = {}) {
  if (!imageUrl) return { price: null, sampleCount: 0 };

  const topN = opts.topN || 10;
  const strategy = opts.priceStrategy || "median";

  // 1. 下载图到本地
  const localPath = await downloadToTmp(imageUrl);
  if (!localPath) return { price: null, sampleCount: 0 };

  // 2. 确保浏览器/context 就绪
  await ensureBrowserContext(opts.profilePath);
  const page = await _context.newPage();

  let priceSamples = [];
  let resultUrl = "";

  try {
    // 3. 打开图搜页
    await page.goto(SEARCH_ENTRY_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // 4. TODO: 实测后填入上传输入框选择器
    //   候选：page.locator('input[type=file]')，可能需要点「上传图片」按钮先
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(localPath);

    // 5. 等结果页加载
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    resultUrl = page.url();

    // 6. 检测验证码（登录失效或反爬）
    const hasCaptcha = await page.evaluate(() => {
      return document.body?.innerText?.includes("滑动") ||
             document.body?.innerText?.includes("验证") ||
             !!document.querySelector(".nc_wrapper, .baxia-dialog");
    }).catch(() => false);
    if (hasCaptcha) {
      throw new Error("1688 图搜遇到验证码，请手动在浏览器中处理");
    }

    // 7. TODO: 实测后填入结果卡片 + 价格选择器
    //   候选容器：.sw-offer-list .offer-item 或 .list-offer-item
    //   价格节点：.sw-dpl-offer-price / .price-num
    const rawPrices = await page.evaluate((limit) => {
      const out = [];
      const items = document.querySelectorAll(".sw-offer-list .offer-item, .list-offer-item, [data-offer-id]");
      for (let i = 0; i < Math.min(items.length, limit); i++) {
        const el = items[i];
        const priceText = el.querySelector(".sw-dpl-offer-price, .price, .price-num, [class*=price]")?.textContent || "";
        const num = parseFloat(priceText.replace(/[^\d.]/g, ""));
        if (Number.isFinite(num) && num > 0) out.push(num);
      }
      return out;
    }, topN).catch(() => []);

    priceSamples = rawPrices;
  } finally {
    await page.close().catch(() => {});
  }

  const price = pickPrice(priceSamples, strategy);
  return { price, sampleCount: priceSamples.length, sampleUrl: resultUrl };
}

/**
 * 关闭图搜浏览器（定时任务跑完可以回收）
 */
export async function close1688Browser() {
  try {
    if (_context) await _context.close();
  } catch {}
  _context = null;
  _browser = null;
}

// ============ 内部工具 ============

function getDefaultProfilePath() {
  const base = process.env.APPDATA || path.join(os.homedir(), ".config");
  return path.join(base, "temu-automation", "1688-search-profile");
}

async function ensureBrowserContext(profilePath) {
  const effectivePath = profilePath || _profilePath || getDefaultProfilePath();
  if (_context && _profilePath === effectivePath) return;
  if (_context) {
    try { await _context.close(); } catch {}
    _context = null;
  }
  fs.mkdirSync(effectivePath, { recursive: true });
  _profilePath = effectivePath;
  _context = await chromium.launchPersistentContext(effectivePath, {
    headless: false, // 验证码/登录失效时需要人工介入，保持有头
    viewport: { width: 1280, height: 800 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

async function downloadToTmp(imageUrl) {
  try {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const hash = crypto.createHash("md5").update(imageUrl).digest("hex");
    const ext = path.extname(new URL(imageUrl).pathname) || ".jpg";
    const filePath = path.join(TMP_DIR, `${hash}${ext}`);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 100) return filePath;
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buf);
    return filePath;
  } catch (e) {
    return null;
  }
}

function pickPrice(samples, strategy) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  if (strategy === "min") return sorted[0];
  // median 策略：去掉最高最低后取中位数
  const trimmed = sorted.length >= 4 ? sorted.slice(1, -1) : sorted;
  const mid = Math.floor(trimmed.length / 2);
  if (trimmed.length % 2 === 0) {
    return Number(((trimmed[mid - 1] + trimmed[mid]) / 2).toFixed(2));
  }
  return trimmed[mid];
}
