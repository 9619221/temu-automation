const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu, net: electronNet, session: electronSession } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const fs = require("fs");
const crypto = require("crypto");
const XLSX = require("xlsx");
const { autoUpdater } = require("electron-updater");
const { getDefaultCredentials } = require("./default-credentials.cjs");

// 全局捕获未处理异常，防止 EPIPE 等 pipe 错误崩溃 Electron
process.on("uncaughtException", (err) => {
  if (err.code === "EPIPE" || err.code === "ERR_STREAM_DESTROYED") return; // 忽略 pipe 错误
  console.error("[Main] Uncaught exception:", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Main] Unhandled rejection:", reason);
});

let mainWindow = null;
let worker = null;
const DEFAULT_WORKER_PORT = Number(process.env.TEMU_WORKER_PORT) > 0 ? Number(process.env.TEMU_WORKER_PORT) : 19280;
let workerPort = DEFAULT_WORKER_PORT;
let workerReady = false;
let workerAiImageServer = "";
let workerAuthToken = "";
let workerStartPromise = null;
let workerStartTargetAiImageServer = "";
const AUTO_PRICING_TASKS_KEY = "temu_auto_pricing_tasks";
const AUTO_PRICING_TASK_LIMIT = 20;
const CREATE_HISTORY_KEY = "temu_create_history";
const ACCOUNT_STORE_KEY = "temu_accounts";
const ACTIVE_ACCOUNT_ID_KEY = "temu_active_account_id";
const ACCOUNT_SCOPED_STORE_KEYS = new Set([
  "temu_collection_diagnostics",
  "temu_create_history",
  "temu_dashboard",
  "temu_products",
  "temu_orders",
  "temu_sales",
  "temu_flux",
  "temu_raw_goodsData",
  "temu_raw_lifecycle",
  "temu_raw_yunduOverall",
  "temu_raw_globalPerformance",
  "temu_raw_yunduActivityList",
  "temu_raw_yunduQualityMetrics",
  "temu_raw_imageTask",
  "temu_raw_sampleManage",
  "temu_raw_activity",
  "temu_raw_activityLog",
  "temu_raw_activityUS",
  "temu_raw_activityEU",
  "temu_raw_chanceGoods",
  "temu_raw_marketingActivity",
  "temu_raw_urgentOrders",
  "temu_raw_shippingDesk",
  "temu_raw_shippingList",
  "temu_raw_addressManage",
  "temu_raw_returnOrders",
  "temu_raw_returnDetail",
  "temu_raw_salesReturn",
  "temu_raw_returnReceipt",
  "temu_raw_exceptionNotice",
  "temu_raw_afterSales",
  "temu_raw_soldout",
  "temu_raw_performance",
  "temu_raw_checkup",
  "temu_raw_qualityDashboard",
  "temu_raw_qualityDashboardEU",
  "temu_raw_qcDetail",
  "temu_raw_priceReport",
  "temu_raw_priceCompete",
  "temu_raw_flowPrice",
  "temu_raw_retailPrice",
  "temu_raw_mallFlux",
  "temu_raw_mallFluxEU",
  "temu_raw_mallFluxUS",
  "temu_raw_fluxEU",
  "temu_raw_fluxUS",
  "temu_raw_flowGrow",
  "temu_raw_governDashboard",
  "temu_raw_governProductQualification",
  "temu_raw_governQualificationAppeal",
  "temu_raw_governEprQualification",
  "temu_raw_governProductPhoto",
  "temu_raw_governComplianceInfo",
  "temu_raw_governResponsiblePerson",
  "temu_raw_governManufacturer",
  "temu_raw_governComplaint",
  "temu_raw_governViolationAppeal",
  "temu_raw_governMerchantAppeal",
  "temu_raw_governTro",
  "temu_raw_governEprBilling",
  "temu_raw_governComplianceReference",
  "temu_raw_governCustomsAttribute",
  "temu_raw_governCategoryCorrection",
  "temu_raw_delivery",
  "temu_raw_adsHome",
  "temu_raw_adsProduct",
  "temu_raw_adsReport",
  "temu_raw_adsFinance",
  "temu_raw_adsHelp",
  "temu_raw_adsNotification",
  "temu_raw_usRetrieval",
]);
let autoPricingTaskPromise = null;
let autoPricingTaskSyncTimer = null;
let autoPricingCurrentTaskId = null;
const WORKER_HTTP_TIMEOUT_MS = 5 * 60 * 1000;
const STORE_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

const AUTO_PRICING_FILTER_KEYWORDS = {
  liquid: [
    "液体", "液态", "喷雾", "香水", "精油", "乳液", "爽肤水", "精华液", "精华水", "面霜", "乳霜", "溶液",
    "洗发水", "护发素", "沐浴露", "沐浴乳", "洗衣液", "柔顺剂", "护理液", "清洁液", "清洁剂", "消毒液", "消毒水",
    "墨水", "胶水", "机油", "酒精", "染发剂", "染发膏", "卸妆水", "卸妆油", "卸妆乳", "化妆水", "柔肤水",
    "粉底液", "气垫", "bb霜", "cc霜", "防晒霜", "防晒乳", "防晒喷雾", "隔离霜", "粉底", "遮瑕液",
    "眼线液", "睫毛液", "眉笔液", "腮红液", "高光液", "修容液", "唇釉", "唇蜜", "唇彩", "唇油",
    "指甲油", "甲油", "甲油胶", "洗甲水", "洗手液", "洗洁精", "洗衣凝珠", "洗面奶", "洁面乳", "洁面液",
    "护手霜", "身体乳", "润肤乳", "润肤露", "保湿水", "爽身粉液", "花露水", "驱蚊液", "杀虫剂",
    "啤酒", "饮料", "饮品", "果汁", "牛奶", "蜂蜜", "酱油", "醋", "食用油",
    "打火机油", "稀释剂", "稀释液", "颜料", "油漆", "涂料", "万能胶", "502", "ab胶",
  ],
  paste: [
    "膏体", "膏状", "牙膏", "乳膏", "软膏", "凝胶", "啫喱", "胶泥", "泥膜", "发蜡", "发胶", "摩丝",
    "唇膏", "口红", "润唇膏", "唇膜", "面膜", "睡眠面膜", "眼膜", "鼻膜", "护手膏", "身体霜",
    "睫毛膏", "眼影膏", "腮红膏", "高光膏", "遮瑕膏", "粉底膏", "修容膏", "眉膏",
    "护肤膏", "万金油", "清凉油", "凡士林", "护臀膏", "蚊虫膏", "膏药",
    "牙膏状", "啫喱膏", "浆糊", "黄油", "奶油", "果酱", "酱料",
  ],
  electric: [
    "带电", "电池", "锂电", "纽扣电池", "充电", "充电器", "适配器", "usb", "电动", "电机", "插电", "无线充", "电源",
  ],
};

const AUTO_PRICING_IP_PATTERNS = [
  /迪士尼|disney/i,
  /漫威|marvel/i,
  /宝可梦|pokemon/i,
  /hello\s*kitty|凯蒂猫|三丽鸥|sanrio/i,
  /哈利波特|harry\s*potter/i,
  /冰雪奇缘|frozen/i,
  /蜘蛛侠|spider-?man/i,
  /蝙蝠侠|batman/i,
  /火影|naruto/i,
  /海贼王|one\s*piece/i,
  /龙珠|dragon\s*ball/i,
  /米老鼠|mickey/i,
  /史迪奇|stitch/i,
  /芭比|barbie/i,
  /乐高|lego/i,
  /小黄人|minions/i,
  /变形金刚|transformers/i,
  /小猪佩奇|peppa\s*pig/i,
  /汪汪队|paw\s*patrol/i,
  /我的世界|minecraft/i,
];

function normalizeImportedCellTexts(value, seen = new WeakSet()) {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "string") {
    const text = value.trim();
    return text && text !== "[object Object]" ? [text] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeImportedCellTexts(item, seen));
  }
  if (typeof value !== "object") {
    const text = String(value).trim();
    return text && text !== "[object Object]" ? [text] : [];
  }
  if (seen.has(value)) return [];
  seen.add(value);

  const objectValue = value;
  const orderedCategoryKeys = Object.keys(objectValue)
    .filter((key) => /^cat\d+$/i.test(key) || /^(first|second|third|fourth|fifth)Category/i.test(key) || /^leafCat$/i.test(key))
    .sort();
  const orderedTexts = orderedCategoryKeys.flatMap((key) => normalizeImportedCellTexts(objectValue[key], seen));
  if (orderedTexts.length > 0) return orderedTexts;

  const preferredTexts = [
    objectValue.w,
    objectValue.text,
    objectValue.label,
    objectValue.name,
    objectValue.catName,
    objectValue.categoryName,
    objectValue.title,
    objectValue.v,
  ].flatMap((item) => normalizeImportedCellTexts(item, seen));
  if (preferredTexts.length > 0) return preferredTexts;

  return Object.values(objectValue).flatMap((item) => normalizeImportedCellTexts(item, seen));
}

function normalizeImportedCellText(value, separator = " | ") {
  const seen = new Set();
  return normalizeImportedCellTexts(value)
    .filter((text) => {
      if (seen.has(text)) return false;
      seen.add(text);
      return true;
    })
    .join(separator);
}

function detectProductTableHeaderRow(rows = []) {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    const rowText = row.map((cell) => normalizeImportedCellText(cell, " ")).join("|");
    if (rowText.includes("商品标题") || rowText.includes("商品名称") || rowText.includes("商品主图") || rowText.includes("美元价格")) {
      return i;
    }
  }
  return 0;
}

function buildAutoPricingRowSearchText(row = []) {
  return row.map((cell) => normalizeImportedCellText(cell, " ")).filter(Boolean).join(" | ");
}

function detectAutoPricingExcludedReasons(row = []) {
  const searchText = buildAutoPricingRowSearchText(row);
  const normalizedText = searchText.toLowerCase();
  const reasons = [];

  if (AUTO_PRICING_FILTER_KEYWORDS.liquid.some((keyword) => normalizedText.includes(keyword))) {
    reasons.push("液体");
  }
  if (AUTO_PRICING_FILTER_KEYWORDS.paste.some((keyword) => normalizedText.includes(keyword))) {
    reasons.push("膏体");
  }
  if (AUTO_PRICING_FILTER_KEYWORDS.electric.some((keyword) => normalizedText.includes(keyword))) {
    reasons.push("带电");
  }
  if (AUTO_PRICING_IP_PATTERNS.some((pattern) => pattern.test(searchText))) {
    reasons.push("IP");
  }

  return reasons;
}

function getFilteredProductTableOutputPath(inputPath) {
  const parsed = path.parse(inputPath);
  const baseName = `${parsed.name}_排除后`;
  let attempt = 0;
  while (attempt < 1000) {
    const suffix = attempt === 0 ? "" : `_${attempt}`;
    const candidate = path.join(parsed.dir, `${baseName}${suffix}.xlsx`);
    if (!fs.existsSync(candidate)) return candidate;
    attempt += 1;
  }
  return path.join(parsed.dir, `${baseName}_${Date.now()}.xlsx`);
}

function filterAutoPricingProductTable(inputPath) {
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error(`表格文件不存在: ${inputPath || ""}`);
  }

  const workbook = XLSX.readFile(inputPath, { cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("表格没有可用的工作表");
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const allRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
  const headerRowIdx = detectProductTableHeaderRow(allRows);
  const headerRow = Array.isArray(allRows[headerRowIdx]) ? allRows[headerRowIdx] : [];
  const prefixRows = allRows.slice(0, headerRowIdx + 1);
  const dataRows = allRows
    .slice(headerRowIdx + 1)
    .filter((row) => Array.isArray(row) && row.some((cell) => normalizeImportedCellText(cell, " ")));

  const keptRows = [];
  const excludedRows = [];
  const excludedSummary = { liquid: 0, paste: 0, electric: 0, ip: 0 };

  dataRows.forEach((row) => {
    const reasons = detectAutoPricingExcludedReasons(row);
    if (reasons.length === 0) {
      keptRows.push(row);
      return;
    }

    excludedRows.push([...row, reasons.join("、")]);
    if (reasons.includes("液体")) excludedSummary.liquid += 1;
    if (reasons.includes("膏体")) excludedSummary.paste += 1;
    if (reasons.includes("带电")) excludedSummary.electric += 1;
    if (reasons.includes("IP")) excludedSummary.ip += 1;
  });

  const outputWorkbook = XLSX.utils.book_new();
  const retainedSheet = XLSX.utils.aoa_to_sheet([...prefixRows, ...keptRows]);
  XLSX.utils.book_append_sheet(outputWorkbook, retainedSheet, "可上品");

  const excludedSheet = XLSX.utils.aoa_to_sheet([
    [...headerRow, "排除原因"],
    ...excludedRows,
  ]);
  XLSX.utils.book_append_sheet(outputWorkbook, excludedSheet, "排除记录");

  const outputPath = getFilteredProductTableOutputPath(inputPath);
  XLSX.writeFile(outputWorkbook, outputPath);

  return {
    outputPath,
    totalRows: dataRows.length,
    keptRows: keptRows.length,
    excludedRows: excludedRows.length,
    excludedSummary,
  };
}

// ============ 自动更新 ============

// 走 gh-proxy.com 反代 GitHub Release,避免大陆用户直连 github.com 超时
// /releases/latest/download/ 是 GitHub 的稳定别名,不用每次发版改 URL
const UPDATE_FEED_URL = "https://gh-proxy.com/https://github.com/9619221/temu-automation/releases/latest/download/";
const UPDATE_MANUAL_DOWNLOAD_URL = "https://gh-proxy.com/https://github.com/9619221/temu-automation/releases/latest";

let updateState = {
  status: "idle",
  version: null,
  message: "未检查更新",
  releaseVersion: null,
  progressPercent: null,
  manualDownloadUrl: UPDATE_MANUAL_DOWNLOAD_URL,
};

function broadcastUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:update-status", updateState);
  }
}

function configureAutoUpdater() {
  if (!app.isPackaged) {
    broadcastUpdateState({ status: "dev", message: "开发环境不支持自动更新" });
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL({
    provider: "generic",
    url: UPDATE_FEED_URL,
  });
  broadcastUpdateState({ message: "更新源: gh-proxy 镜像", manualDownloadUrl: UPDATE_MANUAL_DOWNLOAD_URL });
}

autoUpdater.on("checking-for-update", () => {
  broadcastUpdateState({ status: "checking", message: "正在检查更新…" });
});
autoUpdater.on("update-available", (info) => {
  broadcastUpdateState({ status: "available", message: `发现新版本 ${info?.version || ""}`, releaseVersion: info?.version });
  // 不自动下载，等用户手动点击下载按钮
});
autoUpdater.on("update-not-available", () => {
  broadcastUpdateState({ status: "up-to-date", message: "当前已是最新版本", releaseVersion: null, progressPercent: null });
});
autoUpdater.on("download-progress", (progress) => {
  broadcastUpdateState({ status: "downloading", message: `正在下载 ${Math.round(progress?.percent || 0)}%`, progressPercent: Math.round(progress?.percent || 0) });
});
autoUpdater.on("update-downloaded", (info) => {
  broadcastUpdateState({ status: "downloaded", message: `${info?.version || ""} 已下载，重启即可安装`, releaseVersion: info?.version, progressPercent: 100 });
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "更新已就绪",
      message: `新版本 ${info?.version || ""} 已下载`,
      detail: "重启应用即可安装。",
      buttons: ["稍后", "立即重启"],
      defaultId: 1,
    }).then(({ response }) => {
      if (response === 1) autoUpdater.quitAndInstall(false, true);
    }).catch(() => {});
  }
});
autoUpdater.on("error", (error) => {
  const msg = error?.message || "检查更新失败";
  console.error("[updater] error:", msg, error?.stack || "");
  broadcastUpdateState({ status: "error", message: msg, progressPercent: null });
});

// ============ Worker 管理（HTTP 通信，彻底避免 stdio 继承） ============

function findNodeExe() {
  const bundledNode = app.isPackaged
    ? path.join(process.resourcesPath, "node-runtime", "node.exe")
    : path.join(app.getAppPath(), "build", "node-runtime", "node.exe");
  const candidates = [
    process.env.TEMU_NODE_RUNTIME,
    process.env.NODE_EXE,
    bundledNode,
    process.execPath && process.execPath.toLowerCase().endsWith("node.exe") ? process.execPath : "",
    "C:/Program Files/nodejs/node.exe",
    "C:/Program Files (x86)/nodejs/node.exe",
  ].filter(Boolean);
  const pathDirs = (process.env.PATH || "").split(";");
  for (const dir of pathDirs) {
    candidates.push(path.join(dir, "node.exe"));
  }
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return "node";
}

function killChildProcessTree(child) {
  return new Promise((resolve) => {
    if (!child?.pid) {
      resolve(false);
      return;
    }

    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", () => resolve(false));
      killer.on("exit", () => resolve(true));
      return;
    }

    try {
      child.kill("SIGTERM");
      resolve(true);
    } catch {
      resolve(false);
    }
  });
}

function normalizeStoreKey(key) {
  if (typeof key !== "string") {
    throw new Error("Store key 必须是字符串");
  }
  const normalized = key.trim();
  if (!normalized || normalized.includes("..") || !STORE_KEY_PATTERN.test(normalized)) {
    throw new Error(`非法 store key: ${key}`);
  }
  return normalized;
}

function buildScopedStoreKey(accountId, baseKey) {
  return `temu_store:${accountId}:${baseKey}`;
}

