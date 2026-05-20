const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_JST_URL = "https://www.erp321.com/";
const MAX_JSON_RECORDS_PER_RESPONSE = 800;

function optionalString(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAppDataRoot() {
  return process.env.APP_USER_DATA
    || process.env.TEMU_USER_DATA
    || path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "temu-automation");
}

function findChromeExecutable() {
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    localAppData && path.join(localAppData, "Google/Chrome/Application/chrome.exe"),
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    localAppData && path.join(localAppData, "Microsoft/Edge/Application/msedge.exe"),
  ].filter(Boolean);
  return candidates.find((item) => fs.existsSync(item)) || null;
}

function collectJsonRecords(value, out, pathParts = [], depth = 0) {
  if (out.length >= MAX_JSON_RECORDS_PER_RESPONSE || depth > 8 || value == null) return;
  if (Array.isArray(value)) {
    const objectItems = value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
    if (objectItems.length > 0) {
      objectItems.slice(0, MAX_JSON_RECORDS_PER_RESPONSE - out.length).forEach((item, index) => {
        out.push({
          ...item,
          __jst_web_kind: "json",
          __jst_web_json_path: pathParts.join(".") || "$",
          __jst_web_json_index: index + 1,
        });
      });
      return;
    }
    value.forEach((item, index) => collectJsonRecords(item, out, [...pathParts, String(index)], depth + 1));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectJsonRecords(child, out, [...pathParts, key], depth + 1);
      if (out.length >= MAX_JSON_RECORDS_PER_RESPONSE) return;
    }
  }
}

