const { openErpDatabase } = require("../electron/db/connection.cjs");
const { runMigrations } = require("../electron/db/migrate.cjs");
const { JushuitanWebCollector, DEFAULT_JST_URL } = require("../electron/erp/jushuitanWebCollector.cjs");
const { JushuitanService } = require("../electron/erp/services/jushuitanService.cjs");

const TARGETS = [
  { sourceKey: "shops", labels: ["店铺设置", "店铺资料", "店铺管理"], url: "https://src.erp321.com/erp-web-group/erp-web-shop/shop" },
  { sourceKey: "warehouses", labels: ["仓库", "仓库资料", "仓库管理", "分仓"], url: "https://www.erp321.com/app/wms/partner/partnerTab.aspx?_c=jst-epaas&epaas=true" },
  { sourceKey: "suppliers", labels: ["供应商", "供应商管理", "供应商资料"], url: "https://www.erp321.com/app/user/Supplier/Supplier.aspx?_c=jst-epaas&epaas=true" },
  { sourceKey: "sku", labels: ["商品及库存管理(普通商品资料)", "普通商品资料", "商品资料", "商品列表"], url: "https://src.erp321.com/erp-web-group/erp-scm-goods/goodsInventoryManagement?tabAllow=camera" },
  { sourceKey: "skumap", labels: ["1688商品映射", "店铺商品映射", "店铺商品", "线上商品"], url: "https://www.erp321.com/app/scm/1688/Index/ItemMapIndex.aspx?_c=jst-epaas&epaas=true" },
  { sourceKey: "inventory", labels: ["商品库存结构分析", "组合装商品及库存", "库存查询", "商品库存"], url: "https://src.erp321.com/erp-web-group/erp-scm-goods/stockInventoryManagement?tabAllow=camera" },
  { sourceKey: "purchase", labels: ["采购单管理", "采购单"], url: "https://www.erp321.com/app/scm/purchase/purchasemode.aspx?_c=jst-epaas&epaas=true" },
  { sourceKey: "purchase_in", labels: ["采购入库", "进仓单", "入库单"], url: "https://www.erp321.com/app/scm/purchasein/purchasein.aspx?_c=jst-epaas&epaas=true" },
  { sourceKey: "purchase_out", labels: ["采购退货", "退货出库"], url: "https://www.erp321.com/app/scm/purchaseout/purchaseout.aspx?_c=jst-epaas&epaas=true" },
  { sourceKey: "orders", labels: ["订单全流程", "订单查询", "订单管理", "线上订单", "订单"], url: "https://www.erp321.com/app/order/order/list.aspx?_c=jst-epaas&epaas=true" },
  { sourceKey: "sales_out", labels: ["订单|售后单|出库单归档", "销售出库", "出库单", "发货单"], url: "https://www.erp321.com/app/wms/saleout/saleout.aspx?_c=jst-epaas&epaas=true" },
  { sourceKey: "refunds", labels: ["送仓售后(退货退款)", "售后(极速版)", "售后单", "退货退款", "退款"], url: "https://www.erp321.com/app/Service/aftersale/aftersale.aspx?_c=jst-epaas&epaas=true" },
  { sourceKey: "logistics", labels: ["发货信息", "物流", "快递"], url: "https://www.erp321.com/app/iop/shipping/UploadShipping.aspx?_c=jst-epaas&epaas=true" },
];

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const item = process.argv.find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

function readNumberArg(name, fallback) {
  const number = Number(readArg(name, ""));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pageText(page) {
  return page.evaluate(() => String(document.body?.innerText || "").slice(0, 3000)).catch(() => "");
}

function isLoginText(text) {
  return /登录|登陆|验证码|密码|账号|手机/.test(String(text || "").slice(0, 1500));
}

async function clickByLabels(page, labels) {
  const frames = page.frames();
  const orderedFrames = [
    ...frames.filter((_, index) => index > 0),
    ...frames.filter((_, index) => index === 0),
  ];
  for (const frame of orderedFrames) {
    const frameIndex = frames.indexOf(frame);
    const result = await frame.evaluate((wanted) => {
    const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const all = [...document.querySelectorAll("a,button,[role='menuitem'],li,span,div")].filter(visible);
    for (const label of wanted) {
      const matches = all
        .map((el) => ({ el, text: clean(el.innerText || el.textContent || el.getAttribute("title")) }))
        .filter((item) => item.text && item.text.includes(label) && item.text.length <= 80)
        .sort((a, b) => a.text.length - b.text.length);
      for (const item of matches) {
        const target = item.el.closest("[class*='shortcut'],[class*='groupItem'],a,button,[role='button'],[role='menuitem'],li") || item.el;
        try {
          target.scrollIntoView({ block: "center", inline: "center" });
          target.click();
          return { clicked: true, label, text: item.text };
        } catch {}
      }
    }
      return { clicked: false, labels: wanted };
    }, labels).catch((error) => ({ clicked: false, error: error?.message || String(error) }));
    if (result.clicked) {
      return {
        ...result,
        frameIndex,
        frameName: frame.name(),
        frameUrl: frame.url(),
      };
    }
  }
  return { clicked: false, labels };
}

async function waitForLabels(page, labels, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const frame of page.frames()) {
      const found = await frame.evaluate((wanted) => {
        const text = String(document.body?.innerText || "");
        return wanted.some((label) => text.includes(label));
      }, labels).catch(() => false);
      if (found) return true;
    }
    await sleep(600);
  }
  return false;
}