function ensurePathInside(baseDir, targetPath, label) {
  const relative = path.relative(baseDir, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label}超出允许目录`);
  }
  return targetPath;
}

function createWorkerAuthToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getWorkerAuthorizationHeader(authToken = workerAuthToken) {
  return authToken ? `Bearer ${authToken}` : "";
}

function getWorkerRequestHeaders(headers = {}, authToken = workerAuthToken) {
  const nextHeaders = { ...headers };
  const authorization = getWorkerAuthorizationHeader(authToken);
  if (authorization) nextHeaders.Authorization = authorization;
  return nextHeaders;
}

function parseWorkerPortFile(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { port: 0, token: "" };
  try {
    const parsed = JSON.parse(text);
    return {
      port: Number(parsed?.port) > 0 ? Number(parsed.port) : 0,
      token: typeof parsed?.token === "string" ? parsed.token : "",
    };
  } catch {
    const port = parseInt(text, 10);
    return { port: Number.isFinite(port) ? port : 0, token: "" };
  }
}

function getActiveWorkerCredentials() {
  try {
    const accounts = readStoreJsonWithRecovery(getStoreFilePath(ACCOUNT_STORE_KEY), ACCOUNT_STORE_KEY);
    const activeId = readStoreJsonWithRecovery(getStoreFilePath("temu_active_account_id"), "temu_active_account_id");
    if (!Array.isArray(accounts) || accounts.length === 0) return {};

    const isPlaceholderAccount = (account) => {
      const phone = typeof account?.phone === "string" ? account.phone.trim() : "";
      const name = typeof account?.name === "string" ? account.name.trim() : "";
      return phone === "13800138000" || /回归测试|test/i.test(name);
    };

    const sortByLastLoginDesc = (list) => list.slice().sort((a, b) => {
      const aTime = a?.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
      const bTime = b?.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
      return bTime - aTime;
    });

    const active = activeId ? accounts.find((account) => account?.id === activeId) : null;
    const usableAccounts = accounts.filter((account) => typeof account?.phone === "string" && account.phone.trim());
    const preferredRealAccounts = usableAccounts.filter((account) => !isPlaceholderAccount(account));
    const onlineRealAccounts = preferredRealAccounts.filter((account) => account?.status === "online" || account?.status === "logging_in");

    const selected = (
      (active && !isPlaceholderAccount(active) ? active : null) ||
      onlineRealAccounts[0] ||
      sortByLastLoginDesc(preferredRealAccounts)[0] ||
      (active && active.phone ? active : null) ||
      usableAccounts[0] ||
      null
    );

    if (!selected?.phone) return {};
    return {
      accountId: selected.id || "",
      phone: selected.phone,
      password: selected.password || "",
    };
  } catch {
    return {};
  }
}

function attachWorkerCredentials(action, params = {}) {
  const nextParams = params && typeof params === "object" ? params : {};
  if (action === "login") {
    const loginPhone = typeof nextParams.phone === "string" ? nextParams.phone.trim() : "";
    if (!loginPhone) return nextParams;
    return {
      ...nextParams,
      credentials: {
        accountId: typeof nextParams.accountId === "string" ? nextParams.accountId.trim() : "",
        phone: loginPhone,
        password: typeof nextParams.password === "string" ? nextParams.password : "",
      },
    };
  }
  if (nextParams?.credentials?.phone) return nextParams;
  const credentials = getActiveWorkerCredentials();
  if (!credentials.phone) return nextParams;
  return { ...nextParams, credentials };
}

function httpPost(port, body, options = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const timeout = Number(body?.timeoutMs) > 0 ? Number(body.timeoutMs) : WORKER_HTTP_TIMEOUT_MS;
    const actionLabel = typeof body?.action === "string" && body.action ? body.action : "worker";
    const authToken = typeof options?.authToken === "string" ? options.authToken : workerAuthToken;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: "POST",
        headers: getWorkerRequestHeaders({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, authToken),
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode === 401) {
            reject(new Error("Worker 未授权"));
            return;
          }
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`Worker HTTP ${res.statusCode}`));
            return;
          }
          const buf = Buffer.concat(chunks).toString("utf8");
          try {
            const json = JSON.parse(buf);
            if (json.type === "error") {
              const code = json?.code ? String(json.code) : "";
              const error = new Error(code ? `[${code}] ${json.message}` : json.message);
              if (code) error.code = code;
              if (json?.action) error.action = json.action;
              if (typeof json?.duration === "number") error.duration = json.duration;
              if (json?.screenshotFile) error.screenshotFile = json.screenshotFile;
              reject(error);
            }
            else resolve(json.data);
          } catch (e) {
            reject(new Error("Worker 返回无效 JSON: " + buf.substring(0, 200)));
          }
        });
      }
    );
    req.on("error", (e) => reject(new Error("Worker 通信失败: " + e.message)));
    req.on("timeout", () => { req.destroy(); reject(new Error(`Worker 请求超时: ${actionLabel}`)); });
    req.setTimeout(timeout);
    req.write(data);
    req.end();
  });
}

function waitForWorker(port, maxWait = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (Date.now() - start > maxWait) {
        reject(new Error("Worker 启动超时"));
        return;
      }
      httpPost(port, { action: "ping", timeoutMs: 2000 })
        .then(() => resolve(true))
        .catch(() => setTimeout(check, 500));
    }
    check();
  });
}

// 尝试关闭旧的 worker（通过端口文件找到）
async function shutdownOldWorker() {
  try {
    const portFile = path.join(app.getPath("userData"), "worker-port");
    if (fs.existsSync(portFile)) {
      const { port: oldPort, token: oldToken } = parseWorkerPortFile(fs.readFileSync(portFile, "utf-8"));
      if (oldPort > 0) {
        console.log(`[Main] Trying to shutdown old worker on port ${oldPort}`);
        // 先尝试 shutdown 命令
        await httpPost(oldPort, { action: "shutdown" }, { authToken: oldToken }).catch(() => {});
        await new Promise(r => setTimeout(r, 1000));
        // 如果还在运行，用系统命令杀掉（异步避免阻塞主线程）
        try {
          const { exec } = require("child_process");
          const out = await new Promise((resolve, reject) => {
            exec(`netstat -ano | findstr :${oldPort} | findstr LISTENING`, { encoding: "utf8", timeout: 5000 }, (err, stdout) => {
              if (err) return reject(err);
              resolve(stdout);
            });
          });
          const pids = [...new Set(out.trim().split(/\n/).map(l => l.trim().split(/\s+/).pop()))];
          for (const pid of pids) {
            try {
              await new Promise((resolve) => {
                exec(`taskkill /F /T /PID ${pid}`, { timeout: 3000 }, () => resolve());
              });
              console.log(`[Main] Killed old worker PID ${pid}`);
            } catch {}
          }
        } catch {}
        await new Promise(r => setTimeout(r, 500));
      }
    }
  } catch {}
}

async function startWorker(options = {}) {
  const desiredAiImageServer = (
    (typeof options?.aiImageServer === "string" && options.aiImageServer.trim())
      ? options.aiImageServer.trim()
      : (process.env.AI_IMAGE_SERVER || getImageStudioBaseUrl(imageStudioPort))
  ).replace(/\/+$/, "");

  // 已有运行中的 worker：永不因 aiImageServer 变化而重启，避免中断正在执行的批量上品任务。
  // 改为通过 HTTP 控制通道动态推送新地址，worker 会在下一次图片生成时使用新值。
  if (worker && workerReady) {
    if (workerAiImageServer !== desiredAiImageServer) {
      const prev = workerAiImageServer;
      workerAiImageServer = desiredAiImageServer;
      console.log(`[Main] aiImageServer changed (${prev || "<empty>"} -> ${desiredAiImageServer}); pushing to running worker instead of restarting.`);
      httpPost(workerPort, { action: "set_ai_image_server", params: { url: desiredAiImageServer } }, { authToken: workerAuthToken })
        .catch((err) => console.log(`[Main] set_ai_image_server push failed (non-fatal): ${err?.message || err}`));
    }
    return;
  }
  if (workerStartPromise) {
    return workerStartPromise;
  }

  workerStartTargetAiImageServer = desiredAiImageServer;
  // 占位：先同步地把 workerStartPromise 标记成"进行中"，避免 IIFE 在第一个
  // await 点让出事件循环时，另一个并发 startWorker 调用通过 null 检查。
  let currentStartPromise;
  workerStartPromise = new Promise((resolveOuter, rejectOuter) => {
    currentStartPromise = (async () => {
    // 清理旧进程
    if (worker) {
      await killChildProcessTree(worker);
      worker = null;
      workerReady = false;
      workerAiImageServer = "";
    }

    // 先尝试关闭旧的 worker
    await shutdownOldWorker();
    workerAuthToken = createWorkerAuthToken();
    workerPort = await findAvailableWorkerPort(DEFAULT_WORKER_PORT);

    // 打包模式优先用 ELECTRON_RUN_AS_NODE（能读 asar），否则用外部 Node
    const workerPath = app.isPackaged
      ? path.join(process.resourcesPath, "app.asar", "automation", "worker-entry.cjs")
      : path.join(__dirname, "../automation/worker.mjs");

    let nodeExe, childEnv;
    if (app.isPackaged) {
      nodeExe = process.execPath; // Electron 自身
      childEnv = {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([k]) => !k.startsWith("ELECTRON"))
        ),
        ELECTRON_RUN_AS_NODE: "1",
        WORKER_PORT: String(workerPort),
        WORKER_AUTH_TOKEN: workerAuthToken,
        APP_USER_DATA: app.getPath("userData"),
        AI_IMAGE_SERVER: desiredAiImageServer,
      };
    } else {
      nodeExe = findNodeExe();
      childEnv = {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([k]) => !k.startsWith("ELECTRON"))
        ),
        WORKER_PORT: String(workerPort),
        WORKER_AUTH_TOKEN: workerAuthToken,
        APP_USER_DATA: app.getPath("userData"),
        AI_IMAGE_SERVER: desiredAiImageServer,
      };
    }

    console.log(`[Main] Starting worker: ${nodeExe} ${workerPath} (port ${workerPort}) packaged=${app.isPackaged} aiImageServer=${desiredAiImageServer}`);

    worker = spawn(nodeExe, [workerPath], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
      windowsHide: true,
      env: childEnv,
    });

    // 只读 stderr 用于调试日志（安全处理 EPIPE）
    if (worker.stderr) {
      worker.stderr.on("data", (d) => {
        try { console.error("[Worker]", d.toString()); } catch {}
      });
      worker.stderr.on("error", () => {}); // 忽略 pipe 错误
    }
    if (worker.stdout) {
      worker.stdout.on("error", () => {}); // 忽略 pipe 错误
    }

    worker.on("exit", (code) => {
      console.log(`[Main] Worker exited: ${code}`);
      markAutoPricingTaskInterrupted(`批量上品任务已中断，worker 进程退出 (code=${code})。请检查 worker 日志后重新发起。`);
      stopAutoPricingTaskSync();
      worker = null;
      workerReady = false;
      workerAiImageServer = "";
      workerAuthToken = "";
    });

    worker.on("error", (err) => {
      try { console.error("[Main] Worker spawn error:", err.message); } catch {}
      markAutoPricingTaskInterrupted("批量上品任务已中断，worker 启动失败。");
      stopAutoPricingTaskSync();
      worker = null;
      workerReady = false;
      workerAiImageServer = "";
      workerAuthToken = "";
    });

    // 等待 worker HTTP 服务就绪
    try {
      await waitForWorker(workerPort);
      workerReady = true;
      workerAiImageServer = desiredAiImageServer;
      console.log(`[Main] Worker ready on port ${workerPort}`);
    } catch (e) {
      console.error("[Main] Worker 启动失败:", e.message);
      if (worker) { await killChildProcessTree(worker); }
      worker = null;
      workerReady = false;
      workerAiImageServer = "";
      workerAuthToken = "";
      throw e;
    }
    })();
    currentStartPromise.then(resolveOuter, rejectOuter);
  });

  try {
    return await workerStartPromise;
  } finally {
    workerStartPromise = null;
    workerStartTargetAiImageServer = "";
  }
}

async function ensureWorkerStarted(options = {}, retries = 1) {
  try {
    await startWorker(options);
    return;
  } catch (error) {
    const message = String(error?.message || "");
    const canRetry = retries > 0 && /Worker 启动超时|Worker 通信失败|Worker 请求超时/i.test(message);
    if (!canRetry) {
      throw error;
    }

    console.error(`[Main] Worker startup failed, retrying (${retries} left):`, message);
    workerStartPromise = null;
    workerStartTargetAiImageServer = "";
    if (worker) {
      try { await killChildProcessTree(worker); } catch {}
    }
    worker = null;
    workerReady = false;
    workerAiImageServer = "";
    workerAuthToken = "";
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return ensureWorkerStarted(options, retries - 1);
  }
}

function resolveSendCmdTimeout(params, requestOptions) {
  if (Number(params?.timeoutMs) > 0) {
    return Number(params.timeoutMs);
  }
  if (typeof requestOptions === "number" && Number(requestOptions) > 0) {
    return Number(requestOptions);
  }
  if (Number(requestOptions?.timeoutMs) > 0) {
    return Number(requestOptions.timeoutMs);
  }
  return 0;
}

async function sendCmd(action, params = {}, requestOptions = {}) {
  if (!workerReady) {
    await ensureWorkerStarted();
  }
  const nextParams = attachWorkerCredentials(action, params);
  const payload = { action, params: nextParams };
  const timeoutMs = resolveSendCmdTimeout(params, requestOptions);
  if (timeoutMs > 0) {
    payload.timeoutMs = timeoutMs;
  }
  const keepLongRunningWorkerAlive = action === "auto_pricing" || action === "competitor_auto_register";
  try {
    return await httpPost(workerPort, payload);
  } catch (error) {
    const message = String(error?.message || "");
    const shouldRetry = /ECONNRESET|ECONNREFUSED|socket hang up|Worker 通信失败|Worker 请求超时/i.test(message);
    if (!shouldRetry || keepLongRunningWorkerAlive) {
      throw error;
    }

    console.error(`[Main] Worker request failed for ${action}, restarting worker and retrying once:`, message);
    workerReady = false;
    await ensureWorkerStarted(workerAiImageServer ? { aiImageServer: workerAiImageServer } : {});
    return httpPost(workerPort, payload);
  }
}

function getDefaultAutoPricingState() {
  return {
    activeTaskId: null,
    tasks: [],
  };
}

function summarizeAutoPricingResults(results) {
  const list = Array.isArray(results) ? results : [];
  const successCount = list.filter((item) => item?.success).length;
  return {
    successCount,
    failCount: list.length - successCount,
  };
}

function isSafeStorageReady() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encryptSecret(text) {
  if (typeof text !== "string" || !text) return "";
  if (!isSafeStorageReady()) return text;
  try {
    return `enc:${safeStorage.encryptString(text).toString("base64")}`;
  } catch (error) {
    console.error("[Store] Failed to encrypt secret:", error.message);
    return text;
  }
}

function decryptSecret(text) {
  if (typeof text !== "string" || !text) return "";
  if (!text.startsWith("enc:")) return text;
  if (!isSafeStorageReady()) return "";
  try {
    return safeStorage.decryptString(Buffer.from(text.slice(4), "base64"));
  } catch (error) {
    console.error("[Store] Failed to decrypt secret:", error.message);
    return "";
  }
}

function serializeStoreValue(key, data) {
  const normalized = data === undefined ? null : data;
  if (key !== ACCOUNT_STORE_KEY || !Array.isArray(normalized)) {
    return normalized;
  }

  const encrypted = isSafeStorageReady();
  return {
    __temuSecureStore: "accounts:v1",
    encrypted,
    accounts: normalized.map((account) => ({
      ...account,
      password: encrypted ? encryptSecret(account?.password) : (typeof account?.password === "string" ? account.password : ""),
    })),
  };
}

function deserializeStoreValue(key, data, filePath) {
  if (key !== ACCOUNT_STORE_KEY) {
    return data;
  }

  if (Array.isArray(data)) {
    if (data.length > 0 && isSafeStorageReady()) {
      try {
        writeStoreJsonAtomic(filePath, data, { skipBackup: true, key });
      } catch (error) {
        console.error("[Store] Failed to migrate account store:", error.message);
      }
    }
    return data;
  }

  if (!data || typeof data !== "object" || !Array.isArray(data.accounts)) {
    return data;
  }

  return data.accounts.map((account) => ({
    ...account,
    password: data.encrypted ? decryptSecret(account?.password) : (typeof account?.password === "string" ? account.password : ""),
  }));
}

function appendCreateHistoryEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) return;

  const history = readStoreJsonWithRecovery(getStoreFilePath(CREATE_HISTORY_KEY));
  const nextHistory = Array.isArray(history) ? [...history] : [];

  list.forEach((entry) => {
    nextHistory.unshift(entry);
  });

  writeStoreJsonAtomic(getStoreFilePath(CREATE_HISTORY_KEY), nextHistory.slice(0, 100));
}

function normalizeAutoPricingTask(task = {}) {
  const results = Array.isArray(task.results) ? task.results : [];
  const summary = summarizeAutoPricingResults(results);
  return {
    taskId: typeof task.taskId === "string" ? task.taskId : `pricing_${Date.now()}`,
    status: typeof task.status === "string" ? task.status : "idle",
    running: Boolean(task.running),
    paused: Boolean(task.paused),
    total: Number(task.total) || 0,
    completed: Number(task.completed) || 0,
    current: typeof task.current === "string" ? task.current : "",
    step: typeof task.step === "string" ? task.step : "",
    message: typeof task.message === "string" ? task.message : "",
    csvPath: typeof task.csvPath === "string" ? task.csvPath : "",
    startRow: Number(task.startRow) || 0,
    count: Number(task.count) || 0,
    results,
    successCount: summary.successCount,
    failCount: summary.failCount,
    createdAt: typeof task.createdAt === "string" ? task.createdAt : "",
    updatedAt: typeof task.updatedAt === "string" ? task.updatedAt : "",
    startedAt: typeof task.startedAt === "string" ? task.startedAt : "",
    finishedAt: typeof task.finishedAt === "string" ? task.finishedAt : "",
  };
}

function readAutoPricingState() {
  try {
    const raw = readStoreJsonWithRecovery(getStoreFilePath(AUTO_PRICING_TASKS_KEY));
    if (!raw || typeof raw !== "object") {
      autoPricingCurrentTaskId = null;
      return getDefaultAutoPricingState();
    }
    const tasks = Array.isArray(raw.tasks) ? raw.tasks.map((task) => normalizeAutoPricingTask(task)) : [];
    const activeTaskId = typeof raw.activeTaskId === "string"
      ? raw.activeTaskId
      : (tasks[0]?.taskId || null);
    autoPricingCurrentTaskId = activeTaskId;
    return {
      activeTaskId,
      tasks,
    };
  } catch {
    autoPricingCurrentTaskId = null;
    return getDefaultAutoPricingState();
  }
}

function writeAutoPricingState(state) {
  const nextState = {
    activeTaskId: typeof state?.activeTaskId === "string" ? state.activeTaskId : null,
    tasks: Array.isArray(state?.tasks) ? state.tasks.map((task) => normalizeAutoPricingTask(task)) : [],
  };
  writeStoreJsonAtomic(getStoreFilePath(AUTO_PRICING_TASKS_KEY), nextState);
  autoPricingCurrentTaskId = nextState.activeTaskId;
  return nextState;
}

function getAutoPricingTask(taskId) {
  const state = readAutoPricingState();
  if (taskId) {
    return state.tasks.find((task) => task.taskId === taskId) || null;
  }
  return state.tasks.find((task) => task.taskId === state.activeTaskId) || state.tasks[0] || null;
}

function listAutoPricingTasks() {
  return readAutoPricingState().tasks;
}

function upsertAutoPricingTask(taskPatch) {
  const state = readAutoPricingState();
  const existing = state.tasks.find((task) => task.taskId === taskPatch.taskId);
  const nextTask = normalizeAutoPricingTask({ ...existing, ...taskPatch });
  const tasks = [
    nextTask,
    ...state.tasks.filter((task) => task.taskId !== nextTask.taskId),
  ].slice(0, AUTO_PRICING_TASK_LIMIT);

  writeAutoPricingState({
    activeTaskId: nextTask.taskId,
    tasks,
  });

  return nextTask;
}

function markAutoPricingTaskInterrupted(message) {
  const activeTask = getAutoPricingTask(autoPricingCurrentTaskId);
  if (!activeTask || !["running", "pausing", "paused"].includes(activeTask.status)) {
    return activeTask;
  }
  const now = new Date().toLocaleString("zh-CN");
  return upsertAutoPricingTask({
    ...activeTask,
    status: "interrupted",
    running: false,
    paused: false,
    message,
    updatedAt: now,
    finishedAt: activeTask.finishedAt || now,
  });
}

async function requestWorkerProgressSnapshot(taskId) {
  if (!workerReady) {
    return { running: false };
  }

  try {
    const pathWithQuery = taskId
      ? `/progress?taskId=${encodeURIComponent(taskId)}`
      : "/progress";
    return await new Promise((resolve) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: workerPort, method: "GET", path: pathWithQuery, timeout: 3000, headers: getWorkerRequestHeaders() },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            if (res.statusCode === 401) {
              resolve({ running: false });
              return;
            }
            try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
            catch { resolve({ running: false }); }
          });
        }
      );
      req.on("error", () => resolve({ running: false }));
      req.on("timeout", () => { req.destroy(); resolve({ running: false }); });
      req.end();
    });
  } catch {
    return { running: false };
  }
}

async function requestWorkerTaskSnapshots() {
  if (!workerReady) {
    return [];
  }

  try {
    return await new Promise((resolve) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: workerPort, method: "GET", path: "/tasks", timeout: 3000, headers: getWorkerRequestHeaders() },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            if (res.statusCode === 401) {
              resolve([]);
              return;
            }
            try {
              const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              resolve(Array.isArray(payload) ? payload : []);
            } catch {
              resolve([]);
            }
          });
        }
      );
      req.on("error", () => resolve([]));
      req.on("timeout", () => { req.destroy(); resolve([]); });
      req.end();
    });
  } catch {
    return [];
  }
}

function hasWorkerTaskSnapshot(task) {
  return Boolean(
    task
    && (
      task.running
      || task.paused
      || task.current
      || task.step
      || task.total
      || task.completed
      || (Array.isArray(task.results) && task.results.length > 0)
      || (typeof task.status === "string" && task.status !== "idle")
    )
  );
}

function mergeWorkerSnapshotIntoTask(task, live, fallbackTaskId) {
  const baseTask = task || {};
  const now = new Date().toLocaleString("zh-CN");
  const isRunning = Boolean(live?.running);
  const isPaused = Boolean(live?.paused);
  const nextStatus = typeof live?.status === "string" && live.status
    ? live.status
    : (isRunning ? (isPaused ? "paused" : "running") : baseTask.status);
  const nextResults = Array.isArray(live?.results) ? live.results : baseTask.results;
  const nextCompleted = Number(live?.completed)
    || (Array.isArray(live?.results) ? live.results.length : baseTask.completed);
  const nextFinishedAt = !isRunning && !isPaused && ["completed", "failed", "interrupted"].includes(nextStatus)
    ? (typeof live?.finishedAt === "string" && live.finishedAt ? live.finishedAt : (baseTask.finishedAt || now))
    : "";

  return upsertAutoPricingTask({
    ...baseTask,
    ...live,
    taskId: typeof live?.taskId === "string" && live.taskId
      ? live.taskId
      : (baseTask.taskId || fallbackTaskId || `pricing_${Date.now()}`),
    status: nextStatus,
    running: isRunning,
    paused: isPaused,
    total: Number(live?.total) || baseTask.total,
    completed: nextCompleted,
    current: typeof live?.current === "string" ? live.current : baseTask.current,
    step: typeof live?.step === "string" ? live.step : baseTask.step,
    results: Array.isArray(nextResults) ? nextResults : [],
    message: typeof live?.message === "string" && live.message ? live.message : baseTask.message,
    updatedAt: typeof live?.updatedAt === "string" && live.updatedAt ? live.updatedAt : now,
    finishedAt: nextFinishedAt,
  });
}

async function syncAutoPricingTaskFromWorker(taskId, options = {}) {
  const { markInterruptedOnIdle = false } = options;
  const task = getAutoPricingTask(taskId || autoPricingCurrentTaskId);
  if (!task) {
    return null;
  }

  const live = await requestWorkerProgressSnapshot(task.taskId);

  if (hasWorkerTaskSnapshot(live)) {
    return mergeWorkerSnapshotIntoTask(task, live, task.taskId);
  }

  if (markInterruptedOnIdle && !autoPricingTaskPromise && ["running", "pausing", "paused"].includes(task.status)) {
    return markAutoPricingTaskInterrupted("任务已中断，应用或 worker 已重启，请重新发起批量上品。");
  }

  return task;
}

async function syncWorkerTaskSnapshotsToStore() {
  const liveTasks = await requestWorkerTaskSnapshots();
  if (!Array.isArray(liveTasks) || liveTasks.length === 0) {
    return listAutoPricingTasks();
  }

  liveTasks.forEach((liveTask) => {
    if (!hasWorkerTaskSnapshot(liveTask)) return;
    mergeWorkerSnapshotIntoTask(getAutoPricingTask(liveTask.taskId), liveTask, liveTask.taskId);
  });

  return listAutoPricingTasks();
}

async function syncActiveAutoPricingTaskFromWorker(options = {}) {
  return syncAutoPricingTaskFromWorker(autoPricingCurrentTaskId, options);
}

function startAutoPricingTaskSync() {
  if (autoPricingTaskSyncTimer) return;
  autoPricingTaskSyncTimer = setInterval(() => {
    syncActiveAutoPricingTaskFromWorker({ markInterruptedOnIdle: true }).catch(() => {});
  }, 3000);
}

function stopAutoPricingTaskSync() {
  if (autoPricingTaskSyncTimer) {
    clearInterval(autoPricingTaskSyncTimer);
    autoPricingTaskSyncTimer = null;
  }
}

function getAutoPricingProgressPayload(task) {
  if (!task) {
    return {
      taskId: null,
      status: "idle",
      running: false,
      paused: false,
      total: 0,
      completed: 0,
      current: "",
      step: "",
      results: [],
      successCount: 0,
      failCount: 0,
      message: "",
      csvPath: "",
      startRow: 0,
      count: 0,
      updatedAt: "",
      createdAt: "",
      startedAt: "",
      finishedAt: "",
    };
  }
  return normalizeAutoPricingTask(task);
}

function stopWorker() {
  stopAutoPricingTaskSync();
  workerStartPromise = null;
  workerStartTargetAiImageServer = "";
  if (worker) {
    void killChildProcessTree(worker);
    worker = null;
    workerReady = false;
    workerAiImageServer = "";
    workerAuthToken = "";
  }
}

// ============ AI 出图服务管理 ============

const AUTO_IMAGE_HOST = "127.0.0.1";
const AUTO_IMAGE_DEFAULT_PORT = 3210;
const AUTO_IMAGE_HEALTH_PATH = "/api/history";
const IMAGE_STUDIO_SAFE_ANALYZE_MODEL = "gemini-3.1-flash-lite-preview";
const IMAGE_STUDIO_DEFAULT_RUNTIME_CONFIG = Object.freeze({
  analyzeModel: "gemini-3.1-flash-lite-preview",
  analyzeBaseUrl: "https://api.vectorengine.ai/v1",
  generateModel: "gemini-3.1-flash-image-preview",
  generateBaseUrl: "https://api.vectorengine.ai/v1",
});
const IMAGE_STUDIO_RUNTIME_CONFIG_KEYS = Object.freeze([
  "analyzeModel",
  "analyzeApiKey",
  "analyzeBaseUrl",
  "generateModel",
  "generateApiKey",
  "generateBaseUrl",
]);

let imageStudioProcess = null;
let imageStudioPort = AUTO_IMAGE_DEFAULT_PORT;
let imageStudioStartupPromise = null;
let imageStudioRuntimeConfigOverrides = {};

// 用户自定义 AI 凭证持久化到 userData/ai-credentials.json
function getAiCredentialsStorePath() {
  try {
    return path.join(app.getPath("userData"), "ai-credentials.json");
  } catch (_err) {
    return "";
  }
}

function loadPersistedAiOverrides() {
  const p = getAiCredentialsStorePath();
  if (!p) return {};
  try {
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.warn("[Main] load ai-credentials.json failed:", err.message);
    return {};
  }
}

function savePersistedAiOverrides(data) {
  const p = getAiCredentialsStorePath();
  if (!p) return;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data || {}, null, 2), "utf8");
  } catch (err) {
    console.warn("[Main] save ai-credentials.json failed:", err.message);
  }
}
let imageStudioStatus = {
  status: "idle",
  message: "AI 出图服务未启动",
  url: `http://${AUTO_IMAGE_HOST}:${AUTO_IMAGE_DEFAULT_PORT}`,
  projectPath: "",
  port: AUTO_IMAGE_DEFAULT_PORT,
  ready: false,
};
const IMAGE_STUDIO_EVENT_CHANNEL = "image-studio:event";
const imageStudioGenerateControllers = new Map();
const imageStudioJobs = new Map(); // jobId → { jobId, status, productName, imageTypes, results[], progress, createdAt, finishedAt, error }