function parseJsonText(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const legacyMatch = raw.match(/^\d+\|([\s\S]*)$/);
  const candidate = legacyMatch ? legacyMatch[1].trim() : raw;
  if (!candidate || !/^[{[]/.test(candidate)) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function inflateJsonStrings(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (typeof value === "string") {
    const parsed = parseJsonText(value);
    return parsed == null ? value : inflateJsonStrings(parsed, depth + 1);
  }
  if (Array.isArray(value)) {
    return value.map((item) => inflateJsonStrings(item, depth + 1));
  }
  if (typeof value === "object") {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      next[key] = inflateJsonStrings(child, depth + 1);
    }
    return next;
  }
  return value;
}

function parseResponsePayload(text) {
  const parsed = parseJsonText(text);
  return parsed == null ? null : inflateJsonStrings(parsed);
}

function extractLegacyMethod(url, postData) {
  const methods = [];
  try {
    const parsedUrl = new URL(url);
    const am = parsedUrl.searchParams.get("am___");
    if (am) methods.push(am);
  } catch {}
  try {
    const params = new URLSearchParams(String(postData || ""));
    const callbackParam = params.get("__CALLBACKPARAM");
    if (callbackParam) {
      const parsed = JSON.parse(callbackParam);
      if (parsed?.Method) methods.push(parsed.Method);
    }
  } catch {}
  return [...new Set(methods.filter(Boolean))].join("/");
}

async function extractDomRecordsFromFrame(frame, frameMeta = {}) {
  return frame.evaluate((meta) => {
    const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const records = [];
    const seen = new Set();

    const pushRecord = (record) => {
      const pairs = Object.entries(record).filter(([key, value]) => !key.startsWith("__") && clean(value));
      const minPairs = record.__jst_web_kind === "table" || record.__jst_web_kind === "grid" ? 3 : 2;
      if (pairs.length < minPairs) return;
      const signature = JSON.stringify(pairs);
      if (seen.has(signature)) return;
      seen.add(signature);
      records.push({
        ...record,
        __jst_web_frame_index: meta.frameIndex,
        __jst_web_frame_name: meta.frameName,
        __jst_web_frame_url: meta.frameUrl,
      });
    };

    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };

    document.querySelectorAll("table").forEach((table, tableIndex) => {
      if (!visible(table)) return;
      const tableIdentity = `${table.id || ""} ${table.className || ""}`;
      if (/_jt_toolbar|prompt_|toolbar|dialog/i.test(tableIdentity)) return;
      const headerCells = [
        ...table.querySelectorAll("thead tr:last-child th"),
      ];
      let headers = headerCells.map((cell) => clean(cell.innerText || cell.textContent));
      const rows = [...table.querySelectorAll("tbody tr")].filter(visible);
      if (!headers.length && rows.length) {
        const firstCells = [...rows[0].querySelectorAll("th,td")].map((cell) => clean(cell.innerText || cell.textContent));
        const looksLikeHeader = firstCells.some((text) => /编号|单号|名称|状态|时间|日期|数量|金额|SKU|sku/.test(text));
        if (looksLikeHeader) {
          headers = firstCells;
          rows.shift();
        }
      }
      rows.forEach((row, rowIndex) => {
        const cells = [...row.querySelectorAll("td,th")].map((cell) => clean(cell.innerText || cell.textContent));
        if (cells.filter(Boolean).length < 3) return;
        const record = {
          __jst_web_kind: "table",
          __jst_web_table_index: tableIndex + 1,
          __jst_web_row_index: rowIndex + 1,
        };
        cells.forEach((text, index) => {
          const key = headers[index] || `col_${index + 1}`;
          record[key] = text;
        });
        pushRecord(record);
      });
    });

    if (records.length === 0) {
      const roleRows = [...document.querySelectorAll('[role="row"]')].filter(visible);
      roleRows.forEach((row, rowIndex) => {
        const cells = [...row.querySelectorAll('[role="cell"],[role="gridcell"],td,th')].filter(visible);
        if (cells.length < 2) return;
        const record = {
          __jst_web_kind: "grid",
          __jst_web_row_index: rowIndex + 1,
        };
        cells.forEach((cell, index) => {
          record[`col_${index + 1}`] = clean(cell.innerText || cell.textContent);
        });
        pushRecord(record);
      });
    }

    const title = clean(document.title);
    const heading = clean(document.querySelector("h1,h2,.ant-page-header-heading-title,[class*='title']")?.textContent || "");
    return {
      url: location.href,
      title,
      heading,
      records: records.slice(0, 5000),
      textSample: clean(document.body?.innerText || "").slice(0, 1600),
      loginLikely: /登录|登陆|验证码|密码|账号|手机/.test(clean(document.body?.innerText || "").slice(0, 1200)),
    };
  }, frameMeta);
}

async function extractDomRecords(page) {
  const frames = page.frames();
  const frameResults = [];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const frameUrl = frame.url();
    if (!frameUrl || frameUrl === "about:blank") continue;
    if (index > 0) {
      const isVisible = await frame.frameElement()
        .then((element) => element.evaluate((node) => {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== "none"
            && style.visibility !== "hidden"
            && !node.hidden
            && rect.width > 20
            && rect.height > 20;
        }))
        .catch(() => false);
      if (!isVisible) continue;
    }
    try {
      const result = await extractDomRecordsFromFrame(frame, {
        frameIndex: index,
        frameName: frame.name(),
        frameUrl,
      });
      frameResults.push(result);
    } catch {}
  }
  const main = frameResults[0] || {
    url: page.url(),
    title: "",
    heading: "",
    records: [],
    textSample: "",
    loginLikely: false,
  };
  return {
    url: page.url(),
    title: await page.title().catch(() => main.title || ""),
    heading: main.heading || "",
    records: frameResults.flatMap((item) => item.records || []),
    textSample: frameResults.map((item) => item.textSample || "").filter(Boolean).join("\n").slice(0, 1600),
    loginLikely: frameResults.some((item) => item.loginLikely),
  };
}

async function clickNextPage(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const disabled = (el) => {
      if (!el) return true;
      if (el.disabled) return true;
      if (el.getAttribute("aria-disabled") === "true") return true;
      const cls = String(el.className || "");
      return /disabled|ant-pagination-disabled/.test(cls);
    };
    const candidates = [
      ...document.querySelectorAll(".ant-pagination-next, [aria-label='Next Page'], [title='下一页'], button, a, [role='button']"),
    ];
    for (const el of candidates) {
      const text = clean(el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("title"));
      const cls = String(el.className || "");
      const isNext = text === "下一页" || text === "下页" || text === "Next Page" || text === ">" || /pagination-next/.test(cls);
      if (!isNext || disabled(el)) continue;
      const target = el.querySelector("button,a") || el;
      if (disabled(target)) continue;
      target.click();
      return true;
    }
    return false;
  });
}