async function expandLikelyMenus(page) {
  await page.evaluate(() => {
    const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const roots = ["商品", "采购", "库存", "订单", "售后", "仓储", "基础资料", "资料", "报表"];
    const items = [...document.querySelectorAll("a,button,[role='menuitem'],li,span,div")].filter(visible);
    for (const item of items) {
      const text = clean(item.innerText || item.textContent || item.getAttribute("title"));
      if (!text || text.length > 30) continue;
      if (!roots.some((root) => text.includes(root))) continue;
      const target = item.closest("a,button,[role='menuitem'],li") || item;
      try { target.click(); } catch {}
    }
  }).catch(() => {});
  await sleep(700);
}

async function main() {
  const url = readArg("url", DEFAULT_JST_URL);
  const maxPages = Math.max(1, Math.min(readNumberArg("pages", 3), 300));
  const pageSize = Math.max(1, Math.min(readNumberArg("page-size", 500), 500));
  const maxRecords = Math.max(1000, Math.min(readNumberArg("max-records", 30000), 80000));
  const waitMs = Math.max(10_000, Math.min(readNumberArg("wait-ms", 600_000), 1_800_000));
  const requestedTargets = readArg("targets", "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const targets = requestedTargets.length
    ? TARGETS.filter((target) => requestedTargets.includes(target.sourceKey))
    : TARGETS;
  const startedAt = Date.now();

  const db = openErpDatabase();
  await runMigrations({ db });

  const collector = new JushuitanWebCollector();
  const service = new JushuitanService({
    db,
    webCollectorFactory: () => collector,
  });

  try {
    const opened = await service.openWebCollector({ url });
    console.log(JSON.stringify({ step: "opened", ...opened }, null, 2));
    const page = await collector.getPage();

    while (Date.now() - startedAt < waitMs) {
      const text = await pageText(page);
      const currentUrl = page.url();
      const title = await page.title().catch(() => "");
      const loginLikely = isLoginText(text);
      console.log(JSON.stringify({ step: "login-check", loginLikely, url: currentUrl, title }));
      if (!loginLikely) break;
      await sleep(8000);
    }

    const currentText = await pageText(page);
    if (isLoginText(currentText)) {
      console.log(JSON.stringify({
        ok: false,
        needLogin: true,
        message: "仍在登录页，先在打开的聚水潭浏览器完成登录。",
        url: page.url(),
        title: await page.title().catch(() => ""),
      }, null, 2));
      process.exitCode = 2;
      return;
    }

    const summary = [];
    for (const target of targets) {
      let clicked = { clicked: true, direct: true, url: target.url };
      if (!target.url) {
        await waitForLabels(page, target.labels);
        clicked = await clickByLabels(page, target.labels);
      }
      console.log(JSON.stringify({ step: target.url ? "open-target" : "click-target", sourceKey: target.sourceKey, clicked }));
      if (!clicked.clicked && !target.url) {
        summary.push({ sourceKey: target.sourceKey, clicked: false, importedRows: 0 });
        continue;
      }
      const targetPage = target.url ? await collector.getPage(target.url) : page;
      await sleep(1800);
      await targetPage.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      await targetPage.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      const result = await service.collectWebPage({
        url: target.url || "",
        sourceKey: target.sourceKey,
        maxPages,
        pageSize,
        maxRecords,
        maxScrolls: 5,
        autoNext: maxPages > 1,
        captureNetwork: true,
      }, { role: "admin", companyId: "company_default" });
      const item = {
        sourceKey: target.sourceKey,
        clicked: true,
        importedRows: result.importedRows,
        domCount: result.domCount,
        networkCount: result.networkCount,
        pageCount: result.pageCount,
        url: result.url,
        title: result.title,
      };
      console.log(JSON.stringify({ step: "collected", ...item }));
      summary.push(item);
    }

    console.log(JSON.stringify({
      ok: true,
      totalImportedRows: summary.reduce((sum, item) => sum + Number(item.importedRows || 0), 0),
      summary,
    }, null, 2));
  } finally {
    await collector.close().catch(() => {});
    db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error),
    stack: error?.stack || "",
  }, null, 2));
  process.exitCode = 1;
});