function updateImageStudioJob(jobId, patch) {
  const job = imageStudioJobs.get(jobId);
  if (!job) return;
  Object.assign(job, patch);
}

function getImageStudioJobList() {
  return Array.from(imageStudioJobs.values())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 50);
}

function getImageStudioBaseUrl(port = imageStudioPort) {
  return `http://${AUTO_IMAGE_HOST}:${port}`;
}

function updateImageStudioStatus(patch = {}) {
  if (Number.isInteger(patch.port) && patch.port > 0) {
    imageStudioPort = patch.port;
  }
  imageStudioStatus = { ...imageStudioStatus, ...patch, url: getImageStudioBaseUrl(imageStudioPort), port: imageStudioPort };
  return imageStudioStatus;
}

function getImageStudioLogPath() {
  return path.join(app.getPath("userData"), "image-studio.log");
}

function appendImageStudioLog(message) {
  try {
    fs.appendFileSync(getImageStudioLogPath(), `[${new Date().toISOString()}] ${message}\n`);
  } catch {}
}

function getImageStudioProcessOutputHandlers(prefix) {
  return (chunk) => {
    const text = chunk.toString("utf8").trim();
    if (!text) return;
    text.split(/\r?\n/).filter(Boolean).forEach((line) => {
      appendImageStudioLog(`${prefix}: ${line}`);
    });
  };
}

function readEnvKeyValueFile(filePath) {
  const values = {};
  if (!filePath || !fs.existsSync(filePath)) {
    return values;
  }

  try {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      values[key] = val;
    }
  } catch (error) {
    console.error("[Main] Failed to read env file:", error.message);
  }

  return values;
}

function dedupePaths(paths) {
  const seen = new Set();
  const list = [];
  paths.filter(Boolean).forEach((item) => {
    const normalized = path.resolve(item);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    list.push(normalized);
  });
  return list;
}

function getAutoImageProjectCandidates() {
  const appDir = app.getAppPath();
  const cwd = process.cwd();
  const homeDir = require("os").homedir();

  // 检测 git 仓库根目录（worktree 场景下 cwd 可能嵌套很深）
  // 缓存 git 根目录避免重复 execSync 调用
  if (typeof getAutoImageProjectCandidates._gitRoot === "undefined") {
    try {
      const { execSync } = require("child_process");
      getAutoImageProjectCandidates._gitRoot = execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf-8", timeout: 3000 }).trim();
    } catch { getAutoImageProjectCandidates._gitRoot = ""; }
  }
  const gitRoot = getAutoImageProjectCandidates._gitRoot;

  return dedupePaths([
    process.env.AUTO_IMAGE_GEN_DIR,
    app.isPackaged ? path.join(process.resourcesPath, "auto-image-gen-runtime") : path.resolve(appDir, "build", "auto-image-gen-runtime"),
    path.resolve(appDir, "auto-image-gen-dev"),
    path.resolve(appDir, "..", "auto-image-gen-dev"),
    path.resolve(appDir, "..", "build", "auto-image-gen-runtime"),
    path.resolve(cwd, "auto-image-gen-dev"),
    path.resolve(cwd, "..", "auto-image-gen-dev"),
    path.resolve(cwd, "build", "auto-image-gen-runtime"),
    // 用户主目录（auto-image-gen-dev 通常在这里）
    path.resolve(homeDir, "auto-image-gen-dev"),
    // git 仓库根目录（worktree 场景）
    gitRoot ? path.resolve(gitRoot, "build", "auto-image-gen-runtime") : "",
    gitRoot ? path.resolve(gitRoot, "..", "auto-image-gen-dev") : "",
    app.isPackaged ? path.join(process.resourcesPath, "auto-image-gen-runtime") : "",
  ]);
}

function resolveAutoImageProjectDir() {
  const candidates = getAutoImageProjectCandidates();
  for (const candidate of candidates) {
    try {
      const standaloneServerPath = path.join(candidate, "server.js");
      const standaloneBootstrapPath = path.join(candidate, "bootstrap.cjs");
      const packageJsonPath = path.join(candidate, "package.json");
      const nextBinPath = path.join(candidate, "node_modules", "next", "dist", "bin", "next");
      if (fs.existsSync(standaloneServerPath)) {
        return {
          projectPath: candidate,
          mode: "packaged-runtime",
          serverPath: fs.existsSync(standaloneBootstrapPath) ? standaloneBootstrapPath : standaloneServerPath,
          searchedPaths: candidates,
        };
      }
      if (fs.existsSync(packageJsonPath) && fs.existsSync(nextBinPath)) {
        return { projectPath: candidate, mode: "dev-project", nextBinPath, searchedPaths: candidates };
      }
    } catch {}
  }
  return { searchedPaths: candidates };
}

function httpGet(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
  });
}

async function isImageStudioHealthy(port = imageStudioPort) {
  try {
    const response = await httpGet(`${getImageStudioBaseUrl(port)}${AUTO_IMAGE_HEALTH_PATH}`);
    if (response.statusCode !== 200) return false;
    JSON.parse(response.body || "{}");
    return true;
  } catch { return false; }
}

function canListenOnImageStudioPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    const finalize = (result) => {
      try { server.close(); } catch {}
      resolve(result);
    };
    server.once("error", () => finalize(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, AUTO_IMAGE_HOST);
  });
}

async function findAvailableImageStudioPort() {
  const candidates = [
    imageStudioPort,
    AUTO_IMAGE_DEFAULT_PORT,
    ...Array.from({ length: 20 }, (_, index) => AUTO_IMAGE_DEFAULT_PORT + index + 1),
  ].filter((port, index, list) => list.indexOf(port) === index);

  for (const port of candidates) {
    if (await isImageStudioHealthy(port)) return port;
    if (await canListenOnImageStudioPort(port)) {
      return port;
    }
  }

  return imageStudioPort;
}

async function waitForImageStudio(startedProcess, maxWait = 90000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (imageStudioProcess !== startedProcess || startedProcess.exitCode !== null) {
      throw new Error(imageStudioStatus.message || "AI 出图服务启动失败");
    }
    if (await isImageStudioHealthy()) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error("AI 出图服务启动超时");
}

function stopImageStudioService() {
  imageStudioStartupPromise = null;
  if (imageStudioProcess) {
    void killChildProcessTree(imageStudioProcess);
    imageStudioProcess = null;
  }
  updateImageStudioStatus({ status: "stopped", ready: false, message: "AI 出图服务已停止" });
}

async function ensureImageStudioService() {
  if (imageStudioStartupPromise) {
    return imageStudioStartupPromise;
  }
  imageStudioStartupPromise = ensureImageStudioServiceInternal();
  try {
    return await imageStudioStartupPromise;
  } finally {
    imageStudioStartupPromise = null;
  }
}