async function triggerCurrentPageSearch(page) {
  const frames = page.frames();
  const orderedFrames = [
    ...frames.filter((_, index) => index > 0),
    ...frames.filter((_, index) => index === 0),
  ];
  for (const frame of orderedFrames) {
    const result = await frame.evaluate(() => {
      const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const disabled = (el) => Boolean(
        el?.disabled
        || el?.getAttribute("aria-disabled") === "true"
        || /disabled/.test(String(el?.className || ""))
      );
      const controls = [...document.querySelectorAll("a,button,input,[role='button']")]
        .filter((el) => visible(el) && !disabled(el))
        .map((el) => ({
          el,
          text: clean(el.innerText || el.textContent || el.value || el.getAttribute("title") || el.getAttribute("aria-label")),
          cls: String(el.className || ""),
        }));
      const candidates = controls.filter((item) => {
        if (/保存查询池|重置|删除|作废|取消|导出|打印|新增|审核|生成|付款|保存/.test(item.text)) return false;
        return item.text === "搜索"
          || item.text === "查询"
          || item.text === "刷新"
          || /\bsearch\b/i.test(item.cls);
      }).sort((a, b) => {
        const aScore = a.text === "搜索" || a.text === "查询" ? 0 : 1;
        const bScore = b.text === "搜索" || b.text === "查询" ? 0 : 1;
        return aScore - bScore || a.text.length - b.text.length;
      });
      for (const item of candidates) {
        const target = item.el.closest("a,button,[role='button']") || item.el;
        try {
          target.scrollIntoView({ block: "center", inline: "center" });
          target.click();
          return { clicked: true, text: item.text, className: item.cls };
        } catch {}
      }
      return { clicked: false };
    }).catch((error) => ({ clicked: false, error: error?.message || String(error) }));
    if (result.clicked) return result;
  }
  return { clicked: false };
}

