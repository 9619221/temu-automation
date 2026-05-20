const fs = require("fs");
const path = require("path");
const { JushuitanWebCollector, DEFAULT_JST_URL } = require("../electron/erp/jushuitanWebCollector.cjs");

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const item = process.argv.find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLoginText(text) {
  return /登录|登陆|验证码|密码|账号|手机/.test(String(text || "").slice(0, 1500));
}

async function pageText(page) {
  const chunks = [];
  for (const frame of page.frames()) {
    const text = await frame.evaluate(() => String(document.body?.innerText || "")).catch(() => "");
    if (text.trim()) {
      chunks.push({
        frameName: frame.name(),
        frameUrl: frame.url(),
        text: text.slice(0, 3000),
      });
    }
  }
  return chunks;
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
      const all = [...document.querySelectorAll("a,button,[role='button'],[role='menuitem'],li,span,div")].filter(visible);
      for (const label of wanted) {
        const matches = all
          .map((el) => ({ el, text: clean(el.innerText || el.textContent || el.getAttribute("title")) }))
          .filter((item) => item.text && item.text.includes(label) && item.text.length <= 90)
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

function frameScore(frame) {
  const url = frame.url();
  if (/purchasemode\.aspx/i.test(url)) return 100;
  if (/purchase/i.test(url) && /scm/i.test(url)) return 80;
  if (/purchase/i.test(url)) return 50;
  return 0;
}

function findPurchaseFrame(page) {
  return page.frames()
    .map((frame) => ({ frame, score: frameScore(frame) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.frame || null;
}

async function summarizeFrame(frame) {
  return frame.evaluate(() => {
    const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const controls = [...document.querySelectorAll("button,a,input,select,textarea,[role='button'],[onclick]")]
      .filter(visible)
      .slice(0, 220)
      .map((el, index) => ({
        index,
        tag: el.tagName,
        type: el.getAttribute("type") || "",
        text: clean(el.innerText || el.textContent || el.value || el.getAttribute("title") || el.getAttribute("placeholder") || el.getAttribute("aria-label")),
        id: el.id || "",
        name: el.getAttribute("name") || "",
        cls: String(el.className || "").slice(0, 120),
      }))
      .filter((item) => item.text || item.id || item.name || item.cls);

    const tables = [...document.querySelectorAll("table")].map((table, tableIndex) => {
      const rect = table.getBoundingClientRect();
      const rows = [...table.querySelectorAll("tr")].filter(visible);
      const rowSamples = rows.slice(0, 8).map((row) => [...row.querySelectorAll("th,td")]
        .map((cell) => clean(cell.innerText || cell.textContent)).filter(Boolean));
      return {
        tableIndex,
        visible: visible(table),
        rows: rows.length,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        cls: String(table.className || "").slice(0, 120),
        id: table.id || "",
        rowSamples,
      };
    });

    const gridLike = [...document.querySelectorAll("[class*='grid'],[class*='datagrid'],[class*='table'],[role='grid']")]
      .filter(visible)
      .slice(0, 80)
      .map((el, index) => {
        const rect = el.getBoundingClientRect();
        return {
          index,
          tag: el.tagName,
          id: el.id || "",
          cls: String(el.className || "").slice(0, 160),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          text: clean(el.innerText || el.textContent).slice(0, 500),
        };
      });

    return {
      url: location.href,
      title: document.title,
      bodyText: clean(document.body?.innerText || "").slice(0, 5000),
      controls,
      tables,
      gridLike,
    };
  });
}

async function clickLoadControls(frame) {
  const clicked = [];
  const labels = ["查询", "搜索", "刷新", "今天", "近7天", "近30天", "确定"];
  for (const label of labels) {
    const result = await frame.evaluate((wanted) => {
      const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const all = [...document.querySelectorAll("button,a,input,[role='button'],[onclick]")].filter(visible);
      const candidates = all
        .map((el) => ({
          el,
          text: clean(el.innerText || el.textContent || el.value || el.getAttribute("title") || el.getAttribute("placeholder") || el.getAttribute("aria-label")),
        }))
        .filter((item) => item.text && item.text.includes(wanted) && item.text.length <= 50)
        .sort((a, b) => a.text.length - b.text.length);
      for (const item of candidates) {
        const target = item.el.closest("button,a,[role='button']") || item.el;
        try {
          target.scrollIntoView({ block: "center", inline: "center" });
          target.click();
          return { clicked: true, label: wanted, text: item.text };
        } catch {}
      }
      return { clicked: false, label: wanted };
    }, label).catch((error) => ({ clicked: false, label, error: error?.message || String(error) }));
    if (result.clicked) {
      clicked.push(result);
      await sleep(2500);
    }
  }
  return clicked;
}

async function main() {
  const outDir = path.resolve("logs");
  fs.mkdirSync(outDir, { recursive: true });

  const url = readArg("url", DEFAULT_JST_URL);
  const waitMs = Math.max(10_000, Math.min(Number(readArg("wait-ms", "180000")) || 180000, 1_800_000));
  const collector = new JushuitanWebCollector();
  const network = [];
  const startedAt = Date.now();

  try {
    const opened = await collector.open({ url });
    const page = await collector.getPage();
    page.on("response", async (response) => {
      try {
        const request = response.request();
        const resourceType = request.resourceType();
        const responseUrl = response.url();
        const contentType = response.headers()["content-type"] || "";
        if (!["xhr", "fetch", "document"].includes(resourceType)) return;
        if (!/json|text|javascript|html/i.test(contentType) && !/api|ajax|query|list|search|purchase/i.test(responseUrl)) return;
        const text = await response.text().catch(() => "");
        if (!text || network.length >= 120) return;
        network.push({
          url: responseUrl,
          method: request.method(),
          resourceType,
          status: response.status(),
          contentType,
          requestPostData: (request.postData() || "").slice(0, 1200),
          textSample: text.slice(0, 2500),
        });
      } catch {}
    });

    while (Date.now() - startedAt < waitMs) {
      const chunks = await pageText(page);
      const joined = chunks.map((item) => item.text).join("\n");
      const loginLikely = isLoginText(joined);
      console.log(JSON.stringify({
        step: "login-check",
        loginLikely,
        url: page.url(),
        title: await page.title().catch(() => ""),
      }));
      if (!loginLikely) break;
      await sleep(8000);
    }

    const click = await clickByLabels(page, ["采购单管理", "采购单"]);
    console.log(JSON.stringify({ step: "click-purchase", click }, null, 2));
    await sleep(3500);
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});

    let frame = findPurchaseFrame(page);
    if (!frame) {
      const purchaseUrl = "https://www.erp321.com/app/scm/purchase/purchasemode.aspx?_c=jst-epaas&epaas=true";
      const direct = await collector.getPage(purchaseUrl);
      await direct.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
      await direct.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
      frame = direct.mainFrame();
    }

    const before = frame ? await summarizeFrame(frame) : null;
    const clickedLoadControls = frame ? await clickLoadControls(frame) : [];
    await sleep(3500);
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    const after = frame ? await summarizeFrame(frame) : null;

    const shotPath = path.join(outDir, "jushuitan-purchase-debug.png");
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});

    const result = {
      opened,
      pageUrl: page.url(),
      pageTitle: await page.title().catch(() => ""),
      frames: page.frames().map((item, index) => ({
        index,
        name: item.name(),
        url: item.url(),
      })),
      purchaseFrameUrl: frame?.url() || "",
      clickedLoadControls,
      before,
      after,
      network,
      screenshot: shotPath,
    };
    const jsonPath = path.join(outDir, "jushuitan-purchase-debug.json");
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify({
      ok: true,
      jsonPath,
      screenshot: shotPath,
      purchaseFrameUrl: result.purchaseFrameUrl,
      beforeTables: before?.tables?.length || 0,
      afterTables: after?.tables?.length || 0,
      networkCount: network.length,
      clickedLoadControls,
    }, null, 2));
  } finally {
    await collector.close().catch(() => {});
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