async function ensureImageStudioServiceInternal() {
  const projectInfo = resolveAutoImageProjectDir();
  if (!projectInfo?.projectPath) {
    const searched = (projectInfo?.searchedPaths || []).join("；");
    throw new Error(`未找到 AI 出图运行时。请设置 AUTO_IMAGE_GEN_DIR，或确认这些目录之一存在可运行项目：${searched}`);
  }
  updateImageStudioStatus({ projectPath: projectInfo.projectPath });

  if (await isImageStudioHealthy()) {
    return updateImageStudioStatus({ status: "ready", ready: true, message: "AI 出图服务已就绪" });
  }

  if (imageStudioProcess) {
    await killChildProcessTree(imageStudioProcess);
    imageStudioProcess = null;
  }

  const nextPort = await findAvailableImageStudioPort();
  updateImageStudioStatus({ projectPath: projectInfo.projectPath, port: nextPort });
  updateImageStudioStatus({ status: "starting", ready: false, message: "正在启动 AI 出图服务…" });

  const nodeExe = findNodeExe();

  // 读取项目目录下的 .env.local，注入 API Key 等配置（Next.js standalone 模式不自动加载）
  const envLocalPath = path.join(projectInfo.projectPath, ".env.local");
  const envLocalVars = readEnvKeyValueFile(envLocalPath);
  if (Object.keys(envLocalVars).length > 0) {
    console.log(`[Main] Loaded ${Object.keys(envLocalVars).length} vars from ${envLocalPath}`);
  }

  // 注入内置默认 AI 凭证 + 用户覆盖，保证打包后 image-studio 子进程直接可用
  const baked = getDefaultCredentials();
  const bakedEnv = {
    ANALYZE_API_KEY: baked.analyzeApiKey,
    ANALYZE_BASE_URL: baked.analyzeBaseUrl,
    ANALYZE_MODEL: baked.analyzeModel,
    GENERATE_API_KEY: baked.generateApiKey,
    GENERATE_BASE_URL: baked.generateBaseUrl,
    GENERATE_MODEL: baked.generateModel,
  };
  const overrideEnv = {};
  const overrideKeyMap = {
    analyzeApiKey: "ANALYZE_API_KEY",
    analyzeBaseUrl: "ANALYZE_BASE_URL",
    analyzeModel: "ANALYZE_MODEL",
    generateApiKey: "GENERATE_API_KEY",
    generateBaseUrl: "GENERATE_BASE_URL",
    generateModel: "GENERATE_MODEL",
  };
  for (const [k, envKey] of Object.entries(overrideKeyMap)) {
    const v = imageStudioRuntimeConfigOverrides[k];
    if (typeof v === "string" && v.trim()) overrideEnv[envKey] = v;
  }
  // 优先级：process.env (系统) < 内置 baked < .env.local (开发) < 用户 override
  const env = { ...process.env, ...bakedEnv, ...envLocalVars, ...overrideEnv, PORT: String(nextPort), HOSTNAME: AUTO_IMAGE_HOST, NODE_ENV: "production" };

  const spawnArgs = projectInfo.mode === "packaged-runtime"
    ? [projectInfo.serverPath]
    : [projectInfo.nextBinPath, "start", "-p", String(nextPort), "--hostname", AUTO_IMAGE_HOST];

  console.log(`[Main] Starting image studio: ${nodeExe} ${spawnArgs.join(" ")} (${projectInfo.mode})`);
  appendImageStudioLog(`start: runtime=${path.basename(nodeExe)} exe=${nodeExe} project=${projectInfo.projectPath} mode=${projectInfo.mode} port=${nextPort}`);

  imageStudioProcess = spawn(nodeExe, spawnArgs, {
    cwd: projectInfo.projectPath,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: false,
  });
  const startedProcess = imageStudioProcess;

  if (imageStudioProcess.stdout) {
    imageStudioProcess.stdout.on("data", getImageStudioProcessOutputHandlers("stdout"));
    imageStudioProcess.stdout.on("error", () => {});
  }
  if (imageStudioProcess.stderr) {
    imageStudioProcess.stderr.on("data", getImageStudioProcessOutputHandlers("stderr"));
    imageStudioProcess.stderr.on("error", () => {});
  }

  imageStudioProcess.on("error", (error) => {
    console.error("[Main] Image studio spawn error:", error.message);
    appendImageStudioLog(`spawn-error: ${error.message}`);
  });
  imageStudioProcess.on("exit", (code) => {
    console.log(`[Main] Image studio exited: ${code}`);
    appendImageStudioLog(`exit: code=${code ?? "unknown"} port=${nextPort}`);
    if (imageStudioProcess === startedProcess) {
      imageStudioProcess = null;
      updateImageStudioStatus({ status: "error", ready: false, message: `AI 出图服务已退出（code=${code ?? "unknown"}）` });
    }
  });

  await waitForImageStudio(startedProcess);
  appendImageStudioLog(`ready: url=${getImageStudioBaseUrl(nextPort)}`);
  return updateImageStudioStatus({ status: "ready", ready: true, message: "AI 出图服务已就绪" });
}

function getImageStudioProjectInfo() {
  const resolved = resolveAutoImageProjectDir();
  const projectPath = imageStudioStatus.projectPath || resolved?.projectPath || "";
  return {
    ...resolved,
    projectPath,
    envLocalPath: projectPath ? path.join(projectPath, ".env.local") : "",
  };
}

function getImageStudioAuthHeaders(projectInfo = getImageStudioProjectInfo()) {
  const envLocalVars = readEnvKeyValueFile(projectInfo.envLocalPath);
  if (envLocalVars.API_SECRET) {
    return {
      Authorization: `Bearer ${envLocalVars.API_SECRET}`,
    };
  }
  return {};
}

let lastImageStudioConfigSyncAt = 0;
let lastImageStudioConfigSignature = "";

function normalizeImageStudioRuntimeConfigValue(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return typeof value === "string" ? value : String(value);
}

function normalizeImageStudioRuntimeConfigPatch(patch = {}) {
  const normalized = {};
  IMAGE_STUDIO_RUNTIME_CONFIG_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) return;
    normalized[key] = normalizeImageStudioRuntimeConfigValue(patch[key]);
  });
  return normalized;
}

function resolveImageStudioRuntimeConfigValue(key, ...candidates) {
  if (Object.prototype.hasOwnProperty.call(imageStudioRuntimeConfigOverrides, key)) {
    return normalizeImageStudioRuntimeConfigValue(imageStudioRuntimeConfigOverrides[key]);
  }
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null) {
      return normalizeImageStudioRuntimeConfigValue(candidate);
    }
  }
  return "";
}

function readImageStudioRuntimeConfig(projectInfo = getImageStudioProjectInfo()) {
  const envLocalVars = readEnvKeyValueFile(projectInfo?.envLocalPath);
  const baked = getDefaultCredentials();
  // 优先级：内存 override (用户在 UI 修改) → .env.local (开发) → process.env → 内置默认凭证 → 静态兜底
  return {
    analyzeModel: resolveImageStudioRuntimeConfigValue("analyzeModel", envLocalVars.ANALYZE_MODEL, process.env.ANALYZE_MODEL, baked.analyzeModel, IMAGE_STUDIO_DEFAULT_RUNTIME_CONFIG.analyzeModel),
    analyzeApiKey: resolveImageStudioRuntimeConfigValue("analyzeApiKey", envLocalVars.ANALYZE_API_KEY, process.env.ANALYZE_API_KEY, baked.analyzeApiKey, ""),
    analyzeBaseUrl: resolveImageStudioRuntimeConfigValue("analyzeBaseUrl", envLocalVars.ANALYZE_BASE_URL, process.env.ANALYZE_BASE_URL, baked.analyzeBaseUrl, IMAGE_STUDIO_DEFAULT_RUNTIME_CONFIG.analyzeBaseUrl),
    generateModel: resolveImageStudioRuntimeConfigValue("generateModel", envLocalVars.GENERATE_MODEL, process.env.GENERATE_MODEL, baked.generateModel, IMAGE_STUDIO_DEFAULT_RUNTIME_CONFIG.generateModel),
    generateApiKey: resolveImageStudioRuntimeConfigValue("generateApiKey", envLocalVars.GENERATE_API_KEY, process.env.GENERATE_API_KEY, baked.generateApiKey, ""),
    generateBaseUrl: resolveImageStudioRuntimeConfigValue("generateBaseUrl", envLocalVars.GENERATE_BASE_URL, process.env.GENERATE_BASE_URL, baked.generateBaseUrl, IMAGE_STUDIO_DEFAULT_RUNTIME_CONFIG.generateBaseUrl),
  };
}

function buildImageStudioRuntimeConfigPayload(projectInfo = getImageStudioProjectInfo()) {
  const runtimeConfig = readImageStudioRuntimeConfig(projectInfo);
  return Object.fromEntries(
    Object.entries(runtimeConfig).filter(([key, value]) => {
      if (Object.prototype.hasOwnProperty.call(imageStudioRuntimeConfigOverrides, key)) {
        return true;
      }
      return typeof value === "string" && value.trim();
    })
  );
}

function updateImageStudioRuntimeConfigOverrides(patch = {}) {
  const normalizedPatch = normalizeImageStudioRuntimeConfigPatch(patch);
  imageStudioRuntimeConfigOverrides = {
    ...imageStudioRuntimeConfigOverrides,
    ...normalizedPatch,
  };
  // 持久化：只保存非空字段，空字符串视为"恢复默认"
  const toPersist = {};
  for (const [k, v] of Object.entries(imageStudioRuntimeConfigOverrides)) {
    if (typeof v === "string" && v.trim()) toPersist[k] = v;
  }
  savePersistedAiOverrides(toPersist);
  return readImageStudioRuntimeConfig();
}

function hydrateImageStudioRuntimeConfigFromDisk() {
  const persisted = loadPersistedAiOverrides();
  const normalized = normalizeImageStudioRuntimeConfigPatch(persisted);
  if (Object.keys(normalized).length > 0) {
    imageStudioRuntimeConfigOverrides = { ...imageStudioRuntimeConfigOverrides, ...normalized };
    console.log(`[Main] hydrated ${Object.keys(normalized).length} AI credential overrides from disk`);
  }
}

function getImageStudioRuntimeConfigSignature(payload) {
  return JSON.stringify({
    analyzeModel: payload.analyzeModel || "",
    analyzeBaseUrl: payload.analyzeBaseUrl || "",
    generateModel: payload.generateModel || "",
    generateBaseUrl: payload.generateBaseUrl || "",
    hasAnalyzeApiKey: Boolean(payload.analyzeApiKey),
    hasGenerateApiKey: Boolean(payload.generateApiKey),
  });
}

function routeNeedsImageStudioRuntimeConfig(routePath) {
  return [
    "/api/analyze",
    "/api/regenerate-analysis",
    "/api/translate",
    "/api/plans",
    "/api/generate",
    "/api/score",
  ].some((pattern) => routePath.startsWith(pattern));
}

function getImageStudioRouteConfigMeta(routePath) {
  if (routePath === "/api/generate") {
    return {
      label: "AI 出图",
      baseUrlLabel: "出图 Base URL",
      baseUrlKey: "generateBaseUrl",
    };
  }

  return {
    label: "AI 商品分析",
    baseUrlLabel: "分析 Base URL",
    baseUrlKey: "analyzeBaseUrl",
  };
}

function isImageStudioConnectionError(message) {
  return typeof message === "string" && /connection error|fetch failed|econnrefused|network error/i.test(message);
}

function isLoopbackUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function getImageStudioConnectionErrorHint(routePath) {
  const meta = getImageStudioRouteConfigMeta(routePath);
  const configPayload = buildImageStudioRuntimeConfigPayload();
  const baseUrl = configPayload[meta.baseUrlKey] || "";

  if (baseUrl && isLoopbackUrl(baseUrl)) {
    return `${meta.label}连接失败：当前内置 ${meta.baseUrlLabel} 指向 ${baseUrl}，请先启动对应本地接口，或改为可访问的服务地址。`;
  }

  return `${meta.label}连接失败，请检查网络连接或内置 ${meta.baseUrlLabel} / API Key 是否可用。`;
}

async function syncImageStudioRuntimeConfig(routePath = "", options = {}) {
  const { force = false } = options;
  const projectInfo = getImageStudioProjectInfo();
  const payload = buildImageStudioRuntimeConfigPayload();

  if (Object.keys(payload).length === 0) {
    return false;
  }

  const signature = getImageStudioRuntimeConfigSignature(payload);
  const now = Date.now();
  if (!force && signature === lastImageStudioConfigSignature && now - lastImageStudioConfigSyncAt < 30_000) {
    return false;
  }

  const status = await ensureImageStudioService();
  const response = await fetch(`${status.url}/api/config`, {
    method: "POST",
    headers: {
      ...getImageStudioAuthHeaders(projectInfo),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const responsePayload = await readImageStudioResponse(response);
  if (!response.ok) {
    // /api/config 路由可能不存在于当前 runtime 构建中，404 时静默跳过 (运行时已经使用内置默认配置)
    if (response.status === 404) {
      appendImageStudioLog(`[config] /api/config 不存在 (404)，跳过同步`);
      lastImageStudioConfigSignature = signature;
      lastImageStudioConfigSyncAt = now;
      return false;
    }
    const message = getImageStudioErrorMessage("/api/config", response, responsePayload);
    appendImageStudioLog(`[config] sync failed before ${routePath || "request"}: ${message}`);
    throw new Error(message);
  }

  lastImageStudioConfigSignature = signature;
  lastImageStudioConfigSyncAt = now;
  appendImageStudioLog(`[config] runtime config synced${routePath ? ` before ${routePath}` : ""}`);
  return true;
}

function getImageStudioWebContents(target) {
  const candidate = target?.sender || mainWindow?.webContents || null;
  if (!candidate || candidate.isDestroyed()) {
    return null;
  }
  return candidate;
}

function emitImageStudioEvent(_target, payload) {
  // 始终广播到 mainWindow（不绑定 sender），确保页面切换/刷新后也能收到后台 job 事件
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(IMAGE_STUDIO_EVENT_CHANNEL, payload);
  }
}

async function readImageStudioResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  try {
    return await response.text();
  } catch {
    return "";
  }
}

function isHtmlErrorPayload(payload) {
  return typeof payload === "string" && /<!DOCTYPE html>|<html/i.test(payload);
}

function getImageStudioErrorMessage(routePath, response, payload) {
  if (payload && typeof payload === "object" && typeof payload.error === "string" && payload.error.trim()) {
    const message = payload.error.trim();
    return isImageStudioConnectionError(message) ? getImageStudioConnectionErrorHint(routePath) : message;
  }

  if (isHtmlErrorPayload(payload)) {
    if (routePath === "/api/analyze" || routePath === "/api/regenerate-analysis" || routePath === "/api/translate") {
      return "AI 商品分析失败，请检查分析模型是否支持图片输入";
    }
    return `AI 出图服务内部错误 (${response.status})`;
  }

  if (typeof payload === "string" && payload.trim()) {
    const message = payload.trim();
    return isImageStudioConnectionError(message) ? getImageStudioConnectionErrorHint(routePath) : message;
  }

  if (routePath === "/api/analyze" || routePath === "/api/regenerate-analysis" || routePath === "/api/translate") {
    return `AI 商品分析失败 (${response.status})`;
  }

  return `AI 出图服务请求失败 (${response.status})`;
}

function shouldFallbackAnalyzeModel(model) {
  return typeof model === "string" && model.trim() && model !== IMAGE_STUDIO_SAFE_ANALYZE_MODEL;
}

function shouldPreemptivelyUpgradeAnalyzeModel(model) {
  return typeof model === "string" && /flash-lite/i.test(model) && model !== IMAGE_STUDIO_SAFE_ANALYZE_MODEL;
}

async function ensureCompatibleAnalyzeModel() {
  try {
    const currentConfig = await imageStudioJson("/api/config");
    const currentModel = currentConfig?.analyzeModel;
    if (!shouldFallbackAnalyzeModel(currentModel)) {
      return false;
    }

    await imageStudioJson("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analyzeModel: IMAGE_STUDIO_SAFE_ANALYZE_MODEL }),
    });
    appendImageStudioLog(`[compat] analyze model switched from ${currentModel} to ${IMAGE_STUDIO_SAFE_ANALYZE_MODEL}`);
    return true;
  } catch (error) {
    appendImageStudioLog(`[compat] failed to upgrade analyze model: ${error?.message || error}`);
    return false;
  }
}

async function normalizeAnalyzeModelBeforeRequest() {
  try {
    const currentConfig = await imageStudioJson("/api/config");
    const currentModel = currentConfig?.analyzeModel;
    if (!shouldPreemptivelyUpgradeAnalyzeModel(currentModel)) {
      return false;
    }

    await imageStudioJson("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analyzeModel: IMAGE_STUDIO_SAFE_ANALYZE_MODEL }),
    });
    appendImageStudioLog(`[compat] analyze model normalized from ${currentModel} to ${IMAGE_STUDIO_SAFE_ANALYZE_MODEL}`);
    return true;
  } catch (error) {
    appendImageStudioLog(`[compat] failed to normalize analyze model: ${error?.message || error}`);
    return false;
  }
}

async function imageStudioFetch(routePath, init = {}) {
  const status = await ensureImageStudioService();
  if (routeNeedsImageStudioRuntimeConfig(routePath)) {
    await syncImageStudioRuntimeConfig(routePath);
  }
  const projectInfo = getImageStudioProjectInfo();
  const headers = {
    ...getImageStudioAuthHeaders(projectInfo),
    ...(init.headers || {}),
  };
  return fetch(`${status.url}${routePath}`, {
    ...init,
    headers,
  });
}

async function imageStudioJson(routePath, init = {}) {
  const response = await imageStudioFetch(routePath, init);
  const payload = await readImageStudioResponse(response);
  if (!response.ok) {
    const message = getImageStudioErrorMessage(routePath, response, payload);
    appendImageStudioLog(`[http] ${routePath} -> ${response.status}: ${message}`);
    throw new Error(message);
  }
  return payload;
}