async function setLegacyPageSize(page, pageSize) {
  const size = Number(pageSize);
  if (!Number.isFinite(size) || size <= 0) return { changed: false };
  const frames = page.frames();
  const orderedFrames = [
    ...frames.filter((_, index) => index > 0),
    ...frames.filter((_, index) => index === 0),
  ];
  for (const frame of orderedFrames) {
    const result = await frame.evaluate((wantedSize) => {
      const select = document.querySelector("#_jt_page_size");
      if (!select) return { changed: false, reason: "missing" };
      const option = [...select.options].find((item) => Number(item.value) === wantedSize)
        || [...select.options].sort((a, b) => Number(b.value) - Number(a.value))[0];
      if (!option) return { changed: false, reason: "no-options" };
      if (select.value === option.value) return { changed: false, value: select.value };
      select.value = option.value;
      try {
        if (window.jTable && typeof window.jTable.SetPageSize === "function") {
          window.jTable.SetPageSize(select);
        } else {
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } catch {
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return { changed: true, value: option.value };
    }, size).catch((error) => ({ changed: false, error: error?.message || String(error) }));
    if (result.changed || result.value) return result;
  }
  return { changed: false };
}

class JushuitanWebCollector {
  constructor(options = {}) {
    this.userDataDir = options.userDataDir || path.join(getAppDataRoot(), "jushuitan-chrome-profile");
    this.context = null;
    this.launchPromise = null;
    this.lastPage = null;
  }

  async ensureContext() {
    if (this.context) return this.context;
    if (this.launchPromise) return this.launchPromise;
    this.launchPromise = (async () => {
      const { chromium } = require("playwright");
      fs.mkdirSync(this.userDataDir, { recursive: true });
      const executablePath = findChromeExecutable();
      const context = await chromium.launchPersistentContext(this.userDataDir, {
        executablePath: executablePath || undefined,
        headless: false,
        viewport: { width: 1440, height: 900 },
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--no-default-browser-check",
        ],
      });
      this.context = context;
      this.launchPromise = null;
      return context;
    })();
    return this.launchPromise;
  }

  async getPage(url) {
    const context = await this.ensureContext();
    const pages = context.pages().filter((page) => !page.isClosed());
    const jstPage = [...pages].reverse().find((page) => /erp321|jushuitan|jst/i.test(page.url()));
    const hadPage = Boolean(jstPage || this.lastPage || pages[0]);
    const page = jstPage || this.lastPage || pages[0] || await context.newPage();
    this.lastPage = page;
    const targetUrl = optionalString(url) || (!hadPage ? DEFAULT_JST_URL : "");
    if (targetUrl && page.url() !== targetUrl) {
      try {
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      } catch (error) {
        const fallbackUrl = targetUrl.startsWith("https://www.erp321.com/")
          ? targetUrl.replace(/^https:/i, "http:")
          : "";
        if (!fallbackUrl) throw error;
        console.error(`[jst-web] navigation failed, retrying ${fallbackUrl}: ${error?.message || error}`);
        await page.goto(fallbackUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      }
    }
    return page;
  }

  async open(options = {}) {
    const page = await this.getPage(optionalString(options.url) || DEFAULT_JST_URL);
    await page.bringToFront().catch(() => {});
    return {
      opened: true,
      url: page.url(),
      title: await page.title().catch(() => ""),
      userDataDir: this.userDataDir,
    };
  }

  async collect(options = {}) {
    const page = await this.getPage(optionalString(options.url));
    const maxPages = Math.max(1, Math.min(Number(options.maxPages) || 1, 300));
    const maxScrolls = Math.max(0, Math.min(Number(options.maxScrolls) || 4, 20));
    const autoNext = options.autoNext === true;
    const captureNetwork = options.captureNetwork !== false;
    const triggerSearch = options.triggerSearch !== false;
    const pageSize = Math.max(0, Math.min(Number(options.pageSize) || 0, 500));
    const maxNetworkRecords = Math.max(1000, Math.min(Number(options.maxNetworkRecords || options.maxRecords) || 30000, 80000));
    const networkRecords = [];
    const responseUrls = new Set();

    const onResponse = async (response) => {
      if (!captureNetwork || networkRecords.length >= maxNetworkRecords) return;
      try {
        const request = response.request();
        const resourceType = request.resourceType();
        const url = response.url();
        const postData = request.postData() || "";
        const contentType = response.headers()["content-type"] || "";
        if (!/json|javascript|text\/plain|text\/html/i.test(contentType)
          && !/api|ajax|query|list|search|load|aspx|ashx|webapi/i.test(url + postData)) return;
        if (!["xhr", "fetch", "document"].includes(resourceType)) return;
        const requestSignature = `${request.method()} ${url} ${postData.slice(0, 500)}`;
        if (responseUrls.has(requestSignature)) return;
        responseUrls.add(requestSignature);
        const text = await response.text().catch(() => "");
        const json = parseResponsePayload(text);
        if (!json) return;
        const bucket = [];
        collectJsonRecords(json, bucket);
        const legacyMethod = extractLegacyMethod(url, postData);
        bucket.forEach((item) => {
          networkRecords.push({
            ...item,
            __jst_web_response_url: url,
            __jst_web_response_status: response.status(),
            __jst_web_legacy_method: legacyMethod,
          });
        });
      } catch {}
    };

    page.on("response", onResponse);
    const pages = [];
    try {
      await page.bringToFront().catch(() => {});
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      if (pageSize) {
        await setLegacyPageSize(page, pageSize).catch(() => ({ changed: false }));
        await sleep(1800);
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      }
      if (triggerSearch) {
        await triggerCurrentPageSearch(page).catch(() => ({ clicked: false }));
        await sleep(1800);
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      }

      for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
        for (let i = 0; i < maxScrolls; i += 1) {
          await page.evaluate(() => {
            const scrollers = [
              document.scrollingElement,
              ...document.querySelectorAll(".ant-table-body,.ant-table-content,[class*='scroll'],[class*='Scroll']"),
            ].filter(Boolean);
            scrollers.forEach((el) => {
              try { el.scrollTop = el.scrollHeight; } catch {}
            });
          }).catch(() => {});
          await sleep(450);
        }

        const dom = await extractDomRecords(page);
        pages.push({ ...dom, pageIndex });
        if (!autoNext || pageIndex >= maxPages) break;
        const moved = await clickNextPage(page).catch(() => false);
        if (!moved) break;
        await sleep(1200);
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      }
    } finally {
      page.off("response", onResponse);
    }

    const domRecords = pages.flatMap((pageInfo) => (
      (pageInfo.records || []).map((record) => ({
        ...record,
        __jst_web_page_index: pageInfo.pageIndex,
        __jst_web_page_url: pageInfo.url,
        __jst_web_page_title: pageInfo.title,
        __jst_web_page_heading: pageInfo.heading,
      }))
    ));
    return {
      url: page.url(),
      title: await page.title().catch(() => ""),
      pageCount: pages.length,
      domCount: domRecords.length,
      networkCount: networkRecords.length,
      loginLikely: pages.some((item) => item.loginLikely),
      textSample: pages[0]?.textSample || "",
      records: [...domRecords, ...networkRecords].slice(0, Math.max(1, Math.min(Number(options.maxRecords) || 30000, 80000))),
    };
  }

  async close() {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.lastPage = null;
    }
    return { closed: true };
  }
}

module.exports = {
  DEFAULT_JST_URL,
  JushuitanWebCollector,
};