function createImageStudioBlob(file) {
  const buffer = Buffer.from(file?.buffer instanceof ArrayBuffer ? new Uint8Array(file.buffer) : []);
  return new Blob([buffer], { type: file?.type || "application/octet-stream" });
}

function createImageStudioFormData(payload = {}) {
  const formData = new FormData();
  const files = Array.isArray(payload.files) ? payload.files : [];
  files.forEach((file, index) => {
    const blob = createImageStudioBlob(file);
    formData.append("images", blob, file?.name || `image-${index + 1}.png`);
  });

  Object.entries(payload.fields || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    formData.append(key, typeof value === "string" ? value : JSON.stringify(value));
  });

  return formData;
}

function normalizeImageStudioHistoryList(payload) {
  return Array.isArray(payload) ? payload : [];
}

function normalizeImageStudioPlanList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.plans)) {
    return payload.plans;
  }
  return [];
}

function normalizeImageStudioTranslationList(payload, fallbackTexts = []) {
  if (Array.isArray(payload)) {
    return payload.map((item, index) => (typeof item === "string" ? item : String(fallbackTexts[index] || "")));
  }
  if (Array.isArray(payload?.translations)) {
    return payload.translations.map((item, index) => (typeof item === "string" ? item : String(fallbackTexts[index] || "")));
  }
  return Array.isArray(fallbackTexts) ? [...fallbackTexts] : [];
}

function getImageStudioPlanForType(plans = [], imageType = "") {
  if (!Array.isArray(plans) || !imageType) {
    return null;
  }
  return plans.find((plan) => plan?.imageType === imageType) || null;
}

function getImageStudioGeneratePlanGroups(plans = [], options = {}) {
  const normalizedPlans = Array.isArray(plans)
    ? plans.filter((plan) => plan && typeof plan === "object")
    : [];
  const prioritizeMain = Boolean(options?.prioritizeMain);

  if (!prioritizeMain || normalizedPlans.length <= 1) {
    return normalizedPlans.length > 0 ? [normalizedPlans] : [];
  }

  const mainPlans = normalizedPlans.filter((plan) => plan?.imageType === "main");
  const otherPlans = normalizedPlans.filter((plan) => plan?.imageType !== "main");

  if (mainPlans.length === 0 || otherPlans.length === 0) {
    return [normalizedPlans];
  }

  return [mainPlans, otherPlans];
}

async function streamImageStudioGenerateBatch({ target, jobId, payload = {}, controller, plans = [], onEvent }) {
  if (!Array.isArray(plans) || plans.length === 0) {
    return;
  }

  const response = await imageStudioFetch("/api/generate", {
    method: "POST",
    body: createImageStudioFormData({
      files: payload.files,
      fields: {
        plans,
        productMode: payload.productMode,
        imageLanguage: payload.imageLanguage,
        imageSize: payload.imageSize,
      },
    }),
    signal: controller?.signal,
  });

  if (!response.ok) {
    const errorPayload = await readImageStudioResponse(response);
    const message = errorPayload && typeof errorPayload === "object" && typeof errorPayload.error === "string"
      ? errorPayload.error
      : (typeof errorPayload === "string" && errorPayload ? errorPayload : "AI 图片请求失败");
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("AI 图片返回为空，无法读取响应流");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = parseImageStudioSseChunk(buffer, (eventPayload) => {
      emitImageStudioEvent(target, {
        jobId,
        type: "generate:event",
        event: eventPayload,
      });
      onEvent?.(eventPayload);
    });
  }

  parseImageStudioSseChunk(buffer, (eventPayload) => {
    emitImageStudioEvent(target, {
      jobId,
      type: "generate:event",
      event: eventPayload,
    });
    onEvent?.(eventPayload);
  });
}

async function saveImageStudioHistorySnapshot(payload = {}) {
  const images = Array.isArray(payload?.images)
    ? payload.images.filter((item) => item?.imageType && item?.imageUrl)
    : [];

  if (images.length === 0) {
    return null;
  }

  return imageStudioJson("/api/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productName: payload?.productName || "未命名商品",
      salesRegion: payload?.salesRegion || "us",
      imageCount: Number(payload?.imageCount) || images.length,
      images,
    }),
  });
}

function parseImageStudioSseChunk(buffer, onEvent) {
  let remaining = buffer;
  let boundaryMatch = remaining.match(/\r?\n\r?\n/);
  while (boundaryMatch) {
    const boundaryIndex = boundaryMatch.index ?? -1;
    if (boundaryIndex < 0) break;
    const chunk = remaining.slice(0, boundaryIndex);
    remaining = remaining.slice(boundaryIndex + boundaryMatch[0].length);
    const lines = chunk.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) continue;
      const payloadText = trimmed.slice(5).trim();
      if (!payloadText) continue;
      try {
        onEvent(JSON.parse(payloadText));
      } catch {}
    }
    boundaryMatch = remaining.match(/\r?\n\r?\n/);
  }
  return remaining;
}

async function streamImageStudioGenerate(target, jobId, payload = {}) {
  const controller = new AbortController();
  imageStudioGenerateControllers.set(jobId, controller);
  const generatedImages = [];
  const emittedComplete = { current: false };
  const normalizedPlans = Array.isArray(payload.plans) ? payload.plans : [];
  const totalPlans = normalizedPlans.length;
  const planGroups = getImageStudioGeneratePlanGroups(normalizedPlans, {
    prioritizeMain: false,
  });
  const mainPriorityEnabled = false;

  const appendGeneratedImage = (eventPayload) => {
    if (eventPayload?.status !== "done" || !eventPayload?.imageUrl) {
      return;
    }

    const currentPlan = getImageStudioPlanForType(normalizedPlans, eventPayload.imageType || "");
    generatedImages.push({
      imageType: eventPayload.imageType || "",
      imageUrl: eventPayload.imageUrl,
      prompt: currentPlan?.prompt || "",
      suggestion: typeof currentPlan?.suggestion === "string" ? currentPlan.suggestion : "",
      createdAt: Date.now(),
    });
    updateImageStudioJob(jobId, {
      results: [...generatedImages],
      progress: { done: generatedImages.length, total: totalPlans, step: `生成中 ${generatedImages.length}/${totalPlans}` },
    });
  };

  const emitComplete = async () => {
    if (emittedComplete.current) return;
    emittedComplete.current = true;

    let historySaved = false;
    let historyId = null;
    let historySaveError = null;
    const completedImages = generatedImages.map((image) => {
      const currentPlan = getImageStudioPlanForType(normalizedPlans, image?.imageType || "");
      return {
        ...image,
        prompt: image?.prompt || currentPlan?.prompt || "",
        suggestion: image?.suggestion || (typeof currentPlan?.suggestion === "string" ? currentPlan.suggestion : ""),
        createdAt: image?.createdAt || Date.now(),
      };
    });

    if (completedImages.length > 0) {
      try {
        const historyResult = await saveImageStudioHistorySnapshot({
          productName: payload?.productName || "",
          salesRegion: payload?.salesRegion || "us",
          imageCount: completedImages.length,
          images: completedImages,
        });
        historySaved = Boolean(historyResult?.id);
        historyId = historyResult?.id || null;
        // 同步把上传的素材图落盘到 userData，供后续从历史恢复后重绘使用
        if (historyId && Array.isArray(payload?.files) && payload.files.length > 0) {
          try {
            const sourcesDir = path.join(app.getPath("userData"), "image-studio-sources", historyId);
            fs.mkdirSync(sourcesDir, { recursive: true });
            payload.files.forEach((f, idx) => {
              const buf = Buffer.isBuffer(f?.buffer) ? f.buffer : Buffer.from(f?.buffer || []);
              const safeName = String(f?.name || `source-${idx}`).replace(/[<>:"/\\|?*]/g, "_").slice(0, 80);
              const ext = (safeName.match(/\.[a-zA-Z0-9]+$/)?.[0]) || (((f?.type || "").includes("png")) ? ".png" : ".jpg");
              const final = safeName.includes(".") ? safeName : `${safeName}${ext}`;
              try { fs.writeFileSync(path.join(sourcesDir, `${idx}-${final}`), buf); } catch {}
            });
            const metaPath = path.join(sourcesDir, "meta.json");
            const metaList = payload.files.map((f, idx) => ({
              index: idx,
              name: String(f?.name || `source-${idx}`),
              type: String(f?.type || "image/jpeg"),
            }));
            try { fs.writeFileSync(metaPath, JSON.stringify({ historyId, files: metaList }, null, 2)); } catch {}
          } catch (e) {
            appendImageStudioLog(`[history] source save failed for ${jobId}: ${e?.message || e}`);
          }
        }
      } catch (error) {
        historySaveError = error?.message || "自动保存历史记录失败";
        appendImageStudioLog(`[history] background save failed for ${jobId}: ${historySaveError}`);
      }
    }

    updateImageStudioJob(jobId, {
      status: "done",
      results: [...completedImages],
      finishedAt: Date.now(),
      progress: { done: completedImages.length, total: totalPlans, step: "完成" },
      historySaved,
      historyId,
      historySaveError,
    });
    emitImageStudioEvent(target, {
      jobId,
      type: "generate:complete",
      results: completedImages,
      historySaved,
      historyId,
      historySaveError,
    });
  };

  try {
    updateImageStudioJob(jobId, { status: "running", progress: { done: 0, total: totalPlans, step: "开始生成" } });
    emitImageStudioEvent(target, { jobId, type: "generate:started" });
    if (mainPriorityEnabled) {
      updateImageStudioJob(jobId, {
        progress: {
          done: 0,
          total: totalPlans,
          step: "主图优先生成中...",
        },
      });

      for (let groupIndex = 0; groupIndex < planGroups.length; groupIndex += 1) {
        if (controller.signal.aborted) {
          break;
        }

        const currentPlans = planGroups[groupIndex] || [];
        const isMainStage = currentPlans.some((plan) => plan?.imageType === "main");

        updateImageStudioJob(jobId, {
          progress: {
            done: generatedImages.length,
            total: totalPlans,
            step: isMainStage ? "主图优先生成中..." : "主图已完成，继续生成其他图片",
          },
        });

        await streamImageStudioGenerateBatch({
          target,
          jobId,
          payload,
          controller,
          plans: currentPlans,
          onEvent: appendGeneratedImage,
        });
      }

      if (controller.signal.aborted) {
        throw new Error("generate cancelled");
      }

      await emitComplete();
      return;
    }

    const response = await imageStudioFetch("/api/generate", {
      method: "POST",
      body: createImageStudioFormData({
        files: payload.files,
        fields: {
          plans: payload.plans,
          productMode: payload.productMode,
          imageLanguage: payload.imageLanguage,
          imageSize: payload.imageSize,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorPayload = await readImageStudioResponse(response);
      const message = errorPayload && typeof errorPayload === "object" && typeof errorPayload.error === "string"
        ? errorPayload.error
        : (typeof errorPayload === "string" && errorPayload ? errorPayload : "AI 出图请求失败");
      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("AI 出图服务未返回流式结果");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseImageStudioSseChunk(buffer, (eventPayload) => {
        emitImageStudioEvent(target, {
          jobId,
          type: "generate:event",
          event: eventPayload,
        });

        appendGeneratedImage(eventPayload);

        if (eventPayload?.status === "complete") {
          void emitComplete();
        }
      });
    }

    buffer = parseImageStudioSseChunk(buffer, (eventPayload) => {
      emitImageStudioEvent(target, {
        jobId,
        type: "generate:event",
        event: eventPayload,
      });

      appendGeneratedImage(eventPayload);

      if (eventPayload?.status === "complete") {
        void emitComplete();
      }
    });

    await emitComplete();
  } catch (error) {
    if (controller.signal.aborted) {
      updateImageStudioJob(jobId, { status: "cancelled", finishedAt: Date.now() });
      emitImageStudioEvent(target, {
        jobId,
        type: "generate:cancelled",
        message: "已取消本次生成",
      });
      return;
    }

    updateImageStudioJob(jobId, { status: "failed", error: error?.message || "AI 出图失败", finishedAt: Date.now() });
    emitImageStudioEvent(target, {
      jobId,
      type: "generate:error",
      error: error?.message || "AI 出图失败",
    });
  } finally {
    imageStudioGenerateControllers.delete(jobId);
  }
}
// ============ 窗口 ============

async function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    title: "Temu 自动化运营工具",
    show: false,
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.once("did-finish-load", () => {
    mainWindow.show();
  });

  // 开发模式：等待 Vite dev server 就绪（最多30秒）
  const devUrl = "http://localhost:1420";
  const forcedProduction = process.env.NODE_ENV === "production";
  const isDev = !forcedProduction && (process.env.NODE_ENV === "development" || !app.isPackaged);

  if (isDev) {
    console.log("[Main] Dev mode: waiting for Vite server...");
    const maxWait = 30000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        await new Promise((resolve, reject) => {
          const req = http.get(devUrl, (res) => { res.resume(); resolve(true); });
          req.on("error", reject);
          req.setTimeout(2000, () => { req.destroy(); reject(new Error("timeout")); });
        });
        break;
      } catch {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    console.log("[Main] Loading from Vite dev server");
    mainWindow.loadURL(devUrl);
  } else {
    // 打包后 dist 在 app 根目录（extraFiles），开发时在项目根目录
    const distCandidates = [
      path.join(__dirname, "../dist/index.html"),
      app.isPackaged ? path.join(path.dirname(app.getPath("exe")), "dist", "index.html") : "",
    ].filter(Boolean);
    const distPath = distCandidates.find(p => fs.existsSync(p));
    if (distPath) {
      console.log("[Main] Loading from dist:", distPath);
      mainWindow.loadFile(distPath);
    } else {
      console.log("[Main] Fallback to dev URL");
      mainWindow.loadURL(devUrl);
    }
  }

  // DevTools: 按 F12 手动打开
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F12") mainWindow.webContents.toggleDevTools();
  });
  if (isDev && process.env.TEMU_OPEN_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools({ mode: "bottom" });
  }
  mainWindow.on("closed", () => { mainWindow = null; });
}

// === 账号 id 变更数据迁移 ===
// 问题：账号被删除重建后会拿到新的 acc_<ts>，但旧的 scoped 采集数据仍存在
// 旧 id 下，导致"尚未采集"。此函数在启动时按手机号稳定映射，把孤儿 scoped
// 文件自动迁移到当前账号 id 下，并持续维护 phone→accountId 历史。
function normalizePhoneForMigration(phone) {
  return typeof phone === "string" ? phone.replace(/\D+/g, "") : "";
}
function migrateScopedStoreFilesForAccountIdChange() {
  try {
    const baseDir = app.getPath("userData");
    if (!fs.existsSync(baseDir)) return;

    // 1. 读取当前账号列表
    let accounts = [];
    try {
      accounts = readStoreJsonWithRecovery(getStoreFilePath(ACCOUNT_STORE_KEY), ACCOUNT_STORE_KEY) || [];
    } catch { accounts = []; }
    if (!Array.isArray(accounts)) accounts = [];
    const currentAccounts = accounts
      .map((a) => ({ id: String(a?.id || ""), phone: normalizePhoneForMigration(a?.phone) }))
      .filter((a) => a.id && a.phone);
    if (currentAccounts.length === 0) return;
    const currentIds = new Set(currentAccounts.map((a) => a.id));

    // 2. 读取 phone→id 历史
    const HISTORY_KEY = "temu_account_id_history";
    let history = {};
    try {
      const raw = readStoreJsonWithRecovery(getStoreFilePath(HISTORY_KEY), HISTORY_KEY);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) history = raw;
    } catch { history = {}; }

    // 3. 扫描所有 scoped 文件，按 id 分组 baseKey 集合
    const SCOPED_PREFIX_ENCODED = "temu_store%3A"; // = "temu_store:"
    const scopedByAccountId = new Map(); // id -> Set(baseKey)
    let files = [];
    try { files = fs.readdirSync(baseDir); } catch { return; }
    for (const fname of files) {
      if (!fname.startsWith(SCOPED_PREFIX_ENCODED)) continue;
      if (!fname.endsWith(".json") || fname.endsWith(".bak")) continue;
      // 解码: temu_store%3Aacc_xxx%3AbaseKey.json
      let decoded = "";
      try { decoded = decodeURIComponent(fname.slice(0, -".json".length)); } catch { continue; }
      // 格式: temu_store:<accId>:<baseKey>
      const parts = decoded.split(":");
      if (parts.length < 3 || parts[0] !== "temu_store") continue;
      const accId = parts[1];
      const baseKey = parts.slice(2).join(":");
      if (!accId || !baseKey) continue;
      if (!scopedByAccountId.has(accId)) scopedByAccountId.set(accId, new Set());
      scopedByAccountId.get(accId).add(baseKey);
    }

    const renameScopedFilesFromTo = (oldId, newId) => {
      if (!oldId || !newId || oldId === newId) return 0;
      let count = 0;
      for (const fname of files) {
        if (!fname.startsWith(SCOPED_PREFIX_ENCODED)) continue;
        let decoded = "";
        try { decoded = decodeURIComponent(fname.replace(/\.bak$/i, "").replace(/\.json$/i, "")); } catch { continue; }
        const parts = decoded.split(":");
        if (parts.length < 3 || parts[1] !== oldId) continue;
        const baseKey = parts.slice(2).join(":");
        const suffix = fname.endsWith(".bak") ? ".json.bak" : ".json";
        const newName = encodeURIComponent(`temu_store:${newId}:${baseKey}`) + suffix;
        const src = path.join(baseDir, fname);
        const dst = path.join(baseDir, newName);
        try {
          // 若目标已有文件，保留目标（较新数据），删除源
          if (fs.existsSync(dst)) {
            fs.unlinkSync(src);
          } else {
            fs.renameSync(src, dst);
          }
          count += 1;
        } catch (e) {
          console.error(`[migrate] rename failed ${fname} -> ${newName}: ${e.message}`);
        }
      }
      return count;
    };

    // 4. 前向迁移：history 里 phone 对应的旧 id 与当前 id 不同，则迁移
    let migratedTotal = 0;
    for (const { id: currentId, phone } of currentAccounts) {
      const oldId = history[phone];
      if (oldId && oldId !== currentId && scopedByAccountId.has(oldId)) {
        const n = renameScopedFilesFromTo(oldId, currentId);
        if (n > 0) {
          console.log(`[migrate] phone ${phone}: ${oldId} -> ${currentId} (${n} files)`);
          migratedTotal += n;
          scopedByAccountId.delete(oldId);
        }
      }
    }

    // 5. 启发式回退：恰好一个当前账号无 scoped 数据，且恰好一个孤儿 id 有数据
    const accountsWithoutData = currentAccounts.filter(
      (a) => !scopedByAccountId.has(a.id) || scopedByAccountId.get(a.id).size === 0,
    );
    const orphanIds = Array.from(scopedByAccountId.keys()).filter((id) => !currentIds.has(id));
    if (accountsWithoutData.length === 1 && orphanIds.length === 1) {
      // 若孤儿 id 在 history 里没有归属（或归属 phone 已不存在），则认为是该账号
      const orphanId = orphanIds[0];
      const orphanHistoryPhone = Object.keys(history).find((p) => history[p] === orphanId);
      const orphanOwnerStillExists = orphanHistoryPhone && currentAccounts.some((a) => a.phone === orphanHistoryPhone);
      if (!orphanOwnerStillExists) {
        const target = accountsWithoutData[0];
        const n = renameScopedFilesFromTo(orphanId, target.id);
        if (n > 0) {
          console.log(`[migrate] heuristic orphan ${orphanId} -> ${target.id} (phone=${target.phone}, ${n} files)`);
          migratedTotal += n;
          if (orphanHistoryPhone) delete history[orphanHistoryPhone];
        }
      }
    }

    // 6. 更新 phone→id 历史（始终记录当前账号最新 id）
    for (const { id, phone } of currentAccounts) {
      history[phone] = id;
    }
    try {
      const historyPath = getStoreFilePath(HISTORY_KEY);
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
    } catch (e) {
      console.error(`[migrate] failed to save history: ${e.message}`);
    }

    if (migratedTotal > 0) {
      console.log(`[migrate] Total scoped files migrated: ${migratedTotal}`);
    }
  } catch (e) {
    console.error(`[migrate] scoped store migration failed: ${e.message}`);
  }
}

app.whenReady().then(async () => {
  // 启动时先做 scoped 数据 id 迁移，避免账号重建后旧数据孤立
  migrateScopedStoreFilesForAccountIdChange();

  // 载入持久化的 AI 凭证覆盖 (用户在 Settings 中设置的 Key)
  hydrateImageStudioRuntimeConfigFromDisk();

  const imageStudioStartupPromise = ensureImageStudioService()
    .then((status) => {
      console.log("[Main] Image studio auto-started successfully");
      return status;
    })
    .catch((e) => {
      console.error("[Main] Image studio auto-start failed (will retry on demand):", e.message);
      return null;
    });

  await createWindow();

  const imageStudioStartupStatus = await imageStudioStartupPromise;
  try {
    await ensureWorkerStarted({ aiImageServer: imageStudioStartupStatus?.url || imageStudioStatus.url });
    console.log("[Main] Worker auto-started successfully");
  } catch (e) {
    console.error("[Main] Worker auto-start failed (will retry on demand):", e.message);
  }
  // 自动检查更新（延迟5秒，避免阻塞启动）
  configureAutoUpdater();
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 5000);
  }
});
app.on("window-all-closed", () => { stopWorker(); stopImageStudioService(); app.quit(); });
app.on("activate", () => { if (!mainWindow) createWindow(); });

// ============ IPC ============

ipcMain.handle("get-app-path", () => app.getPath("userData"));

ipcMain.handle("select-file", async (_e, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: filters || [{ name: "表格文件", extensions: ["xlsx", "xls", "csv"] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle("automation:login", async (_, accountId, phone, password) => {
  return sendCmd("login", { accountId, phone, password });
});

ipcMain.handle("automation:scrape-products", async () => {
  return sendCmd("scrape_products");
});

ipcMain.handle("automation:scrape-orders", async () => {
  return sendCmd("scrape_orders");
});

ipcMain.handle("automation:scrape-sales", async () => {
  return sendCmd("scrape_sales");
});

ipcMain.handle("automation:scrape-flux", async () => {
  return sendCmd("scrape_flux");
});

ipcMain.handle("automation:scrape-dashboard", async () => {
  return sendCmd("scrape_dashboard");
});

ipcMain.handle("automation:scrape-aftersales", async () => {
  return sendCmd("scrape_aftersales");
});

ipcMain.handle("automation:scrape-soldout", async () => {
  return sendCmd("scrape_soldout");
});

ipcMain.handle("automation:scrape-goods-data", async () => {
  return sendCmd("scrape_goods_data");
});

ipcMain.handle("automation:scrape-activity", async () => {
  return sendCmd("scrape_activity");
});

ipcMain.handle("automation:scrape-performance", async () => {
  return sendCmd("scrape_performance");
});

ipcMain.handle("automation:scrape-all", async () => {
  if (!workerReady) await ensureWorkerStarted();
  const credentials = getActiveWorkerCredentials();
  return httpPost(workerPort, { action: "scrape_all", params: { credentials }, timeoutMs: 30 * 60 * 1000 });
});

ipcMain.handle("automation:filter-product-table", async (_e, csvPath) => {
  const result = filterAutoPricingProductTable(csvPath);
  return result;
});

ipcMain.handle("automation:auto-pricing", async (_e, params) => {
  const existingTask = getAutoPricingTask(autoPricingCurrentTaskId);
  if (existingTask && ["running", "pausing", "paused"].includes(existingTask.status)) {
    return {
      accepted: false,
      taskId: existingTask.taskId,
      message: "已有批量上品任务正在执行，请先等待完成或恢复当前任务。",
      task: getAutoPricingProgressPayload(existingTask),
    };
  }

  // 优先尝试启动 AI 出图服务，但 runtime 缺失时不应该让整个批量上品任务无法启动。
  // 单个商品在生图阶段失败会被任务内部记录为 failed，但 worker 仍能跑分类搜索/属性匹配/草稿提交等其他阶段。
  let imageStudioUrl = "";
  try {
    const imageStudio = await ensureImageStudioService();
    imageStudioUrl = imageStudio?.url || "";
  } catch (err) {
    console.error(`[Main] Image studio unavailable, auto-pricing will run without it: ${err?.message || err}`);
    imageStudioUrl = workerAiImageServer || process.env.AI_IMAGE_SERVER || getImageStudioBaseUrl(imageStudioPort);
  }
  await ensureWorkerStarted({ aiImageServer: imageStudioUrl });
  const credentials = getActiveWorkerCredentials();

  const now = new Date().toLocaleString("zh-CN");
  const taskId = typeof params?.taskId === "string" && params.taskId.trim()
    ? params.taskId.trim()
    : `pricing_${Date.now()}`;

  const nextTask = upsertAutoPricingTask({
    taskId,
    status: "running",
    running: true,
    paused: false,
    total: Number(params?.count) || 0,
    completed: 0,
    current: "准备中...",
    step: "初始化",
    message: "批量上品任务已启动",
    csvPath: typeof params?.csvPath === "string" ? params.csvPath : "",
    startRow: Number(params?.startRow) || 0,
    count: Number(params?.count) || 0,
    results: [],
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: "",
  });

  startAutoPricingTaskSync();
  autoPricingTaskPromise = sendCmd("auto_pricing", {
    ...params,
    taskId,
    credentials,
    timeoutMs: 60 * 60 * 1000,
  })
    .then((result) => {
      const finishedAt = new Date().toLocaleString("zh-CN");
      appendCreateHistoryEntries((result?.results || []).map((item) => ({
        title: item?.name || "商品",
        status: item?.success ? "draft" : "failed",
        message: item?.message || "",
        productId: item?.productId || "",
        createdAt: Date.now(),
      })));
      upsertAutoPricingTask({
        ...nextTask,
        taskId,
        status: result?.success === false ? "failed" : "completed",
        running: false,
        paused: false,
        total: Number(result?.total) || nextTask.total,
        completed: Number(result?.total) || (Array.isArray(result?.results) ? result.results.length : nextTask.completed),
        current: "完成",
        step: result?.success === false ? "失败" : "完成",
        message: result?.message || "批量上品任务已完成",
        results: Array.isArray(result?.results) ? result.results : nextTask.results,
        updatedAt: finishedAt,
        finishedAt,
      });
      return result;
    })
    .catch(async (error) => {
      const live = await requestWorkerProgressSnapshot(taskId);
      if (live?.running || live?.paused) {
        upsertAutoPricingTask({
          ...nextTask,
          taskId,
          status: live.paused ? "paused" : "running",
          running: Boolean(live.running),
          paused: Boolean(live.paused),
          total: Number(live.total) || nextTask.total,
          completed: Number(live.completed) || nextTask.completed,
          current: typeof live.current === "string" ? live.current : nextTask.current,
          step: typeof live.step === "string" ? live.step : nextTask.step,
          results: Array.isArray(live.results) ? live.results : nextTask.results,
          updatedAt: new Date().toLocaleString("zh-CN"),
          message: "与 worker 的长连接已断开，正在根据实时进度继续跟踪任务。",
        });
        return null;
      }

      const failedAt = new Date().toLocaleString("zh-CN");
      upsertAutoPricingTask({
        ...nextTask,
        taskId,
        status: "failed",
        running: false,
        paused: false,
        current: "失败",
        step: "失败",
        message: error?.message || "批量上品任务失败",
        updatedAt: failedAt,
        finishedAt: failedAt,
      });
      return null;
    })
    .finally(async () => {
      autoPricingTaskPromise = null;
      const latestTask = await syncActiveAutoPricingTaskFromWorker({ markInterruptedOnIdle: true });
      if (!latestTask || !latestTask.running) {
        stopAutoPricingTaskSync();
      }
    });

  return {
    accepted: true,
    taskId,
    task: getAutoPricingProgressPayload(nextTask),
  };
});

ipcMain.handle("automation:pause-pricing", async (_e, taskId) => {
  await sendCmd("pause_pricing", { taskId });
  const activeTask = getAutoPricingTask(taskId || autoPricingCurrentTaskId);
  if (activeTask) {
    const nextTask = upsertAutoPricingTask({
      ...activeTask,
      status: "pausing",
      running: true,
      paused: false,
      message: "暂停请求已发送，当前商品处理完后停止。",
      updatedAt: new Date().toLocaleString("zh-CN"),
    });
    startAutoPricingTaskSync();
    return getAutoPricingProgressPayload(nextTask);
  }
  return getAutoPricingProgressPayload(getAutoPricingTask(taskId || autoPricingCurrentTaskId));
});

ipcMain.handle("automation:resume-pricing", async (_e, taskId) => {
  await sendCmd("resume_pricing", { taskId });
  const activeTask = getAutoPricingTask(taskId || autoPricingCurrentTaskId);
  if (activeTask) {
    const nextTask = upsertAutoPricingTask({
      ...activeTask,
      status: "running",
      running: true,
      paused: false,
      message: "批量上品任务已恢复。",
      updatedAt: new Date().toLocaleString("zh-CN"),
    });
    startAutoPricingTaskSync();
    return getAutoPricingProgressPayload(nextTask);
  }
  startAutoPricingTaskSync();
  return getAutoPricingProgressPayload(getAutoPricingTask(taskId || autoPricingCurrentTaskId));
});

ipcMain.handle("automation:list-drafts", async () => {
  return sendCmd("list_drafts");
});

ipcMain.handle("automation:retry-draft", async (_e, draftId) => {
  return sendCmd("retry_draft", { draftId });
});

ipcMain.handle("automation:delete-draft", async (_e, draftId) => {
  return sendCmd("delete_draft", { draftId });
});

ipcMain.handle("automation:get-progress", async () => {
  const syncedTask = await syncActiveAutoPricingTaskFromWorker({ markInterruptedOnIdle: true });
  return getAutoPricingProgressPayload(syncedTask || getAutoPricingTask(autoPricingCurrentTaskId));
});

ipcMain.handle("automation:get-task-progress", async (_e, taskId) => {
  await syncAutoPricingTaskFromWorker(taskId, { markInterruptedOnIdle: true });
  return getAutoPricingProgressPayload(getAutoPricingTask(taskId));
});

ipcMain.handle("automation:list-tasks", async () => {
  await syncWorkerTaskSnapshotsToStore();
  await syncActiveAutoPricingTaskFromWorker({ markInterruptedOnIdle: true });
  return listAutoPricingTasks().map((task) => getAutoPricingProgressPayload(task));
});

ipcMain.handle("automation:read-scrape-data", async (_e, key) => {
  return sendCmd("read_scrape_data", { key });
});

ipcMain.handle("automation:get-scrape-progress", async () => {
  return sendCmd("scrape_progress");
});

ipcMain.handle("automation:scrape-lifecycle", async () => { return sendCmd("scrape_lifecycle"); });
ipcMain.handle("automation:scrape-bidding", async () => { return sendCmd("scrape_bidding"); });
ipcMain.handle("automation:scrape-price-compete", async () => { return sendCmd("scrape_price_compete"); });
ipcMain.handle("automation:scrape-hot-plan", async () => { return sendCmd("scrape_hot_plan"); });
ipcMain.handle("automation:scrape-checkup", async () => { return sendCmd("scrape_checkup"); });
ipcMain.handle("automation:scrape-us-retrieval", async () => { return sendCmd("scrape_us_retrieval"); });
ipcMain.handle("automation:scrape-delivery", async () => { return sendCmd("scrape_delivery"); });
ipcMain.handle("automation:scrape-global-performance", async (_e, params) => {
  return sendCmd("scrape_global_performance", { range: params?.range || "30d" });
});
ipcMain.handle("automation:scrape-flux-product-detail", async (_e, params) => {
  return sendCmd("scrape_flux_product_detail", params || {});
});
ipcMain.handle("automation:scrape-skc-region-detail", async (_e, params) => {
  return sendCmd("scrape_skc_region_detail", { productId: params?.productId, range: params?.range || "30d" });
});
ipcMain.handle("automation:yundu-list-overall", async (_e, params) => sendCmd("yundu_list_overall", params || {}));
ipcMain.handle("automation:yundu-site-count", async (_e, params) => sendCmd("yundu_site_count", params || {}));
ipcMain.handle("automation:yundu-high-price-limit", async (_e, params) => sendCmd("yundu_high_price_limit", params || {}));
ipcMain.handle("automation:yundu-quality-metrics", async (_e, params) => sendCmd("yundu_quality_metrics", params || {}));
ipcMain.handle("automation:yundu-activity-list", async (_e, params) => sendCmd("yundu_activity_list", params || {}));
ipcMain.handle("automation:yundu-activity-enrolled", async (_e, params) => sendCmd("yundu_activity_enrolled", params || {}));
ipcMain.handle("automation:yundu-activity-match", async (_e, params) => sendCmd("yundu_activity_match", params || {}));
ipcMain.handle("automation:yundu-activity-submit", async (_e, params) => sendCmd("yundu_activity_submit", params || {}));
ipcMain.handle("automation:yundu-auto-enroll", async (_e, params) => sendCmd("yundu_auto_enroll", params || {}));

ipcMain.handle("automation:close", async () => {
  return sendCmd("close");
});

ipcMain.handle("automation:ping", async () => {
  return sendCmd("ping");
});

// ============ 竞品分析 IPC ============

ipcMain.handle("competitor:search", async (_e, params) => sendCmd("competitor_search", params || {}));
ipcMain.handle("competitor:track", async (_e, params) => sendCmd("competitor_track", params || {}));
ipcMain.handle("competitor:batch-track", async (_e, params) => sendCmd("competitor_batch_track", params || {}));
ipcMain.handle("competitor:auto-register", async (_e, params) => sendCmd("competitor_auto_register", params || {}, { timeoutMs: 10 * 60 * 1000 }));
ipcMain.handle("competitor:set-yunqi-token", async (_e, token) => sendCmd("set_yunqi_token", { token }));
ipcMain.handle("competitor:get-yunqi-token", async () => sendCmd("get_yunqi_token", {}));
ipcMain.handle("competitor:set-yunqi-credentials", async (_e, params) => sendCmd("yunqi_set_credentials", params || {}));
ipcMain.handle("competitor:get-yunqi-credentials", async () => sendCmd("yunqi_get_credentials", {}));
ipcMain.handle("competitor:delete-yunqi-credentials", async () => sendCmd("yunqi_delete_credentials", {}));
ipcMain.handle("competitor:yunqi-auto-login", async () => sendCmd("yunqi_auto_login", {}, { timeoutMs: 2 * 60 * 1000 }));

/**
 * 把远程图片 URL 拉成 base64 data URL，供 multimodal 请求使用。
 * 超时 15s，最大 5MB；失败抛错由上层捕获。
 */
async function fetchImageAsDataUrl(rawImageUrl, timeoutMs = 15000) {
  // Chromium 在 HTTPS-Only / HSTS 下会把明文 http 请求直接拒（ERR_BLOCKED_BY_CLIENT）
  // 阿里云 OSS 等主流 CDN 都支持 https，OSS 签名不含协议，直接升级
  const imageUrl = typeof rawImageUrl === "string" && rawImageUrl.startsWith("http://")
    ? "https://" + rawImageUrl.slice("http://".length)
    : rawImageUrl;

  // 按 host 定 Referer：Temu CDN（kwcdn / temu）的图通常要求同源 Referer 才给过
  const pickReferer = (url) => {
    try {
      const host = new URL(url).host;
      if (host.includes("kwcdn.com")) return "https://www.temu.com/";
      if (host.includes("temu.com")) return "https://www.temu.com/";
      if (host.includes("yangkeduo.com") || host.includes("pinduoduo.com") || host.includes("yzcdn.cn")) return "https://mms.pinduoduo.com/";
      if (host.includes("kuajingmaihuo.com")) return "https://kuajingmaihuo.com/";
      return `https://${host}/`;
    } catch {
      return "";
    }
  };

  // 用 Electron net.fetch —— 走 Chromium 网络栈，TLS 指纹 / Cookie / 协议特性都贴近浏览器，
  // 能绕过 Temu 等 CDN 对 Node undici 的拦截
  const doFetch = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      request.abort();
      reject(new Error(`请求超时 ${timeoutMs}ms`));
    }, timeoutMs);

    // 用独立 session，绕开默认 session 上可能挂着的 webRequest 拦截器（避免 ERR_BLOCKED_BY_CLIENT）
    const isolatedSession = electronSession.fromPartition("image-fetch-isolated");
    const request = electronNet.request({
      method: "GET",
      url: imageUrl,
      session: isolatedSession,
      useSessionCookies: false,
      redirect: "follow",
    });
    request.setHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
    request.setHeader("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
    request.setHeader("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
    const referer = pickReferer(imageUrl);
    if (referer) request.setHeader("Referer", referer);

    request.on("response", (response) => {
      const statusCode = response.statusCode;
      const contentType = (response.headers["content-type"] || "image/jpeg");
      const contentTypeStr = Array.isArray(contentType) ? contentType[0] : contentType;
      const chunks = [];
      let totalBytes = 0;
      const maxBytes = 5 * 1024 * 1024;
      let aborted = false;

      response.on("data", (chunk) => {
        if (aborted) return;
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          aborted = true;
          request.abort();
          clearTimeout(timer);
          reject(new Error(`图片过大（> 5MB）`));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (aborted) return;
        clearTimeout(timer);
        if (statusCode < 200 || statusCode >= 300) {
          return reject(new Error(`HTTP ${statusCode} while fetching ${imageUrl}`));
        }
        const buffer = Buffer.concat(chunks);
        // CDN 常返回 application/octet-stream（Temu kwcdn 尤其），Gemini 不认；
        // 通过 magic bytes 嗅探真实图片格式
        const sniffImageMime = (buf) => {
          if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
          if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
          if (buf.length >= 12 && buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
          if (buf.length >= 6 && (buf.slice(0, 6).toString("ascii") === "GIF87a" || buf.slice(0, 6).toString("ascii") === "GIF89a")) return "image/gif";
          if (buf.length >= 12 && buf.slice(4, 8).toString("ascii") === "ftyp" && ["avif", "avis"].includes(buf.slice(8, 12).toString("ascii"))) return "image/avif";
          return null;
        };
        const sniffed = sniffImageMime(buffer);
        const lowered = String(contentTypeStr).toLowerCase();
        const finalMime = sniffed
          || (lowered.startsWith("image/") ? lowered.split(";")[0].trim() : null)
          || "image/jpeg";
        const base64 = buffer.toString("base64");
        resolve(`data:${finalMime};base64,${base64}`);
      });
      response.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    request.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    request.end();
  });

  return doFetch();
}

/**
 * 竞品主图 AI 视觉对比：
 * 把我方 + 竞品主图一起丢给 Gemini（走 OpenAI-compat 的 vectorengine.ai），
 * 返回 { myStrengths, myWeaknesses, competitorTakeaways, improvements } 结构化建议。
 */
ipcMain.handle("competitor:vision-compare", async (_event, payload) => {
  const myImage = payload?.myImage || null;
  const competitorImages = Array.isArray(payload?.competitorImages) ? payload.competitorImages.slice(0, 3) : [];
  const context = payload?.context || {};

  if (!myImage?.url && competitorImages.length === 0) {
    throw new Error("没有可分析的图片");
  }

  const runtimeConfig = readImageStudioRuntimeConfig();
  const apiKey = runtimeConfig.analyzeApiKey;
  const rawBaseUrl = runtimeConfig.analyzeBaseUrl || "https://api.vectorengine.ai";
  const model = runtimeConfig.analyzeModel || "gemini-3.1-flash-lite-preview";

  if (!apiKey) {
    throw new Error("[ANALYZE_API_KEY_MISSING] 未配置分析用的 Gemini API Key，请到设置里填写");
  }

  // 把配置里的 baseUrl 归一化成 origin：去掉 /v1、/v1beta 等路径后缀，保留 scheme + host
  const baseOrigin = (() => {
    try {
      const u = new URL(rawBaseUrl);
      return `${u.protocol}//${u.host}`;
    } catch {
      return String(rawBaseUrl).replace(/\/+$/, "").replace(/\/v1(beta)?.*$/, "");
    }
  })();

  // 并发拉取所有图片（我方 + 竞品）
  const allImages = [
    ...(myImage?.url ? [{ role: "my", title: myImage.title || "我的主图", url: myImage.url }] : []),
    ...competitorImages.map((item, index) => ({
      role: "competitor",
      index: index + 1,
      title: item.title || `竞品 #${index + 1}`,
      priceText: item.priceText || "",
      monthlySales: item.monthlySales || 0,
      url: item.url,
    })),
  ];

  const fetched = await Promise.all(allImages.map(async (item) => {
    try {
      console.log(`[vision-compare] fetching ${item.role} image: ${String(item.url).slice(0, 200)}`);
      const dataUrl = await fetchImageAsDataUrl(item.url);
      console.log(`[vision-compare] ok ${item.role} (${item.title}) size=${Math.round(dataUrl.length / 1024)}KB`);
      return { ...item, dataUrl, error: null };
    } catch (error) {
      const msg = String(error?.message || error);
      console.warn(`[vision-compare] FAIL ${item.role} (${item.title}) url=${String(item.url).slice(0, 200)} err=${msg}`);
      return { ...item, dataUrl: null, error: msg };
    }
  }));

  const usable = fetched.filter((item) => item.dataUrl);
  if (usable.length === 0) {
    throw new Error("所有图片都拉取失败：" + fetched.map((i) => i.error).filter(Boolean).join(" / "));
  }

  // 竞品图全挂时，不再让 Gemini 靠文字瞎猜竞品。常见原因是 OSS 签名过期（403）。
  const competitorFailed = fetched.filter((item) => item.role === "competitor" && !item.dataUrl);
  const competitorOk = fetched.filter((item) => item.role === "competitor" && item.dataUrl);
  if (competitorImages.length > 0 && competitorOk.length === 0) {
    const looksExpired = competitorFailed.some((item) => /HTTP 403/i.test(item.error || "") || /Expires=\d+/.test(item.url || ""));
    const reason = looksExpired
      ? "竞品主图的 OSS 签名已过期（403 Forbidden），请回到步骤 3 点「刷新样本」重新抓取后再试。"
      : "竞品主图全部拉取失败，无法做视觉对比。";
    const detail = competitorFailed.map((item) => `${item.title}: ${item.error}`).join("；");
    throw new Error(`${reason}\n失败明细：${detail}`);
  }

  // Gemini 原生 API（v1beta）的 systemInstruction + contents[parts] 格式
  const systemPrompt = [
    "你是 Temu 电商主图优化顾问。",
    "用户会提供 1 张「我的主图」和若干张「竞品主图」，需要你做视觉对比。",
    "请严格输出 JSON，格式为：",
    `{`,
    `  "myStrengths": ["我方主图的具体优势，2-3 条，每条 <25 字"],`,
    `  "myWeaknesses": ["我方主图相对竞品的问题，2-3 条，每条 <25 字"],`,
    `  "competitorTakeaways": [{"title":"竞品标题","takeaway":"值得借鉴的点，<30 字"}],`,
    `  "improvements": [{"priority":"P0|P1|P2","action":"具体改图动作，<35 字"}]`,
    `}`,
    "- priority 规则：P0=明显拖后腿不改不行，P1=建议跟进，P2=锦上添花",
    "- 只输出 JSON，不要解释，不要 markdown。",
  ].join("\n");

  const userTextPart = {
    text: [
      `关键词：${context.keyword || "（未提供）"}`,
      `市场主需求：${context.primaryNeed || "（未判断）"}`,
      `视频门槛：${Math.round((context.videoRate || 0) * 100)}%`,
      `品类：${context.category || "（未提供）"}`,
      "",
      "图片顺序：",
      ...usable.map((item, index) => {
        if (item.role === "my") return `第 ${index + 1} 张：我的主图 - ${item.title}`;
        const salesPart = item.monthlySales ? ` / 月销 ${item.monthlySales}` : "";
        const pricePart = item.priceText ? ` / ${item.priceText}` : "";
        return `第 ${index + 1} 张：竞品 - ${item.title}${pricePart}${salesPart}`;
      }),
    ].join("\n"),
  };

  // data:image/jpeg;base64,XXX → 拆成 mimeType + pure base64
  const parseDataUrl = (dataUrl) => {
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
    if (!match) return { mimeType: "image/jpeg", data: "" };
    return { mimeType: match[1], data: match[2] };
  };

  const userParts = [
    userTextPart,
    ...usable.map((item) => {
      const { mimeType, data } = parseDataUrl(item.dataUrl);
      return { inline_data: { mime_type: mimeType, data } };
    }),
  ];

  const endpoint = `${baseOrigin}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const aiResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // 代理兼容 sk- 风格 key，同时附带 Google 官方的 x-goog-api-key 以防纯 Gemini 直连
      "Authorization": `Bearer ${apiKey}`,
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: userParts }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json",
      },
    }),
  });

  // 先按 text 拿回来，手动判内容类型——有些代理/墙会返 200 + HTML
  const rawBody = await aiResponse.text().catch(() => "");
  const contentType = aiResponse.headers.get("content-type") || "";

  if (!aiResponse.ok) {
    throw new Error(`Gemini 请求失败 HTTP ${aiResponse.status} @ ${endpoint}: ${rawBody.slice(0, 300)}`);
  }

  // 返 HTML 通常是 DNS 劫持 / 代理拦截 / endpoint 错
  const looksLikeHtml = /^\s*<(!DOCTYPE|html|head|body)/i.test(rawBody) || contentType.includes("text/html");
  if (looksLikeHtml) {
    throw new Error(
      `Gemini 返回非 JSON（疑似代理/DNS 拦截）@ ${endpoint}\n` +
      `content-type=${contentType}\n` +
      `body 前 300 字：${rawBody.slice(0, 300)}`
    );
  }

  let aiJson;
  try {
    aiJson = JSON.parse(rawBody);
  } catch {
    throw new Error(
      `Gemini 响应不是合法 JSON @ ${endpoint}\n` +
      `content-type=${contentType}\n` +
      `body 前 300 字：${rawBody.slice(0, 300)}`
    );
  }
  // Gemini v1beta 响应：candidates[0].content.parts[*].text
  const candidate = aiJson?.candidates?.[0];
  const rawText = Array.isArray(candidate?.content?.parts)
    ? candidate.content.parts.map((p) => p?.text || "").join("")
    : "";
  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // 尝试从文本里提取 JSON 片段
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { /* ignore */ }
    }
  }

  return {
    success: true,
    myStrengths: Array.isArray(parsed?.myStrengths) ? parsed.myStrengths.map(String) : [],
    myWeaknesses: Array.isArray(parsed?.myWeaknesses) ? parsed.myWeaknesses.map(String) : [],
    competitorTakeaways: Array.isArray(parsed?.competitorTakeaways) ? parsed.competitorTakeaways : [],
    improvements: Array.isArray(parsed?.improvements) ? parsed.improvements : [],
    rawText: parsed ? "" : rawText,
    imageErrors: fetched.filter((item) => item.error).map((item) => ({ title: item.title, error: item.error })),
    model,
  };
});

// ============ 云启数据库 IPC ============
ipcMain.handle("competitor:fetch-yunqi-token", async () => sendCmd("fetch_yunqi_token_from_browser", {}, { timeoutMs: 5 * 60 * 1000 }));
ipcMain.handle("yunqi-db:import", async (_e, params) => sendCmd("yunqi_db_import", params || {}, { timeoutMs: 120000 }));
ipcMain.handle("yunqi-db:search", async (_e, params) => sendCmd("yunqi_db_search", params || {}));
ipcMain.handle("yunqi-db:stats", async () => sendCmd("yunqi_db_stats", {}));
ipcMain.handle("yunqi-db:top", async (_e, params) => sendCmd("yunqi_db_top", params || {}));
ipcMain.handle("yunqi-db:info", async () => sendCmd("yunqi_db_info", {}));
ipcMain.handle("yunqi-db:sync-online", async (_e, params) => sendCmd("yunqi_db_sync_online", params || {}, { timeoutMs: 300000 }));

// ============ AI 出图 IPC ============

ipcMain.handle("image-studio:get-status", async () => {
  const projectInfo = resolveAutoImageProjectDir();
  const projectPath = imageStudioStatus.projectPath || projectInfo?.projectPath || "";
  const healthy = await isImageStudioHealthy();
  return updateImageStudioStatus({
    projectPath,
    ready: healthy,
    status: healthy ? "ready" : imageStudioStatus.status,
    message: healthy ? "AI 出图服务已就绪" : imageStudioStatus.message,
  });
});

ipcMain.handle("image-studio:ensure-running", async () => {
  return ensureImageStudioService();
});

ipcMain.handle("image-studio:restart", async () => {
  stopImageStudioService();
  const status = await ensureImageStudioService();
  if (workerReady) {
    await ensureWorkerStarted({ aiImageServer: status.url });
  }
  return status;
});

ipcMain.handle("image-studio:get-config", async () => {
  return readImageStudioRuntimeConfig();
});

ipcMain.handle("image-studio:update-config", async (_event, payload) => {
  const normalizedPatch = normalizeImageStudioRuntimeConfigPatch(payload);
  if (Object.keys(normalizedPatch).length === 0) {
    return readImageStudioRuntimeConfig();
  }

  const nextConfig = updateImageStudioRuntimeConfigOverrides(normalizedPatch);
  await imageStudioJson("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalizedPatch),
  });

  const currentPayload = buildImageStudioRuntimeConfigPayload();
  lastImageStudioConfigSignature = getImageStudioRuntimeConfigSignature(currentPayload);
  lastImageStudioConfigSyncAt = Date.now();
  appendImageStudioLog("[config] runtime config updated from renderer bridge");
  return nextConfig;
});

ipcMain.handle("image-studio:open-external", async () => {
  const status = await ensureImageStudioService();
  await shell.openExternal(status.url);
  return status.url;
});

ipcMain.handle("image-studio:analyze", async (_event, payload) => {
  const requestAnalyze = () => imageStudioJson("/api/analyze", {
    method: "POST",
    body: createImageStudioFormData({
      files: payload?.files,
      fields: {
        productMode: payload?.productMode || "single",
      },
    }),
  });

  await normalizeAnalyzeModelBeforeRequest();

  try {
    return await requestAnalyze();
  } catch (error) {
    const upgraded = await ensureCompatibleAnalyzeModel();
    if (upgraded) {
      return requestAnalyze();
    }
    throw error;
  }
});

ipcMain.handle("image-studio:regenerate-analysis", async (_event, payload) => {
  const requestRegenerateAnalysis = () => imageStudioJson("/api/regenerate-analysis", {
    method: "POST",
    body: createImageStudioFormData({
      files: payload?.files,
      fields: {
        productMode: payload?.productMode || "single",
        analysis: payload?.analysis || {},
      },
    }),
  });

  await normalizeAnalyzeModelBeforeRequest();

  try {
    return await requestRegenerateAnalysis();
  } catch (error) {
    const upgraded = await ensureCompatibleAnalyzeModel();
    if (upgraded) {
      return requestRegenerateAnalysis();
    }
    throw error;
  }
});

ipcMain.handle("image-studio:translate", async (_event, payload) => {
  const texts = Array.isArray(payload?.texts)
    ? payload.texts.map((item) => (typeof item === "string" ? item : String(item || "")))
    : [];

  if (texts.length === 0) {
    return { translations: [] };
  }

  await normalizeAnalyzeModelBeforeRequest();

  try {
    const result = await imageStudioJson("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    });
    return {
      translations: normalizeImageStudioTranslationList(result, texts),
    };
  } catch (error) {
    const upgraded = await ensureCompatibleAnalyzeModel();
    if (!upgraded) {
      throw error;
    }
    const result = await imageStudioJson("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    });
    return {
      translations: normalizeImageStudioTranslationList(result, texts),
    };
  }
});

ipcMain.handle("image-studio:generate-plans", async (_event, payload) => {
  const plans = await imageStudioJson("/api/plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      analysis: payload?.analysis || {},
      imageTypes: Array.isArray(payload?.imageTypes) ? payload.imageTypes : [],
      salesRegion: payload?.salesRegion || "us",
      imageSize: payload?.imageSize || "1000x1000",
      productMode: payload?.productMode || "single",
    }),
  });
  return normalizeImageStudioPlanList(plans);
});

ipcMain.handle("image-studio:start-generate", async (event, payload) => {
  const jobId = typeof payload?.jobId === "string" && payload.jobId
    ? payload.jobId
    : `image_job_${Date.now()}`;

  // 注册 job 到全局追踪 Map
  const planCount = Array.isArray(payload?.plans) ? payload.plans.length : 0;
  const imageTypes = Array.isArray(payload?.plans) ? payload.plans.map(p => p.imageType || "").filter(Boolean) : [];
  imageStudioJobs.set(jobId, {
    jobId,
    status: "pending",
    productName: payload?.productName || "",
    salesRegion: payload?.salesRegion || "us",
    runInBackground: Boolean(payload?.runInBackground),
    imageTypes,
    results: [],
    progress: { done: 0, total: planCount, step: "等待开始" },
    createdAt: Date.now(),
    finishedAt: null,
    error: null,
    historySaved: false,
    historyId: null,
    historySaveError: null,
  });

  streamImageStudioGenerate(event, jobId, payload).catch((error) => {
    updateImageStudioJob(jobId, { status: "failed", error: error?.message || "AI 出图失败", finishedAt: Date.now() });
    emitImageStudioEvent(event, {
      jobId,
      type: "generate:error",
      error: error?.message || "AI 出图失败",
    });
  });

  return { jobId };
});

ipcMain.handle("image-studio:cancel-generate", async (_event, jobId) => {
  const controller = imageStudioGenerateControllers.get(jobId);
  if (controller) {
    controller.abort();
  }
  return { cancelled: Boolean(controller), jobId };
});

ipcMain.handle("image-studio:list-jobs", async () => {
  return getImageStudioJobList();
});

ipcMain.handle("image-studio:get-job", async (_event, jobId) => {
  return imageStudioJobs.get(jobId) || null;
});

ipcMain.handle("image-studio:clear-job", async (_event, jobId) => {
  const job = imageStudioJobs.get(jobId);
  if (job && job.status !== "running") {
    imageStudioJobs.delete(jobId);
  }
});

ipcMain.handle("image-studio:list-history", async () => {
  const payload = await imageStudioJson("/api/history");
  return normalizeImageStudioHistoryList(payload);
});

ipcMain.handle("image-studio:get-history-item", async (_event, id) => {
  if (!id) return null;
  return imageStudioJson(`/api/history?id=${encodeURIComponent(id)}`);
});

ipcMain.handle("image-studio:get-history-sources", async (_event, id) => {
  if (!id || !/^[\w.-]+$/.test(String(id))) return { files: [] };
  try {
    const dir = path.join(app.getPath("userData"), "image-studio-sources", String(id));
    if (!fs.existsSync(dir)) return { files: [] };
    const metaPath = path.join(dir, "meta.json");
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(metaPath, "utf8")); } catch {}
    const entries = fs.readdirSync(dir).filter((n) => n !== "meta.json").sort();
    const files = entries.map((name, i) => {
      const full = path.join(dir, name);
      try {
        const buf = fs.readFileSync(full);
        const m = meta?.files?.[i];
        const lower = name.toLowerCase();
        const type = m?.type || (lower.endsWith(".png") ? "image/png" : lower.endsWith(".webp") ? "image/webp" : "image/jpeg");
        return { name: m?.name || name.replace(/^\d+-/, ""), type, dataUrl: `data:${type};base64,${buf.toString("base64")}` };
      } catch { return null; }
    }).filter(Boolean);
    return { files };
  } catch (e) {
    return { files: [], error: e?.message || String(e) };
  }
});

ipcMain.handle("image-studio:save-history", async (_event, payload) => {
  return saveImageStudioHistorySnapshot(payload);
});

ipcMain.handle("image-studio:score-image", async (_event, payload) => {
  return imageStudioJson("/api/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageUrl: payload?.imageUrl || "",
      imageType: payload?.imageType || "main",
    }),
  });
});

ipcMain.handle("image-studio:download-all", async (_event, payload) => {
  const images = Array.isArray(payload?.images) ? payload.images : [];
  if (images.length === 0) throw new Error("没有可下载的图片");

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择保存文件夹",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths.length) return { cancelled: true };

  const dir = result.filePaths[0];
  const productName = (payload?.productName || "temu-image").replace(/[<>:"/\\|?*]/g, "_").slice(0, 60);
  const saveDir = path.join(dir, productName);
  fs.mkdirSync(saveDir, { recursive: true });

  let saved = 0;
  for (const img of images) {
    try {
      const resp = await fetch(img.imageUrl);
      if (!resp.ok) continue;
      const buffer = Buffer.from(await resp.arrayBuffer());
      const ext = (resp.headers.get("content-type") || "").includes("png") ? "png" : "jpg";
      const IMAGE_TYPE_LABELS_CN = { main: "主图", features: "卖点图", closeup: "细节图", dimensions: "尺寸图", lifestyle: "场景图", packaging: "包装图", comparison: "对比图", lifestyle2: "A+收束图", scene_a: "核价场景图A", scene_b: "核价场景图B" };
      const typeName = (IMAGE_TYPE_LABELS_CN[img.imageType] || img.imageType || `图片_${saved + 1}`).replace(/[<>:"/\\|?*]/g, "_");
      fs.writeFileSync(path.join(saveDir, `${typeName}.${ext}`), buffer);
      saved++;
    } catch (e) {
      console.error(`[download-all] Failed to save ${img.imageType}:`, e.message);
    }
  }

  return { saved, total: images.length, dir: saveDir };
});

ipcMain.handle("app:get-version", () => app.getVersion());

ipcMain.handle("app:get-update-status", () => updateState);

ipcMain.handle("app:check-for-updates", async () => {
  try {
    await autoUpdater.checkForUpdates();
    return updateState;
  } catch (e) {
    broadcastUpdateState({ status: "error", message: e?.message || "检查更新失败" });
    return updateState;
  }
});

ipcMain.handle("app:download-update", async () => {
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    broadcastUpdateState({ status: "error", message: error?.message || "下载更新失败", progressPercent: null });
  }
  return updateState;
});

ipcMain.handle("app:quit-and-install-update", () => {
  autoUpdater.quitAndInstall(false, true);
  return true;
});

ipcMain.handle("app:open-log-directory", async () => {
  const logDir = app.getPath("userData");
  await shell.openPath(logDir);
  return logDir;
});

// ============ 文件存储 IPC ============

function getStoreFilePath(key) {
  const normalizedKey = normalizeStoreKey(key);
  const baseDir = app.getPath("userData");
  const safeFileName = encodeURIComponent(normalizedKey);
  return ensurePathInside(baseDir, path.join(baseDir, `${safeFileName}.json`), "Store 文件路径");
}

function hasMeaningfulStoreData(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);

  const objectValue = value;
  const preferredArrayKeys = ["items", "list", "rows", "apis", "pageItems", "subOrderList"];
  for (const key of preferredArrayKeys) {
    if (Array.isArray(objectValue[key]) && objectValue[key].length > 0) {
      return true;
    }
  }

  return Object.values(objectValue).some((item) => hasMeaningfulStoreData(item, seen));
}

function getLegacyScopedStoreCandidates(baseKey, excludeAccountId = null) {
  const baseDir = app.getPath("userData");
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || !entry.name.startsWith("temu_store%3A")) {
      continue;
    }
    const encodedName = entry.name.slice(0, -5);
    let decodedKey = "";
    try {
      decodedKey = decodeURIComponent(encodedName);
    } catch {
      continue;
    }
    const match = decodedKey.match(/^temu_store:([^:]+):(.+)$/);
    if (!match) continue;
    const [, accountId, candidateBaseKey] = match;
    if (candidateBaseKey !== baseKey) continue;
    if (excludeAccountId && accountId === excludeAccountId) continue;
    candidates.push({
      accountId,
      filePath: path.join(baseDir, entry.name),
    });
  }

  candidates.sort((a, b) => {
    try {
      const aTime = fs.statSync(a.filePath).mtimeMs;
      const bTime = fs.statSync(b.filePath).mtimeMs;
      return bTime - aTime;
    } catch {
      return 0;
    }
  });
  return candidates;
}

async function recoverScopedStoreValueIfNeeded(baseKey, currentValue) {
  if (hasMeaningfulStoreData(currentValue)) return currentValue;

  let accounts = [];
  try {
    accounts = readStoreJsonWithRecovery(getStoreFilePath(ACCOUNT_STORE_KEY), ACCOUNT_STORE_KEY) || [];
  } catch {}
  if (!Array.isArray(accounts) || accounts.length !== 1) {
    return currentValue;
  }

  let activeAccountId = null;
  try {
    activeAccountId = readStoreJsonWithRecovery(getStoreFilePath("temu_active_account_id"), "temu_active_account_id");
  } catch {}
  if (!activeAccountId || typeof activeAccountId !== "string") {
    return currentValue;
  }

  const candidates = getLegacyScopedStoreCandidates(baseKey, activeAccountId);
  for (const candidate of candidates) {
    const recoveredValue = await readStoreJsonWithRecoveryAsync(candidate.filePath, `temu_store:${candidate.accountId}:${baseKey}`);
    if (!hasMeaningfulStoreData(recoveredValue)) continue;

    try {
      await writeStoreJsonAtomicAsync(getStoreFilePath(baseKey), recoveredValue, { key: baseKey });
      await writeStoreJsonAtomicAsync(
        getStoreFilePath(`temu_store:${activeAccountId}:${baseKey}`),
        recoveredValue,
        { key: `temu_store:${activeAccountId}:${baseKey}` },
      );
      console.error(`[Store] Recovered ${baseKey} from legacy scoped account ${candidate.accountId} -> ${activeAccountId}`);
    } catch (error) {
      console.error(`[Store] Failed to persist recovered ${baseKey}:`, error?.message || error);
    }
    return recoveredValue;
  }

  return currentValue;
}

function getStoreBackupPath(filePath) {
  return `${filePath}.bak`;
}

function getStoreReplacePath(filePath) {
  return `${filePath}.replace-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function replaceStoreFileSync(tempPath, filePath, { backupPath, skipBackup = false } = {}) {
  if (!fs.existsSync(filePath)) {
    fs.renameSync(tempPath, filePath);
    return;
  }

  if (!skipBackup && backupPath) {
    try {
      fs.copyFileSync(filePath, backupPath);
    } catch (error) {
      console.error("[Store] Failed to create backup:", error.message);
    }
  }

  const replacePath = getStoreReplacePath(filePath);
  fs.renameSync(filePath, replacePath);
  try {
    fs.renameSync(tempPath, filePath);
    fs.rmSync(replacePath, { force: true });
  } catch (error) {
    try {
      if (!fs.existsSync(filePath) && fs.existsSync(replacePath)) {
        fs.renameSync(replacePath, filePath);
      }
    } catch {}
    throw error;
  }
}

const fsPromises = require("fs").promises;

async function replaceStoreFileAsync(tempPath, filePath, { backupPath, skipBackup = false } = {}) {
  let fileExists = false;
  try { await fsPromises.access(filePath); fileExists = true; } catch {}

  if (!fileExists) {
    await fsPromises.rename(tempPath, filePath);
    return;
  }

  if (!skipBackup && backupPath) {
    try {
      await fsPromises.copyFile(filePath, backupPath);
    } catch (error) {
      console.error("[Store] Failed to create backup:", error.message);
    }
  }

  const replacePath = getStoreReplacePath(filePath);
  await fsPromises.rename(filePath, replacePath);
  try {
    await fsPromises.rename(tempPath, filePath);
    await fsPromises.rm(replacePath, { force: true });
  } catch (error) {
    try {
      await fsPromises.access(filePath);
    } catch {
      try {
        await fsPromises.rename(replacePath, filePath);
      } catch {}
    }
    throw error;
  }
}

// ---- 同步版本（供 readAutoPricingState / writeAutoPricingState 等同步函数使用）----

function readStoreJsonSync(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(content);
}

function writeStoreJsonAtomic(filePath, data, options = {}) {
  const { skipBackup = false, key } = options;
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const backupPath = getStoreBackupPath(filePath);
  const serialized = JSON.stringify(serializeStoreValue(key, data), null, 2);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  try {
    fs.writeFileSync(tempPath, serialized);
    replaceStoreFileSync(tempPath, filePath, { backupPath, skipBackup });
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch {}
    throw error;
  }
}

function readStoreJsonWithRecovery(filePath, key) {
  const backupPath = getStoreBackupPath(filePath);

  if (fs.existsSync(filePath)) {
    try {
      return deserializeStoreValue(key, readStoreJsonSync(filePath), filePath);
    } catch (error) {
      console.error(`[Store] Failed to read ${path.basename(filePath)}:`, error.message);
    }
  }

  if (!fs.existsSync(backupPath)) return null;

  try {
    const restored = readStoreJsonSync(backupPath);
    writeStoreJsonAtomic(filePath, restored, { skipBackup: true, key });
    console.error(`[Store] Restored ${path.basename(filePath)} from backup`);
    return deserializeStoreValue(key, restored, filePath);
  } catch (error) {
    console.error(`[Store] Failed to recover ${path.basename(filePath)} from backup:`, error.message);
    return null;
  }
}

// ---- 异步版本（供 IPC handler 使用）----

async function readStoreJsonAsync(filePath) {
  const content = await fsPromises.readFile(filePath, "utf-8");
  return JSON.parse(content);
}

async function writeStoreJsonAtomicAsync(filePath, data, options = {}) {
  const { skipBackup = false, key } = options;
  const serialized = JSON.stringify(serializeStoreValue(key, data), null, 2);
  const backupPath = getStoreBackupPath(filePath);

  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });

  // 重试最多 3 次（Windows 文件锁冲突 EBUSY/EPERM）
  for (let attempt = 0; attempt < 3; attempt++) {
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    try {
      await fsPromises.writeFile(tempPath, serialized);
      await replaceStoreFileAsync(tempPath, filePath, { backupPath, skipBackup });
      return;
    } catch (error) {
      try { await fsPromises.rm(tempPath, { force: true }); } catch {}
      if (attempt < 2) {
        console.error(`[Store] Write attempt ${attempt + 1} failed for ${path.basename(filePath)}: ${error.message}, retrying...`);
        await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
      } else {
        throw error;
      }
    }
  }
}

async function readStoreJsonWithRecoveryAsync(filePath, key) {
  const backupPath = getStoreBackupPath(filePath);

  let fileExists = false;
  try { await fsPromises.access(filePath); fileExists = true; } catch {}

  if (fileExists) {
    try {
      return deserializeStoreValue(key, await readStoreJsonAsync(filePath), filePath);
    } catch (error) {
      console.error(`[Store] Failed to read ${path.basename(filePath)}:`, error.message);
    }
  }

  let backupExists = false;
  try { await fsPromises.access(backupPath); backupExists = true; } catch {}

  if (!backupExists) {
    return null;
  }

  try {
    const restored = await readStoreJsonAsync(backupPath);
    await writeStoreJsonAtomicAsync(filePath, restored, { skipBackup: true, key });
    console.error(`[Store] Restored ${path.basename(filePath)} from backup`);
    return deserializeStoreValue(key, restored, filePath);
  } catch (error) {
    console.error(`[Store] Failed to recover ${path.basename(filePath)} from backup:`, error.message);
    return null;
  }
}

ipcMain.handle("store:get", async (_, key) => {
  const normalizedKey = normalizeStoreKey(key);
  const value = await readStoreJsonWithRecoveryAsync(getStoreFilePath(normalizedKey), normalizedKey);
  return recoverScopedStoreValueIfNeeded(normalizedKey, value);
});

ipcMain.handle("store:get-many", async (_, keys) => {
  const list = Array.isArray(keys) ? keys : [];
  const entries = await Promise.all(
    list.map(async (key) => {
      const normalizedKey = normalizeStoreKey(key);
      const value = await readStoreJsonWithRecoveryAsync(getStoreFilePath(normalizedKey), normalizedKey);
      return [key, await recoverScopedStoreValueIfNeeded(normalizedKey, value)];
    }),
  );
  return Object.fromEntries(entries);
});

const _storeWriteLocks = new Map();
async function persistStoreValue(normalizedKey, data) {
  // 串行化同 key 写入，避免并发文件冲突
  const prev = _storeWriteLocks.get(normalizedKey) || Promise.resolve();
  let resolveLock;
  const current = new Promise((resolve) => { resolveLock = resolve; });
  _storeWriteLocks.set(normalizedKey, current);
  await prev.catch(() => {});
  try {
    const filePath = getStoreFilePath(normalizedKey);
    await writeStoreJsonAtomicAsync(filePath, data, { key: normalizedKey });
    if (ACCOUNT_SCOPED_STORE_KEYS.has(normalizedKey)) {
      const activeAccountId = await readStoreJsonWithRecoveryAsync(
        getStoreFilePath(ACTIVE_ACCOUNT_ID_KEY),
        ACTIVE_ACCOUNT_ID_KEY,
      );
      if (typeof activeAccountId === "string" && activeAccountId.trim()) {
        const scopedKey = buildScopedStoreKey(activeAccountId, normalizedKey);
        await writeStoreJsonAtomicAsync(getStoreFilePath(scopedKey), data, { key: scopedKey });
      }
    }
    return true;
  } catch (err) {
    console.error(`[Store] Write failed for key="${normalizedKey}":`, err?.code, err?.message);
    const detail = err?.message || "未知错误";
    const code = err?.code ? `${err.code}: ` : "";
    throw new Error(`Store 写入失败（${normalizedKey}）：${code}${detail}`);
  } finally {
    resolveLock();
    if (_storeWriteLocks.get(normalizedKey) === current) {
      _storeWriteLocks.delete(normalizedKey);
    }
  }
}

function tryAcquireLoopbackPort(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(0));
    probe.listen({ host: "127.0.0.1", port }, () => {
      const address = probe.address();
      const nextPort = address && typeof address === "object" ? Number(address.port) : 0;
      probe.close(() => resolve(nextPort > 0 ? nextPort : 0));
    });
  });
}

async function findAvailableWorkerPort(preferredPort = DEFAULT_WORKER_PORT) {
  const preferred = await tryAcquireLoopbackPort(preferredPort);
  if (preferred > 0) return preferred;

  const fallback = await tryAcquireLoopbackPort(0);
  if (fallback > 0) return fallback;

  throw new Error("无法分配可用的 Worker 端口");
}

ipcMain.handle("store:set", async (_, key, data) => {
  const normalizedKey = normalizeStoreKey(key);
  return persistStoreValue(normalizedKey, data);
});

ipcMain.handle("store:set-many", async (_, entries) => {
  const nextEntries = entries && typeof entries === "object" ? Object.entries(entries) : [];
  for (const [key, value] of nextEntries) {
    const normalizedKey = normalizeStoreKey(key);
    await persistStoreValue(normalizedKey, value);
  }
  return true;
});
