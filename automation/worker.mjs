/**
 * 自动化 Worker - 通过 HTTP 服务通信，避免 stdio pipe 继承问题
 */
import { chromium } from "playwright";
import https from "https";
import fs from "fs";
import path from "path";
import os from "os";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { randomDelay, downloadImage, saveBase64Image, getDebugDir, getTmpDir, logSilent, ERR } from "./utils.mjs";
import { browserState, ensureBrowser as _ensureBrowser, launch as _launch, login, saveCookies, closeBrowser, findLatestCookie, safeNewPage } from "./browser.mjs";
import { ADS_GROUP_TABS, GOVERN_GROUP_TARGETS, buildScrapeHandlers, getScrapeFunction } from "./scrape-registry.mjs";
import { getConfiguredMaxRetries, getDelayScale, shouldAutoLoginRetry, shouldCaptureErrorScreenshots } from "./runtime-config.mjs";
import { buildYunqiOnlineHandlers } from "./yunqi-online.mjs";
import { loadFirstEnvFile } from "./env-loader.mjs";
import { createAiRuntime } from "./ai-runtime.mjs";
import { parseLocalUrl, readJsonBody, sendJson, sendNoContent } from "./http-json.mjs";
import { createWorkerAuthToken, createWorkerAuthenticator, createWorkerServer, resolveWorkerPort, startWorkerServer } from "./worker-server.mjs";
import { optimizeTitle as _optimizeTitle } from "./title-optimizer.mjs";
import { scrapeCompetitorReviews as _scrapeCompetitorReviews, openTemuLoginPage as _openTemuLoginPage, openTemuSearchPage as _openTemuSearchPage, extractReviewsFromFeed as _extractReviewsFromFeed, dumpFeedForGoods as _dumpFeedForGoods, extractProductFromFeed as _extractProductFromFeed, extractSearchResultsFromFeed as _extractSearchResultsFromFeed } from "./competitor-reviews.mjs";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const FormDataLib = require("form-data");

const workerFilePath = fileURLToPath(import.meta.url);
const workerDirPath = path.dirname(workerFilePath);
const projectRootDir = path.resolve(workerDirPath, "..");
const roamingDataDir = process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming";
const workerRuntimeDataDir = process.env.APP_USER_DATA || path.join(roamingDataDir, "temu-automation");

// Load API keys from local env files first, then legacy temu-claw .env
const envFiles = [
  path.join(projectRootDir, ".env.local"),
  path.join(projectRootDir, ".env"),
  path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", ".env.local"),
  path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", ".env"),
  path.join(process.env.APPDATA || "", "..", "temu-claw", ".env"),
  "C:/Users/Administrator/temu-claw/.env",
];
loadFirstEnvFile(envFiles, { onError: (error) => logSilent("env.load", error) });

// AI API 配置（从环境变量读取，不再硬编码）
const {
  AI_API_KEY,
  AI_BASE_URL,
  AI_MODEL,
  COMPARE_MODEL_CHAIN,
  ATTRIBUTE_AI_API_KEY,
  ATTRIBUTE_AI_MODEL,
  getAiGeminiClient,
  getAiClientForModel,
  getAttributeClientForModel,
} = createAiRuntime();
const WORKER_AUTH_TOKEN = createWorkerAuthToken();
const isAuthorizedWorkerRequest = createWorkerAuthenticator(WORKER_AUTH_TOKEN);
const CATEGORY_HISTORY_FILE = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "temu_category_history.json");
const AUTO_PRICING_TASKS_FILE = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "temu_auto_pricing_tasks.json");
const CATEGORY_HISTORY_LIMIT = 300;
const CATEGORY_HISTORY_SEED_LIMIT = 200;
const CATEGORY_HISTORY_PRODUCT_SEED_LIMIT = 3000;
const CATEGORY_LOOKUP_PHRASE_ALIASES = [
  [/商用[、，,\/｜|]*工业与科技/g, "工业和科学"],
  [/商用与工业科技/g, "工业和科学"],
  [/商用工业与科技/g, "工业和科学"],
  [/家居清洁用品/g, "家庭清洁用品"],
  [/居家清洁用品/g, "家庭清洁用品"],
  [/家居洗衣清洁用品/g, "家庭清洁用品"],
  [/家居洗涤防染色片/g, "家庭清洁用品"],
  [/食品供应设备/g, "食品服务设备和用品"],
  [/食物供应设备和用品/g, "食品服务设备和用品"],
  [/电子元件/g, "工业电气"],
];
const CATEGORY_LOOKUP_SEGMENT_ALIASES = new Map([
  ["商用工业与科技", "工业和科学"],
  ["工业与科技", "工业和科学"],
  ["工业科技", "工业和科学"],
  ["家居清洁用品", "家庭清洁用品"],
  ["居家清洁用品", "家庭清洁用品"],
  ["家居洗衣清洁用品", "家庭清洁用品"],
  ["家居洗涤防染色片", "家庭清洁用品"],
  ["食品供应设备", "食品服务设备和用品"],
  ["食物供应设备和用品", "食品服务设备和用品"],
  ["电子元件", "工业电气"],
]);
const CATEGORY_KNOWN_BRANCH_FALLBACKS = {
  foodService: { cat1Id: 4673, cat1Name: "工业和科学", cat2Id: 9066, cat2Name: "食品服务设备和用品" },
  industrialElectric: { cat1Id: 4673, cat1Name: "工业和科学", cat2Id: 5652, cat2Name: "工业电气" },
  safety: { cat1Id: 4673, cat1Name: "工业和科学", cat2Id: 6665, cat2Name: "安防劳保" },
  safetyEmergency: { cat1Id: 4673, cat1Name: "工业和科学", cat2Id: 6665, cat2Name: "安防劳保", cat3Id: 6666, cat3Name: "应急器具" },
  medical: { cat1Id: 4673, cat1Name: "工业和科学", cat2Id: 7725, cat2Name: "专业医疗用品" },
  medicalTherapy: { cat1Id: 4673, cat1Name: "工业和科学", cat2Id: 7725, cat2Name: "专业医疗用品", cat3Id: 7743, cat3Name: "职业治疗和物理治疗辅助" },
  householdLaundrySheet: {
    cat1Id: 9711,
    cat1Name: "家居、厨房用品",
    cat2Id: 12870,
    cat2Name: "家庭清洁用品",
    cat3Id: 12871,
    cat3Name: "家庭清洁",
    cat4Id: 12906,
    cat4Name: "清洁布",
  },
  householdCleaningToolsOther: {
    cat1Id: 9711,
    cat1Name: "家居、厨房用品",
    cat2Id: 12870,
    cat2Name: "家庭清洁用品",
    cat3Id: 12871,
    cat3Name: "家庭清洁",
    cat4Id: 12873,
    cat4Name: "清洁工具",
    cat5Id: 12874,
    cat5Name: "其他（清洁工具）",
  },
};
let requestCredentialPhone = "";
let requestCredentialPassword = "";
let stickyCredentialAccountId = "";
let stickyCredentialPhone = "";
let stickyCredentialPassword = "";
const recentChildSpecValues = [];
let categoryHistoryCache = null;
let categoryHistorySeeded = false;
const yunqiHandlers = buildYunqiOnlineHandlers({
  ensureBrowser: async () => {
    await _ensureBrowser();
    syncBrowserState();
  },
  getContext: () => context,
  randomDelay,
  logSilent,
});

function getCategoryHistoryFilePath() {
  fs.mkdirSync(path.dirname(CATEGORY_HISTORY_FILE), { recursive: true });
  return CATEGORY_HISTORY_FILE;
}

function applyCategoryLookupPhraseAliases(value = "") {
  let normalized = String(value || "").normalize("NFKC").toLowerCase();
  for (const [pattern, replacement] of CATEGORY_LOOKUP_PHRASE_ALIASES) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

function normalizeCategoryLookupSegment(value = "") {
  let normalized = applyCategoryLookupPhraseAliases(value)
    .replace(/\s+/g, "")
    .replace(/[、，,；;]+/g, "");
  normalized = CATEGORY_LOOKUP_SEGMENT_ALIASES.get(normalized) || normalized;
  return normalized.trim();
}

function normalizeCategoryLookupText(value = "") {
  const normalized = applyCategoryLookupPhraseAliases(value)
    .replace(/[>＞｜|]+/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");
  if (!normalized) return "";
  return normalized
    .split("/")
    .map((segment) => normalizeCategoryLookupSegment(segment))
    .filter(Boolean)
    .join("/");
}

function pickKnownCategoryBranchFallback(searchTerm = "", title = "") {
  const normalized = normalizeCategoryLookupText(searchTerm);
  const titleText = String(title || "");
  const isLaundryColorSheet = /(洗衣|吸色|护色|串色|防串色|防染色|染料转移)/.test(titleText);
  const isSheetLikeCleaning = /(片|纸|布|纤维|无纺布)/.test(titleText);
  if (isLaundryColorSheet && isSheetLikeCleaning) {
    return { ...CATEGORY_KNOWN_BRANCH_FALLBACKS.householdLaundrySheet };
  }
  if (isLaundryColorSheet && /(刷|海绵|擦|拖把|扫把|清洁工具)/.test(titleText)) {
    return { ...CATEGORY_KNOWN_BRANCH_FALLBACKS.householdCleaningToolsOther };
  }
  if (!normalized) return null;

  if ((normalized.includes("工业电气") || normalized.includes("电子元件")) && /(灭火|消防|应急|火灾|逃生|防火)/.test(titleText)) {
    return { ...CATEGORY_KNOWN_BRANCH_FALLBACKS.safetyEmergency };
  }
  if (normalized.includes("专业医疗用品") && /(姿势|矫正|支撑|牵引|颈椎|护腰|护背|靠背|护具|护理垫|记忆棉|康复|训练)/.test(titleText)) {
    return { ...CATEGORY_KNOWN_BRANCH_FALLBACKS.medicalTherapy };
  }
  if ((normalized.includes("家庭清洁用品") || normalized.includes("家庭清洁") || normalized.includes("家居清洁")) && isLaundryColorSheet) {
    return isSheetLikeCleaning
      ? { ...CATEGORY_KNOWN_BRANCH_FALLBACKS.householdLaundrySheet }
      : { ...CATEGORY_KNOWN_BRANCH_FALLBACKS.householdCleaningToolsOther };
  }
  if (normalized.includes("食品服务设备和用品")) return { ...CATEGORY_KNOWN_BRANCH_FALLBACKS.foodService };
  if (normalized.includes("工业电气")) return { ...CATEGORY_KNOWN_BRANCH_FALLBACKS.industrialElectric };
  if (normalized.includes("专业医疗用品")) return { ...CATEGORY_KNOWN_BRANCH_FALLBACKS.medical };
  if (normalized.includes("安防劳保")) return { ...CATEGORY_KNOWN_BRANCH_FALLBACKS.safety };
  return null;
}

function getCategoryIntentHints(title = "") {
  const titleText = String(title || "");
  const isLaundryColorSheet = /(洗衣|吸色|护色|串色|防串色|防染色|染料转移)/.test(titleText);
  const isSheetLikeCleaning = /(片|纸|布|纤维|无纺布)/.test(titleText);
  return {
    isLaundryColorSheet,
    isSheetLikeCleaning,
  };
}

function shouldPreferKnownCategoryBranch(searchTerms = [], title = "") {
  const terms = Array.isArray(searchTerms) ? searchTerms : [searchTerms];
  for (const term of terms) {
    const normalized = normalizeCategoryLookupText(term);
    if (!normalized) continue;
    const seed = pickKnownCategoryBranchFallback(term, title);
    if (!seed) continue;
    const requestedDepth = normalized.split("/").filter(Boolean).length;
    const seedDepth = getCategoryDepth(seed);
    if (requestedDepth <= 2 || seedDepth >= 3) return true;
  }
  return false;
}

function isCategoryCandidateCompatible(candidate = {}, requestedTexts = []) {
  const requestedPaths = (Array.isArray(requestedTexts) ? requestedTexts : [requestedTexts])
    .map((value) => normalizeCategoryLookupText(value))
    .filter((value) => value.includes("/"));
  if (requestedPaths.length === 0) return true;

  const candidatePath = normalizeCategoryLookupText(
    candidate?.path
    || candidate?.categorySearch
    || candidate?.catIds?._path
    || getCategoryPathText(candidate?.catIds || candidate)
  );
  if (!candidatePath) return false;

  return requestedPaths.some((requestedPath) => {
    const pathParts = requestedPath.split("/").filter(Boolean);
    const overlap = countCategoryPathOverlap(candidatePath, requestedPath);
    const requiredOverlap = Math.min(2, pathParts.length);
    if (overlap >= requiredOverlap) return true;
    const leafSegment = pathParts[pathParts.length - 1] || "";
    return candidatePath.split("/").some((part) => part === leafSegment || part.includes(leafSegment) || leafSegment.includes(part));
  });
}

function countCategoryPathOverlap(left = "", right = "") {
  const leftParts = normalizeCategoryLookupText(left).split("/").filter(Boolean);
  const rightParts = normalizeCategoryLookupText(right).split("/").filter(Boolean);
  if (leftParts.length === 0 || rightParts.length === 0) return 0;
  let overlap = 0;
  for (const leftPart of leftParts) {
    if (rightParts.some((rightPart) => rightPart === leftPart || rightPart.includes(leftPart) || leftPart.includes(rightPart))) {
      overlap += 1;
    }
  }
  return overlap;
}

function extractCategoryIdsSnapshot(source = {}) {
  if (!source || typeof source !== "object") return null;
  const snapshot = {};
  for (let i = 1; i <= 10; i += 1) {
    const id = Number(source[`cat${i}Id`] || source[`cat${i}`]?.catId || 0) || 0;
    const name = String(source[`cat${i}Name`] || source[`cat${i}`]?.catName || "").trim();
    if (id > 0) snapshot[`cat${i}Id`] = id;
    if (name) snapshot[`cat${i}Name`] = name;
  }
  const pathText = String(source._path || source.path || source.catPath || "").trim();
  if (pathText) snapshot._path = pathText;
  return Object.keys(snapshot).length > 0 ? snapshot : null;
}

function extractLeafCatIdFromCategoryIds(catIds = {}, fallback = 0) {
  for (let i = 10; i >= 1; i -= 1) {
    const value = Number(catIds?.[`cat${i}Id`] || 0) || 0;
    if (value > 0) return value;
  }
  return Number(fallback) || 0;
}

function parseCategoryIdsCell(value) {
  if (!value) return null;
  if (typeof value === "object") return extractCategoryIdsSnapshot(value);
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return extractCategoryIdsSnapshot(parsed);
  } catch {
    return null;
  }
}

function normalizeHistoryIdentifier(value = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\.0+$/, "");
}

function collectCategoryHistoryIdentifiers(source = {}) {
  const seen = new Set();
  const result = [];
  const remember = (kind, value) => {
    const normalized = normalizeHistoryIdentifier(value);
    if (!normalized) return;
    const key = `${kind}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ kind, value: normalized });
  };

  remember("sourceProductId", source.sourceProductId);
  remember("goodsId", source.goodsId || source.itemId);
  remember("productId", source.productId || source.spuId);
  remember("productSkcId", source.productSkcId || source.skcId);
  return result;
}

function hasExactCategoryHistoryIdentifierMatch(entry, request = {}) {
  const requestIds = collectCategoryHistoryIdentifiers(request);
  if (requestIds.length === 0) return false;
  const entryIds = collectCategoryHistoryIdentifiers(entry);
  if (entryIds.length === 0) return false;
  return requestIds.some((left) => entryIds.some((right) => left.value === right.value));
}

function normalizeCategoryHistoryEntry(source = {}, meta = {}) {
  const catIds = (
    extractCategoryIdsSnapshot(meta.catIds)
    || extractCategoryIdsSnapshot(source.catIds)
    || extractCategoryIdsSnapshot(source.payload)
    || extractCategoryIdsSnapshot(source)
    || {}
  );
  const leafCatId = extractLeafCatIdFromCategoryIds(catIds,
    meta.leafCatId
    || source.leafCatId
    || source.leafCategoryId
    || source.catId
    || source.categoryId
    || source.payload?.leafCatId
    || source.payload?.leafCategoryId
    || source.payload?.catId
    || source.payload?.categoryId
  );
  if (!leafCatId) return null;

  const pathText = String(
    meta.path
    || source.path
    || source._path
    || source.catPath
    || source.payload?._path
    || ""
  ).trim();
  if (pathText && !catIds._path) catIds._path = pathText;

  const title = String(
    meta.title
    || source.title
    || source.productName
    || source.payload?.productName
    || source.params?.title
    || ""
  ).trim();
  const categorySearch = String(
    meta.categorySearch
    || source.categorySearch
    || source.params?.categorySearch
    || pathText
    || ""
  ).trim();
  const sourceProductId = normalizeHistoryIdentifier(
    meta.sourceProductId
    || source.sourceProductId
    || source.payload?.sourceProductId
    || source.params?.sourceProductId
    || source.goodsId
    || source.payload?.goodsId
    || source.params?.goodsId
    || source.productId
    || source.payload?.productId
    || source.params?.productId
  );
  const goodsId = normalizeHistoryIdentifier(
    meta.goodsId
    || source.goodsId
    || source.itemId
    || source.payload?.goodsId
    || source.payload?.itemId
    || source.params?.goodsId
  );
  const productId = normalizeHistoryIdentifier(
    meta.productId
    || source.productId
    || source.spuId
    || source.payload?.productId
    || source.payload?.spuId
    || source.params?.productId
  );
  const productSkcId = normalizeHistoryIdentifier(
    meta.productSkcId
    || source.productSkcId
    || source.skcId
    || source.payload?.productSkcId
    || source.payload?.skcId
    || source.params?.productSkcId
    || source.params?.skcId
  );

  return {
    leafCatId,
    catIds,
    path: pathText || String(catIds._path || "").trim(),
    title,
    categorySearch,
    sourceProductId,
    goodsId,
    productId,
    productSkcId,
    updatedAt: String(meta.updatedAt || source.updatedAt || source.createdAt || new Date().toISOString()),
    source: String(meta.source || source.source || "").trim(),
  };
}

function getCategoryHistoryIdentity(entry) {
  const exactIdentifiers = collectCategoryHistoryIdentifiers(entry);
  if (exactIdentifiers.length > 0) {
    const preferredIdentifier = exactIdentifiers[0];
    return `id|${preferredIdentifier.kind}|${preferredIdentifier.value}`;
  }
  const categoryKey = normalizeCategoryLookupText(entry.categorySearch || entry.path || entry.catIds?._path || "");
  const titleKey = normalizeCategoryLookupText(entry.title || "").replace(/\//g, "").slice(0, 48);
  return `${entry.leafCatId}|${categoryKey}|${titleKey}`;
}

function mergeCategoryHistoryEntries(current, incoming) {
  const mergedCatIds = {
    ...(current?.catIds || {}),
    ...(incoming?.catIds || {}),
  };
  if (!mergedCatIds._path) {
    mergedCatIds._path = incoming?.path || current?.path || current?.catIds?._path || "";
  }
  return {
    leafCatId: Number(incoming?.leafCatId || current?.leafCatId) || 0,
    catIds: mergedCatIds,
    path: String(incoming?.path || current?.path || mergedCatIds._path || "").trim(),
    title: String(incoming?.title || current?.title || "").trim(),
    categorySearch: String(incoming?.categorySearch || current?.categorySearch || "").trim(),
    sourceProductId: normalizeHistoryIdentifier(incoming?.sourceProductId || current?.sourceProductId),
    goodsId: normalizeHistoryIdentifier(incoming?.goodsId || current?.goodsId),
    productId: normalizeHistoryIdentifier(incoming?.productId || current?.productId),
    productSkcId: normalizeHistoryIdentifier(incoming?.productSkcId || current?.productSkcId),
    updatedAt: String(incoming?.updatedAt || current?.updatedAt || new Date().toISOString()),
    source: String(incoming?.source || current?.source || "").trim(),
  };
}

function readPersistedCategoryHistoryEntries() {
  try {
    const filePath = getCategoryHistoryFilePath();
    if (!fs.existsSync(filePath)) return [];
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const list = Array.isArray(raw) ? raw : raw?.entries;
    if (!Array.isArray(list)) return [];
    return list
      .map((entry) => normalizeCategoryHistoryEntry(entry))
      .filter(Boolean)
      .slice(0, CATEGORY_HISTORY_LIMIT);
  } catch (e) {
    logSilent("category.history.read", e, "warn");
    return [];
  }
}

function persistCategoryHistoryEntries() {
  try {
    const filePath = getCategoryHistoryFilePath();
    fs.writeFileSync(filePath, JSON.stringify(categoryHistoryCache || [], null, 2));
  } catch (e) {
    logSilent("category.history.write", e, "warn");
  }
}

function upsertCategoryHistoryEntry(entry, options = {}) {
  const normalizedEntry = normalizeCategoryHistoryEntry(entry);
  if (!normalizedEntry) return null;
  if (!categoryHistoryCache) categoryHistoryCache = readPersistedCategoryHistoryEntries();

  const identity = getCategoryHistoryIdentity(normalizedEntry);
  const nextHistory = [];
  let mergedEntry = normalizedEntry;
  let merged = false;
  for (const currentEntry of categoryHistoryCache) {
    if (!merged && getCategoryHistoryIdentity(currentEntry) === identity) {
      mergedEntry = mergeCategoryHistoryEntries(currentEntry, normalizedEntry);
      nextHistory.push(mergedEntry);
      merged = true;
    } else {
      nextHistory.push(currentEntry);
    }
  }
  if (!merged) nextHistory.unshift(mergedEntry);

  categoryHistoryCache = nextHistory
    .filter(Boolean)
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
    .slice(0, CATEGORY_HISTORY_LIMIT);

  if (options.persist !== false) persistCategoryHistoryEntries();
  return mergedEntry;
}

function seedCategoryHistoryEntriesFromFailedPayloads() {
  try {
    const debugDir = getDebugDir();
    const files = fs.readdirSync(debugDir)
      .filter((fileName) => /^failed_payload_\d+\.json$/i.test(fileName))
      .sort()
      .slice(-CATEGORY_HISTORY_SEED_LIMIT);
    for (const fileName of files) {
      try {
        const filePath = path.join(debugDir, fileName);
        const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const entry = normalizeCategoryHistoryEntry(raw, { source: "failed_payload" });
        if (entry) upsertCategoryHistoryEntry(entry, { persist: false });
      } catch (e) {
        logSilent(`category.history.seed:${fileName}`, e, "warn");
      }
    }
  } catch (e) {
    logSilent("category.history.seed", e, "warn");
  }
}

function collectLocalCategorySeedFiles() {
  const appDataDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation");
  const candidateFiles = [];
  const rememberFile = (filePath) => {
    if (!filePath || !fs.existsSync(filePath)) return;
    if (!candidateFiles.includes(filePath)) candidateFiles.push(filePath);
  };

  try {
    for (const fileName of fs.readdirSync(appDataDir)) {
      if (
        /^temu_raw_.*\.json(?:\.bak)?$/i.test(fileName)
        || /^temu_product_detail_cache\.json(?:\.bak)?$/i.test(fileName)
        || /^temu_store%3A.*temu_product_detail_cache\.json$/i.test(fileName)
      ) {
        rememberFile(path.join(appDataDir, fileName));
      }
    }
  } catch (e) {
    logSilent("category.history.seed.local_files", e, "warn");
  }

  try {
    const debugDir = getDebugDir();
    for (const fileName of fs.readdirSync(debugDir)) {
      if (/^scrape_all_.*\.json$/i.test(fileName)) rememberFile(path.join(debugDir, fileName));
    }
  } catch (e) {
    logSilent("category.history.seed.debug_files", e, "warn");
  }

  return candidateFiles
    .map((filePath) => {
      try {
        return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs || 0 };
      } catch {
        return { filePath, mtimeMs: 0 };
      }
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .map((item) => item.filePath);
}

function buildCategoryHistorySeedEntryFromNode(node = {}) {
  if (!node || typeof node !== "object") return null;

  const categoriesSource = (
    (node.categories && typeof node.categories === "object" && !Array.isArray(node.categories)) ? node.categories
      : (node.categoriesSimpleVO && typeof node.categoriesSimpleVO === "object" ? node.categoriesSimpleVO : null)
  );
  const catIds = (
    extractCategoryIdsSnapshot(categoriesSource)
    || extractCategoryIdsSnapshot(node.catIds)
    || extractCategoryIdsSnapshot(node)
    || null
  );
  const leafCatId = Number(
    node.leafCat?.catId
    || node.leftCat?.catId
    || node.leafCatId
    || node.leafCategoryId
    || node.catId
    || node.categoryId
    || extractLeafCatIdFromCategoryIds(catIds)
  ) || 0;
  if (!leafCatId || !catIds || getCategoryDepth(catIds) === 0) return null;

  const title = String(
    node.productName
    || node.title
    || node.name
    || node.goodsName
    || ""
  ).trim();
  const pathText = String(
    catIds._path
    || node.path
    || node.catPath
    || getCategoryPathText(catIds)
    || (typeof node.categories === "string" ? node.categories : "")
  ).trim();
  const categorySearch = String(
    node.categorySearch
    || pathText
    || node.leafCat?.catName
    || node.leftCat?.catName
    || node.category
    || ""
  ).trim();
  const goodsId = normalizeHistoryIdentifier(node.goodsId || node.itemId);
  const productId = normalizeHistoryIdentifier(node.productId || node.spuId);
  const productSkcId = normalizeHistoryIdentifier(node.productSkcId || node.skcId);
  const sourceProductId = normalizeHistoryIdentifier(node.sourceProductId || goodsId || productId);

  return normalizeCategoryHistoryEntry({
    leafCatId,
    catIds: {
      ...catIds,
      ...(pathText && !catIds._path ? { _path: pathText } : {}),
    },
    path: pathText,
    title,
    categorySearch,
    sourceProductId,
    goodsId,
    productId,
    productSkcId,
    updatedAt: new Date().toISOString(),
    source: "local_product_cache",
  });
}

function seedCategoryHistoryEntriesFromLocalProductCaches() {
  const files = collectLocalCategorySeedFiles();
  if (files.length === 0) return;

  let seededCount = 0;
  const visitNode = (value, seen) => {
    if (!value || seededCount >= CATEGORY_HISTORY_PRODUCT_SEED_LIMIT) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (seededCount >= CATEGORY_HISTORY_PRODUCT_SEED_LIMIT) break;
        visitNode(item, seen);
      }
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    const entry = buildCategoryHistorySeedEntryFromNode(value);
    if (entry) {
      upsertCategoryHistoryEntry(entry, { persist: false });
      seededCount += 1;
      if (seededCount >= CATEGORY_HISTORY_PRODUCT_SEED_LIMIT) return;
    }

    for (const child of Object.values(value)) {
      if (seededCount >= CATEGORY_HISTORY_PRODUCT_SEED_LIMIT) break;
      visitNode(child, seen);
    }
  };

  for (const filePath of files) {
    if (seededCount >= CATEGORY_HISTORY_PRODUCT_SEED_LIMIT) break;
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      visitNode(raw, new WeakSet());
    } catch (e) {
      logSilent(`category.history.seed.local_cache:${path.basename(filePath)}`, e, "warn");
    }
  }
}

function ensureCategoryHistoryEntries() {
  if (!categoryHistoryCache) categoryHistoryCache = readPersistedCategoryHistoryEntries();
  if (!categoryHistorySeeded) {
    categoryHistorySeeded = true;
    seedCategoryHistoryEntriesFromFailedPayloads();
    seedCategoryHistoryEntriesFromLocalProductCaches();
    persistCategoryHistoryEntries();
  }
  return categoryHistoryCache;
}

function scoreCategoryHistoryEntry(entry, request = {}) {
  let score = 0;
  const entryPathNormalized = normalizeCategoryLookupText(entry.path || entry.categorySearch || entry.catIds?._path || "");
  const titleIntent = getCategoryIntentHints(request.title || "");
  const exactIdentifierMatch = hasExactCategoryHistoryIdentifierMatch(entry, request);
  if (exactIdentifierMatch) score += 5000;
  const requestedLeafCatId = Number(
    request.leafCatId
    || request.leafCategoryId
    || request.catId
    || request.categoryId
    || extractLeafCatIdFromCategoryIds(request.catIds)
  ) || 0;
  if (requestedLeafCatId && requestedLeafCatId === entry.leafCatId) score += 1000;

  const requestedCategoryTexts = Array.from(new Set([
    request.categorySearch,
    request.path,
    request.catIds?._path,
  ].map((value) => String(value || "").trim()).filter(Boolean)));
  const entryCategoryTexts = Array.from(new Set([
    entry.categorySearch,
    entry.path,
    entry.catIds?._path,
  ].map((value) => String(value || "").trim()).filter(Boolean)));

  for (const requestedText of requestedCategoryTexts) {
    const requestedNormalized = normalizeCategoryLookupText(requestedText);
    if (!requestedNormalized) continue;
    for (const entryText of entryCategoryTexts) {
      const entryNormalized = normalizeCategoryLookupText(entryText);
      if (!entryNormalized) continue;
      if (requestedNormalized === entryNormalized) {
        score = Math.max(score, 260 + requestedNormalized.split("/").filter(Boolean).length * 10);
        continue;
      }
      const overlap = countCategoryPathOverlap(requestedNormalized, entryNormalized);
      if (overlap > 0) {
        score = Math.max(score, overlap * 45 + ((requestedNormalized.includes(entryNormalized) || entryNormalized.includes(requestedNormalized)) ? 70 : 0));
      }
    }
  }

  const requestedTitle = normalizeCategoryLookupText(request.title || "").replace(/\//g, "");
  const entryTitle = normalizeCategoryLookupText(entry.title || "").replace(/\//g, "");
  if (requestedTitle && entryTitle) {
    if (requestedTitle === entryTitle) score += 180;
    else {
      const requestPrefix = requestedTitle.slice(0, Math.min(18, requestedTitle.length));
      const entryPrefix = entryTitle.slice(0, Math.min(18, entryTitle.length));
      if (requestPrefix && entryPrefix && (requestedTitle.includes(entryPrefix) || entryTitle.includes(requestPrefix))) score += 90;
    }
  }

  if (titleIntent.isLaundryColorSheet) {
    if (
      entryPathNormalized.includes("家居、厨房用品/家庭清洁用品/家庭清洁/清洁布")
      || entryPathNormalized.includes("家居、厨房用品/家庭清洁用品/家庭清洁/清洁工具/其他（清洁工具）")
    ) {
      score += titleIntent.isSheetLikeCleaning ? 320 : 220;
    }
    if (
      entryPathNormalized.includes("工业和科学")
      || entryPathNormalized.includes("商业清洁")
      || entryPathNormalized.includes("各色美食")
      || entryPathNormalized.includes("烘焙预拌粉")
      || entryPathNormalized.includes("物料搬运")
      || entryPathNormalized.includes("固定捆扎带")
    ) {
      score -= 260;
    }
  }

  if (entry.path) score += 5;
  if (extractLeafCatIdFromCategoryIds(entry.catIds) === entry.leafCatId) score += 5;
  return score;
}

function findCategoryHistoryMatch(request = {}) {
  const entries = ensureCategoryHistoryEntries();
  let bestEntry = null;
  let bestScore = -1;
  for (const entry of entries) {
    const score = scoreCategoryHistoryEntry(entry, request);
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }
  const requestedLeafCatId = Number(
    request.leafCatId
    || request.leafCategoryId
    || request.catId
    || request.categoryId
    || extractLeafCatIdFromCategoryIds(request.catIds)
  ) || 0;
  if (bestEntry && (bestScore >= 120 || (requestedLeafCatId > 0 && requestedLeafCatId === bestEntry.leafCatId))) {
    return {
      ...bestEntry,
      _score: bestScore,
      _exactIdentifierMatch: hasExactCategoryHistoryIdentifierMatch(bestEntry, request),
    };
  }
  return null;
}

function rememberResolvedCategory(request = {}) {
  const entry = normalizeCategoryHistoryEntry(request, {
    source: request.source || "resolved",
    updatedAt: new Date().toISOString(),
  });
  if (!entry) return null;
  return upsertCategoryHistoryEntry(entry);
}

function readPersistedAutoPricingTasks() {
  try {
    if (!fs.existsSync(AUTO_PRICING_TASKS_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(AUTO_PRICING_TASKS_FILE, "utf8"));
    return Array.isArray(raw?.tasks) ? raw.tasks : [];
  } catch (error) {
    logSilent("auto_pricing.tasks.read", error, "warn");
    return [];
  }
}

function collectHistoricalDraftIds(request = {}) {
  const normalizedCsvPath = String(request.csvPath || "").trim().toLowerCase();
  const normalizedTitle = normalizeCategoryLookupText(request.title || request.name || "");
  const targetIndex = Number(request.index);
  const draftIds = [];
  const seen = new Set();

  const remember = (value) => {
    const draftId = Number(value) || 0;
    if (draftId <= 0 || seen.has(draftId)) return;
    seen.add(draftId);
    draftIds.push(draftId);
  };

  for (const task of readPersistedAutoPricingTasks()) {
    const sameCsv = !normalizedCsvPath || String(task?.csvPath || "").trim().toLowerCase() === normalizedCsvPath;
    if (!sameCsv) continue;
    for (const result of Array.isArray(task?.results) ? task.results : []) {
      if (!result?.success) continue;
      const resultIndex = Number(result?.index);
      const normalizedResultTitle = normalizeCategoryLookupText(result?.name || result?.title || "");
      const sameIndex = Number.isFinite(targetIndex) && resultIndex === targetIndex;
      const sameTitle = normalizedTitle && normalizedResultTitle && (
        normalizedResultTitle === normalizedTitle
        || normalizedResultTitle.includes(normalizedTitle)
        || normalizedTitle.includes(normalizedResultTitle)
      );
      if (!sameIndex && !sameTitle) continue;
      remember(result?.draftId);
      remember(result?.productDraftId);
      remember(result?.result?.draftId);
      remember(result?.result?.productDraftId);
      remember(result?.productId);
      remember(result?.result?.productId);
    }
  }

  return draftIds;
}

function extractCategoryIdsFromDraftCategories(categories = {}) {
  const catIds = {};
  let leafCatId = 0;
  const pathParts = [];
  for (let level = 1; level <= 10; level += 1) {
    const node = categories?.[`cat${level}`] || {};
    const catId = Number(node?.catId) || 0;
    const catName = String(node?.catName || "").trim();
    catIds[`cat${level}Id`] = catId;
    if (catName) {
      catIds[`cat${level}Name`] = catName;
      pathParts.push(catName);
    }
    if (catId > 0) leafCatId = catId;
  }
  if (pathParts.length > 0) catIds._path = pathParts.join(" > ");
  return leafCatId > 0 ? { catIds, leafCatId, path: catIds._path || "" } : null;
}

// browser/context 代理：旧代码通过全局 browser/context 访问，实际指向 browserState
// 使用 defineProperty 创建动态代理，读写都同步到 browserState
let browser = null;
let context = null;
let cookiePath = "";
let lastAccountId = "";
let _navLiteMode = false;
const SCRAPE_RESULT_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

function createPendingTaskTracker() {
  const pending = new Set();
  return {
    track(task) {
      pending.add(task);
      task.finally(() => pending.delete(task));
      return task;
    },
    async drain(timeoutMs = 2000) {
      if (pending.size === 0) return;
      await Promise.race([
        Promise.allSettled(Array.from(pending)),
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
    },
  };
}

function detectSpreadsheetFileKind(filePath) {
  try {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".xlsx" || extension === ".xls") return "excel";
    const fd = fs.openSync(filePath, "r");
    try {
      const header = Buffer.alloc(4);
      const bytesRead = fs.readSync(fd, header, 0, 4, 0);
      if (bytesRead >= 2 && header[0] === 0x50 && header[1] === 0x4b) return "excel";
      if (bytesRead >= 4 && header[0] === 0xd0 && header[1] === 0xcf && header[2] === 0x11 && header[3] === 0xe0) return "excel";
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    logSilent("spreadsheet.detect", e);
  }
  return "csv";
}

function isExcelLikeFile(filePath) {
  return detectSpreadsheetFileKind(filePath) === "excel";
}

function parseSpreadsheetCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function readSpreadsheetRows(filePath, options = {}) {
  const kind = detectSpreadsheetFileKind(filePath);
  try {
    const wb = XLSX.readFile(filePath, { cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { kind, rows: [] };
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: options.defval ?? "",
    });
    return { kind, rows };
  } catch (error) {
    if (kind !== "csv") throw error;
    const csvContent = fs.readFileSync(filePath, "utf8");
    const rows = csvContent
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => parseSpreadsheetCsvLine(line));
    return { kind, rows };
  }
}

function resolveReadScrapeDataRequest(taskKey) {
  if (typeof taskKey !== "string" || !taskKey.trim()) {
    throw new Error("采集数据 key 无效");
  }

  if (taskKey.startsWith("csv_preview:")) {
    const filePath = path.resolve(taskKey.slice("csv_preview:".length));
    const extension = path.extname(filePath).toLowerCase();
    if (![".csv", ".xlsx", ".xls"].includes(extension)) {
      throw new Error("仅支持预览 CSV / Excel 表格");
    }
    return { type: "csv_preview", filePath };
  }

  const normalizedKey = taskKey.trim();
  if (
    normalizedKey.includes("..")
    || normalizedKey.includes("/")
    || normalizedKey.includes("\\")
    || !SCRAPE_RESULT_KEY_PATTERN.test(normalizedKey)
  ) {
    throw new Error(`非法采集数据 key: ${taskKey}`);
  }

  const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  return {
    type: "scrape_result",
    filePath: path.join(debugDir, `scrape_all_${normalizedKey}.json`),
  };
}

function pickRecentUniqueValue(values) {
  const normalizedValues = values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (normalizedValues.length === 0) return "热销款";

  const unused = normalizedValues.filter((value) => !recentChildSpecValues.includes(value));
  const pool = unused.length > 0 ? unused : normalizedValues;
  const selected = pool[Math.floor(Math.random() * pool.length)];

  recentChildSpecValues.push(selected);
  if (recentChildSpecValues.length > 120) recentChildSpecValues.shift();
  return selected;
}

function generateChildSpecValue(title = "") {
  const raw = String(title || "").trim();
  const normalized = raw.toLowerCase();

  const specRules = [
    {
      keywords: ["毛巾", "抹布", "擦车巾", "洗车巾", "microfiber", "towel", "cloth", "rag"],
      values: ["洗车神器", "加厚吸水", "强力去污", "爱车清洁"],
    },
    {
      keywords: ["刷", "刷子", "清洁刷", "brush", "clean", "cleaner", "scrub"],
      values: ["清洁神器", "缝隙清洁", "深层去污", "去污升级"],
    },
    {
      keywords: ["收纳", "置物", "置物架", "收纳架", "organizer", "storage", "rack", "shelf"],
      values: ["居家收纳", "空间升级", "整洁必备", "收纳好物"],
    },
    {
      keywords: ["挂钩", "挂架", "挂扣", "hook", "hanger", "hanging"],
      values: ["免打孔款", "稳固承重", "家用必备", "收纳升级"],
    },
    {
      keywords: ["工具", "螺丝刀", "扳手", "套筒", "钳", "tool", "wrench", "screwdriver", "repair", "socket"],
      values: ["维修必备", "耐用升级", "工具套装", "五金好物"],
    },
    {
      keywords: ["胶带", "贴", "贴纸", "胶", "tape", "adhesive", "sticker"],
      values: ["强力粘贴", "牢固耐用", "家用好物", "轻松固定"],
    },
    {
      keywords: ["锁", "搭扣", "卡扣", "lock", "clasp", "buckle", "latch"],
      values: ["加固耐用", "稳固升级", "安全防护", "安装省心"],
    },
    {
      keywords: ["车", "汽车", "车载", "car", "auto", "vehicle"],
      values: ["车载必备", "出行好物", "爱车清洁", "收纳升级"],
    },
  ];

  for (const rule of specRules) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return pickRecentUniqueValue(rule.values);
    }
  }

  const cleanedChinese = raw
    .replace(/[【】\[\]()（）<>《》]/g, " ")
    .replace(/\d+(\.\d+)?\s*(pcs|pack|set|pairs?|pieces?|inch|cm|mm|ml|oz|g|kg|lb)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const chineseMatch = cleanedChinese.match(/[\u4e00-\u9fa5]{2,8}/g) || [];
  const titleCandidates = chineseMatch.flatMap((item) => {
    const trimmed = item.slice(0, 6);
    return trimmed.length >= 2 ? [trimmed, `${trimmed.slice(0, 4)}款`] : [];
  });

  return pickRecentUniqueValue([...titleCandidates, "热销款", "实用款", "升级款", "精选款"]);
}

function buildSpecNameCandidates(title = "", preferredSpecName = "") {
  const explicitName = String(preferredSpecName || "").trim();
  const generatedName = generateChildSpecValue(title || "");
  return Array.from(new Set([
    explicitName,
    generatedName,
    "热销款",
    "实用款",
    "升级款",
    "精选款",
  ].filter(Boolean)));
}

function buildSecondarySpecNameCandidates(title = "", usedNames = []) {
  const used = new Set((Array.isArray(usedNames) ? usedNames : [usedNames])
    .map((item) => String(item || "").trim())
    .filter(Boolean));
  return buildSpecNameCandidates(title || "")
    .filter((item) => !used.has(item))
    .concat(["精选款", "升级款", "实用款", "热销款"])
    .filter((item, index, list) => item && !used.has(item) && list.indexOf(item) === index);
}

function cleanWorkflowListingTitle(rawTitle = "") {
  return String(rawTitle || "")
    .replace(/[【\[][^】\]]*(?:\d+(?:\.\d+)?\s*(?:cm|mm|m|inch|in|ft|ml|l|oz|g|kg|lb|lbs|pcs?|pieces?|packs?|sets?)|尺寸|尺码|规格|数量|件装|个装|只装|套装|组合装)[^】\]]*[】\]]/gi, " ")
    .replace(/[（(][^）)]*(?:\d+(?:\.\d+)?\s*(?:cm|mm|m|inch|in|ft|ml|l|oz|g|kg|lb|lbs|pcs?|pieces?|packs?|sets?)|尺寸|尺码|规格|数量|件装|个装|只装|套装|组合装)[^）)]*[）)]/gi, " ")
    .replace(/\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?(?:\s*[x×*]\s*\d+(?:\.\d+)?)?\s*(?:cm|mm|m|inch|in|ft)?/gi, " ")
    .replace(/\b(?:set|pack|bundle)\s+of\s+\d+\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:cm|mm|m|inch|in|ft|ml|l|oz|g|kg|lb|lbs)\b/gi, " ")
    .replace(/\b\d+\s*(?:pcs?|pieces?|packs?|sets?|pairs?)\b/gi, " ")
    .replace(/\d+\s*(?:件装|个装|只装|片装|包装|套装|组装|对装|件套|件|个|只|片|包|套|组|对|瓶|支|张|条|根|块|台|袋)/g, " ")
    .replace(/(?:多件装|组合装|套装|数量|规格|尺寸|尺码)\s*[:：]?\s*/g, " ")
    .replace(/[|｜/]+/g, " ")
    .replace(/[，,、；;]\s*[，,、；;]+/g, "，")
    .replace(/^[\s，,、；;|｜/]+|[\s，,、；;|｜/]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCellTextFragments(value, seen = new WeakSet()) {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "string") {
    const text = value.trim();
    return text && text !== "[object Object]" ? [text] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractCellTextFragments(item, seen));
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
  const orderedTexts = orderedCategoryKeys.flatMap((key) => extractCellTextFragments(objectValue[key], seen));
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
  ].flatMap((item) => extractCellTextFragments(item, seen));
  if (preferredTexts.length > 0) return preferredTexts;

  return Object.values(objectValue).flatMap((item) => extractCellTextFragments(item, seen));
}

function normalizeCellText(value, separator = ", ") {
  const seen = new Set();
  return extractCellTextFragments(value)
    .filter((text) => {
      if (seen.has(text)) return false;
      seen.add(text);
      return true;
    })
    .join(separator);
}

function normalizeCategoryText(value) {
  return normalizeCellText(value, " / ");
}

function normalizePriceNumber(value, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  const text = normalizeCellText(value);
  if (!text) return fallback;
  const normalized = text
    .replace(/[\u00A0\s]/g, "")
    .replace(/[,，]/g, "")
    .replace(/[￥¥$€£]/g, "")
    .replace(/[^\d.-]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
}

function getScrapeAllTimestamp() {
  return new Date().toLocaleString("zh-CN");
}

function cloneScrapeAllTasks(tasks = {}) {
  return Object.fromEntries(
    Object.entries(tasks).map(([key, value]) => [key, value && typeof value === "object" ? { ...value } : value]),
  );
}

function summarizeScrapeAllTasks(tasks = {}) {
  const entries = Object.entries(tasks);
  let successCount = 0;
  let errorCount = 0;
  let runningCount = 0;
  let pendingCount = 0;

  for (const [, task] of entries) {
    switch (task?.status) {
      case "success":
        successCount += 1;
        break;
      case "error":
        errorCount += 1;
        break;
      case "running":
        runningCount += 1;
        break;
      default:
        pendingCount += 1;
        break;
    }
  }

  return {
    totalTasks: entries.length,
    completedTasks: successCount + errorCount,
    successCount,
    errorCount,
    runningCount,
    pendingCount,
    currentTaskKeys: entries.filter(([, task]) => task?.status === "running").map(([key]) => key),
  };
}

function createScrapeAllProgress(patch = {}) {
  const tasks = cloneScrapeAllTasks(patch.tasks);
  const summary = summarizeScrapeAllTasks(tasks);
  return {
    running: Boolean(patch.running),
    status: typeof patch.status === "string" ? patch.status : "idle",
    message: typeof patch.message === "string" ? patch.message : "",
    tasks,
    totalTasks: Number(patch.totalTasks) || summary.totalTasks,
    completedTasks: Number(patch.completedTasks) || summary.completedTasks,
    successCount: Number(patch.successCount) || summary.successCount,
    errorCount: Number(patch.errorCount) || summary.errorCount,
    runningCount: Number(patch.runningCount) || summary.runningCount,
    pendingCount: Number(patch.pendingCount) || summary.pendingCount,
    currentTaskKeys: Array.isArray(patch.currentTaskKeys) ? [...patch.currentTaskKeys] : summary.currentTaskKeys,
    startedAt: typeof patch.startedAt === "string" ? patch.startedAt : "",
    updatedAt: typeof patch.updatedAt === "string" ? patch.updatedAt : "",
    finishedAt: typeof patch.finishedAt === "string" ? patch.finishedAt : "",
  };
}

let scrapeAllProgress = createScrapeAllProgress();

function replaceScrapeAllProgress(patch = {}) {
  scrapeAllProgress = createScrapeAllProgress({
    ...patch,
    updatedAt: typeof patch.updatedAt === "string" ? patch.updatedAt : getScrapeAllTimestamp(),
  });
  return scrapeAllProgress;
}

function updateScrapeAllProgress(patch = {}) {
  const nextTasks = patch.tasks ? cloneScrapeAllTasks(patch.tasks) : cloneScrapeAllTasks(scrapeAllProgress.tasks);
  scrapeAllProgress = createScrapeAllProgress({
    ...scrapeAllProgress,
    ...patch,
    tasks: nextTasks,
    updatedAt: typeof patch.updatedAt === "string" ? patch.updatedAt : getScrapeAllTimestamp(),
  });
  return scrapeAllProgress;
}

function updateScrapeAllTask(taskKey, patch = {}) {
  const nextTasks = cloneScrapeAllTasks(scrapeAllProgress.tasks);
  nextTasks[taskKey] = {
    ...(nextTasks[taskKey] || { status: "pending" }),
    ...patch,
  };
  return updateScrapeAllProgress({ tasks: nextTasks });
}

function normalizeRequestCredential(value) {
  return typeof value === "string" ? value : "";
}

function clearBrowserPassword() {
  browserState.lastPassword = "";
}

function clearStickyWorkerCredentials() {
  stickyCredentialAccountId = "";
  stickyCredentialPhone = "";
  stickyCredentialPassword = "";
}

function sanitizeLoginPhone(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11) return digits;
  if (digits.length > 11) return digits.slice(-11);
  return digits || raw;
}

function normalizeFilledLoginPhone(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11) return digits;
  return digits || raw;
}

function isPlaceholderLoginPhone(value = "") {
  return sanitizeLoginPhone(value) === "13800138000";
}

function getRequestCredentials() {
  const requestedPhone = sanitizeLoginPhone(requestCredentialPhone || "");
  const stickyPhone = sanitizeLoginPhone(stickyCredentialPhone || "");
  const cachedPhone = sanitizeLoginPhone(browserState.lastPhone || "");
  const phone = requestedPhone && !isPlaceholderLoginPhone(requestedPhone)
    ? requestedPhone
    : (stickyPhone && !isPlaceholderLoginPhone(stickyPhone)
      ? stickyPhone
      : (cachedPhone && !isPlaceholderLoginPhone(cachedPhone) ? cachedPhone : ""));
  const password = normalizeRequestCredential(requestCredentialPassword)
    || normalizeRequestCredential(stickyCredentialPassword)
    || normalizeRequestCredential(browserState.lastPassword);
  return {
    phone,
    password,
  };
}

function getWorkerTypingDelay() {
  const scale = getDelayScale();
  const min = Math.max(20, Math.round(40 * scale));
  const max = Math.max(min, Math.round(120 * scale));
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function findVisibleInputOnPage(page, selectors = []) {
  const targets = [];
  if (page) targets.push(page);
  if (typeof page?.frames === "function") {
    for (const frame of page.frames()) {
      if (frame && frame !== page.mainFrame?.()) targets.push(frame);
    }
  }

  for (const target of targets) {
    for (const selector of selectors) {
      const locator = target.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        const visible = await candidate.isVisible().catch(() => false);
        const editable = await candidate.isEditable().catch(() => false);
        if (visible && editable) return candidate;
      }
    }

    const genericSelectors = [
      'input:not([type="hidden"]):not([disabled])',
      'textarea:not([disabled])',
    ];
    for (const selector of genericSelectors) {
      const locator = target.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        const visible = await candidate.isVisible().catch(() => false);
        const editable = await candidate.isEditable().catch(() => false);
        if (visible && editable) return candidate;
      }
    }
  }
  return null;
}

async function readVisibleInputMeta(input) {
  try {
    return await input.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.id || "",
        name: node.getAttribute("name") || "",
        type: node.getAttribute("type") || "",
        placeholder: node.getAttribute("placeholder") || "",
        autocomplete: node.getAttribute("autocomplete") || "",
        value: node.value || "",
        width: Math.round(rect.width || 0),
        height: Math.round(rect.height || 0),
      };
    });
  } catch {
    return {
      id: "",
      name: "",
      type: "",
      placeholder: "",
      autocomplete: "",
      value: "",
      width: 0,
      height: 0,
    };
  }
}

function isLikelySellerCountryCodeInput(meta = {}) {
  const value = String(meta?.value || "").trim();
  const placeholder = String(meta?.placeholder || "").trim();
  const id = String(meta?.id || "").trim();
  const name = String(meta?.name || "").trim();
  const width = Number(meta?.width) || 0;

  if (id === "usernameId" || name === "usernameId") return false;
  if (name === "phone" || name === "mobile") return false;
  if (placeholder.includes("手机") || placeholder.includes("号码")) return false;
  if (/^\+\d+$/.test(value)) return true;
  if (!placeholder && !id && !name && width > 0 && width <= 120) return true;
  return false;
}

async function findSellerPhoneInputOnPage(page) {
  const targets = [];
  if (page) targets.push(page);
  if (typeof page?.frames === "function") {
    for (const frame of page.frames()) {
      if (frame && frame !== page.mainFrame?.()) targets.push(frame);
    }
  }

  const selectorGroups = [
    ['#usernameId', 'input[name="usernameId"]'],
    ['input[placeholder="手机号码"]', 'input[placeholder*="手机号码"]', 'input[placeholder*="手机号"]', 'input[placeholder*="手机"]', 'input[placeholder*="号码"]'],
    ['input[name="phone"]', 'input[name="mobile"]', 'input[name="account"]', 'input[data-testid*="phone"]', 'input[autocomplete="username"]'],
    ['input[type="tel"]', 'input[inputmode="numeric"]', '.el-input__inner'],
  ];

  for (const target of targets) {
    for (const selectors of selectorGroups) {
      for (const selector of selectors) {
        const locator = target.locator(selector);
        const count = await locator.count().catch(() => 0);
        for (let index = 0; index < count; index += 1) {
          const candidate = locator.nth(index);
          const visible = await candidate.isVisible().catch(() => false);
          const editable = await candidate.isEditable().catch(() => false);
          if (!visible || !editable) continue;
          const meta = await readVisibleInputMeta(candidate);
          if (isLikelySellerCountryCodeInput(meta)) continue;
          return { input: candidate, meta, selector, index };
        }
      }
    }
  }

  return null;
}

async function fillInputWithVerification(input, value, options = {}) {
  const {
    label = "输入框",
    logPrefix = "[input]",
    normalize = (next) => String(next ?? "").trim(),
  } = options;
  const expected = normalize(value);
  const readValue = async () => normalize(
    await input.inputValue().catch(async () => input.evaluate((node) => node?.value || ""))
  );
  const clearInput = async () => {
    await input.click({ clickCount: 3 }).catch(() => {});
    await input.press("Control+A").catch(() => {});
    await input.press("Backspace").catch(() => {});
    await input.fill("").catch(() => {});
    await input.evaluate((node) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(node, "");
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }).catch(() => {});
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await clearInput();
    await randomDelay(120, 240);

    if (attempt === 0) {
      // Attempt 0: Playwright .fill() — most reliable for React controlled inputs
      await input.fill(String(value ?? "")).catch(() => {});
    } else if (attempt < 3) {
      // Attempt 1-2: char-by-char typing (simulates human input)
      for (const char of String(value ?? "")) {
        await input.type(char, { delay: getWorkerTypingDelay() });
      }
    } else {
      // Attempt 3: direct evaluate (last resort)
      await input.evaluate((node, nextValue) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(node, nextValue);
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
        node.dispatchEvent(new Event("blur", { bubbles: true }));
      }, String(value ?? ""));
    }

    await randomDelay(150, 320);
    const actual = await readValue();
    if (actual === expected) return true;
    console.error(`${logPrefix} ${label} mismatch on attempt ${attempt + 1}: expected=${expected} actual=${actual || "<empty>"}`);
  }

  throw new Error(`${label}输入后校验失败`);
}

function buildSellerCentralUrl(targetPath = "/goods/list") {
  return /^https?:\/\//i.test(String(targetPath || ""))
    ? String(targetPath)
    : `https://agentseller.temu.com${targetPath}`;
}

function isSellerCentralWorkspaceUrl(url = "") {
  const text = String(url || "");
  return /^https:\/\/agentseller(?:-[a-z]+)?\.temu\.com\//i.test(text)
    && !isSellerCentralAuthUrl(text);
}

async function openSellerCentralTarget(page, targetPath = "/goods/list", options = {}) {
  const lite = Boolean(options.lite);
  const directUrl = buildSellerCentralUrl(targetPath);
  const logPrefix = options.logPrefix || "[page-open]";

  console.error(`${logPrefix} Opening ${directUrl} (lite=${lite})`);
  for (let navTry = 0; navTry < 3; navTry += 1) {
    try {
      await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      break;
    } catch (navErr) {
      const retryable = /ERR_ABORTED|frame was detached|ERR_FAILED/i.test(navErr?.message || "");
      if (!retryable || navTry >= 2) throw navErr;
      console.error(`${logPrefix} goto retry ${navTry + 1}/3: ${navErr.message}`);
      await randomDelay(lite ? 800 : 1800, lite ? 1400 : 2600);
    }
  }

  await page.waitForSelector("body", { timeout: lite ? 2500 : 5000 }).catch(() => {});
  await page.waitForFunction(
    () => document.readyState === "interactive" || document.readyState === "complete",
    { timeout: lite ? 2000 : 4000 }
  ).catch(() => {});
  await page.waitForLoadState("domcontentloaded", { timeout: lite ? 2000 : 4000 }).catch(() => {});
  await randomDelay(lite ? 300 : 700, lite ? 600 : 1100);
  await page.waitForURL(/.*/, { timeout: lite ? 3000 : 10000 }).catch(() => {});
  console.error(`${logPrefix} Current URL: ${page.url()}`);
  return page;
}

let dedicatedSellerLoginPromise = null;

async function ensureDedicatedSellerLogin(logPrefix = "[seller-login-fallback]") {
  if (dedicatedSellerLoginPromise) {
    return dedicatedSellerLoginPromise;
  }

  const { phone, password } = getRequestCredentials();
  if (!phone || !password) {
    console.error(`${logPrefix} Missing saved credentials, skip dedicated login`);
    return false;
  }

  dedicatedSellerLoginPromise = (async () => {
    console.error(`${logPrefix} Starting dedicated seller login`);
    try {
      await loginWithTransientPassword(phone, password);
      console.error(`${logPrefix} Dedicated seller login completed`);
      return true;
    } catch (error) {
      console.error(`${logPrefix} Dedicated seller login failed: ${error.message}`);
      return false;
    } finally {
      dedicatedSellerLoginPromise = null;
    }
  })();

  return dedicatedSellerLoginPromise;
}

function getLatestWorkerPage(preferredPage = null) {
  if (preferredPage && !preferredPage.isClosed?.()) return preferredPage;
  const pageList = context?.pages?.() || browserState.context?.pages?.() || [];
  for (let index = pageList.length - 1; index >= 0; index -= 1) {
    const page = pageList[index];
    if (page && !page.isClosed?.()) return page;
  }
  return null;
}

async function captureWorkerErrorScreenshot(tag, preferredPage = null) {
  if (!shouldCaptureErrorScreenshots()) return "";
  const targetPage = getLatestWorkerPage(preferredPage);
  if (!targetPage) return "";
  try {
    const filename = `${String(tag || "worker_error").replace(/[^a-z0-9_-]/gi, "_")}_${Date.now()}.png`;
    const filePath = path.join(getDebugDir(), filename);
    await targetPage.screenshot({ path: filePath, fullPage: true });
    console.error(`[Worker] Error screenshot saved: ${filePath}`);
    return filePath;
  } catch (error) {
    logSilent("worker.screenshot", error);
    return "";
  }
}

async function tryAutoLoginInPopup(popup, logPrefix = "[popup-login]") {
  if (!shouldAutoLoginRetry()) {
    console.error(`${logPrefix} Auto-login retry disabled by settings`);
    return false;
  }

  const { phone, password } = getRequestCredentials();
  if (!phone || !password) {
    console.error(`${logPrefix} Missing saved credentials, skip auto-login`);
    return false;
  }

  try {
    const initialStage = await detectSellerPopupStage(popup);
    if (initialStage === "auth") {
      await ensurePopupConsentChecked(popup, `${logPrefix}-auth`);
      const clicked = await clickSellerAuthConfirmButton(popup, `${logPrefix}-auth`);
      if (clicked) {
        console.error(`${logPrefix} Popup already in auth stage, clicked confirm directly`);
        return true;
      }
    }

    try {
      const tabSelectors = [
        'text=账号登录',
        '[role="tab"]:has-text("账号登录")',
        '.tab:has-text("账号登录")',
        'div:has-text("账号登录")',
        'span:has-text("账号登录")',
      ];
      for (const selector of tabSelectors) {
        const accountTab = popup.locator(selector).first();
        if (await accountTab.isVisible({ timeout: 800 }).catch(() => false)) {
          await accountTab.click().catch(() => {});
          await randomDelay(500, 1000);
          break;
        }
      }
    } catch (e) { logSilent("ui.action", e); }

    await popup.waitForFunction(() => {
      const selectors = [
        '#usernameId',
        'input[name="usernameId"]',
        'input[name="phone"]',
        'input[name="mobile"]',
        'input[name="account"]',
        'input[autocomplete="username"]',
        'input[type="tel"]',
        'input[inputmode="numeric"]',
        '#passwordId',
        'input[name="password"]',
        'input[type="password"]',
      ];
      return selectors.some((selector) => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      });
    }, { timeout: 12000 }).catch(() => {});
    await randomDelay(500, 900);

    const stageAfterTab = await detectSellerPopupStage(popup);
    if (stageAfterTab === "auth") {
      await ensurePopupConsentChecked(popup, `${logPrefix}-auth-after-tab`);
      const clicked = await clickSellerAuthConfirmButton(popup, `${logPrefix}-auth-after-tab`);
      if (clicked) {
        console.error(`${logPrefix} Popup switched to auth stage after tab click, confirmed directly`);
        return true;
      }
    }

    let phoneTarget = await findSellerPhoneInputOnPage(popup);
    if (!phoneTarget) {
      await randomDelay(800, 1200);
      phoneTarget = await findSellerPhoneInputOnPage(popup);
    }
    const phoneInput = phoneTarget?.input || null;
    if (!phoneInput) throw new Error("未找到手机号输入框");
    console.error(`${logPrefix} Using phone input selector=${phoneTarget?.selector || "-"} id=${phoneTarget?.meta?.id || "-"} name=${phoneTarget?.meta?.name || "-"} width=${phoneTarget?.meta?.width || 0}`);
    await phoneInput.click();
    await fillInputWithVerification(phoneInput, phone, {
      label: "手机号",
      logPrefix,
      normalize: normalizeFilledLoginPhone,
    });
    await randomDelay(400, 800);

    const passwordSelectors = [
      '#passwordId',
      'input[name="password"]',
      'input[type="password"]',
      'input[autocomplete="current-password"]',
      'input[placeholder*="密码"]',
    ];
    let passwordInput = await findVisibleInputOnPage(popup, passwordSelectors);
    if (!passwordInput) {
      await randomDelay(500, 1000);
      passwordInput = await findVisibleInputOnPage(popup, passwordSelectors);
    }
    if (!passwordInput) throw new Error("未找到密码输入框");
    await passwordInput.click();
    await fillInputWithVerification(passwordInput, password, {
      label: "密码",
      logPrefix,
    });
    await randomDelay(400, 800);

    let lastLoginHint = "";
    for (let submitAttempt = 0; submitAttempt < 4; submitAttempt += 1) {
      const consentReady = await ensurePopupConsentChecked(popup, `${logPrefix}-consent`);
      if (!consentReady) {
        throw new Error("未能自动勾选隐私协议");
      }
      await randomDelay(200, 500);

      const loginBtn = await popup.waitForSelector('button:has-text("登录"), button:has-text("授权登录"), button:has-text("同意并登录")', { timeout: 8000 });
      await loginBtn.click().catch(async () => {
        await popup.evaluate(() => {
          const candidates = [...document.querySelectorAll("button, [role='button'], a, div[class*='btn'], div[class*='Btn']")];
          const target = candidates.find((node) => /^(登录|授权登录|同意并登录)$/.test((node.textContent || "").trim()));
          target?.click?.();
        });
      });
      console.error(`${logPrefix} Auto-login submitted (attempt ${submitAttempt + 1}/4)`);
      await randomDelay(1500, 2500);

      try {
        const agreeBtn = popup.locator('button:has-text("同意并登录"), button:has-text("同意")').first();
        if (await agreeBtn.isVisible({ timeout: 1500 })) {
          await agreeBtn.click();
          await randomDelay(800, 1500);
        }
      } catch (e) { logSilent("ui.action", e); }

      let loginHint = "";
      try {
        loginHint = await popup.evaluate(() => {
          const nodes = [...document.querySelectorAll('[class*="error"], [class*="toast"], [class*="tip"], [class*="message"], [role="alert"]')];
          const text = nodes
            .map((node) => (node.textContent || "").trim())
            .filter(Boolean)
            .join(" | ");
          return text.slice(0, 160);
        });
        if (loginHint) {
          console.error(`${logPrefix} Login hint after submit: ${loginHint}`);
        }
      } catch (e) {
        logSilent("ui.action", e);
      }
      lastLoginHint = loginHint || lastLoginHint;

      if (loginHint && /密码错误|密码不正确|账号或密码|用户名或密码|账号密码|登录失败.*密码|password.*(incorrect|wrong|invalid)|incorrect.*password/i.test(loginHint)) {
        __fatalLoginError = `登录失败（密码错误）：${loginHint}`;
        console.error(`${logPrefix} Detected wrong-password hint, aborting all retries: ${loginHint}`);
        throw new Error(__fatalLoginError);
      }

      const stageAfterSubmit = await detectSellerPopupStage(popup);
      if (stageAfterSubmit !== "login") {
        return true;
      }

      if (/隐私政策|阅读并同意|先阅读|同意/.test(loginHint)) {
        await ensurePopupConsentChecked(popup, `${logPrefix}-retry-consent`);
      }
      if (/手机|号码/.test(loginHint)) {
        await fillInputWithVerification(phoneInput, phone, {
          label: "手机号",
          logPrefix,
          normalize: normalizeFilledLoginPhone,
        });
      }
      if (/密码/.test(loginHint)) {
        await fillInputWithVerification(passwordInput, password, {
          label: "密码",
          logPrefix,
        });
      }
    }

    throw new Error(lastLoginHint || "自动登录已提交，但页面仍停留在登录页");
  } catch (error) {
    await captureWorkerErrorScreenshot("auto_login_popup_error", popup);
    console.error(`${logPrefix} Auto-login failed: ${error.message}`);
    return false;
  }
}

async function ensurePopupConsentChecked(popup, logPrefix = "[popup-consent]") {
  const isConsentChecked = async () => {
    try {
      return await popup.evaluate(() => {
        const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
        if (inputs.some((input) => input.checked)) return true;
        const customs = [...document.querySelectorAll('[role="checkbox"], [aria-checked], [class*="checkbox"], [class*="Checkbox"]')];
        return customs.some((node) => {
          const value = node.getAttribute("aria-checked");
          return value === "true" || node.classList.contains("checked") || node.classList.contains("is-checked");
        });
      });
    } catch (error) {
      logSilent("ui.action", error);
      return false;
    }
  };

  if (await isConsentChecked()) {
    return true;
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const checkbox = popup.locator('input[type="checkbox"]').first();
      if (await checkbox.isVisible({ timeout: 1200 }).catch(() => false)) {
        const checked = await checkbox.isChecked().catch(() => false);
        if (!checked) {
          await checkbox.click({ force: true });
          console.error(`${logPrefix} Checked consent checkbox via input`);
        }
      }
    } catch (e) {
      logSilent("ui.action", e);
    }

    if (await isConsentChecked()) {
      return true;
    }

    try {
      const clicked = await popup.evaluate(() => {
        const consentTexts = ["隐私政策", "阅读并同意", "已阅读并同意", "授权", "同意"];
        const setChecked = (input) => {
          try {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
            descriptor?.set?.call(input, true);
          } catch {}
          try { input.checked = true; } catch {}
          input.dispatchEvent(new Event("click", { bubbles: true }));
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        };

        const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
        for (const input of inputs) {
          if (input.checked) return true;
          const label = input.closest("label") || document.querySelector(`label[for="${input.id}"]`);
          if (label) {
            label.click();
            if (input.checked) return true;
          }
          setChecked(input);
          if (input.checked) return true;
        }

        const nodes = [
          ...document.querySelectorAll('label, [role="checkbox"], [aria-checked], [class*="checkbox"], [class*="Checkbox"], span, div'),
        ];
        for (const node of nodes) {
          const text = (node.textContent || "").replace(/\s+/g, "");
          if (!text) continue;
          if (consentTexts.some((keyword) => text.includes(keyword))) {
            node.click();
            return true;
          }
        }
        return false;
      });
      if (clicked) {
        console.error(`${logPrefix} Clicked consent fallback`);
      }
    } catch (e) {
      logSilent("ui.action", e);
    }

    await randomDelay(200, 400);
    if (await isConsentChecked()) {
      return true;
    }
  }

  console.error(`${logPrefix} Consent checkbox still unchecked after retries`);
  return false;
}

async function clickSellerAuthConfirmButton(popup, logPrefix = "[popup-auth]") {
  const buttonSelectors = [
    'button:has-text("确认授权并前往")',
    'button:has-text("确认授权")',
    'button:has-text("授权登录")',
    'button:has-text("确认并前往")',
    'button:has-text("进入")',
  ];

  for (const selector of buttonSelectors) {
    try {
      const button = popup.locator(selector).first();
      if (await button.isVisible({ timeout: 1000 })) {
        await button.click();
        console.error(`${logPrefix} Clicked auth button via locator: ${selector}`);
        return true;
      }
    } catch (error) {
      logSilent("ui.action", error);
    }
  }

  try {
    const clicked = await popup.evaluate(() => {
      const buttonKeywords = ["确认授权并前往", "确认授权", "授权登录", "确认并前往", "进入"];
      const buttons = [...document.querySelectorAll('button, [role="button"], a, div[class*="btn"], span[class*="btn"]')];
      for (const keyword of buttonKeywords) {
        const target = buttons.find((node) => {
          const text = (node.textContent || "").trim();
          return text.includes(keyword) && text.length < 30;
        });
        if (!target) continue;
        try { target.removeAttribute?.("disabled"); } catch {}
        try { target.disabled = false; } catch {}
        target.click();
        return keyword;
      }
      return "";
    });
    if (clicked) {
      console.error(`${logPrefix} Clicked auth button via evaluate: ${clicked}`);
      return true;
    }
  } catch (error) {
    logSilent("ui.action", error);
  }

  return false;
}

async function detectSellerPopupStage(popup) {
  try {
    return await popup.evaluate(() => {
      const rawText = document.body?.innerText || "";
      const text = rawText.replace(/\s+/g, "");

      const isVisible = (node) => {
        if (!node) return false;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };

      // ★ 先检测登录输入框 — 如果页面有手机号/密码输入框，说明需要填写凭证
      //   即使页面同时包含"授权登录"按钮或授权文案，也应该优先判定为 login
      //   （Temu 登录页会同时显示授权文案 + 登录表单）
      const loginSelectors = [
        '#usernameId',
        'input[name="usernameId"]',
        'input[name="phone"]',
        'input[autocomplete="username"]',
        'input[type="tel"]',
        'input[inputmode="numeric"]',
        'input[placeholder*="手机号"]',
        'input[placeholder*="手机"]',
        'input[placeholder*="号码"]',
        'input[placeholder*="账号"]',
      ];
      const hasPhoneInput = loginSelectors.some((selector) => {
        const node = document.querySelector(selector);
        return isVisible(node);
      });
      const passwordNode = document.querySelector('#passwordId, input[name="password"], input[type="password"]');
      const hasPasswordInput = isVisible(passwordNode);
      const looksLikeLogin = hasPhoneInput || hasPasswordInput || /手机号|密码|账号登录/.test(text);
      if (looksLikeLogin) return "login";

      const hasVisibleAuthButton = [...document.querySelectorAll('button, [role="button"], a, div[class*="btn"], span[class*="btn"]')]
        .some((node) => {
          if (!isVisible(node)) return false;
          const nodeText = (node.textContent || "").replace(/\s+/g, "");
          return /确认授权并前往|确认授权|授权登录|确认并前往|进入/.test(nodeText);
        });
      const hasVisibleAuthCopy = /确认授权|即将前往|SellerCentral|您授权您的账号ID和店铺名称/.test(text);
      if (hasVisibleAuthButton || hasVisibleAuthCopy) return "auth";
      return "unknown";
    });
  } catch (error) {
    logSilent("ui.action", error);
    return "unknown";
  }
}

function isSellerCentralAuthUrl(url = "") {
  const text = String(url || "");
  return text.includes("/main/authentication")
    || text.includes("/main/entry")
    || /agentseller(?:-[a-z]+)?\.temu\.com\/auth\//i.test(text)
    || text.includes("seller-login")
    || text.includes("kuajingmaihuo.com/settle");
}

async function isSellerCentralAuthPage(page) {
  try {
    if (!page || page.isClosed?.()) return false;
    if (isSellerCentralAuthUrl(page.url())) return true;
    return await page.evaluate(() => {
      const text = (document.body?.innerText || "").replace(/\s+/g, "");
      return (
        text.includes("确认授权并前往")
        || text.includes("即将前往SellerCentral")
        || text.includes("即将前往SellerCentral(全球)")
        || text.includes("您授权您的账号ID和店铺名称")
      );
    });
  } catch (error) {
    logSilent("ui.action", error);
    return false;
  }
}

async function triggerSellerCentralAuthEntry(page, logPrefix = "[auth-entry]") {
  if (!page || page.isClosed?.()) return false;
  try {
    const gotoButton = page.locator('[class*="authentication_goto"]').first();
    if (await gotoButton.isVisible({ timeout: 1500 })) {
      await gotoButton.click();
      console.error(`${logPrefix} Clicked authentication_goto`);
      return true;
    }
  } catch (error) {
    logSilent("ui.action", error);
  }

  try {
    const clicked = await page.evaluate(() => {
      const isVis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const tag = (el) => (el.tagName || "").toLowerCase();
      const isHeading = (el) => /^h[1-6]$/.test(tag(el));
      const norm = (s) => String(s || "").replace(/\s+/g, "");
      const ACCEPT = ["商家中心>", "商家中心›", "商家中心", "SellerCentral>", "SellerCentral", "继续前往", "确认授权"];
      // Prefer clickable elements; exclude headings; require text length <= 16 to avoid container blocks
      const all = Array.from(document.querySelectorAll('button, a, [role="button"], div, span'));
      const candidates = all
        .filter((el) => isVis(el) && !isHeading(el))
        .map((el) => ({ el, text: norm(el.textContent || ""), tag: tag(el) }))
        .filter(({ text }) => text && text.length <= 16);
      // Try in order of preference: button/a/role first, then div/span
      const priority = (c) => (["button", "a"].includes(c.tag) || c.el.getAttribute("role") === "button" ? 0 : 1);
      candidates.sort((a, b) => priority(a) - priority(b));
      for (const accept of ACCEPT) {
        const hit = candidates.find((c) => c.text === accept || c.text.startsWith(accept));
        if (hit) {
          // Walk up to find a clickable ancestor (anchor/button) within 3 levels
          let target = hit.el;
          for (let i = 0; i < 3 && target; i += 1) {
            const t = (target.tagName || "").toLowerCase();
            if (t === "a" || t === "button" || target.getAttribute("role") === "button" || target.onclick) break;
            target = target.parentElement;
          }
          (target || hit.el).click();
          return hit.text.slice(0, 30);
        }
      }
      return "";
    });
    if (clicked) {
      console.error(`${logPrefix} Clicked auth entry via evaluate: ${clicked}`);
      return true;
    }
  } catch (error) {
    logSilent("ui.action", error);
  }

  return false;
}

async function handleOpenSellerAuthPages(logPrefix = "[popup-open]") {
  let handled = false;
  const pages = context?.pages?.() || [];
  for (const page of pages) {
    if (!page || page.isClosed?.()) continue;
    const currentUrl = page.url();
    if (!isSellerCentralAuthUrl(currentUrl)) continue;
    if (currentUrl.includes("kuajingmaihuo.com") || currentUrl.includes("seller-login")) {
      await handleSellerAuthPopupPage(page, logPrefix);
      handled = true;
      continue;
    }
    const triggered = await triggerSellerCentralAuthEntry(page, `${logPrefix}-entry`);
    handled = handled || triggered;
    if (triggered) {
      await randomDelay(1200, 2000);
    }
    const followupPages = context?.pages?.() || [];
    for (const followupPage of followupPages) {
      if (!followupPage || followupPage.isClosed?.()) continue;
      const followupUrl = followupPage.url();
      if (!followupUrl.includes("kuajingmaihuo.com") && !followupUrl.includes("seller-login")) continue;
      await handleSellerAuthPopupPage(followupPage, logPrefix);
      handled = true;
    }
    handled = true;
  }
  return handled;
}

async function ensureSellerCentralSessionReady(page, targetPath = "/goods/list", logPrefix = "[session-ready]") {
  let dedicatedLoginAttempted = false;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    if (__fatalLoginError) {
      console.error(`${logPrefix} Aborting due to fatal login error: ${__fatalLoginError}`);
      return false;
    }
    const authPending = await isSellerCentralAuthPage(page);
    const currentUrl = page.url();
    if (!authPending && isSellerCentralWorkspaceUrl(currentUrl)) {
      console.error(`${logPrefix} Ready on attempt ${attempt}: ${page.url()}`);
      return true;
    }

    console.error(`${logPrefix} Session not ready on attempt ${attempt}: authPending=${authPending} url=${currentUrl}`);
    const handledExistingPages = await handleOpenSellerAuthPages(`${logPrefix}-popup`);
    if (handledExistingPages) {
      await randomDelay(1500, 2500);
    }

    const urlAfterPopupPass = page.url();
    const authStillPending = await isSellerCentralAuthPage(page);
    if (!authStillPending && isSellerCentralWorkspaceUrl(urlAfterPopupPass)) {
      console.error(`${logPrefix} Ready after popup handling: ${urlAfterPopupPass}`);
      return true;
    }

    if (!dedicatedLoginAttempted && attempt >= 2) {
      dedicatedLoginAttempted = true;
      console.error(`${logPrefix} Auth still pending after ${attempt} attempts, invoking dedicated seller login fallback`);
      const ok = await ensureDedicatedSellerLogin(`${logPrefix}-dedicated`);
      if (ok && !page.isClosed?.()) {
        try {
          await openSellerCentralTarget(page, targetPath, { lite: false, logPrefix: `${logPrefix}-post-login` });
          await randomDelay(1500, 2500);
          const urlAfterDedicated = page.url();
          if (!await isSellerCentralAuthPage(page) && isSellerCentralWorkspaceUrl(urlAfterDedicated)) {
            console.error(`${logPrefix} Ready after dedicated login: ${urlAfterDedicated}`);
            return true;
          }
        } catch (error) {
          logSilent("ui.action", error);
        }
      }
    }

    if (page.url().includes("/main/authentication") || page.url().includes("/main/entry")) {
      const triggered = await triggerSellerCentralAuthEntry(page, `${logPrefix}-self`);
      if (triggered) {
        await randomDelay(1200, 2000);
        await handleOpenSellerAuthPages(`${logPrefix}-popup-after-entry`);
        await randomDelay(1200, 2000);
      }
    }

    if (await isSellerCentralAuthPage(page)) {
      await openSellerCentralTarget(page, targetPath, { lite: false, logPrefix: `${logPrefix}-goto` });
      await randomDelay(1500, 2500);
    }
  }

  return false;
}

const sellerAuthPopupPagesInFlight = new WeakSet();

async function handleSellerAuthPopupPage(newPage, logPrefix = "[popup-monitor]") {
  if (!newPage) return;
  if (sellerAuthPopupPagesInFlight.has(newPage)) {
    console.error(`${logPrefix} Popup already being handled, skipping duplicate handler`);
    return;
  }
  sellerAuthPopupPagesInFlight.add(newPage);
  try {
    const url = newPage.url();
    console.error(`${logPrefix} New page detected: ${url}`);

    await newPage.waitForLoadState("domcontentloaded").catch(() => {});
    await randomDelay(2000, 4000);

    const currentUrl = newPage.url();
    console.error(`${logPrefix} Page loaded, URL: ${currentUrl}`);

    if (!currentUrl.includes("kuajingmaihuo.com") && !currentUrl.includes("seller-login")) {
      console.error(`${logPrefix} Not an auth popup, ignoring`);
      return;
    }

    // 检测空白弹窗：seller-login 打开后内容完全空白（Temu 偶尔弹出无效的 session 验证页）
    // 先 F5 刷新一次，可能是加载失败；刷新后仍然空白就关掉，避免死循环 10 轮
    const bodyText = await newPage.evaluate(() => (document.body?.innerText || "").trim()).catch(() => "");
    if (bodyText.length < 10) {
      console.error(`${logPrefix} Popup body is blank/near-empty (${bodyText.length} chars), refreshing: ${currentUrl}`);
      await newPage.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      await randomDelay(3000, 5000);
      const bodyAfterRefresh = await newPage.evaluate(() => (document.body?.innerText || "").trim()).catch(() => "");
      if (bodyAfterRefresh.length < 10) {
        console.error(`${logPrefix} Still blank after refresh (${bodyAfterRefresh.length} chars), closing stale popup`);
        await newPage.close().catch(() => {});
        return;
      }
      console.error(`${logPrefix} Content appeared after refresh (${bodyAfterRefresh.length} chars), proceeding with auth flow`);
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      if (__fatalLoginError) {
        console.error(`${logPrefix} Aborting popup login loop due to fatal login error: ${__fatalLoginError}`);
        return;
      }
      try {
        // Re-check URL each iteration — page may have navigated to workspace after auth
        const loopUrl = newPage.isClosed() ? "" : (newPage.url() || "");
        if (newPage.isClosed()) return;
        const isStillAuthUrl = /seller-login|\/settle\/|\/settle$|\/main\/authentication|\/main\/entry/i.test(loopUrl);
        if (!isStillAuthUrl && isSellerCentralWorkspaceUrl(loopUrl)) {
          await saveCookies();
          console.error(`${logPrefix} Page already on workspace: ${loopUrl}`);
          return;
        }
        // Also treat kuajingmaihuo.com/main/* (non-auth paths) as workspace
        if (!isStillAuthUrl && /kuajingmaihuo\.com\/main\//.test(loopUrl) && !/authentication|entry/.test(loopUrl)) {
          await saveCookies();
          console.error(`${logPrefix} Page on kuajingmaihuo workspace: ${loopUrl}`);
          return;
        }

        const popupStage = await detectSellerPopupStage(newPage);
        console.error(`${logPrefix} Popup stage on attempt ${attempt + 1}: ${popupStage} url=${loopUrl.slice(0, 100)}`);

        if (popupStage === "login") {
          const submitted = await tryAutoLoginInPopup(newPage, logPrefix);
          await randomDelay(2000, 3000);

          const nextStage = await detectSellerPopupStage(newPage);
          if (nextStage === "login" && submitted && attempt >= 1) {
            const dedicatedLoginOk = await ensureDedicatedSellerLogin(`${logPrefix}-full`);
            if (dedicatedLoginOk && !newPage.isClosed()) {
              await newPage.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
              await randomDelay(2000, 3000);
            }
          }

          await randomDelay(2000, 3000);
          continue;
        }

        if (popupStage === "unknown") {
          // If page is on a non-auth URL but stage is unknown, auth is likely done
          if (!isStillAuthUrl) {
            await saveCookies();
            console.error(`${logPrefix} Unknown stage but URL is not auth, considering done: ${loopUrl}`);
            return;
          }

          await ensurePopupConsentChecked(newPage, `${logPrefix}-unknown`);
          const authClicked = await clickSellerAuthConfirmButton(newPage, `${logPrefix}-unknown`);
          if (authClicked) {
            await randomDelay(2500, 3500);
            const nextStage = await detectSellerPopupStage(newPage);
            if (nextStage !== "login" && nextStage !== "auth") {
              await saveCookies();
              console.error(`${logPrefix} Unknown popup resolved via auth confirm`);
              return;
            }
          }

          const submitted = await tryAutoLoginInPopup(newPage, `${logPrefix}-unknown`);
          if (submitted) {
            await randomDelay(2500, 3500);
          } else {
            await randomDelay(1500, 2500);
          }
          continue;
        }

        if (popupStage !== "auth") {
          await randomDelay(2000, 3000);
          continue;
        }

        await ensurePopupConsentChecked(newPage, logPrefix);
        await randomDelay(500, 1000);

        const clicked = await clickSellerAuthConfirmButton(newPage, logPrefix);

        if (!clicked) {
          await randomDelay(2000, 3000);
          continue;
        }

        await randomDelay(3000, 5000);
        const nextStage = await detectSellerPopupStage(newPage);
        if (nextStage === "login" || nextStage === "auth") {
          console.error(`${logPrefix} Popup still on ${nextStage} stage after click, retrying`);
          continue;
        }

        await saveCookies();
        console.error(`${logPrefix} Auth popup handled successfully`);
        return;
      } catch (error) {
        if (newPage.isClosed()) return;
        logSilent("ui.action", error);
      }
      await randomDelay(2000, 3000);
    }

    console.error(`${logPrefix} Auth dialog not resolved after 10 attempts`);
  } catch (error) {
    console.error(`${logPrefix} Error handling popup: ${error.message}`);
  } finally {
    sellerAuthPopupPagesInFlight.delete(newPage);
  }
}

function registerSellerAuthPopupMonitor(logPrefix = "[popup-monitor]") {
  const targetContext = context || browserState.context;
  if (!targetContext) {
    console.error(`${logPrefix} Monitor skipped: browser context not ready`);
    return () => {};
  }

  let active = true;
  const handler = async (newPage) => {
    if (!active) return;
    await handleSellerAuthPopupPage(newPage, logPrefix);
  };

  targetContext.on("page", handler);
  console.error(`${logPrefix} Monitor registered`);

  for (const page of targetContext.pages()) {
    if (!page || page.isClosed?.()) continue;
    handler(page).catch((error) => console.error(`${logPrefix} Existing page scan failed: ${error.message}`));
  }

  return () => {
    active = false;
    try {
      targetContext.removeListener("page", handler);
    } catch (error) {
      console.error(`${logPrefix} cleanup error: ${error.message}`);
    }
    console.error(`${logPrefix} Monitor removed`);
  };
}

async function establishSellerCentralSession(logPrefix = "[session]") {
  const warmupPage = await createSellerCentralPage("/goods/list", {
    attempts: 2,
    lite: false,
    readyDelayMin: 2000,
    readyDelayMax: 3000,
    logPrefix,
  });
  try {
    const ready = await ensureSellerCentralSessionReady(warmupPage, "/goods/list", logPrefix);
    if (!ready) {
      throw new Error("Seller Central 授权未完成");
    }
    await dismissCommonDialogs(warmupPage);
    await saveCookies();
    console.error(`${logPrefix} Session established, URL: ${warmupPage.url()}`);
  } finally {
    await warmupPage.close().catch(() => {});
  }
}

async function withWorkerRequestCredentials(credentials, fn) {
  const prevPhone = requestCredentialPhone;
  const prevPassword = requestCredentialPassword;
  const requestedAccountId = normalizeRequestCredential(credentials?.accountId);
  const nextPhone = sanitizeLoginPhone(normalizeRequestCredential(credentials?.phone));
  const nextPassword = normalizeRequestCredential(credentials?.password);
  const shouldSwitchAccount = requestedAccountId && requestedAccountId !== browserState.lastAccountId;
  const shouldResetStickyAccount = requestedAccountId && stickyCredentialAccountId && stickyCredentialAccountId !== requestedAccountId;

  if (shouldSwitchAccount || shouldResetStickyAccount) {
    console.error(`[worker-credentials] Switching browser account: ${browserState.lastAccountId || "none"} -> ${requestedAccountId}`);
    clearStickyWorkerCredentials();
  }

  if (shouldSwitchAccount) {
    try {
      await closeBrowser();
    } catch (error) {
      logSilent("worker.credentials.close", error);
    }
    browserState.lastAccountId = requestedAccountId;
    syncBrowserState();
  } else if (requestedAccountId && !browserState.lastAccountId) {
    browserState.lastAccountId = requestedAccountId;
  }

  if (nextPhone && !isPlaceholderLoginPhone(nextPhone)) {
    requestCredentialPhone = nextPhone;
    requestCredentialPassword = nextPassword;
    stickyCredentialPhone = nextPhone;
    if (nextPassword) {
      stickyCredentialPassword = nextPassword;
    }
    if (requestedAccountId) {
      stickyCredentialAccountId = requestedAccountId;
    }
    browserState.lastPhone = nextPhone;
  } else if (nextPhone && isPlaceholderLoginPhone(nextPhone)) {
    requestCredentialPhone = "";
    requestCredentialPassword = nextPassword;
    if (isPlaceholderLoginPhone(browserState.lastPhone)) {
      browserState.lastPhone = "";
    }
  }
  clearBrowserPassword();
  try {
    return await fn();
  } finally {
    requestCredentialPhone = prevPhone;
    requestCredentialPassword = prevPassword;
    if (!requestCredentialPhone && isPlaceholderLoginPhone(browserState.lastPhone)) {
      browserState.lastPhone = "";
    }
    clearBrowserPassword();
  }
}

async function loginWithTransientPassword(phone, password) {
  try {
    return await login(phone, password);
  } finally {
    clearBrowserPassword();
  }
}

function isClosedTargetError(message = "") {
  const text = String(message || "");
  return /Target page, context or browser has been closed|Browser has been closed|Cannot find context with specified id|Execution context was destroyed/i.test(text);
}

async function recoverWorkerBrowserSession(reason = "") {
  const suffix = reason ? `: ${String(reason).slice(0, 160)}` : "";
  console.error(`[browser-recover] Resetting worker browser session${suffix}`);

  try {
    await closeBrowser();
  } catch (error) {
    logSilent("browser.recover.close", error);
  }

  syncBrowserState();
  await ensureBrowser();
}

async function createSellerCentralPage(targetPath = "/goods/list", options = {}) {
  const {
    attempts = 2,
    lite = false,
    readyDelayMin = 0,
    readyDelayMax = 0,
    logPrefix = "[page-create]",
  } = options;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let page = null;
    try {
      await ensureBrowser();
      page = await safeNewPage(context);
      await openSellerCentralTarget(page, targetPath, { lite, logPrefix: `${logPrefix}-open` });
      const ready = await ensureSellerCentralSessionReady(page, targetPath, `${logPrefix}-ready`);
      if (!ready) {
        throw new Error(`Seller Central 授权未完成: ${targetPath}`);
      }
      if (readyDelayMax > 0) {
        await randomDelay(readyDelayMin, Math.max(readyDelayMin, readyDelayMax));
      }
      return page;
    } catch (error) {
      lastError = error;
      await page?.close?.().catch(() => {});
      console.error(`${logPrefix} Attempt ${attempt}/${attempts} failed: ${error?.message || error}`);

      const shouldRetry = attempt < attempts && (
        isClosedTargetError(error?.message)
        || isMaterialUploadRecoverableError(error?.message)
        || isMaterialUploadNavigationTimeoutError(error?.message)
      );
      if (!shouldRetry) {
        throw error;
      }

      await recoverWorkerBrowserSession(`${logPrefix} attempt ${attempt}`);
    }
  }

  throw lastError || new Error("创建商家中心页面失败");
}

// 同步 browserState 到局部变量（ensureBrowser/launch 后自动调用）
function syncBrowserState() {
  browser = browserState.browser;
  context = browserState.context;
  cookiePath = browserState.cookiePath;
  lastAccountId = browserState.lastAccountId;
  _navLiteMode = browserState.navLiteMode;
}
async function ensureBrowser() { await _ensureBrowser(); syncBrowserState(); }
async function launch(accountId, headless) { await _launch(accountId, headless); syncBrowserState(); }

// randomDelay, findChromeExe → moved to utils.mjs / browser.mjs

// 浏览器管理函数 → moved to browser.mjs
// 通过 browserState 访问 browser/context（兼容旧代码引用）

// login → moved to browser.mjs
const TEMU_BASE_URL = "https://seller.kuajingmaihuo.com";

// ---- 导航辅助：从商家中心进入 Seller Central ----

// 返回实际使用的 page（可能因 popup 切换到新窗口）
async function navigateToSellerCentral(page, targetPath, options = {}) {
  if (typeof targetPath === "string" && targetPath.includes("/goods/create/category")) {
    console.error("[NAV-TRAP] /goods/create/category called! Stack:");
    console.error(new Error("nav-trap").stack);
  }

  const resolvedTargetPath = targetPath || "/goods/list";
  const lite = Boolean(options.lite || _navLiteMode);
  const logPrefix = options.logPrefix || "[nav]";
  const directUrl = /^https?:\/\//i.test(String(resolvedTargetPath || ""))
    ? String(resolvedTargetPath)
    : buildSellerCentralUrl(resolvedTargetPath);
  const directUrlWithoutQuery = directUrl.split("?")[0];

  let activePage = page;
  console.error(`${logPrefix} Navigating to ${directUrl} (lite=${lite})`);

  await openSellerCentralTarget(activePage, resolvedTargetPath, {
    lite,
    logPrefix: `${logPrefix}-open`,
  });

  let ready = await ensureSellerCentralSessionReady(activePage, resolvedTargetPath, `${logPrefix}-session`);
  activePage = getLatestWorkerPage(activePage) || activePage;

  const shouldReopenTarget = (currentUrl = "") => {
    if (!currentUrl) return true;
    if (isSellerCentralAuthUrl(currentUrl)) return true;
    if (!isSellerCentralWorkspaceUrl(currentUrl)) return true;
    if (/^https?:\/\//i.test(String(resolvedTargetPath || ""))) {
      return !currentUrl.startsWith(directUrlWithoutQuery);
    }
    return !currentUrl.includes(String(resolvedTargetPath));
  };

  if (ready && shouldReopenTarget(activePage?.url?.() || "")) {
    console.error(`${logPrefix} Reopening exact target after session warmup: ${activePage?.url?.() || ""}`);
    await openSellerCentralTarget(activePage, resolvedTargetPath, {
      lite,
      logPrefix: `${logPrefix}-reopen`,
    });
    ready = await ensureSellerCentralSessionReady(activePage, resolvedTargetPath, `${logPrefix}-recheck`);
    activePage = getLatestWorkerPage(activePage) || activePage;
  }

  if (!ready) {
    const failedPage = getLatestWorkerPage(activePage) || activePage;
    const failedUrl = failedPage?.url?.() || "";
    await captureWorkerErrorScreenshot("seller_central_nav_failed", failedPage);
    if (__fatalLoginError) {
      throw new Error(__fatalLoginError);
    }
    throw new Error(`登录超时，仍停留在 ${failedUrl || directUrl}`);
  }

  await handleOpenSellerAuthPages(`${logPrefix}-final-popup`).catch((error) => logSilent("ui.action", error));
  activePage = getLatestWorkerPage(activePage) || activePage;
  await dismissCommonDialogs(activePage, ["查看详情"]).catch((error) => logSilent("ui.action", error));
  await randomDelay(lite ? 200 : 500, lite ? 400 : 1000);

  console.error(`${logPrefix} Final URL: ${activePage?.url?.() || ""}`);
  return activePage;
}

// 核心采集函数已移到 scrape-registry.mjs（配置驱动）

// ---- 全球业务表现：按国家聚合订单数（替代第三方插件） ----
// 数据源：Temu 卖家中心 调价/订单 内部接口（agentseller.temu.com）
// 100% 本地，零云端中转，凭证只在本地 Playwright 上下文中使用
const GLOBAL_PERF_COUNTRY_CN = {
  DE: "德国", PL: "波兰", SE: "瑞典", NL: "荷兰", RO: "罗马尼亚",
  FR: "法国", IT: "意大利", ES: "西班牙", GB: "英国", UK: "英国",
  IE: "爱尔兰", PT: "葡萄牙", AT: "奥地利", BE: "比利时", FI: "芬兰",
  DK: "丹麦", CZ: "捷克", HU: "匈牙利", GR: "希腊", BG: "保加利亚",
  HR: "克罗地亚", SK: "斯洛伐克", SI: "斯洛文尼亚", LT: "立陶宛", LV: "拉脱维亚",
  EE: "爱沙尼亚", LU: "卢森堡", MT: "马耳他", CY: "塞浦路斯",
  US: "美国", CA: "加拿大", MX: "墨西哥", BR: "巴西", CL: "智利", PE: "秘鲁",
  JP: "日本", KR: "韩国", TW: "台湾", HK: "香港", SG: "新加坡", MY: "马来西亚",
  TH: "泰国", PH: "菲律宾", ID: "印度尼西亚", VN: "越南", IN: "印度",
  AU: "澳大利亚", NZ: "新西兰",
  SA: "沙特阿拉伯", AE: "阿联酋", IL: "以色列", TR: "土耳其", QA: "卡塔尔", KW: "科威特", BH: "巴林", OM: "阿曼",
  ZA: "南非", EG: "埃及", NG: "尼日利亚", MA: "摩洛哥",
};
const GLOBAL_PERF_REGION_OF = {
  DE: "europe", PL: "europe", SE: "europe", NL: "europe", RO: "europe",
  FR: "europe", IT: "europe", ES: "europe", GB: "europe", UK: "europe", IE: "europe",
  PT: "europe", AT: "europe", BE: "europe", FI: "europe", DK: "europe", CZ: "europe",
  HU: "europe", GR: "europe", BG: "europe", HR: "europe", SK: "europe", SI: "europe",
  LT: "europe", LV: "europe", EE: "europe", LU: "europe", MT: "europe", CY: "europe",
  US: "americas", CA: "americas", MX: "americas", BR: "americas", CL: "americas", PE: "americas",
  JP: "apac", KR: "apac", TW: "apac", HK: "apac", SG: "apac", MY: "apac",
  TH: "apac", PH: "apac", ID: "apac", VN: "apac", IN: "apac",
  AU: "oceania", NZ: "oceania",
  SA: "mea", AE: "mea", IL: "mea", TR: "mea", QA: "mea", KW: "mea", BH: "mea", OM: "mea",
  ZA: "africa", EG: "africa", NG: "africa", MA: "africa",
};

function _gpRangeToMs(range) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  switch (String(range)) {
    case "1d": return { start: now - day, end: now, days: 1 };
    case "7d": return { start: now - 7 * day, end: now, days: 7 };
    case "30d":
    default:   return { start: now - 30 * day, end: now, days: 30 };
  }
}

function _gpExtractCountryFromOrder(order) {
  if (!order || typeof order !== "object") return null;
  const candidates = [
    order.countryCode, order.country_code, order.regionCode, order.region_code,
    order.shippingAddressCountry, order.shippingCountry,
    order.shippingAddress?.countryCode, order.shippingAddress?.country,
    order.address?.countryCode, order.address?.country,
    order.consigneeAddress?.countryCode, order.buyerAddress?.countryCode,
    order.region?.code, order.site?.regionCode, order.siteCode,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length >= 2 && c.length <= 4) {
      return c.toUpperCase();
    }
  }
  return null;
}

// 递归在任意 JSON 树里找出所有可能是订单的对象（包含国家字段的）
function _gpHarvestOrders(node, sink, depth = 0) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    for (const item of node) _gpHarvestOrders(item, sink, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const code = _gpExtractCountryFromOrder(node);
  if (code) sink.push(code);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && (typeof v === "object")) _gpHarvestOrders(v, sink, depth + 1);
  }
}

async function scrapeGlobalPerformance({ range = "30d" } = {}) {
  await ensureBrowser();
  const { start, end, days } = _gpRangeToMs(range);
  const startedAt = new Date().toISOString();

  // 江洋插件 getDomainForPath 揭示：/mms/venom/、/mms/tmod_punish/、/scp/、/visage-agent-seller/
  // 必须打到 agentseller.temu.com（而非 kuajingmaihuo），且 header 用 mallId
  await ensureBrowser();
  const page = await createSellerCentralPage("/main/data-center", { logPrefix: "[global-perf]" }).catch(async (e) => {
    console.error(`[global-perf] createSellerCentralPage fail: ${e.message}, fallback newPage`);
    const p = await safeNewPage(context);
    try { await p.goto("https://agentseller.temu.com/main/data-center", { waitUntil: "domcontentloaded", timeout: 60000 }); } catch {}
    return p;
  });
  await page.waitForTimeout(2000);

  const byCountry = new Map();
  const seenEndpoints = new Map(); // path -> hits
  let usedEndpoint = "";
  let lastError = "";
  let pagesFetched = 0;
  let totalOrders = 0;
  // Plan A 数据收集：SKC销售 / 活动商品 / 库存
  const skcSales = [];        // [{ skcId, productName, image, category, sales, changeRate, trend:[{day,quantity}] }]
  const activityGoods = [];   // [{ goodsId, name, image, amount, currency, sales, visitors, clickRate, payRate }]
  let warehouseTotal = 0;
  let warehouseSampleStock = 0;

  const seenAllPaths = new Map(); // 调试用：所有看到的 JSON 端点
  const dumpedPaths = new Set();
  const onResponse = async (resp) => {
    try {
      const url = resp.url();
      if (!/agentseller\.temu\.com|kuajingmaihuo\.com/.test(url)) return;
      const ct = resp.headers()["content-type"] || "";
      if (!ct.includes("json")) return;
      const u = new URL(url);
      const pname = u.pathname;
      if (/\.(js|css|png|jpg|svg|woff)/.test(pname)) return;
      seenAllPaths.set(pname, (seenAllPaths.get(pname) || 0) + 1);
      const json = await resp.json().catch(() => null);
      if (!json) return;
      // dump 多个候选端点的原始响应（跳过已 dump 的 / 跳过 bidding）
      if (!dumpedPaths.has(pname) && /price-adjust|orderList|order-list|order\/list|aurora|govern|magneto|dashboard|analysis|data-center|region|country|site|finance|income|business/i.test(pname) && !/bidding|\.png|\.svg|hot-update/i.test(pname)) {
        try {
          const dumpDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
          fs.mkdirSync(dumpDir, { recursive: true });
          const safeName = pname.replace(/[^a-z0-9]/gi, "_").slice(0, 80);
          fs.writeFileSync(path.join(dumpDir, `gp_${safeName}.json`), JSON.stringify({ url, json }, null, 2));
          dumpedPaths.add(pname);
          console.error(`[global-perf] DUMPED ${pname}`);
        } catch (e) { console.error(`[global-perf] dump fail: ${e.message}`); }
      }
      const sink = [];
      _gpHarvestOrders(json.result || json.data || json, sink);
      if (sink.length === 0) return;
      console.error(`[global-perf] HIT ${pname} +${sink.length}`);
      seenEndpoints.set(pname, (seenEndpoints.get(pname) || 0) + sink.length);
      for (const code of sink) {
        byCountry.set(code, (byCountry.get(code) || 0) + 1);
        totalOrders += 1;
      }
      pagesFetched += 1;
    } catch { /* ignore */ }
  };
  page.on("response", onResponse);

  // 先访问 seller.kuajingmaihuo.com 触发该域 cookie 同步（/mms/venom/ 需要 kuajingmaihuo 会话）
  try {
    const kjmhPage = await safeNewPage(context);
    console.error("[global-perf] warming kuajingmaihuo session...");
    await kjmhPage.goto("https://seller.kuajingmaihuo.com/main/authentication", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await kjmhPage.waitForTimeout(2000);
    // 如果落到 seller-login，尝试自动登录
    if (/seller-login|kuajingmaihuo/.test(kjmhPage.url())) {
      const stage = await detectSellerPopupStage(kjmhPage).catch(() => "unknown");
      if (stage === "login") {
        await tryAutoLoginInPopup(kjmhPage, "[global-perf-warm]").catch(() => {});
        await kjmhPage.waitForTimeout(3000);
      }
    }
    console.error(`[global-perf] kuajingmaihuo warm URL=${kjmhPage.url()}`);
    await kjmhPage.close().catch(() => {});
  } catch (e) {
    console.error(`[global-perf] kuajingmaihuo warm fail: ${e.message}`);
  }

  // === 拦截 /mms/venom/ 请求重写 Origin/Referer（江洋插件 rules.json 关键bypass）===
  try {
    await page.route(/agentseller(-[a-z]+)?\.temu\.com\/(mms\/venom|api\/sale|bg-brando-mms|api\/activity)\//, async (route) => {
      const req = route.request();
      try {
        const u = new URL(req.url());
        const headers = { ...req.headers(),
          origin: u.origin,
          referer: u.origin + "/",
        };
        await route.continue({ headers });
      } catch { await route.continue(); }
    });
    console.error("[global-perf] route interceptor installed for /mms/venom/");
  } catch (e) { console.error(`[global-perf] route install fail: ${e.message}`); }

  // === 直接 XHR 调用 supplier sales 接口（来自江洋插件反编译）===
  try {
    const _gpStart = new Date(Date.now()-Math.min(days,7)*86400000).toISOString().slice(0,10);
    const _gpEnd = new Date().toISOString().slice(0,10);
    const directEndpoints = [
      { path: "/mms/venom/api/supplier/sales/management/listWarehouse", body: { pageNo: 1, pageSize: 100 } },
      // SKC 销售数据中心（regionId 服务端忽略，单次足矣）
      { path: "/bg-brando-mms/supplier/data/center/skc/sales/data",
        body: { page: 1, pageSize: 50, regionId: -1, startDate: _gpStart, endDate: _gpEnd } },
      { path: "/bg-brando-mms/supplier/data/center/skc/sales/data",
        body: { page: 2, pageSize: 50, regionId: -1, startDate: _gpStart, endDate: _gpEnd } },
      // 活动商品明细
      { path: "/api/activity/data/goods/detail", body: { pageNumber: 1, pageSize: 50, statStartDate: new Date(Date.now()-days*86400000).toISOString().slice(0,10), statEndDate: _gpEnd } },
      { path: "/api/activity/data/goods/detail", body: { pageNumber: 2, pageSize: 50, statStartDate: new Date(Date.now()-days*86400000).toISOString().slice(0,10), statEndDate: _gpEnd } },
    ];
    // === 多区域子域聚合：US / EU / 全局 各调一次 sale/analysis/total ===
    const regions = [
      { code: "GLOBAL", host: "https://agentseller.temu.com" },
      { code: "US",     host: "https://agentseller-us.temu.com" },
      { code: "EU",     host: "https://agentseller-eu.temu.com" },
    ];
    const regionResults = {};
    for (const reg of regions) {
      try {
        const r = await page.evaluate(async ({ host, code }) => {
          const mallId = (document.cookie.match(/mallid=([^;]+)/i)?.[1]) || "";
          const out = {};
          for (const path of ["/api/sale/analysis/total", "/mms/venom/api/supplier/sales/management/listOverall"]) {
            try {
              const resp = await fetch(host + path, {
                method: "POST",
                headers: { "Content-Type": "application/json", "mallId": mallId },
                credentials: "include",
                body: JSON.stringify({ pageNo: 1, pageSize: 50 }),
              });
              const text = await resp.text();
              try { out[path] = { status: resp.status, body: JSON.parse(text) }; }
              catch { out[path] = { status: resp.status, text: text.slice(0, 300) }; }
            } catch (e) { out[path] = { error: e.message }; }
          }
          return { code, mallId, out };
        }, reg);
        regionResults[reg.code] = r;
        console.error(`[global-perf] region ${reg.code} fetched`);
      } catch (e) {
        console.error(`[global-perf] region ${reg.code} fail: ${e.message}`);
      }
    }
    try {
      const dumpDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
      fs.mkdirSync(dumpDir, { recursive: true });
      fs.writeFileSync(path.join(dumpDir, "gp_regions.json"), JSON.stringify(regionResults, null, 2));
      console.error("[global-perf] gp_regions.json dumped");
    } catch {}

    for (const ep of directEndpoints) {
      console.error(`[global-perf] direct XHR ${ep.path}`);
      // 直接在页面上下文 fetch 绝对URL，header 用 mallId 大写（江洋插件用法）
      const r = await page.evaluate(async ({ ep }) => {
        const mallId = (document.cookie.match(/mallid=([^;]+)/i)?.[1]) || "";
        try {
          const resp = await fetch("https://agentseller.temu.com" + ep.path, {
            method: "POST",
            headers: { "Content-Type": "application/json", "mallId": mallId },
            credentials: "include",
            body: JSON.stringify(ep.body),
          });
          const text = await resp.text();
          let body = null;
          try { body = JSON.parse(text); } catch {}
          return { status: resp.status, body, text: body ? null : text.slice(0, 500), mallId };
        } catch (e) {
          return { error: e.message };
        }
      }, { ep }).then((raw) => {
        if (raw.body && (raw.body.success || raw.body.error_code === 1000000)) {
          return { success: true, data: raw.body.result, raw: raw.body };
        }
        return { success: false, raw: raw.body || raw, status: raw.status, mallId: raw.mallId };
      });
      try {
        const dumpDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
        fs.mkdirSync(dumpDir, { recursive: true });
        const safe = (ep.path + "_" + Object.keys(ep.body).join("-") + "_r" + (ep.body.regionId ?? "x")).replace(/[^a-z0-9]/gi, "_").slice(0, 110);
        fs.writeFileSync(path.join(dumpDir, `gp_kjmh_${safe}.json`), JSON.stringify({ endpoint: ep, result: r }, null, 2));
        console.error(`[global-perf] direct DUMPED ${ep.path} success=${r.success}`);
        if (r.success && r.data) {
          // SKC 销售数据
          if (ep.path.includes("/skc/sales/data")) {
            const list = r.data.salesDataVOList || [];
            for (const item of list) {
              const info = item.productSkcBasicInfoVO || {};
              skcSales.push({
                skcId: item.productSkcId || info.productSkcId,
                productId: info.productId || null,
                productName: info.productName || "",
                image: info.productSkcPicture || "",
                category: info.category || "",
                sales: item.confirmGoodsQuantity || 0,
                changeRate: item.changeRate || 0,
                trend: (item.confirmTrendList || []).map((t) => ({ day: t.day, quantity: t.quantity || 0 })),
              });
              totalOrders += item.confirmGoodsQuantity || 0;
            }
            if (list.length) usedEndpoint = ep.path;
          }
          // 活动商品
          else if (ep.path.includes("/activity/data/goods/detail")) {
            const list = r.data.list || [];
            for (const g of list) {
              activityGoods.push({
                goodsId: g.goodsId,
                name: g.goodsName || "",
                image: g.goodsImageUrl || "",
                amount: Number(g.activityTransactionAmount || 0),
                currency: g.currency || "USD",
                sales: g.activitySales || 0,
                visitors: g.totalVisitorsNum || 0,
                clickRate: Number(g.visitorsClickConversionRate || 0),
                payRate: Number(g.visitorsPayConversionRate || 0),
              });
            }
          }
          // 库存
          else if (ep.path.includes("listWarehouse")) {
            const list = r.data.subOrderList || r.data.list || r.data.dataList || [];
            warehouseTotal = r.data.total || list.length;
            for (const w of list) {
              warehouseSampleStock += Number(w.totalStock || w.stock || w.warehouseStock || 0);
            }
          }
        }
      } catch (e) { console.error(`[global-perf] direct dump fail: ${e.message}`); }
    }
  } catch (e) {
    console.error(`[global-perf] direct XHR phase failed: ${e.message}`);
  }

  // 候选数据中心 / 经营分析路径，逐个 goto 让 sniffer 抓带 country 维度的接口
  const candidatePaths = [
    "/main/data-center",
    "/main/goods-analysis",
    "/main/activity-analysis",
    "/main/flux-analysis",
    "/main/business-analysis",
    "/main/finance/income-detail",
    "/govern/dashboard",
    "/main/order/list",
  ];

  try {
    if (skcSales.length > 0) {
      console.error(`[global-perf] skipping candidate paths sniff, already have ${skcSales.length} SKC rows`);
    } else
    for (const p of candidatePaths) {
      const url = `https://agentseller.temu.com${p}`;
      console.error(`[global-perf] goto ${url}`);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      } catch (e) {
        console.error(`[global-perf] goto warn: ${e.message}`);
      }
      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(6000); // 给 SPA 充分时间发起业务接口
      // 若被弹回授权选择页，自动点击「商家中心」继续
      for (let r = 0; r < 8; r += 1) {
        const cur = page.url();
        if (!/\/main\/authentication/.test(cur)) break;
        console.error(`[global-perf] auth bounce ${r + 1} url=${cur}`);
        const ok = await triggerSellerCentralAuthEntry(page, "[global-perf-auth]").catch(() => false);
        await page.waitForTimeout(2500);
        // 处理弹出的卖家中心登录窗口（自动填手机号/密码并提交）
        await handleOpenSellerAuthPages("[global-perf-popup]").catch(() => {});
        await page.waitForTimeout(2000);
        if (!ok) {
          // 兜底：直接 evaluate 点击任何"商家中心"链接
          await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('a, button, [role="button"], div, span'));
            for (const el of els) {
              const t = (el.textContent || "").replace(/\s+/g, "");
              if (t === "商家中心>" || t === "商家中心›" || t === "商家中心") {
                let tgt = el;
                for (let i = 0; i < 4 && tgt; i++) {
                  if (tgt.tagName === "A" || tgt.tagName === "BUTTON") break;
                  tgt = tgt.parentElement;
                }
                (tgt || el).click();
                return true;
              }
            }
            return false;
          }).catch(() => {});
          await page.waitForTimeout(2000);
        }
      }
      if (/\/main\/authentication/.test(page.url())) {
        console.error(`[global-perf] STILL on auth page after retries, skipping`);
        continue;
      }
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(4000);
      // 翻几页
      for (let i = 0; i < 4; i += 1) {
        const next = await page.$('li.ant-pagination-next:not(.ant-pagination-disabled) button, button[aria-label="下一页"]:not([disabled])').catch(() => null);
        if (!next) break;
        await next.click().catch(() => {});
        await page.waitForTimeout(2000);
      }
      if (totalOrders > 0) break;
    }

    if (totalOrders === 0) {
      const top = Array.from(seenAllPaths.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30);
      console.error(`[global-perf] NO HIT. Saw ${seenAllPaths.size} JSON endpoints. Top:`);
      for (const [p, n] of top) console.error(`  ${n}x ${p}`);
      lastError = `未在订单页捕获到带国家字段的响应（共看到 ${seenAllPaths.size} 个 JSON 端点，详见 worker 日志）`;
    } else {
      // 取命中最多的端点作为数据源
      usedEndpoint = Array.from(seenEndpoints.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    }
  } catch (e) {
    lastError = e?.message || String(e);
  } finally {
    page.off("response", onResponse);
    await page.close().catch(() => {});
  }

  const ranking = Array.from(byCountry.entries())
    .map(([code, count]) => ({
      code,
      name: GLOBAL_PERF_COUNTRY_CN[code] || code,
      region: GLOBAL_PERF_REGION_OF[code] || "other",
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const byRegion = ranking.reduce((acc, row) => {
    acc[row.region] = (acc[row.region] || 0) + row.count;
    return acc;
  }, {});

  // 去重 SKC（按 skcId）
  const skcDedup = Array.from(new Map(skcSales.map((s) => [s.skcId, s])).values())
    .sort((a, b) => b.sales - a.sales);
  const actDedup = Array.from(new Map(activityGoods.map((g) => [g.goodsId, g])).values())
    .sort((a, b) => b.amount - a.amount);

  // 全店趋势（聚合所有 SKC 的 trend）
  const trendMap = new Map();
  for (const s of skcDedup) {
    for (const t of s.trend || []) {
      trendMap.set(t.day, (trendMap.get(t.day) || 0) + (t.quantity || 0));
    }
  }
  const overallTrend = Array.from(trendMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, quantity]) => ({ day, quantity }));

  // === 预采集所有 SKC 的地区销量明细（一键采集时一次跑完，避免点击时再开页面）===
  const regionDetails = {}; // productId -> { rows, grouped, total }
  const skcWithPid = skcDedup.filter((s) => s.productId);
  console.error(`[global-perf] Pre-fetching region details for ${skcWithPid.length} SKCs...`);
  const _rdStart = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const _rdEnd = new Date().toISOString().slice(0, 10);
  const fetchOneRegionDetail = async (pid) => {
    const merged = [];
    const batches = [YUNDU_ALL_REGION_IDS.slice(0, 50), YUNDU_ALL_REGION_IDS.slice(50)];
    for (const regionIdList of batches) {
      try {
        const r = await page.evaluate(async ({ pid, regionIdList, startDate, endDate }) => {
          const mallid = (document.cookie.match(/mallid=([^;]+)/i)?.[1]) || "";
          const resp = await fetch("https://agentseller.temu.com/bg-brando-mms/supplier/data/center/skc/sales/data", {
            method: "POST",
            headers: { "Content-Type": "application/json", "mallid": mallid },
            credentials: "include",
            body: JSON.stringify({ productIdList: [Number(pid)], regionIdList, select: "confirmGoodsQuantity", startDate, endDate, page: 1, pageSize: 100 }),
          });
          try { return await resp.json(); } catch { return null; }
        }, { pid, regionIdList, startDate: _rdStart, endDate: _rdEnd });
        const list = r?.result?.salesDataVOList || [];
        for (const it of list) merged.push(it);
      } catch {}
    }
    const byRegion = new Map();
    for (const it of merged) {
      if (!it.regionId || it.regionId < 0) continue;
      const prev = byRegion.get(it.regionId) || { regionId: it.regionId, regionName: it.regionName, sales: 0 };
      prev.sales += Number(it.confirmGoodsQuantity || 0);
      byRegion.set(it.regionId, prev);
    }
    const rows = Array.from(byRegion.values()).filter((r) => r.sales > 0)
      .map((r) => ({ ...r, continent: YUNDU_REGION_CONTINENT[r.regionId] || "其他" }))
      .sort((a, b) => b.sales - a.sales);
    const grouped = { 欧洲: [], 亚洲: [], 美洲: [], 非洲: [], 大洋洲: [], 其他: [] };
    for (const r of rows) grouped[r.continent].push(r);
    return { productId: pid, rows, grouped, total: rows.reduce((s, x) => s + x.sales, 0) };
  };
  // 串行（同一 page，避免并发冲突）
  for (let i = 0; i < skcWithPid.length; i++) {
    const s = skcWithPid[i];
    try {
      const detail = await fetchOneRegionDetail(s.productId);
      regionDetails[String(s.productId)] = detail;
      if (i % 10 === 0) console.error(`[global-perf] region detail ${i + 1}/${skcWithPid.length}`);
    } catch (e) {
      console.error(`[global-perf] region detail fail pid=${s.productId}: ${e.message}`);
    }
  }
  console.error(`[global-perf] Region details done: ${Object.keys(regionDetails).length} entries`);

  const totalSkcSales = skcDedup.reduce((s, x) => s + (x.sales || 0), 0);
  const totalActivityAmount = actDedup.reduce((s, x) => s + (x.amount || 0), 0);
  const avgClickRate = actDedup.length
    ? actDedup.reduce((s, x) => s + x.clickRate, 0) / actDedup.length : 0;
  const avgPayRate = actDedup.length
    ? actDedup.reduce((s, x) => s + x.payRate, 0) / actDedup.length : 0;

  return {
    range,
    days,
    startedAt,
    finishedAt: new Date().toISOString(),
    periodStart: new Date(start).toISOString(),
    periodEnd: new Date(end).toISOString(),
    usedEndpoint: usedEndpoint || "/bg-brando-mms/supplier/data/center/skc/sales/data",
    // Plan A 数据
    skcCount: skcDedup.length,
    totalSkcSales,
    overallTrend,
    skcSales: skcDedup,
    regionDetails,
    activityGoods: actDedup,
    activityCount: actDedup.length,
    totalActivityAmount,
    avgClickRate,
    avgPayRate,
    warehouseTotal,
    warehouseSampleStock,
    // 兼容旧字段
    pagesFetched,
    totalOrders: totalSkcSales,
    ranking: [],
    byRegion: {},
    error: skcDedup.length === 0 ? (lastError || "未采集到 SKC 销售数据（请确认 Temu 已登录）") : "",
  };
}

// ---- 云舵 region map (从 detailed-sales-query.js 反编译提取) ----
const YUNDU_ALL_REGION_IDS = [3,4,5,9,10,12,13,14,16,20,26,29,31,32,37,42,45,49,50,52,53,54,57,59,61,64,68,69,75,76,77,83,84,89,90,91,96,97,98,100,101,102,105,106,108,112,113,114,116,119,120,122,128,130,132,134,135,141,144,147,151,152,153,156,158,159,160,162,163,164,165,167,174,175,180,181,184,185,186,191,192,197,201,203,208,209,210,211,212,213,217,219,236];
const YUNDU_REGION_CONTINENT = {3:"欧洲",5:"欧洲",13:"欧洲",20:"欧洲",26:"欧洲",32:"欧洲",50:"欧洲",52:"欧洲",53:"欧洲",54:"欧洲",64:"欧洲",68:"欧洲",69:"欧洲",76:"欧洲",90:"欧洲",91:"欧洲",96:"欧洲",98:"欧洲",108:"欧洲",112:"欧洲",113:"欧洲",114:"欧洲",116:"欧洲",122:"欧洲",130:"欧洲",134:"欧洲",141:"欧洲",151:"欧洲",162:"欧洲",163:"欧洲",167:"欧洲",175:"欧洲",180:"欧洲",181:"欧洲",186:"欧洲",191:"欧洲",192:"欧洲",208:"欧洲",210:"欧洲",10:"亚洲",14:"亚洲",16:"亚洲",31:"亚洲",75:"亚洲",97:"亚洲",100:"亚洲",101:"亚洲",102:"亚洲",105:"亚洲",106:"亚洲",119:"亚洲",120:"亚洲",132:"亚洲",152:"亚洲",153:"亚洲",160:"亚洲",165:"亚洲",174:"亚洲",185:"亚洲",197:"亚洲",203:"亚洲",209:"亚洲",213:"亚洲",217:"亚洲",9:"美洲",29:"美洲",37:"美洲",42:"美洲",45:"美洲",49:"美洲",57:"美洲",59:"美洲",61:"美洲",84:"美洲",89:"美洲",128:"美洲",156:"美洲",158:"美洲",159:"美洲",164:"美洲",201:"美洲",211:"美洲",212:"美洲",219:"美洲",4:"非洲",77:"非洲",135:"非洲",147:"非洲",184:"非洲",12:"大洋洲",83:"大洋洲",144:"大洋洲",236:"大洋洲"};

// ---- SKC 按地区销量明细（云舵 detailed-sales-query 同款）----
async function scrapeSkcRegionDetail({ productId, range = "30d" } = {}) {
  if (!productId) throw new Error("productId required");
  await ensureBrowser();
  const days = range === "1d" ? 1 : range === "7d" ? 7 : 30;
  const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0,10);
  const endDate = new Date().toISOString().slice(0,10);

  const page = await _yunduOpenPage();

  // 分两批避免单次过大
  const batches = [YUNDU_ALL_REGION_IDS.slice(0, 50), YUNDU_ALL_REGION_IDS.slice(50)];
  const merged = [];
  let lastErr = "";
  for (const regionIdList of batches) {
    try {
      const r = await page.evaluate(async ({ pid, regionIdList, startDate, endDate }) => {
        const mallid = (document.cookie.match(/mallid=([^;]+)/i)?.[1]) || "";
        const resp = await fetch("https://agentseller.temu.com/bg-brando-mms/supplier/data/center/skc/sales/data", {
          method: "POST",
          headers: { "Content-Type": "application/json", "mallid": mallid },
          credentials: "include",
          body: JSON.stringify({
            productIdList: [Number(pid)],
            regionIdList,
            select: "confirmGoodsQuantity",
            startDate, endDate,
            page: 1, pageSize: 100,
          }),
        });
        const text = await resp.text();
        try { return { status: resp.status, body: JSON.parse(text) }; }
        catch { return { status: resp.status, text: text.slice(0, 300) }; }
      }, { pid: productId, regionIdList, startDate, endDate });
      const list = r?.body?.result?.salesDataVOList || [];
      for (const it of list) merged.push(it);
      if (!list.length && r?.body?.errorMsg) lastErr = r.body.errorMsg;
    } catch (e) { lastErr = e.message; }
  }
  // 注意：page 是常驻缓存，不要 close

  // 按 regionId 聚合（同一 regionId 多 SKC 行求和）
  const byRegion = new Map();
  for (const it of merged) {
    if (!it.regionId || it.regionId < 0) continue;
    const prev = byRegion.get(it.regionId) || { regionId: it.regionId, regionName: it.regionName, sales: 0 };
    prev.sales += Number(it.confirmGoodsQuantity || 0);
    byRegion.set(it.regionId, prev);
  }
  const rows = Array.from(byRegion.values())
    .filter((r) => r.sales > 0)
    .map((r) => ({ ...r, continent: YUNDU_REGION_CONTINENT[r.regionId] || "其他" }))
    .sort((a, b) => b.sales - a.sales);

  // 按大洲分组
  const grouped = {};
  for (const c of ["欧洲","亚洲","美洲","非洲","大洋洲","其他"]) grouped[c] = [];
  for (const r of rows) grouped[r.continent].push(r);

  return {
    productId,
    range, days, startDate, endDate,
    total: rows.reduce((s, x) => s + x.sales, 0),
    rows,
    grouped,
    error: rows.length === 0 ? (lastErr || "未返回任何地区销量数据") : "",
  };
}

// ============================================================
// ========== 云舵套件 (yundu mining) =========================
// ============================================================
// 缓存一个常驻 page（避免每次点击都新开窗口）
let _yunduPage = null;
let _yunduKjmhPage = null;
async function _yunduOpenKjmhPage() {
  await ensureBrowser();
  if (_yunduKjmhPage && !_yunduKjmhPage.isClosed()) {
    try { await _yunduKjmhPage.evaluate(() => 1); return _yunduKjmhPage; } catch { _yunduKjmhPage = null; }
  }
  const p = await safeNewPage(context);
  try {
    await p.goto("https://seller.kuajingmaihuo.com/main/sale-manage", { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch {}
  await p.waitForTimeout(800);
  _yunduKjmhPage = p;
  return p;
}

let _yunduAntiContent = "";
let _yunduMallid = "";
const _yunduRealBodies = {}; // path -> latest real request body
async function _yunduOpenPage() {
  await ensureBrowser();
  if (_yunduPage && !_yunduPage.isClosed()) {
    try { await _yunduPage.evaluate(() => 1); return _yunduPage; } catch { _yunduPage = null; }
  }
  // 在页面加载前注入 fetch/XHR hook，捕获业务请求里的 anti-content 签名
  await context.addInitScript(() => {
    if (window.__yunduHookInstalled) return;
    window.__yunduHookInstalled = true;
    window.__yunduAntiContent = "";
    window.__yunduMallid = "";
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        const headers = (init && init.headers) || {};
        const get = (k) => {
          if (headers instanceof Headers) return headers.get(k);
          if (Array.isArray(headers)) { const h = headers.find((p) => String(p[0]).toLowerCase() === k); return h ? h[1] : null; }
          for (const key of Object.keys(headers)) if (key.toLowerCase() === k) return headers[key];
          return null;
        };
        const ac = get("anti-content");
        if (ac) window.__yunduAntiContent = ac;
        const mid = get("mallid");
        if (mid) window.__yunduMallid = mid;
      } catch {}
      return origFetch.apply(this, arguments);
    };
    const origOpen = XMLHttpRequest.prototype.open;
    const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      try {
        const lk = String(k).toLowerCase();
        if (lk === "anti-content" && v) window.__yunduAntiContent = v;
        if (lk === "mallid" && v) window.__yunduMallid = v;
      } catch {}
      return origSetHeader.apply(this, arguments);
    };
    void origOpen;
  });
  const page = await createSellerCentralPage("/main/data-center", { logPrefix: "[yundu]" }).catch(async () => {
    const p = await safeNewPage(context);
    try { await p.goto("https://agentseller.temu.com/main/data-center", { waitUntil: "domcontentloaded", timeout: 60000 }); } catch {}
    return p;
  });
  await page.waitForTimeout(800);
  // 主进程侧嗅探：所有出站请求里只要带 anti-content 就缓存
  page.on("request", (req) => {
    try {
      const h = req.headers();
      const ac = h["anti-content"] || h["Anti-Content"];
      if (ac) _yunduAntiContent = ac;
      const mid = h["mallid"] || h["Mallid"];
      if (mid) _yunduMallid = mid;
      const u = req.url();
      if (req.method() === "POST" && /\/(mms\/venom|api\/sale|bg-brando-mms|api\/activity|api\/kiana|marvel-mms|bg-luna-agent-seller)\//.test(u)) {
        try {
          const post = req.postData();
          if (post) {
            const upath = new URL(u).pathname;
            // 只记录真实页面发出的（首次记录后不再覆盖，避免被自己的请求覆盖）
            if (!_yunduRealBodies[upath]) {
              _yunduRealBodies[upath] = post;
              console.error(`[yundu-sniff] ${upath} body=${post.slice(0, 300)}`);
            }
          }
        } catch {}
      }
    } catch {}
  });
  try {
    await page.route(/agentseller(-[a-z]+)?\.temu\.com\/(mms\/venom|api\/sale|bg-brando-mms|api\/activity|api\/kiana|marvel-mms|bg-luna-agent-seller)\//, async (route) => {
      const req = route.request();
      try {
        const u = new URL(req.url());
        await route.continue({ headers: { ...req.headers(), origin: u.origin, referer: u.origin + "/" } });
      } catch { await route.continue(); }
    });
  } catch {}
  _yunduPage = page;
  return page;
}

async function _yunduFetch(page, path, body = {}) {
  // 等 主进程侧 嗅到 anti-content（最多 10 秒）
  const t0 = Date.now();
  while (!_yunduAntiContent && Date.now() - t0 < 10000) {
    await new Promise((r) => setTimeout(r, 200));
  }
  const ac = _yunduAntiContent || "";
  const mid = _yunduMallid || "";
  return await page.evaluate(async ({ path, body, ac, mid }) => {
    const mallid = mid || (document.cookie.match(/mallid=([^;]+)/i)?.[1]) || "";
    const host = location.origin.includes("kuajingmaihuo") ? "https://agentseller.temu.com" : location.origin;
    const headers = { "Content-Type": "application/json", "mallid": mallid };
    if (ac) headers["anti-content"] = ac;
    const resp = await fetch(host + path, {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    try { return { status: resp.status, body: JSON.parse(text), antiContentUsed: !!ac }; }
    catch { return { status: resp.status, text: text.slice(0, 500), antiContentUsed: !!ac }; }
  }, { path, body, ac, mid });
}

// ---- 1. listOverall (含 addedSiteList + allPunishInfoList) ----
async function yunduListOverall({ pageNo = 1, pageSize = 50, isLack = false } = {}) {
  const page = await _yunduOpenPage();
  // 导航到销售管理页让业务代码发出真实 listOverall 请求
  const listPath = "/mms/venom/api/supplier/sales/management/listOverall";
  if (!_yunduRealBodies[listPath]) {
    try {
      console.error("[yundu] navigating to sale-manage via navigateToSellerCentral...");
      await navigateToSellerCentral(page, "/stock/fully-mgt/sale-manage/main");
      await page.waitForTimeout(3000);
      // 关弹窗
      for (let i = 0; i < 6; i++) {
        try {
          const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
          if (await btn.isVisible({ timeout: 400 })) await btn.click(); else break;
        } catch { break; }
      }
      // 等业务代码发出 listOverall（最多 30 秒）
      const t0 = Date.now();
      while (!_yunduRealBodies[listPath] && Date.now() - t0 < 30000) {
        await page.waitForTimeout(400);
      }
      console.error(`[yundu] real body sniffed: ${!!_yunduRealBodies[listPath]}`);
    } catch (e) { console.error("[yundu] sale-manage nav exception:", e.message); }
  }
  console.error(`[yundu] anti-content captured: ${_yunduAntiContent ? _yunduAntiContent.slice(0, 30) + "..." : "NONE"}`);
  // 用嗅到的真实 body 模板，覆盖分页字段
  const realBodyStr = _yunduRealBodies["/mms/venom/api/supplier/sales/management/listOverall"];
  let bodyToSend = { pageNo, pageSize, isLack };
  if (realBodyStr) {
    try {
      const realBody = JSON.parse(realBodyStr);
      bodyToSend = { ...realBody, pageNo, pageSize };
      console.error(`[yundu] using real body template, keys: ${Object.keys(realBody).join(",")}`);
    } catch {}
  } else {
    console.error(`[yundu] WARN: no real body sniffed, using minimal body`);
  }
  // 翻页拉全部 subOrderList
  const PAGE_SIZE = 200;
  let allSubOrders = [];
  let firstResult = null;
  let totalCount = 0;
  let firstResp = null;
  {
    const firstBody = { ...bodyToSend, pageNo: 1, pageSize: PAGE_SIZE };
    const r0 = await _yunduFetch(page, "/mms/venom/api/supplier/sales/management/listOverall", firstBody);
    firstResp = r0;
    console.error(`[yundu] listOverall p1 status=${r0?.status} antiContent=${r0?.antiContentUsed} errCode=${r0?.body?.errorCode || r0?.body?.error_code}`);
    firstResult = r0?.body?.data || r0?.body?.result || {};
    totalCount = Number(firstResult.total || firstResult.totalCount || 0);
    allSubOrders = (firstResult.subOrderList || []).slice();
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    console.error(`[yundu] listOverall total=${totalCount} pages=${totalPages}`);
    for (let pn = 2; pn <= totalPages && pn <= 30; pn++) {
      const rN = await _yunduFetch(page, "/mms/venom/api/supplier/sales/management/listOverall",
        { ...bodyToSend, pageNo: pn, pageSize: PAGE_SIZE });
      const resN = rN?.body?.data || rN?.body?.result || {};
      const sub = resN.subOrderList || [];
      allSubOrders.push(...sub);
      console.error(`[yundu] listOverall p${pn} got ${sub.length} rows (total now ${allSubOrders.length})`);
    }
  }
  const r = firstResp;
  const result = { ...firstResult, subOrderList: allSubOrders, total: totalCount };
  {
    const list = (result.subOrderList || []).map((it) => {
      const tagList = [];
      if (it.hotTag) tagList.push("旺款");
      if (it.hasHotSku) tagList.push("爆旺款SKU");
      for (const t of (it.purchaseLabelList || [])) if (t) tagList.push(String(t));
      for (const t of (it.skcLabels || [])) if (t) tagList.push(String(t));
      for (const t of (it.holidayLabelList || [])) if (t) tagList.push(String(t));
      for (const t of (it.customLabelList || [])) if (t) tagList.push(String(t));
      const statusTags = [];
      if (it.illegalReason) statusTags.push(String(it.illegalReason));
      if (it.haltSalesType) statusTags.push("已停售");
      if (it.inBlackList) statusTags.push("黑名单");
      if (Array.isArray(it.hitRuleDetailList)) for (const r of it.hitRuleDetailList) if (r?.ruleName || r?.name) statusTags.push(String(r.ruleName || r.name));
      return {
        skcId: it.productSkcId ?? it.skcId,
        productId: it.productId,
        productName: it.productName || it.goodsName,
        image: it.productSkcPicture || it.image || it.skcMainImage || it.imageUrl,
        category: it.category || "",
        buyerName: it.buyerName || "",
        tagList: Array.from(new Set(tagList)),
        statusTags: Array.from(new Set(statusTags)),
        addedSiteList: it.addedSiteList || [],
        onceAddSiteList: it.onceAddSiteList || [],
        addedSiteCount: (it.addedSiteList || []).length,
        punishList: (it.allPunishInfoList || []).map((p) => ({
          type: p.punishType || p.type,
          reason: p.reason || p.punishReason || p.desc,
          time: p.punishTime || p.time,
        })),
        isLack: it.isLack,
        isAdProduct: it.isAdProduct,
      };
    });
    // 批量补站点信息：searchForChainSupplier（一次性翻页拉全部）
    try {
      console.error(`[yundu] fetching site info via searchForChainSupplier...`);
      const siteMap = {};
      // 嗅真实 body 模板
      const sniffedBody = _yunduRealBodies["/api/kiana/mms/robin/searchForChainSupplier"];
      let baseBody = { pageNum: 1, pageSize: 100 };
      if (sniffedBody) { try { baseBody = JSON.parse(sniffedBody); } catch {} }
      let pageNum = 1;
      let totalPages = 1;
      do {
        const sr = await _yunduFetch(page, "/api/kiana/mms/robin/searchForChainSupplier",
          { ...baseBody, pageNum, pageSize: 100 });
        const result = sr?.body?.result || {};
        const items = result.dataList || result.list || [];
        if (pageNum === 1) {
          const total = result.total || 0;
          totalPages = Math.ceil(total / 100);
          console.error(`[yundu] searchForChainSupplier total=${total} pages=${totalPages}`);
          const it0 = items[0] || {};
          console.error(`[yundu] buyer fields: nickContact=${JSON.stringify(it0.nickContact)} contact=${JSON.stringify(it0.contact)} buyerEditMessageVO=${JSON.stringify(it0.buyerEditMessageVO)?.slice(0,200)} buyerEditOpinionCount=${it0.buyerEditOpinionCount} canChangeBuyer=${it0.canChangeBuyer}`);
        }
        for (const it of items) {
          const allPunish = it.allPunishInfoList || [];
          const buyer = it.nickContact || it.contact || it.buyerEditMessageVO?.buyerName || "";
          for (const skc of (it.skcList || [])) {
            const k = String(skc.skcId ?? "");
            if (!k) continue;
            const sites = skc.addedSiteList || [];
            siteMap[k] = {
              buyerName: buyer,
              addedSiteList: sites,
              onceAddSiteList: skc.onceAddSiteList || [],
              addedSiteCount: sites.length,
              punishList: (skc.punishInfo ? [skc.punishInfo] : []).concat(allPunish).map((p) => ({
                type: p.punishType || p.type,
                reason: p.reason || p.punishReason || p.desc || p.ruleName,
                time: p.punishTime || p.time,
              })).filter((p) => p.reason || p.type),
            };
          }
        }
        pageNum++;
      } while (pageNum <= totalPages && pageNum <= 30);
      for (const row of list) {
        const m = siteMap[String(row.skcId)];
        if (m) {
          row.addedSiteList = m.addedSiteList;
          row.onceAddSiteList = m.onceAddSiteList;
          row.addedSiteCount = m.addedSiteCount;
          if (m.buyerName && !row.buyerName) row.buyerName = m.buyerName;
          if (m.punishList?.length) row.punishList = m.punishList;
        }
      }
      const merged = list.filter((r) => r.addedSiteCount > 0).length;
      console.error(`[yundu] site info merged: ${Object.keys(siteMap).length} skcs scanned, ${merged}/${list.length} list rows have sites`);
    } catch (e) { console.error("[yundu] siteCount merge error:", e.message); }
    return { total: result.total || list.length, list, raw: r?.body };
  }
}

// ---- 2. searchForChainSupplier 站点数 ----
async function yunduSiteCount({ skcIds = [] } = {}) {
  const page = await _yunduOpenPage();
  try {
    const r = await _yunduFetch(page, "/api/kiana/mms/robin/searchForChainSupplier",
      { skcIdList: skcIds, pageNum: 1, pageSize: 100 });
    return r?.body?.result || r?.body || {};
  } finally { /* keep _yunduPage cached */ }
}

// ---- 嗅探发现：打开候选页面 + 导出已捕获的 endpoint / body ----
async function yunduSniffDiscover({ urls = [], waitMs = 8000, dumpFile = "", interact = true } = {}) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const page = await _yunduOpenPage();
  const candidates = urls.length ? urls : [
    // 广告投放
    { url: "https://agentseller.temu.com/marketing/ads/report", tag: "ads" },
    { url: "https://agentseller.temu.com/marketing/ads/overview", tag: "ads" },
    { url: "https://agentseller.temu.com/marketing/promotion-data", tag: "ads" },
    { url: "https://agentseller.temu.com/marketing/main", tag: "ads" },
    // 退货率 / 质量分
    { url: "https://agentseller.temu.com/data-center/after-sale", tag: "quality" },
    { url: "https://agentseller.temu.com/data-center/quality-score", tag: "quality" },
    { url: "https://agentseller.temu.com/stock/fully-mgt/quality/main", tag: "quality" },
    { url: "https://agentseller.temu.com/data-center/quality", tag: "quality" },
    // 买手沟通记录 / 站点销量（依赖商品详情）
    { url: "https://agentseller.temu.com/stock/fully-mgt/sale-manage/main", tag: "sale" },
    // 站点销量明细
    { url: "https://agentseller.temu.com/data-center/site-sales", tag: "site-sales" },
    { url: "https://agentseller.temu.com/data-center/sales-by-site", tag: "site-sales" },
  ];
  const visited = [];
  // 每个候选页面：导航 → 等渲染 → 滚动 → 点击常见 tab/按钮 → 等接口飞
  const KEYWORDS = ["广告","推广","曝光","点击","ROI","质量","退货","售后","买手","沟通","意见","站点","明细","销量","报表","数据","查看","详情","更多","近7","近30","本月","今日"];
  for (const c of candidates) {
    const u = c.url || c;
    const before = Object.keys(_yunduRealBodies).length;
    try {
      await page.goto(u, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      if (interact) {
        // 滚动触发懒加载
        try { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); } catch {}
        await page.waitForTimeout(800);
        try { await page.evaluate(() => window.scrollTo(0, 0)); } catch {}
        await page.waitForTimeout(400);
        // 点击所有匹配关键词的可点元素（最多 8 个，避免乱跳）
        try {
          const clicked = await page.evaluate((kws) => {
            const out = [];
            const all = Array.from(document.querySelectorAll('button, a, [role="tab"], .ant-tabs-tab, .ant-btn, .ant-menu-item, span[class*="tab"], div[class*="tab"]'));
            for (const el of all) {
              if (out.length >= 8) break;
              const t = (el.innerText || el.textContent || "").trim();
              if (!t || t.length > 12) continue;
              if (kws.some(k => t.includes(k))) {
                try {
                  const r = el.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) {
                    el.click();
                    out.push(t);
                  }
                } catch {}
              }
            }
            return out;
          }, KEYWORDS);
          if (clicked.length) console.error(`[yundu-sniff] ${c.tag||""} clicked: ${clicked.join("|")}`);
        } catch (e) { console.error(`[yundu-sniff] click err: ${e.message}`); }
        await page.waitForTimeout(waitMs);
      } else {
        await page.waitForTimeout(waitMs);
      }
      const after = Object.keys(_yunduRealBodies).length;
      visited.push({ url: u, tag: c.tag, ok: true, newEndpoints: after - before });
    } catch (e) {
      visited.push({ url: u, tag: c.tag, ok: false, err: e.message });
    }
  }
  // 菜单遍历：进 /main，抓左侧菜单全部叶子节点，依次点击
  try {
    await page.goto("https://agentseller.temu.com/main/data-center", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);
    // 先把所有可展开菜单全部展开
    for (let round = 0; round < 4; round++) {
      try {
        await page.evaluate(() => {
          const exps = document.querySelectorAll('.ant-menu-submenu:not(.ant-menu-submenu-open) > .ant-menu-submenu-title, [class*="menu-submenu"]:not([class*="open"]) > [class*="title"]');
          exps.forEach(e => { try { e.click(); } catch {} });
        });
      } catch {}
      await page.waitForTimeout(600);
    }
    // 抓取所有菜单叶子链接（带 href 的 a，或带 path 的 li）
    const links = await page.evaluate(() => {
      const out = new Set();
      document.querySelectorAll('.ant-menu a, [class*="menu"] a').forEach(a => {
        const h = a.getAttribute('href') || "";
        if (h && h.startsWith('/') && !h.includes('#')) out.add(h);
      });
      return Array.from(out);
    });
    console.error(`[yundu-sniff] menu links found: ${links.length}`);
    visited.push({ url: "[menu-links-found]", tag: "menu", count: links.length });
    let menuMax = Math.min(links.length, 40);
    for (let i = 0; i < menuMax; i++) {
      const href = links[i];
      const before2 = Object.keys(_yunduRealBodies).length;
      try {
        await page.goto("https://agentseller.temu.com" + href, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(4500);
        try { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); } catch {}
        await page.waitForTimeout(1500);
        const after2 = Object.keys(_yunduRealBodies).length;
        if (after2 > before2) {
          visited.push({ url: href, tag: "menu", ok: true, newEndpoints: after2 - before2 });
        }
      } catch (e) {
        // 静默
      }
    }
  } catch (e) {
    visited.push({ url: "[menu-walk]", tag: "menu", ok: false, err: e.message });
  }

  // 额外：进商品详情抓买手沟通 + 站点销量
  try {
    await page.goto("https://agentseller.temu.com/stock/fully-mgt/sale-manage/main", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);
    const before = Object.keys(_yunduRealBodies).length;
    // 点第一个商品行（图片或标题）
    try {
      await page.evaluate(() => {
        const rows = document.querySelectorAll('tr.ant-table-row, [class*="goods-item"], [class*="product-row"]');
        for (const r of rows) {
          const link = r.querySelector('a, [class*="goods-name"], img');
          if (link) { link.click(); return true; }
        }
        return false;
      });
    } catch {}
    await page.waitForTimeout(5000);
    // 详情页里再点关键词 tab
    try {
      const clicked = await page.evaluate((kws) => {
        const out = [];
        const all = Array.from(document.querySelectorAll('button, a, [role="tab"], .ant-tabs-tab, .ant-btn'));
        for (const el of all) {
          if (out.length >= 10) break;
          const t = (el.innerText || el.textContent || "").trim();
          if (!t || t.length > 12) continue;
          if (kws.some(k => t.includes(k))) { try { el.click(); out.push(t); } catch {} }
        }
        return out;
      }, KEYWORDS);
      if (clicked.length) console.error(`[yundu-sniff] detail clicked: ${clicked.join("|")}`);
    } catch {}
    await page.waitForTimeout(waitMs);
    const after = Object.keys(_yunduRealBodies).length;
    visited.push({ url: "[product-detail-drill]", tag: "drill", ok: true, newEndpoints: after - before });
  } catch (e) {
    visited.push({ url: "[product-detail-drill]", tag: "drill", ok: false, err: e.message });
  }
  const endpoints = Object.keys(_yunduRealBodies).sort();
  const dump = {
    timestamp: new Date().toISOString(),
    antiContentCaptured: !!_yunduAntiContent,
    mallidCaptured: !!_yunduMallid,
    visited,
    endpoints,
    bodies: _yunduRealBodies,
  };
  const file = dumpFile || path.join(process.cwd(), "logs", `yundu-sniff-${Date.now()}.json`);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(dump, null, 2), "utf8");
    console.error(`[yundu-sniff] dumped ${endpoints.length} endpoints to ${file}`);
  } catch (e) { console.error(`[yundu-sniff] dump write failed: ${e.message}`); }
  return { file, count: endpoints.length, endpoints, visited };
}

// ---- 3. 高价限流目标价 querySiteTargetPrice ----
async function yunduHighPriceLimit({ skcIds = [] } = {}) {
  const page = await _yunduOpenPage();
  try {
    const r = await _yunduFetch(page, "/marvel-mms/us/api/kiana/direnjie/high/price/flow/reduce/full/querySiteTargetPrice",
      { skcIdList: skcIds });
    return r?.body?.result || r?.body || {};
  } finally { /* keep _yunduPage cached */ }
}

// ---- 4. 质量指标 qualityMetrics ----
async function yunduQualityMetrics({ pageNum = 1, pageSize = 50 } = {}) {
  const page = await _yunduOpenPage();
  try {
    const r = await _yunduFetch(page, "/bg-luna-agent-seller/goods/quality/supplyChain/qualityMetrics/pageQuery",
      { pageNum, pageSize });
    const result = r?.body?.result || {};
    return { total: result.total || 0, list: result.list || result.dataList || [], raw: r?.body };
  } finally { /* keep _yunduPage cached */ }
}

// ---- 5. 活动报名套件 ----
async function yunduActivityList({ pageNum = 1, pageSize = 50 } = {}) {
  const page = await _yunduOpenPage();
  try {
    const r = await _yunduFetch(page, "/api/kiana/gamblers/marketing/enroll/activity/list",
      { pageNum, pageSize });
    const result = r?.body?.result || {};
    const list = (result.activityList || result.list || []).map((a) => ({
      activityId: a.activityId || a.activityThematicId,
      activityThematicId: a.activityThematicId || a.activityId,
      activityName: a.activityName || a.title || a.name,
      activityType: a.activityType,
      startTime: a.startTime || a.activityStartTime,
      endTime: a.endTime || a.activityEndTime,
      needCanEnrollCnt: a.needCanEnrollCnt || 0,
      raw: a,
    }));
    return { total: result.total || list.length, list, raw: r?.body };
  } finally { /* keep _yunduPage cached */ }
}

async function yunduActivityEnrolled({ pageNum = 1, pageSize = 50 } = {}) {
  const page = await _yunduOpenPage();
  try {
    const r = await _yunduFetch(page, "/api/kiana/gamblers/marketing/enroll/list",
      { pageNum, pageSize });
    return r?.body?.result || r?.body || {};
  } finally { /* keep _yunduPage cached */ }
}

async function yunduActivityMatch({ activityThematicId, activityType, productIds = [], productSkcExtCodes = [], rowCount = 50, hasMore = false } = {}) {
  if (!activityThematicId) throw new Error("activityThematicId required");
  const page = await _yunduOpenPage();
  try {
    const r = await _yunduFetch(page, "/api/kiana/gamblers/marketing/enroll/scroll/match",
      { activityThematicId, activityType, productIds, productSkcExtCodes, rowCount, hasMore });
    return r?.body?.result || r?.body || {};
  } finally { /* keep _yunduPage cached */ }
}

async function yunduActivitySubmit({ activityThematicId, productIds = [], extra = {} } = {}) {
  if (!activityThematicId) throw new Error("activityThematicId required");
  const page = await _yunduOpenPage();
  try {
    const r = await _yunduFetch(page, "/api/kiana/gamblers/marketing/enroll/submit",
      { activityThematicId, productIds, ...extra });
    return r?.body?.result || r?.body || {};
  } finally { /* keep _yunduPage cached */ }
}

// 组合：自动报活动（拉可报 → 匹配 → 提交）
async function yunduAutoEnroll({ activityThematicId, activityType, dryRun = true } = {}) {
  if (!activityThematicId) throw new Error("activityThematicId required");
  const page = await _yunduOpenPage();
  try {
    // 1. 滚动匹配所有可报商品
    let allMatched = [];
    let hasMore = true, rounds = 0;
    while (hasMore && rounds < 20) {
      const r = await _yunduFetch(page, "/api/kiana/gamblers/marketing/enroll/scroll/match",
        { activityThematicId, activityType, productIds: [], productSkcExtCodes: [], rowCount: 100, hasMore: rounds > 0 });
      const result = r?.body?.result || {};
      const matchList = result.matchList || result.list || [];
      allMatched.push(...matchList);
      hasMore = !!result.hasMore;
      rounds += 1;
      if (matchList.length === 0) break;
    }
    if (dryRun) {
      return { dryRun: true, matchedCount: allMatched.length, matched: allMatched.slice(0, 50) };
    }
    // 2. 提交
    const productIds = allMatched.map((m) => m.productId || m.goodsId).filter(Boolean);
    const sub = await _yunduFetch(page, "/api/kiana/gamblers/marketing/enroll/submit",
      { activityThematicId, productIds });
    const sr = sub?.body?.result || sub?.body || {};
    return {
      dryRun: false,
      matchedCount: allMatched.length,
      successCount: sr.successCount || 0,
      failCount: sr.failCount || 0,
      failList: sr.failList || [],
    };
  } finally { /* keep _yunduPage cached */ }
}

// ---- 抓取销售管理数据 (翻页采集所有商品库存) ----

async function scrapeSales() {
  const lite = _navLiteMode;
  // 使用通用捕获器 + 翻页逻辑
  const page = await safeNewPage(context);
  const capturedApis = [];
  const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];
  const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', '_stm', 'msgBox', 'hot-update', 'sockjs', 'hm.baidu', 'google', 'favicon', 'drogon-api', 'report/uin'];

  try {
    // 捕获所有 API（和 scrapePageCaptureAll 一样的通用逻辑）
    page.on("response", async (resp) => {
      try {
        const url = resp.url();
        if (staticExts.some(ext => url.includes(ext))) return;
        if (frameworkPatterns.some(p => url.includes(p))) return;
        if (resp.status() === 200) {
          const ct = resp.headers()["content-type"] || "";
          if (ct.includes("json") || ct.includes("application")) {
            const body = await resp.json().catch(() => null);
            if (body && (body.result !== undefined || body.success !== undefined)) {
              const u = new URL(url);
              capturedApis.push({ path: u.pathname, data: body });
              console.error(`[sales] Captured: ${u.pathname}`);
            }
          }
        }
      } catch (e) { logSilent("ui.action", e); }
    });

    // 导航到销售管理页面
    console.error("[sales] Navigating to sale-manage/main...");
    await navigateToSellerCentral(page, "/stock/fully-mgt/sale-manage/main");
    await randomDelay(lite ? 4500 : 6000, lite ? 6000 : 8000);

    // 关闭弹窗
    for (let i = 0; i < 8; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }
    await randomDelay(lite ? 900 : 1500, lite ? 1500 : 2500);

    // 等待 listOverall 出现（轮询，最长 90s，15s 无响应时 reload 一次）
    {
      const hasListOverall = () => capturedApis.some((a) => (a.path || "").includes("listOverall"));
      const startedAt = Date.now();
      let reloaded = false;
      while (!hasListOverall() && Date.now() - startedAt < 90000) {
        if (!reloaded && Date.now() - startedAt > 15000) {
          console.error("[sales] listOverall missing after 15s, reloading...");
          try { await page.reload({ waitUntil: "domcontentloaded" }); } catch (e) { console.error("[sales] reload error:", e.message); }
          reloaded = true;
          await randomDelay(1500, 2200);
          for (let i = 0; i < 5; i++) {
            try {
              const btn = page.locator('button:has-text("知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
              if (await btn.isVisible({ timeout: 400 })) await btn.click();
              else break;
            } catch { break; }
          }
        }
        await randomDelay(500, 800);
      }
      if (hasListOverall()) console.error("[sales] listOverall HIT");
      else console.error("[sales] listOverall TIMED OUT");
    }

    // ---- 通过"选品状态"下拉勾选"已加入站点"并查询 ----
    try {
      const beforeListOverallCount = capturedApis.filter(a => a.path?.includes("listOverall")).length;

      // Step 1: 找到 "选品状态" 标签右侧的下拉框并点击
      const opened = await page.evaluate(() => {
        const labels = document.querySelectorAll('label, span, div');
        for (const lbl of labels) {
          if ((lbl.textContent || "").trim() === "选品状态") {
            // 找标签同行右侧的 select / input / 下拉触发区
            let row = lbl.closest('[class*="form-item"], [class*="row"], div');
            while (row && row.parentElement) {
              const trigger = row.querySelector('input, [class*="select"], [class*="Select"]');
              if (trigger) {
                trigger.scrollIntoView({ block: "center" });
                (trigger).click();
                return true;
              }
              row = row.parentElement;
              if (row.tagName === "BODY") break;
            }
          }
        }
        return false;
      });
      if (!opened) { console.error("[sales] WARN: 选品状态 dropdown not found"); }
      else {
        await randomDelay(400, 700);
        // Step 2: 在弹出的下拉里点 "已加入站点"
        const checked = await page.evaluate(() => {
          // 找文本为 "已加入站点" 的可见元素，优先选其复选框 / label
          const els = document.querySelectorAll('label, span, div, li');
          for (const el of els) {
            if ((el.textContent || "").trim() === "已加入站点" && el.offsetParent !== null) {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.width < 200) {
                el.click();
                return true;
              }
            }
          }
          return false;
        });
        console.error(`[sales] Checked 已加入站点: ${checked}`);
        await randomDelay(300, 500);

        // Step 3: 关闭下拉（点击页面别处或按 Escape）
        try { await page.keyboard.press("Escape"); } catch {}
        await randomDelay(200, 400);

        // Step 4: 点击 "查询" 按钮
        const beforeApi = capturedApis.length;
        const queried = await page.evaluate(() => {
          const btns = document.querySelectorAll('button, span, a');
          for (const b of btns) {
            if ((b.textContent || "").trim() === "查询" && b.offsetParent !== null) {
              const r = b.getBoundingClientRect();
              if (r.width > 0 && r.width < 200) { (b).click(); return true; }
            }
          }
          return false;
        });
        console.error(`[sales] Clicked 查询: ${queried}`);
        // 等新的 listOverall
        const t0 = Date.now();
        let gotNew = false;
        while (Date.now() - t0 < 8000) {
          if (capturedApis.slice(beforeApi).some(a => a.path?.includes("listOverall"))) { gotNew = true; break; }
          await randomDelay(200, 300);
        }
        if (gotNew) {
          console.error("[sales] Filter applied: listOverall refreshed");
          // 删掉筛选前的 listOverall
          for (let i = capturedApis.length - 1; i >= 0; i--) {
            const a = capturedApis[i];
            if (a.path?.includes("listOverall")) {
              const pos = capturedApis.slice(0, i + 1).filter(x => x.path?.includes("listOverall")).length;
              if (pos <= beforeListOverallCount) capturedApis.splice(i, 1);
            }
          }
          await randomDelay(800, 1200);
        } else {
          console.error("[sales] WARN: 查询 didn't trigger new listOverall");
        }
      }
    } catch (e) {
      console.error(`[sales] Filter switch error: ${e.message}`);
    }

    // 检查第一页的 listOverall 是否有 total > 10（需要翻页）
    const firstListApi = capturedApis.find(a => a.path?.includes("listOverall"));
    const total = firstListApi?.data?.result?.total || 0;
    const pageSize = firstListApi?.data?.result?.subOrderList?.length || 10;
    const totalPages = Math.ceil(total / pageSize);
    console.error(`[sales] Total: ${total} products, ${totalPages} pages`);

    // 统一的"点击当前页所有 销售趋势 链接"函数（外层循环 + Escape 关弹窗）
    const clickAllTrendsOnCurrentPage = async () => {
      const before = capturedApis.length;
      let clicked = 0;
      try {
        // 先数当前页有多少 销售趋势 链接
        const total = await page.evaluate(() => {
          let n = 0;
          for (const el of document.querySelectorAll('a, span, div, button')) {
            if ((el.textContent || "").trim() === "销售趋势" && el.offsetParent !== null) n++;
          }
          return n;
        });
        for (let i = 0; i < total; i++) {
          // 每次循环重新查 + 索引定位（防止 DOM 变化）
          const ok = await page.evaluate((idx) => {
            const list = [];
            for (const el of document.querySelectorAll('a, span, div, button')) {
              if ((el.textContent || "").trim() === "销售趋势" && el.offsetParent !== null) list.push(el);
            }
            const target = list[idx];
            if (!target) return false;
            target.scrollIntoView({ block: "center" });
            target.click();
            return true;
          }, i);
          if (!ok) break;
          clicked++;
          // 等待 querySkuSalesNumber 响应
          const waitStart = Date.now();
          const beforeApi = capturedApis.length;
          while (Date.now() - waitStart < 4000) {
            if (capturedApis.slice(beforeApi).some(a => a.path?.includes("querySkuSalesNumber"))) break;
            await randomDelay(80, 140);
          }
          // Escape 关弹窗
          try { await page.keyboard.press("Escape"); } catch {}
          await randomDelay(250, 400);
        }
      } catch (e) {
        console.error(`[sales] Trend click error: ${e.message}`);
      }
      console.error(`[sales] Trend: clicked ${clicked} rows, +${capturedApis.length - before} APIs`);
    };

    // 第 1 页先采趋势
    await clickAllTrendsOnCurrentPage();

    if (totalPages > 1) {
      // Temu API 需要 anti-content 签名，只能通过点击分页按钮翻页
      // 用 page.evaluate 查找并点击分页元素
      for (let pageNum = 2; pageNum <= Math.min(totalPages, 30); pageNum++) {
        try {
          const clicked = await page.evaluate((pn) => {
            // 方法1: 找所有看起来像分页的元素
            const allLinks = document.querySelectorAll('a, button, li, span');
            for (const el of allLinks) {
              // 找页码数字
              if (el.textContent?.trim() === String(pn) && el.offsetParent !== null) {
                const rect = el.getBoundingClientRect();
                // 分页通常在页面底部，宽度小于100
                if (rect.width < 100 && rect.width > 10 && rect.bottom > 300) {
                  el.click();
                  return 'page-number';
                }
              }
            }
            // 方法2: 找"下一页"按钮 (通常是一个 > 图标)
            const nextBtns = document.querySelectorAll('[class*="next"], [aria-label*="next"], [aria-label*="Next"]');
            for (const btn of nextBtns) {
              if (btn.offsetParent !== null && !btn.classList.contains('disabled') && !btn.hasAttribute('disabled')) {
                btn.click();
                return 'next-button';
              }
            }
            // 方法3: 找 SVG 右箭头
            const svgs = document.querySelectorAll('svg');
            for (const svg of svgs) {
              const parent = svg.closest('button, a, li, span');
              if (parent && parent.offsetParent !== null) {
                const rect = parent.getBoundingClientRect();
                if (rect.bottom > 400 && rect.width < 60) {
                  // 检查是否是右箭头（在分页区域的右侧）
                  const siblings = parent.parentElement?.children;
                  if (siblings && parent === siblings[siblings.length - 1]) {
                    parent.click();
                    return 'svg-arrow';
                  }
                }
              }
            }
            return null;
          }, pageNum);

          if (clicked) {
            console.error(`[sales] → page ${pageNum}/${totalPages} (via ${clicked})`);
            await randomDelay(lite ? 1000 : 2000, lite ? 1500 : 3000);
            // 当前页所有行的销售趋势
            await clickAllTrendsOnCurrentPage();
          } else {
            console.error(`[sales] Cannot find page ${pageNum} button, stopping`);
            break;
          }
        } catch (e) {
          console.error(`[sales] Page ${pageNum} click failed: ${e.message}`);
          break;
        }
      }
    }

    console.error(`[sales] Done! Captured ${capturedApis.length} APIs`);
    await saveCookies();
    return { apis: capturedApis };
  } finally {
    await page.close();
  }
}

// ---- 通用 response-listener 采集器 ----
// 用一个通用函数，通过 response listener 抓取指定页面的 API 数据
// 通用：捕获页面所有API响应（保存完整原始数据）
async function scrapePageCaptureAll(targetPath, options = {}) {
  const lite = options.lite ?? _navLiteMode;
  const {
    waitTime = lite ? 4500 : 6000,
    fullUrl = null,
    businessOnly = false,
    extraIgnorePatterns = [],
    waitForApi = null, // string 或 string[]：必须等到这些 API 模式命中后才返回
    waitForApiTimeout = 90000, // 最长等待时间（ms）
    reloadIfMissing = true,
    paginate = false, // 是否对列表类页面翻页（点击页码按钮）
    paginateApi = null, // 用于计算总页数的 API path 关键字（比如 "skc/pageQuery"）
    paginateMaxPages = 30,
  } = options;
  const waitForApiList = Array.isArray(waitForApi) ? waitForApi : (waitForApi ? [waitForApi] : []);
  const page = await safeNewPage(context);
  const capturedApis = [];
  const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];
  const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', '_stm', 'msgBox', 'hot-update', 'sockjs', 'hm.baidu', 'google', 'favicon', 'drogon-api', 'report/uin'];
  const businessNoisePatterns = [
    "/api/phantom/dm/wl/cg",
    "/pmm/api/pmm/",
    "/api/seller/auth/",
    "/api/server/_stm",
    "/bert/api/page/info/agentSeller/pageInfo",
    "/temu-sca-config/get-leo-config",
    "/api/bg-ladyfish/mms/menu/page/feedback/entrance",
    "/quick/merchant/pop/query",
  ];
  const ignorePatterns = [
    ...frameworkPatterns,
    ...extraIgnorePatterns,
    ...(businessOnly ? businessNoisePatterns : []),
  ];

  try {
    page.on("response", async (resp) => {
      try {
        const url = resp.url();
        if (staticExts.some(ext => url.includes(ext))) return;
        if (ignorePatterns.some(p => url.includes(p))) return;
        if (resp.status() === 200) {
          const ct = resp.headers()["content-type"] || "";
          if (ct.includes("json") || ct.includes("application")) {
            const body = await resp.json().catch(() => null);
            if (body && (body.result !== undefined || body.success !== undefined)) {
              const u = new URL(url);
              capturedApis.push({ path: u.pathname, data: body });
              console.error(`[capture-all] Captured: ${u.pathname}`);
            }
          }
        }
      } catch (e) { logSilent("ui.action", e); }
    });

    if (fullUrl) {
      console.error(`[capture-all] Navigating to ${fullUrl} via Seller Central auth flow...`);
      await navigateToSellerCentral(page, fullUrl, { lite });
    } else {
      console.error(`[capture-all] Navigating to ${targetPath}...`);
      await navigateToSellerCentral(page, targetPath);
    }
    await randomDelay(waitTime, waitTime + (lite ? 900 : 1500));

    for (let i = 0; i < 8; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不"), button:has-text("去处理")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }
    await randomDelay(lite ? 700 : 1200, lite ? 1000 : 1800);

    if (capturedApis.length < 2) {
      await randomDelay(lite ? 1800 : 2500, lite ? 2400 : 3500);
    }

    // 等待关键目标 API 出现（轮询），避免列表页懒加载导致空抓
    if (waitForApiList.length > 0) {
      const hasHit = () => waitForApiList.every((p) => capturedApis.some((a) => (a.path || "").includes(p)));
      const startedAt = Date.now();
      let reloaded = false;
      while (!hasHit() && Date.now() - startedAt < waitForApiTimeout) {
        if (!reloaded && reloadIfMissing && Date.now() - startedAt > 15000 && !hasHit()) {
          console.error(`[capture-all] waitForApi missing after 15s, reloading...`);
          try { await page.reload({ waitUntil: "domcontentloaded" }); } catch (e) { console.error("[capture-all] reload error:", e.message); }
          reloaded = true;
          await randomDelay(1500, 2200);
          // 再次尝试关闭弹窗
          for (let i = 0; i < 5; i++) {
            try {
              const btn = page.locator('button:has-text("知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
              if (await btn.isVisible({ timeout: 400 })) await btn.click();
              else break;
            } catch { break; }
          }
        }
        await randomDelay(500, 800);
      }
      const missing = waitForApiList.filter((p) => !capturedApis.some((a) => (a.path || "").includes(p)));
      if (missing.length > 0) {
        console.error(`[capture-all] waitForApi TIMED OUT, missing: ${missing.join(",")}`);
      } else {
        console.error(`[capture-all] waitForApi HIT all: ${waitForApiList.join(",")}`);
      }
    }

    // ---- 翻页：如果指定 paginate=true，根据 paginateApi 的 result.total 自动点击翻页 ----
    if (paginate && paginateApi) {
      const firstApi = capturedApis.find((a) => (a.path || "").includes(paginateApi));
      const result = firstApi?.data?.result || {};
      const total = Number(result.total || result.totalNum || result.totalCount || 0);
      const pageItems = result.pageItems || result.list || result.subOrderList || [];
      const pageSize = Array.isArray(pageItems) ? pageItems.length || 10 : 10;
      const totalPages = Math.min(Math.ceil(total / pageSize), paginateMaxPages);
      console.error(`[capture-all] paginate: total=${total} pageSize=${pageSize} pages=${totalPages}`);
      if (totalPages > 1) {
        for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
          try {
            const clicked = await page.evaluate((pn) => {
              const allLinks = document.querySelectorAll("a, button, li, span");
              for (const el of allLinks) {
                if (el.textContent?.trim() === String(pn) && el.offsetParent !== null) {
                  const rect = el.getBoundingClientRect();
                  if (rect.width < 100 && rect.width > 10 && rect.bottom > 300) {
                    el.click();
                    return "page-number";
                  }
                }
              }
              const nextBtns = document.querySelectorAll('[class*="next"], [aria-label*="next"], [aria-label*="Next"]');
              for (const btn of nextBtns) {
                if (btn.offsetParent !== null && !btn.classList.contains("disabled") && !btn.hasAttribute("disabled")) {
                  btn.click();
                  return "next-button";
                }
              }
              return null;
            }, pageNum);
            if (clicked) {
              console.error(`[capture-all] → page ${pageNum}/${totalPages} (${clicked})`);
              await randomDelay(lite ? 1000 : 1800, lite ? 1500 : 2800);
            } else {
              console.error(`[capture-all] cannot find page ${pageNum}, stopping`);
              break;
            }
          } catch (e) {
            console.error(`[capture-all] page ${pageNum} click failed: ${e.message}`);
            break;
          }
        }
      }
    }

    console.error(`[capture-all] Done! Captured ${capturedApis.length} APIs`);
    await saveCookies();
    return { apis: capturedApis };
  } finally {
    await page.close();
  }
}


async function scrapeLifecycle(options = {}) {
  const lite = options.lite ?? _navLiteMode;
  const waitTime = options.waitTime ?? (lite ? 6000 : 8500);
  const page = await safeNewPage(context);
  const capturedApis = [];
  const responseTracker = createPendingTaskTracker();
  const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];
  const ignorePatterns = [
    "phantom/xg",
    "pfb/l1",
    "pfb/a4",
    "web-performace",
    "_stm",
    "msgBox",
    "hot-update",
    "sockjs",
    "hm.baidu",
    "google",
    "favicon",
    "drogon-api",
    "report/uin",
    "/api/phantom/dm/wl/cg",
    "/api/seller/auth/",
    "/api/bg-ladyfish/mms/menu/page/feedback/entrance",
  ];

  const closeCommonPrompts = async (rounds = 8) => {
    for (let i = 0; i < rounds; i += 1) {
      try {
        const btn = page.locator(
          'button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不"), button:has-text("取消"), button:has-text("稍后"), button:has-text("去处理")'
        ).first();
        if (await btn.isVisible({ timeout: 500 })) {
          await btn.click().catch(() => {});
          await randomDelay(250, 450);
          continue;
        }
      } catch {}
      break;
    }
  };

  let chainSupplierRequest = null;
  // Use CDP to capture POST body which Playwright's postData() fails to provide for this endpoint
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable", { maxPostDataSize: 65536 });
    const pendingScsRequestIds = new Set();
    cdp.on("Network.requestWillBeSent", async (params) => {
      try {
        const url = params?.request?.url || "";
        if (!url.includes("searchForChainSupplier")) return;
        if (chainSupplierRequest) return;
        const postData = params?.request?.postData || "";
        const hasPostData = params?.request?.hasPostData;
        const headers = params?.request?.headers || {};
        console.error(`[lifecycle] CDP scs request: method=${params?.request?.method} bodyLen=${postData.length} hasPostData=${hasPostData} reqId=${params?.requestId}`);
        if (postData) {
          chainSupplierRequest = { url, method: params.request.method, headers, body: postData };
          console.error(`[lifecycle] Captured scs template via CDP, body=${postData.slice(0, 300)}`);
        } else if (hasPostData && params?.requestId) {
          // Fetch the post body explicitly via getRequestPostData
          try {
            const r = await cdp.send("Network.getRequestPostData", { requestId: params.requestId });
            if (r?.postData) {
              chainSupplierRequest = { url, method: params.request.method, headers, body: r.postData };
              console.error(`[lifecycle] Captured scs template via getRequestPostData, body=${r.postData.slice(0, 300)}`);
            } else {
              pendingScsRequestIds.add(params.requestId);
              console.error(`[lifecycle] getRequestPostData returned empty, will retry on response`);
            }
          } catch (e2) {
            console.error(`[lifecycle] getRequestPostData error:`, e2?.message || e2);
            pendingScsRequestIds.add(params.requestId);
          }
        } else {
          // Capture URL/headers anyway in case body is empty (might be GET-style POST with all in URL)
          chainSupplierRequest = { url, method: params.request.method, headers, body: "" };
        }
      } catch (e) {
        console.error(`[lifecycle] CDP listener error:`, e?.message || e);
      }
    });
    cdp.on("Network.responseReceived", async (params) => {
      if (!pendingScsRequestIds.has(params?.requestId)) return;
      pendingScsRequestIds.delete(params.requestId);
      try {
        const r = await cdp.send("Network.getRequestPostData", { requestId: params.requestId });
        if (r?.postData && !chainSupplierRequest?.body) {
          chainSupplierRequest = chainSupplierRequest || { url: params?.response?.url || "", method: "POST", headers: {} };
          chainSupplierRequest.body = r.postData;
          console.error(`[lifecycle] Late-captured scs body via responseReceived, body=${r.postData.slice(0, 300)}`);
        }
      } catch (e) {
        console.error(`[lifecycle] late getRequestPostData error:`, e?.message || e);
      }
    });
  } catch (e) {
    console.error(`[lifecycle] CDP setup error:`, e?.message || e);
  }
  try {
    page.on("response", (resp) => {
      responseTracker.track((async () => {
        try {
          const url = resp.url();
          if (staticExts.some((ext) => url.includes(ext))) return;
          if (ignorePatterns.some((pattern) => url.includes(pattern))) return;
          if (resp.status() !== 200) return;
          const ct = resp.headers()["content-type"] || "";
          if (!ct.includes("json") && !ct.includes("application")) return;
          const body = await resp.json().catch(() => null);
          if (!body || (body.result === undefined && body.success === undefined)) return;
          const u = new URL(url);
          capturedApis.push({ path: u.pathname, data: body });
          console.error(`[lifecycle] Captured: ${u.pathname}`);
          // Capture searchForChainSupplier request template for manual pagination
          if (u.pathname.includes("searchForChainSupplier") && !chainSupplierRequest) {
            try {
              const req = resp.request();
              const method = req.method();
              const postData = req.postData();
              const headers = await req.allHeaders().catch(() => req.headers());
              console.error(`[lifecycle] scs request method=${method} hasBody=${!!postData} bodyLen=${postData ? postData.length : 0}`);
              chainSupplierRequest = {
                url: url,
                method,
                headers,
                body: postData || "",
              };
              console.error(`[lifecycle] Captured searchForChainSupplier request template`);
            } catch (e) {
              console.error(`[lifecycle] scs template capture error:`, e?.message || e);
            }
          }
        } catch (error) {
          logSilent("ui.action", error);
        }
      })());
    });

    console.error("[lifecycle] Navigating to /newon/product-select...");
    await navigateToSellerCentral(page, "/newon/product-select", { lite });
    await randomDelay(waitTime, waitTime + (lite ? 1000 : 1800));
    await closeCommonPrompts();

    // Auth recovery: if still parked on authentication/entry, retry navigation a few times
    for (let authTry = 0; authTry < 3; authTry += 1) {
      const u = page.url();
      if (!u.includes("/main/authentication") && !u.includes("/main/entry")) break;
      console.error(`[lifecycle] Still on auth page (try ${authTry + 1}/3): ${u}`);
      await navigateToSellerCentral(page, "/newon/product-select", { lite: false }).catch(() => {});
      await randomDelay(waitTime, waitTime + 1500);
      await closeCommonPrompts(4);
    }
    if (page.url().includes("/main/authentication") || page.url().includes("/main/entry")) {
      console.error("[lifecycle] Auth recovery failed, aborting lifecycle scrape");
      await saveCookies();
      return { apis: capturedApis, domData: null, meta: { authFailed: true, currentUrl: page.url() } };
    }

    let queryClicked = false;
    try {
      const exactQueryButton = page.getByRole("button", { name: "查询", exact: true }).first();
      if (await exactQueryButton.isVisible({ timeout: 2500 })) {
        await exactQueryButton.scrollIntoViewIfNeeded().catch(() => {});
        await exactQueryButton.click();
        queryClicked = true;
      }
    } catch {}

    if (!queryClicked) {
      const querySelectors = [
        'button:has-text("查询")',
        'span:has-text("查询")',
        '.ant-btn-primary:has-text("查询")',
      ];
      for (const selector of querySelectors) {
        try {
          const button = page.locator(selector).first();
          if (await button.isVisible({ timeout: 1200 })) {
            await button.scrollIntoViewIfNeeded().catch(() => {});
            await button.click();
            queryClicked = true;
            break;
          }
        } catch {}
      }
    }

    if (!queryClicked) {
      queryClicked = await page.evaluate(() => {
        const normalizeText = (value) => String(value || "").replace(/\s+/g, "");
        const candidates = Array.from(document.querySelectorAll("button, span, a, div"))
          .filter((element) => {
            const text = normalizeText(element.textContent || "");
            if (text !== "查询") return false;
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const target = candidates[candidates.length - 1];
        if (!target) return false;
        target.click();
        return true;
      }).catch(() => false);
    }

    if (queryClicked) {
      console.error("[lifecycle] Query triggered");
      await randomDelay(lite ? 3800 : 5500, lite ? 5200 : 7800);
    } else {
      console.error("[lifecycle] Query button not found, capturing current page state");
      await randomDelay(lite ? 1800 : 2600, lite ? 2600 : 3600);
    }

    await closeCommonPrompts(4);
    await responseTracker.drain(lite ? 2500 : 4500);

    // Paginate by directly calling searchForChainSupplier API with incremented pageNumber
    try {
      if (chainSupplierRequest) {
        let bodyObj = null;
        try { bodyObj = JSON.parse(chainSupplierRequest.body); } catch {}
        if (bodyObj && typeof bodyObj === "object") {
          // Find the total from already-captured first page
          const firstScs = capturedApis.find((a) => String(a?.path || "").includes("searchForChainSupplier"));
          const total = firstScs?.data?.result?.total || 0;
          const pageSize = bodyObj.pageSize || bodyObj.size || 10;
          const totalPages = Math.min(Math.ceil(total / pageSize), options.maxPages ?? 200);
          console.error(`[lifecycle] API pagination: total=${total} pageSize=${pageSize} totalPages=${totalPages}`);
          for (let pageNum = 2; pageNum <= totalPages; pageNum += 1) {
            // Temu searchForChainSupplier 实际字段是 pageNum；清掉冗余别名避免服务端歧义
            const reqBody = { ...bodyObj, pageNum };
            try {
              const result = await page.evaluate(async ({ url, headers, body }) => {
                const resp = await fetch(url, {
                  method: "POST",
                  credentials: "include",
                  headers: { ...headers, "content-type": "application/json" },
                  body: JSON.stringify(body),
                });
                if (!resp.ok) return { error: `HTTP ${resp.status}` };
                return await resp.json();
              }, { url: chainSupplierRequest.url, headers: chainSupplierRequest.headers, body: reqBody });
              if (result && !result.error && (result.result || result.success !== undefined)) {
                capturedApis.push({ path: "/api/kiana/mms/robin/searchForChainSupplier", data: result });
                const n = result?.result?.dataList?.length || 0;
                console.error(`[lifecycle] Fetched page ${pageNum}/${totalPages} items=${n}`);
                if (n === 0) break;
              } else {
                console.error(`[lifecycle] Page ${pageNum} failed: ${JSON.stringify(result).slice(0, 200)}`);
                break;
              }
            } catch (error) {
              console.error(`[lifecycle] Page ${pageNum} error:`, error?.message || error);
              break;
            }
            await randomDelay(300, 600);
          }
        } else {
          console.error("[lifecycle] chainSupplier body not parseable, falling back to DOM pagination");
        }
      }
      // Fallback DOM pagination (also runs if no API template captured)
      const maxPages = chainSupplierRequest ? 0 : (options.maxPages ?? 100);
      for (let pageIdx = 1; pageIdx < maxPages; pageIdx += 1) {
        // Scroll bottom of the page to ensure paginator rendered (Temu often virtualizes)
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await randomDelay(400, 700);
        const clicked = await page.evaluate(() => {
          const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          // 1) ant-pagination next
          const ant = document.querySelector('li.ant-pagination-next:not(.ant-pagination-disabled) a, li.ant-pagination-next:not(.ant-pagination-disabled) button, .ant-pagination-next:not(.ant-pagination-disabled)');
          if (ant && isVis(ant) && ant.getAttribute('aria-disabled') !== 'true') { ant.click(); return 'ant'; }
          // 2) any element with title/aria-label "下一页" / "Next Page"
          const labeled = Array.from(document.querySelectorAll('[title="下一页"],[aria-label="下一页"],[title="Next Page"],[aria-label="Next Page"],button[title="next"]'))
            .find((el) => isVis(el) && el.getAttribute('aria-disabled') !== 'true' && !el.disabled);
          if (labeled) { labeled.click(); return 'labeled'; }
          // 3) text-based search "下一页"
          const text = Array.from(document.querySelectorAll('button, a, span, li, div'))
            .find((el) => {
              if (!isVis(el)) return false;
              const t = (el.textContent || '').replace(/\s+/g, '');
              if (t !== '下一页' && t !== '>') return false;
              const cls = el.className || '';
              if (typeof cls === 'string' && cls.includes('disabled')) return false;
              return true;
            });
          if (text) { text.click(); return 'text'; }
          // 4) chevron / arrow icon (svg) inside paginator
          const svgBtn = Array.from(document.querySelectorAll('button, a'))
            .find((el) => isVis(el) && /pagin|next|page-next/i.test(el.className || '') && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
          if (svgBtn) { svgBtn.click(); return 'svg'; }
          return null;
        });
        if (!clicked) {
          // Dump pagination-area DOM for diagnosis
          try {
            const dump = await page.evaluate(() => {
              const out = [];
              const all = Array.from(document.querySelectorAll('*'));
              for (const el of all) {
                const cls = String(el.className || '');
                if (!/pagin|page-/i.test(cls)) continue;
                const r = el.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                out.push({ tag: el.tagName, cls: cls.slice(0, 80), text: (el.textContent || '').replace(/\s+/g, ' ').slice(0, 60), aria: el.getAttribute('aria-label') || el.getAttribute('aria-disabled') || '' });
                if (out.length > 20) break;
              }
              return out;
            });
            console.error(`[lifecycle] Pagination DOM dump: ${JSON.stringify(dump)}`);
          } catch {}
          console.error(`[lifecycle] No more pages after ${pageIdx} (no next button found)`);
          break;
        }
        console.error(`[lifecycle] Clicked next (${clicked}) -> page ${pageIdx + 1}`);
        await randomDelay(lite ? 2000 : 3000, lite ? 2800 : 4200);
        await responseTracker.drain(lite ? 1500 : 2500);
      }
    } catch (error) {
      console.error('[lifecycle] Pagination error:', error?.message || error);
    }

    const domData = await page.evaluate(() => {
      const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const toNumber = (value) => {
        const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : null;
      };
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const uniqueByText = (items) => {
        const seen = new Set();
        return items.filter((item) => {
          const key = JSON.stringify(item);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };
      const summaryCards = uniqueByText(
        Array.from(document.querySelectorAll("div, li, button, a"))
          .map((element) => {
            if (!isVisible(element)) return null;
            const text = normalizeText(element.innerText || "");
            if (!text || text.length > 48 || !/\d/.test(text)) return null;
            const rect = element.getBoundingClientRect();
            if (rect.width < 90 || rect.height < 28) return null;
            const lines = text.split(/ (?=\d)|\n/).map(normalizeText).filter(Boolean);
            return {
              text,
              value: toNumber(text),
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              width: Math.round(rect.width),
            };
          })
          .filter(Boolean)
          .sort((a, b) => (a.top - b.top) || (a.left - b.left))
          .slice(0, 24)
      );

      const filterLabels = uniqueByText(
        Array.from(document.querySelectorAll("label, .ant-form-item-label, .ant-select-selector, .ant-picker"))
          .map((element) => normalizeText(element.innerText || element.textContent || ""))
          .filter((text) => text && text.length <= 24)
          .slice(0, 80)
      );

      const buttons = uniqueByText(
        Array.from(document.querySelectorAll("button, [role='button'], .ant-btn"))
          .map((element) => normalizeText(element.innerText || element.textContent || ""))
          .filter((text) => text && text.length <= 24)
          .slice(0, 80)
      );

      const statusTabs = uniqueByText(
        Array.from(document.querySelectorAll("[role='tab'], .ant-tabs-tab, .ant-radio-button-wrapper, .ant-segmented-item"))
          .map((element) => {
            if (!isVisible(element)) return null;
            const text = normalizeText(element.innerText || "");
            if (!text || text.length > 40) return null;
            return {
              text,
              value: toNumber(text),
            };
          })
          .filter(Boolean)
      );

      const table = (() => {
        const root = document.querySelector("table");
        if (!root) return null;
        const headers = Array.from(root.querySelectorAll("thead th, thead td"))
          .map((cell) => normalizeText(cell.innerText || cell.textContent || ""))
          .filter(Boolean);
        const rows = Array.from(root.querySelectorAll("tbody tr"))
          .slice(0, 30)
          .map((row) => {
            const cells = Array.from(row.querySelectorAll("td"))
              .map((cell) => normalizeText(cell.innerText || cell.textContent || "").slice(0, 300))
              .filter((text, index, arr) => text || index < arr.length);
            return cells;
          })
          .filter((cells) => cells.length > 0);
        return {
          headers,
          rows,
          rowCount: root.querySelectorAll("tbody tr").length,
        };
      })();

      const pageTitle = normalizeText(
        document.querySelector("h1, h2, .title, .page-title")?.textContent || document.title || ""
      );

      return {
        pageTitle,
        summaryCards,
        statusTabs,
        filterLabels,
        buttons,
        table,
      };
    });

    console.error(`[lifecycle] Done! APIs: ${capturedApis.length}, table rows: ${domData?.table?.rowCount || 0}`);
    await saveCookies();
    return {
      apis: capturedApis,
      domData,
      meta: {
        queryTriggered: queryClicked,
        currentUrl: page.url(),
      },
    };
  } finally {
    await responseTracker.drain(1200).catch(() => {});
    await page.close();
  }
}

async function scrapePageWithListener(targetPath, apiMatchers, options = {}) {
  const lite = options.lite ?? _navLiteMode;
  const { waitTime = lite ? 4200 : 5500, reloadIfMissing = true, fullUrl = null } = options;
  const page = await safeNewPage(context);
  const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  fs.mkdirSync(debugDir, { recursive: true });
  const captured = {};

  try {
    // 注册 response listener
    page.on("response", async (resp) => {
      try {
        const url = resp.url();
        for (const matcher of apiMatchers) {
          if (url.includes(matcher.pattern) && resp.status() === 200) {
            const data = await resp.json().catch(() => null);
            if (data) {
              captured[matcher.key] = data;
              console.error(`[scrape-listener] Captured: ${matcher.key}`);
            }
          }
        }
      } catch (e) { logSilent("ui.action", e); }
    });

    // 导航
    const navigationTarget = fullUrl || targetPath;
    console.error(`[scrape-listener] Navigating to ${navigationTarget}...`);
    await navigateToSellerCentral(page, navigationTarget);
    await randomDelay(waitTime, waitTime + (lite ? 900 : 1500));

    // 关闭弹窗
    for (let i = 0; i < 8; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不"), button:has-text("去处理")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }
    await randomDelay(lite ? 700 : 1200, lite ? 1000 : 1800);

    // 检查是否所有 API 都已捕获
    const allKeys = apiMatchers.map(m => m.key);
    const missing = allKeys.filter(k => !captured[k]);
    console.error(`[scrape-listener] Captured: ${Object.keys(captured).join(",")} | Missing: ${missing.join(",") || "none"}`);

    if (missing.length > 0 && Object.keys(captured).length > 0) {
      await randomDelay(lite ? 1200 : 1800, lite ? 1800 : 2600);
    }

    // reload 重试
    if (reloadIfMissing && missing.length > 0) {
      console.error("[scrape-listener] Reloading to capture missing APIs...");
      await page.reload({ waitUntil: "domcontentloaded" });
      await randomDelay(waitTime, waitTime + (lite ? 800 : 1200));
      for (let i = 0; i < 5; i++) {
        try {
          const btn = page.locator('button:has-text("知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
          if (await btn.isVisible({ timeout: 500 })) await btn.click();
          else break;
        } catch { break; }
      }
      await randomDelay(lite ? 700 : 1000, lite ? 1100 : 1500);
      const missing2 = allKeys.filter(k => !captured[k]);
      console.error(`[scrape-listener] After reload - Missing: ${missing2.join(",") || "none"}`);
    }

    await saveCookies();
    return captured;
  } finally {
    await page.close();
  }
}

// ---- 新增采集函数 ----

// listener-based 采集函数已移到 scrape-registry.mjs

// ---- 通用侧边栏全量API捕获 ----
async function scrapeSidebarCaptureAll(menuText, options = {}) {
  const lite = options.lite ?? _navLiteMode;
  const { waitTime = lite ? 5200 : 7000 } = options;
  const page = await safeNewPage(context);
  const capturedApis = [];
  const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];
  const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', '_stm', 'msgBox', 'hot-update', 'sockjs', 'hm.baidu', 'google', 'favicon', 'drogon-api', 'report/uin'];

  try {
    const handler = async (resp) => {
      try {
        const url = resp.url();
        if (staticExts.some(ext => url.includes(ext))) return;
        if (frameworkPatterns.some(p => url.includes(p))) return;
        if (resp.status() === 200) {
          const ct = resp.headers()["content-type"] || "";
          if (ct.includes("json") || ct.includes("application")) {
            const body = await resp.json().catch(() => null);
            if (body && (body.result !== undefined || body.success !== undefined)) {
              const u = new URL(url);
              capturedApis.push({ path: u.pathname, data: body });
              console.error("[sidebar-capture] Captured: " + u.pathname);
            }
          }
        }
      } catch (e) { logSilent("ui.action", e); }
    };
    page.on("response", handler);

    // 先导航到 agentseller
    console.error("[sidebar-capture] Navigating to agentseller...");
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(lite ? 700 : 1200, lite ? 1000 : 1800);

    // 关闭弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
        if (await btn.isVisible({ timeout: 800 })) await btn.click();
        else break;
      } catch { break; }
    }

    // 展开侧边栏菜单并点击目标
    console.error("[sidebar-capture] Looking for menu: " + menuText);
    const menuSelectors = [
      'a:has-text("' + menuText + '")',
      'span:has-text("' + menuText + '")',
      'div:has-text("' + menuText + '")',
      'li:has-text("' + menuText + '")',
    ];
    let clicked = false;
    for (const sel of menuSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) {
          await el.click();
          clicked = true;
          console.error("[sidebar-capture] Clicked menu: " + menuText);
          break;
        }
      } catch (e) { logSilent("ui.action", e); }
    }
    if (!clicked) {
      // 尝试展开父菜单
      const parentMenus = ["备货管理", "库存管理", "商品管理", "销售管理", "质量管理"];
      for (const parent of parentMenus) {
        try {
          const parentEl = page.locator('span:has-text("' + parent + '")').first();
          if (await parentEl.isVisible({ timeout: 1000 })) {
            await parentEl.click();
            await randomDelay(lite ? 400 : 700, lite ? 800 : 1200);
          }
        } catch (e) { logSilent("ui.action", e); }
      }
      // 再试一次
      for (const sel of menuSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 })) {
            await el.click();
            clicked = true;
            break;
          }
        } catch (e) { logSilent("ui.action", e); }
      }
    }

    await randomDelay(waitTime, waitTime + (lite ? 1000 : 1800));

    // 关闭弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
        if (await btn.isVisible({ timeout: 800 })) await btn.click();
        else break;
      } catch { break; }
    }
    await randomDelay(lite ? 700 : 1000, lite ? 1100 : 1500);

    if (capturedApis.length < 2) {
      await randomDelay(lite ? 1800 : 2500, lite ? 2400 : 3500);
    }

    // 提取DOM表格
    const domData = await page.evaluate(() => {
      const result = {};
      const tables = document.querySelectorAll("table");
      if (tables.length > 0) {
        result.tables = [];
        tables.forEach((table) => {
          const headers = [...table.querySelectorAll("thead th, thead td")].map(h => h.innerText?.trim());
          const rows = [];
          table.querySelectorAll("tbody tr").forEach((tr, ri) => {
            if (ri < 200) {
              const cells = [...tr.querySelectorAll("td")].map(td => td.innerText?.trim()?.substring(0, 500));
              rows.push(cells);
            }
          });
          if (headers.length > 0 || rows.length > 0) {
            result.tables.push({ headers, rows, rowCount: rows.length });
          }
        });
      }
      return result;
    });

    page.removeListener("response", handler);
    await saveCookies();
    console.error("[sidebar-capture] Done! APIs: " + capturedApis.length + ", Tables: " + (domData.tables?.length || 0));
    return { apis: capturedApis, domData };
  } finally {
    await page.close();
  }
}

// 侧边栏/直接路径/多区域采集函数已移到 scrape-registry.mjs

// 抽检结果明细 (kuajingmaihuo.com 侧边栏导航)
// 策略：拦截列表API获取所有商品，然后用fetch批量调用详情API
async function scrapeQcDetail() {
  const page = await safeNewPage(context);
  const capturedApis = [];
  let listApiUrl = ""; // 记录列表API的完整URL模板
  let detailApiUrl = ""; // 记录详情API的完整URL模板

  try {
    // 拦截所有API响应
    page.on("response", async (resp) => {
      try {
        const url = resp.url();
        if (resp.status() !== 200) return;
        const ct = resp.headers()["content-type"] || "";
        if (!ct.includes("json") && !ct.includes("application")) return;
        const body = await resp.json().catch(() => null);
        if (!body) return;

        const u = new URL(url);
        // 识别列表API（通常包含 qc、check、inspect 等关键词）
        if (u.pathname.includes("qc") || u.pathname.includes("check") || u.pathname.includes("inspect") || u.pathname.includes("quality")) {
          capturedApis.push({ path: u.pathname, data: body });
          console.error(`[qc-detail] Captured: ${u.pathname} (${JSON.stringify(body).length}B)`);
          // 记录列表API URL
          if (body.result?.total || body.result?.list || body.result?.pageItems) {
            listApiUrl = url;
            console.error(`[qc-detail] Found list API: ${u.pathname}`);
          }
        }
        // 识别详情API
        if (u.pathname.includes("record") || u.pathname.includes("detail")) {
          capturedApis.push({ path: u.pathname, data: body });
          detailApiUrl = url;
          console.error(`[qc-detail] Found detail API: ${u.pathname}`);
        }
      } catch (e) { logSilent("ui.action", e); }
    });

    console.error("[qc-detail] Navigating to /wms/qc-detail...");
    await navigateToSellerCentral(page, "/wms/qc-detail");
    await randomDelay(5000, 7000);

    // 关闭弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }
    await randomDelay(1000, 2000);

    // 点击"查询"按钮
    try {
      const queryBtn = page.locator('button:has-text("查询"), span:has-text("查询")').first();
      if (await queryBtn.isVisible({ timeout: 3000 })) {
        await queryBtn.click();
        console.error("[qc-detail] Clicked query button");
        await randomDelay(5000, 8000);
      }
    } catch (e) {
      console.error("[qc-detail] Query button not found:", e.message);
    }

    // 如果有列表API，尝试翻页获取全部数据
    if (listApiUrl) {
      console.error("[qc-detail] Fetching all pages via API...");
      const allItems = [];
      for (let pg = 1; pg <= 20; pg++) {
        try {
          const pageData = await page.evaluate(async (args) => {
            const { url, pageNum } = args;
            // 修改URL中的页码参数
            const u = new URL(url);
            u.searchParams.set("pageNo", String(pageNum));
            u.searchParams.set("pageNumber", String(pageNum));
            u.searchParams.set("page", String(pageNum));
            const resp = await fetch(u.toString(), { credentials: "include" });
            return resp.json();
          }, { url: listApiUrl, pageNum: pg });

          const items = pageData?.result?.list || pageData?.result?.pageItems || [];
          if (items.length === 0) break;
          allItems.push(...items);
          console.error(`[qc-detail] Page ${pg}: ${items.length} items (total: ${allItems.length})`);

          const total = pageData?.result?.total || pageData?.result?.totalCount || 0;
          if (allItems.length >= total) break;
        } catch (e) {
          console.error(`[qc-detail] Page ${pg} failed:`, e.message);
          break;
        }
      }
      if (allItems.length > 0) {
        capturedApis.push({ path: "/qc-detail/all-pages", data: { result: { total: allItems.length, list: allItems } } });
        console.error(`[qc-detail] Total items collected: ${allItems.length}`);
      }
    } else {
      // 没找到列表API，用翻页点击方式
      console.error("[qc-detail] No list API found, using pagination clicks...");
      for (let pg = 2; pg <= 10; pg++) {
        try {
          const nextBtn = page.locator('li.ant-pagination-next button, button[aria-label="Next"], .ant-pagination-next').first();
          const isDisabled = await nextBtn.getAttribute("disabled").catch(() => null);
          if (isDisabled !== null || !(await nextBtn.isVisible({ timeout: 1000 }))) break;
          await nextBtn.click();
          console.error(`[qc-detail] Page ${pg}`);
          await randomDelay(3000, 5000);
        } catch { break; }
      }
    }

    // 尝试点击第一个"查看抽检记录"获取详情API格式
    try {
      const viewBtn = page.locator('a:has-text("查看抽检记录"), button:has-text("查看抽检记录"), span:has-text("查看抽检记录")').first();
      if (await viewBtn.isVisible({ timeout: 3000 })) {
        await viewBtn.click();
        console.error("[qc-detail] Clicked first detail button to capture detail API");
        await randomDelay(3000, 5000);
        // 关闭弹窗
        try {
          const closeBtn = page.locator('.ant-modal-close, button:has-text("关闭"), .ant-drawer-close').first();
          if (await closeBtn.isVisible({ timeout: 1000 })) await closeBtn.click();
        } catch (e) { logSilent("ui.action", e); }
      }
    } catch (e) { logSilent("ui.action", e); }

    console.error(`[qc-detail] Done! Captured ${capturedApis.length} APIs`);
    await saveCookies();
    return { apis: capturedApis };
  } finally {
    await page.close();
  }
}

// 品质/样品/图片/流量采集函数已移到 scrape-registry.mjs

// ---- 合规中心采集 ----

// 合规看板（主页仪表盘 - 包含重要通知、补充合规材料、涉嫌违反政策等汇总数据）
async function scrapeGovernDashboard() {
  const lite = _navLiteMode;
  const page = await safeNewPage(context);
  const capturedApis = [];
  const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];
  const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', '_stm', 'msgBox', 'hot-update', 'sockjs', 'hm.baidu', 'google', 'favicon', 'drogon-api', 'report/uin'];

  try {
    page.on("response", async (resp) => {
      try {
        const url = resp.url();
        if (staticExts.some(ext => url.includes(ext))) return;
        if (frameworkPatterns.some(p => url.includes(p))) return;
        if (resp.status() === 200) {
          const ct = resp.headers()["content-type"] || "";
          if (ct.includes("json") || ct.includes("application")) {
            const body = await resp.json().catch(() => null);
            if (body && (body.result !== undefined || body.success !== undefined)) {
              const u = new URL(url);
              capturedApis.push({ path: u.pathname, data: body });
              console.error(`[govern-dashboard] Captured: ${u.pathname}`);
            }
          }
        }
      } catch (e) { logSilent("ui.action", e); }
    });

    // 先进入 agentseller 建立认证上下文
    console.error("[govern-dashboard] Navigating to govern dashboard...");
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(lite ? 700 : 2000, lite ? 1000 : 3000);

    // 关闭弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }

    // 导航到合规中心看板
    await page.goto("https://agentseller.temu.com/govern/dashboard", { waitUntil: "domcontentloaded", timeout: 60000 });
    await randomDelay(lite ? 5500 : 8000, lite ? 7500 : 12000);

    // 关闭弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }
    await randomDelay(3000, 5000);

    // 提取合规看板 DOM 数据
    const domData = await page.evaluate(() => {
      const result = {};
      const bodyText = document.body?.innerText || "";
      result.pageText = bodyText.substring(0, 10000);

      // 提取统计卡片（补充合规材料、涉嫌违反政策等区域的数字）
      result.cards = [];
      const cards = document.querySelectorAll('[class*="card"], [class*="item"], [class*="block"], [class*="module"]');
      cards.forEach(card => {
        const text = card.innerText?.trim();
        if (text && text.length < 500 && /\d/.test(text)) {
          result.cards.push(text.replace(/\n+/g, ' | '));
        }
      });

      // 提取表格
      const tables = document.querySelectorAll("table");
      if (tables.length > 0) {
        result.tables = [];
        tables.forEach((table) => {
          const headers = [...table.querySelectorAll("thead th, thead td")].map(h => h.innerText?.trim());
          const rows = [];
          table.querySelectorAll("tbody tr").forEach((tr, ri) => {
            if (ri < 200) {
              const cells = [...tr.querySelectorAll("td")].map(td => td.innerText?.trim()?.substring(0, 500));
              rows.push(cells);
            }
          });
          if (headers.length > 0 || rows.length > 0) {
            result.tables.push({ headers, rows, rowCount: rows.length });
          }
        });
      }

      // 提取侧边栏菜单（获取合规中心所有子页面路径）
      result.sidebarLinks = [];
      const sideLinks = document.querySelectorAll('a[href*="govern"], [class*="menu"] a, [class*="nav"] a');
      sideLinks.forEach(a => {
        const text = a.innerText?.trim();
        const href = a.getAttribute("href") || "";
        if (text && text.length < 50) {
          result.sidebarLinks.push({ text, href });
        }
      });

      return result;
    });

    await saveCookies();
    console.error(`[govern-dashboard] Done! APIs: ${capturedApis.length}, sidebar links: ${domData.sidebarLinks?.length || 0}`);
    return { apis: capturedApis, domData };
  } finally {
    await page.close();
  }
}

// 合规中心子页面采集函数已移到 scrape-registry.mjs

async function extractGenericDomData(page, options = {}) {
  const textLimit = options.textLimit || 12000;
  return page.evaluate((limit) => {
    const result = {};
    const bodyText = document.body?.innerText || "";
    result.pageText = bodyText.substring(0, limit);

    result.stats = [];
    const cards = document.querySelectorAll('[class*="card"], [class*="stat"], [class*="summary"], [class*="overview"], [class*="metric"], [class*="item"], [class*="block"], [class*="module"]');
    cards.forEach((card) => {
      const text = card.innerText?.trim();
      if (text && text.length < 500 && /\d/.test(text)) {
        result.stats.push(text.replace(/\n+/g, " | "));
      }
    });

    const tables = document.querySelectorAll("table");
    if (tables.length > 0) {
      result.tables = [];
      tables.forEach((table) => {
        const headers = [...table.querySelectorAll("thead th, thead td")].map((h) => h.innerText?.trim());
        const rows = [];
        table.querySelectorAll("tbody tr").forEach((tr, ri) => {
          if (ri < 200) {
            const cells = [...tr.querySelectorAll("td")].map((td) => td.innerText?.trim()?.substring(0, 500));
            rows.push(cells);
          }
        });
        if (headers.length > 0 || rows.length > 0) {
          result.tables.push({ headers, rows, rowCount: rows.length });
        }
      });
    }

    return result;
  }, textLimit);
}

const GROUP_CAPTURE_STATIC_EXTS = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];
const GROUP_CAPTURE_FRAMEWORK_PATTERNS = ["phantom/xg", "pfb/l1", "pfb/a4", "web-performace", "_stm", "msgBox", "hot-update", "sockjs", "hm.baidu", "google", "favicon", "drogon-api", "report/uin"];

function createGroupedApiCollector(page, options = {}) {
  let capturedApis = [];
  const includeErrorCode = Boolean(options.includeErrorCode);

  const handler = async (resp) => {
    try {
      const url = resp.url();
      if (GROUP_CAPTURE_STATIC_EXTS.some((ext) => url.includes(ext))) return;
      if (GROUP_CAPTURE_FRAMEWORK_PATTERNS.some((pattern) => url.includes(pattern))) return;
      if (resp.status() !== 200) return;

      const ct = resp.headers()["content-type"] || "";
      if (!ct.includes("json") && !ct.includes("application")) return;

      const body = await resp.json().catch(() => null);
      if (!body) return;

      const hasBusinessPayload = (
        body.result !== undefined
        || body.success !== undefined
        || body.data !== undefined
        || (includeErrorCode && body.errorCode !== undefined)
      );
      if (!hasBusinessPayload) return;

      const parsedUrl = new URL(url);
      capturedApis.push({ path: parsedUrl.pathname, data: body });
    } catch (e) { logSilent("ui.action", e); }
  };

  return {
    attach() {
      page.on("response", handler);
    },
    detach() {
      page.removeListener("response", handler);
    },
    reset() {
      capturedApis = [];
    },
    snapshot() {
      return [...capturedApis];
    },
  };
}

async function dismissCommonDialogs(page, extraButtonTexts = []) {
  const buttonTexts = Array.from(new Set(["知道了", "我知道了", "确定", "关闭", "暂不", "我已知晓", ...extraButtonTexts]));
  const selector = buttonTexts.map((text) => `button:has-text("${text}")`).join(", ");

  for (let i = 0; i < 6; i++) {
    try {
      const btn = page.locator(selector).first();
      if (!await btn.isVisible({ timeout: 500 })) break;
      await btn.click();
      await randomDelay(200, 400);
    } catch {
      break;
    }
  }
}

async function expandSidebarMenus(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[class*="menu-submenu-title"], [class*="submenu-title"], [class*="ant-menu-submenu-title"]').forEach((item) => {
      const parent = item.closest('[class*="submenu"]') || item.parentElement;
      const classText = parent?.classList?.toString?.() || "";
      const isOpen = classText.includes("open") || classText.includes("active");
      if (!isOpen) item.click();
    });
  }).catch(() => {});
}

async function clickFirstVisible(page, selectors, timeout = 1500) {
  for (const selector of selectors) {
    try {
      const element = page.locator(selector).first();
      if (await element.isVisible({ timeout })) {
        await element.click();
        return true;
      }
    } catch (e) { logSilent("ui.action", e); }
  }
  return false;
}

async function navigateGovernTarget(page, target, options = {}) {
  const lite = options.lite ?? _navLiteMode;
  const targetUrl = `https://agentseller.temu.com/govern/${target.subPath}`;
  const expectedUrlPart = `/govern/${target.subPath}`;
  const sidebarSelectors = [
    `nav a[href*="${target.subPath}"]`,
    `[class*="menu"] a[href*="${target.subPath}"]`,
    `[class*="nav"] a[href*="${target.subPath}"]`,
    `a[href*="${target.subPath}"]`,
  ];

  let clicked = await clickFirstVisible(page, sidebarSelectors, lite ? 1200 : 2000);
  if (!clicked) {
    await expandSidebarMenus(page);
    await randomDelay(lite ? 300 : 600, lite ? 500 : 900);
    clicked = await clickFirstVisible(page, sidebarSelectors, lite ? 1200 : 2000);
  }
  if (!clicked) {
    clicked = await page.evaluate((subPath) => {
      const links = document.querySelectorAll('a, [role="link"], [class*="menu"] a, [class*="nav"] a');
      for (const link of links) {
        const href = link.getAttribute("href") || "";
        if ((href.includes(`/govern/${subPath}`) || href.includes(subPath)) && link.offsetParent !== null) {
          link.click();
          return true;
        }
      }
      return false;
    }, target.subPath).catch(() => false);
  }

  if (clicked) {
    await page.waitForURL((url) => url.toString().includes(expectedUrlPart), { timeout: lite ? 5000 : 8000 }).catch(() => {});
    await randomDelay(lite ? 2200 : 4500, lite ? 3200 : 6500);
    if (page.url().includes(expectedUrlPart)) {
      return { method: "sidebar", url: page.url() };
    }
  }

  console.error(`[govern-group] Sidebar fallback -> ${target.key}`);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await randomDelay(lite ? 2500 : 6000, lite ? 3800 : 8500);
  return { method: "goto", url: page.url() };
}

async function navigateAdsTab(page, tab, options = {}) {
  if (!tab?.label) return true;

  const lite = options.lite ?? _navLiteMode;
  const tabSelectors = [
    `nav a:has-text("${tab.label}")`,
    `a:has-text("${tab.label}")`,
    `button:has-text("${tab.label}")`,
    `div[role="tab"]:has-text("${tab.label}")`,
    `[role="menuitem"]:has-text("${tab.label}")`,
    `span:has-text("${tab.label}")`,
    `li:has-text("${tab.label}")`,
  ];

  // 等待菜单中出现该 label（最多 10s），避免 SPA 未加载完
  try {
    await page.waitForFunction(
      (label) => {
        const all = document.querySelectorAll("a, button, div, span, li, [role='tab'], [role='menuitem']");
        for (const el of all) {
          const t = (el.innerText || el.textContent || "").trim();
          if (t === label || (t.length < 20 && t.includes(label))) return true;
        }
        return false;
      },
      tab.label,
      { timeout: 10000 }
    );
  } catch {}

  // 优先：从 DOM 抓 a[href] 的 text→href 映射，直接 goto
  try {
    const hrefMap = await page.evaluate(() => {
      const map = {};
      document.querySelectorAll("a[href]").forEach((a) => {
        const t = (a.innerText || a.textContent || "").trim();
        const h = a.getAttribute("href") || "";
        if (t && h && h !== "#" && !map[t]) map[t] = h;
      });
      return map;
    }).catch(() => ({}));
    let href = hrefMap[tab.label];
    if (!href) {
      for (const [t, h] of Object.entries(hrefMap)) {
        if (t === tab.label || t.includes(tab.label) || tab.label.includes(t)) { href = h; break; }
      }
    }
    if (href) {
      let target = href;
      if (href.startsWith("#")) target = `https://ads.temu.com/index.html${href}`;
      else if (href.startsWith("/")) target = `https://ads.temu.com${href}`;
      console.error(`[ads-tab] Direct goto: ${tab.label} → ${target}`);
      try {
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
        return true;
      } catch (e) { console.error(`[ads-tab] goto failed: ${e.message}`); }
    }
  } catch (e) { logSilent("ui.action", e); }

  let clicked = await clickFirstVisible(page, tabSelectors, lite ? 1200 : 1800);
  if (!clicked) {
    clicked = await page.evaluate((label) => {
      const all = [...document.querySelectorAll("a, div, span, li")];
      for (const element of all) {
        if (element.innerText?.trim() === label && element.offsetParent !== null) {
          element.click();
          return true;
        }
      }
      return false;
    }, tab.label).catch(() => false);
  }

  return clicked;
}

function getAdsTabConfig(tabName) {
  return ADS_GROUP_TABS.find((tab) => tab.tabName === tabName || tab.key === tabName) || null;
}

function getAdsTabWaitTime(tab, lite) {
  return lite ? (tab?.liteWaitTime ?? tab?.waitTime ?? 3500) : (tab?.waitTime ?? 8000);
}

async function scrapeSingleGovernTarget(subPath, meta = {}) {
  const taskKey = meta?.taskKey || `govern:${subPath}`;
  const resultMap = await scrapeGovernTaskGroup([{ key: taskKey, subPath }]);
  return resultMap[taskKey] || { error: `govern target missing: ${taskKey}` };
}

async function scrapeGovernTaskGroup(targets) {
  const lite = _navLiteMode;
  const page = await safeNewPage(context);
  const results = {};
  const collector = createGroupedApiCollector(page);

  try {
    if (!Array.isArray(targets) || targets.length === 0) return results;

    console.error("[govern-group] Establishing auth context...");
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(lite ? 700 : 1500, lite ? 1000 : 2200);
    await dismissCommonDialogs(page);

    collector.attach();
    console.error("[govern-group] Opening govern dashboard shell...");
    await page.goto("https://agentseller.temu.com/govern/dashboard", { waitUntil: "domcontentloaded", timeout: 60000 });
    await randomDelay(lite ? 2500 : 6000, lite ? 3800 : 8500);
    await dismissCommonDialogs(page);
    await expandSidebarMenus(page);
    await randomDelay(lite ? 300 : 600, lite ? 500 : 900);

    for (const target of targets) {
      collector.reset();
      console.error(`[govern-group] Navigating via sidebar: ${target.key}`);
      await navigateGovernTarget(page, target, { lite });
      await dismissCommonDialogs(page);

      const capturedApis = collector.snapshot();
      if (capturedApis.length < 2) {
        await randomDelay(lite ? 800 : 2200, lite ? 1300 : 3000);
      }

      const domData = await extractGenericDomData(page, { textLimit: 10000 }).catch(() => ({}));
      results[target.key] = { apis: collector.snapshot(), domData, url: page.url() };
    }

    await saveCookies();
    return results;
  } finally {
    collector.detach();
    await page.close();
  }
}

async function scrapeAdsTaskGroup(tabs = ADS_GROUP_TABS) {
  const lite = _navLiteMode;
  const page = await safeNewPage(context);
  const results = {};
  const normalizedTabs = Array.isArray(tabs) ? tabs.filter(Boolean) : ADS_GROUP_TABS;
  const collector = createGroupedApiCollector(page, { includeErrorCode: true });

  try {
    if (normalizedTabs.length === 0) return results;

    console.error("[ads-group] Establishing auth context...");
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(lite ? 700 : 1500, lite ? 1000 : 2200);
    await dismissCommonDialogs(page);

    collector.attach();
    console.error("[ads-group] Navigating to ads.temu.com...");
    await page.goto("https://ads.temu.com/index.html", { waitUntil: "domcontentloaded", timeout: 60000 });
    await randomDelay(lite ? 2500 : 5000, lite ? 3800 : 8000);
    await dismissCommonDialogs(page, ["我已知晓"]);

    for (const tab of normalizedTabs) {
      if (tab.label) collector.reset();

      if (tab.label) {
        const clicked = await navigateAdsTab(page, tab, { lite });
        if (!clicked) {
          results[tab.key] = { error: `ads tab not found: ${tab.label}`, apis: [], domData: {}, url: page.url() };
          continue;
        }
      }

      const waitTime = getAdsTabWaitTime(tab, lite);
      await randomDelay(waitTime, waitTime + (lite ? 1200 : 2200));
      await dismissCommonDialogs(page, ["我已知晓"]);
      if (collector.snapshot().length < 2) {
        await randomDelay(lite ? 900 : 1800, lite ? 1400 : 2600);
      }

      const domData = await extractGenericDomData(page, { textLimit: 15000 }).catch(() => ({}));
      results[tab.key] = { apis: collector.snapshot(), domData, url: page.url() };
    }

    await saveCookies();
    return results;
  } finally {
    collector.detach();
    await page.close();
  }
}

// ---- 上品核价自动化 ----

/**
 * 下载图片到本地
 */
// downloadImage → moved to utils.mjs

async function generateAIImages(sourceImagePath, productTitle, imageTypes = AI_DETAIL_IMAGE_TYPE_ORDER) {
  const AI_SERVER = process.env.AI_IMAGE_SERVER || "http://localhost:3210";
  const outputDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "ai-images");
  fs.mkdirSync(outputDir, { recursive: true });

  console.error(`[ai-image] Generating ${imageTypes.length} images for: ${productTitle?.slice(0, 30)}`);

  // 构建 plans
  const plans = imageTypes.map(type => ({
    imageType: type,
    title: `${type} image`,
    description: `Professional ${type} product photo`,
    prompt: `Professional e-commerce ${type} photo of: ${productTitle}. High quality, white background, studio lighting.`,
  }));

  // 构建 FormData
  const FormData = (await import("node:buffer")).Blob ? null : null;
  // 用 http 模块发送 multipart request
  const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
  const parts = [];

  // 添加 plans
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="plans"\r\n\r\n${JSON.stringify(plans)}`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="productMode"\r\n\r\nsingle`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="imageLanguage"\r\n\r\nen`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="imageSize"\r\n\r\n800x800`);

  // 添加源图片文件
  if (sourceImagePath && fs.existsSync(sourceImagePath)) {
    const imageData = fs.readFileSync(sourceImagePath);
    const ext = path.extname(sourceImagePath).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${path.basename(sourceImagePath)}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
    // 需要特殊处理二进制数据
  }

  parts.push(`--${boundary}--`);

  // 使用 Node 内置 fetch + FormData
  try {
    const formData = new globalThis.FormData();
    formData.append("plans", JSON.stringify(plans));
    formData.append("productMode", "single");
    formData.append("imageLanguage", "en");
    formData.append("imageSize", "800x800");

    if (sourceImagePath && fs.existsSync(sourceImagePath)) {
      const fileBuffer = fs.readFileSync(sourceImagePath);
      const ext = path.extname(sourceImagePath).toLowerCase();
      const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
      const blob = new Blob([fileBuffer], { type: mimeType });
      formData.append("images", blob, path.basename(sourceImagePath));
    }

    const response = await fetch(`${AI_SERVER}/api/generate`, {
      method: "POST",
      body: formData,
    });

    // 解析 SSE 流
    const text = await response.text();
    const generatedPaths = [];

    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.status === "done" && data.imageUrl) {
            // data URL → 保存为文件
            const match = data.imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
            if (match) {
              const ext = match[1] === "png" ? "png" : "jpg";
              const fileName = `${data.imageType}_${Date.now()}.${ext}`;
              const filePath = path.join(outputDir, fileName);
              fs.writeFileSync(filePath, Buffer.from(match[2], "base64"));
              generatedPaths.push(filePath);
              console.error(`[ai-image] Generated: ${fileName}`);
            }
          }
        } catch (e) { logSilent("ui.action", e); }
      }
    }

    console.error(`[ai-image] Done! Generated ${generatedPaths.length} images`);
    return { images: generatedPaths, cnTitle: null };
  } catch (e) {
    console.error(`[ai-image] Error: ${e.message}`);
    return { images: [], cnTitle: null };
  }
}

// ---- 推广平台采集 (ads.temu.com) ----

// 推广平台通用采集函数：捕获 API + DOM 数据 + 支持 Tab 内导航
async function scrapeAdsPage(tabName, options = {}) {
  const tab = getAdsTabConfig(tabName);
  if (!tab) throw new Error(`Unknown ads tab: ${tabName}`);

  const resultMap = await scrapeAdsTaskGroup([{
    ...tab,
    waitTime: options.waitTime ?? tab.waitTime,
    liteWaitTime: options.waitTime ?? tab.liteWaitTime,
  }]);
  return resultMap[tab.key] || { error: `ads tab missing: ${tab.key}` };
}

// 推广平台 - 首页（今日花费、申报价销售额、推广建议、推荐投放商品）
async function scrapeAdsHome() {
  return scrapeAdsPage("home");
}

// 推广平台 - 商品推广（投放中、到达日预算、审核驳回、待推广商品数）
async function scrapeAdsProduct() {
  return scrapeAdsPage("product");
}

// 推广平台 - 数据报表（推广效果数据报表）
async function scrapeAdsReport() {
  return scrapeAdsPage("report");
}

// 推广平台 - 财务管理（推广账户余额、充值、消耗明细）
async function scrapeAdsFinance() {
  return scrapeAdsPage("finance");
}

// 推广平台 - 帮助中心
async function scrapeAdsHelp() {
  return scrapeAdsPage("help");
}

// 推广平台 - 消息通知
async function scrapeAdsNotification() {
  return scrapeAdsPage("notification");
}

// ---- 通过侧边栏采集 qiankun 子应用数据 ----
// 这些 /main/* 页面无法直接 page.goto，需要通过侧边栏点击导航
async function scrapeSidebarPages(targetKeys = null) {
  const lite = _navLiteMode;
  const page = await safeNewPage(context);
  const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  fs.mkdirSync(debugDir, { recursive: true });

  const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', 'get-leo-config', '_stm', 'msgBox', 'auth/userInfo', 'auth/menu', 'queryTotalExam', 'feedback/entrance', 'rule/unreadNum', 'suggestedPrice', 'checkAbleFeedback', 'queryFeedbackNotReadTotal', 'pop/query', '.js', '.css', '.png', '.svg', '.woff', '.ico', '.jpg', '.gif', '.map', '.webp', 'hm.baidu', 'google', 'favicon', 'hot-update', 'sockjs', 'drogon-api', 'agora/conv', 'detroit/api', 'report/uin', 'privilege/query-privilege', 'coupon/queryInvitation', 'optimize/order/wait', 'batchMatch', 'bert/api'];
  const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];

  const results = {};

  // 目标页面（通过侧边栏点击导航加载）
  const allSidebarTargets = [
    { menuTexts: ["样品管理"], key: "sampleManage", apis: [] },
    { menuTexts: ["司机/地址管理", "司机"], key: "addressManage", apis: [] },
    { menuTexts: ["发货台"], key: "shippingDesk", apis: [] },
    { menuTexts: ["发货单列表"], key: "shippingList", apis: [] },
    { menuTexts: ["收货/入库异常处...", "收货/入库异常", "收货入库异常"], key: "exceptionNotice", apis: [] },
    { menuTexts: ["退货明细"], key: "returnDetail", apis: [] },
    { menuTexts: ["退货包裹管理"], key: "returnOrders", apis: [] },
    { menuTexts: ["退货单管理"], key: "returnReceipt", apis: [] },
  ];
  const sidebarTargets = Array.isArray(targetKeys) && targetKeys.length > 0
    ? allSidebarTargets.filter((target) => targetKeys.includes(target.key))
    : allSidebarTargets;

  try {
    // Step 1: 加载 shell
    console.error("[sidebar-scrape] Step 1: Loading shell...");
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(lite ? 1200 : 5000, lite ? 1800 : 7000);

    // 关闭弹窗
    for (let i = 0; i < 10; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不"), button:has-text("去处理")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
      await randomDelay(200, 400);
    }

    // Step 2: 展开所有侧边栏子菜单
    console.error("[sidebar-scrape] Step 2: Expanding all sidebar menus...");
    await page.evaluate(() => {
      document.querySelectorAll('[class*="menu-submenu-title"], [class*="submenu-title"], [class*="ant-menu-submenu-title"]').forEach(item => {
        const parent = item.closest('[class*="submenu"]') || item.parentElement;
        const isOpen = parent?.classList?.toString().includes('open') || parent?.classList?.toString().includes('active');
        if (!isOpen) item.click();
      });
    });
    await randomDelay(lite ? 700 : 2000, lite ? 1200 : 3000);
    // 再展开一次
    await page.evaluate(() => {
      document.querySelectorAll('[class*="menu-submenu-title"], [class*="submenu-title"], [class*="ant-menu-submenu-title"]').forEach(item => {
        const parent = item.closest('[class*="submenu"]') || item.parentElement;
        const isOpen = parent?.classList?.toString().includes('open') || parent?.classList?.toString().includes('active');
        if (!isOpen) item.click();
      });
    });
    await randomDelay(lite ? 500 : 1500, lite ? 900 : 2000);

    // Step 2.4: 强制点开侧边栏内所有父菜单（仅在 sidebar 容器内，避免误点正文）
    for (let pass = 0; pass < 5; pass++) {
      await page.evaluate(() => {
        const sider = document.querySelector('nav, [class*="sider"], [class*="Sider"], [class*="side-menu"], [class*="sideMenu"]');
        const root = sider || document;
        // 1) 通用 submenu 标题
        const candidates = root.querySelectorAll(
          '[class*="submenu-title"], [class*="menu-submenu-title"], [class*="ant-menu-submenu-title"], [aria-expanded="false"]'
        );
        candidates.forEach((el) => { try { el.click(); } catch {} });
        // 2) 在侧边栏内匹配 li/div 中含关键词的折叠项（限制在 root，避免误点正文）
        const keywords = ["退货", "备货", "商品", "发货", "销售", "质量", "库存", "样品", "司机", "地址", "异常", "收货", "入库"];
        root.querySelectorAll('li, [class*="menu-item"], [class*="MenuItem"]').forEach((el) => {
          const txt = (el.innerText || "").trim().split("\n")[0];
          if (txt && txt.length < 16 && keywords.some((k) => txt.includes(k))) {
            try { el.click(); } catch {}
          }
        });
      }).catch(() => {});
      await randomDelay(400, 700);
    }

    // Step 2.5: 从侧边栏 DOM 抓菜单 text → href 映射（更稳，不靠点击）
    const menuHrefMap = await page.evaluate(() => {
      const map = {};
      const links = document.querySelectorAll('a[href]');
      links.forEach((a) => {
        const text = (a.innerText || a.textContent || "").trim();
        const href = a.getAttribute("href") || "";
        if (!text || !href || href === "#") return;
        if (!href.startsWith("/") && !href.includes("agentseller")) return;
        if (!map[text]) map[text] = href;
      });
      return map;
    }).catch(() => ({}));
    console.error(`[sidebar-scrape] Collected ${Object.keys(menuHrefMap).length} menu hrefs from sidebar`);
    // 常见别名 / 模糊匹配兜底
    const fuzzyFindHref = (candidates) => {
      for (const c of candidates) {
        if (menuHrefMap[c]) return menuHrefMap[c];
      }
      // 模糊：去掉省略号再精确匹配
      for (const c of candidates) {
        const cleaned = c.replace(/\.{3}|…/g, "");
        for (const [text, href] of Object.entries(menuHrefMap)) {
          if (text === cleaned || text.includes(cleaned) || cleaned.includes(text)) return href;
        }
      }
      // 再模糊：关键词包含
      for (const c of candidates) {
        const kw = c.slice(0, 2); // 取前两字
        for (const [text, href] of Object.entries(menuHrefMap)) {
          if (text.startsWith(kw) && text.length <= c.length + 4) return href;
        }
      }
      return null;
    };

    // Step 3: 逐个直接 goto href（不再依赖点击可见元素）
    for (const target of sidebarTargets) {
      console.error(`[sidebar-scrape] Resolving: ${target.menuTexts[0]}`);
      const capturedApis = [];

      // 设置 response listener
      const handler = async (resp) => {
        try {
          const url = resp.url();
          if (staticExts.some(ext => url.includes(ext))) return;
          if (frameworkPatterns.some(p => url.includes(p))) return;
          if (resp.status() === 200) {
            const ct = resp.headers()["content-type"] || "";
            if (ct.includes("json") || ct.includes("application")) {
              const body = await resp.json().catch(() => null);
              if (body && (body.result !== undefined || body.success !== undefined)) {
                const u = new URL(url);
                capturedApis.push({ path: u.pathname, data: body.result || body });
                console.error(`[sidebar-scrape] Captured: ${u.pathname}`);
              }
            }
          }
        } catch (e) { logSilent("ui.action", e); }
      };
      page.on("response", handler);

      try {
        // 优先：直接通过 href 跳转（最稳）
        let navigated = false;
        const href = fuzzyFindHref(target.menuTexts);
        if (href) {
          const fullUrl = href.startsWith("http") ? href : `https://agentseller.temu.com${href}`;
          console.error(`[sidebar-scrape] Direct goto: ${target.key} → ${fullUrl}`);
          try {
            await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
            navigated = true;
          } catch (e) { console.error(`[sidebar-scrape] goto failed: ${e.message}`); }
        }
        // 兜底：依旧尝试点菜单
        let clicked = navigated;
        if (!clicked) {
          for (const menuText of target.menuTexts) {
            try {
              const menuLink = page.locator(`nav a:has-text("${menuText}"), [class*="sider"] a:has-text("${menuText}"), [class*="sidebar"] a:has-text("${menuText}"), [class*="menu"] a:has-text("${menuText}"), [class*="menu-item"]:has-text("${menuText}")`).first();
              if (await menuLink.isVisible({ timeout: 2000 }).catch(() => false)) {
                await menuLink.click();
                clicked = true;
                console.error(`[sidebar-scrape] Clicked: ${menuText}`);
                break;
              }
            } catch (e) { logSilent("ui.action", e); }
            if (!clicked) {
              clicked = await page.evaluate((text) => {
                const links = document.querySelectorAll('a, [class*="menu-item"] span, [class*="menu-item"]');
                for (const el of links) {
                  if (el.innerText?.trim() === text) { el.click(); return true; }
                }
                return false;
              }, menuText);
              if (clicked) {
                console.error(`[sidebar-scrape] Clicked via evaluate: ${menuText}`);
                break;
              }
            }
          }
        }

        if (clicked) {
          await randomDelay(lite ? 3200 : 8000, lite ? 4800 : 12000);

          // 关闭弹窗
          for (let i = 0; i < 3; i++) {
            try {
              const btn = page.locator('button:has-text("知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
              if (await btn.isVisible({ timeout: 500 })) await btn.click();
              else break;
            } catch { break; }
          }
          await randomDelay(lite ? 700 : 3000, lite ? 1200 : 5000);

          // 从 DOM 提取数据
          const domData = await page.evaluate(() => {
            const data = {};
            // iframe 中的内容
            const iframes = document.querySelectorAll("iframe");
            data.iframeCount = iframes.length;
            // 主容器和 #container
            const container = document.querySelector("#container, #subapp-viewport, [id*='container']");
            if (container) {
              data.containerText = container.innerText?.substring(0, 3000);
            }
            // 表格
            const tables = document.querySelectorAll("table");
            if (tables.length > 0) {
              data.tables = [];
              tables.forEach((table) => {
                const headers = [...table.querySelectorAll("thead th, thead td")].map(h => h.innerText?.trim());
                const rows = [];
                table.querySelectorAll("tbody tr").forEach((tr, ri) => {
                  if (ri < 50) {
                    const cells = [...tr.querySelectorAll("td")].map(td => td.innerText?.trim()?.substring(0, 200));
                    rows.push(cells);
                  }
                });
                if (headers.length > 0 || rows.length > 0) {
                  data.tables.push({ headers, rowCount: table.querySelectorAll("tbody tr").length, rows });
                }
              });
            }
            // 统计数字
            const nums = document.querySelectorAll('[class*="num"], [class*="count"], [class*="amount"], [class*="total"], [class*="value"], [class*="stat"]');
            if (nums.length > 0) {
              data.numbers = [...nums].slice(0, 30).map(n => ({ text: n.innerText?.trim()?.substring(0, 100) }));
            }
            // 全页面文本摘要
            data.pageText = document.body?.innerText?.substring(0, 5000);
            return data;
          }).catch(() => ({}));

          results[target.key] = {
            apis: capturedApis,
            domData,
            url: page.url(),
          };
          console.error(`[sidebar-scrape] ${target.key}: ${capturedApis.length} APIs, DOM text: ${(domData.pageText || '').length} chars`);
        } else {
          console.error(`[sidebar-scrape] Could not find menu: ${target.menuTexts.join(", ")}`);
          results[target.key] = { error: "menu not found" };
        }
      } finally {
        page.removeListener("response", handler);
      }
    }

    await saveCookies();
    fs.writeFileSync(path.join(debugDir, "sidebar_scrape_result.json"), JSON.stringify(results, null, 2));
    return results;
  } finally {
    await page.close();
  }
}

// ---- 通过侧边栏点击导航来加载子应用并抓取 API ----

async function scrapeViaSidebarClick() {
  const page = await safeNewPage(context);
  const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  fs.mkdirSync(debugDir, { recursive: true });

  const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];
  const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', 'get-leo-config', '_stm', 'msgBox', 'auth/userInfo', 'auth/menu', 'queryTotalExam', 'feedback/entrance', 'rule/unreadNum', 'suggestedPrice', 'checkAbleFeedback', 'queryFeedbackNotReadTotal', 'pop/query'];

  const allResults = [];
  const consoleErrors = [];

  // 目标页面（侧边栏菜单名 → 期望的 URL 路径片段）
  const targetPages = [
    { menuTexts: ["数据中心"], expectedPath: "/main/data-center", group: "数据中心" },
    { menuTexts: ["商品数据"], expectedPath: "/main/goods-analysis", group: "数据中心" },
    { menuTexts: ["活动数据"], expectedPath: "/main/activity-analysis", group: "数据中心" },
    { menuTexts: ["流量分析"], expectedPath: "/main/flux-analysis", group: "数据中心" },
    { menuTexts: ["账户资金"], expectedPath: "/main/finance/account-center", group: "账户资金" },
    { menuTexts: ["收入明细"], expectedPath: "/main/finance/income-detail", group: "账户资金" },
    { menuTexts: ["账单"], expectedPath: "/main/finance/bill", group: "账户资金" },
    { menuTexts: ["质量中心"], expectedPath: "/main/quality-center", group: "质量管理" },
    { menuTexts: ["质量分"], expectedPath: "/main/quality-score", group: "质量管理" },
    { menuTexts: ["优惠券中心"], expectedPath: "/main/coupon-center", group: "店铺营销" },
    { menuTexts: ["店铺装修"], expectedPath: "/main/shop-decoration", group: "店铺营销" },
    { menuTexts: ["库存管理"], expectedPath: "/goods/inventory", group: "库存管理" },
    { menuTexts: ["仓库库存管理", "仓库库存"], expectedPath: "/wms/inventory", group: "库存管理" },
    { menuTexts: ["履约看板"], expectedPath: "promise-board", group: "履约管理" },
  ];

  try {
    // Step 1: 先导航到一个已知能正常加载的页面
    console.error("[sidebar-nav] Step 1: Loading shell via /goods/list...");
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(5000, 7000);

    // 关闭所有弹窗
    for (let i = 0; i < 10; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("去处理"), button:has-text("暂不")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
      await randomDelay(200, 400);
    }

    // 监听控制台消息
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push({ text: msg.text()?.substring(0, 500), url: page.url() });
      }
    });
    page.on("pageerror", (err) => {
      consoleErrors.push({ text: `PAGE_ERROR: ${err.message?.substring(0, 500)}`, url: page.url() });
    });

    // 确认 shell 已加载
    const shellOk = await page.evaluate(() => {
      const sidebar = document.querySelector('[class*="sidebar"], [class*="menu"], nav, [class*="sider"]');
      return !!sidebar;
    });
    console.error(`[sidebar-nav] Shell loaded: ${shellOk}`);
    await page.screenshot({ path: path.join(debugDir, "sidebar_shell.png"), fullPage: false });

    // Step 2: 展开所有侧边栏分组
    console.error("[sidebar-nav] Step 2: Expanding all sidebar groups...");
    const expandResult = await page.evaluate(() => {
      const results = [];
      // 查找所有可展开的菜单项（有箭头图标的）
      const menuItems = document.querySelectorAll('[class*="menu-submenu-title"], [class*="submenu-title"], [class*="menu-item-group-title"], [class*="ant-menu-submenu-title"]');
      for (const item of menuItems) {
        const text = item.innerText?.trim();
        // 检查是否已展开
        const parent = item.closest('[class*="submenu"]') || item.parentElement;
        const isOpen = parent?.classList?.toString().includes('open') || parent?.classList?.toString().includes('active');
        results.push({ text: text?.substring(0, 30), isOpen });
        if (!isOpen) {
          item.click();
        }
      }
      return results;
    });
    console.error(`[sidebar-nav] Found ${expandResult.length} menu groups:`, expandResult.map(r => `${r.text}(${r.isOpen ? 'open' : 'closed'})`).join(', '));
    await randomDelay(2000, 3000);

    // 再次展开
    await page.evaluate(() => {
      document.querySelectorAll('[class*="menu-submenu-title"], [class*="submenu-title"], [class*="ant-menu-submenu-title"]').forEach(item => {
        const parent = item.closest('[class*="submenu"]') || item.parentElement;
        const isOpen = parent?.classList?.toString().includes('open') || parent?.classList?.toString().includes('active');
        if (!isOpen) item.click();
      });
    });
    await randomDelay(1500, 2000);

    // Step 3: 获取所有侧边栏菜单项
    const allMenuItems = await page.evaluate(() => {
      const items = [];
      // 选择所有可点击的菜单链接
      const links = document.querySelectorAll('a[href], [class*="menu-item"] > span, [class*="menu-item"] > a, [class*="menu-item-content"], li[class*="menu-item"]');
      for (const el of links) {
        const text = el.innerText?.trim();
        const href = el.getAttribute("href") || el.closest("a")?.getAttribute("href") || "";
        if (text && text.length < 30 && text.length > 0) {
          items.push({ text, href, tag: el.tagName });
        }
      }
      return items;
    });
    console.error(`[sidebar-nav] Found ${allMenuItems.length} menu items`);

    // Step 4: 逐个点击目标页面
    for (const target of targetPages) {
      console.error(`\n[sidebar-nav] ===== Navigating to: ${target.menuTexts[0]} (${target.group}) =====`);

      const capturedRequests = [];
      const responseHandler = async (resp) => {
        const reqUrl = resp.url();
        const method = resp.request().method();
        const ct = resp.headers()["content-type"] || "";
        const isStatic = staticExts.some(ext => reqUrl.includes(ext));
        const isFramework = frameworkPatterns.some(pat => reqUrl.includes(pat));

        if (!isStatic && !isFramework && (method === "POST" || (method === "GET" && reqUrl.includes("/api/"))) && (ct.includes("json") || reqUrl.includes("/api/"))) {
          try {
            const body = await resp.text();
            capturedRequests.push({
              method,
              url: reqUrl,
              postData: resp.request().postData()?.substring(0, 2000) || null,
              status: resp.status(),
              responseBody: body.substring(0, 5000),
            });
          } catch (e) { logSilent("ui.action", e); }
        }
      };
      page.on("response", responseHandler);

      let clicked = false;
      let actualUrl = "";
      try {
        // 尝试通过文本匹配点击侧边栏
        for (const menuText of target.menuTexts) {
          // 方法1: 直接用文本匹配侧边栏链接
          const menuLink = page.locator(`nav a:has-text("${menuText}"), [class*="sider"] a:has-text("${menuText}"), [class*="sidebar"] a:has-text("${menuText}"), [class*="menu"] a:has-text("${menuText}"), [class*="menu-item"]:has-text("${menuText}")`).first();
          if (await menuLink.isVisible({ timeout: 2000 }).catch(() => false)) {
            console.error(`[sidebar-nav] Found menu item: "${menuText}", clicking...`);
            await menuLink.click();
            clicked = true;
            break;
          }

          // 方法2: 查找包含文本的 li 元素
          const menuLi = page.locator(`li:has-text("${menuText}")`).first();
          if (await menuLi.isVisible({ timeout: 1000 }).catch(() => false)) {
            console.error(`[sidebar-nav] Found li item: "${menuText}", clicking...`);
            await menuLi.click();
            clicked = true;
            break;
          }

          // 方法3: 用 evaluate 精确查找
          const found = await page.evaluate((text) => {
            const allElements = document.querySelectorAll('a, span, li, div');
            for (const el of allElements) {
              if (el.innerText?.trim() === text && el.offsetWidth > 0 && el.offsetHeight > 0) {
                // 确保是菜单中的元素
                const inMenu = el.closest('[class*="menu"], [class*="sider"], [class*="sidebar"], nav');
                if (inMenu) {
                  el.click();
                  return { found: true, tag: el.tagName, class: el.className?.substring?.(0, 80) };
                }
              }
            }
            return { found: false };
          }, menuText);

          if (found.found) {
            console.error(`[sidebar-nav] Found via evaluate: "${menuText}" (${found.tag})`);
            clicked = true;
            break;
          }
        }

        if (!clicked) {
          // 方法4: 如果侧边栏找不到，尝试父菜单先展开
          for (const menuText of target.menuTexts) {
            const groupName = target.group;
            console.error(`[sidebar-nav] Trying to expand group "${groupName}" first...`);
            await page.evaluate((group) => {
              const items = document.querySelectorAll('[class*="menu-submenu-title"], [class*="submenu-title"]');
              for (const item of items) {
                if (item.innerText?.trim().includes(group)) {
                  item.click();
                  return true;
                }
              }
              return false;
            }, groupName);
            await randomDelay(1000, 1500);

            // 再次尝试点击
            const found = await page.evaluate((text) => {
              const allElements = document.querySelectorAll('a, span, li, div');
              for (const el of allElements) {
                if (el.innerText?.trim() === text && el.offsetWidth > 0) {
                  el.click();
                  return true;
                }
              }
              return false;
            }, menuText);
            if (found) {
              clicked = true;
              console.error(`[sidebar-nav] Found after expanding group: "${menuText}"`);
              break;
            }
          }
        }

        if (!clicked) {
          console.error(`[sidebar-nav] Could not find menu item for: ${target.menuTexts[0]}, falling back to goto`);
          const fullUrl = `https://agentseller.temu.com${target.expectedPath}`;
          await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        }

        // 等待页面/子应用加载
        await randomDelay(3000, 5000);

        // 关闭弹窗
        for (let i = 0; i < 5; i++) {
          try {
            const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
            if (await btn.isVisible({ timeout: 400 })) await btn.click();
            else break;
          } catch { break; }
          await randomDelay(200, 300);
        }

        // 等待子应用内容加载（最多30秒）
        console.error(`[sidebar-nav] Waiting for sub-app content to load...`);
        let loaded = false;
        for (let wait = 0; wait < 30; wait++) {
          await randomDelay(1000, 1000);
          const state = await page.evaluate(() => {
            const spinners = [...document.querySelectorAll('[class*="spin"], [class*="loading"], [class*="skeleton"]')]
              .filter(el => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 50 && rect.height > 50 && style.display !== 'none' && style.visibility !== 'hidden';
              });
            const hasTable = document.querySelector('table') !== null;
            const hasChart = document.querySelector('canvas, [class*="chart"], [class*="echarts"]') !== null;
            const hasCards = document.querySelectorAll('[class*="card"], [class*="stat"], [class*="summary"]').length > 3;
            const contentEl = document.querySelector('[class*="content"], [class*="main-content"], main, [id*="subApp"], [id*="root"]');
            const textLen = (contentEl?.innerText || '').trim().length;
            return { spinnerCount: spinners.length, hasTable, hasChart, hasCards, textLen };
          });

          if (wait % 5 === 0) {
            console.error(`[sidebar-nav]   Wait ${wait}s: spinners=${state.spinnerCount} table=${state.hasTable} chart=${state.hasChart} cards=${state.hasCards} text=${state.textLen}`);
          }

          if (state.spinnerCount === 0 && (state.hasTable || state.hasChart || state.hasCards || state.textLen > 200)) {
            console.error(`[sidebar-nav]   Sub-app loaded after ${wait}s!`);
            loaded = true;
            break;
          }
        }

        if (!loaded) {
          console.error(`[sidebar-nav]   Sub-app did NOT load after 30s`);
        }

        // 额外等待 API 请求完成
        await randomDelay(3000, 4000);

        actualUrl = page.url();
        console.error(`[sidebar-nav] Current URL: ${actualUrl}`);
        console.error(`[sidebar-nav] Captured ${capturedRequests.length} business APIs`);

        // 截图
        const safeName = target.menuTexts[0].replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_");
        await page.screenshot({ path: path.join(debugDir, `sidebar_${safeName}.png`), fullPage: false });

        // 获取页面内容概览
        const contentInfo = await page.evaluate(() => {
          const result = {};
          result.title = document.title;
          result.url = location.href;
          const tables = document.querySelectorAll("table");
          result.tableCount = tables.length;
          if (tables.length > 0) {
            result.tableHeaders = [...tables[0].querySelectorAll("th")].map(th => th.innerText?.trim()).slice(0, 15);
          }
          const cards = document.querySelectorAll('[class*="card"], [class*="stat"]');
          result.cardCount = cards.length;
          result.bodyText = document.body?.innerText?.trim()?.substring(0, 1000) || "";
          // 检查 qiankun 容器
          const qiankunContainers = document.querySelectorAll('[id*="__qiankun"], [id*="subApp"], [class*="micro-app"]');
          result.qiankunContainers = [...qiankunContainers].map(el => ({
            id: el.id, class: el.className?.substring?.(0, 100), childCount: el.children.length,
            innerHTML: el.innerHTML?.substring(0, 300)
          }));
          return result;
        });

        allResults.push({
          name: target.menuTexts[0],
          group: target.group,
          expectedPath: target.expectedPath,
          actualUrl,
          clicked,
          loaded,
          apiCount: capturedRequests.length,
          apis: capturedRequests.map(r => {
            let p;
            try { p = new URL(r.url).pathname; } catch { p = r.url; }
            return {
              method: r.method,
              path: p,
              postData: r.postData?.substring(0, 800),
              status: r.status,
              responsePreview: r.responseBody?.substring(0, 1000),
            };
          }),
          contentInfo: {
            tableCount: contentInfo.tableCount,
            tableHeaders: contentInfo.tableHeaders,
            cardCount: contentInfo.cardCount,
            qiankunContainers: contentInfo.qiankunContainers,
            bodyTextLen: contentInfo.bodyText?.length || 0,
          },
        });

      } catch (e) {
        console.error(`[sidebar-nav] Error navigating to ${target.menuTexts[0]}: ${e.message}`);
        allResults.push({
          name: target.menuTexts[0],
          group: target.group,
          error: e.message,
          apis: [],
        });
      }

      page.removeListener("response", responseHandler);
      await randomDelay(1000, 2000);
    }

    // 保存结果
    const output = {
      timestamp: new Date().toISOString(),
      totalPages: allResults.length,
      pagesWithApis: allResults.filter(r => r.apiCount > 0).length,
      pagesLoaded: allResults.filter(r => r.loaded).length,
      consoleErrors: consoleErrors.slice(0, 50),
      results: allResults,
    };
    fs.writeFileSync(path.join(debugDir, "sidebar_nav_results.json"), JSON.stringify(output, null, 2));
    console.error(`[sidebar-nav] Done! ${allResults.length} pages, ${output.pagesWithApis} with APIs, ${output.pagesLoaded} loaded`);

    await page.close();
    return output;
  } catch (err) {
    console.error(`[sidebar-nav] Fatal error: ${err.message}`);
    fs.writeFileSync(path.join(debugDir, "sidebar_nav_results.json"), JSON.stringify({ error: err.message, results: allResults, consoleErrors }, null, 2));
    try { await page.screenshot({ path: path.join(debugDir, "sidebar_nav_error.png"), fullPage: false }); } catch (e) { logSilent("ui.action", e); }
    await page.close();
    throw err;
  }
}

// ---- 捕获 API 请求 ----

async function captureApiRequests(targetUrl) {
  const page = await safeNewPage(context);
  const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  fs.mkdirSync(debugDir, { recursive: true });

  const capturedRequests = [];
  // 静态资源后缀过滤
  const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];

  try {
    // 先登录
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(2000, 3000);

    // 捕获所有 POST 请求（去掉 URL 关键词过滤，只排除静态资源）
    await page.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();
      const isStatic = staticExts.some(ext => url.includes(ext));
      if (!isStatic && (method === "POST" || (method === "GET" && url.includes("/api/")))) {
        capturedRequests.push({
          method,
          url,
          postData: req.postData()?.substring(0, 5000) || null,
        });
      }
      await route.continue();
    });

    // 捕获所有 JSON 响应
    page.on("response", async (resp) => {
      const url = resp.url();
      const ct = resp.headers()["content-type"] || "";
      const isStatic = staticExts.some(ext => url.includes(ext));
      if (!isStatic && (ct.includes("json") || url.includes("/api/"))) {
        try {
          const body = await resp.text();
          const req = capturedRequests.find(r => r.url === url && !r.responseBody);
          if (req) {
            req.status = resp.status();
            req.responseBody = body.substring(0, 15000);
          }
        } catch (e) { logSilent("ui.action", e); }
      }
    });

    // 导航到目标页面
    console.error("[capture] Navigating to:", targetUrl);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await randomDelay(8000, 12000);

    // 关闭弹窗（多轮）
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 8; i++) {
        try {
          const btn = page.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("去处理")').first();
          if (await btn.isVisible({ timeout: 800 })) await btn.click();
          else break;
        } catch { break; }
        await randomDelay(300, 500);
      }
      try {
        await page.evaluate(() => {
          document.querySelectorAll('[class*="close"], [class*="Close"], [aria-label="close"]').forEach(el => {
            try { el.click(); } catch {}
          });
        });
      } catch (e) { logSilent("ui.action", e); }
      await randomDelay(500, 800);
    }

    // 等待表格加载
    await page.waitForSelector("table tbody tr", { timeout: 20000 }).catch(() => {
      console.error("[capture] No table rows found, waiting more...");
    });
    await randomDelay(3000, 5000);

    // 滚动页面触发懒加载
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await randomDelay(2000, 3000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await randomDelay(2000, 3000);

    console.error(`[capture] Captured ${capturedRequests.length} API requests`);

    // 过滤出有响应体的 POST 请求
    const postRequests = capturedRequests.filter(r => r.method === "POST" && r.responseBody);
    console.error(`[capture] POST requests with response: ${postRequests.length}`);

    // 保存到文件
    const filename = targetUrl.includes("sale") ? "captured_api_sales.json" :
                     targetUrl.includes("goods") ? "captured_api_goods.json" : "captured_api.json";
    fs.writeFileSync(path.join(debugDir, filename), JSON.stringify(capturedRequests, null, 2));

    await page.close();

    // 返回摘要（只返回 POST 请求的摘要以缩短输出）
    return {
      total: capturedRequests.length,
      postCount: postRequests.length,
      requests: postRequests.map(r => ({
        method: r.method,
        url: r.url,
        status: r.status,
        postData: r.postData?.substring(0, 500),
        responsePreview: r.responseBody?.substring(0, 800),
      })),
    };
  } catch (err) {
    await page.close();
    throw err;
  }
}

const FLUX_ANALYSIS_TARGETS = {
  flux: {
    siteLabel: "\u5168\u7403",
    fullUrl: "https://agentseller.temu.com/main/flux-analysis-full",
  },
  fluxUS: {
    siteLabel: "\u7f8e\u56fd",
    fullUrl: "https://agentseller-us.temu.com/main/flux-analysis-full",
  },
  fluxEU: {
    siteLabel: "\u6b27\u533a",
    fullUrl: "https://agentseller-eu.temu.com/main/flux-analysis-full",
  },
};

const FLUX_ANALYSIS_RANGE_STEPS = [
  { label: "\u4eca\u65e5", aliases: ["\u4eca\u65e5", "\u5f53\u5929"] },
  { label: "\u8fd17\u65e5", aliases: ["\u8fd17\u65e5", "\u8fd17\u5929"] },
  { label: "\u8fd130\u65e5", aliases: ["\u8fd130\u65e5", "\u8fd130\u5929"] },
  { label: "\u672c\u6708", aliases: ["\u672c\u6708"] },
];

function normalizeFluxUiText(text = "") {
  return String(text || "")
    .replace(/\s+/g, "")
    .replace(/\u00a0/g, "")
    .trim();
}

async function closeFluxAnalysisPrompts(page) {
  for (let round = 0; round < 6; round += 1) {
    let clicked = false;
    try {
      const btn = page.locator(
        'button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不"), button:has-text("去处理")'
      ).first();
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click();
        clicked = true;
      }
    } catch {}

    if (!clicked) {
      try {
        clicked = await page.evaluate(() => {
          const nodes = Array.from(document.querySelectorAll("button, span, div, i"));
          for (const node of nodes) {
            const text = (node.textContent || "").replace(/\s+/g, "");
            if (!text) continue;
            if (!["知道了", "我知道了", "确定", "关闭", "暂不", "去处理"].some((keyword) => text.includes(keyword))) {
              continue;
            }
            const rect = node.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            node.click();
            return true;
          }
          return false;
        });
      } catch {}
    }

    if (!clicked) break;
    await randomDelay(300, 600);
  }
}

async function clickFluxRangeTab(page, aliases = []) {
  try {
    return await page.evaluate((rangeAliases) => {
      const normalizedAliases = rangeAliases.map((value) =>
        String(value || "").replace(/\s+/g, "").replace(/\u00a0/g, "").trim()
      );
      const elements = Array.from(
        document.querySelectorAll('button, [role="button"], .arco-radio-button, .arco-segmented-item, .arco-tabs-tab, .tab, .tabs-item, span, div')
      );
      const matches = elements.filter((element) => {
        const text = (element.textContent || "").replace(/\s+/g, "").replace(/\u00a0/g, "").trim();
        if (!text) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        return normalizedAliases.some((alias) => text === alias || text.includes(alias));
      });
      const target = matches.find((element) => {
        const disabled = element.getAttribute("disabled") !== null
          || element.getAttribute("aria-disabled") === "true"
          || element.classList.contains("disabled")
          || element.classList.contains("is-disabled");
        return !disabled;
      });
      if (!target) return false;
      target.click();
      return true;
    }, aliases);
  } catch {
    return false;
  }
}

function resolveFluxAnalysisTarget(params = {}) {
  const rawSiteKey = String(params?.siteKey || params?.taskKey || "").trim().toLowerCase();
  if (rawSiteKey === "us" || rawSiteKey === "fluxus") {
    return { taskKey: "fluxUS", ...FLUX_ANALYSIS_TARGETS.fluxUS };
  }
  if (rawSiteKey === "eu" || rawSiteKey === "fluxeu") {
    return { taskKey: "fluxEU", ...FLUX_ANALYSIS_TARGETS.fluxEU };
  }
  if (rawSiteKey === "global" || rawSiteKey === "flux") {
    return { taskKey: "flux", ...FLUX_ANALYSIS_TARGETS.flux };
  }

  const rawSiteLabel = normalizeFluxUiText(params?.siteLabel || "");
  if (rawSiteLabel === normalizeFluxUiText("美国")) {
    return { taskKey: "fluxUS", ...FLUX_ANALYSIS_TARGETS.fluxUS };
  }
  if (rawSiteLabel === normalizeFluxUiText("欧区")) {
    return { taskKey: "fluxEU", ...FLUX_ANALYSIS_TARGETS.fluxEU };
  }
  return { taskKey: "flux", ...FLUX_ANALYSIS_TARGETS.flux };
}

function mapFluxDailyDetailRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((item) => ({
      date: item?.statDate || item?.day || item?.date || "",
      exposeNum: item?.exposeNum || item?.goodsExposeNum || 0,
      clickNum: item?.clickNum || item?.goodsClickNum || 0,
      detailVisitNum: item?.goodsDetailVisitNum || item?.detailVisitNum || item?.goodsPageView || 0,
      detailVisitorNum: item?.goodsDetailVisitorNum || item?.detailVisitorNum || 0,
      addToCartUserNum: item?.addToCartUserNum || 0,
      collectUserNum: item?.collectUserNum || 0,
      buyerNum: item?.buyerNum || item?.payBuyerNum || 0,
      payGoodsNum: item?.payGoodsNum || 0,
      payOrderNum: item?.payOrderNum || 0,
      exposeClickRate: item?.exposeClickConversionRate || item?.exposeClickRate || 0,
      clickPayRate: item?.clickPayConversionRate || item?.clickPayRate || 0,
      searchExposeNum: item?.searchExposeNum || 0,
      searchClickNum: item?.searchClickNum || 0,
      searchPayGoodsNum: item?.searchPayGoodsNum || 0,
      searchPayOrderNum: item?.searchPayOrderNum || 0,
      recommendExposeNum: item?.recommendExposeNum || 0,
      recommendClickNum: item?.recommendClickNum || 0,
      recommendPayGoodsNum: item?.recommendPayGoodsNum || 0,
      recommendPayOrderNum: item?.recommendPayOrderNum || 0,
    }))
    .filter((item) => Boolean(item.date))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function readJsonFileSafe(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function collectFluxGoodsIdFallbacks() {
  const baseDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation");
  const goodsMap = new Map();
  const sourceStats = [];

  const mergeCandidate = (item, sourceLabel) => {
    const goodsId = String(item?.goodsId || "").trim();
    if (!goodsId) return false;
    const previous = goodsMap.get(goodsId) || {};
    goodsMap.set(goodsId, {
      goodsId,
      productSpuId: String(item?.productSpuId || item?.spuId || previous.productSpuId || "").trim(),
      productSkcId: String(item?.productSkcId || item?.skcId || previous.productSkcId || "").trim(),
      productSkuId: String(item?.productSkuId || item?.skuId || previous.productSkuId || "").trim(),
      title: String(item?.title || item?.goodsName || item?.productName || previous.title || "").trim(),
      sourceLabel: previous.sourceLabel || sourceLabel,
    });
    return !previous.goodsId;
  };

  const collectFrom = (fileName, sourceLabel, extractItems) => {
    const payload = readJsonFileSafe(path.join(baseDir, fileName));
    if (!payload) return;
    const items = Array.isArray(extractItems(payload)) ? extractItems(payload) : [];
    let added = 0;
    for (const item of items) {
      if (mergeCandidate(item, sourceLabel)) added += 1;
    }
    sourceStats.push({ sourceLabel, fileName, total: items.length, added });
  };

  collectFrom("temu_flux.json", "flux-store", (payload) => [
    ...(Array.isArray(payload?.items) ? payload.items : []),
    ...Object.values(payload?.itemsByRange || {}).flatMap((value) => Array.isArray(value) ? value : []),
  ]);
  collectFrom("temu_products.json", "products-store", (payload) => Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : []));
  collectFrom("temu_sales.json", "sales-store", (payload) => Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : []));

  return { goodsMap, sourceStats };
}

async function scrapeFluxProductDetail(params = {}) {
  const target = resolveFluxAnalysisTarget(params);
  const goodsId = String(params?.goodsId || "").trim();
  if (!goodsId) {
    throw new Error("goodsId required");
  }

  const page = await createSellerCentralPage(target.fullUrl, {
    lite: false,
    readyDelayMin: 1000,
    readyDelayMax: 1500,
    logPrefix: `[flux:detail:${target.taskKey}]`,
  });

  try {
    await closeFluxAnalysisPrompts(page);
    await randomDelay(500, 900);

    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    // 在页面上下文中抓取一次 SPA 最近一次 goods/list 请求的模板（如有），
    // 然后带上 siteIdList 等过滤参数请求 goods/detail，保证采到全站点聚合数据
    const response = await page.evaluate(async ({ goodsId, startDate, endDate }) => {
      // 尝试观察 SPA 正在用的过滤条件：从 window 上挂的 Redux / Pinia 状态或直接触发一次 goods/list
      // 保守做法：若 SPA 正好在同一会话内请求过 goods/list，可复用其最近一次 POST body。
      // 这里做不到侧信道读取历史 request，直接带 siteIdList:[] 作为"全部站点"约定。
      const body = { goodsId, startDate, endDate, siteIdList: [] };
      try {
        const result = await fetch("/api/seller/full/flow/analysis/goods/detail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const respBody = await result.json().catch(() => null);
        return {
          ok: result.ok,
          status: result.status,
          body: respBody,
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          error: String(error?.message || error || "request failed"),
          body: null,
        };
      }
    }, { goodsId, startDate, endDate });

    if (!response?.ok || !response?.body?.result) {
      const errorText = response?.body?.errorMsg || response?.error || `HTTP ${response?.status || 0}`;
      throw new Error(String(errorText || "fetch detail failed"));
    }

    const rawRows = response.body.result?.list || response.body.result?.dailyList || response.body.result?.trendList || [];
    const daily = mapFluxDailyDetailRows(rawRows);
    if (daily.length === 0) {
      return {
        success: false,
        siteLabel: target.siteLabel,
        goodsId,
        startDate,
        endDate,
        daily: [],
        cache: {},
        raw: response.body.result || null,
      };
    }

    const cachedAt = Date.now();
    return {
      success: true,
      siteLabel: target.siteLabel,
      goodsId,
      startDate,
      endDate,
      daily,
      cache: {
        [goodsId]: {
          goodsId,
          productId: String(params?.spuId || params?.productId || "").trim(),
          productSkcId: String(params?.skcId || params?.productSkcId || "").trim(),
          productSkuId: String(params?.skuId || params?.productSkuId || "").trim(),
          title: String(params?.title || "").trim(),
          cachedAt,
          stations: {
            [target.siteLabel]: {
              daily,
              cachedAt,
            },
          },
        },
      },
      raw: response.body.result || null,
    };
  } finally {
    await saveCookies().catch(() => {});
    await page.close().catch(() => {});
  }
}

function extractFluxIdentity(resp) {
  try {
    const request = resp.request?.();
    const raw = request?.postData?.() || "";
    if (!raw) return null;
    const payload = JSON.parse(raw);
    const identity = {
      goodsId: String(payload?.goodsId || payload?.productId || payload?.productSpuId || ""),
      productSkcId: String(payload?.productSkcId || payload?.skcId || payload?.goodsSkcId || ""),
      productSkuId: String(payload?.productSkuId || payload?.skuId || ""),
      productSpuId: String(payload?.productSpuId || payload?.productId || payload?.spuId || ""),
      goodsName: String(payload?.goodsName || payload?.productName || payload?.title || ""),
    };
    return Object.values(identity).some(Boolean) ? identity : null;
  } catch {
    return null;
  }
}

async function scrapeCustomTask(taskKey, task = {}) {
  if (task?.custom !== "fluxAnalysis") {
    throw new Error(`Unsupported custom task: ${taskKey}`);
  }

  const target = FLUX_ANALYSIS_TARGETS[taskKey];
  if (!target) {
    throw new Error(`Unsupported flux analysis task: ${taskKey}`);
  }

  let currentRangeLabel = "\u8fd17\u65e5";
  const capturedApis = [];
  const seen = new Set();
  const responseTracker = createPendingTaskTracker();
  let totalResponseCount = 0;
  let sellerApiCount = 0;
  const sellerApiPathSamples = [];
  let totalRequestCount = 0;
  let sellerRequestCount = 0;
  const sellerRequestPathSamples = [];
  let requestFailedCount = 0;
  const requestFailedSamples = [];
  let consoleErrorCount = 0;
  const consoleErrorSamples = [];
  let httpErrorCount = 0;
  const httpErrorSamples = [];
  const page = await createSellerCentralPage(target.fullUrl, {
    lite: false,
    readyDelayMin: 1200,
    readyDelayMax: 1800,
    logPrefix: `[flux:${taskKey}]`,
  });

  console.error(`[flux:${taskKey}] [diag] page created, target=${target.fullUrl}`);
  try {
    console.error(`[flux:${taskKey}] [diag] post-nav url=${page.url()}`);
    const pageTitle = await page.title().catch(() => "?");
    console.error(`[flux:${taskKey}] [diag] page title="${pageTitle}"`);
  } catch {}

  // === 安装 fetch / XHR 拦截：必须在 SPA bundle 启动前注入 ===
  // addInitScript 在每个新文档加载前执行；之后 reload 让 SPA 重新走我们的 hook
  try {
    await page.addInitScript(() => {
      if (window.__fluxHookInstalled) return;
      window.__fluxHookInstalled = true;
      window.__fluxCapturedBodies = {}; // path -> { url, method, body, headers }
      const origFetch = window.fetch.bind(window);
      window.fetch = async function (input, init) {
        try {
          const url = typeof input === "string" ? input : (input?.url || "");
          if (url.includes("/flow/analysis/")) {
            try {
              const u = new URL(url, location.origin);
              const path = u.pathname;
              const method = (init?.method || (typeof input === "object" ? input.method : "GET") || "GET").toUpperCase();
              let bodyText = null;
              if (init?.body != null) {
                bodyText = typeof init.body === "string" ? init.body : null;
              } else if (typeof input === "object" && input.body) {
                try { bodyText = await input.clone().text(); } catch {}
              }
              let headers = {};
              if (init?.headers) {
                if (init.headers instanceof Headers) {
                  init.headers.forEach((v, k) => { headers[k] = v; });
                } else if (Array.isArray(init.headers)) {
                  for (const [k, v] of init.headers) headers[k] = v;
                } else {
                  headers = { ...init.headers };
                }
              } else if (typeof input === "object" && input.headers) {
                if (input.headers.forEach) input.headers.forEach((v, k) => { headers[k] = v; });
              }
              window.__fluxCapturedBodies[path] = { url: u.toString(), method, bodyText, headers };
            } catch {}
          }
        } catch {}
        return origFetch(input, init);
      };
      // XHR fallback
      const OrigXHR = window.XMLHttpRequest;
      const origOpen = OrigXHR.prototype.open;
      const origSend = OrigXHR.prototype.send;
      const origSetHeader = OrigXHR.prototype.setRequestHeader;
      OrigXHR.prototype.open = function (method, url) {
        this.__fluxUrl = url;
        this.__fluxMethod = method;
        this.__fluxHeaders = {};
        return origOpen.apply(this, arguments);
      };
      OrigXHR.prototype.setRequestHeader = function (k, v) {
        if (this.__fluxHeaders) this.__fluxHeaders[k] = v;
        return origSetHeader.apply(this, arguments);
      };
      OrigXHR.prototype.send = function (body) {
        try {
          const url = String(this.__fluxUrl || "");
          if (url.includes("/flow/analysis/")) {
            const u = new URL(url, location.origin);
            window.__fluxCapturedBodies[u.pathname] = {
              url: u.toString(),
              method: (this.__fluxMethod || "GET").toUpperCase(),
              bodyText: typeof body === "string" ? body : null,
              headers: this.__fluxHeaders || {},
            };
          }
        } catch {}
        return origSend.apply(this, arguments);
      };
    });
    console.error(`[flux:${taskKey}] fetch/XHR addInitScript installed`);
    // 重载页面以让 hook 在 SPA bundle 启动前生效
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => {
      console.error(`[flux:${taskKey}] reload after hook failed: ${e?.message}`);
    });
    await randomDelay(1500, 2200);
    // 验证 hook 是否仍在新文档里
    const hookOk = await page.evaluate(() => !!window.__fluxHookInstalled).catch(() => false);
    console.error(`[flux:${taskKey}] post-reload hook present: ${hookOk}`);
  } catch (e) {
    console.error(`[flux:${taskKey}] hook install failed: ${e?.message}`);
  }

  const dumpDiagnostics = async (label) => {
    try {
      const url = page.url();
      const title = await page.title().catch(() => "?");
      const probe = await page.evaluate(() => ({
        bodyText: (document.body?.innerText || "").slice(0, 500),
        hasLoginForm: !!document.querySelector('input[type="password"]'),
        hasErrorBoundary: !!document.querySelector('[class*="error"], [class*="Error"]'),
      })).catch(() => ({ bodyText: "?", hasLoginForm: false, hasErrorBoundary: false }));
      console.error(`[flux:${taskKey}] [diag:${label}] url=${url}`);
      console.error(`[flux:${taskKey}] [diag:${label}] title="${title}" hasLogin=${probe.hasLoginForm} hasError=${probe.hasErrorBoundary}`);
      console.error(`[flux:${taskKey}] [diag:${label}] totalResponses=${totalResponseCount} sellerApis=${sellerApiCount} fluxApisCaptured=${capturedApis.length}`);
      console.error(`[flux:${taskKey}] [diag:${label}] totalRequests=${totalRequestCount} sellerRequests=${sellerRequestCount} requestFailed=${requestFailedCount} consoleErrors=${consoleErrorCount} httpErrors=${httpErrorCount}`);
      const httpErrSampleStr = httpErrorSamples.slice(-15).join(" | ");
      if (httpErrSampleStr) {
        console.error(`[flux:${taskKey}] [diag:${label}] HTTP 4xx/5xx: ${httpErrSampleStr}`);
      }
      const bodyExcerpt = String(probe.bodyText || "").replace(/\s+/g, " ").slice(0, 300);
      console.error(`[flux:${taskKey}] [diag:${label}] bodyExcerpt="${bodyExcerpt}"`);
      const respSampleStr = sellerApiPathSamples.slice(-12).join(", ");
      console.error(`[flux:${taskKey}] [diag:${label}] last seller RESP paths: ${respSampleStr || "(none)"}`);
      const reqSampleStr = sellerRequestPathSamples.slice(-12).join(", ");
      console.error(`[flux:${taskKey}] [diag:${label}] last seller REQ paths: ${reqSampleStr || "(none)"}`);
      const failSampleStr = requestFailedSamples.slice(-8).join(" | ");
      if (failSampleStr) {
        console.error(`[flux:${taskKey}] [diag:${label}] last requestfailed: ${failSampleStr}`);
      }
      const consoleSampleStr = consoleErrorSamples.slice(-5).join(" | ");
      if (consoleSampleStr) {
        console.error(`[flux:${taskKey}] [diag:${label}] last console errors: ${consoleSampleStr}`);
      }
    } catch (e) {
      console.error(`[flux:${taskKey}] [diag:${label}] dump failed: ${e?.message || e}`);
    }
  };

  const hasRangeApi = (rangeLabel, pathPart) =>
    capturedApis.some((entry) => entry.rangeLabel === rangeLabel && String(entry.path || "").includes(pathPart));

  const waitForRangeApis = async (rangeLabel, timeoutMs = 18000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (hasRangeApi(rangeLabel, "/mall/summary") && hasRangeApi(rangeLabel, "/goods/list")) {
        return true;
      }
      await randomDelay(350, 650);
    }
    return hasRangeApi(rangeLabel, "/mall/summary") || hasRangeApi(rangeLabel, "/goods/list");
  };

  // 捕获 SPA 向 flow/analysis/* 发出的完整请求（URL + headers + body），
  // 供我们自己的 goods/detail 重放用——只替换 goodsId/startDate/endDate，
  // 其它（siteIdList、anti-content、mallid、cookie 等）全部原样透传，确保 Temu 不拒绝。
  let capturedFluxRequestTemplate = null; // 兼容旧代码：只保留白名单 body 字段
  let capturedFluxFullRequest = null;     // 新：{ url, pathname, headers, body }
  // 按路径分组保存最近一次完整请求；每次任务开始时清空，避免上次残留误判
  const capturedFullRequestByPath = new Map();
  capturedFullRequestByPath.clear(); // 显式清空（防御性）

  const FLUX_BODY_PASSTHROUGH_KEYS = [
    "siteIdList", "siteIdLists", "siteId", "mallIdList", "mallId",
    "platformTypeList", "platformType", "regionIdList", "regionId",
    "salesType", "currencyType", "currency", "categoryIdList",
    "dateType", "statDateType", "rangeType", "dimension",
  ];

  const extractFluxTemplateFields = (rawBody) => {
    try {
      const parsed = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
      if (!parsed || typeof parsed !== "object") return null;
      const template = {};
      for (const key of FLUX_BODY_PASSTHROUGH_KEYS) {
        if (Object.prototype.hasOwnProperty.call(parsed, key)) {
          template[key] = parsed[key];
        }
      }
      return Object.keys(template).length > 0 ? template : null;
    } catch {
      return null;
    }
  };

  // 过滤掉 fetch 不允许手动设置的 forbidden headers（否则 page.evaluate 内的 fetch 会抛 TypeError）
  const FETCH_FORBIDDEN_HEADERS = new Set([
    "host", "content-length", "connection", "origin", "referer",
    "user-agent", "cookie", "accept-encoding", "accept-charset",
    ":authority", ":method", ":path", ":scheme", ":status",
  ]);
  const sanitizeFetchHeaders = (headers) => {
    const out = {};
    if (!headers || typeof headers !== "object") return out;
    for (const [rawKey, value] of Object.entries(headers)) {
      const key = String(rawKey || "").toLowerCase();
      if (!key || key.startsWith(":")) continue;
      if (FETCH_FORBIDDEN_HEADERS.has(key)) continue;
      if (value == null) continue;
      out[rawKey] = String(value);
    }
    return out;
  };

  try {
    page.on("request", (req) => {
      try {
        const url = req.url();
        const pathname = new URL(url).pathname;
        totalRequestCount++;
        if (pathname.startsWith("/api/seller/")) {
          sellerRequestCount++;
          if (sellerRequestPathSamples.length < 60) {
            sellerRequestPathSamples.push(pathname);
          }
        }
        // 捕获 flow/analysis/* 的完整请求（URL + headers + body），供重放用
        if (pathname.includes("/flow/analysis/")) {
          try {
            const postData = req.postData();
            let parsedBody = null;
            if (postData) {
              try { parsedBody = JSON.parse(postData); } catch { parsedBody = null; }
              const tpl = extractFluxTemplateFields(postData);
              if (tpl) {
                capturedFluxRequestTemplate = { ...(capturedFluxRequestTemplate || {}), ...tpl };
              }
            }
            const fullReq = {
              url,
              pathname,
              method: req.method ? req.method() : "?",
              headers: { ...(req.headers() || {}) },
              body: parsedBody,
              rawBody: postData || null,
              capturedAt: Date.now(),
            };
            capturedFullRequestByPath.set(pathname, fullReq);
            capturedFluxFullRequest = fullReq;
          } catch {}
        }
      } catch {}
    });

    page.on("requestfailed", (req) => {
      try {
        const url = req.url();
        const pathname = new URL(url).pathname;
        if (pathname.startsWith("/api/seller/") || pathname.includes("flow/analysis")) {
          requestFailedCount++;
          if (requestFailedSamples.length < 20) {
            const failure = req.failure?.()?.errorText || "?";
            requestFailedSamples.push(`${pathname}(${failure})`);
          }
        }
      } catch {}
    });

    page.on("console", (msg) => {
      try {
        if (msg.type() === "error") {
          consoleErrorCount++;
          if (consoleErrorSamples.length < 10) {
            consoleErrorSamples.push(String(msg.text() || "").slice(0, 160));
          }
        }
      } catch {}
    });

    page.on("response", (resp) => responseTracker.track((async () => {
      try {
        const url = resp.url();
        const pathname = new URL(url).pathname;
        const status = resp.status();
        totalResponseCount++;
        if (status >= 400) {
          httpErrorCount++;
          if (httpErrorSamples.length < 30) {
            const host = (() => { try { return new URL(url).host; } catch { return ""; } })();
            httpErrorSamples.push(`${status} ${host}${pathname}`);
          }
        }
        if (pathname.startsWith("/api/seller/")) {
          sellerApiCount++;
          if (sellerApiPathSamples.length < 60) {
            sellerApiPathSamples.push(`${pathname}[${status}]`);
          }
        }
        if (!pathname.includes("/api/seller/full/flow/analysis/")) return;

        // 诊断：trend/detail 类响应不管过没过滤都先打一次
        if (pathname.includes("/goods/trend") || pathname.includes("/goods/detail")) {
          const ctDiag = resp.headers()["content-type"] || "(no-ct)";
          let textSample = "";
          try {
            const rawBuf = await resp.body().catch(() => null);
            if (rawBuf) textSample = rawBuf.toString("utf8").slice(0, 500);
          } catch {}
          console.error(`[flux:${taskKey}] RESP-DIAG ${pathname} status=${resp.status()} ct=${ctDiag} bodyHead=${textSample.replace(/\s+/g, " ")}`);
          // 如果响应是有效 JSON 且有 result.list/dailyList/trendList，直接塞进 capturedApis
          try {
            if (textSample) {
              const json = JSON.parse(textSample.startsWith("{") ? textSample : "{}");
              if (json && json.result) {
                capturedApis.push({ path: pathname, data: json, rangeLabel: currentRangeLabel });
                console.error(`[flux:${taskKey}] RESP-DIAG pushed ${pathname} into capturedApis (resultKeys=${Object.keys(json.result).join(",")})`);
              }
            }
          } catch {}
          return; // 这条分支独立处理，不走下面通用逻辑
        }

        if (resp.status() !== 200) return;
        const contentType = resp.headers()["content-type"] || "";
        if (!contentType.includes("json")) return;

        const body = await resp.json().catch(() => null);
        if (!body || (body.result === undefined && body.success === undefined)) return;

        // 业务层错误响应(限流/权限/无数据)不视为有效捕获,避免下游误判"采集成功"用空数据覆盖 store
        if (body.success === false || body.result === null || body.result === undefined) {
          console.error(`[flux:${taskKey}] business error skipped: ${pathname} @ ${currentRangeLabel} -> errorCode=${body.errorCode} msg=${String(body.errorMsg || "").slice(0, 80)}`);
          return;
        }

        const dedupeKey = [
          currentRangeLabel,
          pathname,
          JSON.stringify(body?.result ?? body).slice(0, 400),
        ].join("|");
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);

        const entry = {
          path: pathname,
          data: body,
          rangeLabel: currentRangeLabel,
        };
        const fluxIdentity = extractFluxIdentity(resp);
        if (fluxIdentity) entry.fluxIdentity = fluxIdentity;
        capturedApis.push(entry);
        console.error(`[flux:${taskKey}] Captured ${pathname} @ ${currentRangeLabel}`);
      } catch (error) {
        logSilent("ui.action", error);
      }
    })()));

    await closeFluxAnalysisPrompts(page);
    await randomDelay(900, 1400);

    await dumpDiagnostics("after-prompts-closed");

    // 等默认 range (近7日) 的业务 API 出来,然后直接进入商品日趋势采集
    // 不再循环切 range tab —— 新版 SPA 切 tab 是纯前端 routing,不会触发新 API
    currentRangeLabel = "\u8fd17\u65e5";
    await waitForRangeApis(currentRangeLabel, 18000);

    await dumpDiagnostics("after-default-range");

    await responseTracker.drain(2500);
    await saveCookies();

    const availableRanges = hasRangeApi(currentRangeLabel, "/mall/summary") || hasRangeApi(currentRangeLabel, "/goods/list")
      ? [currentRangeLabel]
      : [];
    const primaryRangeLabel = currentRangeLabel;

    // ---- 限流恢复：如果默认 range 下 goods/list 没被 captureApis 收到（业务错误 4000004 等），
    // 通过点击日期切换（昨日 → 近7日）强制 SPA 重发，最多 5 轮 ----
    {
      let goodsListOk = capturedApis.some((a) => {
        const path = String(a.path || "");
        if (!path.includes("/goods/list")) return false;
        const list = a.data?.result?.list || a.data?.result?.pageItems || [];
        return Array.isArray(list) && list.length > 0;
      });
      let recoverAttempt = 0;
      while (!goodsListOk && recoverAttempt < 5) {
        recoverAttempt++;
        console.error(`[flux:${taskKey}] goods/list missing, recover attempt ${recoverAttempt}: clicking 昨日 then 近7日`);
        try {
          // 点 "昨日"
          const yesterdayBtn = page.locator('text="昨日"').first();
          if (await yesterdayBtn.count() > 0) {
            await yesterdayBtn.click({ timeout: 3000, force: true }).catch(() => {});
            await randomDelay(2000, 3000);
          }
          // 点 "近7日"
          const sevenBtn = page.locator('text="近7日"').first();
          if (await sevenBtn.count() > 0) {
            await sevenBtn.click({ timeout: 3000, force: true }).catch(() => {});
            await randomDelay(3000, 4500);
          }
          await responseTracker.drain(3000);
          await waitForRangeApis(currentRangeLabel, 8000).catch(() => {});
        } catch (e) {
          console.error(`[flux:${taskKey}] recovery click error: ${e?.message}`);
        }
        goodsListOk = capturedApis.some((a) => {
          const path = String(a.path || "");
          if (!path.includes("/goods/list")) return false;
          const list = a.data?.result?.list || a.data?.result?.pageItems || [];
          return Array.isArray(list) && list.length > 0;
        });
        if (!goodsListOk) {
          console.error(`[flux:${taskKey}] still no goods/list after attempt ${recoverAttempt}, waiting before retry`);
          await randomDelay(4000, 6000);
        } else {
          console.error(`[flux:${taskKey}] goods/list recovered on attempt ${recoverAttempt}`);
        }
      }
    }

    // ---- 商品日趋势采集：为每个商品请求最近30天的每日流量 ----
    try {
      const goodsListApis = capturedApis.filter((a) => String(a.path || "").includes("/goods/list"));
      const goodsCandidates = new Map();
      for (const api of goodsListApis) {
        const list = api.data?.result?.list || api.data?.result?.pageItems || [];
        for (const item of list) {
          const goodsId = String(item?.goodsId || "").trim();
          if (!goodsId) continue;
          goodsCandidates.set(goodsId, {
            goodsId,
            productSpuId: String(item?.productSpuId || item?.spuId || "").trim(),
            productSkcId: String(item?.productSkcId || item?.skcId || "").trim(),
            productSkuId: String(item?.productSkuId || item?.skuId || "").trim(),
            title: String(item?.goodsName || item?.productName || item?.title || "").trim(),
          });
        }
      }

      // 兜底: 仅当 tbody 实际有行时才用 store goodsIds（否则 SPA click loop 找不到行）
      if (goodsCandidates.size === 0) {
        const tbodyRows = await page.locator("tbody tr").count().catch(() => 0);
        if (tbodyRows > 0) {
          try {
            const fallback = collectFluxGoodsIdFallbacks();
            for (const [goodsId, meta] of fallback.goodsMap.entries()) {
              goodsCandidates.set(goodsId, meta);
            }
            if (goodsCandidates.size > 0) {
              const statsText = fallback.sourceStats
                .map((item) => `${item.sourceLabel}:${item.added}/${item.total}`)
                .join(", ");
              console.error(`[flux:${taskKey}] Fallback: extracted ${goodsCandidates.size} goodsIds from local stores (${statsText || "no-stats"})`);
            }
          } catch (fallbackErr) {
            console.error(`[flux:${taskKey}] Fallback goodsIds read failed: ${fallbackErr?.message || fallbackErr}`);
          }
        } else {
          console.error(`[flux:${taskKey}] Skip store-fallback: tbody empty (goods/list 未恢复)`);
        }
      }

      if (goodsCandidates.size > 0) {
        console.error(`[flux:${taskKey}] Fetching daily trends for ${goodsCandidates.size} products via SPA-triggered goods/detail...`);
        const dailyCache = {};
        let fetchedCount = 0;
        const siteLabel = target.siteLabel || "全球";

        // --- 打印 SPA 真实请求模板，辅助定位 ---
        console.error(`[flux:${taskKey}] capturedFluxRequestTemplate: ${JSON.stringify(capturedFluxRequestTemplate || {})}`);
        console.error(`[flux:${taskKey}] capturedFullRequestByPath keys: ${JSON.stringify(Array.from(capturedFullRequestByPath.keys()))}`);

        // === 全上下文响应监听：trend/detail 可能在 popup / new page / iframe ===
        // 主 page.on("response") 收不到，必须给 context 里所有当前 + 未来 page 挂监听
        const trendRespCache = []; // { path, url, status, ct, json }
        const ctxRespHandler = async (resp) => {
          try {
            const u = resp.url();
            const p = new URL(u).pathname;
            if (!p.includes("/flow/analysis/")) return;
            const status = resp.status();
            const ct = resp.headers()["content-type"] || "";
            let bodyText = "";
            try {
              const buf = await resp.body();
              if (buf) bodyText = buf.toString("utf8");
            } catch {}
            let json = null;
            try { json = bodyText ? JSON.parse(bodyText) : null; } catch {}
            trendRespCache.push({ path: p, url: u, status, ct, bodyLen: bodyText.length, json });
            console.error(`[flux:${taskKey}] CTX-RESP ${p} status=${status} ct=${ct} bodyLen=${bodyText.length} bodyHead=${bodyText.slice(0, 240).replace(/\s+/g, " ")}`);
          } catch (e) {
            console.error(`[flux:${taskKey}] CTX-RESP handler error: ${e?.message}`);
          }
        };
        const ctx = page.context();
        for (const pg of ctx.pages()) {
          pg.on("response", ctxRespHandler);
        }
        const ctxNewPageHandler = (newPg) => {
          console.error(`[flux:${taskKey}] CTX new page: ${newPg.url()}`);
          newPg.on("response", ctxRespHandler);
        };
        ctx.on("page", ctxNewPageHandler);

        // --- 第 1 步：让 SPA 自己发一次 goods/detail，从而拿到真实 body 模板 ---
        // 默认列表页 SPA 不会自动发 detail，必须模拟用户点商品行进入详情。
        // 多策略：Playwright 原生 click（能触发 React synthetic events），失败再降级。
        const firstGoodsId = goodsCandidates.keys().next().value;
        console.error(`[flux:${taskKey}] Triggering SPA detail (goodsId=${firstGoodsId}) with multi-strategy click...`);

        // 先 dump 第一行的 DOM 结构，失败时我们就能一眼看到该点哪里
        try {
          const domSnapshot = await page.evaluate(() => {
            const firstRow = document.querySelector("tbody tr") || document.querySelector("[role='row']:nth-of-type(2)");
            if (!firstRow) return { rowFound: false };
            const links = Array.from(firstRow.querySelectorAll("a")).map((a) => ({
              href: a.getAttribute("href") || "",
              text: (a.textContent || "").trim().slice(0, 40),
              cls: a.className || "",
            }));
            const buttons = Array.from(firstRow.querySelectorAll("button, [role='button']")).map((b) => ({
              text: (b.textContent || "").trim().slice(0, 40),
              cls: b.className || "",
            }));
            const clickables = Array.from(firstRow.querySelectorAll("[class*='link'], [class*='clickable'], [class*='goods'], [class*='product']")).slice(0, 6).map((el) => ({
              tag: el.tagName,
              text: (el.textContent || "").trim().slice(0, 40),
              cls: el.className || "",
            }));
            return {
              rowFound: true,
              outerHead: (firstRow.outerHTML || "").slice(0, 600),
              links, buttons, clickables,
            };
          });
          console.error(`[flux:${taskKey}] DOM snapshot: ${JSON.stringify(domSnapshot).slice(0, 1200)}`);
        } catch (e) {
          console.error(`[flux:${taskKey}] DOM snapshot failed: ${e?.message}`);
        }

        // 优先匹配 goods/trend（真正的按日趋势 API），没有才退到 goods/detail
        const waitForDetailReq = async (beforeKeys, timeoutMs) => {
          const deadline = Date.now() + timeoutMs;
          const matchOrder = ["/flow/analysis/goods/trend", "/flow/analysis/goods/detail"];
          while (Date.now() < deadline) {
            for (const keyword of matchOrder) {
              for (const [path, req] of capturedFullRequestByPath.entries()) {
                if (path.includes(keyword) && (!beforeKeys.has(path) || (req.capturedAt && req.capturedAt > Date.now() - timeoutMs))) {
                  return req;
                }
              }
            }
            await randomDelay(250, 400);
          }
          return null;
        };

        const strategies = [
          {
            name: "first-row-anchor",
            run: async () => {
              const loc = page.locator("tbody tr").first().locator("a").first();
              if (await loc.count() === 0) return false;
              await loc.scrollIntoViewIfNeeded().catch(() => {});
              await loc.click({ timeout: 4000, force: true });
              return true;
            },
          },
          {
            name: "text-in-first-row",
            run: async () => {
              const loc = page.locator("tbody tr").first().getByText(/详情|流量|分析|查看|详细/).first();
              if (await loc.count() === 0) return false;
              await loc.click({ timeout: 4000, force: true });
              return true;
            },
          },
          {
            name: "first-row-click",
            run: async () => {
              const loc = page.locator("tbody tr").first();
              if (await loc.count() === 0) return false;
              await loc.scrollIntoViewIfNeeded().catch(() => {});
              await loc.click({ timeout: 4000, force: true });
              return true;
            },
          },
          {
            name: "first-row-dblclick",
            run: async () => {
              const loc = page.locator("tbody tr").first();
              if (await loc.count() === 0) return false;
              await loc.dblclick({ timeout: 4000, force: true });
              return true;
            },
          },
          {
            name: "any-anchor-with-goodsid",
            run: async () => {
              const loc = page.locator(`a[href*="${firstGoodsId}"]`).first();
              if (await loc.count() === 0) return false;
              await loc.click({ timeout: 4000, force: true });
              return true;
            },
          },
        ];

        let detailReq = null;
        let usedStrategy = null;
        for (const s of strategies) {
          const beforeKeys = new Set(capturedFullRequestByPath.keys());
          try {
            const ran = await s.run();
            if (!ran) {
              console.error(`[flux:${taskKey}] strategy ${s.name}: no element found`);
              continue;
            }
            console.error(`[flux:${taskKey}] strategy ${s.name}: clicked, waiting for goods/detail...`);
            detailReq = await waitForDetailReq(beforeKeys, 8000);
            if (detailReq) {
              usedStrategy = s.name;
              console.error(`[flux:${taskKey}] ✓ strategy ${s.name} triggered goods/detail`);
              break;
            }
            // 关抽屉/弹窗，下一策略再来
            await page.keyboard.press("Escape").catch(() => {});
            await randomDelay(500, 800);
          } catch (e) {
            console.error(`[flux:${taskKey}] strategy ${s.name} threw: ${e?.message}`);
            await page.keyboard.press("Escape").catch(() => {});
            await randomDelay(400, 600);
          }
        }

        // body 可能是 null（postData 非 JSON），但 rawBody 通常有；尝试从 rawBody 兜底 parse
        if (detailReq && !detailReq.body && detailReq.rawBody) {
          try {
            detailReq.body = JSON.parse(detailReq.rawBody);
            console.error(`[flux:${taskKey}] detailReq.body was null, recovered from rawBody: ${detailReq.rawBody.slice(0, 300)}`);
          } catch {
            console.error(`[flux:${taskKey}] detailReq.rawBody is NOT JSON: ${String(detailReq.rawBody).slice(0, 300)}`);
          }
        }
        // 诊断：把所有 flow/analysis 捕获请求的完整 URL（含 query）+ method + rawBody 打印一次
        for (const [path, req] of capturedFullRequestByPath.entries()) {
          if (path.includes("/flow/analysis/")) {
            const raw = req.rawBody ? String(req.rawBody).slice(0, 300) : "(no postData)";
            const method = req.method || "?";
            console.error(`[flux:${taskKey}] CAPTURED ${method} ${req.url} rawBody=${raw}`);
          }
        }

        // === 等 click 触发的 popup/response 全部回来，再 dump trendRespCache ===
        await randomDelay(3000, 4000);
        console.error(`[flux:${taskKey}] CTX pages count: ${ctx.pages().length}`);
        for (const pg of ctx.pages()) {
          console.error(`[flux:${taskKey}] CTX page url: ${pg.url()}`);
        }
        console.error(`[flux:${taskKey}] trendRespCache size: ${trendRespCache.length}`);
        for (const r of trendRespCache.slice(-6)) {
          const result = r.json?.result;
          const resultKeys = result && typeof result === "object" ? Object.keys(result).join(",") : typeof result;
          console.error(`[flux:${taskKey}] CACHE ${r.path} status=${r.status} bodyLen=${r.bodyLen} resultKeys=${resultKeys}`);
          if (result && typeof result === "object") {
            for (const [k, v] of Object.entries(result)) {
              if (Array.isArray(v) && v.length > 0) {
                console.error(`[flux:${taskKey}] CACHE ${r.path} result.${k} array len=${v.length} firstKeys=${Object.keys(v[0] || {}).join(",")} first=${JSON.stringify(v[0]).slice(0, 400)}`);
              }
            }
          }
        }

        // === 旧诊断（保留）：从 capturedApis 找 trend/detail ===
        const trendResponses = capturedApis.filter((e) => e.path && (e.path.includes("/flow/analysis/goods/trend") || e.path.includes("/flow/analysis/goods/detail")));
        console.error(`[flux:${taskKey}] trend/detail responses captured so far: ${trendResponses.length}`);
        for (const r of trendResponses.slice(-3)) {
          const result = r.data?.result;
          const resultKeys = result && typeof result === "object" ? Object.keys(result).join(",") : typeof result;
          console.error(`[flux:${taskKey}] RESP ${r.path} resultKeys=${resultKeys}`);
          if (result && typeof result === "object") {
            for (const [k, v] of Object.entries(result)) {
              if (Array.isArray(v)) {
                console.error(`[flux:${taskKey}] RESP ${r.path} result.${k} isArray len=${v.length} first=${JSON.stringify(v[0] || null).slice(0, 400)}`);
              } else if (typeof v === "object" && v !== null) {
                console.error(`[flux:${taskKey}] RESP ${r.path} result.${k} keys=${Object.keys(v).join(",")} sample=${JSON.stringify(v).slice(0, 300)}`);
              }
            }
            console.error(`[flux:${taskKey}] RESP ${r.path} FULL (first 800)= ${JSON.stringify(result).slice(0, 800)}`);
          }
        }

        // === 真正的采集逻辑：循环 click 每行商品，等 goods/trend 响应，提取按日数据 ===
        // trend.result 结构（已验证）：
        //   trendList[0] = { key:"近7日", trendList:[{time,value}] }    ← 7 天总曝光
        //   channelList[i] = { key:"搜索"|"推荐"|"其它", trendList:[...] } ← 7 天分渠道
        // 必须先关掉前面 click 打开的抽屉
        const closeDrawer = async () => {
          await page.keyboard.press("Escape").catch(() => {});
          await randomDelay(400, 700);
          try {
            const closeBtn = page.locator('[aria-label="Close"], [aria-label="关闭"], [class*="closeIcon"], [class*="close-icon"]').first();
            if (await closeBtn.count() > 0) {
              await closeBtn.click({ timeout: 1500, force: true }).catch(() => {});
            }
          } catch {}
          await randomDelay(300, 500);
        };

        await closeDrawer();

        // === 直接 fetch 模式：从 window.__fluxCapturedBodies 读 trend/detail 的真实 body 模板 ===
        // 关闭抽屉后，trigger 阶段 SPA 已经 fetch 过 detail+trend，body 必然在 hook map 里
        const capturedBodies = await page.evaluate(() => window.__fluxCapturedBodies || {});
        console.error(`[flux:${taskKey}] HOOK captured paths: ${JSON.stringify(Object.keys(capturedBodies))}`);
        const trendKey = Object.keys(capturedBodies).find((k) => k.includes("/goods/trend"));
        const detailKey = Object.keys(capturedBodies).find((k) => k.includes("/goods/detail"));
        const trendTpl = trendKey ? capturedBodies[trendKey] : null;
        const detailTpl = detailKey ? capturedBodies[detailKey] : null;
        console.error(`[flux:${taskKey}] HOOK trend captured: ${!!trendTpl} body=${trendTpl?.bodyText ? trendTpl.bodyText.slice(0, 400) : "(none)"}`);
        console.error(`[flux:${taskKey}] HOOK detail captured: ${!!detailTpl} body=${detailTpl?.bodyText ? detailTpl.bodyText.slice(0, 400) : "(none)"}`);

        if (!trendTpl?.bodyText && !detailTpl?.bodyText) {
          console.error(`[flux:${taskKey}] FAILED: no fetch hook captures from trigger phase, abort.`);
        } else {
          const goodsIdsArr = Array.from(goodsCandidates.keys());
          console.error(`[flux:${taskKey}] DIRECT-FETCH start: ${goodsIdsArr.length} products`);
          // 探测 goodsId 字段名
          let goodsIdField = null;
          if (trendTpl?.bodyText) {
            try {
              const obj = JSON.parse(trendTpl.bodyText);
              for (const k of ["goodsId", "goodsIdList", "spuId", "productId"]) {
                if (k in obj) { goodsIdField = k; break; }
              }
              console.error(`[flux:${taskKey}] trend body keys: ${Object.keys(obj).join(",")}, goodsIdField=${goodsIdField}`);
            } catch {}
          }
          if (!goodsIdField && detailTpl?.bodyText) {
            try {
              const obj = JSON.parse(detailTpl.bodyText);
              for (const k of ["goodsId", "goodsIdList", "spuId", "productId"]) {
                if (k in obj) { goodsIdField = k; break; }
              }
              console.error(`[flux:${taskKey}] detail body keys: ${Object.keys(obj).join(",")}, goodsIdField=${goodsIdField}`);
            } catch {}
          }
          if (!goodsIdField) goodsIdField = "goodsId"; // 默认猜测

          for (let i = 0; i < goodsIdsArr.length; i++) {
            const goodsId = goodsIdsArr[i];
            const meta = goodsCandidates.get(goodsId) || {};
            try {
              // 同时调 trend + detail（trend 是按日真数据，detail 是站点维度兜底）
              const result = await page.evaluate(async ({ trendTpl, detailTpl, goodsId, field }) => {
                const buildBody = (tpl) => {
                  if (!tpl?.bodyText) return null;
                  try {
                    const obj = JSON.parse(tpl.bodyText);
                    if (field === "goodsIdList") obj[field] = [String(goodsId)];
                    else obj[field] = String(goodsId);
                    return JSON.stringify(obj);
                  } catch { return null; }
                };
                const callApi = async (tpl, body) => {
                  if (!tpl || !body) return null;
                  try {
                    const r = await fetch(tpl.url, {
                      method: tpl.method || "POST",
                      headers: { ...(tpl.headers || {}), "content-type": "application/json" },
                      body,
                      credentials: "include",
                    });
                    return await r.json();
                  } catch (e) { return { __err: String(e?.message || e) }; }
                };
                const trendBody = buildBody(trendTpl);
                const detailBody = buildBody(detailTpl);
                const [trendRes, detailRes] = await Promise.all([
                  callApi(trendTpl, trendBody),
                  callApi(detailTpl, detailBody),
                ]);
                return { trendRes, detailRes };
              }, { trendTpl, detailTpl, goodsId, field: goodsIdField });

              const dailyMap = {};
              let usedTrend = false;
              let usedDetail = false;
              const tr = result?.trendRes?.result;
              if (tr && result.trendRes.success !== false) {
                usedTrend = true;
                const totalTrend = (tr.trendList || []).find((x) => x.key === "近7日") || (tr.trendList || [])[0];
                for (const pt of (totalTrend?.trendList || [])) {
                  const date = pt.time;
                  if (!date) continue;
                  dailyMap[date] = dailyMap[date] || { date };
                  dailyMap[date].exposeNum = Number(pt.value || 0);
                }
                for (const ch of (tr.channelList || [])) {
                  const key = ch.key === "搜索" ? "searchExposeNum"
                            : ch.key === "推荐" ? "recommendExposeNum"
                            : ch.key === "其它" ? "otherExposeNum"
                            : null;
                  if (!key) continue;
                  for (const pt of (ch.trendList || [])) {
                    const date = pt.time;
                    if (!date) continue;
                    dailyMap[date] = dailyMap[date] || { date };
                    dailyMap[date][key] = Number(pt.value || 0);
                  }
                }
              }
              const dr = result?.detailRes?.result;
              if (dr && result.detailRes.success !== false) {
                usedDetail = true;
                const list = dr.list || dr.dataList || [];
                for (const row of list) {
                  const date = row.statDate || row.date || row.time;
                  if (!date) continue;
                  dailyMap[date] = dailyMap[date] || { date };
                  // 基础流量
                  if (row.exposeNum != null && dailyMap[date].exposeNum == null) dailyMap[date].exposeNum = Number(row.exposeNum || 0);
                  if (row.clickNum != null) dailyMap[date].clickNum = Number(row.clickNum || 0);
                  if (row.searchExposeNum != null && dailyMap[date].searchExposeNum == null) dailyMap[date].searchExposeNum = Number(row.searchExposeNum || 0);
                  if (row.recommendExposeNum != null && dailyMap[date].recommendExposeNum == null) dailyMap[date].recommendExposeNum = Number(row.recommendExposeNum || 0);
                  if (row.otherExposeNum != null && dailyMap[date].otherExposeNum == null) dailyMap[date].otherExposeNum = Number(row.otherExposeNum || 0);
                  // 详情访客 / 加购 / 收藏
                  if (row.goodsDetailVisitNum != null) dailyMap[date].detailVisitNum = Number(row.goodsDetailVisitNum || 0);
                  if (row.goodsDetailVisitorNum != null) dailyMap[date].detailVisitorNum = Number(row.goodsDetailVisitorNum || 0);
                  if (row.addToCartUserNum != null) dailyMap[date].addToCartUserNum = Number(row.addToCartUserNum || 0);
                  if (row.collectUserNum != null) dailyMap[date].collectUserNum = Number(row.collectUserNum || 0);
                  // 支付转化
                  if (row.payGoodsNum != null) dailyMap[date].payGoodsNum = Number(row.payGoodsNum || 0);
                  if (row.payOrderNum != null) dailyMap[date].payOrderNum = Number(row.payOrderNum || 0);
                  if (row.buyerNum != null) dailyMap[date].buyerNum = Number(row.buyerNum || 0);
                  // 转化率（后端已算好；前端可直接用，无需再除）
                  if (row.exposePayConversionRate != null) dailyMap[date].exposePayConversionRate = Number(row.exposePayConversionRate || 0);
                  if (row.exposeClickConversionRate != null) dailyMap[date].exposeClickConversionRate = Number(row.exposeClickConversionRate || 0);
                  if (row.clickPayConversionRate != null) dailyMap[date].clickPayConversionRate = Number(row.clickPayConversionRate || 0);
                }
              }
              const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

              if (daily.length === 0) {
                const trendErr = result?.trendRes?.errorCode || result?.trendRes?.__err || "?";
                const detailErr = result?.detailRes?.errorCode || result?.detailRes?.__err || "?";
                console.error(`[flux:${taskKey}] FETCH#${i} goodsId=${goodsId} EMPTY trend.err=${trendErr} detail.err=${detailErr}`);
                continue;
              }

              dailyCache[goodsId] = {
                goodsId,
                productId: String(meta?.productSpuId || "").trim(),
                productSkcId: String(meta?.productSkcId || "").trim(),
                productSkuId: String(meta?.productSkuId || "").trim(),
                title: String(meta?.title || "").trim(),
                stations: { [siteLabel]: { daily } },
              };
              fetchedCount++;
              if (i < 3 || i === goodsIdsArr.length - 1 || i % 10 === 0) {
                console.error(`[flux:${taskKey}] FETCH#${i} goodsId=${goodsId} OK trend=${usedTrend} detail=${usedDetail} daily.len=${daily.length} sample=${JSON.stringify(daily[0] || {})}`);
              }
            } catch (e) {
              console.error(`[flux:${taskKey}] FETCH#${i} goodsId=${goodsId} error: ${e?.message}`);
            }
            // 节流，避免触发 4000004
            await randomDelay(350, 600);
          }
        }

        if (Object.keys(dailyCache).length > 0) {
          console.error(`[flux:${taskKey}] SUCCESS: ${Object.keys(dailyCache).length}/${goodsCandidates.size} products fetched via direct fetch`);
          capturedApis.push({
            path: "__flux_product_daily_cache__",
            data: { result: dailyCache },
            rangeLabel: "__daily__",
          });
        } else {
          console.error(`[flux:${taskKey}] FAILED: no products fetched.`);
        }
      }
    } catch (dailyErr) {
      console.error(`[flux:${taskKey}] Daily trend fetch failed:`, dailyErr?.message);
    }

    return {
      apis: capturedApis,
      meta: {
        siteLabel: target.siteLabel,
        rangeLabel: primaryRangeLabel,
      },
      availableRanges,
    };
  } finally {
    await responseTracker.drain(2000);
    await page.close().catch(() => {});
  }
}

// ---- 注册表采集辅助（供 scrape_all 使用） ----
const _scrapeExecutors = () => ({
  scrapePageCaptureAll,
  scrapeSidebarCaptureAll,
  scrapePageWithListener,
  scrapeGovernPage: (subPath, meta) => scrapeSingleGovernTarget(subPath, meta),
  scrapeCustomTask,
  ensureBrowser,
});
const _registryScrape = (key) => {
  const fn = getScrapeFunction(key, _scrapeExecutors());
  if (!fn) throw new Error(`scrape registry: no entry for '${key}'`);
  return fn();
};

// ---- HTTP 服务 ----

async function handleRequest(body) {
  const { action, params = {} } = body;
  switch (action) {
    case "ping": return { status: "pong" };
    case "set_ai_image_server": {
      // 主进程在 image studio URL 变化时调用此动作，热更新 AI 出图地址，不需重启 worker
      const next = typeof params?.url === "string" ? params.url.trim().replace(/\/+$/, "") : "";
      if (!next) {
        return { status: "noop", reason: "empty url" };
      }
      const prev = AI_IMAGE_GEN_URL;
      AI_IMAGE_GEN_URL = next;
      process.env.AI_IMAGE_SERVER = next;
      console.error(`[Worker] AI_IMAGE_GEN_URL updated: ${prev} -> ${next}`);
      return { status: "updated", previous: prev, current: next };
    }
    case "launch": await launch(params.accountId, params.headless); return { status: "launched" };
    case "login": await launch(params.accountId, params.headless); return { success: await loginWithTransientPassword(params.phone, params.password) };
    case "scrape_products": {
      console.error("[Worker] scrape_products called, browser:", !!browser, "context:", !!context);
      try {
        await ensureBrowser();
        console.error("[Worker] ensureBrowser done, browser:", !!browser, "context:", !!context);
      } catch (e) {
        console.error("[Worker] ensureBrowser error:", e.message);
        throw new Error("浏览器启动失败: " + e.message);
      }
      return await _registryScrape("products");
    }
    case "scrape_orders": {
      await ensureBrowser();
      return await _registryScrape("orders");
    }
    case "capture_api": {
      // 捕获页面加载时的 API 请求
      await ensureBrowser();
      const targetUrl = params.url || "https://agentseller.temu.com/stock/fully-mgt/order-manage-urgency";
      return await captureApiRequests(targetUrl);
    }
    case "discover_pages": {
      // 自动发现所有页面和 API
      await ensureBrowser();
      return await handleRequest({ action: "scan_menu", params });
    }
    case "deep_probe": {
      // 深度探测 iframe 页面
      await ensureBrowser();
      const defaultPages = [
        { name: "数据中心", url: "https://agentseller.temu.com/main/data-center" },
        { name: "账户资金", url: "https://agentseller.temu.com/main/finance/account-center" },
        { name: "收入明细", url: "https://agentseller.temu.com/main/finance/income-detail" },
        { name: "账单", url: "https://agentseller.temu.com/main/finance/bill" },
        { name: "质量中心", url: "https://agentseller.temu.com/main/quality-center" },
        { name: "质量分", url: "https://agentseller.temu.com/main/quality-score" },
        { name: "优惠券中心", url: "https://agentseller.temu.com/main/coupon-center" },
        { name: "店铺装修", url: "https://agentseller.temu.com/main/shop-decoration" },
        { name: "库存管理", url: "https://agentseller.temu.com/goods/inventory/manage" },
        { name: "仓库库存管理", url: "https://agentseller.temu.com/wms/inventory-manage" },
        { name: "履约看板", url: "https://agentseller.temu.com/stock/fully-mgt/sale-manage/board/promise-board" },
        { name: "商品数据", url: "https://agentseller.temu.com/main/goods-analysis" },
        { name: "活动数据", url: "https://agentseller.temu.com/main/activity-analysis" },
        { name: "流量分析", url: "https://agentseller.temu.com/main/flux-analysis" },
      ];
      const pageEntries = (params.pages || defaultPages)
        .map((page) => {
          if (typeof page === "string") {
            return page.startsWith("/") ? { name: page, path: page } : null;
          }
          const rawPath = page?.path || page?.url;
          if (!rawPath || typeof rawPath !== "string") return null;
          try {
            const parsed = rawPath.startsWith("http")
              ? new URL(rawPath)
              : new URL(rawPath, "https://agentseller.temu.com");
            return { ...page, path: `${parsed.pathname}${parsed.search}` };
          } catch {
            return rawPath.startsWith("/") ? { ...page, path: rawPath } : null;
          }
        })
        .filter(Boolean);
      const results = await handleRequest({
        action: "probe_batch",
        params: { paths: pageEntries.map((page) => page.path) },
      });
      return { pages: pageEntries, results, total: pageEntries.length };
    }
    case "scrape_sales": {
      await ensureBrowser();
      return { sales: await scrapeSales() };
    }
    case "scrape_lifecycle": {
      await ensureBrowser();
      return { lifecycle: await scrapeLifecycle() };
    }
    case "scrape_global_performance": {
      // 全球业务表现：调 Temu 卖家中心 调价/订单 内部接口，按国家聚合，写入 scrape_all_globalPerformance.json
      // 用户可选时间范围 30d / 7d / 1d (params.range)，默认 30d
      const range = String(params?.range || "30d");
      const result = await scrapeGlobalPerformance({ range });
      try {
        const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
        fs.mkdirSync(debugDir, { recursive: true });
        fs.writeFileSync(path.join(debugDir, "scrape_all_globalPerformance.json"), JSON.stringify(result));
      } catch (e) {
        console.error(`[scrape_global_performance] persist failed: ${e.message}`);
      }
      return result;
    }
    case "scrape_flux_product_detail": {
      return await scrapeFluxProductDetail(params || {});
    }
    case "scrape_one": {
      // 临时调试 action：直接跑 _registryScrape(key)，不需要登录 establishSession
      await ensureBrowser();
      const key = params?.key;
      if (!key) throw new Error("scrape_one: key required");
      const result = await _registryScrape(key);
      return { key, result };
    }
    case "scrape_skc_region_detail": {
      const productId = params?.productId || params?.pid;
      const range = String(params?.range || "30d");
      return await scrapeSkcRegionDetail({ productId, range });
    }
    case "yundu_list_overall": return await yunduListOverall(params || {});
    case "yundu_sniff_discover": return await yunduSniffDiscover(params || {});
    case "yundu_raw": {
      const p = params || {};
      const pg = await _yunduOpenPage();
      const r = await _yunduFetch(pg, p.path, p.body || {});
      return { status: r?.status, body: r?.body };
    }
    case "yundu_site_count": return await yunduSiteCount(params || {});
    case "yundu_high_price_limit": return await yunduHighPriceLimit(params || {});
    case "yundu_quality_metrics": return await yunduQualityMetrics(params || {});
    case "yundu_activity_list": return await yunduActivityList(params || {});
    case "yundu_activity_enrolled": return await yunduActivityEnrolled(params || {});
    case "yundu_activity_match": return await yunduActivityMatch(params || {});
    case "yundu_activity_submit": return await yunduActivitySubmit(params || {});
    case "yundu_auto_enroll": return await yunduAutoEnroll(params || {});
    case "sidebar_nav": {
      await ensureBrowser();
      return await scrapeViaSidebarClick();
    }
    case "scrape_all": {
      const scrapeStartedAt = getScrapeAllTimestamp();
      replaceScrapeAllProgress({
        running: true,
        status: "warming",
        message: "正在建立采集会话",
        startedAt: scrapeStartedAt,
        finishedAt: "",
        tasks: {},
      });

      try {
      if (params.credentials?.phone) {
        console.error(`[scrape_all] Received credentials for ${params.credentials.phone.slice(0, 3)}***`);
      }
      await ensureBrowser();
      console.error("[scrape_all] Step 1: Setup popup monitor + establish session...");
      const stopPopupMonitor = registerSellerAuthPopupMonitor("[popup-monitor]");
      try {
        await establishSellerCentralSession("[scrape_all]");
      } catch (error) {
        throw new Error(`登录超时或授权未完成：${error.message}`);
      }

      // Step 2: 并发执行采集，限制并发避免风控
      const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
      fs.mkdirSync(debugDir, { recursive: true });
      // ★ 启用 lite 模式：后续所有 navigateToSellerCentral 都用简化流程
      _navLiteMode = true;
      const results = {};
      try {
      console.error("[scrape_all] Step 2: Running all scrapers with popup monitor + lite nav...");
      const governSplitIndex = Math.ceil(GOVERN_GROUP_TARGETS.length / 2);
      const governBundleATargets = GOVERN_GROUP_TARGETS.slice(0, governSplitIndex);
      const governBundleBTargets = GOVERN_GROUP_TARGETS.slice(governSplitIndex);
      const adsBundleKeys = ADS_GROUP_TABS.map(({ key }) => key);
      const tasks = [
        // ---- 核心运营数据 ----
        { key: "dashboard", fn: () => _registryScrape("dashboard") },
        { key: "products", fn: () => _registryScrape("products") },
        { key: "orders", fn: () => _registryScrape("orders") },
        { key: "sales", fn: () => scrapeSales() },
        { key: "salesChart", fn: () => _registryScrape("salesChart") },
        { key: "flux", fn: () => _registryScrape("flux") },
        { key: "goodsData", fn: () => _registryScrape("goodsData") },
        { key: "activity", fn: () => _registryScrape("activity") },
        { key: "afterSales", fn: () => _registryScrape("aftersales") },
        { key: "soldout", fn: () => _registryScrape("soldout") },
        { key: "performance", fn: () => _registryScrape("performance") },
        // ---- 扩展采集 ----
        { key: "lifecycle", fn: () => scrapeLifecycle() },
        { key: "priceCompete", fn: () => _registryScrape("priceCompete") },
        { key: "urgentOrders", fn: () => _registryScrape("urgentOrders") },
        { key: "delivery", fn: () => _registryScrape("delivery") },
        { key: "salesReturn", fn: () => _registryScrape("salesReturn") },
        { key: "priceReport", fn: () => _registryScrape("priceReport") },
        { key: "flowPrice", fn: () => _registryScrape("flowPrice") },
        { key: "imageTask", fn: () => _registryScrape("imageTask") },
        { key: "checkup", fn: () => _registryScrape("checkup") },
        { key: "usRetrieval", fn: () => _registryScrape("usRetrieval") },
        { key: "retailPrice", fn: () => _registryScrape("retailPrice") },
        { key: "qualityDashboard", fn: () => _registryScrape("qualityDashboard") },
        { key: "qualityDashboardEU", fn: () => _registryScrape("qualityDashboardEU") },
        { key: "qcDetail", fn: () => scrapeQcDetail() },
        { key: "mallFlux", fn: () => _registryScrape("mallFlux") },
        { key: "mallFluxEU", fn: () => _registryScrape("mallFluxEU") },
        { key: "fluxEU", fn: () => _registryScrape("fluxEU") },
        { key: "fluxUS", fn: () => _registryScrape("fluxUS") },
        { key: "mallFluxUS", fn: () => _registryScrape("mallFluxUS") },
        { key: "activityLog", fn: () => _registryScrape("activityLog") },
        { key: "chanceGoods", fn: () => _registryScrape("chanceGoods") },
        { key: "marketingActivity", fn: () => _registryScrape("marketingActivity") },
        { key: "flowGrow", fn: () => _registryScrape("flowGrow") },
        { key: "activityUS", fn: () => _registryScrape("activityUS") },
        { key: "activityEU", fn: () => _registryScrape("activityEU") },
        // ---- 云舵套件（已加站点 / 处罚 / 可报活动 / 质量指标）----
        { key: "globalPerformance", fn: () => scrapeGlobalPerformance({ range: "7d" }) },
        { key: "yunduOverall", fn: () => yunduListOverall({ pageNo: 1, pageSize: 200 }) },
        { key: "yunduActivityList", fn: () => yunduActivityList({ pageNum: 1, pageSize: 100 }) },
        { key: "yunduQualityMetrics", fn: () => yunduQualityMetrics({ pageNum: 1, pageSize: 100 }) },
        {
          key: "sidebarBundleOps",
          expectedKeys: ["sampleManage", "addressManage", "shippingDesk", "shippingList"],
          fn: () => scrapeSidebarPages(["sampleManage", "addressManage", "shippingDesk", "shippingList"]),
          expandResults: true
        },
        {
          key: "sidebarBundleReturns",
          expectedKeys: ["exceptionNotice", "returnDetail", "returnOrders", "returnReceipt"],
          fn: () => scrapeSidebarPages(["exceptionNotice", "returnDetail", "returnOrders", "returnReceipt"]),
          expandResults: true
        },
        // ---- 合规中心 ----
        { key: "governDashboard", fn: () => scrapeGovernDashboard() },
        {
          key: "governBundleA",
          expectedKeys: governBundleATargets.map(({ key }) => key),
          fn: () => scrapeGovernTaskGroup(governBundleATargets),
          expandResults: true
        },
        {
          key: "governBundleB",
          expectedKeys: governBundleBTargets.map(({ key }) => key),
          fn: () => scrapeGovernTaskGroup(governBundleBTargets),
          expandResults: true
        },
        // ---- 推广平台 ----
        { key: "adsBundle", expectedKeys: adsBundleKeys, fn: () => scrapeAdsTaskGroup(), expandResults: true },
      ];
      const priorityOrder = new Map([
        ["dashboard", 1],
        ["products", 2],
        ["orders", 3],
        ["sales", 4],
        ["flux", 5],
        ["goodsData", 6],
        ["activityUS", 7],
        ["activityEU", 8],
        ["governDashboard", 9],
        ["governBundleA", 10],
        ["governBundleB", 11],
        ["adsBundle", 12],
        ["sidebarBundleOps", 13],
        ["sidebarBundleReturns", 14],
        ["flowPrice", 15],
      ]);
      tasks.sort((a, b) => (priorityOrder.get(a.key) ?? 999) - (priorityOrder.get(b.key) ?? 999));
      const trackedTaskKeys = tasks.flatMap((task) => Array.isArray(task.expectedKeys) && task.expectedKeys.length > 0 ? task.expectedKeys : [task.key]);
      replaceScrapeAllProgress({
        running: true,
        status: "running",
        message: `正在采集 ${trackedTaskKeys.length} 项任务`,
        startedAt: scrapeStartedAt,
        tasks: Object.fromEntries(trackedTaskKeys.map((taskKey) => [taskKey, { status: "pending", message: "排队中" }])),
      });
      const CONCURRENCY = 12;
      const queue = [...tasks];
      const running = [];

      const runNext = () => {
        const task = queue.shift();
        if (!task) return null;
        const startMs = Date.now();
        console.error(`[scrape_all] Starting: ${task.key}`);
        const taskProgressKeys = Array.isArray(task.expectedKeys) && task.expectedKeys.length > 0
          ? task.expectedKeys
          : [task.key];
        for (const progressKey of taskProgressKeys) {
          updateScrapeAllTask(progressKey, {
            status: "running",
            message: "采集中",
            startedAt: getScrapeAllTimestamp(),
            finishedAt: "",
          });
        }
        const writeScrapeAllResult = (resultKey, payload, dur) => {
          if (payload && !payload.error) {
            const dataFile = path.join(debugDir, `scrape_all_${resultKey}.json`);
            try { fs.writeFileSync(dataFile, JSON.stringify(payload)); } catch (e) { console.error(`[scrape_all] Failed to save ${resultKey}:`, e.message); }
            const dataSize = JSON.stringify(payload || {}).length;
            results[resultKey] = { success: true, duration: dur, dataFile, dataSize };
            updateScrapeAllTask(resultKey, {
              status: "success",
              message: `已完成 · ${dur}s`,
              duration: dur,
              dataSize,
              finishedAt: getScrapeAllTimestamp(),
            });
            return;
          }
          const errorMessage = payload?.error || "采集失败";
          results[resultKey] = { success: false, error: errorMessage, duration: dur };
          updateScrapeAllTask(resultKey, {
            status: "error",
            message: errorMessage,
            duration: dur,
            finishedAt: getScrapeAllTimestamp(),
          });
        };
        const runWithRetry = async (fn, maxRetries = getConfiguredMaxRetries()) => {
          let lastErr;
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              return await fn();
            } catch (err) {
              lastErr = err;
              if (attempt < maxRetries) {
                const delay = 2000 * (attempt + 1);
                console.error(`[scrape_all] ↻ ${task.key} retry ${attempt + 1}/${maxRetries} in ${delay}ms: ${err.message}`);
                await new Promise(r => setTimeout(r, delay));
              }
            }
          }
          throw lastErr;
        };
        const p = Promise.resolve()
          .then(() => runWithRetry(task.fn))
          .then(data => {
            const dur = Math.round((Date.now() - startMs) / 1000);
            console.error(`[scrape_all] ✓ ${task.key} done in ${dur}s`);
            if (task.expandResults && data && typeof data === "object" && !Array.isArray(data)) {
              const expectedKeys = Array.isArray(task.expectedKeys) ? task.expectedKeys : Object.keys(data);
              for (const resultKey of expectedKeys) {
                writeScrapeAllResult(resultKey, data[resultKey], dur);
              }
            } else {
              writeScrapeAllResult(task.key, data, dur);
            }
          })
          .catch(err => {
            const dur = Math.round((Date.now() - startMs) / 1000);
            console.error(`[scrape_all] ✗ ${task.key} failed in ${dur}s: ${err.message}`);
            if (Array.isArray(task.expectedKeys) && task.expectedKeys.length > 0) {
              for (const resultKey of task.expectedKeys) {
                results[resultKey] = { success: false, error: err.message, duration: dur };
                updateScrapeAllTask(resultKey, {
                  status: "error",
                  message: err.message || "采集失败",
                  duration: dur,
                  finishedAt: getScrapeAllTimestamp(),
                });
              }
            } else {
              results[task.key] = { success: false, error: err.message, duration: dur };
              updateScrapeAllTask(task.key, {
                status: "error",
                message: err.message || "采集失败",
                duration: dur,
                finishedAt: getScrapeAllTimestamp(),
              });
            }
          })
          .then(() => {
            const idx = running.indexOf(p);
            if (idx !== -1) running.splice(idx, 1);
            const next = runNext();
            if (next) running.push(next);
          });
        return p;
      };

      for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
        const p = runNext();
        if (p) running.push(p);
      }
      while (running.length > 0) await Promise.race(running);
      } finally {
      // 关闭弹窗监控和 lite 模式（即使出错也要清理）
      _navLiteMode = false;
      try { stopPopupMonitor?.(); } catch (e) { console.error("[scrape_all] cleanup error:", e.message); }
      console.error("[popup-monitor] Monitor removed, lite mode off");
      }

      console.error("[scrape_all] All done!", Object.keys(results).map(k => `${k}:${results[k].success}`).join(", "));

      // 采集完成后关闭浏览器
      try {
        if (browser) { await browser.close(); browser = null; context = null; }
        console.error("[scrape_all] Browser closed.");
      } catch (e) { console.error("[scrape_all] Failed to close browser:", e.message); }

      const resultList = Object.values(results);
      const successCount = resultList.filter((item) => item?.success).length;
      const errorCount = resultList.length - successCount;
      updateScrapeAllProgress({
        running: false,
        status: errorCount > 0 ? "completed_with_errors" : "completed",
        message: errorCount > 0 ? `${successCount} 项成功，${errorCount} 项失败` : `${successCount} 项采集完成`,
        finishedAt: getScrapeAllTimestamp(),
      });

      return results;
      } catch (err) {
        updateScrapeAllProgress({
          running: false,
          status: "failed",
          message: err?.message || "采集失败",
          finishedAt: getScrapeAllTimestamp(),
        });
        throw err;
      }
    }
    case "read_scrape_data": {
      const request = resolveReadScrapeDataRequest(params.key);
      if (!request || !fs.existsSync(request.filePath)) return null;
      if (request.type === "csv_preview") {
        const { rows, kind } = readSpreadsheetRows(request.filePath, { defval: "" });
        return { rows, csvPath: request.filePath, fileKind: kind };
      }
      try {
        return JSON.parse(fs.readFileSync(request.filePath, "utf8"));
      } catch (e) {
        console.error(`[read_scrape_data] Failed to parse ${request.filePath}: ${e.message}`);
        return null;
      }
    }
    case "scrape_progress": {
      return scrapeAllProgress;
    }
    case "probe_page": {
      // 探测指定页面的所有业务 API
      await ensureBrowser();
      const targetPath = params.path || "/goods/list";
      const page = await safeNewPage(context);
      const allApis = [];
      const responseTracker = createPendingTaskTracker();
      const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', 'get-leo-config', '_stm', 'msgBox', 'auth/userInfo', 'auth/menu', 'queryTotalExam', 'feedback/entrance', 'rule/unreadNum', 'suggestedPrice', 'checkAbleFeedback', 'queryFeedbackNotReadTotal', 'pop/query', '.js', '.css', '.png', '.svg', '.woff', '.ico', '.jpg', '.gif', '.map', '.webp', 'hm.baidu', 'google', 'favicon', 'hot-update', 'sockjs'];
      try {
        page.on("response", (resp) => {
          responseTracker.track((async () => {
            try {
              const url = resp.url();
              if (frameworkPatterns.some(p => url.includes(p))) return;
              if (!url.includes("agentseller.temu.com") && !url.includes("kuajingmaihuo.com") && !url.includes("bg-")) return;
              if (resp.status() === 200) {
                const ct = resp.headers()["content-type"] || "";
                if (ct.includes("json") || ct.includes("application")) {
                  const body = await resp.json().catch(() => null);
                  if (body) {
                    const u = new URL(url);
                    allApis.push({ path: u.pathname, hasResult: !!body.result, success: body.success, dataKeys: body.result ? Object.keys(body.result).slice(0, 10) : [] });
                  }
                }
              }
            } catch (e) { logSilent("ui.action", e); }
          })());
        });
        await navigateToSellerCentral(page, targetPath);
        await randomDelay(10000, 15000);
        // 关闭弹窗
        for (let i = 0; i < 5; i++) {
          try {
            const btn = page.locator('button:has-text("知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
            if (await btn.isVisible({ timeout: 500 })) await btn.click();
            else break;
          } catch { break; }
        }
        await randomDelay(3000, 5000);
        await responseTracker.drain(3000);
        console.error(`[probe] ${targetPath} => ${allApis.length} APIs captured`);
        return { path: targetPath, apis: allApis };
      } finally {
        await responseTracker.drain(1000).catch(() => {});
        await page.close().catch(() => {});
      }
    }
    case "probe_batch": {
      // 批量探测多个页面
      await ensureBrowser();
      const paths = params.paths || [];
      const results = {};
      for (const p of paths) {
        let page = null;
        let responseTracker = null;
        try {
          page = await safeNewPage(context);
          responseTracker = createPendingTaskTracker();
          const apis = [];
          const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', 'get-leo-config', '_stm', 'msgBox', 'auth/userInfo', 'auth/menu', 'queryTotalExam', 'feedback/entrance', 'rule/unreadNum', 'suggestedPrice', 'checkAbleFeedback', 'queryFeedbackNotReadTotal', 'pop/query', '.js', '.css', '.png', '.svg', '.woff', '.ico', '.jpg', '.gif', '.map', '.webp', 'hm.baidu', 'google', 'favicon', 'hot-update', 'sockjs'];
          page.on("response", (resp) => {
            responseTracker.track((async () => {
              try {
                const url = resp.url();
                if (frameworkPatterns.some(pat => url.includes(pat))) return;
                if (resp.status() === 200) {
                  const ct = resp.headers()["content-type"] || "";
                  if (ct.includes("json") || ct.includes("application")) {
                    const body = await resp.json().catch(() => null);
                    if (body) {
                      const u = new URL(url);
                      apis.push({ path: u.pathname, hasResult: !!body.result, success: body.success, dataKeys: body.result ? Object.keys(body.result).slice(0, 10) : [] });
                    }
                  }
                }
              } catch (e) { logSilent("ui.action", e); }
            })());
          });
          await navigateToSellerCentral(page, p);
          await randomDelay(8000, 12000);
          for (let i = 0; i < 3; i++) {
            try {
              const btn = page.locator('button:has-text("知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
              if (await btn.isVisible({ timeout: 500 })) await btn.click();
              else break;
            } catch { break; }
          }
          await randomDelay(2000, 3000);
          await responseTracker.drain(3000);
          console.error(`[probe-batch] ${p} => ${apis.length} APIs`);
          results[p] = apis;
        } catch (e) {
          console.error(`[probe-batch] ${p} ERROR: ${e.message}`);
          results[p] = { error: e.message };
        } finally {
          if (responseTracker) {
            await responseTracker.drain(1000).catch(() => {});
          }
          if (page) await page.close().catch(() => {});
        }
      }
      return results;
    }
    case "debug_page": {
      await ensureBrowser();
      let pg = context.pages().find(p => p.url().includes("goods") || p.url().includes("product"));
      if (!pg) {
        pg = context.pages()[0] || await safeNewPage(context);
      }
      // 无论如何都导航到商品管理页
      await pg.goto("https://agentseller.temu.com/goods/list", { waitUntil: "domcontentloaded", timeout: 30000 });
      await pg.waitForSelector("table", { timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 5000));
      if (!pg) throw new Error("No page found");
      const info = await pg.evaluate(() => {
        const result = {};
        // 1. 表头
        const ths = [...document.querySelectorAll("table thead th, table thead td")];
        result.headers = ths.map((th, i) => ({ index: i, text: th.innerText?.trim().replace(/\n/g, " ") }));
        // 2. 第一行数据
        const tbody = document.querySelector("table tbody");
        if (tbody) {
          const firstRow = tbody.querySelector("tr");
          if (firstRow) {
            const cells = firstRow.querySelectorAll("td");
            result.firstRow = [...cells].map((td, i) => ({
              index: i,
              text: (td.innerText || "").trim().substring(0, 200),
              html: td.innerHTML.substring(0, 300)
            }));
          }
        }
        // 3. URL
        result.url = location.href;
        return result;
      });
      return info;
    }
    case "scan_menu": {
      // 扫描侧边栏所有菜单项，返回文本和链接
      await ensureBrowser();
      const pg = context.pages().find(p => p.url().includes("agentseller.temu.com") && !p.url().includes("authentication"));
      const scanPage = pg || await safeNewPage(context);
      if (!pg) {
        await navigateToSellerCentral(scanPage, "/goods/list");
        await randomDelay(3000, 5000);
      }
      // 关闭弹窗
      for (let i = 0; i < 5; i++) {
        try {
          const btn = scanPage.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不")').first();
          if (await btn.isVisible({ timeout: 500 })) await btn.click();
          else break;
        } catch { break; }
      }
      // 展开所有子菜单
      await scanPage.evaluate(() => {
        document.querySelectorAll('[class*="menu-submenu-title"], [class*="submenu-title"], [class*="ant-menu-submenu-title"]').forEach(el => {
          const p = el.closest('[class*="submenu"]') || el.parentElement;
          const isOpen = p?.classList?.toString().includes('open') || p?.classList?.toString().includes('active');
          if (!isOpen) el.click();
        });
      });
      await randomDelay(2000, 3000);
      // 再展开一次
      await scanPage.evaluate(() => {
        document.querySelectorAll('[class*="menu-submenu-title"], [class*="submenu-title"]').forEach(el => {
          const p = el.closest('[class*="submenu"]') || el.parentElement;
          const isOpen = p?.classList?.toString().includes('open') || p?.classList?.toString().includes('active');
          if (!isOpen) el.click();
        });
      });
      await randomDelay(1000, 1500);
      // 收集菜单
      const menuItems = await scanPage.evaluate(() => {
        const results = [];
        const seen = new Set();
        // 所有 a 标签
        document.querySelectorAll('a[href]').forEach(a => {
          const inMenu = a.closest('[class*="menu"], [class*="sider"], [class*="sidebar"], nav');
          if (!inMenu) return;
          const text = a.innerText?.trim();
          const href = a.getAttribute('href');
          if (text && href && text.length < 40 && !seen.has(href)) {
            seen.add(href);
            results.push({ text, href, visible: a.offsetWidth > 0 && a.offsetHeight > 0 });
          }
        });
        return results;
      });
      if (!pg) await scanPage.close();
      return { menuItems, total: menuItems.length };
    }
    case "explore_page": {
      // 探索指定页面的所有 API
      await ensureBrowser();
      const { targetUrl, menuText } = params;
      const ep = await safeNewPage(context);
      const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
      fs.mkdirSync(debugDir, { recursive: true });

      const staticExts = [".js", ".css", ".png", ".svg", ".woff", ".woff2", ".ttf", ".ico", ".jpg", ".jpeg", ".gif", ".map", ".webp"];
      const frameworkPatterns = ['phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', 'get-leo-config', '_stm', 'msgBox', 'auth/userInfo', 'auth/menu', 'queryTotalExam', 'feedback/entrance', 'rule/unreadNum', 'suggestedPrice', 'checkAbleFeedback', 'queryFeedbackNotReadTotal', 'pop/query', 'batchMatchBySupplierIds', 'gray/agent'];
      const capturedApis = [];

      ep.on("response", async (resp) => {
        const url = resp.url();
        const method = resp.request().method();
        const ct = resp.headers()["content-type"] || "";
        const isStatic = staticExts.some(ext => url.includes(ext));
        const isFramework = frameworkPatterns.some(pat => url.includes(pat));
        if (!isStatic && !isFramework && (method === "POST" || (method === "GET" && url.includes("/api/"))) && (ct.includes("json") || url.includes("/api/"))) {
          try {
            const body = await resp.text();
            capturedApis.push({
              method,
              path: new URL(url).pathname,
              status: resp.status(),
              postData: resp.request().postData()?.substring(0, 2000) || null,
              responsePreview: body.substring(0, 3000),
            });
          } catch (e) { logSilent("ui.action", e); }
        }
      });

      try {
        await navigateToSellerCentral(ep, targetUrl);
        await randomDelay(3000, 5000);
        // 关闭弹窗
        for (let i = 0; i < 5; i++) {
          try {
            const btn = ep.locator('button:has-text("知道了"), button:has-text("我知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不"), button:has-text("去处理")').first();
            if (await btn.isVisible({ timeout: 500 })) await btn.click();
            else break;
          } catch { break; }
        }
        await randomDelay(5000, 8000);
        // 截图
        const safeName = (menuText || targetUrl).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_").substring(0, 30);
        await ep.screenshot({ path: path.join(debugDir, `explore_${safeName}.png`), fullPage: false }).catch(() => {});

        const contentInfo = await ep.evaluate(() => ({
          url: location.href,
          title: document.title,
          tableCount: document.querySelectorAll('table').length,
          tableHeaders: [...(document.querySelector('table')?.querySelectorAll('th') || [])].map(th => th.innerText?.trim()).slice(0, 20),
          cardCount: document.querySelectorAll('[class*="card"], [class*="stat"]').length,
          bodyTextLen: (document.body?.innerText || '').trim().length,
          bodyTextPreview: (document.body?.innerText || '').trim().substring(0, 500),
        }));

        console.error(`[explore] ${menuText || targetUrl}: URL=${contentInfo.url}, APIs=${capturedApis.length}, tables=${contentInfo.tableCount}, text=${contentInfo.bodyTextLen}`);
        return { contentInfo, apis: capturedApis, apiCount: capturedApis.length };
      } finally {
        await ep.close();
      }
    }
    // 采集命令已移到 scrape-registry.mjs（通过 default 分支的 buildScrapeHandlers 处理）
    // ---- 推广平台 (ads.temu.com) ----
    case "scrape_ads_home": { await ensureBrowser(); return { adsHome: await scrapeAdsHome() }; }
    case "scrape_ads_product": { await ensureBrowser(); return { adsProduct: await scrapeAdsProduct() }; }
    case "scrape_ads_report": { await ensureBrowser(); return { adsReport: await scrapeAdsReport() }; }
    case "scrape_ads_finance": { await ensureBrowser(); return { adsFinance: await scrapeAdsFinance() }; }
    case "scrape_ads_help": { await ensureBrowser(); return { adsHelp: await scrapeAdsHelp() }; }
    case "scrape_ads_notification": { await ensureBrowser(); return { adsNotification: await scrapeAdsNotification() }; }
    case "create_product_api": {
      // 纯 API 方式创建商品（跳过 DOM 操作）
      await ensureBrowser();
      return await createProductViaAPI(params);
    }
    case "batch_create_api": {
      // 纯 API 批量创建商品
      await ensureBrowser();
      return await batchCreateViaAPI(params);
    }
    case "workflow_pack_images": {
      return await generateWorkflowPackImages(params);
    }
    case "auto_pricing": {
      // 完整自动核价：CSV → AI生图 → 上传 → 提交核价
      // 每次新任务开始前清除致命登录错误标志，允许用户在「账号管理」改正密码后重试
      __fatalLoginError = null;
      await ensureBrowser();
      return await autoPricingFromCSV(params);
    }
    case "probe_create_flow": {
      // 打开商品创建页面，拦截所有 API 请求，用于发现真实端点
      await ensureBrowser();
      return await probeCreateFlow(params);
    }
    case "capture_add_payload": {
      // 专门捕获 product/add 的完整请求体（用 route 拦截）
      await ensureBrowser();
      const page = await safeNewPage(context);
      const capturedBodies = [];
      const saveDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
      fs.mkdirSync(saveDir, { recursive: true });
      try {
        // 用 route 拦截 product/add 和 draft/add 请求
        await page.route("**/product/add", async (route) => {
          const req = route.request();
          const postBody = req.postDataJSON();
          capturedBodies.push({ path: "/product/add", body: postBody, timestamp: Date.now() });
          console.error("[capture] Got product/add body: " + JSON.stringify(postBody)?.length + " bytes");
          const outputFile = path.join(saveDir, "real_product_add_payload.json");
          fs.writeFileSync(outputFile, JSON.stringify(postBody, null, 2));
          console.error("[capture] Saved to: " + outputFile);
          await route.continue();
        });
        await page.route("**/product/draft/add", async (route) => {
          const req = route.request();
          const postBody = req.postDataJSON();
          capturedBodies.push({ path: "/draft/add", body: postBody, timestamp: Date.now() });
          console.error("[capture] Got draft/add body: " + JSON.stringify(postBody)?.length + " bytes");
          const outputFile = path.join(saveDir, "real_draft_add_payload.json");
          fs.writeFileSync(outputFile, JSON.stringify(postBody, null, 2));
          await route.continue();
        });
        await page.route("**/store_image", async (route) => {
          console.error("[capture] Got store_image request");
          capturedBodies.push({ path: "/store_image", timestamp: Date.now() });
          await route.continue();
        });

        await navigateToSellerCentral(page, "/goods/create/category");
        await randomDelay(3000, 5000);
        // 关闭弹窗
        for (let i = 0; i < 5; i++) {
          try {
            const btn = page.locator('button:has-text("知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不"), button:has-text("不使用")').first();
            if (await btn.isVisible({ timeout: 500 })) await btn.click();
            else break;
          } catch { break; }
        }

        const waitMinutes = params.waitMinutes || 10;
        console.error("[capture] Ready. Please create product and submit. Waiting " + waitMinutes + " min...");
        await new Promise(r => setTimeout(r, waitMinutes * 60000));

        return { success: true, captured: capturedBodies.length, bodies: capturedBodies };
      } finally {
        if (!params.keepOpen) await page.close();
      }
    }
    case "test_api": {
      // 在已登录页面中调用指定 API 端点，用于调试
      await ensureBrowser();
      const page = await safeNewPage(context);
      try {
        await navigateToSellerCentral(page, params.navPath || "/goods/list");
        await randomDelay(5000, 8000);

        // 调试模式：检查 fetch/XHR 是否被 hook
        if (params.debug) {
          const hookInfo = await page.evaluate(() => {
            const info = {};
            info.fetchNative = fetch.toString().includes("native");
            info.fetchSrcLen = fetch.toString().length;
            info.xhrOpenNative = XMLHttpRequest.prototype.open.toString().includes("native");
            info.xhrSendNative = XMLHttpRequest.prototype.send.toString().includes("native");
            // 检查 window 上的签名相关对象
            const candidates = ["__ANTI__", "_AntiContent", "antiContent", "__pfb", "pfb"];
            for (const c of candidates) {
              if (window[c]) info["window." + c] = typeof window[c];
            }
            return info;
          });
          console.error("[test_api] Hook info:", JSON.stringify(hookInfo));

          // 拦截请求看 headers
          const reqHeaders = {};
          page.on("request", (req) => {
            if (req.url().includes(params.endpoint)) {
              const h = req.headers();
              reqHeaders["anti-content"] = h["anti-content"]?.slice(0, 50);
              reqHeaders["content-type"] = h["content-type"];
              reqHeaders["cookie"] = h["cookie"] ? "present" : "missing";
            }
          });

          const result = await temuXHR(page, params.endpoint, params.body || {}, { maxRetries: 1 });
          await randomDelay(500, 1000);
          return { ...result, hookInfo, capturedHeaders: reqHeaders };
        }

        const result = await temuXHR(page, params.endpoint, params.body || {}, { maxRetries: params.maxRetries || 1 });
        return result;
      } finally {
        if (!params.keepOpen) await page.close();
      }
    }
    case "eval": {
      // 在已登录页面中执行任意 JS（用于调试）
      await ensureBrowser();
      const evalCode = params.code || params.expression || "";
      const page = await safeNewPage(context);
      try {
        await navigateToSellerCentral(page, params.navPath || "/goods/list");
        await randomDelay(3000, 5000);
        const result = await page.evaluate((code) => {
          return new Function(code)();
        }, evalCode);
        return result;
      } finally {
        if (!params.keepOpen) await page.close();
      }
    }
    case "close":
      if (scrapeAllProgress.running) {
        const nextTasks = cloneScrapeAllTasks(scrapeAllProgress.tasks);
        for (const key of Object.keys(nextTasks)) {
          if (nextTasks[key]?.status === "running") {
            nextTasks[key] = {
              ...nextTasks[key],
              status: "error",
              message: "已取消",
              finishedAt: getScrapeAllTimestamp(),
            };
          }
        }
        updateScrapeAllProgress({
          running: false,
          status: "cancelled",
          message: "采集已取消",
          finishedAt: getScrapeAllTimestamp(),
          tasks: nextTasks,
        });
      }
      clearStickyWorkerCredentials();
      await closeBrowser();
      return { status: "closed" };
    case "shutdown":
      clearStickyWorkerCredentials();
      await closeBrowser();
      setTimeout(() => process.exit(0), 100);
      return { status: "shutting_down" };
    case "pause_pricing":
      if (!isCurrentProgressTask(params?.taskId)) {
        return { status: currentProgress.status || "idle", taskId: currentProgress.taskId };
      }
      pricingPaused = true;
      updateCurrentProgress({
        running: true,
        paused: false,
        status: "pausing",
        message: "暂停请求已发送，当前商品处理完后停止。",
      });
      console.error("[Worker] Pricing PAUSED");
      return { status: "pausing", taskId: currentProgress.taskId };
    case "resume_pricing":
      if (!isCurrentProgressTask(params?.taskId)) {
        return { status: currentProgress.status || "idle", taskId: currentProgress.taskId };
      }
      pricingPaused = false;
      updateCurrentProgress({
        running: true,
        paused: false,
        status: "running",
        step: "继续执行",
        message: "批量上品任务已恢复。",
      });
      console.error("[Worker] Pricing RESUMED");
      return { status: "resumed", taskId: currentProgress.taskId };
    case "set_yunqi_token": {
      const token = String(params?.token || "").trim();
      if (!token) throw new Error("Yunqi token cannot be empty");
      return await yunqiHandlers.setToken(token);
    }
    case "get_yunqi_token":
      return await yunqiHandlers.getToken();
    case "fetch_yunqi_token_from_browser":
      return await yunqiHandlers.fetchTokenFromBrowser();
    case "yunqi_set_credentials":
      return await yunqiHandlers.setYunqiCredentials(params || {});
    case "yunqi_get_credentials":
      return await yunqiHandlers.getYunqiCredentials();
    case "yunqi_delete_credentials":
      return await yunqiHandlers.deleteYunqiCredentials();
    case "yunqi_auto_login":
      return await yunqiHandlers.autoLogin();
    case "competitor_search":
      return await yunqiHandlers.competitorSearch(params || {});
    case "competitor_track":
      return await yunqiHandlers.competitorTrack(params || {});
    case "competitor_batch_track":
      return await yunqiHandlers.competitorBatchTrack(params || {});
    case "competitor_auto_register":
      return await yunqiHandlers.competitorAutoRegister(params || {});
    case "optimize_title":
      return await _optimizeTitle(params || {}, { getClient: getAiGeminiClient, model: AI_MODEL });
    case "competitor_scrape_reviews":
      return await _scrapeCompetitorReviews(params || {});
    case "open_temu_login":
      return await _openTemuLoginPage(params || {});
    case "open_temu_search":
      return await _openTemuSearchPage(params || {});
    case "competitor_ext_fetch_reviews":
      return _extractReviewsFromFeed(params || {}, extFeedBuffer);
    case "competitor_ext_feed_stats":
      return {
        total: extFeedBuffer.length,
        latest: extFeedBuffer.slice(-10).map((e) => ({
          url: e.url, status: e.status, pageUrl: e.pageUrl, receivedAt: e.receivedAt,
        })),
      };
    case "competitor_ext_feed_clear":
      extFeedBuffer.length = 0;
      try { if (fs.existsSync(EXT_FEED_FILE)) fs.unlinkSync(EXT_FEED_FILE); } catch {}
      return { cleared: true };
    case "competitor_ext_feed_dump":
      return _dumpFeedForGoods(params || {}, extFeedBuffer);
    case "competitor_ext_fetch_product":
      return _extractProductFromFeed(params || {}, extFeedBuffer);
    case "competitor_ext_search_results":
      return _extractSearchResultsFromFeed(params || {}, extFeedBuffer);
    case "competitor_ext_compare_queue_list":
      return { items: extCompareQueue.slice(), size: extCompareQueue.length };
    case "competitor_ext_compare_queue_remove": {
      const ok = removeExtCompareQueue((params || {}).goodsId);
      return { ok, size: extCompareQueue.length };
    }
    case "competitor_ext_mine_goods_list":
      return { items: Array.from(mineGoodsSet) };
    case "competitor_ext_mine_goods_set": {
      const p = params || {};
      const goodsId = String(p.goodsId || "").trim();
      const isMine = p.kind === "mine";
      const changed = setMineGoods(goodsId, isMine);
      return { ok: true, changed, items: Array.from(mineGoodsSet) };
    }
    case "competitor_analyze_compare_queue":
      return await analyzeCompareQueue();
    case "competitor_get_compare_insights":
      return { ok: true, insights: compareInsightsCache };
    case "yunqi_db_import":
      return await yunqiHandlers.yunqiDbImport(params || {});
    case "yunqi_db_search":
      return await yunqiHandlers.yunqiDbSearch(params || {});
    case "yunqi_db_stats":
      return await yunqiHandlers.yunqiDbStats();
    case "yunqi_db_top":
      return await yunqiHandlers.yunqiDbTop(params || {});
    case "yunqi_db_info":
      return await yunqiHandlers.yunqiDbInfo();
    case "yunqi_db_sync_online":
      return await yunqiHandlers.yunqiDbSyncOnline(params || {});
    default: {
      // 注册表驱动的采集命令（替代 50+ 重复 case）
      const scrapeHandlers = buildScrapeHandlers({
        scrapePageCaptureAll, scrapeSidebarCaptureAll, scrapePageWithListener,
        scrapeGovernPage: (subPath, meta) => scrapeSingleGovernTarget(subPath, meta),
        scrapeCustomTask,
        ensureBrowser,
      });
      if (scrapeHandlers[action]) {
        return await scrapeHandlers[action]();
      }
      throw new Error("未知命令: " + action);
    }
  }
}

// ============================================================
// 纯 API 方式创建商品（跳过 DOM 操作）
// ============================================================

async function uploadImageToMaterial(page, localImagePath, options = {}) {
  const { maxRetries = 3 } = options;
  const imageBuffer = fs.readFileSync(localImagePath);
  const base64 = imageBuffer.toString("base64");
  const ext = path.extname(localImagePath).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
  const fileName = path.basename(localImagePath);
  let lastError = "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let result;
    try {
      result = await page.evaluate(async ({ base64Data, mime, name }) => {
        const mallid = document.cookie.match(/mallid=([^;]+)/)?.[1] || "";

        try {
          // Step 1: 获取上传签名
          const sigResp = await fetch("/general_auth/get_signature?sdk_version=js-0.0.40&tag_name=product-material-tag&scene_id=agent-seller", {
            method: "POST",
            headers: { "Content-Type": "application/json", "mallid": mallid },
            credentials: "include",
            body: JSON.stringify({ bucket_tag: "product-material-tag" }),
          });
          const sigData = await sigResp.json();
          if (!sigData.signature) {
            return { success: false, error: "get_signature failed: " + JSON.stringify(sigData).slice(0, 200) };
          }

          // Step 2: 将 base64 转为 File
          const byteChars = atob(base64Data);
          const byteArray = new Uint8Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
          const blob = new Blob([byteArray], { type: mime });
          const file = new File([blob], name, { type: mime });

          // Step 3: 上传图片到 galerie
          const formData = new FormData();
          formData.append("url_width_height", "true");
          formData.append("image", file);
          formData.append("upload_sign", sigData.signature);

          const uploadResp = await fetch("/api/galerie/v3/store_image?sdk_version=js-0.0.40&tag_name=product-material-tag", {
            method: "POST",
            body: formData,
            credentials: "include",
            headers: { "mallid": mallid },
          });
          const uploadData = await uploadResp.json();

          if (uploadData.url) {
            return { success: true, url: uploadData.url, width: uploadData.width, height: uploadData.height };
          }
          return { success: false, error: "store_image no url: " + JSON.stringify(uploadData).slice(0, 200) };
        } catch (e) {
          return { success: false, error: e.message };
        }
      }, { base64Data: base64, mime: mimeType, name: fileName });
    } catch (evaluateError) {
      result = { success: false, error: evaluateError?.message || String(evaluateError || "upload evaluate failed") };
    }

    if (result.success) {
      console.error(`[upload] OK: ${result.url?.slice(0, 80)} (${result.width}x${result.height})`);
      return result;
    }

    lastError = result.error || lastError || "unknown upload error";
    console.error(`[upload] Attempt ${attempt}/${maxRetries} failed: ${result.error}`);
    if (attempt < maxRetries && isMaterialUploadRecoverableError(lastError)) {
      const refreshed = await refreshMaterialUploadSession(page, lastError);
      if (!refreshed) {
        console.error("[upload] Material upload session refresh failed");
      }
    }
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }

  return { success: false, error: lastError || `Upload failed after ${maxRetries} attempts` };
}

function isMaterialUploadLoginStateError(message = "") {
  const text = String(message || "");
  return /Invalid Login State|登录态|AUTH_EXPIRED/i.test(text);
}

function isMaterialUploadRecoverableError(message = "") {
  const text = String(message || "");
  return (
    isMaterialUploadLoginStateError(text)
    || /Execution context was destroyed|frame was detached|ERR_ABORTED|ERR_FAILED|Target page, context or browser has been closed|Cannot find context with specified id/i.test(text)
  );
}

function isMaterialUploadNavigationTimeoutError(message = "") {
  const text = String(message || "");
  return /Timeout \d+ms exceeded.*agentseller\.temu\.com\/goods\/list|page\.goto: Timeout .*goods\/list/i.test(text);
}

function formatAutoPricingUserError(message = "") {
  const text = String(message || "").trim();
  if (!text) return "执行失败，请稍后重试";
  if (isMaterialUploadLoginStateError(text)) return "登录状态已失效，请重新登录后重试";
  if (isMaterialUploadNavigationTimeoutError(text)) return "进入素材页面超时，请稍后重试";
  if (/Execution context was destroyed/i.test(text)) return "素材上传过程中页面刷新中断，请稍后重试";
  if (/frame was detached|ERR_ABORTED|ERR_FAILED/i.test(text)) return "素材页面连接中断，请稍后重试";
  return text;
}

/**
 * 分类自动上新失败原因，用于 UI 出具差异化提示。
 * stage: 失败发生的阶段 —— source_download | image_gen | image_upload | title | category | draft | unknown
 * 返回值形如 "image_gen:network" / "image_upload:auth" / "draft:unknown"，冒号前为阶段，冒号后为根因。
 */
function classifyAutoPricingError(stage, rawMessage) {
  const text = String(rawMessage || "");
  const lower = text.toLowerCase();
  let rootCause = "unknown";
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|getaddrinfo|socket hang up|network error|请求超时|连接超时|连接被重置|proxy|tunneling|connect ETIMEDOUT|Connection closed/i.test(text)) {
    rootCause = "network";
  } else if (/\b401\b|\b403\b|unauthorized|forbidden|invalid[_ ]?api[_ ]?key|authentication|密钥无效|未授权|authentication failed|登录失效|login expired|sellerLogin/i.test(text)) {
    rootCause = "auth";
  } else if (/\b429\b|quota|rate[_ ]?limit|too many requests|额度|余额|insufficient|欠费|配额|上游.*饱和|overloaded|usage limit/i.test(text)) {
    rootCause = "quota";
  } else if (/worker.*exit|image studio|child process|spawn.*ENOENT|auto-image-gen|ECONNREFUSED.*3210|ECONNREFUSED.*127\.0\.0\.1/i.test(text)) {
    rootCause = "worker_down";
  } else if (/timeout|超时/i.test(lower)) {
    rootCause = "timeout";
  }
  return `${stage || "unknown"}:${rootCause}`;
}

function getDraftFailureMessage(draftResult) {
  if (!draftResult || typeof draftResult !== "object") {
    return "草稿保存失败：保存进程中断或未返回结果";
  }

  const rawMessage = String(draftResult.message || draftResult.error || draftResult.errorMsg || "").trim();
  if (rawMessage && rawMessage !== "草稿保存失败") return rawMessage;

  const step = String(draftResult.step || "").trim();
  if (step === "submit") return "保存 Temu 草稿箱失败：创建草稿接口未返回具体原因";
  if (step === "draft_save") return "Temu 草稿内容保存失败：保存接口未返回具体原因";
  if (step === "draft_verify") return "草稿已创建，但保存后的内容校验未通过";
  if (step === "category") return "类目处理完成后保存草稿失败";
  if (step === "images") return "商品图片准备完成后保存草稿失败";
  return "草稿保存失败：Temu 未返回具体原因";
}

async function refreshMaterialUploadSession(page, reason = "") {
  if (!page || page.isClosed()) {
    return false;
  }

  const suffix = reason ? `: ${String(reason).slice(0, 160)}` : "";
  console.error(`[upload] Refreshing material upload session${suffix}`);

  try {
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(1500, 2500);
    return true;
  } catch (navError) {
    console.error(`[upload] Session refresh via navigation failed: ${navError.message}`);
  }

  const { phone, password } = getRequestCredentials();
  if (!phone || !password) {
    console.error("[upload] No credentials available for session refresh");
    return false;
  }

  try {
    const loginResult = await loginWithTransientPassword(phone, password);
    if (!loginResult?.success) {
      console.error("[upload] Transient re-login did not return success");
      return false;
    }
    await navigateToSellerCentral(page, "/goods/list");
    await randomDelay(1500, 2500);
    return true;
  } catch (loginError) {
    console.error(`[upload] Transient re-login failed: ${loginError.message}`);
    return false;
  }
}

/**
 * 搜索分类 — 通过逐级遍历分类树匹配中文分类路径
 * @param {Page} page
 * @param {string} searchTerm - 分类搜索词，支持 "一级/二级/三级" 格式或单个关键词
 */
function extractCategoryRefinementSegments(text = "") {
  return String(text || "")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/[、，]/g, "")
    .split(/[|｜,，;；>》/\s]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 2);
}

async function resolveKnownCategoryBranchFallback(page, searchTerms = [], title = "") {
  const cleanStr = (s) => String(s || "").replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "").replace(/[、，]/g, "");
  const orderedTerms = Array.from(new Set(
    (Array.isArray(searchTerms) ? searchTerms : [searchTerms])
      .map((term) => String(term || "").trim())
      .filter(Boolean)
  ));

  for (const term of orderedTerms) {
    const seed = pickKnownCategoryBranchFallback(term, title);
    if (!seed) continue;

    const catIds = {};
    let leafCatId = 0;
    let startLevel = 0;
    for (let level = 1; level <= 10; level += 1) {
      const catId = Number(seed[`cat${level}Id`]) || 0;
      const catName = String(seed[`cat${level}Name`] || "").trim();
      if (!catId) break;
      catIds[`cat${level}Id`] = catId;
      if (catName) catIds[`cat${level}Name`] = catName;
      leafCatId = catId;
      startLevel = level;
    }
    if (!leafCatId) continue;

    const segments = Array.from(new Set([
      ...extractCategoryRefinementSegments(term),
      ...extractCategoryRefinementSegments(title),
    ]));
    let parentId = leafCatId;

    for (let level = startLevel + 1; level <= 10; level += 1) {
      const result = await temuXHR(page, "/anniston-agent-seller/category/children/list", { parentCatId: parentId }, { maxRetries: 1 });
      const children = result.success ? (result.data?.categoryNodeVOS || []) : [];
      if (children.length === 0) break;

      let bestChild = null;
      let bestScore = -1;
      let otherChild = null;
      for (const child of children) {
        const childName = cleanStr(child.catName);
        if (/^其[他它]/.test(childName)) otherChild = child;
        let score = 0;
        for (const seg of segments) {
          if (childName.includes(seg)) score += seg.length * 3;
          else if (seg.includes(childName)) score += childName.length * 2;
          else {
            for (let len = Math.min(4, seg.length); len >= 2; len -= 1) {
              for (let idx = 0; idx <= seg.length - len; idx += 1) {
                if (childName.includes(seg.slice(idx, idx + len))) {
                  score += len;
                  break;
                }
              }
            }
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestChild = child;
        }
      }

      const selectedChild = bestScore > 0 ? bestChild : (otherChild || null);
      if (!selectedChild) break;
      catIds[`cat${level}Id`] = selectedChild.catId;
      catIds[`cat${level}Name`] = selectedChild.catName;
      parentId = selectedChild.catId;
      leafCatId = selectedChild.catId;
      if (selectedChild.isLeaf) break;
    }

    for (let level = 1; level <= 10; level += 1) {
      if (!catIds[`cat${level}Id`]) catIds[`cat${level}Id`] = 0;
    }
    catIds._path = getCategoryPathText(catIds);
    return { catIds, leafCatId, path: catIds._path, source: `known_branch:${term}` };
  }

  return null;
}

function syncLeafCategoryPayloadFields(payload, leafCatId) {
  const normalizedLeafCatId = Number(leafCatId) || 0;
  if (!payload || normalizedLeafCatId <= 0) return;
  payload.leafCatId = normalizedLeafCatId;
  payload.leafCategoryId = normalizedLeafCatId;
  payload.catId = normalizedLeafCatId;
  payload.categoryId = normalizedLeafCatId;
}

const DEFAULT_DRAFT_TITLE_LANGUAGES = ["zh"];
const DEFAULT_DRAFT_MATERIAL_LANGUAGES = ["zh", "en"];

function normalizeDraftLanguageList(values, fallback = DEFAULT_DRAFT_TITLE_LANGUAGES) {
  const normalized = Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
  return normalized.length > 0 ? normalized : [...fallback];
}

function buildDraftProductI18nReqs(productName, languages = DEFAULT_DRAFT_TITLE_LANGUAGES) {
  const normalizedName = String(productName || "").trim() || "商品";
  return normalizeDraftLanguageList(languages).map((language) => ({
    language,
    productName: normalizedName,
  }));
}

function buildDraftImageI18nReqs(imageUrls = [], languages = DEFAULT_DRAFT_MATERIAL_LANGUAGES) {
  const normalizedImageUrls = Array.from(new Set(
    (Array.isArray(imageUrls) ? imageUrls : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )).slice(0, 10);
  if (normalizedImageUrls.length === 0) return [];
  return normalizeDraftLanguageList(languages, DEFAULT_DRAFT_MATERIAL_LANGUAGES).flatMap((language) =>
    normalizedImageUrls.map((imageUrl) => ({
      language,
      imageUrl,
    }))
  );
}

function syncDraftPayloadDisplayFields(payload, params = {}, imageUrls = []) {
  if (!payload || typeof payload !== "object") return payload;

  const normalizedTitle = String(params.title || payload.productName || "").trim() || "商品";
  const rawImages = (Array.isArray(imageUrls) ? imageUrls : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const normalizedImages = (params.workflowQuantitySpecs || params.preserveDuplicateMainImages)
    ? rawImages.slice(0, 10)
    : Array.from(new Set(rawImages)).slice(0, 10);
  const primaryImage = normalizedImages[0] || "";
  const titleLanguages = normalizeDraftLanguageList(
    params.titleLanguages,
    DEFAULT_DRAFT_TITLE_LANGUAGES
  );
  const materialLanguages = normalizeDraftLanguageList(
    params.materialMultiLanguages || payload.materialMultiLanguages,
    DEFAULT_DRAFT_MATERIAL_LANGUAGES
  );
  const carouselImageI18nReqs = buildDraftImageI18nReqs(normalizedImages, materialLanguages);
  const thumbImageI18nReqs = buildDraftImageI18nReqs(primaryImage ? [primaryImage] : [], materialLanguages);
  const preserveSkuThumbUrls = Boolean(params.workflowQuantitySpecs || params.preserveSkuThumbUrls);

  payload.productName = normalizedTitle;
  payload.materialMultiLanguages = [...materialLanguages];
  payload.productI18nReqs = buildDraftProductI18nReqs(normalizedTitle, titleLanguages);

  if (normalizedImages.length > 0) {
    payload.carouselImageUrls = normalizedImages;
    payload.materialImgUrl = primaryImage;
    payload.carouselImageI18nReqs = carouselImageI18nReqs;
  }

  if (Array.isArray(payload.productSkcReqs)) {
    for (const skc of payload.productSkcReqs) {
      if (!skc || typeof skc !== "object") continue;
      if (normalizedImages.length > 0) {
        skc.previewImgUrls = normalizedImages;
        if (Array.isArray(skc.productSkcCarouselImageI18nReqs) && skc.productSkcCarouselImageI18nReqs.length > 0) {
          skc.productSkcCarouselImageI18nReqs = carouselImageI18nReqs;
        }
      }
      if (!Array.isArray(skc.productSkuReqs)) continue;
      for (const sku of skc.productSkuReqs) {
        if (!sku || typeof sku !== "object") continue;
        const existingSkuThumb = String(sku.thumbUrl || "").trim();
        const skuThumbUrl = preserveSkuThumbUrls && existingSkuThumb ? existingSkuThumb : primaryImage;
        if (skuThumbUrl) sku.thumbUrl = skuThumbUrl;
        if (Array.isArray(sku.productSkuThumbUrlI18nReqs)) {
          sku.productSkuThumbUrlI18nReqs = preserveSkuThumbUrls
            ? buildDraftImageI18nReqs(skuThumbUrl ? [skuThumbUrl] : [], materialLanguages)
            : thumbImageI18nReqs;
        }
      }
    }
  }

  return payload;
}

function summarizeDraftVerificationResult(rawResult = {}) {
  const result = rawResult && typeof rawResult === "object" ? rawResult : {};
  const productName = String(result.productName || "").trim();
  const productI18nList = Array.isArray(result.productI18nList) ? result.productI18nList : [];
  const titleFromI18n = productI18nList
    .map((item) => String(item?.productName || item?.name || item?.title || "").trim())
    .find(Boolean) || "";
  const carouselImageUrls = Array.isArray(result.carouselImageUrls) ? result.carouselImageUrls : [];
  const productSkcList = Array.isArray(result.productSkcList) ? result.productSkcList : [];
  const hasSkcImages = productSkcList.some((skc) => {
    const previewImages = Array.isArray(skc?.previewImgUrls) ? skc.previewImgUrls : [];
    if (previewImages.some(Boolean)) return true;
    const skuList = Array.isArray(skc?.productSkuList) ? skc.productSkuList : [];
    return skuList.some((sku) => String(sku?.thumbUrl || "").trim());
  });
  const hasSpecs = productSkcList.length > 0 || (Array.isArray(result.productSpecPropertyVOS) && result.productSpecPropertyVOS.length > 0);
  const hasTitle = Boolean(productName || titleFromI18n);
  const hasImages = carouselImageUrls.some(Boolean) || Boolean(String(result.materialImgUrl || "").trim()) || hasSkcImages;
  return {
    hasTitle,
    hasImages,
    hasSpecs,
    title: productName || titleFromI18n,
    imageCount: carouselImageUrls.filter(Boolean).length,
    skcCount: productSkcList.length,
  };
}

function normalizeDraftImageIdentity(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const pathname = decodeURIComponent(parsed.pathname || "")
      .replace(/_[0-9]+x[0-9]+(?=\.(?:jpe?g|png|webp|gif|avif)$)/i, "");
    return `${parsed.host}${pathname}`.toLowerCase();
  } catch {
    return raw
      .split(/[?#]/)[0]
      .replace(/_[0-9]+x[0-9]+(?=\.(?:jpe?g|png|webp|gif|avif)$)/i, "")
      .toLowerCase();
  }
}

function normalizeWorkflowQuantityCount(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const exact = raw.match(/^(\d+)\s*(?:PCS?|Pcs?|件|个)?$/i);
  if (exact) return Math.max(1, Number(exact[1]) || 0);
  const loose = raw.match(/^(\d+)\s*(?:PCS?|Pcs?)$/i);
  return loose ? Math.max(1, Number(loose[1]) || 0) : 0;
}

function getExpectedQuantitySkuImageMap(expectedQuantitySkuImages, expectedQuantityCounts = [1, 2, 3, 4]) {
  if (!expectedQuantitySkuImages || typeof expectedQuantitySkuImages !== "object") return {};
  const counts = Array.from(new Set(
    (Array.isArray(expectedQuantityCounts) && expectedQuantityCounts.length > 0 ? expectedQuantityCounts : [1, 2, 3, 4])
      .map((value) => Math.max(1, Number(value) || 0))
      .filter(Boolean)
  ));
  const map = {};
  for (const count of counts) {
    const url = expectedQuantitySkuImages[count]
      || expectedQuantitySkuImages[String(count)]
      || expectedQuantitySkuImages[`${count}PC`]
      || expectedQuantitySkuImages[`${count}PCS`]
      || expectedQuantitySkuImages[`${count}pc`]
      || expectedQuantitySkuImages[`${count}pcs`];
    if (url) map[count] = String(url).trim();
  }
  return map;
}

function inferDraftSkuQuantityCount(sku = {}) {
  const specLists = [
    sku.productSkuSpecList,
    sku.productSkuSpecVOS,
    sku.productSkuSpecReqs,
    sku.specs,
  ].filter(Array.isArray);
  for (const specList of specLists) {
    for (const spec of specList) {
      const specName = String(spec?.specName || spec?.name || spec?.value || "").trim();
      const parentSpecName = String(spec?.parentSpecName || spec?.parentName || "").trim();
      const count = normalizeWorkflowQuantityCount(specName);
      if (count && (/数量|件数|pcs?|pack/i.test(parentSpecName) || /pcs?/i.test(specName))) {
        return count;
      }
    }
  }
  const multipack = sku.productSkuMultiPackReq || sku.productSkuMultiPackVO || sku.productSkuMultiPack || {};
  const pieces = Math.max(0, Number(multipack.numberOfPieces || multipack.pieces || 0) || 0);
  return pieces || 0;
}

function getDraftSkuThumbUrls(sku = {}) {
  const urls = [];
  const pushUrl = (value) => {
    const url = String(value || "").trim();
    if (url) urls.push(url);
  };
  pushUrl(sku.thumbUrl);
  pushUrl(sku.skuThumbUrl);
  pushUrl(sku.imageUrl);

  for (const list of [
    sku.productSkuThumbUrlI18nReqs,
    sku.productSkuThumbUrlI18nList,
    sku.productSkuImageProcessExtVOList,
    sku.productSkuImageList,
  ]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      pushUrl(item?.imageUrl || item?.imgUrl || item?.thumbUrl || item?.url);
    }
  }

  return Array.from(new Set(urls));
}

function verifyDraftQuantitySkuImages(rawResult = {}, options = {}) {
  const expectedMap = getExpectedQuantitySkuImageMap(
    options.expectedQuantitySkuImages,
    options.expectedQuantityCounts
  );
  const expectedCounts = Object.keys(expectedMap).map((value) => Number(value)).filter(Boolean);
  if (expectedCounts.length === 0) {
    return { ok: true, skipped: true, expectedCounts: [] };
  }

  const productSkcList = Array.isArray(rawResult?.productSkcList) ? rawResult.productSkcList : [];
  const skuList = productSkcList.flatMap((skc) => Array.isArray(skc?.productSkuList) ? skc.productSkuList : []);
  const missingCounts = [];
  const mismatched = [];
  const skuThumbs = [];

  for (const count of expectedCounts) {
    const expectedUrl = expectedMap[count];
    const expectedIdentity = normalizeDraftImageIdentity(expectedUrl);
    const sku = skuList.find((item) => inferDraftSkuQuantityCount(item) === count);
    if (!sku) {
      missingCounts.push(count);
      continue;
    }
    const actualUrls = getDraftSkuThumbUrls(sku);
    const matched = actualUrls.some((url) => normalizeDraftImageIdentity(url) === expectedIdentity);
    skuThumbs.push({ count, expectedUrl, actualUrls });
    if (!matched) {
      mismatched.push({ count, expectedUrl, actualUrls });
    }
  }

  return {
    ok: missingCounts.length === 0 && mismatched.length === 0,
    skipped: false,
    expectedCounts,
    missingCounts,
    mismatched,
    skuThumbs,
  };
}

function verifyDraftWorkflowSpecMatrix(rawResult = {}, options = {}) {
  const expectedRandomValueCount = Math.max(0, Math.floor(Number(options.expectedRandomSpecValueCount) || 0));
  const hasExpectedQuantityCounts = Array.isArray(options.expectedQuantityCounts)
    && options.expectedQuantityCounts.length > 0;
  const expectedQuantityCounts = Array.from(new Set(
    (hasExpectedQuantityCounts ? options.expectedQuantityCounts : [])
      .map((value) => Math.max(1, Number(value) || 0))
      .filter(Boolean)
  ));
  if (!expectedRandomValueCount && expectedQuantityCounts.length === 0) {
    return { ok: true, skipped: true };
  }

  const productSkcList = Array.isArray(rawResult?.productSkcList) ? rawResult.productSkcList : [];
  const skuList = productSkcList.flatMap((skc) => Array.isArray(skc?.productSkuList) ? skc.productSkuList : []);
  const valuesByParent = new Map();
  for (const sku of skuList) {
    const specLists = [
      sku.productSkuSpecList,
      sku.productSkuSpecVOS,
      sku.productSkuSpecReqs,
      sku.specs,
    ].filter(Array.isArray);
    for (const specList of specLists) {
      for (const spec of specList) {
        const parentName = String(spec?.parentSpecName || spec?.parentName || "").trim();
        const specName = String(spec?.specName || spec?.name || spec?.value || "").trim();
        if (!parentName || !specName) continue;
        if (!valuesByParent.has(parentName)) valuesByParent.set(parentName, new Set());
        valuesByParent.get(parentName).add(specName);
      }
    }
  }

  let randomParent = null;
  let quantityParent = null;
  for (const [parentName, values] of valuesByParent.entries()) {
    if (isWorkflowQuantityParentSpecName(parentName)) {
      quantityParent = { parentName, values: Array.from(values) };
    } else if (!randomParent || values.size > randomParent.values.length) {
      randomParent = { parentName, values: Array.from(values) };
    }
  }

  const quantityValues = new Set((quantityParent?.values || []).map((value) => normalizeWorkflowQuantityCount(value)).filter(Boolean));
  const missingQuantityCounts = expectedQuantityCounts.filter((count) => !quantityValues.has(count));
  const randomValueCount = randomParent?.values?.length || 0;
  const expectedSkuCount = Math.max(1, expectedRandomValueCount || 1) * Math.max(1, expectedQuantityCounts.length || 1);

  return {
    ok: randomValueCount >= expectedRandomValueCount
      && missingQuantityCounts.length === 0
      && skuList.length >= expectedSkuCount,
    skipped: false,
    randomParent,
    quantityParent,
    expectedRandomValueCount,
    randomValueCount,
    expectedQuantityCounts,
    missingQuantityCounts,
    skuCount: skuList.length,
    expectedSkuCount,
  };
}

function getDraftSkuSaleNetContent(sku = {}) {
  return sku?.productSkuSaleExtAttr?.productSkuNetContent
    || sku?.productSkuMultiPack?.productSkuNetContent
    || {};
}

function getDraftSkuSaleTotalContent(sku = {}) {
  const saleExt = sku?.productSkuSaleExtAttr || {};
  const multiPack = sku?.productSkuMultiPack || {};
  const packIncludeInfo = saleExt.packIncludeInfo
    || multiPack.packIncludeInfo
    || {};
  const numberOfPiecesNew = Number(saleExt.numberOfPiecesNew ?? multiPack.numberOfPiecesNew ?? 0);
  const pieceNewUnitCode = Number(saleExt.pieceNewUnitCode ?? multiPack.pieceNewUnitCode ?? 0);
  if (Number(packIncludeInfo?.numberOfPieces) > 0 || Number(packIncludeInfo?.pieceUnitCode) > 0) {
    return {
      ...packIncludeInfo,
      netContentNumber: Number(packIncludeInfo.numberOfPieces) || Number(packIncludeInfo.netContentNumber) || 0,
      netContentUnitCode: Number(packIncludeInfo.pieceUnitCode) || Number(packIncludeInfo.netContentUnitCode) || 0,
    };
  }
  if (numberOfPiecesNew > 0 || pieceNewUnitCode > 0) {
    return {
      numberOfPiecesNew,
      pieceNewUnitCode,
      netContentNumber: numberOfPiecesNew,
      netContentUnitCode: pieceNewUnitCode,
    };
  }
  return saleExt.totalNetContent
    || multiPack.totalNetContent
    || saleExt.totalNetContentInfo
    || multiPack.totalNetContentInfo
    || {};
}

function verifyDraftWorkflowSkuRequiredFields(rawResult = {}, options = {}) {
  if (!options.expectWorkflowQuantitySkuRequiredFields) {
    return { ok: true, skipped: true };
  }

  const productSkcList = Array.isArray(rawResult?.productSkcList) ? rawResult.productSkcList : [];
  const skuList = productSkcList.flatMap((skc) => Array.isArray(skc?.productSkuList) ? skc.productSkuList : []);
  const issues = [];
  const skuSummary = [];

  for (const sku of skuList) {
    const specs = (Array.isArray(sku?.productSkuSpecList) ? sku.productSkuSpecList : [])
      .map((spec) => String(spec?.specName || "").trim())
      .filter(Boolean)
      .join(" / ");
    const quantityCount = inferDraftSkuQuantityCount(sku);
    const netContent = getDraftSkuSaleNetContent(sku);
    const totalContent = getDraftSkuSaleTotalContent(sku);
    const suggestedPrice = sku?.productSkuSuggestedPrice || {};
    const individuallyPacked = sku?.productSkuSaleExtAttr?.productSkuIndividuallyPacked
      ?? sku?.productSkuMultiPack?.individuallyPacked
      ?? null;
    const summary = {
      specs,
      quantityCount,
      netContent,
      totalContent,
      suggestedPrice,
      individuallyPacked,
    };
    skuSummary.push(summary);

    if (!(Number(netContent?.netContentNumber) > 0) || !(Number(netContent?.netContentUnitCode) > 0)) {
      issues.push({ specs, field: "productSkuNetContent", value: netContent });
    }
    if (!(Number(totalContent?.netContentNumber) > 0) || !(Number(totalContent?.netContentUnitCode) > 0)) {
      issues.push({ specs, field: "totalNetContent", value: totalContent });
    }
    if (quantityCount === 1 && ![2, 3, 4].includes(Number(totalContent?.netContentNumber))) {
      issues.push({ specs, field: "totalNetContent_1pc_random", value: totalContent });
    }
    if (quantityCount > 1 && Number(totalContent?.netContentNumber) !== quantityCount) {
      issues.push({ specs, field: "totalNetContent_quantity_count", value: totalContent, expected: quantityCount });
    }
    if (quantityCount > 1 && individuallyPacked === null) {
      issues.push({ specs, field: "individuallyPacked", value: individuallyPacked });
    }
    if (!(Number(suggestedPrice?.suggestedPrice) > 0) || suggestedPrice?.suggestedPriceCurrencyType === "NA") {
      issues.push({ specs, field: "suggestedPrice", value: suggestedPrice });
    }
  }

  return {
    ok: skuList.length > 0 && issues.length === 0,
    skipped: false,
    skuCount: skuList.length,
    issues,
    skuSummary,
  };
}

async function verifyWorkflowSkuRequiredFieldsInDom(page, options = {}) {
  if (!options.expectWorkflowQuantitySkuRequiredFields || !page) {
    return { ok: true, skipped: true };
  }

  try {
    await page.evaluate(() => {
      const all = [...document.querySelectorAll("body *")];
      const skuNode = all.find((node) => String(node?.innerText || "").trim() === "SKU 信息")
        || all.find((node) => String(node?.innerText || "").includes("SKU 信息"));
      if (skuNode?.scrollIntoView) {
        skuNode.scrollIntoView({ block: "start" });
      } else {
        window.scrollTo(0, Math.max(0, Math.floor(document.body.scrollHeight * 0.65)));
      }
    }).catch(() => {});
    await page.waitForTimeout(1000).catch(() => {});
    await page.evaluate(() => window.scrollBy(0, 350)).catch(() => {});
    await page.waitForTimeout(600).catch(() => {});

    const state = await page.evaluate(() => {
      const bodyText = document.body?.innerText || "";
      const inputs = [...document.querySelectorAll("input")].map((node, index) => {
        const rect = node.getBoundingClientRect();
        let ancestorText = "";
        let current = node;
        for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
          const text = String(current.innerText || "").trim().replace(/\s+/g, " ");
          if (text && text.length > ancestorText.length) ancestorText = text.slice(0, 260);
        }
        return {
          index,
          value: String(node.value || "").trim(),
          placeholder: String(node.getAttribute("placeholder") || "").trim(),
          visible: Boolean(rect.width && rect.height),
          x: Math.round(rect.x || 0),
          y: Math.round(rect.y || 0),
          ancestorText,
        };
      }).filter((item) => item.visible);

      const packIncludeInputs = inputs
        .filter((item) => item.ancestorText.includes("共计内含"))
        .map((item) => ({ value: item.value, ancestorText: item.ancestorText, x: item.x, y: item.y }));
      const skuRelatedInputs = inputs
        .filter((item) => (
          item.value === "NA"
          || item.value === "CNY"
          || item.ancestorText.includes("共计内含")
          || item.ancestorText.includes("单品数量")
          || item.ancestorText.includes("单品净含量")
        ))
        .slice(0, 80);

      return {
        hasSuggestPriceError: bodyText.includes("请输入建议零售价") || bodyText.includes("请输入/建议零售价"),
        hasPackIncludeError: bodyText.includes("请输入共计内含"),
        hasNaCurrencyInVisibleInputs: inputs.some((item) => item.value === "NA"),
        packIncludeInputs,
        skuRelatedInputs,
      };
    });

    const expectedMinimumPackInputs = Math.max(1, Math.min(4, Array.isArray(options.expectedQuantityCounts)
      ? options.expectedQuantityCounts.length
      : 4));
    const invalidPackIncludeInputs = state.packIncludeInputs.filter((item) => !(Number(item.value) > 0));
    return {
      ok: !state.hasSuggestPriceError
        && !state.hasPackIncludeError
        && !state.hasNaCurrencyInVisibleInputs
        && state.packIncludeInputs.length >= expectedMinimumPackInputs
        && invalidPackIncludeInputs.length === 0,
      skipped: false,
      hasSuggestPriceError: state.hasSuggestPriceError,
      hasPackIncludeError: state.hasPackIncludeError,
      hasNaCurrencyInVisibleInputs: state.hasNaCurrencyInVisibleInputs,
      expectedMinimumPackInputs,
      packIncludeInputs: state.packIncludeInputs,
      invalidPackIncludeInputs,
      skuRelatedInputs: state.skuRelatedInputs,
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: error?.message || String(error),
      packIncludeInputs: [],
      invalidPackIncludeInputs: [],
    };
  }
}

async function verifyDraftPersistedContent(page, draftId, options = {}) {
  const numericDraftId = Number(draftId) || 0;
  if (!numericDraftId || !page) {
    return { ok: false, reason: "draft_id_invalid", summary: { hasTitle: false, hasImages: false, hasSpecs: false } };
  }
  const logPrefix = options.logPrefix || "[draft-verify]";
  const maxAttempts = Number(options.maxAttempts) || 3;
  const perAttemptWait = Number(options.waitMs) || 6000;

  const captured = { raw: null };
  const listener = async (response) => {
    try {
      if (!response.url().includes("/visage-agent-seller/product/draft/query")) return;
      const text = await response.text();
      captured.raw = JSON.parse(text);
    } catch {}
  };
  page.on("response", listener);

  let lastSummary = { hasTitle: false, hasImages: false, hasSpecs: false };
  let lastDomState = null;
  let lastRawResult = {};

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      console.error(`${logPrefix} Attempt ${attempt}/${maxAttempts} for draftId=${numericDraftId}`);
      try {
        await openSellerCentralTarget(page, `/goods/edit?productDraftId=${numericDraftId}&from=productDraftList`, {
          lite: false,
          logPrefix,
        });
      } catch (error) {
        console.error(`${logPrefix} navigate failed: ${error?.message || error}`);
      }
      await dismissCommonDialogs(page).catch(() => {});
      await page.waitForTimeout(perAttemptWait).catch(() => {});

      // 主动调用 draft/query API，兼容 listener 未捕获的情况
      let draftResult = captured.raw?.result && typeof captured.raw.result === "object" ? captured.raw.result : null;
      if (!draftResult || (Object.keys(draftResult).length === 0)) {
        try {
          const direct = await temuXHR(page, "/visage-agent-seller/product/draft/query", { productDraftId: numericDraftId }, { maxRetries: 1 });
          if (direct.success && direct.data && typeof direct.data === "object") {
            draftResult = direct.data;
            console.error(`${logPrefix} Fetched draft via direct temuXHR`);
          }
        } catch (error) {
          console.error(`${logPrefix} Direct query failed: ${error?.message || error}`);
        }
      }

      const domState = await page.evaluate(() => {
        const titleInput = document.querySelector('input[placeholder*="商品名称"], textarea[placeholder*="商品名称"]');
        const imgEls = document.querySelectorAll('img[src*="kwcdn"], img[src*="temu"], img[src*="cdnfe"]');
        return {
          titleInputValue: titleInput && "value" in titleInput ? String(titleInput.value || "").trim() : "",
          domImageCount: imgEls.length,
          bodyText: (document.body?.innerText || "").slice(0, 2000),
        };
      }).catch(() => ({ titleInputValue: "", domImageCount: 0, bodyText: "" }));

      const summary = summarizeDraftVerificationResult(draftResult || {});
      if (!summary.hasTitle && domState.titleInputValue) {
        summary.hasTitle = true;
        summary.title = domState.titleInputValue;
      }
      // DOM 兜底：页面已渲染出 CDN 图片即认为图片已保存
      if (!summary.hasImages && domState.domImageCount >= 1) {
        summary.hasImages = true;
      }
      const quantitySkuImageCheck = verifyDraftQuantitySkuImages(draftResult || {}, options);
      summary.quantitySkuImageCheck = quantitySkuImageCheck;
      const specMatrixCheck = verifyDraftWorkflowSpecMatrix(draftResult || {}, options);
      summary.specMatrixCheck = specMatrixCheck;
      const skuRequiredFieldsCheck = verifyDraftWorkflowSkuRequiredFields(draftResult || {}, options);
      summary.skuRequiredFieldsCheck = skuRequiredFieldsCheck;
      const workflowSkuDomCheck = await verifyWorkflowSkuRequiredFieldsInDom(page, options);
      summary.workflowSkuDomCheck = workflowSkuDomCheck;
      const expectedMainImageMin = Math.max(0, Math.floor(Number(options.expectedMainImageMin) || 0));
      const mainImageCountCheck = {
        ok: expectedMainImageMin <= 0 || summary.imageCount >= expectedMainImageMin,
        expectedMin: expectedMainImageMin,
        actual: summary.imageCount,
      };
      summary.mainImageCountCheck = mainImageCountCheck;

      lastSummary = summary;
      lastDomState = domState;
      lastRawResult = draftResult || {};

      if (summary.hasTitle && summary.hasImages && mainImageCountCheck.ok && quantitySkuImageCheck.ok && specMatrixCheck.ok && skuRequiredFieldsCheck.ok && workflowSkuDomCheck.ok) {
        return {
          ok: true,
          reason: "verified",
          summary,
          domState,
          rawResult: lastRawResult,
          attempts: attempt,
        };
      }

      console.error(`${logPrefix} Attempt ${attempt} incomplete: hasTitle=${summary.hasTitle} hasImages=${summary.hasImages} mainImages=${summary.imageCount}/${expectedMainImageMin || "-"} quantitySkuImages=${quantitySkuImageCheck.ok} specMatrix=${specMatrixCheck.ok} skuRequired=${skuRequiredFieldsCheck.ok} skuDom=${workflowSkuDomCheck.ok}`);
      if (attempt < maxAttempts) {
        await page.waitForTimeout(2000).catch(() => {});
      }
    }

    return {
      ok: false,
      reason: lastSummary?.mainImageCountCheck && !lastSummary.mainImageCountCheck.ok
        ? "main_image_count_insufficient"
          : (lastSummary?.specMatrixCheck && !lastSummary.specMatrixCheck.ok
            ? "workflow_spec_matrix_mismatch"
            : (lastSummary?.quantitySkuImageCheck && !lastSummary.quantitySkuImageCheck.ok
              ? "quantity_sku_image_mismatch"
              : (lastSummary?.skuRequiredFieldsCheck && !lastSummary.skuRequiredFieldsCheck.ok
                ? "workflow_sku_required_fields_missing"
                : (lastSummary?.workflowSkuDomCheck && !lastSummary.workflowSkuDomCheck.ok ? "workflow_sku_dom_required_fields_missing" : "draft_shell_only")))),
      summary: lastSummary,
      domState: lastDomState,
      rawResult: lastRawResult,
      attempts: maxAttempts,
    };
  } finally {
    page.off("response", listener);
  }
}

// 记录最近一次 category API 调用失败原因，供上层组装更具诊断价值的错误信息
// （区分 "Temu API 失败/cookies 过期" 与 "类目真的找不到"）
let __fatalLoginError = null;
let __lastCategoryApiError = null;
function __recordCategoryApiError(stage, result) {
  __lastCategoryApiError = {
    stage,
    errorCode: result?.errorCode || null,
    errorMsg: result?.errorMsg || result?.raw?.error || "",
    at: new Date().toISOString(),
  };
}
function __consumeLastCategoryApiError() {
  const e = __lastCategoryApiError;
  __lastCategoryApiError = null;
  return e;
}

async function searchCategoryAPI(page, searchTerm, options = {}) {
  const cleanStr = (s) => s.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "").replace(/[、，]/g, "");
  const searchHintSegments = extractCategoryRefinementSegments(searchTerm);
  const titleSegments = extractCategoryRefinementSegments(options.title || searchTerm);
  const refinementSegments = Array.from(new Set([...searchHintSegments, ...titleSegments]));

  // 判断搜索词类型：包含 "/" 说明是分类路径，否则是标题/关键词
  const isPathSearch = searchTerm.includes("/");
  let searchParts;

  if (isPathSearch) {
    searchParts = searchTerm.split("/").map(s => cleanStr(s.trim())).filter(Boolean);
    console.error(`[category] Path search: "${searchParts.join(" > ")}"`);
  } else {
    // 标题搜索模式：在所有一级分类的二级子分类中模糊匹配
    console.error(`[category] Title search: "${searchTerm.slice(0, 40)}"`);
    const rootResult = await temuXHR(page, "/anniston-agent-seller/category/children/list", { parentCatId: 0 }, { maxRetries: 2 });
    if (!rootResult.success) {
      __recordCategoryApiError("title-search:root", rootResult);
      console.error(`[category] Title search aborted: root API failed (${rootResult.errorCode || "?"} ${rootResult.errorMsg || ""}). Cookies/login may have expired.`);
      return null;
    }
    const rootCats = rootResult.data?.categoryNodeVOS || [];
    const rootChildrenMap = new Map();

    // 提取标题中的核心关键词（用分隔符切分后直接匹配）
    const titleClean = cleanStr(searchTerm);
    const segments = refinementSegments.length > 0
      ? refinementSegments
      : titleClean.split(/[|｜,，;；>》\s]+/).filter(s => s.length >= 2);
    console.error(`[category] Segments: ${segments.slice(0, 8).join(", ")}`);

    function scoreCategoryName(candidateName, sourceSegments = []) {
      const childName = cleanStr(candidateName);
      let score = 0;
      for (const seg of sourceSegments) {
        if (childName.includes(seg)) score += seg.length * 2;
        else if (seg.includes(childName)) score += childName.length * 2;
        else {
          for (let len = Math.min(4, seg.length); len >= 2; len--) {
            for (let i = 0; i <= seg.length - len; i++) {
              if (childName.includes(seg.slice(i, i + len))) {
                score += len;
                break;
              }
            }
          }
        }
      }
      return score;
    }

    function buildCatIdsFromPathNodes(pathNodes = []) {
      const catIds = {};
      pathNodes.forEach((node, index) => {
        const level = index + 1;
        catIds[`cat${level}Id`] = Number(node?.catId) || 0;
        if (node?.catName) catIds[`cat${level}Name`] = node.catName;
      });
      for (let i = 1; i <= 10; i++) {
        if (!catIds[`cat${i}Id`]) catIds[`cat${i}Id`] = 0;
      }
      catIds._path = pathNodes.map((node) => node?.catName).filter(Boolean).join(" > ");
      return catIds;
    }

    async function scanTitleDescendants(parentId, pathNodes, depth = 0, maxDepth = 3) {
      if (depth >= maxDepth) return null;
      const childResult = await temuXHR(page, "/anniston-agent-seller/category/children/list", { parentCatId: parentId }, { maxRetries: 1 });
      if (!childResult.success) return null;
      const children = childResult.data?.categoryNodeVOS || [];
      if (children.length === 0) return null;

      let best = null;
      for (const child of children) {
        const nextPath = [...pathNodes, child];
        const score = scoreCategoryName(child.catName, segments);
        if (score > 0 && (!best || score > best.score)) {
          best = { pathNodes: nextPath, score };
        }
        const nested = await scanTitleDescendants(child.catId, nextPath, depth + 1, maxDepth);
        if (nested && (!best || nested.score > best.score)) {
          best = nested;
        }
      }
      return best;
    }

    let bestCat = null;
    let bestScore = 0;
    let bestPath = "";

    for (const root of rootCats) {
      const childResult = await temuXHR(page, "/anniston-agent-seller/category/children/list", { parentCatId: root.catId }, { maxRetries: 1 });
      if (!childResult.success) continue;
      const children = childResult.data?.categoryNodeVOS || [];
      rootChildrenMap.set(root.catId, children);

      for (const child of children) {
        const score = scoreCategoryName(child.catName, segments);
        if (score > bestScore) {
          bestScore = score;
          bestCat = child;
          bestPath = `${root.catName} > ${child.catName}`;
        }
      }
    }

    if (bestCat && bestScore > 0) {
      console.error(`[category] Best title match: ${bestPath} (score=${bestScore})`);
      // 直接用找到的二级分类 catId 继续展开到叶子，跳过路径匹配
      const catIds = {};
      const rootCat = rootCats.find(r => {
        // 找到包含 bestCat 的一级分类
        return bestPath.startsWith(r.catName);
      });
      if (rootCat) {
        catIds.cat1Id = rootCat.catId;
        catIds.cat1Name = rootCat.catName;
        catIds.cat2Id = bestCat.catId;
        catIds.cat2Name = bestCat.catName;

        // 继续展开到叶子 — 每层用标题关键词匹配最佳子分类
        let parentId = bestCat.catId;
        for (let level = 3; level <= 10; level++) {
          const childResult = await temuXHR(page, "/anniston-agent-seller/category/children/list", { parentCatId: parentId }, { maxRetries: 1 });
          if (!childResult.success || !childResult.data?.categoryNodeVOS?.length) break;
          const children = childResult.data.categoryNodeVOS;

          // 优先选"其他"兜底分类，其次用标题关键词匹配
          let bestChild = null;
          let bestChildScore = -1;
          let otherChild = null;
          for (const child of children) {
            const cn = cleanStr(child.catName);
            if (/^其[他它]/.test(cn)) { otherChild = child; }
            let score = 0;
            for (const seg of segments) {
              if (cn.includes(seg)) score += seg.length * 3;
              else if (seg.includes(cn)) score += cn.length * 2;
              else {
                for (let len = Math.min(4, seg.length); len >= 2; len--) {
                  for (let j = 0; j <= seg.length - len; j++) {
                    if (cn.includes(seg.slice(j, j + len))) { score += len; break; }
                  }
                }
              }
            }
            if (score > bestChildScore) { bestChildScore = score; bestChild = child; }
          }
          // 如果没有好的匹配（score=0），选"其他"兜底
          const selectedChild = bestChildScore > 0 ? bestChild : (otherChild || children[0]);
          catIds[`cat${level}Id`] = selectedChild.catId;
          catIds[`cat${level}Name`] = selectedChild.catName;
          parentId = selectedChild.catId;
          console.error(`[category] Level ${level}: auto-select → ${selectedChild.catId}:${selectedChild.catName}`);
        }

        // 补齐
        for (let i = 1; i <= 10; i++) {
          if (!catIds[`cat${i}Id`]) catIds[`cat${i}Id`] = 0;
        }
        catIds._path = Object.keys(catIds).filter(k => k.endsWith("Name") && catIds[k]).map(k => catIds[k]).join(" > ");
        console.error(`[category] Final: ${catIds._path}`);
        return { list: [catIds] };
      }
      // 如果没找到一级分类，走 fallback
      searchParts = [bestPath.split(" > ")[0], bestPath.split(" > ")[1]];
    } else {
      let deepBest = null;
      for (const root of rootCats) {
        const children = rootChildrenMap.get(root.catId) || [];
        for (const child of children) {
          const childScore = scoreCategoryName(child.catName, segments);
          if (childScore > 0 && (!deepBest || childScore > deepBest.score)) {
            deepBest = { pathNodes: [root, child], score: childScore };
          }
          const nested = await scanTitleDescendants(child.catId, [root, child], 0, 3);
          if (nested && (!deepBest || nested.score > deepBest.score)) {
            deepBest = nested;
          }
        }
      }

      if (deepBest && deepBest.score > 0) {
        console.error(`[category] Deep title match: ${deepBest.pathNodes.map((node) => node.catName).join(" > ")} (score=${deepBest.score})`);
        const catIds = buildCatIdsFromPathNodes(deepBest.pathNodes);
        let parentId = Number(deepBest.pathNodes[deepBest.pathNodes.length - 1]?.catId) || 0;

        for (let level = deepBest.pathNodes.length + 1; level <= 10; level++) {
          const childResult = await temuXHR(page, "/anniston-agent-seller/category/children/list", { parentCatId: parentId }, { maxRetries: 1 });
          if (!childResult.success || !childResult.data?.categoryNodeVOS?.length) break;
          const children = childResult.data.categoryNodeVOS;

          let bestChild = null;
          let bestChildScore = -1;
          let otherChild = null;
          for (const child of children) {
            const cn = cleanStr(child.catName);
            if (/^其[他它]/.test(cn)) otherChild = child;
            const score = scoreCategoryName(child.catName, segments);
            if (score > bestChildScore) { bestChildScore = score; bestChild = child; }
          }

          const selectedChild = bestChildScore > 0 ? bestChild : (otherChild || children[0]);
          catIds[`cat${level}Id`] = selectedChild.catId;
          catIds[`cat${level}Name`] = selectedChild.catName;
          parentId = selectedChild.catId;
          console.error(`[category] Level ${level}: auto-select → ${selectedChild.catId}:${selectedChild.catName}`);
        }

        for (let i = 1; i <= 10; i++) {
          if (!catIds[`cat${i}Id`]) catIds[`cat${i}Id`] = 0;
        }
        catIds._path = Object.keys(catIds).filter(k => k.endsWith("Name") && catIds[k]).map(k => catIds[k]).join(" > ");
        console.error(`[category] Final: ${catIds._path}`);
        return { list: [catIds] };
      }

      searchParts = [searchTerm];
      console.error(`[category] No title match, falling back to path search`);
    }
  }

  // 模糊匹配函数：支持部分匹配
  function fuzzyMatch(catName, searchName) {
    const a = cleanStr(catName).toLowerCase();
    const b = searchName.toLowerCase();
    if (a === b) return 3; // 完全匹配
    if (a.includes(b) || b.includes(a)) return 2; // 包含匹配
    // 关键词重叠匹配（至少2个字符重叠）
    for (let len = Math.min(a.length, b.length); len >= 2; len--) {
      for (let i = 0; i <= b.length - len; i++) {
        if (a.includes(b.slice(i, i + len))) return 1;
      }
    }
    return 0;
  }

  // 逐级遍历分类树
  let parentCatId = 0;
  const catIds = {};
  let lastMatchedCatId = 0;

  for (let level = 0; level < searchParts.length && level < 10; level++) {
    const result = await temuXHR(page, "/anniston-agent-seller/category/children/list", { parentCatId }, { maxRetries: 2 });
    if (!result.success) {
      __recordCategoryApiError(`path-search:level${level + 1}`, result);
      console.error(`[category] Path search aborted at level ${level + 1}: API failed (${result.errorCode || "?"} ${result.errorMsg || ""}). Cookies/login may have expired.`);
      break;
    }
    if (!result.data?.categoryNodeVOS?.length) {
      console.error(`[category] No children for parentCatId=${parentCatId} at level ${level + 1}`);
      break;
    }

    const cats = result.data.categoryNodeVOS;
    const searchName = searchParts[level];

    // 找最佳匹配
    let bestMatch = null;
    let bestScore = 0;
    for (const cat of cats) {
      const score = fuzzyMatch(cat.catName, searchName);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = cat;
      }
    }

    if (bestMatch && bestScore > 0) {
      catIds[`cat${level + 1}Id`] = bestMatch.catId;
      catIds[`cat${level + 1}Name`] = bestMatch.catName;
      parentCatId = bestMatch.catId;
      lastMatchedCatId = bestMatch.catId;
      console.error(`[category] Level ${level + 1}: "${searchName}" → ${bestMatch.catId}:${bestMatch.catName} (score=${bestScore})`);
    } else {
      console.error(`[category] Level ${level + 1}: "${searchName}" no match in ${cats.length} categories`);
      // 列出可用分类方便调试
      console.error(`[category]   Available: ${cats.slice(0, 8).map(c => c.catName).join(", ")}...`);
      break;
    }
  }

  // 继续展开到叶子节点：优先按标题关键词细化，避免宽类目一路误选第一个子类
  const matchedLevels = Object.keys(catIds).filter(k => k.match(/^cat\d+Id$/)).length;
  for (let level = matchedLevels; level < 10; level++) {
    const result = await temuXHR(page, "/anniston-agent-seller/category/children/list", { parentCatId }, { maxRetries: 1 });
    if (!result.success || !result.data?.categoryNodeVOS?.length) break;
    const children = result.data.categoryNodeVOS;
    let bestChild = null;
    let bestScore = -1;
    let otherChild = null;

    for (const child of children) {
      const childName = cleanStr(child.catName);
      if (/^其[他它]/.test(childName)) otherChild = child;
      let score = 0;
      for (const seg of refinementSegments) {
        if (childName.includes(seg)) score += seg.length * 3;
        else if (seg.includes(childName)) score += childName.length * 2;
        else {
          for (let len = Math.min(4, seg.length); len >= 2; len--) {
            let matched = false;
            for (let i = 0; i <= seg.length - len; i++) {
              if (childName.includes(seg.slice(i, i + len))) {
                score += len;
                matched = true;
                break;
              }
            }
            if (matched) break;
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestChild = child;
      }
    }

    const selectedChild = bestScore > 0
      ? bestChild
      : (otherChild || children[0]);
    catIds[`cat${level + 1}Id`] = selectedChild.catId;
    catIds[`cat${level + 1}Name`] = selectedChild.catName;
    parentCatId = selectedChild.catId;
    lastMatchedCatId = selectedChild.catId;
    console.error(`[category] Level ${level + 1}: auto-select → ${selectedChild.catId}:${selectedChild.catName} (score=${bestScore})`);
  }

  // 补齐剩余层级为 0
  for (let i = 1; i <= 10; i++) {
    if (!catIds[`cat${i}Id`]) catIds[`cat${i}Id`] = 0;
  }

  if (lastMatchedCatId > 0) {
    catIds._path = Object.keys(catIds)
      .filter(k => k.endsWith("Name") && catIds[k])
      .map(k => catIds[k])
      .join(" > ");
    console.error(`[category] Final: ${catIds._path}`);
    return { list: [catIds] };
  }

  console.error(`[category] No results for: "${searchTerm}"`);
  return null;
}

// ============================================================
// 统一 API 调用层 — 利用 Temu 前端 XHR 拦截器自动添加 anti-content
// ============================================================

/**
 * 在 Temu 页面中通过 XHR 调用后端 API（自动携带签名）
 * @param {import('playwright').Page} page - 已登录的 Temu 页面
 * @param {string} endpoint - API 路径，如 "/visage-agent-seller/product/add"
 * @param {Object} body - 请求体
 * @param {Object} [options]
 * @param {number} [options.maxRetries=3] - 最大重试次数
 * @param {boolean} [options.isFormData=false] - 是否为 FormData 上传
 * @returns {Object} { success, data, errorCode, errorMsg, raw }
 */
async function temuXHR(page, endpoint, body, options = {}) {
  const configuredMaxRetries = getConfiguredMaxRetries();
  const { maxRetries = configuredMaxRetries } = options;
  const NON_RETRYABLE = [1000001, 1000002, 1000003, 1000004, 40001, 40003, 50001, 6000002]; // 参数错误/无权限/属性不匹配（外层专用重试处理）

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const raw = await page.evaluate(async ({ ep, bd }) => {
        // 优先用 fetch（Temu 前端拦截器 hook 了 fetch 添加 anti-content）
        // mallid header 是必须的认证字段
        const mallid = document.cookie.match(/mallid=([^;]+)/)?.[1] || "";
        try {
          const resp = await fetch(ep, {
            method: "POST",
            headers: { "Content-Type": "application/json", "mallid": mallid },
            credentials: "include",
            body: JSON.stringify(bd),
          });
          const text = await resp.text();
          try {
            return { status: resp.status, body: JSON.parse(text) };
          } catch {
            return { status: resp.status, body: null, text: text?.slice(0, 500) };
          }
        } catch (fetchErr) {
          // fetch 失败，fallback 到 XHR
          return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", ep, true);
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.setRequestHeader("mallid", mallid);
            xhr.withCredentials = true;
            xhr.timeout = 30000;
            xhr.onreadystatechange = function () {
              if (xhr.readyState === 4) {
                try {
                  resolve({ status: xhr.status, body: JSON.parse(xhr.responseText) });
                } catch {
                  resolve({ status: xhr.status, body: null, text: xhr.responseText?.slice(0, 500) });
                }
              }
            };
            xhr.onerror = () => resolve({ status: 0, body: null, error: "XHR error: " + fetchErr.message });
            xhr.ontimeout = () => resolve({ status: 0, body: null, error: "XHR timeout" });
            xhr.send(JSON.stringify(bd));
          });
        }
      }, { ep: endpoint, bd: body });

      // 解析结果
      if (!raw.body) {
        console.error(`[temuXHR] ${endpoint} attempt ${attempt}/${maxRetries}: HTTP ${raw.status} - ${raw.error || raw.text?.slice(0, 100)}`);
        if (attempt < maxRetries) {
          const wait = Math.pow(3, attempt) * 1000; // 3s, 9s, 27s
          console.error(`[temuXHR] Retrying in ${wait / 1000}s...`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        return { success: false, errorMsg: raw.error || "Empty response", raw };
      }

      const resp = raw.body;
      const isOk = resp.success === true || resp.errorCode === 1000000;

      if (isOk) {
        console.error(`[temuXHR] ${endpoint} OK (attempt ${attempt})`);
        return { success: true, data: resp.result, errorCode: resp.errorCode, raw: resp };
      }

      // 不可重试的错误
      if (NON_RETRYABLE.includes(resp.errorCode)) {
        console.error(`[temuXHR] ${endpoint} NON-RETRYABLE error: ${resp.errorCode} - ${resp.errorMsg}`);
        return { success: false, errorCode: resp.errorCode, errorMsg: resp.errorMsg, raw: resp };
      }

      // 可重试的错误
      console.error(`[temuXHR] ${endpoint} attempt ${attempt}/${maxRetries}: errorCode=${resp.errorCode} - ${resp.errorMsg}`);
      if (attempt < maxRetries) {
        const wait = Math.pow(3, attempt) * 1000;
        console.error(`[temuXHR] Retrying in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      return { success: false, errorCode: resp.errorCode, errorMsg: resp.errorMsg, raw: resp };

    } catch (e) {
      console.error(`[temuXHR] ${endpoint} attempt ${attempt} exception: ${e.message}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, Math.pow(3, attempt) * 1000));
        continue;
      }
      return { success: false, errorMsg: e.message };
    }
  }
}

// ============================================================
// 探测创建商品流程 — 拦截真实 API 请求用于调试
// ============================================================

async function probeCreateFlow(params) {
  const page = await safeNewPage(context);
  const captured = [];
  const frameworkPatterns = [
    'phantom/xg', 'pfb/l1', 'pfb/a4', 'web-performace', 'get-leo-config',
    '_stm', 'msgBox', 'auth/userInfo', 'auth/menu', 'queryTotalExam',
    'feedback/entrance', 'rule/unreadNum', 'checkAbleFeedback',
    'queryFeedbackNotReadTotal', 'pop/query', '.js', '.css', '.png', '.svg',
    '.woff', '.ico', '.jpg', '.gif', '.map', '.webp', 'hm.baidu', 'google',
    'favicon', 'hot-update', 'sockjs', 'batchMatchBySupplierIds', 'gray/agent',
  ];

  // 保存完整的请求和响应数据
  const saveDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "api-probe");
  fs.mkdirSync(saveDir, { recursive: true });

  try {
    // 拦截所有 POST 请求
    page.on("request", (req) => {
      try {
        if (req.method() !== "POST") return;
        const url = req.url();
        if (frameworkPatterns.some(p => url.includes(p))) return;
        if (!url.includes("agentseller.temu.com") && !url.includes("kuajingmaihuo.com") && !url.includes("temu.com")) return;

        const u = new URL(url);
        const postData = req.postData();
        let body = null;
        try { body = JSON.parse(postData); } catch (e) { logSilent("ui.action", e); }

        captured.push({
          timestamp: Date.now(),
          method: "POST",
          path: u.pathname,
          bodyPreview: postData?.slice(0, 500),
          bodyParsed: body,
          headers: {
            "content-type": req.headers()["content-type"],
            "anti-content": req.headers()["anti-content"]?.slice(0, 50) + "...",
          },
        });
        console.error(`[probe] POST ${u.pathname} (body: ${postData?.length || 0} bytes)`);
      } catch (e) { logSilent("ui.action", e); }
    });

    page.on("response", async (resp) => {
      try {
        if (resp.request().method() !== "POST") return;
        const url = resp.url();
        if (frameworkPatterns.some(p => url.includes(p))) return;

        const u = new URL(url);
        const ct = resp.headers()["content-type"] || "";
        if (ct.includes("json") || ct.includes("application")) {
          const body = await resp.json().catch(() => null);
          if (body) {
            // 找到对应的请求记录，补充响应数据
            const req = [...captured].reverse().find(c => c.path === u.pathname && !c.response);
            if (req) {
              req.response = {
                status: resp.status(),
                errorCode: body.errorCode,
                errorMsg: body.errorMsg,
                success: body.success,
                resultKeys: body.result ? Object.keys(body.result).slice(0, 20) : [],
                resultPreview: JSON.stringify(body.result)?.slice(0, 500),
              };
            }
          }
        }
      } catch (e) { logSilent("ui.action", e); }
    });

    // 导航到创建商品页面
    const targetPath = params.path || "/goods/create/category";
    console.error(`[probe] Navigating to ${targetPath}...`);
    await navigateToSellerCentral(page, targetPath);
    await randomDelay(5000, 8000);

    // 关闭弹窗
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.locator('button:has-text("知道了"), button:has-text("确定"), button:has-text("关闭"), button:has-text("暂不"), button:has-text("不使用")').first();
        if (await btn.isVisible({ timeout: 500 })) await btn.click();
        else break;
      } catch { break; }
    }

    // 等待用户手动操作（创建商品、填写信息、提交核价）
    const waitMinutes = params.waitMinutes || 10;
    console.error(`[probe] Page ready. Waiting ${waitMinutes} minutes for manual operations...`);
    console.error(`[probe] Please manually create a product in the browser. All API calls will be captured.`);

    await new Promise(r => setTimeout(r, waitMinutes * 60000));

    // 保存捕获的数据
    const outputFile = path.join(saveDir, `probe_${Date.now()}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(captured, null, 2), "utf8");
    console.error(`[probe] Captured ${captured.length} API calls. Saved to: ${outputFile}`);

    return {
      success: true,
      totalApis: captured.length,
      apis: captured,
      savedTo: outputFile,
    };
  } finally {
    if (!params.keepOpen) await page.close();
  }
}

// ============================================================
// 完整自动核价：CSV → AI生图 → 上传素材 → 提交核价
// ============================================================

// 上品链路：原图只做参考，最终只提交 9 张 AI 图
const AI_DETAIL_IMAGE_TYPE_ORDER = [
  "scene_a",    // 1. 核价场景图A
  "scene_b",    // 2. 核价场景图B
  "features",   // 3. 卖点图
  "closeup",    // 4. 细节图
  "dimensions", // 5. 尺寸规格图
  "lifestyle",  // 6. 场景结果图
  "packaging",  // 7. 包装图
  "comparison", // 8. 对比图
  "lifestyle2", // 9. A+ 收束图
];
const REQUIRED_AI_DETAIL_IMAGE_COUNT = AI_DETAIL_IMAGE_TYPE_ORDER.length;

// 注意：AI_IMAGE_GEN_URL 改为可变 let，运行时可通过 set_ai_image_server 动作热更新，
// 避免主进程因 image studio URL 变化而重启 worker 中断批量上品任务。
let AI_IMAGE_GEN_URL = (process.env.AI_IMAGE_SERVER || "http://localhost:3210").replace(/\/+$/, "");
const AI_IMAGE_GEN_ORIGIN = (() => {
  try {
    return new URL(AI_IMAGE_GEN_URL).origin;
  } catch {
    return AI_IMAGE_GEN_URL;
  }
})();
const AI_AUTH_HEADERS = { "sec-fetch-site": "same-origin", "origin": AI_IMAGE_GEN_ORIGIN };

async function formatAiImageError(prefix, response) {
  try {
    const payload = (await response.text()).trim();
    if (response.status === 429 || isAiUpstreamBusyMessage(payload)) {
      return `${prefix}: AI 服务当前繁忙或已限流，请稍后重试`;
    }
    if (payload) {
      return `${prefix}: ${response.status} ${payload.slice(0, 240)}`;
    }
  } catch {}
  return `${prefix}: ${response.status}`;
}

function formatAiImageFetchError(prefix, error, routePath) {
  const reason = error?.message || String(error || "");
  if (error?.name === "AbortError" || /timeout|timed out|超时/i.test(reason)) {
    return `${prefix}: 请求 ${AI_IMAGE_GEN_URL}${routePath} 超时，请稍后重试`;
  }
  return `${prefix}: 请求 ${AI_IMAGE_GEN_URL}${routePath} 失败 (${reason})`;
}

/**
 * 用 form-data + node http 直接发送 multipart/form-data 请求。
 * 规避 undici FormData 在某些环境下不自动设置 Content-Type boundary 导致
 * Next.js route 报 "Content-Type was not one of multipart/form-data" 的问题。
 */
function postMultipartViaNodeHttp(urlString, { fileBlobs = [], fields = {}, extraHeaders = {}, timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlString); } catch (e) { reject(e); return; }
    const form = new FormDataLib();
    for (const item of fileBlobs) {
      const buffer = item.buffer instanceof Buffer ? item.buffer : Buffer.from(item.buffer || []);
      form.append("images", buffer, {
        filename: item.name || "image.jpg",
        contentType: item.type || "image/jpeg",
        knownLength: buffer.length,
      });
    }
    for (const [k, v] of Object.entries(fields || {})) {
      if (v === undefined || v === null) continue;
      form.append(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    const formHeaders = form.getHeaders();
    const headers = { ...formHeaders, ...extraHeaders };
    try { headers["Content-Length"] = form.getLengthSync(); } catch {}

    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: "POST",
      headers,
      family: 4,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString("utf8");
        let cachedJson = null;
        resolve({
          ok: Number(res.statusCode) >= 200 && Number(res.statusCode) < 300,
          status: Number(res.statusCode) || 0,
          headers: res.headers,
          text: async () => text,
          json: async () => {
            if (cachedJson !== null) return cachedJson;
            cachedJson = JSON.parse(text);
            return cachedJson;
          },
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on("error", (err) => reject(err));
    form.pipe(req);
  });
}

function isAiUpstreamBusyMessage(message) {
  const text = String(message || "");
  return /429|上游负载已饱和|too many requests|rate limit|invalid tokens multiple times|please wait 120 seconds/i.test(text);
}

/**
 * 调用 AI 生图服务：分析 + 生成 9 张图
 * @param {string} sourceImagePath - 商品原图本地路径
 * @param {string} productTitle - 商品标题（用于分析）
 * @returns {Object} { success, images: { [imageType]: base64DataUrl } }
 */
function shouldRetryAiImageRequest(message, status = 0) {
  const text = String(message || "");
  return Number(status) >= 500
    || isAiUpstreamBusyMessage(text)
    || /connection error|network|socket hang up|econnreset|fetch failed|temporarily unavailable|timeout|timed out/i.test(text);
}

async function fetchAiImageStageWithRetry({ label, routePath, request, maxRetries = 2 }) {
  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await request();
      if (response.ok) {
        return { success: true, response };
      }

      lastError = await formatAiImageError(label, response);
      if (!shouldRetryAiImageRequest(lastError, response.status) || attempt >= maxRetries) {
        return { success: false, error: lastError };
      }
    } catch (error) {
      lastError = formatAiImageFetchError(label, error, routePath);
      if (!shouldRetryAiImageRequest(lastError) || attempt >= maxRetries) {
        return { success: false, error: lastError };
      }
    }

    const waitMs = (attempt + 1) * 2000;
    console.error(`[ai-gen] ${label} retry ${attempt + 1}/${maxRetries + 1}: ${lastError}`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  return { success: false, error: lastError || `${label}: unknown error` };
}

function buildAiAnalyzeImageDataUrl(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = ext === ".png"
    ? "image/png"
    : ext === ".webp"
      ? "image/webp"
      : ext === ".gif"
        ? "image/gif"
        : "image/jpeg";
  return `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
}

function extractJsonObjectFromText(text) {
  const content = String(text || "").trim();
  if (!content) return null;

  const directMatch = content.match(/\{[\s\S]*\}/);
  if (!directMatch) return null;

  try {
    return JSON.parse(directMatch[0]);
  } catch {
    return null;
  }
}

function extractJsonArrayFromText(text) {
  let content = String(text || "").trim();
  if (!content) return null;

  const closedFence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (closedFence && closedFence[1]) {
    content = closedFence[1].trim();
  } else {
    const openFence = content.match(/```(?:json)?\s*([\s\S]*)$/i);
    if (openFence && openFence[1]) content = openFence[1].trim();
  }

  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

// 容错版：剥离 ```json fence、按括号平衡抽取、对被 max_tokens 截断的 JSON 做补齐（关字符串/数组/对象 + 删尾逗号）。
// 专门给 compare 场景用：LLM 偶尔会无视"纯 JSON"指令，或在 token 上限处断尾。
function extractJsonObjectLenient(text) {
  let content = String(text || "").trim();
  if (!content) return null;

  const closedFence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (closedFence && closedFence[1]) {
    content = closedFence[1].trim();
  } else {
    const openFence = content.match(/```(?:json)?\s*([\s\S]*)$/i);
    if (openFence && openFence[1]) content = openFence[1].trim();
  }

  const start = content.indexOf("{");
  if (start < 0) return null;

  const strict = extractJsonObjectFromText(content.slice(start));
  if (strict) return strict;

  const stack = [];
  let inStr = false;
  let escape = false;
  let lastValidEnd = -1;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{" || ch === "[") { stack.push(ch); continue; }
    if (ch === "}" || ch === "]") {
      const want = ch === "}" ? "{" : "[";
      if (stack[stack.length - 1] === want) stack.pop();
      if (stack.length === 0) lastValidEnd = i;
      continue;
    }
  }

  if (lastValidEnd > 0) {
    try { return JSON.parse(content.slice(start, lastValidEnd + 1)); } catch { /* fallthrough */ }
  }

  let tail = content.slice(start);
  if (inStr) tail += '"';
  tail = tail.replace(/,\s*$/g, "");
  tail = tail.replace(/:\s*$/g, ": null");
  tail = tail.replace(/,\s*([}\]])/g, "$1");
  while (stack.length) {
    const open = stack.pop();
    tail = tail.replace(/,\s*$/g, "");
    tail += open === "{" ? "}" : "]";
  }
  try { return JSON.parse(tail); } catch { return null; }
}

function normalizeAnalyzeFallbackPayload(payload, productTitle = "") {
  const fallbackTitle = String(productTitle || "").trim() || "商品";
  const normalizedSellingPoints = Array.isArray(payload?.sellingPoints)
    ? payload.sellingPoints.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6)
    : [];
  const normalizedAudience = Array.isArray(payload?.targetAudience)
    ? payload.targetAudience.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 4)
    : [];
  const normalizedScenes = Array.isArray(payload?.usageScenes)
    ? payload.usageScenes.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 4)
    : [];
  const productForm = String(payload?.productForm || "").trim();

  return {
    productName: String(payload?.productName || "").trim() || fallbackTitle,
    category: String(payload?.category || "").trim() || "General merchandise",
    sellingPoints: normalizedSellingPoints.length > 0
      ? normalizedSellingPoints
      : ["Clear product presentation", "Useful for e-commerce listing", "Highlights practical usage"],
    materials: String(payload?.materials || "").trim() || "not clearly visible",
    colors: String(payload?.colors || "").trim() || "not clearly visible",
    targetAudience: normalizedAudience.length > 0 ? normalizedAudience : ["general consumers", "online shoppers"],
    usageScenes: normalizedScenes.length > 0 ? normalizedScenes : ["home use", "daily use"],
    estimatedDimensions: String(payload?.estimatedDimensions || "").trim() || "not clearly visible",
    ...(productForm ? { productForm } : {}),
    creativeBriefs: payload?.creativeBriefs && typeof payload.creativeBriefs === "object" ? payload.creativeBriefs : {},
  };
}

async function requestJsonOverHttps(urlString, payload, options = {}) {
  const url = new URL(urlString);
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...(options.headers || {}),
  };
  const timeoutMs = Number(options.timeoutMs) || 180000;

  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: options.method || "POST",
      headers,
      family: 4,
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: Number(response.statusCode) >= 200 && Number(response.statusCode) < 300,
          status: Number(response.statusCode) || 0,
          text,
        });
      });
    });

    request.on("timeout", () => request.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function directAnalyzeProductImages({ sourceImagePath, productTitle, extraImagePaths = [] }) {
  if (!AI_API_KEY) {
    return { success: false, error: "Direct analyze fallback unavailable: missing AI_API_KEY" };
  }

  const uniqueImagePaths = Array.from(new Set([sourceImagePath, ...extraImagePaths]))
    .filter((imagePath) => typeof imagePath === "string" && imagePath.trim() && fs.existsSync(imagePath))
    .slice(0, 5);

  if (uniqueImagePaths.length === 0) {
    return { success: false, error: "Direct analyze fallback unavailable: no source images" };
  }

  const prompt = `You are an e-commerce product analyst.\nAnalyze the provided product images together with the title and return exactly one JSON object.\nDo not use markdown, code fences, or extra commentary.\n\nTitle: ${JSON.stringify(String(productTitle || "").trim())}\n\nReturn this schema exactly:\n{\n  "productName": "short product name",\n  "category": "specific category",\n  "sellingPoints": ["point 1", "point 2", "point 3"],\n  "materials": "main material summary",\n  "colors": "main color summary",\n  "targetAudience": ["audience 1", "audience 2"],\n  "usageScenes": ["scene 1", "scene 2"],\n  "estimatedDimensions": "visible dimensions or not clearly visible",\n  "productForm": "standard"\n}\n\nRules:\n- sellingPoints: 3 to 5 concise strings\n- targetAudience: 1 to 3 concise strings\n- usageScenes: 2 to 4 concise strings\n- If something is unclear, write \"not clearly visible\"\n- productName should prefer the title when it is usable`;

  const content = [{ type: "text", text: prompt }];
  for (const imagePath of uniqueImagePaths) {
    content.push({
      type: "image_url",
      image_url: {
        url: buildAiAnalyzeImageDataUrl(imagePath),
      },
    });
  }

  try {
    const client = getAiGeminiClient();
    if (!client) {
      return { success: false, error: "Direct analyze fallback unavailable: missing AI_API_KEY" };
    }
    let response;
    try {
      response = await client.chat.completions.create({
        model: AI_MODEL,
        messages: [{ role: "user", content }],
        temperature: 0.2,
        max_tokens: 1200,
      });
    } catch (err) {
      return {
        success: false,
        error: `Direct analyze fallback failed: ${err?.message || String(err || "unknown error")}`,
      };
    }

    const modelContent = response?.choices?.[0]?.message?.content || "";
    const parsedAnalysis = extractJsonObjectFromText(modelContent);
    if (!parsedAnalysis || typeof parsedAnalysis !== "object") {
      return {
        success: false,
        error: `Direct analyze fallback returned invalid JSON: ${String(modelContent).slice(0, 240)}`,
      };
    }

    return {
      success: true,
      analysis: normalizeAnalyzeFallbackPayload(parsedAnalysis, productTitle),
    };
  } catch (error) {
    return {
      success: false,
      error: `Direct analyze fallback failed: ${error?.message || String(error || "unknown error")}`,
    };
  }
}

function normalizeWorkflowPackCounts(value) {
  const source = Array.isArray(value) && value.length > 0 ? value : [2, 3, 4];
  const counts = source
    .map((item) => Math.floor(Number(item)))
    .filter((item) => Number.isFinite(item) && item >= 2 && item <= 12);
  return Array.from(new Set(counts)).slice(0, 6);
}

function getWorkflowPackImageType(count) {
  return `pack_${count}pc`;
}

const WORKFLOW_ORIGINAL_IMAGE_TYPE = "original";
const WORKFLOW_MIN_MAIN_IMAGE_COUNT = 5;
const WORKFLOW_MAX_MAIN_IMAGE_COUNT = 10;
const WORKFLOW_QUANTITY_PRICE_MULTIPLIERS = {
  1: 4,
  2: 3,
  3: 2.5,
  4: 2,
};

function getWorkflowOriginalImageType(index = 0) {
  const normalizedIndex = Math.max(0, Number(index) || 0);
  return normalizedIndex === 0 ? WORKFLOW_ORIGINAL_IMAGE_TYPE : `${WORKFLOW_ORIGINAL_IMAGE_TYPE}_${normalizedIndex + 1}`;
}

function isWorkflowOriginalImageType(imageType = "") {
  return String(imageType || "") === WORKFLOW_ORIGINAL_IMAGE_TYPE
    || /^original_\d+$/i.test(String(imageType || ""));
}

function normalizeWorkflowQuantityPriceMultipliers(value) {
  const normalized = { ...WORKFLOW_QUANTITY_PRICE_MULTIPLIERS };
  if (value && typeof value === "object") {
    for (const [key, rawMultiplier] of Object.entries(value)) {
      const count = Math.max(1, Number(String(key).replace(/[^\d.]/g, "")) || 0);
      const multiplier = Number(rawMultiplier);
      if (count && Number.isFinite(multiplier) && multiplier > 0) normalized[count] = multiplier;
    }
  }
  return normalized;
}

function getWorkflowQuantityPriceMultiplier(count, multipliers = WORKFLOW_QUANTITY_PRICE_MULTIPLIERS) {
  const normalizedCount = Math.max(1, Number(count) || 1);
  return Number(multipliers[normalizedCount]) || normalizedCount;
}

const WORKFLOW_PACK_LOG_FILE = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "workflow-pack.log");

function logWorkflowPack(taskId, message) {
  const line = `[${new Date().toISOString()}] [${taskId || "workflow-pack"}] ${message}`;
  console.error(`[workflow-pack] ${message}`);
  try {
    fs.mkdirSync(path.dirname(WORKFLOW_PACK_LOG_FILE), { recursive: true });
    fs.appendFileSync(WORKFLOW_PACK_LOG_FILE, `${line}\n`, "utf8");
  } catch (error) {
    logSilent("workflow-pack.log", error);
  }
}

function buildWorkflowWhitePackPlans(productTitle, packCounts) {
  return packCounts.map((count) => {
    const imageType = getWorkflowPackImageType(count);
    const packLabel = `${count}PCS`;
    return {
      imageType,
      prompt: [
        "Create a clean retail catalog product photo from the reference image.",
        "Keep the exact same product subject count as the reference image. Do not add, duplicate, remove, or rearrange any product units.",
        `Add the plain text "${packLabel}" exactly once on the empty white background area, preferably near the top-right corner.`,
        "The pack-count text must stay on the white background only, must not overlap or touch the product, and must not be drawn on the product.",
        "Use simple dark gray or black sans-serif text only: no badge, no sticker, no label box, no border, no colored tag, no decorative shape.",
        "Preserve the original product placement and composition as much as possible on a plain white background.",
        "Strictly preserve the exact product identity from the reference image.",
        "Keep the original product structure locked: same silhouette, color, material, texture, visible details, attachments, and functional parts.",
        "Keep the original product scale and perspective unchanged.",
        "Use soft studio lighting, a subtle natural shadow, and a centered square 1:1 composition.",
        "Do not preserve any source size chart, dimension marks, measurement callouts, ruler, comparison graphic, captions, labels, background graphics, hands, packaging, or extra props.",
        "Use a clean white background with clean corners and no watermark, logo, border, QR code, platform UI, hands, packaging, or extra props.",
        `Do not render any other letters, numbers, labels, captions, or symbols besides "${packLabel}".`
      ].join(" "),
    };
  });
}

function detectWorkflowImageMime(buffer, filePath = "") {
  if (buffer?.[0] === 0x89 && buffer?.[1] === 0x50 && buffer?.[2] === 0x4e && buffer?.[3] === 0x47) return "image/png";
  if (buffer?.[0] === 0xff && buffer?.[1] === 0xd8 && buffer?.[2] === 0xff) return "image/jpeg";
  if (buffer?.[0] === 0x52 && buffer?.[1] === 0x49 && buffer?.[2] === 0x46 && buffer?.[3] === 0x46) return "image/webp";
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function extractWorkflowImageCandidate(value) {
  return extractWorkflowImageCandidates(value)[0] || "";
}

function extractWorkflowImageCandidates(value) {
  const text = normalizeCellText(value, "\n").trim();
  if (!text) return [];
  const candidates = [];
  const push = (candidate) => {
    const next = String(candidate || "").trim().replace(/^["']|["']$/g, "");
    if (!next || candidates.includes(next)) return;
    candidates.push(next);
  };
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>，,；;]+/gi)) push(match[0]);
  for (const match of text.matchAll(/file:\/\/\/[^\s"'<>，,；;]+/gi)) push(match[0]);
  for (const part of text.split(/[\r\n,，;；]+/)) {
    const next = part.trim();
    if (!next) continue;
    if (/^(https?:\/\/|file:\/\/\/|[a-zA-Z]:[\\/]|\\\\)/i.test(next)) push(next);
  }
  if (candidates.length === 0) push(text.split(/[\r\n,，;；]+/).map((item) => item.trim()).find(Boolean) || "");
  return candidates;
}

function classifyWorkflowOriginalCandidateText(candidate) {
  const text = String(candidate || "").toLowerCase();
  const reasons = [];
  if (/(尺寸|尺码|规格图|尺寸图|测量|量尺|dimension|dimensions|size[-_\s]?chart|measurement|measure|ruler|length|width|height|\bcm\b|\bmm\b|\binch(?:es)?\b)/i.test(text)) {
    reasons.push("疑似尺寸图");
  }
  if (/(白底|白底图|white[-_\s]?background|white[-_\s]?bg|plain[-_\s]?white)/i.test(text)) {
    reasons.push("疑似白底图");
  }
  if (/(\b\d+\s*(?:pcs?|pieces?|packs?|sets?|pairs?)\b|\d+\s*(?:件|个|只|片|包|套|组|对)|数量|多件|套装|组合装|pack[-_\s]?\d+|\d+[-_\s]?pack)/i.test(text)) {
    reasons.push("疑似带数量图");
  }
  return {
    blocked: reasons.length > 0,
    reasons,
    source: "text",
    confidence: reasons.length > 0 ? 0.75 : 0.2,
  };
}

function normalizeWorkflowOriginalVisualFilter(payload = {}) {
  const reasons = Array.isArray(payload?.reasons)
    ? payload.reasons.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 5)
    : [];
  const isSizeChart = Boolean(payload?.isSizeChart);
  const isWhiteBackground = Boolean(payload?.isWhiteBackgroundOnlyProductPhoto);
  const hasQuantityText = Boolean(payload?.hasQuantityText || payload?.hasPackOrSetCountText);
  if (isSizeChart && !reasons.some((item) => /尺寸|size|dimension/i.test(item))) reasons.push("尺寸图");
  if (isWhiteBackground && !reasons.some((item) => /白底|white/i.test(item))) reasons.push("白底图");
  if (hasQuantityText && !reasons.some((item) => /数量|pack|pcs|套/i.test(item))) reasons.push("带数量图");
  const blocked = isSizeChart || isWhiteBackground || hasQuantityText || payload?.shouldUploadAsOriginalMaterial === false;
  return {
    uploadEligible: !blocked,
    reasons: blocked ? (reasons.length ? reasons : ["不适合作为原图素材上传"]) : [],
    confidence: Number.isFinite(Number(payload?.confidence)) ? Math.max(0, Math.min(1, Number(payload.confidence))) : 0.5,
    raw: payload,
  };
}

function parseWorkflowOriginalVisualFilterFromText(text = "") {
  const raw = String(text || "");
  if (!raw.trim()) return null;
  const readBool = (key) => {
    const match = raw.match(new RegExp(`["']?${key}["']?\\s*:\\s*(true|false)`, "i"));
    return match ? match[1].toLowerCase() === "true" : null;
  };
  const parsed = {
    isSizeChart: readBool("isSizeChart"),
    isWhiteBackgroundOnlyProductPhoto: readBool("isWhiteBackgroundOnlyProductPhoto"),
    hasQuantityText: readBool("hasQuantityText"),
    hasPackOrSetCountText: readBool("hasPackOrSetCountText"),
    shouldUploadAsOriginalMaterial: readBool("shouldUploadAsOriginalMaterial"),
  };
  const knownCount = Object.values(parsed).filter((value) => value !== null).length;
  if (knownCount === 0) return null;
  const hasBlockingSignal = parsed.isSizeChart === true
    || parsed.isWhiteBackgroundOnlyProductPhoto === true
    || parsed.hasQuantityText === true
    || parsed.hasPackOrSetCountText === true
    || parsed.shouldUploadAsOriginalMaterial === false;
  const hasStrongAllowSignal = parsed.isSizeChart === false
    && parsed.isWhiteBackgroundOnlyProductPhoto === false
    && parsed.hasQuantityText === false
    && parsed.hasPackOrSetCountText === false
    && parsed.shouldUploadAsOriginalMaterial === true;
  if (!hasBlockingSignal && !hasStrongAllowSignal) return null;
  return normalizeWorkflowOriginalVisualFilter({
    isSizeChart: parsed.isSizeChart === true,
    isWhiteBackgroundOnlyProductPhoto: parsed.isWhiteBackgroundOnlyProductPhoto === true,
    hasQuantityText: parsed.hasQuantityText === true,
    hasPackOrSetCountText: parsed.hasPackOrSetCountText === true,
    shouldUploadAsOriginalMaterial: parsed.shouldUploadAsOriginalMaterial !== false,
    reasons: [],
    confidence: hasBlockingSignal ? 0.88 : 0.72,
  });
}

function getWorkflowOriginalFilterModelChain() {
  const candidates = [
    process.env.WORKFLOW_ORIGINAL_FILTER_MODEL,
    process.env.VECTORENGINE_ORIGINAL_FILTER_MODEL,
    "gpt-5.4",
    ATTRIBUTE_AI_MODEL,
    AI_MODEL,
    ...COMPARE_MODEL_CHAIN,
    "gemini-3.1-flash-lite-preview",
  ];
  const seen = new Set();
  return candidates
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getAttributeFillModelChain() {
  const candidates = [
    "gpt-5.4",
    process.env.WORKFLOW_ATTRIBUTE_MODEL,
    process.env.WORKFLOW_PROPERTY_MODEL,
    process.env.VECTORENGINE_ATTRIBUTE_MODEL,
    ATTRIBUTE_AI_MODEL,
    AI_MODEL,
    ...COMPARE_MODEL_CHAIN,
    "gemini-3.1-flash-lite-preview",
  ];
  const seen = new Set();
  return candidates
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function classifyWorkflowOriginalMaterialImage(imagePath, { candidate = "", productName = "", taskId = "" } = {}) {
  const textFilter = classifyWorkflowOriginalCandidateText(candidate);
  if (textFilter.blocked) {
    return {
      uploadEligible: false,
      reasons: textFilter.reasons,
      confidence: textFilter.confidence,
      source: "text",
    };
  }

  const modelChain = getWorkflowOriginalFilterModelChain();
  if (!AI_API_KEY || modelChain.length === 0) {
    return {
      uploadEligible: false,
      reasons: ["AI 原图筛选不可用，为避免尺寸图/白底图/带数量图误入主图，已排除"],
      confidence: 0.6,
      source: "fallback",
      warning: "AI 原图筛选不可用，未放行原图",
    };
  }

  const prompt = `You are filtering raw product images before uploading them to an e-commerce material center.
Return exactly one JSON object, no markdown.

Product title: ${JSON.stringify(String(productName || "").trim())}

Reject this image if ANY condition is true:
1. It is a size chart, dimension image, measurement diagram, specification table, ruler/callout image, or contains visible dimensions such as cm/mm/inch/length/width/height.
2. It is a plain white-background catalog/main product image.
3. It contains visible quantity or pack-count text, such as 2PCS, 3PC, 4 pack, set of 2, 2件, 3个, bundle count, or quantity labels.

Accept only a clean raw product/lifestyle/detail image that is not a size chart, not a white-background catalog image, and not a quantity/pack-count image.

Schema:
{
  "isSizeChart": false,
  "isWhiteBackgroundOnlyProductPhoto": false,
  "hasQuantityText": false,
  "hasPackOrSetCountText": false,
  "shouldUploadAsOriginalMaterial": true,
  "reasons": [],
  "confidence": 0.0
}`;

  let lastError = "";
  for (const model of modelChain) {
    const client = getAiClientForModel(model) || getAiGeminiClient();
    if (!client) continue;
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: buildAiAnalyzeImageDataUrl(imagePath) } },
          ],
        }],
        temperature: 0,
        max_tokens: 600,
      });
      const modelContent = response?.choices?.[0]?.message?.content || "";
      const parsed = extractJsonObjectFromText(modelContent);
      if (!parsed || typeof parsed !== "object") {
        const partial = parseWorkflowOriginalVisualFilterFromText(modelContent);
        if (partial) {
          logWorkflowPack(taskId, `original filter recovered partial JSON from ${model}: uploadEligible=${partial.uploadEligible}, reasons=${partial.reasons.join("、")}`);
          return { ...partial, source: "ai_partial", model };
        }
        lastError = `invalid JSON from ${model}: ${String(modelContent).slice(0, 160)}`;
        logWorkflowPack(taskId, `original filter ${lastError}`);
        continue;
      }
      const normalized = normalizeWorkflowOriginalVisualFilter(parsed);
      return { ...normalized, source: "ai", model };
    } catch (error) {
      lastError = error?.message || String(error || "unknown");
      logWorkflowPack(taskId, `original filter failed on ${model}: ${lastError}`);
    }
  }

  return {
    uploadEligible: false,
    reasons: ["AI 原图筛选失败，为避免尺寸图/白底图/带数量图误入主图，已排除"],
    confidence: 0.6,
    source: "ai_error",
    warning: lastError || "AI 原图筛选不可用，未放行原图",
  };
}

async function materializeWorkflowImageCandidate(candidate, outputPath) {
  if (/^https?:\/\//i.test(candidate)) {
    await downloadImage(candidate, outputPath);
    return outputPath;
  }
  const localPath = candidate.startsWith("file:///")
    ? fileURLToPath(candidate)
    : path.resolve(candidate);
  if (!fs.existsSync(localPath)) {
    throw new Error(`原图不存在或不可下载: ${candidate.slice(0, 120)}`);
  }
  fs.copyFileSync(localPath, outputPath);
  return outputPath;
}

async function prepareWorkflowSourceImage(rawValue, outputPath, options = {}) {
  return prepareWorkflowSourceImages(extractWorkflowImageCandidates(rawValue), outputPath, options);
}

async function prepareWorkflowSourceImages(rawCandidates, outputPath, options = {}) {
  const candidates = Array.from(new Set(
    (Array.isArray(rawCandidates) ? rawCandidates : extractWorkflowImageCandidates(rawCandidates))
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )).slice(0, WORKFLOW_MAX_MAIN_IMAGE_COUNT);
  if (candidates.length === 0) {
    throw new Error("未识别到商品原图链接");
  }

  const tmpBase = outputPath.replace(/\.[^.\\/]+$/, "");
  const rejectedOriginals = [];
  let firstDownloaded = null;
  let lastDownloadError = null;
  const acceptedOriginals = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const candidatePath = `${tmpBase}_candidate_${index}.jpg`;
    try {
      await materializeWorkflowImageCandidate(candidate, candidatePath);
      if (!firstDownloaded) firstDownloaded = { candidate, path: candidatePath };
      const filter = await classifyWorkflowOriginalMaterialImage(candidatePath, {
        candidate,
        productName: options.productName,
        taskId: options.taskId,
      });
      if (filter.uploadEligible) {
        const originalPath = `${tmpBase}_original_${acceptedOriginals.length}.jpg`;
        fs.copyFileSync(candidatePath, originalPath);
        acceptedOriginals.push({
          candidate,
          sourceImagePath: originalPath,
          originalFilter: filter,
        });
        if (acceptedOriginals.length >= WORKFLOW_MAX_MAIN_IMAGE_COUNT) break;
        continue;
      }
      rejectedOriginals.push({ candidate, reasons: filter.reasons, filter });
      logWorkflowPack(options.taskId, `original candidate skipped: ${filter.reasons.join("、") || "不适合上传"} (${candidate.slice(0, 80)})`);
    } catch (error) {
      lastDownloadError = error;
      rejectedOriginals.push({ candidate, reasons: [error?.message || String(error || "下载失败")] });
      logWorkflowPack(options.taskId, `original candidate failed: ${error?.message || String(error || "unknown")} (${candidate.slice(0, 80)})`);
    }
  }

  if (acceptedOriginals.length > 0) {
    fs.copyFileSync(acceptedOriginals[0].sourceImagePath, outputPath);
    return {
      sourceImageUrl: acceptedOriginals[0].candidate,
      sourceImagePath: outputPath,
      originalUploadEligible: true,
      originalFilter: acceptedOriginals[0].originalFilter,
      originals: acceptedOriginals,
      rejectedOriginals,
      candidateCount: candidates.length,
    };
  }

  if (firstDownloaded) {
    fs.copyFileSync(firstDownloaded.path, outputPath);
    return {
      sourceImageUrl: firstDownloaded.candidate,
      sourceImagePath: outputPath,
      originalUploadEligible: false,
      originals: [],
      originalFilter: {
        uploadEligible: false,
        reasons: ["所有原图候选均为尺寸图/白底图/带数量图或不可用，不上传原图到素材中心"],
        confidence: 1,
        source: "aggregate",
      },
      rejectedOriginals,
      candidateCount: candidates.length,
    };
  }

  throw lastDownloadError || new Error("没有可下载的商品原图");
}

async function readWorkflowGenerateSSE(resp, expectedTypes, idleTimeoutMs = 60000, taskId = "") {
  if (!resp.body) {
    throw new Error("AI 服务未返回可读取的数据流");
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const expected = new Set(expectedTypes);
  const images = {};
  const errors = {};
  const warnings = {};
  let buffer = "";
  try {
    while (true) {
      let idleTimer = null;
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          idleTimer = setTimeout(() => reject(new Error(`AI 图片生成超时（${Math.round(idleTimeoutMs / 1000)}s 无响应）`)), idleTimeoutMs);
        }),
      ]).finally(() => {
        if (idleTimer) clearTimeout(idleTimer);
      });
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data?.imageType && expected.has(data.imageType) && Array.isArray(data.warnings) && data.warnings.length > 0) {
            warnings[data.imageType] = data.warnings;
            logWorkflowPack(taskId, `${data.imageType} warnings: ${data.warnings.join("; ")}`);
          }
          if (data?.status === "done" && data.imageType && data.imageUrl && expected.has(data.imageType)) {
            images[data.imageType] = data.imageUrl;
            logWorkflowPack(taskId, `${data.imageType} done`);
          } else if (data?.status === "error" && data.imageType && expected.has(data.imageType)) {
            errors[data.imageType] = data.error || "生成失败";
            logWorkflowPack(taskId, `${data.imageType} error: ${errors[data.imageType]}`);
          } else if (data?.status && data.imageType && expected.has(data.imageType)) {
            logWorkflowPack(taskId, `${data.imageType} status=${data.status}`);
          }
        } catch (error) {
          logSilent("workflow-pack.sse.parse", error);
        }
      }
    }
    return { images, errors, warnings };
  } finally {
    try { await reader.cancel(); } catch {}
    try { reader.releaseLock(); } catch {}
  }
}

async function generateWorkflowSinglePackImage({ imageBuffer, mimeType, sourceImagePath, plan, taskId }) {
  const requestTimeoutMs = 6 * 60 * 1000;
  const idleTimeoutMs = 2 * 60 * 1000;
  let requestTimer = null;
  try {
    logWorkflowPack(taskId, `${plan.imageType} request start`);
    const form = new FormData();
    form.append("images", new Blob([imageBuffer], { type: mimeType }), path.basename(sourceImagePath));
    form.append("plans", JSON.stringify([plan]));
    form.append("productMode", "single");
    form.append("imageLanguage", "en");
    form.append("imageSize", "1000x1000");

    const controller = new AbortController();
    requestTimer = setTimeout(() => controller.abort(), requestTimeoutMs);
    const resp = await fetch(`${AI_IMAGE_GEN_URL}/api/generate`, {
      method: "POST",
      body: form,
      headers: AI_AUTH_HEADERS,
      signal: controller.signal,
    });

    if (!resp.ok) {
      const error = await formatAiImageError(`Workflow pack generate failed (${plan.imageType})`, resp);
      logWorkflowPack(taskId, `${plan.imageType} http failed: ${error}`);
      return { imageType: plan.imageType, imageUrl: "", error, warnings: [] };
    }

    const parsed = await readWorkflowGenerateSSE(resp, [plan.imageType], idleTimeoutMs, taskId);
    const imageUrl = parsed.images?.[plan.imageType] || "";
    const error = parsed.errors?.[plan.imageType] || (imageUrl ? "" : "未返回图片");
    if (!imageUrl) {
      logWorkflowPack(taskId, `${plan.imageType} missing image: ${error}`);
    }
    return {
      imageType: plan.imageType,
      imageUrl,
      error,
      warnings: parsed.warnings?.[plan.imageType] || [],
    };
  } catch (error) {
    const message = formatAiImageFetchError(`Workflow pack generate failed (${plan.imageType})`, error, "/api/generate");
    logWorkflowPack(taskId, `${plan.imageType} fetch failed: ${message}`);
    return { imageType: plan.imageType, imageUrl: "", error: message, warnings: [] };
  } finally {
    if (requestTimer) clearTimeout(requestTimer);
  }
}

async function generateWorkflowWhitePackImages(sourceImagePath, productTitle, packCounts, options = {}) {
  const taskId = options.taskId || "";
  const imageBuffer = fs.readFileSync(sourceImagePath);
  const mimeType = detectWorkflowImageMime(imageBuffer, sourceImagePath);
  const plans = buildWorkflowWhitePackPlans(productTitle, packCounts);
  logWorkflowPack(taskId, `AI request batch start: ${plans.map((plan) => plan.imageType).join(", ")}`);
  const settled = await Promise.allSettled(
    plans.map((plan) => generateWorkflowSinglePackImage({ imageBuffer, mimeType, sourceImagePath, plan, taskId }))
  );

  const images = {};
  const errors = {};
  const warnings = {};
  for (let i = 0; i < plans.length; i += 1) {
    const plan = plans[i];
    const result = settled[i];
    if (result?.status === "fulfilled") {
      if (result.value.imageUrl) images[plan.imageType] = result.value.imageUrl;
      if (result.value.error) errors[plan.imageType] = result.value.error;
      if (result.value.warnings?.length) warnings[plan.imageType] = result.value.warnings;
    } else {
      errors[plan.imageType] = result?.reason?.message || String(result?.reason || "生成失败");
    }
  }

  const missing = plans.map((plan) => plan.imageType).filter((imageType) => !images[imageType]);
  const error = missing.map((imageType) => `${imageType}: ${errors[imageType] || "未返回图片"}`).join("; ");
  logWorkflowPack(taskId, `AI request batch done: generated=${Object.keys(images).length}/${plans.length}${error ? `, error=${error}` : ""}`);
  return {
    success: missing.length === 0,
    images,
    errors,
    warnings,
    plans,
    error,
  };
}

function getWorkflowProductRows(csvPath) {
  const { kind: spreadsheetKind, rows: allRows } = readSpreadsheetRows(csvPath, { defval: "" });
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(10, allRows.length); i += 1) {
    const row = allRows[i];
    if (row && row.some((cell) => {
      const text = normalizeCellText(cell);
      return text.includes("商品标题") || text.includes("商品名称") || text.includes("商品主图") || text.includes("商品原图") || text.includes("美元价格");
    })) {
      headerRowIdx = i;
      break;
    }
  }
  const headers = (allRows[headerRowIdx] || []).map((item) => normalizeCellText(item));
  const dataRowsWithIndex = allRows
    .slice(headerRowIdx + 1)
    .map((row, offset) => ({ row, rowIndex: headerRowIdx + 1 + offset }))
    .filter(({ row }) => row && row.some((cell) => normalizeCellText(cell).trim()));
  const dataRows = dataRowsWithIndex.map((item) => item.row);
  const findColumn = (names) => {
    for (const name of names) {
      const needle = String(name).toLowerCase();
      const idx = headers.findIndex((header) => {
        const text = String(header || "");
        return text.includes(name) || text.toLowerCase().includes(needle);
      });
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const exactColumn = (patterns) => headers.findIndex((columnName) => patterns.some((pattern) => pattern.test(String(columnName || "").trim())));
  const catIdIndexes = {};
  const catNameIndexes = {};
  for (let level = 1; level <= 10; level += 1) {
    const catIdIdx = exactColumn([new RegExp(`^cat${level}Id$`, "i")]);
    const catNameIdx = exactColumn([new RegExp(`^cat${level}Name$`, "i")]);
    if (catIdIdx >= 0) catIdIndexes[`cat${level}Id`] = catIdIdx;
    if (catNameIdx >= 0) catNameIndexes[`cat${level}Name`] = catNameIdx;
  }
  return {
    spreadsheetKind,
    allRows,
    headerRowIdx,
    headers,
    dataRows,
    dataRowIndexes: dataRowsWithIndex.map((item) => item.rowIndex),
    nameIdx: findColumn(["商品标题（中文）", "商品标题", "商品名称", "product name", "title"]),
    nameEnIdx: findColumn(["商品标题（英文）", "英文标题", "title_en", "english title"]),
    imageIdx: findColumn(["商品主图", "商品原图", "主图", "原图", "image", "main image", "picture"]),
    carouselIdx: findColumn(["商品轮播图", "轮播图", "carousel"]),
    frontCatIdx: findColumn(["前台分类（中文）", "前台分类"]),
    backCatIdx: findColumn(["后台分类"]),
    genericCatIdx: findColumn(["分类（中文）", "分类关键词", "category", "分类"]),
    priceIdx: findColumn(["美元价格($)", "美元价格", "price", "USD", "价格"]),
    priceCnyIdx: findColumn(["人民币价格", "priceCNY", "申报价"]),
    directLeafCatIdx: exactColumn([/^leafCatId$/i, /^leafCategoryId$/i, /^catId$/i, /^categoryId$/i, /^叶子类目ID$/i]),
    catIdsJsonIdx: exactColumn([/^catIds$/i, /^categoryIds$/i]),
    goodsIdIdx: exactColumn([/^商品ID$/i, /^goodsId$/i, /^goods_id$/i]),
    productIdIdx: exactColumn([/^productId$/i, /^spuId$/i, /^SPU ID$/i]),
    productSkcIdIdx: exactColumn([/^productSkcId$/i, /^skcId$/i, /^SKC ID$/i]),
    catIdIndexes,
    catNameIndexes,
  };
}

function ensureWorkflowTableColumn(headerRow, title) {
  const normalizedTitle = normalizeCellText(title);
  const existing = headerRow.findIndex((cell) => normalizeCellText(cell) === normalizedTitle);
  if (existing >= 0) return existing;
  headerRow.push(title);
  return headerRow.length - 1;
}

function writeWorkflowKwcdnResultTable(inputPath, table, results, outputDir, taskId, packCounts) {
  const rows = Array.isArray(table?.allRows) && table.allRows.length > 0
    ? table.allRows.map((row) => Array.isArray(row) ? row.slice() : [])
    : [];
  const headerRowIdx = Math.max(0, Number(table?.headerRowIdx) || 0);
  while (rows.length <= headerRowIdx) rows.push([]);
  const headerRow = rows[headerRowIdx] || [];
  rows[headerRowIdx] = headerRow;

  const statusCol = ensureWorkflowTableColumn(headerRow, "新上品素材状态");
  const originalCol = ensureWorkflowTableColumn(headerRow, "新上品原图 kwcdn URL");
  const packColumns = new Map();
  for (const packCount of packCounts || []) {
    packColumns.set(
      getWorkflowPackImageType(packCount),
      ensureWorkflowTableColumn(headerRow, `${packCount}PCS 白底图 kwcdn URL`),
    );
  }

  for (const result of results || []) {
    const dataIndex = Number(result?.index);
    const rowIndex = table?.dataRowIndexes?.[dataIndex] ?? (headerRowIdx + 1 + dataIndex);
    if (!Number.isFinite(rowIndex) || rowIndex < 0) continue;
    while (rows.length <= rowIndex) rows.push([]);
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    rows[rowIndex] = row;
    row[statusCol] = result?.success
      ? "素材已上传"
      : (result?.message || "素材未完成");
    const byType = new Map((result?.images || []).map((image) => [image?.imageType, image]));
    row[originalCol] = getWorkflowOriginalKwcdnUrls(result).join(",");
    for (const [imageType, columnIndex] of packColumns.entries()) {
      row[columnIndex] = byType.get(imageType)?.kwcdnUrl || "";
    }
  }

  const baseName = path.basename(inputPath || "products").replace(/\.[^.]+$/, "");
  const outputPath = path.join(outputDir, `${baseName}_${taskId}_kwcdn.xlsx`);
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "kwcdn");
  XLSX.writeFile(workbook, outputPath);
  return outputPath;
}

function saveWorkflowPackImages(images, outputDir, rowIndex) {
  const saved = {};
  for (const [imageType, imageUrl] of Object.entries(images || {})) {
    if (typeof imageUrl !== "string" || !imageUrl.startsWith("data:image/")) continue;
    const outputPath = path.join(outputDir, `${rowIndex}_${imageType}_${Date.now()}.png`);
    saveBase64Image(imageUrl, outputPath);
    saved[imageType] = outputPath;
  }
  return saved;
}

function getWorkflowImageExtension(mimeType) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

function saveWorkflowOriginalMaterialImage(sourceImagePath, outputDir, rowIndex, imageType = WORKFLOW_ORIGINAL_IMAGE_TYPE) {
  const buffer = fs.readFileSync(sourceImagePath);
  const mimeType = detectWorkflowImageMime(buffer, sourceImagePath);
  const outputPath = path.join(outputDir, `${rowIndex}_${imageType}_${Date.now()}${getWorkflowImageExtension(mimeType)}`);
  fs.copyFileSync(sourceImagePath, outputPath);
  return {
    imageUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    localPath: outputPath,
  };
}

function buildWorkflowMaterialImageSpecs(packCounts, originalCount = 1) {
  const normalizedOriginalCount = Math.max(1, Math.min(WORKFLOW_MAX_MAIN_IMAGE_COUNT, Math.floor(Number(originalCount) || 1)));
  const originalSpecs = Array.from({ length: normalizedOriginalCount }, (_, index) => ({
    imageType: getWorkflowOriginalImageType(index),
    role: "original",
    label: index === 0 ? "原图" : `原图${index + 1}`,
    packCount: null,
    sourceIndex: index,
  }));
  return [
    ...originalSpecs,
    ...packCounts.map((packCount) => ({
      imageType: getWorkflowPackImageType(packCount),
      role: "pack",
      label: `${packCount}PCS`,
      packCount,
    })),
  ];
}

function getWorkflowResultImage(result, imageType) {
  return (Array.isArray(result?.images) ? result.images : []).find((image) => image?.imageType === imageType) || null;
}

function getWorkflowOriginalKwcdnUrls(result) {
  return (Array.isArray(result?.images) ? result.images : [])
    .filter((image) => image?.role === "original" || isWorkflowOriginalImageType(image?.imageType))
    .map((image) => String(image?.kwcdnUrl || "").trim())
    .filter(Boolean)
    .slice(0, WORKFLOW_MAX_MAIN_IMAGE_COUNT);
}

function buildWorkflowOriginalUploadSources(originalSources = [], minCount = WORKFLOW_MIN_MAIN_IMAGE_COUNT) {
  const eligible = (Array.isArray(originalSources) ? originalSources : [])
    .filter((source) => source?.sourceImagePath && fs.existsSync(source.sourceImagePath))
    .slice(0, WORKFLOW_MAX_MAIN_IMAGE_COUNT);
  if (eligible.length === 0) return [];
  const output = eligible.slice();
  let index = 0;
  while (output.length < minCount && output.length < WORKFLOW_MAX_MAIN_IMAGE_COUNT) {
    const source = eligible[index % eligible.length];
    output.push({
      ...source,
      paddedFromIndex: index % eligible.length,
      paddedMainImage: true,
    });
    index += 1;
  }
  return output.slice(0, WORKFLOW_MAX_MAIN_IMAGE_COUNT);
}

function getWorkflowRowImageCandidates(table, row) {
  const values = [];
  if (table?.imageIdx >= 0) values.push(row?.[table.imageIdx]);
  if (table?.carouselIdx >= 0) values.push(row?.[table.carouselIdx]);
  const candidates = [];
  for (const value of values) {
    for (const candidate of extractWorkflowImageCandidates(value)) {
      const normalized = String(candidate || "").trim();
      if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
    }
  }
  return candidates;
}

function buildWorkflowDraftParamsFromRow(table, row, rowResult, params = {}) {
  const getCol = (idx) => idx >= 0 ? normalizeCellText(row?.[idx]) : "";
  const rawTitle = getCol(table.nameIdx) || getCol(table.nameEnIdx);
  const finalTitle = cleanWorkflowListingTitle(rawTitle);
  if (!finalTitle) {
    return { success: false, message: "标题清洗后为空，请补标题", step: "title_clean" };
  }

  const originalKwcdnUrls = getWorkflowOriginalKwcdnUrls(rowResult);
  const originalKwcdnUrl = originalKwcdnUrls[0] || "";
  if (!originalKwcdnUrl) {
    return { success: false, message: "合格原图未上传素材中心，无法保存草稿", step: "original_kwcdn" };
  }

  const quantityCounts = [1, 2, 3, 4];
  const quantitySkuImages = { 1: originalKwcdnUrl, "1PC": originalKwcdnUrl, "1PCS": originalKwcdnUrl };
  for (const count of quantityCounts.filter((item) => item > 1)) {
    const packImage = getWorkflowResultImage(rowResult, getWorkflowPackImageType(count));
    const packKwcdnUrl = packImage?.kwcdnUrl || "";
    if (!packKwcdnUrl) {
      return { success: false, message: `${count}PC SKU 图未上传素材中心，无法保存草稿`, step: "quantity_sku_image" };
    }
    quantitySkuImages[count] = packKwcdnUrl;
    quantitySkuImages[`${count}PC`] = packKwcdnUrl;
    quantitySkuImages[`${count}PCS`] = packKwcdnUrl;
  }

  const frontCategoryCn = table.frontCatIdx >= 0 ? normalizeCategoryText(row[table.frontCatIdx]) : "";
  const backCategoryCn = table.backCatIdx >= 0 ? normalizeCategoryText(row[table.backCatIdx]) : "";
  const genericCategoryCn = table.genericCatIdx >= 0 ? normalizeCategoryText(row[table.genericCatIdx]) : "";
  const preferredCategoryCn = backCategoryCn || genericCategoryCn || frontCategoryCn;
  const priceUSD = table.priceIdx >= 0 ? normalizePriceNumber(row[table.priceIdx], 0) : 0;
  const tablePriceCNY = table.priceCnyIdx >= 0 ? normalizePriceNumber(row[table.priceCnyIdx], 0) : 0;
  const priceCNY = priceUSD > 0 ? priceUSD * 7 : (tablePriceCNY > 0 ? tablePriceCNY : 9.99);
  const sourceProductId = table.goodsIdIdx >= 0 ? normalizeHistoryIdentifier(getCol(table.goodsIdIdx)) : "";
  const sourceSpuId = table.productIdIdx >= 0 ? normalizeHistoryIdentifier(getCol(table.productIdIdx)) : "";
  const sourceSkcId = table.productSkcIdIdx >= 0 ? normalizeHistoryIdentifier(getCol(table.productSkcIdIdx)) : "";
  const directLeafCatId = table.directLeafCatIdx >= 0 ? (Number(getCol(table.directLeafCatIdx)) || 0) : 0;
  const directCatIds = parseCategoryIdsCell(table.catIdsJsonIdx >= 0 ? getCol(table.catIdsJsonIdx) : "") || {};
  for (const [key, idx] of Object.entries(table.catIdIndexes || {})) {
    const nextId = Number(getCol(idx)) || 0;
    if (nextId > 0) directCatIds[key] = nextId;
  }
  for (const [key, idx] of Object.entries(table.catNameIndexes || {})) {
    const nextName = getCol(idx);
    if (nextName) directCatIds[key] = nextName;
  }
  if (!directCatIds._path && preferredCategoryCn) directCatIds._path = preferredCategoryCn;

  const categoryLockMode = (
    directLeafCatId > 0
    || Object.keys(directCatIds).some((key) => key !== "_path")
    || Boolean(backCategoryCn)
    || Boolean(genericCategoryCn)
    || Boolean(frontCategoryCn)
  ) ? "strict" : "guided";

  return {
    success: true,
    title: finalTitle,
    rawTitle,
    imageUrls: originalKwcdnUrls,
    expectedMainImageMin: WORKFLOW_MIN_MAIN_IMAGE_COUNT,
    quantitySkuImages,
    quantityCounts,
    workflowQuantitySpecs: true,
    workflowRandomSpecValueCount: Math.max(1, Number(params.workflowRandomSpecValueCount) || 2),
    workflowQuantityPriceMultipliers: normalizeWorkflowQuantityPriceMultipliers(params.workflowQuantityPriceMultipliers),
    price: priceCNY,
    categorySearch: categoryLockMode === "guided" ? finalTitle : (preferredCategoryCn || finalTitle),
    categorySearchVariants: categoryLockMode === "strict"
      ? [backCategoryCn, genericCategoryCn, frontCategoryCn].map((value) => normalizeCategoryText(value)).filter(Boolean)
      : buildGuidedCategorySearchVariants(finalTitle, "", backCategoryCn),
    categoryLockMode,
    sourceProductId,
    goodsId: sourceProductId || undefined,
    productId: sourceSpuId || undefined,
    productSkcId: sourceSkcId || undefined,
    leafCatId: directLeafCatId || undefined,
    catIds: Object.keys(directCatIds).length > 0 ? directCatIds : undefined,
    keepOpen: false,
    config: params.config,
    multiplyPriceByQuantity: params.multiplyPriceByQuantity,
  };
}

async function generateWorkflowPackImages(params = {}) {
  const csvPath = String(params.csvPath || params.filePath || "").trim();
  if (!csvPath || !fs.existsSync(csvPath)) {
    return { success: false, message: "请先上传商品表格" };
  }

  const packCounts = normalizeWorkflowPackCounts(params.packCounts);
  if (packCounts.length === 0) {
    return { success: false, message: "组合数量无效" };
  }

  const startRow = Math.max(0, Number(params.startRow) || 0);
  const count = Math.max(1, Math.min(Number(params.count) || 1, 20));
  const table = getWorkflowProductRows(csvPath);
  if (table.imageIdx < 0) {
    return {
      success: false,
      message: `未识别到商品原图列，当前表头：${table.headers.slice(0, 12).join(" | ")}`,
      headers: table.headers,
    };
  }

  const total = Math.max(0, Math.min(count, table.dataRows.length - startRow));
  if (total <= 0) {
    return { success: false, message: "没有可处理的商品行" };
  }

  const taskId = typeof params?.taskId === "string" && params.taskId.trim()
    ? params.taskId.trim()
    : `workflow_pack_${Date.now()}`;
  const tmpDir = getTmpDir("workflow-pack-tmp");
  const outputDir = path.join(getDebugDir(), "workflow-pack-images", taskId);
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  logWorkflowPack(taskId, `start kind=${table.spreadsheetKind}, header=${table.headerRowIdx}, start=${startRow}, total=${total}, packs=${packCounts.join(",")}, csv=${csvPath}`);
  const results = [];
  let kwcdnTablePath = "";
  const shouldCreateDrafts = Boolean(params.createDrafts || params.workflowCreateDrafts);
  const startedAt = getProgressTimestamp();
  replaceCurrentProgress({
    taskId,
    flowType: "workflow",
    status: "running",
    running: true,
    paused: false,
    total,
    completed: 0,
    current: "准备中",
    step: "新上品流程",
    message: "正在准备卖家中心会话、素材中心上传和草稿保存链路",
    csvPath,
    startRow,
    count,
    createdAt: startedAt,
    startedAt,
    updatedAt: startedAt,
  });

  let stopAuthPopupMonitor = null;
  try {
    await ensureBrowser();
    stopAuthPopupMonitor = registerSellerAuthPopupMonitor("[workflow-pack-popup]");
    updateCurrentProgress({
      step: "预热登录态",
      message: "正在确认卖家中心登录/授权状态...",
    });
    await establishSellerCentralSession("[workflow-pack]");

    for (let offset = 0; offset < total; offset += 1) {
      const dataIndex = startRow + offset;
      const row = table.dataRows[dataIndex];
      const rowNumber = (table.dataRowIndexes?.[dataIndex] ?? (table.headerRowIdx + 1 + dataIndex)) + 1;
      const productName = normalizeCellText(table.nameIdx >= 0 ? row[table.nameIdx] : "") || `第 ${rowNumber} 行商品`;
      const sourceImagePath = path.join(tmpDir, `${taskId}_${dataIndex}_source.jpg`);
      const imageCandidates = getWorkflowRowImageCandidates(table, row);

      try {
        syncCurrentProgressResults(results, {
          flowType: "workflow",
          running: true,
          paused: false,
          status: "running",
          total,
          current: `${offset + 1}/${total} ${productName.slice(0, 30)}`,
          step: "读取商品原图",
          message: "正在下载并筛选可上传的原图素材",
        });
        logWorkflowPack(taskId, `row=${rowNumber} product="${productName.slice(0, 80)}" source download start candidates=${imageCandidates.length}`);
        const source = await prepareWorkflowSourceImages(imageCandidates, sourceImagePath, { productName, taskId });
        logWorkflowPack(taskId, `row=${rowNumber} source ready path=${source.sourceImagePath}, originalUploadEligible=${source.originalUploadEligible}, acceptedOriginals=${source.originals?.length || 0}`);
        updateCurrentProgress({
          step: "生成白底组合图",
          message: "正在生成 2PCS / 3PCS / 4PCS 白底素材",
        });
        const aiResult = await generateWorkflowWhitePackImages(source.sourceImagePath, productName, packCounts, { taskId, rowNumber });
        const localFiles = saveWorkflowPackImages(aiResult.images, outputDir, dataIndex);
        const originalSources = Array.isArray(source.originals) && source.originals.length > 0
          ? source.originals
          : (source.originalUploadEligible ? [{ sourceImagePath: source.sourceImagePath, originalFilter: source.originalFilter, candidate: source.sourceImageUrl }] : []);
        const originalUploadSources = buildWorkflowOriginalUploadSources(originalSources, WORKFLOW_MIN_MAIN_IMAGE_COUNT);
        const originalMaterials = originalUploadSources.map((original, index) => ({
          ...original,
          ...saveWorkflowOriginalMaterialImage(original.sourceImagePath, outputDir, dataIndex, getWorkflowOriginalImageType(index)),
        }));
        const materialSpecs = buildWorkflowMaterialImageSpecs(packCounts, originalMaterials.length || 1);
        let images = materialSpecs.map((spec) => {
          const imageType = spec.imageType;
          if (spec.role === "original") {
            const originalMaterial = originalMaterials[spec.sourceIndex || 0] || { imageUrl: "", localPath: "", originalFilter: null };
            return {
              packCount: spec.packCount,
              imageType,
              role: spec.role,
              label: spec.label,
              imageUrl: originalMaterial.imageUrl,
              localPath: originalMaterial.localPath,
              uploadEligible: Boolean(source.originalUploadEligible),
              skipped: !source.originalUploadEligible,
              error: source.originalUploadEligible ? "" : (source.originalFilter?.reasons?.join("；") || "原图不上传素材中心"),
              warnings: originalMaterial.originalFilter?.warning ? [originalMaterial.originalFilter.warning] : [],
              filter: originalMaterial.originalFilter || source.originalFilter || null,
              sourceImageUrl: originalMaterial.candidate || "",
              sourceIndex: spec.sourceIndex || 0,
            };
          }
          return {
            packCount: spec.packCount,
            imageType,
            role: spec.role,
            label: spec.label,
            imageUrl: aiResult.images?.[imageType] || "",
            localPath: localFiles[imageType] || "",
            uploadEligible: true,
            skipped: false,
            error: aiResult.errors?.[imageType] || "",
            warnings: aiResult.warnings?.[imageType] || [],
          };
        });
        const successCount = images.filter((item) => item.imageUrl).length;
        const skippedCount = images.filter((item) => item.skipped).length;
        const requiredCount = Math.max(0, materialSpecs.length - skippedCount);
        const materialSuccess = successCount >= requiredCount;
        updateCurrentProgress({
          step: "上传素材中心",
          message: "正在上传原图和白底组合素材，并回写 kwcdn URL",
        });
        const uploadSummary = materialSuccess
          ? await uploadWorkflowMaterialImages(images, { taskId, rowNumber })
          : getEmptyWorkflowUploadSummary(images);
        images = uploadSummary.images;
        const uploadSuccess = materialSuccess
          && uploadSummary.uploadableCount > 0
          && uploadSummary.uploadFailCount === 0
          && uploadSummary.uploadSuccessCount >= uploadSummary.uploadableCount;
        const rowSuccess = materialSuccess && uploadSuccess;
        const rowResult = {
          index: dataIndex,
          rowNumber,
          name: productName.slice(0, 120),
          sourceImageUrl: source.sourceImageUrl,
          originalUploadEligible: Boolean(source.originalUploadEligible),
          originalFilter: source.originalFilter || null,
          rejectedOriginals: source.rejectedOriginals || [],
          success: rowSuccess,
          successCount,
          skippedCount,
          requiredCount,
          uploadableCount: uploadSummary.uploadableCount,
          uploadSuccessCount: uploadSummary.uploadSuccessCount,
          uploadFailCount: uploadSummary.uploadFailCount,
          uploadSkippedCount: uploadSummary.uploadSkippedCount,
          total: materialSpecs.length,
          materialTypes: materialSpecs.map((item) => item.imageType),
          message: !materialSuccess
            ? (aiResult.error || `仅准备 ${successCount}/${requiredCount} 张`)
            : rowSuccess
              ? (skippedCount > 0 ? "素材已上传，原图已按规则跳过" : "素材已上传并回写 kwcdn URL")
              : `素材上传失败 ${uploadSummary.uploadFailCount}/${uploadSummary.uploadableCount}`,
          errorCategory: rowSuccess ? "" : (materialSuccess ? classifyAutoPricingError("image_upload", uploadSummary.firstError || "") : classifyAutoPricingError("image_gen", aiResult.error || "")),
          images,
        };
        if (shouldCreateDrafts && rowSuccess) {
          const draftParams = buildWorkflowDraftParamsFromRow(table, row, rowResult, params);
          if (!draftParams.success) {
            rowResult.success = false;
            rowResult.message = draftParams.message;
            rowResult.errorCategory = classifyAutoPricingError("draft", draftParams.message);
            rowResult.draftStep = draftParams.step;
          } else {
            updateCurrentProgress({
              step: "保存草稿",
              message: "素材已准备完成，正在保存到 Temu 草稿箱",
            });
            logWorkflowPack(taskId, `row=${rowNumber} draft save start title="${draftParams.title.slice(0, 80)}"`);
            const draftResult = await createProductViaAPI(draftParams);
            rowResult.draftResult = draftResult;
            rowResult.title = draftParams.title;
            rowResult.rawTitle = draftParams.rawTitle;
            rowResult.draftId = draftResult?.draftId || draftResult?.productDraftId || "";
            rowResult.productId = draftResult?.productId || "";
            rowResult.skcId = draftResult?.skcId || "";
            rowResult.skuId = draftResult?.skuId || "";
            rowResult.draftStep = draftResult?.step || "";
            rowResult.errorCode = draftResult?.errorCode || "";
            rowResult.debugFile = draftResult?.debugFile || "";
            rowResult.draftSaved = Boolean(draftResult?.draftSaved);
            rowResult.verificationReason = draftResult?.verificationReason || "";
            rowResult.success = Boolean(draftResult?.success);
            rowResult.message = draftResult?.success
              ? (draftResult.message || "商品已保存到Temu草稿箱")
              : getDraftFailureMessage(draftResult);
            rowResult.errorCategory = draftResult?.success ? "" : classifyAutoPricingError("draft", rowResult.message);
            logWorkflowPack(taskId, `row=${rowNumber} draft ${draftResult?.success ? "ok" : "failed"} ${rowResult.draftId || rowResult.message}`);
          }
        }
        results.push(rowResult);
        syncCurrentProgressResults(results, {
          flowType: "workflow",
          running: true,
          paused: false,
          status: "running",
          total,
          current: `${offset + 1}/${total} ${productName.slice(0, 30)}`,
          step: rowResult.success ? "本条完成" : "本条失败",
          message: rowResult.message || (rowResult.success ? "当前商品已完成" : "当前商品处理失败"),
        });
        logWorkflowPack(taskId, `row=${rowNumber} done generated=${successCount}/${requiredCount}, uploaded=${uploadSummary.uploadSuccessCount}/${uploadSummary.uploadableCount}, skipped=${skippedCount}`);
        try {
          kwcdnTablePath = writeWorkflowKwcdnResultTable(csvPath, table, results, outputDir, taskId, packCounts);
          fs.writeFileSync(path.join(outputDir, "result.json"), JSON.stringify({ taskId, total, packCounts, kwcdnTablePath, results }, null, 2), "utf8");
        } catch (error) {
          logSilent("workflow-pack.result.write", error);
        }
      } catch (error) {
        logWorkflowPack(taskId, `row=${rowNumber} failed: ${error?.message || String(error || "生成失败")}`);
        results.push({
          index: dataIndex,
          rowNumber,
          name: productName.slice(0, 120),
          sourceImageUrl: extractWorkflowImageCandidate(row[table.imageIdx]),
          success: false,
          successCount: 0,
          total: packCounts.length + 1,
          message: error?.message || String(error || "生成失败"),
          materialTypes: buildWorkflowMaterialImageSpecs(packCounts).map((item) => item.imageType),
          images: buildWorkflowMaterialImageSpecs(packCounts).map((spec) => ({
            packCount: spec.packCount,
            imageType: spec.imageType,
            role: spec.role,
            label: spec.label,
            imageUrl: "",
            localPath: "",
            uploadEligible: spec.role !== "original",
            skipped: false,
            error: error?.message || String(error || "生成失败"),
            warnings: [],
          })),
        });
        syncCurrentProgressResults(results, {
          flowType: "workflow",
          running: true,
          paused: false,
          status: "running",
          total,
          current: `${offset + 1}/${total} ${productName.slice(0, 30)}`,
          step: "本条失败",
          message: error?.message || String(error || "生成失败"),
        });
        try {
          kwcdnTablePath = writeWorkflowKwcdnResultTable(csvPath, table, results, outputDir, taskId, packCounts);
          fs.writeFileSync(path.join(outputDir, "result.json"), JSON.stringify({ taskId, total, packCounts, kwcdnTablePath, results }, null, 2), "utf8");
        } catch (writeError) {
          logSilent("workflow-pack.result.write", writeError);
        }
      }
    }
  } catch (error) {
    const message = error?.message || String(error || "卖家中心会话准备失败");
    logWorkflowPack(taskId, `seller session failed: ${message}`);
    const failedAt = getProgressTimestamp();
    syncCurrentProgressResults(results, {
      flowType: "workflow",
      running: false,
      paused: false,
      status: "failed",
      total,
      completed: results.length,
      current: "失败",
      step: "登录/授权失败",
      message: `卖家中心登录/授权未完成，无法上传素材中心：${message}`,
      updatedAt: failedAt,
      finishedAt: failedAt,
    });
    return {
      success: false,
      taskId,
      total,
      successCount: 0,
      partialCount: 0,
      failCount: total,
      packCounts,
      outputDir,
      kwcdnTablePath,
      message: `卖家中心登录/授权未完成，无法上传素材中心：${message}`,
      results,
    };
  } finally {
    try {
      stopAuthPopupMonitor?.();
    } catch (error) {
      logSilent("workflow-pack.popup.cleanup", error);
    }
  }

  const successCount = results.filter((item) => item.success).length;
  const partialCount = results.filter((item) => !item.success && item.successCount > 0).length;
  const finalResult = {
    success: successCount > 0 || partialCount > 0,
    taskId,
    total,
    successCount,
    partialCount,
    failCount: total - successCount - partialCount,
    packCounts,
    outputDir,
    kwcdnTablePath,
    results,
  };
  logWorkflowPack(taskId, `finish success=${finalResult.success} complete=${successCount} partial=${partialCount} fail=${finalResult.failCount}`);
  const finishedAt = getProgressTimestamp();
  syncCurrentProgressResults(results, {
    flowType: "workflow",
    running: false,
    paused: false,
    status: finalResult.success ? "completed" : "failed",
    total,
    completed: total,
    current: finalResult.success ? "完成" : "处理未完成",
    step: "完成",
    message: `新上品流程完成：成功 ${successCount}，部分 ${partialCount}，失败 ${finalResult.failCount}`,
    updatedAt: finishedAt,
    finishedAt,
  });
  try {
    fs.writeFileSync(path.join(outputDir, "result.json"), JSON.stringify(finalResult, null, 2), "utf8");
  } catch (error) {
    logSilent("workflow-pack.result.write", error);
  }
  return finalResult;
}

async function generateImagesWithAI(sourceImagePath, productTitle, extraImagePaths = []) {
  const parsePositiveEnvInt = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  };
  const AI_SINGLE_IMAGE_REQUEST_TIMEOUT_MS = parsePositiveEnvInt("AUTO_PRICING_AI_REQUEST_TIMEOUT_MS", 15 * 60 * 1000);
  const AI_SINGLE_IMAGE_IDLE_TIMEOUT_MS = parsePositiveEnvInt("AUTO_PRICING_AI_IDLE_TIMEOUT_MS", 5 * 60 * 1000);
  const AI_SINGLE_IMAGE_CONCURRENCY_LIMIT = Math.max(
    1,
    parsePositiveEnvInt("AUTO_PRICING_AI_GENERATE_CONCURRENCY", REQUIRED_AI_DETAIL_IMAGE_COUNT)
  );
  const imageBuffer = fs.readFileSync(sourceImagePath);
  const base64 = imageBuffer.toString("base64");
  const ext = path.extname(sourceImagePath).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : "image/jpeg";

  // 构建所有图片 buffer 列表（主图 + 轮播图）
  const allImageBlobs = [{ buffer: imageBuffer, name: path.basename(sourceImagePath), type: mimeType }];
  for (const ep of extraImagePaths.slice(0, 4)) {  // 最多额外4张（总共5张）
    try {
      if (fs.existsSync(ep)) {
        const buf = fs.readFileSync(ep);
        const eExt = path.extname(ep).toLowerCase();
        const eMime = eExt === ".png" ? "image/png" : "image/jpeg";
        allImageBlobs.push({ buffer: buf, name: path.basename(ep), type: eMime });
      }
    } catch (e) { logSilent("ui.action", e); }
  }
  console.error(`[ai-gen] Source images: ${allImageBlobs.length} (1 main + ${allImageBlobs.length - 1} carousel)`);

  // Step 1: 分析产品（传所有图片）—— 改用 form-data + node http 保证 multipart boundary 正确
  console.error("[ai-gen] Step 1: Analyzing product...");
  const analyzeStage = await fetchAiImageStageWithRetry({
    label: "Analyze failed",
    routePath: "/api/analyze",
    request: () => postMultipartViaNodeHttp(`${AI_IMAGE_GEN_URL}/api/analyze`, {
      fileBlobs: allImageBlobs,
      fields: { productMode: "single" },
      extraHeaders: AI_AUTH_HEADERS,
    }),
    maxRetries: 2,
  });

  let analysis = null;
  if (analyzeStage.success) {
    const analyzeResp = analyzeStage.response;
    analysis = await analyzeResp.json();
  } else if (shouldRetryAiImageRequest(analyzeStage.error)) {
    console.error(`[ai-gen] Primary analyze failed, trying direct fallback: ${analyzeStage.error}`);
    const fallbackAnalyze = await directAnalyzeProductImages({
      sourceImagePath,
      productTitle,
      extraImagePaths,
    });
    if (!fallbackAnalyze.success) {
      return {
        success: false,
        error: `${analyzeStage.error}; ${fallbackAnalyze.error}`,
      };
    }
    analysis = fallbackAnalyze.analysis;
    console.error("[ai-gen] Direct analyze fallback succeeded");
  } else {
    return { success: false, error: analyzeStage.error };
  }
  console.error(`[ai-gen] Analysis: ${analysis.productName?.slice(0, 40)}, category: ${analysis.category?.slice(0, 30)}`);

  // Step 2: 生成 plans（调用 /api/plans 获取带 prompt 的方案）
  console.error("[ai-gen] Step 2: Generating plans with prompts...");
  const plansStage = await fetchAiImageStageWithRetry({
    label: "Plans API failed",
    routePath: "/api/plans",
    request: () => fetch(`${AI_IMAGE_GEN_URL}/api/plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...AI_AUTH_HEADERS },
      body: JSON.stringify({
        analysis,
        imageTypes: AI_DETAIL_IMAGE_TYPE_ORDER,
        salesRegion: "us",
        imageSize: "1000x1000",
        productMode: "single",
      }),
    }),
    maxRetries: 2,
  });
  if (!plansStage.success) {
    return { success: false, error: plansStage.error };
  }
  const plansResp = plansStage.response;
  const { plans } = await plansResp.json();
  console.error(`[ai-gen] Got ${plans.length} plans with prompts`);

  // Step 3: 单图并发生成（每张图单独请求，互不影响）
  const images = {};
  let lastGenerateError = "";

  const generateConcurrency = Math.max(1, Math.min(plans.length || 1, AI_SINGLE_IMAGE_CONCURRENCY_LIMIT));
  console.error(
    `[ai-gen] Step 3: Generating ${plans.length} images ` +
    `(concurrency=${generateConcurrency}, requestTimeout=${Math.round(AI_SINGLE_IMAGE_REQUEST_TIMEOUT_MS / 1000)}s, idleTimeout=${Math.round(AI_SINGLE_IMAGE_IDLE_TIMEOUT_MS / 1000)}s)...`
  );

  // SSE 流处理函数
  async function processSSE(resp) {
    if (!resp.body) {
      throw new Error("AI 服务未返回可读取的数据流");
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const result = {};
    try {
      while (true) {
        let idleTimer = null;
        const { done, value } = await Promise.race([
          reader.read(),
          new Promise((_, reject) => {
            idleTimer = setTimeout(() => reject(new Error(`AI 图片生成超时（${Math.round(AI_SINGLE_IMAGE_IDLE_TIMEOUT_MS / 1000)}s 无响应）`)), AI_SINGLE_IMAGE_IDLE_TIMEOUT_MS);
          }),
        ]).finally(() => {
          if (idleTimer) clearTimeout(idleTimer);
        });
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.status === "done" && data.imageUrl) {
              result[data.imageType] = data.imageUrl;
              console.error(`[ai-gen] Generated: ${data.imageType}`);
            } else if (data.status === "error") {
              console.error(`[ai-gen] Error: ${data.imageType}: ${data.error}`);
            }
          } catch (e) { logSilent("sse.parse", e); }
        }
      }
      return result;
    } finally {
      // 确保 reader 被释放，避免在任何退出路径（含异常）下泄漏 HTTP 连接
      try { await reader.cancel(); } catch {}
      try { reader.releaseLock(); } catch {}
    }
  }

  async function generateSinglePlan(plan, retries = 2) {
    let latestPlanError = "";
    for (let attempt = 0; attempt <= retries; attempt++) {
      let requestTimer = null;
      const attemptStartedAt = Date.now();
      try {
        console.error(`[ai-gen] Start ${plan.imageType}, attempt ${attempt + 1}/${retries + 1}`);
        const form = new FormData();
        for (const img of allImageBlobs) {
          const blob = new Blob([img.buffer], { type: img.type || "image/jpeg" });
          form.append("images", blob, img.name);
        }
        form.append("plans", JSON.stringify([plan]));
        form.append("productMode", "single");
        form.append("imageLanguage", "en");
        form.append("imageSize", "1000x1000");
        const controller = new AbortController();
        requestTimer = setTimeout(() => controller.abort(), AI_SINGLE_IMAGE_REQUEST_TIMEOUT_MS);
        const resp = await fetch(`${AI_IMAGE_GEN_URL}/api/generate`, {
          method: "POST",
          body: form,
          headers: AI_AUTH_HEADERS,
          signal: controller.signal,
        });
        if (resp.ok) {
          const singleResult = await processSSE(resp);
          if (singleResult[plan.imageType]) {
            const elapsedSec = ((Date.now() - attemptStartedAt) / 1000).toFixed(1);
            console.error(`[ai-gen] Done ${plan.imageType}, attempt ${attempt + 1}/${retries + 1}, ${elapsedSec}s`);
            return singleResult[plan.imageType];
          }
          latestPlanError = `Generate failed (${plan.imageType}): 未返回图片`;
          const elapsedSec = ((Date.now() - attemptStartedAt) / 1000).toFixed(1);
          console.error(`[ai-gen] Missing image for ${plan.imageType}, attempt ${attempt + 1}/${retries + 1}, ${elapsedSec}s`);
        } else {
          latestPlanError = await formatAiImageError(`Generate failed (${plan.imageType})`, resp);
          const elapsedSec = ((Date.now() - attemptStartedAt) / 1000).toFixed(1);
          console.error(`[ai-gen] HTTP ${resp.status} for ${plan.imageType}, attempt ${attempt + 1}/${retries + 1}, ${elapsedSec}s`);
        }
      } catch (e) {
        latestPlanError = formatAiImageFetchError(`Generate failed (${plan.imageType})`, e, "/api/generate");
        const elapsedSec = ((Date.now() - attemptStartedAt) / 1000).toFixed(1);
        console.error(`[ai-gen] Error for ${plan.imageType}: ${e.message}, attempt ${attempt + 1}/${retries + 1}, ${elapsedSec}s`);
      } finally {
        if (requestTimer) clearTimeout(requestTimer);
      }
      if (isAiUpstreamBusyMessage(latestPlanError)) {
        lastGenerateError = latestPlanError;
        return { imageType: plan.imageType, imageUrl: null, error: latestPlanError };
      }
      if (attempt < retries) {
        const waitMs = Math.min(30000, 5000 * (attempt + 1));
        console.error(`[ai-gen] Retry ${plan.imageType} in ${Math.round(waitMs / 1000)}s`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
    if (latestPlanError) {
      lastGenerateError = latestPlanError;
    }
    return { imageType: plan.imageType, imageUrl: null, error: latestPlanError };
  }

  async function generatePlansWithLimit(targetPlans, retries, stageLabel) {
    const settled = new Array(targetPlans.length);
    const concurrency = Math.max(1, Math.min(generateConcurrency, targetPlans.length || 1));
    let cursor = 0;
    console.error(`[ai-gen] ${stageLabel}: ${targetPlans.length} plan(s), concurrency=${concurrency}`);

    async function runWorker(workerIndex) {
      while (cursor < targetPlans.length) {
        const index = cursor;
        cursor += 1;
        const plan = targetPlans[index];
        try {
          const value = await generateSinglePlan(plan, retries);
          settled[index] = { status: "fulfilled", value };
        } catch (reason) {
          settled[index] = { status: "rejected", reason };
          console.error(`[ai-gen] Worker ${workerIndex + 1} rejected ${plan?.imageType || index}: ${reason?.message || reason}`);
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, (_, workerIndex) => runWorker(workerIndex)));
    return settled;
  }

  const perPlanErrors = {};
  const firstPassResults = await generatePlansWithLimit(plans, 2, "First pass");
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const result = firstPassResults[i];
    if (result?.status === "fulfilled" && result.value) {
      // 兼容旧返回（字符串 url）和新返回（对象）
      if (typeof result.value === "string") {
        images[plan.imageType] = result.value;
      } else if (result.value.imageUrl) {
        images[plan.imageType] = result.value.imageUrl;
      } else if (result.value.error) {
        perPlanErrors[plan.imageType] = result.value.error;
      }
    } else if (result?.status === "rejected") {
      perPlanErrors[plan.imageType] = String(result.reason?.message || result.reason || "unknown");
    }
  }

  // 检查缺失的图片，单独重试
  const missingPlans = plans.filter(p => !images[p.imageType]);
  if (missingPlans.length > 0) {
    console.error(`[ai-gen] Missing ${missingPlans.length} images after limited run, retrying with same queue...`);
    const retryResults = await generatePlansWithLimit(missingPlans, 1, "Missing retry");
    for (let i = 0; i < missingPlans.length; i++) {
      const plan = missingPlans[i];
      const result = retryResults[i];
      if (result?.status === "fulfilled" && result.value) {
        if (typeof result.value === "string") {
          images[plan.imageType] = result.value;
          delete perPlanErrors[plan.imageType];
        } else if (result.value.imageUrl) {
          images[plan.imageType] = result.value.imageUrl;
          delete perPlanErrors[plan.imageType];
        } else if (result.value.error) {
          perPlanErrors[plan.imageType] = result.value.error;
        }
      } else if (result?.status === "rejected") {
        perPlanErrors[plan.imageType] = String(result.reason?.message || result.reason || "unknown");
      }
    }
  }

  console.error(`[ai-gen] Total generated: ${Object.keys(images).length}/${plans.length}`);
  const success = Object.keys(images).length >= REQUIRED_AI_DETAIL_IMAGE_COUNT;
  // 汇总每个失败 plan 的独立错误，避免全局串用 lastGenerateError
  let aggregatedError = "";
  if (!success) {
    const missingErrors = Object.entries(perPlanErrors).map(([k, v]) => `${k}: ${v}`).join("; ");
    aggregatedError = missingErrors || lastGenerateError || "未知错误";
  }
  return { success, images, analysis, error: aggregatedError };
}

/**
 * 将 base64 图片保存为本地文件
 */
// saveBase64Image → moved to utils.mjs

/**
 * 在 Temu 页面中上传图片到素材中心，获取 kwcdn URL
 */
async function uploadImageToKwcdn(page, localImagePath) {
  const result = await uploadImageToMaterial(page, localImagePath);
  if (result.success && result.url) {
    return { success: true, url: result.url, width: result.width, height: result.height, error: "" };
  }
  return { success: false, url: null, error: result.error || "unknown upload error" };
}

function normalizeUploadConcurrency(value, fallback = 3) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(4, Math.floor(parsed)));
}

const DEFAULT_PRODUCT_INTERVAL_MIN = 0.15;
const DEFAULT_PRODUCT_INTERVAL_MAX = 0.3;

function normalizeIntervalMinutes(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

async function createMaterialUploadPage() {
  return await createSellerCentralPage("/goods/list", {
    attempts: 2,
    lite: false,
    readyDelayMin: 3000,
    readyDelayMax: 5000,
    logPrefix: "[upload-page]",
  });
}

async function uploadImagesToKwcdnSerial(localImages, options = {}) {
  const uploadTypes = Array.isArray(options.types) && options.types.length > 0
    ? options.types.filter((type) => localImages[type])
    : AI_DETAIL_IMAGE_TYPE_ORDER.filter((type) => localImages[type]);
  const kwcdnUrls = {};
  const uploadErrors = {};
  if (uploadTypes.length === 0) {
    return { kwcdnUrls, uploadErrors, concurrency: 0, mode: "serial" };
  }

  let page = await createMaterialUploadPage();
  try {
    console.error(`[auto-pricing] Upload fallback: serial mode for ${uploadTypes.length} images`);
    for (const type of uploadTypes) {
      let uploadResult = await uploadImageToKwcdn(page, localImages[type]);
      if (!uploadResult.success && (
        isMaterialUploadRecoverableError(uploadResult.error)
        || isMaterialUploadNavigationTimeoutError(uploadResult.error)
      )) {
        console.error(`[auto-pricing] Serial upload retry for ${type}: ${uploadResult.error}`);
        await page.close().catch(() => {});
        page = await createMaterialUploadPage();
        uploadResult = await uploadImageToKwcdn(page, localImages[type]);
      }
      if (uploadResult.success && uploadResult.url) {
        kwcdnUrls[type] = uploadResult.url;
      } else {
        uploadErrors[type] = uploadResult.error || "unknown upload error";
      }
    }
    return { kwcdnUrls, uploadErrors, concurrency: 1, mode: "serial" };
  } finally {
    await page.close().catch(() => {});
  }
}

async function uploadImagesToKwcdnConcurrently(localImages, options = {}) {
  const uploadTypes = AI_DETAIL_IMAGE_TYPE_ORDER.filter((type) => localImages[type]);
  const kwcdnUrls = {};
  const uploadErrors = {};
  if (uploadTypes.length === 0) {
    return { kwcdnUrls, uploadErrors, concurrency: 0 };
  }

  const targetConcurrency = Math.min(
    uploadTypes.length,
    normalizeUploadConcurrency(options.concurrency, 3),
  );
  if (targetConcurrency <= 1) {
    return uploadImagesToKwcdnSerial(localImages, { types: uploadTypes });
  }
  const uploadPages = [];

  try {
    try {
      uploadPages.push(await createMaterialUploadPage());
    } catch (error) {
      console.error(`[auto-pricing] Upload page init failed, fallback to serial: ${error?.message || error}`);
      return uploadImagesToKwcdnSerial(localImages, { types: uploadTypes });
    }

    for (let i = 1; i < targetConcurrency; i += 1) {
      try {
        uploadPages.push(await createMaterialUploadPage());
      } catch (error) {
        console.error(`[auto-pricing] Upload page init failed: ${error?.message || error}`);
      }
    }

    console.error(`[auto-pricing] Uploading ${uploadTypes.length} images with concurrency=${uploadPages.length}...`);

    for (let i = 0; i < uploadTypes.length; i += uploadPages.length) {
      const batch = uploadTypes.slice(i, i + uploadPages.length);
      const batchResults = await Promise.allSettled(
        batch.map((type, index) => uploadImageToKwcdn(uploadPages[index], localImages[type])),
      );

      batchResults.forEach((result, index) => {
        const type = batch[index];
        if (!type) return;
        if (result.status === "fulfilled" && result.value?.success && result.value.url) {
          kwcdnUrls[type] = result.value.url;
          console.error(`[auto-pricing] Uploaded ${type}: ${result.value.url.slice(0, 60)}`);
          return;
        }
        const errorMessage = result.status === "fulfilled"
          ? (result.value?.error || "unknown upload error")
          : (result.reason?.message || String(result.reason || "unknown upload error"));
        uploadErrors[type] = errorMessage;
        console.error(`[auto-pricing] Upload failed for ${type}: ${errorMessage}`);
      });

      const retryableTypes = batch.filter((type) => {
        const errorMessage = uploadErrors[type];
        return errorMessage && (
          isMaterialUploadRecoverableError(errorMessage)
          || isMaterialUploadNavigationTimeoutError(errorMessage)
        );
      });

      if (retryableTypes.length > 0) {
        console.error(`[auto-pricing] Upload fallback triggered for ${retryableTypes.join(", ")}`);
        const fallbackResult = await uploadImagesToKwcdnSerial(localImages, { types: retryableTypes });
        Object.assign(kwcdnUrls, fallbackResult.kwcdnUrls);
        retryableTypes.forEach((type) => {
          if (fallbackResult.kwcdnUrls[type]) {
            delete uploadErrors[type];
          } else if (fallbackResult.uploadErrors[type]) {
            uploadErrors[type] = fallbackResult.uploadErrors[type];
          }
        });
      }
    }

    return { kwcdnUrls, uploadErrors, concurrency: uploadPages.length };
  } finally {
    await Promise.allSettled(uploadPages.map((page) => page.close().catch(() => {})));
  }
}

function getEmptyWorkflowUploadSummary(images = []) {
  const nextImages = Array.isArray(images) ? images.map((image) => ({ ...image })) : [];
  return {
    images: nextImages,
    uploadableCount: 0,
    uploadSuccessCount: 0,
    uploadFailCount: 0,
    uploadSkippedCount: nextImages.filter((image) => image?.skipped || image?.uploadEligible === false).length,
    firstError: "",
  };
}

async function uploadWorkflowMaterialImages(images = [], options = {}) {
  const taskId = String(options.taskId || "workflow-pack");
  const rowNumber = options.rowNumber || "";
  const nextImages = Array.isArray(images) ? images.map((image) => ({ ...image })) : [];
  const uploadItems = [];
  let uploadFailCount = 0;
  let firstError = "";

  nextImages.forEach((image, index) => {
    if (!image) return;
    if (image.skipped || image.uploadEligible === false) {
      image.uploadSkipped = true;
      return;
    }
    if (!image.localPath) {
      image.uploadSuccess = false;
      image.uploadError = "本地素材文件缺失";
      uploadFailCount += 1;
      firstError ||= image.uploadError;
      return;
    }
    if (!fs.existsSync(image.localPath)) {
      image.uploadSuccess = false;
      image.uploadError = `本地素材文件不存在：${image.localPath}`;
      uploadFailCount += 1;
      firstError ||= image.uploadError;
      return;
    }
    uploadItems.push({ image, index });
  });

  const uploadableCount = uploadItems.length + uploadFailCount;
  if (uploadItems.length === 0) {
    return {
      images: nextImages,
      uploadableCount,
      uploadSuccessCount: 0,
      uploadFailCount,
      uploadSkippedCount: nextImages.filter((image) => image?.skipped || image?.uploadEligible === false).length,
      firstError,
    };
  }

  let page = null;
  let uploadSuccessCount = 0;
  try {
    page = await createMaterialUploadPage();
  } catch (error) {
    const rawError = error?.message || String(error || "material upload page init failed");
    const userError = formatAutoPricingUserError(rawError);
    uploadItems.forEach((item) => {
      item.image.uploadSuccess = false;
      item.image.uploadError = userError;
      item.image.uploadRawError = rawError;
    });
    return {
      images: nextImages,
      uploadableCount,
      uploadSuccessCount: 0,
      uploadFailCount: uploadFailCount + uploadItems.length,
      uploadSkippedCount: nextImages.filter((image) => image?.skipped || image?.uploadEligible === false).length,
      firstError: firstError || rawError,
    };
  }

  try {
    for (const item of uploadItems) {
      const image = item.image;
      const type = image.imageType || image.label || `image_${item.index}`;
      console.error(`[workflow-pack] task=${taskId} row=${rowNumber} upload start type=${type}`);
      let uploadResult = await uploadImageToKwcdn(page, image.localPath);
      if (!uploadResult.success && (
        isMaterialUploadRecoverableError(uploadResult.error)
        || isMaterialUploadNavigationTimeoutError(uploadResult.error)
      )) {
        console.error(`[workflow-pack] task=${taskId} row=${rowNumber} retry upload type=${type}: ${uploadResult.error}`);
        await page.close().catch(() => {});
        page = await createMaterialUploadPage();
        uploadResult = await uploadImageToKwcdn(page, image.localPath);
      }

      if (uploadResult.success && uploadResult.url) {
        image.kwcdnUrl = uploadResult.url;
        image.materialCenterUrl = uploadResult.url;
        image.uploadSuccess = true;
        image.uploadError = "";
        image.uploadedWidth = uploadResult.width || null;
        image.uploadedHeight = uploadResult.height || null;
        uploadSuccessCount += 1;
        console.error(`[workflow-pack] task=${taskId} row=${rowNumber} upload ok type=${type} url=${uploadResult.url.slice(0, 80)}`);
      } else {
        const rawError = uploadResult.error || "unknown upload error";
        image.uploadSuccess = false;
        image.uploadError = formatAutoPricingUserError(rawError);
        image.uploadRawError = rawError;
        uploadFailCount += 1;
        firstError ||= rawError;
        console.error(`[workflow-pack] task=${taskId} row=${rowNumber} upload failed type=${type}: ${rawError}`);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  return {
    images: nextImages,
    uploadableCount,
    uploadSuccessCount,
    uploadFailCount,
    uploadSkippedCount: nextImages.filter((image) => image?.skipped || image?.uploadEligible === false).length,
    firstError,
  };
}

/**
 * 完整自动核价流程
 * @param {Object} params
 * @param {string} params.csvPath - CSV 文件路径
 * @param {number} [params.startRow=0] - 起始行
 * @param {number} [params.count=1] - 处理数量
 * @param {number} [params.intervalMin=0.15] - 最小间隔（分钟）
 * @param {number} [params.intervalMax=0.3] - 最大间隔（分钟）
 * @param {number} [params.uploadConcurrency=3] - 图片上传并发数
 */
async function autoPricingFromCSV(params) {
  console.error("[auto-pricing] Starting full auto pricing flow...");
  const taskId = typeof params?.taskId === "string" && params.taskId.trim()
    ? params.taskId.trim()
    : `pricing_${Date.now()}`;
  const csvPath = params.csvPath;
  if (!csvPath || !fs.existsSync(csvPath)) {
    const message = "CSV文件不存在: " + csvPath;
    const failedAt = getProgressTimestamp();
    replaceCurrentProgress({
      taskId,
      status: "failed",
      running: false,
      paused: false,
      current: "失败",
      step: "校验文件",
      message,
      csvPath: typeof csvPath === "string" ? csvPath : "",
      startRow: Number(params?.startRow) || 0,
      count: Number(params?.count) || 0,
      updatedAt: failedAt,
      finishedAt: failedAt,
    });
    return { success: false, taskId, message };
  }

  const startRow = params.startRow || 0;
  const count = params.count || 1;
  const intervalMin = normalizeIntervalMinutes(params.intervalMin, DEFAULT_PRODUCT_INTERVAL_MIN);
  const intervalMaxRaw = normalizeIntervalMinutes(params.intervalMax, DEFAULT_PRODUCT_INTERVAL_MAX);
  const intervalMax = Math.max(intervalMin, intervalMaxRaw);
  const uploadConcurrency = normalizeUploadConcurrency(params.uploadConcurrency, 3);
  const results = [];

  // 支持 CSV、Excel，以及后缀是 CSV 但内容实际为 Excel 的导出文件
  let headers, dataRows;
  const { kind: spreadsheetKind, rows: allRows } = readSpreadsheetRows(csvPath, { defval: "" });
  // 跳过可能的标题行（如"店铺信息"），找到真正的列头（包含"商品标题"或"商品名称"）
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(10, allRows.length); i++) {
    const row = allRows[i];
    if (row && row.some((c) => {
      const text = normalizeCellText(c);
      return text.includes("商品标题") || text.includes("商品名称") || text.includes("美元价格");
    })) {
      headerRowIdx = i;
      break;
    }
  }
  headers = (allRows[headerRowIdx] || []).map((h) => normalizeCellText(h));
  dataRows = allRows.slice(headerRowIdx + 1).filter(r => r && r.length > 0);
  console.error(`[auto-pricing] Spreadsheet file: kind=${spreadsheetKind}, header row=${headerRowIdx}, data rows=${dataRows.length}, headers=${headers.slice(0, 8).join("|")}`);

  const colIndex = (names) => {
    for (const name of names) {
      const idx = headers.findIndex(h => h && h.includes(name));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const nameIdx = colIndex(["商品标题（中文）", "商品名称", "title"]);
  const nameEnIdx = colIndex(["商品标题（英文）", "title_en"]);
  const imageIdx = colIndex(["商品主图", "商品原图", "image"]);
  const carouselIdx = colIndex(["商品轮播图"]);
  const frontCatCnIdx = colIndex(["前台分类（中文）"]);
  const backCatCnIdx = colIndex(["后台分类"]);
  const genericCatCnIdx = colIndex(["分类（中文）", "分类"]);
  const priceIdx = colIndex(["美元价格($)", "美元价格", "price"]);
  const exactColIndex = (patterns) => headers.findIndex((columnName) => patterns.some((pattern) => pattern.test(String(columnName || "").trim())));
  const directLeafCatIdx = exactColIndex([/^leafCatId$/i, /^leafCategoryId$/i, /^catId$/i, /^categoryId$/i, /^叶子类目ID$/i]);
  const catIdsJsonIdx = exactColIndex([/^catIds$/i, /^categoryIds$/i]);
  const goodsIdIdx = exactColIndex([/^商品ID$/i, /^goodsId$/i, /^goods_id$/i]);
  const productIdIdx = exactColIndex([/^productId$/i, /^spuId$/i, /^SPU ID$/i]);
  const productSkcIdIdx = exactColIndex([/^productSkcId$/i, /^skcId$/i, /^SKC ID$/i]);
  const catIdIndexes = {};
  const catNameIndexes = {};
  for (let level = 1; level <= 10; level += 1) {
    const catIdIdx = exactColIndex([new RegExp(`^cat${level}Id$`, "i")]);
    const catNameIdx = exactColIndex([new RegExp(`^cat${level}Name$`, "i")]);
    if (catIdIdx >= 0) catIdIndexes[`cat${level}Id`] = catIdIdx;
    if (catNameIdx >= 0) catNameIndexes[`cat${level}Name`] = catNameIdx;
  }
  const total = Math.max(0, Math.min(count, dataRows.length - startRow));

  console.error(`[auto-pricing] Columns: name=${nameIdx}, image=${imageIdx}, frontCat=${frontCatCnIdx}, backCat=${backCatCnIdx}, genericCat=${genericCatCnIdx}, leafCat=${directLeafCatIdx}, price=${priceIdx}`);
  if (imageIdx < 0) {
    const message = `未识别到商品原图列，当前表头：${headers.slice(0, 12).join(" | ")}`;
    const failedAt = getProgressTimestamp();
    replaceCurrentProgress({
      taskId,
      status: "failed",
      running: false,
      paused: false,
      total,
      completed: 0,
      current: "失败",
      step: "识别表头",
      message,
      results,
      updatedAt: failedAt,
      finishedAt: failedAt,
    });
    return { success: false, taskId, message };
  }

  console.error(`[auto-pricing] Will process ${total} products (dataRows=${dataRows.length})`);
  console.error(`[auto-pricing] Columns: name=${nameIdx}, nameEn=${nameEnIdx}, image=${imageIdx}, carousel=${carouselIdx}, frontCat=${frontCatCnIdx}, backCat=${backCatCnIdx}, genericCat=${genericCatCnIdx}, price=${priceIdx}`);

  // 创建临时目录
  const tmpDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "auto-pricing-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  pricingPaused = false;
  const startedAt = getProgressTimestamp();
  replaceCurrentProgress({
    taskId,
    status: "running",
    running: true,
    paused: false,
    total,
    completed: 0,
    current: "准备中...",
    step: "初始化",
    message: "批量上品任务运行中",
    csvPath,
    startRow,
    count,
    createdAt: startedAt,
    startedAt,
    updatedAt: startedAt,
  });
  const previousNavLiteMode = _navLiteMode;
  let stopAuthPopupMonitor = null;
  try {
    updateCurrentProgress({
      step: "预热登录态",
      message: "正在准备卖家中心会话...",
    });
    stopAuthPopupMonitor = registerSellerAuthPopupMonitor("[auto-pricing-popup]");
    await establishSellerCentralSession("[auto-pricing]");
    _navLiteMode = true;

  for (let i = startRow; i < startRow + total; i++) {
    const cols = dataRows[i] || [];
    const getCol = (idx) => idx >= 0 ? normalizeCellText(cols[idx]) : "";
    const productName = getCol(nameIdx) || getCol(nameEnIdx) || "";
    const imageUrl = getCol(imageIdx) || "";
    const carouselUrls = getCol(carouselIdx).split(",").map(s => s.trim()).filter(s => s.startsWith("http"));
    const frontCategoryCn = frontCatCnIdx >= 0 ? normalizeCategoryText(cols[frontCatCnIdx]) : "";
    const backCategoryCn = backCatCnIdx >= 0 ? normalizeCategoryText(cols[backCatCnIdx]) : "";
    const genericCategoryCn = genericCatCnIdx >= 0 ? normalizeCategoryText(cols[genericCatCnIdx]) : "";
    const preferredCategoryCn = backCategoryCn || genericCategoryCn || frontCategoryCn;
    const titleCategorySuffix = backCategoryCn || genericCategoryCn || frontCategoryCn;
    const priceUSD = priceIdx >= 0 ? normalizePriceNumber(cols[priceIdx], 0) : 0;
    const priceCNY = priceUSD > 0 ? priceUSD * 7 : 9.99;
    const sourceProductId = goodsIdIdx >= 0 ? normalizeHistoryIdentifier(getCol(goodsIdIdx)) : "";
    const sourceSpuId = productIdIdx >= 0 ? normalizeHistoryIdentifier(getCol(productIdIdx)) : "";
    const sourceSkcId = productSkcIdIdx >= 0 ? normalizeHistoryIdentifier(getCol(productSkcIdIdx)) : "";
    const directLeafCatId = directLeafCatIdx >= 0 ? (Number(getCol(directLeafCatIdx)) || 0) : 0;
    const directCatIds = parseCategoryIdsCell(catIdsJsonIdx >= 0 ? getCol(catIdsJsonIdx) : "") || {};
    for (const [key, idx] of Object.entries(catIdIndexes)) {
      const nextId = Number(getCol(idx)) || 0;
      if (nextId > 0) directCatIds[key] = nextId;
    }
    for (const [key, idx] of Object.entries(catNameIndexes)) {
      const nextName = getCol(idx);
      if (nextName) directCatIds[key] = nextName;
    }
    if (!directCatIds._path && (backCategoryCn || preferredCategoryCn)) {
      directCatIds._path = backCategoryCn || preferredCategoryCn;
    }

    const itemNum = i - startRow + 1;

    // 暂停检查：等待恢复
    while (pricingPaused) {
      syncCurrentProgressResults(results, {
        running: true,
        paused: true,
        status: "paused",
        total,
        completed: itemNum - 1,
        current: `${itemNum}/${total} ${productName.slice(0, 30)}`,
        step: "已暂停",
        message: "批量上品任务已暂停，等待继续。",
      });
      await new Promise(r => setTimeout(r, 1000));
    }

    // 更新实时进度
    syncCurrentProgressResults(results, {
      running: true,
      paused: false,
      status: "running",
      total,
      completed: itemNum - 1,
      current: `${itemNum}/${total} ${productName.slice(0, 30)}`,
      step: "开始处理",
      message: "批量上品任务运行中",
    });
    console.error(`\n[auto-pricing] ======== ${itemNum}/${total} ========`);
    console.error(`[auto-pricing] Title: ${productName.slice(0, 50)}`);
    console.error(`[auto-pricing] Category: front="${frontCategoryCn}" generic="${genericCategoryCn}" back="${backCategoryCn}"`);
    console.error(`[auto-pricing] Price: $${priceUSD} → ¥${priceCNY.toFixed(2)}`);

    // 用户策略：后台分类为空直接跳过，避免浪费 AI 调用与无意义的类目猜测重试
    if (!backCategoryCn) {
      console.error(`[auto-pricing] SKIP (后台分类为空): ${productName.slice(0, 50)}`);
      results.push({
        index: i,
        name: productName.slice(0, 40),
        success: false,
        skipped: true,
        message: "已跳过：后台分类为空（请在表格【后台分类】列填写完整路径后重试）",
        step: "skipped",
      });
      syncCurrentProgressResults(results, {
        current: `${itemNum}/${total} ${productName.slice(0, 30)}`,
        step: "已跳过(后台分类空)",
      });
      continue;
    }

    try {
      // Step 1: 下载商品原图（带重试）
      updateCurrentProgress({ step: "下载原图" });
      let sourceImagePath = null;
      if (imageUrl?.startsWith("http")) {
        const imgFile = path.join(tmpDir, `source_${i}_${Date.now()}.jpg`);
        for (let dl = 0; dl < 3; dl++) {
          try {
            await downloadImage(imageUrl, imgFile);
            sourceImagePath = imgFile;
            console.error(`[auto-pricing] Source image downloaded`);
            break;
          } catch (e) {
            console.error(`[auto-pricing] Image download attempt ${dl + 1}/3 failed: ${e.message}`);
            if (dl < 2) await randomDelay(2000, 4000);
          }
        }
      }

      if (!sourceImagePath) {
        results.push({
          index: i,
          name: productName.slice(0, 40),
          success: false,
          message: "无法下载商品原图",
          errorCategory: classifyAutoPricingError("source_download", imageUrl),
        });
        syncCurrentProgressResults(results, { current: `${itemNum}/${total} ${productName.slice(0, 30)}`, step: "原图下载失败" });
        continue;
      }

      // Step 1.5: 下载轮播图作为 AI 额外参考
      const carouselLocalPaths = [];
      if (carouselUrls.length > 0) {
        console.error(`[auto-pricing] Downloading ${Math.min(carouselUrls.length, 4)} carousel images for AI reference...`);
        for (let ci = 0; ci < Math.min(carouselUrls.length, 4); ci++) {
          try {
            const cFile = path.join(tmpDir, `carousel_${i}_${ci}_${Date.now()}.jpg`);
            await downloadImage(carouselUrls[ci], cFile);
            carouselLocalPaths.push(cFile);
          } catch (e) { logSilent("ui.action", e); }
        }
        console.error(`[auto-pricing] Downloaded ${carouselLocalPaths.length} carousel images`);
      }

      // Step 2: AI 生成 9 张详情图（原主图只做参考，不参与最终提交）
      updateCurrentProgress({ step: "AI生图中..." });
      console.error(`[auto-pricing] Generating AI images (${1 + carouselLocalPaths.length} source images)...`);
      const aiResult = await generateImagesWithAI(sourceImagePath, productName, carouselLocalPaths);
      if (!aiResult.success) {
        const rawErr = aiResult.error || `图片不足${REQUIRED_AI_DETAIL_IMAGE_COUNT}张`;
        results.push({
          index: i,
          name: productName.slice(0, 40),
          success: false,
          message: "AI生图失败: " + rawErr,
          errorCategory: classifyAutoPricingError("image_gen", rawErr),
        });
        syncCurrentProgressResults(results, { current: `${itemNum}/${total} ${productName.slice(0, 30)}`, step: "AI生图失败" });
        continue;
      }

      // Step 3: 保存 base64 图片到本地文件
      const localImages = {};
      for (const type of AI_DETAIL_IMAGE_TYPE_ORDER) {
        if (aiResult.images[type]) {
          const imgPath = path.join(tmpDir, `${i}_${type}_${Date.now()}.png`);
          saveBase64Image(aiResult.images[type], imgPath);
          localImages[type] = imgPath;
        }
      }
      console.error(`[auto-pricing] Saved ${Object.keys(localImages).length} images locally`);

      // Step 4: 上传到素材中心获取 kwcdn URL
      updateCurrentProgress({ step: "上传图片..." });
      console.error(`[auto-pricing] Uploading to material center...`);
      const { kwcdnUrls, uploadErrors } = await uploadImagesToKwcdnConcurrently(localImages, {
        concurrency: uploadConcurrency,
      });

      // 按指定顺序排列图片 URL
      const orderedImageUrls = AI_DETAIL_IMAGE_TYPE_ORDER
        .map(type => kwcdnUrls[type])
        .filter(Boolean);

      console.error(`[auto-pricing] Total uploaded: ${orderedImageUrls.length}`);

      if (orderedImageUrls.length < REQUIRED_AI_DETAIL_IMAGE_COUNT) {
        const uploadErrorSummary = Object.entries(uploadErrors)
          .slice(0, 3)
          .map(([type, error]) => `${type}: ${formatAutoPricingUserError(error).slice(0, 80)}`)
          .join("；");
        // 取第一条原始上传错误做分类（未包装前的原文更能命中 network/auth 关键词）
        const firstRawUploadErr = Object.values(uploadErrors)[0] || "";
        results.push({
          index: i,
          name: productName.slice(0, 40),
          success: false,
          message: `上传图片不足${REQUIRED_AI_DETAIL_IMAGE_COUNT}张 (${orderedImageUrls.length})${uploadErrorSummary ? `；${uploadErrorSummary}` : ""}`,
          errorCategory: classifyAutoPricingError("image_upload", firstRawUploadErr),
        });
        syncCurrentProgressResults(results, { current: `${itemNum}/${total} ${productName.slice(0, 30)}`, step: "图片上传失败" });
        continue;
      }

      // Step 5: AI 生成中文标题（AI 失败时回退到原标题，但在结果中标记 warning 告知用户）
      updateCurrentProgress({ step: "生成标题..." });
      let finalTitle = "";
      let titleSource = "ai";
      let titleWarning = "";
      if (!aiResult.analysis) {
        titleWarning = "AI 分析结果缺失，已使用原标题";
      } else {
        try {
          console.error(`[auto-pricing] Generating Chinese title...`);
          const titleResp = await fetch(`${AI_IMAGE_GEN_URL}/api/title`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...AI_AUTH_HEADERS },
            body: JSON.stringify({ analysis: aiResult.analysis }),
          });
          if (!titleResp.ok) {
            titleWarning = `AI 标题接口返回 ${titleResp.status}，已使用原标题`;
          } else {
            const titleData = await titleResp.json();
            const rawTitle = String(titleData.titles?.[0]?.title || "").trim();
            if (!rawTitle) {
              titleWarning = "AI 标题接口未返回有效标题，已使用原标题";
            } else {
              finalTitle = rawTitle
                .replace(/\[.*?\]\s*/g, "")
                .replace(/（.*?）/g, "")
                .replace(/\d+(\.\d+)?\s*(ml|g|kg|cm|mm|m|l|oz|inch|ft|pcs|件|个|只|片|包|瓶|支|毫升|厘米|毫米|英寸|磅|盎司|卷|套|组|双|对|块|条|根|张|把|台|袋)/gi, "")
                .replace(/\d+\s*[x×]\s*\d*/gi, "")
                .replace(/\d+p\b/gi, "")
                .replace(/\b\d{2,}\b/g, "")
                .replace(/，\s*，/g, "，")
                .replace(/\|\s*\|/g, "|")
                .replace(/^\s*[|，,]\s*/g, "")
                .replace(/\s*[|，,]\s*$/g, "")
                .replace(/\s+/g, " ")
                .trim();
              if (!finalTitle) {
                titleWarning = "AI 标题清洗后为空，已使用原标题";
              } else {
                console.error(`[auto-pricing] Title: ${finalTitle.slice(0, 60)}`);
              }
            }
          }
        } catch (e) {
          titleWarning = `AI 标题接口调用失败 (${e.message})，已使用原标题`;
          console.error(`[auto-pricing] Title generation failed: ${e.message}`);
        }
      }

      // 兜底：AI 标题拿不到就继续用原 CSV 标题，但记下 warning
      if (!finalTitle) {
        finalTitle = productName;
        titleSource = "original";
      }

      // 标题末尾追加后台分类最后一级
      if (titleCategorySuffix) {
        const lastCat = titleCategorySuffix.split(/[/>]/).map(s => s.trim()).filter(Boolean).pop();
        if (lastCat && !finalTitle.includes(lastCat)) {
          finalTitle = `${finalTitle}，${lastCat}`;
          console.error(`[auto-pricing] Title + category: ${finalTitle.slice(0, 80)}`);
        }
      }

      // 备份 AI 生成图到桌面 "AI自动化生图草稿/<标题>/"
      try {
        const desktopDir = path.join(os.homedir(), "Desktop", "AI自动化生图草稿");
        const safeTitle = String(finalTitle || `untitled_${Date.now()}`)
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80) || `untitled_${Date.now()}`;
        const subDir = path.join(desktopDir, safeTitle);
        fs.mkdirSync(subDir, { recursive: true });
        let copied = 0;
        for (const type of AI_DETAIL_IMAGE_TYPE_ORDER) {
          const src = localImages[type];
          if (src && fs.existsSync(src)) {
            try {
              fs.copyFileSync(src, path.join(subDir, `${type}.png`));
              copied++;
            } catch (e) { console.error(`[auto-pricing] backup copy ${type} failed: ${e.message}`); }
          }
        }
        console.error(`[auto-pricing] backup ${copied} images -> ${subDir}`);
      } catch (e) {
        console.error(`[auto-pricing] desktop backup failed: ${e.message}`);
      }

      // Step 6: 保存草稿
      // 有表格类目时严格按表格类目走，避免被 AI/历史类目带偏
      const aiCategory = aiResult.analysis?.category?.split("(")?.[0]?.trim() || ""; // 取中文部分，如 "家庭清洁用品"
      // 任一表格类目存在即进入 strict 模式，避免 AI 分析返回的猜测类目（如"钥匙扣/挂件"）
      // 覆盖掉表格里有效的前台分类。这样后台为空但前台有效时也能锁定。
      const categoryLockMode = (
        directLeafCatId
        || Object.keys(directCatIds).some((key) => key !== "_path")
        || backCategoryCn
        || genericCategoryCn
        || frontCategoryCn
      )
        ? "strict"
        : "guided";
      const categorySearchVariants = categoryLockMode === "strict"
        ? [backCategoryCn, genericCategoryCn, frontCategoryCn].map((value) => normalizeCategoryText(value)).filter(Boolean)
        : buildGuidedCategorySearchVariants(
            productName,
            aiCategory,
            backCategoryCn,
          );
      const categorySearch = categoryLockMode === "guided"
        ? (aiCategory || productName)
        : (preferredCategoryCn || aiCategory || productName);
      const historicalDraftIds = collectHistoricalDraftIds({
        csvPath,
        index: i,
        title: productName,
        name: productName,
      });
      console.error(
        `[auto-pricing] Category search: back="${backCategoryCn}" generic="${genericCategoryCn}" front="${frontCategoryCn}" AI="${aiCategory}" draftHits=${historicalDraftIds.length} → using "${categorySearch}"`
      );

      updateCurrentProgress({ step: "保存草稿..." });
      console.error(`[auto-pricing] Saving draft with ${orderedImageUrls.length} images...`);
      let createResult;
      for (let submitAttempt = 0; submitAttempt < 3; submitAttempt++) {
        try {
          createResult = await createProductViaAPI({
            title: finalTitle,
            imageUrls: orderedImageUrls,
            price: priceCNY,
            categorySearch,
            categorySearchVariants,
            draftIdCandidates: historicalDraftIds,
            sourceProductId,
            goodsId: sourceProductId || undefined,
            productId: sourceSpuId || undefined,
            productSkcId: sourceSkcId || undefined,
            leafCatId: directLeafCatId || undefined,
            catIds: Object.keys(directCatIds).length > 0 ? directCatIds : undefined,
            categoryLockMode,
            keepOpen: false,
            config: params.config,
          });
          // 如果不是连接错误就不重试
          if (createResult.success || !createResult.message?.includes("CONNECTION_RESET")) break;
          console.error(`[auto-pricing] CONNECTION_RESET, retry ${submitAttempt + 1}/3...`);
          await randomDelay(5000, 8000);
        } catch (e) {
          if (submitAttempt < 2 && e.message?.includes("CONNECTION_RESET")) {
            console.error(`[auto-pricing] CONNECTION_RESET exception, retry ${submitAttempt + 1}/3...`);
            await randomDelay(5000, 8000);
            createResult = { success: false, message: e.message };
          } else {
            createResult = { success: false, message: e.message };
            break;
          }
        }
      }

      // 在结果中提示用户：本条是否用了原标题兜底
      const resultEntry = {
        index: i,
        name: productName.slice(0, 40),
        ...createResult,
        titleSource,
        titleWarning: titleWarning || undefined,
      };
      if (createResult.success && titleSource === "original") {
        resultEntry.message = `${createResult.message || "商品已保存到Temu草稿箱"}（⚠️ ${titleWarning}）`;
      }
      if (!createResult.success) {
        const draftStage = /分类搜索失败/.test(createResult.message || "") ? "category" : "draft";
        resultEntry.errorCategory = classifyAutoPricingError(draftStage, createResult.message);
      }
      results.push(resultEntry);
      syncCurrentProgressResults(results, {
        current: `${itemNum}/${total} ${productName.slice(0, 30)}`,
        step: createResult.success
          ? (titleSource === "original" ? "草稿保存成功（原标题兜底）" : "草稿保存成功")
          : "草稿保存失败",
        message: createResult.success
          ? (titleSource === "original"
              ? `当前商品已保存到Temu草稿箱（⚠️ ${titleWarning}）`
              : "当前商品已保存到Temu草稿箱")
          : (createResult.message || "当前商品保存草稿失败"),
      });
      console.error(`[auto-pricing] ${createResult.success ? "SUCCESS draftId=" + (createResult.draftId || createResult.productId || "unknown") : "FAIL: " + createResult.message}`);

      // 清理临时文件
      for (const f of Object.values(localImages)) {
        try { fs.unlinkSync(f); } catch (e) { logSilent("ui.action", e); }
      }
      try { fs.unlinkSync(sourceImagePath); } catch (e) { logSilent("ui.action", e); }

    } catch (e) {
      const friendlyMessage = formatAutoPricingUserError(e?.message);
      results.push({
        index: i,
        name: productName.slice(0, 40),
        success: false,
        message: friendlyMessage,
        errorCategory: classifyAutoPricingError("unknown", e?.message),
      });
      syncCurrentProgressResults(results, {
        current: `${itemNum}/${total} ${productName.slice(0, 30)}`,
        step: "执行失败",
        message: friendlyMessage || "当前商品执行失败",
      });
      console.error(`[auto-pricing] ERROR: ${e.message}`);
    }

    // 间隔控制
    if (itemNum < total) {
      const waitMin = intervalMin + Math.random() * (intervalMax - intervalMin);
      console.error(`[auto-pricing] Progress: ${itemNum}/${total} (${results.filter(r => r.success).length} ok). Next in ${waitMin.toFixed(1)}min...`);
      await new Promise(r => setTimeout(r, waitMin * 60000));
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failedItems = results.filter(r => !r.success);
  console.error(`\n[auto-pricing] DONE: ${successCount}/${results.length} succeeded`);

  // 保存结果
  const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  fs.mkdirSync(debugDir, { recursive: true });
  const resultFile = path.join(debugDir, `auto_pricing_result_${Date.now()}.json`);
  fs.writeFileSync(resultFile, JSON.stringify({ total: results.length, successCount, failCount: failedItems.length, results }, null, 2));

  // 重置进度
  const finishedAt = getProgressTimestamp();
  syncCurrentProgressResults(results, {
    running: false,
    paused: false,
    status: "completed",
    total: results.length,
    completed: results.length,
    current: "完成",
    step: "完成",
    message: `批量上品完成：${successCount} 成功，${failedItems.length} 失败`,
    updatedAt: finishedAt,
    finishedAt,
  });
  return { success: true, taskId, total: results.length, successCount, failCount: failedItems.length, results, resultFile };
  } catch (error) {
    const failedAt = getProgressTimestamp();
    syncCurrentProgressResults(results, {
      running: false,
      paused: false,
      status: "failed",
      total,
      completed: results.length,
      current: "失败",
      step: currentProgress.step || "执行失败",
      message: error?.message || "批量上品任务执行失败",
      updatedAt: failedAt,
      finishedAt: failedAt,
    });
    throw error;
  } finally {
    _navLiteMode = previousNavLiteMode;
    if (stopAuthPopupMonitor) {
      try {
        stopAuthPopupMonitor();
      } catch (cleanupError) {
        console.error(`[auto-pricing] Popup monitor cleanup failed: ${cleanupError.message}`);
      }
    }
  }
}

// ============================================================
// 核价配置 — 可通过 params.config 覆盖
// ============================================================
const PRICING_CONFIG = {
  retailPriceMultiplier: 3,        // 建议零售价 = 申报价 × N（默认3:1）
  defaultWeight: 50000,            // 默认重量 (mg)，50g
  defaultDimensions: { len: 80, width: 70, height: 60 },  // 默认尺寸 (mm)
  defaultRegion: { countryShortName: "CN", region2Id: 43000000000031 }, // 浙江
  currency: "CNY",
  createEndpoint: "/visage-agent-seller/product/add",
  draftEndpoint: "/visage-agent-seller/product/draft/add",
  draftSaveEndpoint: "/visage-agent-seller/product/draft/save",
  draftListEndpoint: "/visage-agent-seller/product/draft/pageQuery",
  categoryTemplateEndpoint: "/anniston-agent-seller/category/template/query",
  specQueryEndpoint: "/anniston-agent-seller/sku/spec/byName/queryOrAdd",
  specParentEndpoint: "/anniston-agent-seller/sku/spec/parent/list",
  // 通用默认属性（当分类模板无法获取时使用）
  defaultProperties: [
    { valueUnit: "", propValue: "其它塑料制", propName: "主体材质", refPid: 1920, vid: 63161, numberInputValue: "", controlType: 1, pid: 1, templatePid: 962980, valueExtendInfo: "" },
    { valueUnit: "", propValue: "详见商品详情", propName: "适用车型", refPid: 1941, vid: 118290, numberInputValue: "", controlType: 1, pid: 1459, templatePid: 1249501, valueExtendInfo: "" },
  ],
  // 默认规格（风格 A）
  defaultSpec: { parentSpecId: 18012, parentSpecName: "风格", specId: 20640, specName: "A" },
};

function getCategoryPathText(catIds = {}) {
  return String(
    catIds?._path
    || Object.keys(catIds || {})
      .filter((key) => key.endsWith("Name") && catIds[key])
      .map((key) => catIds[key])
      .join(" > ")
  ).trim();
}

function buildCategorySearchVariants(...values) {
  const variants = [];
  const seen = new Set();
  const pushVariant = (value) => {
    const candidate = String(value || "")
      .replace(/[＞>｜|]+/g, "/")
      .replace(/\s*\/\s*/g, "/")
      .trim()
      .replace(/^\/|\/$/g, "");
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    variants.push(candidate);
  };
  for (const value of values) {
    const raw = String(value || "")
      .replace(/[＞>｜|]+/g, "/")
      .replace(/\s*\/\s*/g, "/")
      .trim();
    if (!raw) continue;
    const normalizedPath = normalizeCategoryLookupText(raw);
    const normalizedParts = normalizedPath.split("/").filter(Boolean);
    const rawParts = raw.split("/").map((part) => part.trim()).filter(Boolean);

    if (normalizedParts.length > 0) {
      pushVariant(normalizedPath);
      for (let start = 1; start < normalizedParts.length; start += 1) {
        pushVariant(normalizedParts.slice(start).join("/"));
      }
      for (let index = normalizedParts.length - 1; index >= 0; index -= 1) {
        pushVariant(normalizedParts[index]);
      }
    }

    pushVariant(raw);
    for (let start = 1; start < rawParts.length; start += 1) {
      pushVariant(rawParts.slice(start).join("/"));
    }
    for (let index = rawParts.length - 1; index >= 0; index -= 1) {
      pushVariant(rawParts[index]);
    }
  }
  return variants;
}

function buildTitleCategoryFallbackTerms(title = "") {
  const variants = [];
  const seen = new Set();
  const pushVariant = (value) => {
    const candidate = String(value || "")
      .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!candidate || candidate.length < 2 || seen.has(candidate)) return;
    seen.add(candidate);
    variants.push(candidate);
  };

  const normalizedTitle = String(title || "")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/[【】\[\]{}]/g, " ")
    .replace(/[()（）]/g, " ")
    .replace(/[|｜,，;；、/]+/g, "\n")
    .replace(/\s*[-—]+\s*/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedTitle) return variants;

  const chunks = normalizedTitle
    .split(/\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  for (const rawChunk of chunks) {
    const chunk = rawChunk
      .replace(/^[0-9０-９]+(?:\s*[xX×*]\s*[0-9０-９]+)?\s*(个装|套装|件装|只装|袋装|盒装|件套|pcs?|pc|个|套|件|只|条|袋|盒|包)\b/iu, "")
      .replace(/^[一二三四五六七八九十百两]+\s*(个装|套装|件装|只装|袋装|盒装|件套|个|套|件|只|条|袋|盒|包)\b/u, "")
      .replace(/^(新品|爆款|热卖|新款|现货)\s*/u, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!chunk) continue;

    pushVariant(chunk);

    const primaryChunk = chunk
      .split(/适用于|用于|专为|可用于|兼容|搭配|适合/u)[0]
      .trim();
    if (primaryChunk && primaryChunk !== chunk) pushVariant(primaryChunk);

    const compactChunk = chunk.replace(/\s+/g, "");
    if (compactChunk.length > 18) pushVariant(compactChunk.slice(0, 18));
    else pushVariant(compactChunk);

    const productNounMatches = compactChunk.match(/[\u4e00-\u9fa5]{2,10}(?:收纳架|置物架|挂钩|支架|清洁刷|洗衣片|吸色片|护色片|清洁片|抹布|毛巾|纸巾|湿巾|垃圾袋|保鲜袋|保鲜膜|抽纸|牙刷|杯子|瓶子|盒子|挂架|篮子|拖把|扫把|刷子|夹子|袋子|盒|袋|片|布|巾|刷|架|钩|绳|网|盘|垫|贴|膜|罩|器|夹|杆|杯|瓶|桶|箱|套|链|锁)/gu) || [];
    for (const match of productNounMatches) {
      pushVariant(match);
    }

    if (compactChunk.length >= 4) {
      for (const suffixLength of [8, 6, 5, 4, 3, 2]) {
        if (compactChunk.length > suffixLength) pushVariant(compactChunk.slice(-suffixLength));
      }
    }
  }

  pushVariant(normalizedTitle.split(/\n+/)[0]);
  pushVariant(normalizedTitle.replace(/\n+/g, " ").slice(0, 24));

  return variants.slice(0, 8);
}

function buildGuidedCategorySearchVariants(title = "", aiCategory = "", ...categoryHints) {
  const variants = [];
  const seen = new Set();
  const pushVariant = (value) => {
    const candidate = String(value || "")
      .replace(/[＞>｜|]+/g, "/")
      .replace(/\s*\/\s*/g, "/")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\/|\/$/g, "");
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    variants.push(candidate);
  };

  for (const value of buildCategorySearchVariants(
    ...buildTitleCategoryFallbackTerms(title),
    aiCategory,
    title,
  )) {
    pushVariant(value);
  }

  for (const rawHint of categoryHints) {
    const hint = String(rawHint || "")
      .replace(/[＞>｜|]+/g, "/")
      .replace(/\s*\/\s*/g, "/")
      .trim();
    if (!hint) continue;
    if (hint.includes("/")) continue;

    const normalizedHint = normalizeCategoryLookupText(hint);
    const rawParts = hint.split("/").map((part) => part.trim()).filter(Boolean);
    const normalizedParts = normalizedHint.split("/").filter(Boolean);

    const leafRaw = rawParts[rawParts.length - 1] || "";
    const leafNormalized = normalizedParts[normalizedParts.length - 1] || "";
    pushVariant(leafRaw);
    pushVariant(leafNormalized);

    for (const segment of extractCategoryRefinementSegments(leafRaw || leafNormalized)) {
      pushVariant(segment);
    }
  }

  return variants;
}

function getCategoryDepth(catIds = {}) {
  let depth = 0;
  for (let i = 1; i <= 10; i++) {
    if ((Number(catIds?.[`cat${i}Id`]) || 0) > 0) depth = i;
  }
  return depth;
}

async function findDraftCategoryMatch(page, draftIdCandidates = [], title = "") {
  const normalizedDraftIds = Array.from(new Set(
    (Array.isArray(draftIdCandidates) ? draftIdCandidates : [])
      .map((value) => Number(value) || 0)
      .filter((value) => value > 0)
  ));
  if (normalizedDraftIds.length === 0) return null;

  const requestVariants = [
    { page: 1, pageSize: 100 },
  ];

  for (const basePayload of requestVariants) {
    for (let pageNumber = 1; pageNumber <= 3; pageNumber += 1) {
      const payload = { ...basePayload };
      if ("page" in payload) payload.page = pageNumber;
      const result = await temuXHR(page, PRICING_CONFIG.draftListEndpoint, payload, { maxRetries: 1 });
      if (!result.success) break;

      const pageItems = Array.isArray(result.data?.pageItems)
        ? result.data.pageItems
        : (Array.isArray(result.data?.result?.pageItems)
          ? result.data.result.pageItems
          : (Array.isArray(result.data?.list)
            ? result.data.list
            : (Array.isArray(result.data?.result?.list) ? result.data.result.list : [])));
      if (pageItems.length === 0) break;

      let matchedDraft = null;
      for (const draftId of normalizedDraftIds) {
        matchedDraft = pageItems.find((item) => (Number(item?.productDraftId) || 0) === draftId);
        if (matchedDraft) break;
      }
      if (matchedDraft?.categories) {
        const extracted = extractCategoryIdsFromDraftCategories(matchedDraft.categories);
        if (extracted?.leafCatId) {
          console.error(`[api-create] Restored category from draft ${matchedDraft.productDraftId}: ${extracted.path || extracted.leafCatId}`);
          rememberResolvedCategory({
            title: title || matchedDraft.productName,
            categorySearch: matchedDraft.productName || title,
            catIds: extracted.catIds,
            leafCatId: extracted.leafCatId,
            path: extracted.path,
            source: "draft_page_query",
          });
          return extracted;
        }
      }

      if (pageItems.length < 100) break;
    }
  }

  return null;
}

function selectPropertyValueByPatterns(propValues = [], patterns = []) {
  if (!Array.isArray(propValues) || propValues.length === 0 || !Array.isArray(patterns)) return null;
  for (const pattern of patterns) {
    const matched = propValues.find((value) => pattern.test(value.value || value.propValue || ""));
    if (matched) return matched;
  }
  return null;
}

function getPropertyValueText(value) {
  return String(value?.value || value?.propValue || "").trim();
}

function hasPropertyEvidence(text = "", patterns = []) {
  const value = String(text || "");
  return patterns.some((pattern) => pattern.test(value));
}

function isWorkflowAutoCareLikeProduct(evidenceText = "") {
  return /(汽车|车载|车辆|卡车|SUV|摩托车|车内|车身|塑料修复|塑料翻新|修复剂|护理剂|清洁剂|保养|翻新|polish|restore|restorer|plastic|car|auto|vehicle)/i.test(String(evidenceText || ""));
}

function isStrongLinkedPropertyValueWithoutEvidence(propName = "", propValue = "", evidenceText = "") {
  const name = String(propName || "");
  const value = String(propValue || "");
  const evidence = String(evidenceText || "");

  if (/(木材类型|木种)/.test(name)) {
    return !hasPropertyEvidence(evidence, [/木(制|质|头|材)?/, /竹/, /藤/, /\bwood(en)?\b/i, /\bbamboo\b/i, /\brattan\b/i]);
  }
  if (/真皮种类|皮革类型/.test(name)) {
    return !hasPropertyEvidence(evidence, [/皮革/, /真皮/, /牛皮/, /羊皮/, /猪皮/, /\bleather\b/i]);
  }
  if (/(木|竹|藤|再生木|十齿花|榉木|橡木|松木|桦木|胡桃木)/.test(value)) {
    return !hasPropertyEvidence(evidence, [/木(制|质|头|材)?/, /竹/, /藤/, /\bwood(en)?\b/i, /\bbamboo\b/i, /\brattan\b/i]);
  }
  if (/(真皮|牛皮|羊皮|猪皮|皮革)/.test(value)) {
    return !hasPropertyEvidence(evidence, [/皮革/, /真皮/, /牛皮/, /羊皮/, /猪皮/, /\bleather\b/i]);
  }
  if (/(电池|锂电|充电|电子|插电|USB|电源)/i.test(value)) {
    return !hasPropertyEvidence(evidence, [/电池|锂电|充电|电子|插电|USB|电源|battery|recharge|electric/i]);
  }
  if (/(金属|铁|钢|铝|铜)/.test(value)) {
    return !hasPropertyEvidence(evidence, [/金属|铁|钢|铝|铜|metal|steel|aluminum|aluminium|copper/i]);
  }

  return false;
}

function findSafePropertyValue(propName = "", propValues = [], productTitle = "", categoryPath = "") {
  if (!Array.isArray(propValues) || propValues.length === 0) return null;
  const evidenceText = `${String(productTitle || "")} ${String(categoryPath || "")}`;
  const values = propValues.filter((value) => {
    const text = getPropertyValueText(value);
    return text && !isStrongLinkedPropertyValueWithoutEvidence(propName, text, evidenceText);
  });

  const autoCare = isWorkflowAutoCareLikeProduct(evidenceText);
  const propText = String(propName || "");
  const priorityGroups = [];
  if (autoCare && /(材质|材料|Material)/i.test(propText)) {
    priorityGroups.push([/其[他它]/, /不适用|N\/A/i, /详见/, /塑料|树脂|橡胶|硅胶/]);
  }
  priorityGroups.push([
    /^其[他它]$/,
    /其[他它]/,
    /不适用|N\/A/i,
    /详见/,
    /^无$|^无\s/,
    /通用/,
    /不含|不需要|不涉及/,
  ]);
  if (autoCare && /(物品形式|形式|形态)/.test(propText)) {
    priorityGroups.unshift([/膏体|凝胶|液体|乳液|喷雾|固体|其他|其它/]);
  }

  for (const patterns of priorityGroups) {
    const matched = selectPropertyValueByPatterns(values, patterns);
    if (matched) return matched;
  }
  return values[0] || null;
}

function scoreCategoryTemplateCandidate(title = "", candidatePath = "", candidateName = "", templateProps = []) {
  const titleText = String(title || "");
  const pathText = `${candidatePath} ${candidateName}`.trim();
  const propNames = templateProps.map((prop) => prop.name || prop.propertyName || prop.propName || "").join(" | ");
  const propValueText = templateProps
    .flatMap((prop) => (prop.values || prop.propertyValueList || prop.valueList || []).slice(0, 6).map((value) => value.value || value.propValue || ""))
    .join(" | ");

  let score = 0;
  if (/供电方式|工作电压|电池|插头|RAM|ROM/i.test(`${propNames} ${propValueText}`)) score -= 120;
  if (/其[他它]/.test(candidateName)) score -= 8;

  if (/(洗衣|吸色|护色|染色|去污|清洁|污渍)/.test(titleText)) {
    if (/清洁剂/.test(pathText)) score += 28;
    if (/湿巾|纸巾/.test(pathText)) score += 20;
    if (/清洁布|百洁布|海绵/.test(pathText)) score += 14;
    if (/物品形式/.test(propNames) && /片剂|湿巾/.test(propValueText)) score += 18;
    if (/表面推荐/.test(propNames) && /织物/.test(propValueText)) score += 12;
    if (/用途|功效|数量|容量/.test(propNames)) score += 8;
  }

  if (/(布|纸|片|无纺布)/.test(titleText)) {
    if (/织造方式/.test(propNames) && /无纺布/.test(propValueText)) score += 16;
    if (/材料/.test(propNames) && /无纺布|超细纤维|涤纶/.test(propValueText)) score += 12;
    if (/纸巾|清洁布|湿巾/.test(pathText)) score += 12;
  }

  if (/(消毒|抗菌)/.test(titleText) && /抗菌用品|消毒湿巾/.test(pathText)) {
    score += 18;
  }

  return score;
}

function pickHeuristicPropertyValue(propName = "", propValues = [], productTitle = "", categoryPath = "") {
  const titleText = `${String(productTitle || "")} ${String(categoryPath || "")}`;
  const normalizedPropName = String(propName || "");
  if (!Array.isArray(propValues) || propValues.length === 0) return null;

  if (/(洗衣|吸色|护色|染色|去污|清洁)/.test(titleText)) {
    if (/物品形式/.test(normalizedPropName)) {
      return selectPropertyValueByPatterns(propValues, [/片剂/, /湿巾/, /片/, /纸/]);
    }
    if (/表面推荐/.test(normalizedPropName)) {
      return selectPropertyValueByPatterns(propValues, [/织物/, /布/, /混纺/]);
    }
    if (/用途|功效/.test(normalizedPropName)) {
      return selectPropertyValueByPatterns(propValues, [/其他/, /详见/]);
    }
    if (/数量/.test(normalizedPropName)) {
      return selectPropertyValueByPatterns(propValues, [/>1/, /详见sku/, /^1$/]);
    }
    if (/容量/.test(normalizedPropName)) {
      return selectPropertyValueByPatterns(propValues, [/^无$/, /<1L/, /1-10L/]);
    }
    if (/是否含有表面活性物质/.test(normalizedPropName)) {
      return selectPropertyValueByPatterns(propValues, [/^否$/, /^是$/]);
    }
    if (/特殊功能/.test(normalizedPropName)) {
      return selectPropertyValueByPatterns(propValues, [/无染料/, /回收/, /无树/]);
    }
    if (/容器类型/.test(normalizedPropName)) {
      return selectPropertyValueByPatterns(propValues, [/袋/, /盒/, /罐/]);
    }
  }

  if (/(布|纸|片|无纺布)/.test(titleText)) {
    if (/材料/.test(normalizedPropName)) {
      return selectPropertyValueByPatterns(propValues, [/无纺布/, /超细纤维/, /涤纶/, /纸/]);
    }
    if (/织造方式/.test(normalizedPropName)) {
      return selectPropertyValueByPatterns(propValues, [/无纺布/, /针织/, /梭织/]);
    }
  }

  return null;
}

async function fetchCategoryTemplateProps(page, leafCatId) {
  const result = await temuXHR(page, PRICING_CONFIG.categoryTemplateEndpoint, { catId: leafCatId }, { maxRetries: 2 });
  if (!result.success || !result.data) return [];
  return result.data.properties
    || result.data.productPropertyTemplateList
    || result.data.propertyList
    || result.data.templatePropertyList
    || [];
}

async function findBetterLeafCategoryByTemplate(page, catIds, leafCatId, productTitle = "") {
  const currentPath = getCategoryPathText(catIds);
  const currentTemplateProps = await fetchCategoryTemplateProps(page, leafCatId);
  const currentScore = scoreCategoryTemplateCandidate(productTitle, currentPath, String(catIds?.[`cat${getCategoryDepth(catIds)}Name`] || ""), currentTemplateProps);
  if (currentScore > -30) {
    return null;
  }

  console.error(`[category-fallback] Current category template looks mismatched (score=${currentScore}). Scanning siblings...`);

  const depth = getCategoryDepth(catIds);
  const parentLevels = [];
  for (let level = depth - 1; level >= 2 && parentLevels.length < 3; level--) {
    const parentId = Number(catIds?.[`cat${level}Id`]) || 0;
    if (parentId > 0) parentLevels.push({ level, parentId });
  }

  let bestCandidate = null;
  for (const { level, parentId } of parentLevels) {
    const siblingsResult = await temuXHR(page, "/anniston-agent-seller/category/children/list", { parentCatId: parentId }, { maxRetries: 1 });
    const siblings = siblingsResult.data?.categoryNodeVOS || [];
    const parentPath = Object.keys(catIds)
      .filter((key) => key.endsWith("Name") && catIds[key] && Number(key.match(/^cat(\d+)Name$/)?.[1] || 0) <= level)
      .map((key) => catIds[key])
      .join(" > ");

    for (const sibling of siblings) {
      const siblingChildrenResult = await temuXHR(page, "/anniston-agent-seller/category/children/list", { parentCatId: sibling.catId }, { maxRetries: 1 });
      const siblingChildren = siblingChildrenResult.data?.categoryNodeVOS || [];
      const leafCandidates = siblingChildren.length > 0 ? siblingChildren : [sibling];

      for (const leaf of leafCandidates) {
        if ((Number(leaf.catId) || 0) === (Number(leafCatId) || 0)) continue;
        const leafPath = [parentPath, sibling.catName, siblingChildren.length > 0 ? leaf.catName : ""].filter(Boolean).join(" > ");
        const candidateCatIds = {};
        for (let i = 1; i <= level; i++) {
          candidateCatIds[`cat${i}Id`] = Number(catIds?.[`cat${i}Id`]) || 0;
          if (catIds?.[`cat${i}Name`]) candidateCatIds[`cat${i}Name`] = catIds[`cat${i}Name`];
        }
        candidateCatIds[`cat${level + 1}Id`] = Number(sibling.catId) || 0;
        candidateCatIds[`cat${level + 1}Name`] = sibling.catName || "";
        if (siblingChildren.length > 0) {
          candidateCatIds[`cat${level + 2}Id`] = Number(leaf.catId) || 0;
          candidateCatIds[`cat${level + 2}Name`] = leaf.catName || "";
        }
        for (let i = 1; i <= 10; i++) {
          if (!candidateCatIds[`cat${i}Id`]) candidateCatIds[`cat${i}Id`] = 0;
        }
        candidateCatIds._path = leafPath;
        const templateProps = await fetchCategoryTemplateProps(page, leaf.catId);
        if (!templateProps.length) continue;
        const score = scoreCategoryTemplateCandidate(productTitle, leafPath, leaf.catName || sibling.catName || "", templateProps);
        if (!bestCandidate || score > bestCandidate.score) {
          bestCandidate = {
            catId: leaf.catId,
            catName: leaf.catName || sibling.catName || "",
            path: leafPath,
            score,
            catIds: candidateCatIds,
            templateProps,
          };
        }
      }
    }
  }

  if (!bestCandidate || bestCandidate.score <= currentScore + 20 || bestCandidate.score <= 0) {
    return null;
  }

  console.error(`[category-fallback] Selected better category: ${bestCandidate.path} (leaf=${bestCandidate.catId}, score=${bestCandidate.score})`);
  return bestCandidate;
}

/**
 * 查询分类的属性模板，用 AI 智能分析填充属性值
 */
async function getCategoryProperties(page, leafCatId, productTitle, categoryPath = "") {
  const props = await fetchCategoryTemplateProps(page, leafCatId);

  if (props.length === 0) {
    const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const debugFile = path.join(debugDir, `template_response_${leafCatId}_${Date.now()}.json`);
    fs.writeFileSync(debugFile, JSON.stringify({ leafCatId, props }, null, 2));
    console.error(`[getCategoryProperties] No properties found. Debug: ${debugFile}`);
    return null;
  }

  console.error(`[getCategoryProperties] Template has ${props.length} properties for catId=${leafCatId}`);

  // 构建属性列表供 AI 分析
  const propsForAI = [];
  const propsMap = new Map(); // propName → { prop, values }

  for (const p of props) {
    const propName = p.name || p.propertyName || p.propName || "";
    const propValues = p.values || p.propertyValueList || p.valueList || [];
    const isRequired = p.required === true || p.required === 1 || p.isRequired === true || p.isRequired === 1;
    if (!propValues || propValues.length === 0) continue;
    // 只分析必填属性
    if (!isRequired) continue;

    const valueTexts = propValues.map(v => v.value || v.propValue || "").filter(Boolean);
    propsForAI.push({ name: propName, required: isRequired, values: valueTexts.slice(0, 30) });
    propsMap.set(propName, { prop: p, values: propValues });
  }

  if (propsForAI.length === 0) return null;

  // 调用 AI 分析属性
  let aiDecisions = null;
  try {
    const prompt = `你是一个电商商品属性填写专家。

商品标题: "${productTitle}"
类目路径: "${categoryPath || ""}"

以下是该分类的属性列表，每个属性有可选值。请判断哪些属性与该商品相关，并选择最合适的值。

属性列表:
${propsForAI.map((p, i) => `${i + 1}. ${p.name}${p.required ? '(必填)' : '(选填)'}: [${p.values.join(', ')}]`).join('\n')}

规则:
1. 优先填必填属性，但如果候选值都明显会误导商品属性，可以返回 "skip"，系统会用更保守的规则处理
2. 选填属性如果与商品无关可以 "skip"
3. 优先选择"其他"、"其它"、"不适用"等安全值，除非商品明确属于某个具体选项
4. 不确定时不要硬选第一个候选值，宁可选"其他/不适用/详见商品详情/skip"
5. 不要为了安全选择会触发强关联子属性的材质/属性，例如木材、真皮、金属、电子、电池；只有标题或类目明确表达时才选择
6. 汽车护理、清洁、修复剂类商品：材质/成分/容量不明确时优先选"不适用"、"其他"、"详见sku"，不要误选木材

请用 JSON 数组格式回复，每项格式: {"name": "属性名", "value": "选择的值"} 或 {"name": "属性名", "value": "skip"}
只返回 JSON 数组，不要其他文字。`;

    const modelChain = getAttributeFillModelChain();
    console.error(`[getCategoryProperties] Calling AI to analyze ${propsForAI.length} required properties. models=${modelChain.join(" -> ")}`);

    if (!ATTRIBUTE_AI_API_KEY && !AI_API_KEY) {
      console.error(`[getCategoryProperties] AI API key not configured, using safe defaults`);
      throw new Error("skip_ai");
    }

    for (const model of modelChain) {
      const attrClient = getAttributeClientForModel(model);
      if (!attrClient) continue;
      try {
        const aiData = await attrClient.chat.completions.create({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 1200,
        });
        const content = aiData?.choices?.[0]?.message?.content || "";
        console.error(`[getCategoryProperties] AI raw response from ${model}: ${content.slice(0, 300)}`);
        const parsed = extractJsonArrayFromText(content);
        if (parsed) {
          aiDecisions = parsed;
          console.error(`[getCategoryProperties] AI model=${model} returned ${aiDecisions.length} decisions`);
          break;
        }
        console.error(`[getCategoryProperties] AI model=${model} returned invalid JSON array`);
      } catch (innerErr) {
        console.error(`[getCategoryProperties] AI model=${model} error: ${innerErr?.message || String(innerErr)}`);
      }
    }
  } catch (e) {
    console.error(`[getCategoryProperties] AI analysis failed: ${e.message}, falling back to safe defaults`);
  }

  // 安全值优先级（AI 失败时的 fallback）
  const safeValuePriority = [
    /^其[他它]$/,
    /其[他它]/,
    /不适用|N\/A/,
    /^无$|^无\s/,
    /通用/,
    /详见/,
    /不含|不需要|不涉及/,
    /混合|混纺|复合/,
  ];

  const output = [];

  for (const p of props) {
    const propName = p.name || p.propertyName || p.propName || "";
    const propValues = p.values || p.propertyValueList || p.valueList || [];
    const isRequired = p.required === true || p.required === 1 || p.isRequired === true || p.isRequired === 1;
    const propPid = p.pid || p.propertyId || 0;
    const propRefPid = p.refPid || p.refPropertyId || 0;
    const propTemplatePid = p.templatePid || p.templatePropertyId || 0;

    if (!propValues || propValues.length === 0) continue;

    let selectedVal = null;

    if (aiDecisions) {
      // AI 模式：按 AI 建议选值
      const decision = aiDecisions.find(d => d.name === propName);
      if (decision) {
        if (decision.value === "skip") {
          const safeFallback = isRequired ? findSafePropertyValue(propName, propValues, productTitle, categoryPath) : null;
          if (safeFallback) {
            selectedVal = safeFallback;
            console.error(`[getCategoryProperties] AI skip required "${propName}", using safe fallback "${getPropertyValueText(safeFallback)}"`);
          } else {
            console.error(`[getCategoryProperties] AI skip: "${propName}"`);
            continue;
          }
        }
        // 在可选值中找 AI 推荐的值
        if (!selectedVal) {
          selectedVal = propValues.find(v => (v.value || v.propValue || "") === decision.value);
          if (!selectedVal) {
            // 模糊匹配
            selectedVal = propValues.find(v => (v.value || v.propValue || "").includes(decision.value) || decision.value.includes(v.value || v.propValue || ""));
          }
          if (selectedVal) {
            console.error(`[getCategoryProperties] AI select: "${propName}" = "${decision.value}"`);
          }
        }
      } else {
        // AI 没提到的属性：必填用安全值，选填跳过
        if (!isRequired) continue;
      }
    }

    // Fallback：没有 AI 决策或 AI 没匹配到值时
    if (!selectedVal) {
      if (!isRequired) continue; // 非必填跳过
      selectedVal = pickHeuristicPropertyValue(propName, propValues, productTitle, categoryPath);
      // 必填：用安全值
      if (!selectedVal) {
        selectedVal = findSafePropertyValue(propName, propValues, productTitle, categoryPath);
      }
      if (!selectedVal) {
        for (const pattern of safeValuePriority) {
          selectedVal = propValues.find(v => pattern.test(v.value || v.propValue || ""));
          if (selectedVal) break;
        }
      }
      if (!selectedVal) {
        selectedVal = propValues[0];
        console.error(`[getCategoryProperties] Fallback first value: "${propName}" = "${selectedVal?.value || selectedVal?.propValue}"`);
      }
    }

    const selectedText = getPropertyValueText(selectedVal);
    const evidenceText = `${String(productTitle || "")} ${String(categoryPath || "")}`;
    if (isStrongLinkedPropertyValueWithoutEvidence(propName, selectedText, evidenceText)) {
      const safeFallback = findSafePropertyValue(propName, propValues, productTitle, categoryPath);
      if (safeFallback && getPropertyValueText(safeFallback) !== selectedText) {
        console.error(`[getCategoryProperties] Replace risky "${propName}"="${selectedText}" with "${getPropertyValueText(safeFallback)}"`);
        selectedVal = safeFallback;
      } else {
        console.error(`[getCategoryProperties] Skip risky "${propName}"="${selectedText}" (no evidence in title/category)`);
        continue;
      }
    }

    const valText = selectedVal.value || selectedVal.propValue || "";
    let valVid = selectedVal.vid || selectedVal.valueId || 0;
    if (valVid <= 0) {
      // vid 为0：尝试从其他可选值中找一个有 vid 的
      if (isRequired) {
        const altVal = propValues.find(v => (v.vid || v.valueId || 0) > 0);
        if (altVal) {
          valVid = altVal.vid || altVal.valueId;
          console.error(`[getCategoryProperties] vid=0 for "${propName}", using alt: "${altVal.value || altVal.propValue}" vid=${valVid}`);
        } else {
          console.error(`[getCategoryProperties] WARNING: "${propName}" has no valid vid, skipping`);
          continue;
        }
      } else {
        continue;
      }
    }

    output.push({
      valueUnit: (Array.isArray(p.valueUnit) ? p.valueUnit[0] : p.valueUnit) || "",
      propValue: valText,
      propName: propName,
      refPid: propRefPid,
      vid: valVid,
      numberInputValue: "",
      controlType: p.propertyValueType === 0 ? 1 : (p.controlType || 0),
      pid: propPid,
      templatePid: propTemplatePid,
      valueExtendInfo: "",
    });
  }

  // 后处理：检查父子关系冲突
  // 如果电源方式=不带电/无 或 电池属性=不带电池，则移除所有电相关子属性
  const powerProp = output.find(p => p.propName === "电源方式" || p.propName === "电池属性");
  if (powerProp && /不带电|无|不需要|不含/.test(powerProp.propValue)) {
    const electricChildProps = ["工作电压", "插头规格", "额定功率", "电压", "功率", "瓦数", "电池数量", "电池类型", "电池容量", "充电时间", "充电方式", "可充电电池", "不可充电电池", "太阳能电池", "电池属性"];
    for (let i = output.length - 1; i >= 0; i--) {
      if (electricChildProps.some(n => output[i].propName.includes(n))) {
        console.error(`[getCategoryProperties] Remove child prop "${output[i].propName}" (parent 电源方式=不带电)`);
        output.splice(i, 1);
      }
    }
  }

  // 电池数量=无电池/不含电池 → 直接移除（无意义且可能缺少父属性）
  for (let i = output.length - 1; i >= 0; i--) {
    if (output[i].propName === "电池数量" && /无电池|不含|不需要|^无$/.test(output[i].propValue)) {
      console.error(`[getCategoryProperties] Remove "电池数量" = "${output[i].propValue}" (无电池无需提交)`);
      output.splice(i, 1);
    }
  }

  // 通用电池子属性兜底：如果有电池相关子属性但没有对应父属性，移除子属性
  const batteryChildNames = ["电池数量", "电池类型", "电池容量", "充电时间", "充电方式", "可充电电池", "不可充电电池", "太阳能电池", "电池属性"];
  const hasBatteryParent = output.some(p => p.propName === "电源方式" || p.propName === "是否含电池");
  if (!hasBatteryParent) {
    for (let i = output.length - 1; i >= 0; i--) {
      if (batteryChildNames.some(n => output[i].propName.includes(n))) {
        console.error(`[getCategoryProperties] Remove orphan battery prop "${output[i].propName}" (no parent 电源方式/是否含电池)`);
        output.splice(i, 1);
      }
    }
  }

  // 如果主体材质不是皮革/木材相关，移除真皮种类/木材类型/木种
  const materialProp = output.find(p => ["主体材质", "材料", "材质"].includes(p.propName));
  if (materialProp && !/皮革|真皮|牛皮|羊皮|猪皮/.test(materialProp.propValue)) {
    for (let i = output.length - 1; i >= 0; i--) {
      if (["真皮种类"].includes(output[i].propName)) {
        console.error(`[getCategoryProperties] Remove "${output[i].propName}" (材质非皮革)`);
        output.splice(i, 1);
      }
    }
  }
  if (materialProp && !/木|竹|藤/.test(materialProp.propValue)) {
    for (let i = output.length - 1; i >= 0; i--) {
      if (["木材类型", "木种"].includes(output[i].propName)) {
        console.error(`[getCategoryProperties] Remove "${output[i].propName}" (材质非木材)`);
        output.splice(i, 1);
      }
    }
  }

  console.error(`[getCategoryProperties] Final ${output.length} properties: ${output.map(p => `${p.propName}=${p.propValue}`).join(", ")}`);
  return output;
}

/**
 * 查询分类的规格信息（颜色/风格/尺寸等）
 */
async function getCategorySpecList(page, leafCatId) {
  const result = await temuXHR(page, PRICING_CONFIG.specParentEndpoint, { catId: leafCatId }, { maxRetries: 1 });
  const specList = (result.data?.parentSpecVOList || []).filter((spec) => spec?.parentSpecId && spec?.parentSpecName);
  return result.success
    ? specList.map((spec) => ({ parentSpecId: spec.parentSpecId, parentSpecName: spec.parentSpecName }))
    : [];
}

async function getCategorySpec(page, leafCatId) {
  const specList = await getCategorySpecList(page, leafCatId);
  if (specList.length === 0) return null;
  return specList[Math.floor(Math.random() * specList.length)];
}

function isWorkflowQuantityParentSpecName(name = "") {
  return /(数量|件数|个数|包数|套数|规格数量|quantity|pieces?|pcs?|pack\s*count|number\s*of\s*pieces)/i.test(String(name || ""));
}

function isWorkflowUnsafeRandomParentSpecName(name = "") {
  return /(数量|件数|个数|包数|套数|尺寸|尺码|大小|容量|重量|净含量|包装数量|quantity|pieces?|pcs?|pack|size|weight|volume|capacity)/i.test(String(name || ""));
}

function chooseWorkflowQuantityParentSpec(specList = []) {
  return (specList || []).find((spec) => isWorkflowQuantityParentSpecName(spec?.parentSpecName)) || null;
}

function chooseWorkflowRandomParentSpec(specList = [], quantitySpec = null) {
  const candidates = (specList || []).filter((spec) => {
    if (!spec?.parentSpecId || !spec?.parentSpecName) return false;
    if (quantitySpec?.parentSpecId && spec.parentSpecId === quantitySpec.parentSpecId) return false;
    return !isWorkflowUnsafeRandomParentSpecName(spec.parentSpecName);
  });
  const priority = [
    /(颜色|color)/i,
    /(款式|风格|样式|style|variant)/i,
    /(型号|model)/i,
    /(材质|material)/i,
    /(品类|type|category)/i,
  ];
  for (const pattern of priority) {
    const matched = candidates.find((spec) => pattern.test(String(spec.parentSpecName || "")));
    if (matched) return matched;
  }
  return candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
}

async function resolveSpecValueForParent(page, config, parentSpec, candidates = [], logPrefix = "[spec]") {
  const parentSpecId = Number(parentSpec?.parentSpecId) || 0;
  const parentSpecName = String(parentSpec?.parentSpecName || "").trim();
  const names = Array.from(new Set(candidates.map((item) => String(item || "").trim()).filter(Boolean)));
  if (!parentSpecId || !parentSpecName || names.length === 0) return null;
  for (const specName of names) {
    const specResult = await temuXHR(
      page,
      config.specQueryEndpoint,
      { parentSpecId, specName },
      { maxRetries: 2 },
    );
    if (specResult.success && specResult.data?.specId) {
      const resolved = {
        parentSpecId,
        parentSpecName,
        specId: specResult.data.specId,
        specName,
      };
      console.error(`${logPrefix} Spec value: ${parentSpecName}=${specName} (${resolved.specId})`);
      return resolved;
    }
    console.error(`${logPrefix} Spec query failed for ${parentSpecName}="${specName}", trying next candidate...`);
  }
  return null;
}

function buildSkuSpecReq(spec) {
  return {
    parentSpecId: spec.parentSpecId,
    parentSpecName: spec.parentSpecName,
    specId: spec.specId,
    specName: spec.specName,
    specLangSimpleList: [],
  };
}

function buildProductSpecPropertyReq(spec) {
  return {
    parentSpecId: spec.parentSpecId,
    parentSpecName: spec.parentSpecName,
    specId: spec.specId,
    specName: spec.specName,
    vid: 0,
    specLangSimpleList: [],
    refPid: 0,
    pid: 0,
    templatePid: 0,
    propName: spec.parentSpecName,
    propValue: spec.specName,
    valueUnit: "",
    valueGroupId: 0,
    valueGroupName: "",
    valueExtendInfo: "",
  };
}

/**
 * AI 自修复：分析提交错误并返回修复指令
 */
async function aiSelfRepair(errorMsg, errorCode, payload, params) {
  if (!AI_API_KEY) { console.error("[selfRepair] AI_API_KEY not configured"); return null; }

  const propsInfo = (payload.productPropertyReqs || []).map(p => `${p.propName}=${p.propValue}`).join(", ");
  const catInfo = Object.entries(payload).filter(([k, v]) => k.startsWith("cat") && k.endsWith("Id") && v > 0).map(([k, v]) => `${k}=${v}`).join(", ");

  const prompt = `你是 Temu 卖家后台商品上架错误修复专家。分析以下错误并给出修复指令。

商品标题: "${params.title || ""}"
提交的类目: ${catInfo}
提交的属性: ${propsInfo}
错误码: ${errorCode}
错误信息: "${errorMsg}"

常见错误模式和修复方法:
1. "属性[X]校验错误:属性值:Y不满足父子关系" → 移除属性X（父属性不匹配时子属性应被删除）
2. "属性[X]校验错误:缺少父属性值" → 移除属性X（缺少父属性时子属性不应提交）
3. "货品类目属性更新" → 重新获取属性模板（retry_template）
4. "不能为空" → 重新获取属性模板
5. "Category is illegal" → 重新搜索类目（retry_category）
6. "Outer packaging information is incomplete" → 补全包装信息（fix_packaging）

请返回JSON（不要其他文字）:
{
  "analysis": "一句话分析错误原因",
  "actions": [
    {"type": "remove_prop", "propName": "属性名"},
    {"type": "retry_template"},
    {"type": "retry_category"},
    {"type": "fix_packaging"},
    {"type": "give_up", "reason": "原因"}
  ]
}
只返回需要的action，不要返回所有类型。`;

  try {
    const client = getAiGeminiClient();
    if (!client) {
      console.error(`[selfRepair] AI_API_KEY not configured`);
      return null;
    }
    let data;
    try {
      data = await client.chat.completions.create({
        model: AI_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      });
    } catch (innerErr) {
      console.error(`[selfRepair] AI API error: ${innerErr?.message || String(innerErr)}`);
      return null;
    }
    const content = data?.choices?.[0]?.message?.content || "";
    console.error(`[selfRepair] AI response: ${content.slice(0, 300)}`);

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.error(`[selfRepair] Analysis: ${parsed.analysis}`);
      console.error(`[selfRepair] Actions: ${JSON.stringify(parsed.actions)}`);
      return parsed;
    }
  } catch (e) {
    console.error(`[selfRepair] AI call failed: ${e.message}`);
  }
  return null;
}

/**
 * 规则兜底修复（AI 失败时的 fallback）
 */
function ruleBasedRepair(errorMsg) {
  const actions = [];

  // 属性校验错误：提取属性名并移除
  const attrMatch = errorMsg.match(/属性\[(.+?)\]/);
  if (attrMatch) {
    actions.push({ type: "remove_prop", propName: attrMatch[1] });
    return actions;
  }

  // 类目属性更新 → 重新获取模板
  if (errorMsg.includes("货品类目属性更新")) {
    actions.push({ type: "retry_template" });
    return actions;
  }

  // 类目非法 → 重新搜索
  if (errorMsg.includes("Category is illegal")) {
    actions.push({ type: "retry_category" });
    return actions;
  }

  // 包装不完整 → 补全
  if (errorMsg.includes("Outer packaging") || errorMsg.includes("packaging information")) {
    actions.push({ type: "fix_packaging" });
    return actions;
  }

  // 不能为空 → 重新获取模板
  if (errorMsg.includes("不能为空")) {
    actions.push({ type: "retry_template" });
    return actions;
  }

  // 主销售属性不合法 → 重新获取规格并重试
  if (errorMsg.includes("主销售属性不合法")) {
    actions.push({ type: "retry_spec" });
    return actions;
  }

  // 净含量必填 → 先自动填充默认净含量值，再刷新模板；仍失败时上层会升级到 retry_category
  if (errorMsg.includes("净含量")) {
    actions.push({ type: "fix_net_content" });
    actions.push({ type: "retry_template" });
    return actions;
  }

  // 其它属性必填 → 重新获取模板
  if (errorMsg.includes("必填")) {
    actions.push({ type: "retry_template" });
    return actions;
  }

  // 属性校验错误（通用）→ 移除有问题的属性
  if (errorMsg.includes("校验错误") || errorMsg.includes("不满足")) {
    // 提取属性名
    const propMatch = errorMsg.match(/属性[:\s]*[「"']?([^」"'\]]+)/);
    if (propMatch) {
      actions.push({ type: "remove_prop", propName: propMatch[1].trim() });
    } else {
      actions.push({ type: "retry_template" });
    }
    return actions;
  }

  // 说明书未上传 → 先挂一个占位说明书 URL；不行再换类目（strict 模式也强制解锁）
  if (errorMsg.includes("说明书未上传") || errorMsg.includes("说明书")) {
    actions.push({ type: "fix_guide_file" });
    actions.push({ type: "retry_category", forceUnlock: true });
    return actions;
  }

  return actions;
}

async function createProductViaAPI(params) {
  console.error("[api-create] Starting API-based product creation...");
  const config = { ...PRICING_CONFIG, ...params.config };
  const strictCategoryMode = params.categoryLockMode === "strict";
  const guidedCategoryMode = params.categoryLockMode === "guided";
  // 只有 strict 才完全锁定表格类目；guided 允许使用标题/历史/已知分支继续收敛到更合适的后台类目。
  const protectedCategoryMode = strictCategoryMode;

  // Step 1: 打开 Temu 页面获取认证上下文
  const page = await createSellerCentralPage("/goods/list", {
    attempts: 2,
    lite: false,
    readyDelayMin: 2000,
    readyDelayMax: 3000,
    logPrefix: "[api-create]",
  });
  try {
    await saveCookies();

    // Step 2: 准备图片（至少 5 张）
    let imageUrls = params.imageUrls || [];
    if (params.generateAI && params.sourceImage) {
      console.error("[api-create] Generating AI images...");
      try {
        const aiResult = await generateAIImages(
          params.sourceImage,
          params.title,
          params.aiImageTypes || AI_DETAIL_IMAGE_TYPE_ORDER
        );
        const aiImages = aiResult.images || aiResult || [];
        console.error(`[api-create] AI generated ${aiImages.length} images`);

        if (aiImages.length > 0) {
          await refreshMaterialUploadSession(page, "prepare_ai_upload");
        }

        // 素材上传对登录态很敏感，串行上传比同页并发更稳定。
        for (const imgPath of aiImages) {
          const uploadResult = await uploadImageToMaterial(page, imgPath);
          if (uploadResult.success && uploadResult.url) {
            imageUrls.push(uploadResult.url);
            continue;
          }
          console.error(`[api-create] Upload failed for ${path.basename(imgPath)}: ${uploadResult.error || "unknown upload error"}`);
        }
      } catch (e) {
        console.error(`[api-create] AI image generation failed: ${e.message}`);
      }
    }

    if (imageUrls.length === 0) {
      return { success: false, message: "没有可用的商品图片", step: "images" };
    }
    if (imageUrls.length < 5) {
      console.error(`[api-create] Warning: only ${imageUrls.length} images (need 5+). Duplicating...`);
      while (imageUrls.length < 5) {
        imageUrls.push(imageUrls[imageUrls.length % imageUrls.length]);
      }
    }

    // Step 3: 搜索分类 — 刷新页面确保 anti-content 有效
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    console.error(`[api-create] Page refreshed before category search`);

    let catIds = extractCategoryIdsSnapshot(params.catIds);
    let leafCatId = Number(params.leafCatId || params.leafCategoryId || params.catId || params.categoryId) || extractLeafCatIdFromCategoryIds(catIds);

    if ((!catIds || getCategoryDepth(catIds) === 0) && !leafCatId) {
      const exactHistoryMatch = findCategoryHistoryMatch({
        sourceProductId: params.sourceProductId,
        goodsId: params.goodsId,
        productId: params.productId,
        productSkcId: params.productSkcId,
        title: params.title,
        categorySearch: params.categorySearch,
      });
      if (exactHistoryMatch?._exactIdentifierMatch) {
        catIds = { ...(exactHistoryMatch.catIds || {}) };
        if (exactHistoryMatch.path && !catIds._path) catIds._path = exactHistoryMatch.path;
        leafCatId = Number(exactHistoryMatch.leafCatId) || 0;
        console.error(`[api-create] Restored exact backend category from local cache: ${exactHistoryMatch.path || leafCatId}`);
      }
    }

    if (!protectedCategoryMode && leafCatId && (!catIds || getCategoryDepth(catIds) === 0)) {
      const directLeafMatch = findCategoryHistoryMatch({
        leafCatId,
        sourceProductId: params.sourceProductId,
        goodsId: params.goodsId,
        productId: params.productId,
        productSkcId: params.productSkcId,
        title: params.title,
        categorySearch: params.categorySearch,
      });
      if (directLeafMatch) {
        catIds = {
          ...(directLeafMatch.catIds || {}),
          ...(catIds || {}),
        };
        if (!catIds._path && directLeafMatch.path) catIds._path = directLeafMatch.path;
        leafCatId = Number(directLeafMatch.leafCatId) || leafCatId;
        console.error(`[api-create] Restored direct leaf category from history: ${directLeafMatch.path || directLeafMatch.categorySearch || leafCatId} (leaf=${leafCatId}, score=${directLeafMatch._score})`);
      } else {
        catIds = catIds || {};
        console.error(`[api-create] Using direct leaf category: ${leafCatId}`);
      }
    }

    let categorySearchTerms = [];
    if (!catIds || getCategoryDepth(catIds) === 0) {
      // 后台分类路径搜索 + 逐级 fallback
      const titleFallbackTerms = strictCategoryMode ? [] : buildTitleCategoryFallbackTerms(params.title);
      const searchTerms = strictCategoryMode
        ? buildCategorySearchVariants(
            ...(Array.isArray(params.categorySearchVariants) ? params.categorySearchVariants : []),
            params.categorySearch,
          )
        : buildCategorySearchVariants(
            ...(Array.isArray(params.categorySearchVariants) ? params.categorySearchVariants : []),
            params.categorySearch,
            ...titleFallbackTerms,
          );
      if (!strictCategoryMode && params.title && !searchTerms.includes(params.title)) searchTerms.push(params.title);
      if (searchTerms.length === 0) searchTerms.push("通用商品");
      categorySearchTerms = searchTerms.slice();
      const compatibilityHints = guidedCategoryMode
        ? searchTerms.filter((term) => !normalizeCategoryLookupText(term).includes("/"))
        : searchTerms;
      if (guidedCategoryMode && compatibilityHints.length === 0 && params.title) compatibilityHints.push(params.title);

      // strict 模式也允许走“确定性已知分支”回退：
      // 这仍然是按表格后台分类 + 标题语义在本地已知类目树里收敛，
      // 不会引入 AI/历史草稿的漂移，但能避免后台分类只有宽词时搜索失败。
      if (shouldPreferKnownCategoryBranch(searchTerms, params.title || "")) {
        const preferredKnownBranchMatch = await resolveKnownCategoryBranchFallback(page, searchTerms, params.title || "");
        if (preferredKnownBranchMatch?.leafCatId && isCategoryCandidateCompatible(preferredKnownBranchMatch, searchTerms)) {
          catIds = { ...(preferredKnownBranchMatch.catIds || {}) };
          if (preferredKnownBranchMatch.path && !catIds._path) catIds._path = preferredKnownBranchMatch.path;
          leafCatId = Number(preferredKnownBranchMatch.leafCatId) || 0;
          console.error(`[api-create] Preferred known branch category: ${preferredKnownBranchMatch.path || leafCatId}`);
        }
      }

      // 辅助函数：从 queryCatHints 响应中提取 catIds
      function extractCatIdsFromHints(hintsResult, categoryPath) {
        const hints = Array.isArray(hintsResult.data)
          ? hintsResult.data
          : (hintsResult.data?.list || hintsResult.data?.catHints || hintsResult.data?.categoryList || []);
        console.error(`[api-create] queryCatHints response keys: ${hintsResult.data ? Object.keys(hintsResult.data).join(",") : "null"}, hints count: ${hints.length}`);
        if (hints.length === 0) return null;

        // 智能匹配：从多个结果中找路径最匹配的
        let hint = hints[0];
        if (hints.length > 1 && categoryPath) {
          const pathParts = categoryPath.split(/[/>]/).map(s => s.trim()).filter(Boolean);
          let bestScore = -1;
          for (const h of hints) {
            // 构建完整路径
            const hPath = [];
            for (let j = 1; j <= 10; j++) {
              const catName = h[`cat${j}`]?.catName || "";
              if (catName) hPath.push(catName);
            }
            const fullPath = hPath.join(">");
            // 计算匹配分数
            let score = 0;
            for (const part of pathParts) {
              if (fullPath.includes(part)) score += 2;
              // 部分匹配
              for (const hp of hPath) {
                if (hp.includes(part.substring(0, 2)) || part.includes(hp.substring(0, 2))) score += 0.5;
              }
            }
            console.error(`[api-create] hint candidate: ${fullPath} score=${score}`);
            if (score > bestScore) { bestScore = score; hint = h; }
          }
          console.error(`[api-create] Best match score: ${bestScore}`);
        }
        console.error(`[api-create] hint[0] keys: ${Object.keys(hint).join(",")}, sample: ${JSON.stringify(hint).slice(0, 300)}`);
        const ids = {};
        for (let i = 1; i <= 10; i++) {
          // Support both flat (hint.cat1Id) and nested (hint.cat1.catId) formats
          ids[`cat${i}Id`] = hint[`cat${i}Id`] || (hint[`cat${i}`] && hint[`cat${i}`].catId) || 0;
        }
        let leaf = null;
        for (let i = 10; i >= 1; i--) {
          if (ids[`cat${i}Id`] > 0) { leaf = ids[`cat${i}Id`]; break; }
        }
        // If all catIds are 0, try alternative field names
        if (!leaf) {
          // Try catIdList array format
          if (hint.catIdList && Array.isArray(hint.catIdList)) {
            hint.catIdList.forEach((id, idx) => { if (id > 0) ids[`cat${idx+1}Id`] = id; });
            for (let i = 10; i >= 1; i--) { if (ids[`cat${i}Id`] > 0) { leaf = ids[`cat${i}Id`]; break; } }
          }
          // Try leafCatId directly
          if (!leaf && hint.leafCatId) { leaf = hint.leafCatId; ids.cat3Id = hint.leafCatId; }
          if (!leaf && hint.catId) { leaf = hint.catId; ids.cat3Id = hint.catId; }
          console.error(`[api-create] Alternative extraction: leaf=${leaf}`);
        }
        if (!leaf) return null; // Don't return all-zero catIds
        const hintPath = hint.catPath || hint._path || Object.keys(ids).filter(k => ids[k] > 0).map(k => `${k}=${ids[k]}`).join(",");
        return { catIds: ids, leafCatId: leaf, path: hintPath };
      }

      // 方法1: 分类树遍历（主方法）— 用后台分类路径精确匹配
      if (!leafCatId) {
        for (const term of searchTerms) {
          // 只有当 catIds 拿到了真实层级 ID（depth>0）才停止；只有 _path 占位串不算有效，
          // 否则会让整个搜索循环在第一次迭代直接 break，所有后台分类都搜不到。
          if (catIds && getCategoryDepth(catIds) > 0) break;
          console.error(`[api-create] Fallback searchCategoryAPI: "${term.slice(0, 50)}"`);
          const catResult = await searchCategoryAPI(page, term, { title: params.title });
          if (catResult?.list?.[0]) {
            const cat = catResult.list[0];
            const candidateCatIds = {};
            for (let i = 1; i <= 10; i++) {
              candidateCatIds[`cat${i}Id`] = cat[`cat${i}Id`] || 0;
              if (cat[`cat${i}Name`]) candidateCatIds[`cat${i}Name`] = cat[`cat${i}Name`];
            }
            if (cat._path) candidateCatIds._path = cat._path;
            if (!isCategoryCandidateCompatible({ catIds: candidateCatIds, path: candidateCatIds._path }, compatibilityHints)) {
              console.error(`[api-create] Reject mismatched category candidate: ${candidateCatIds._path || JSON.stringify(candidateCatIds)}`);
              continue;
            }
            catIds = candidateCatIds;
            for (let i = 10; i >= 1; i--) {
              if (catIds[`cat${i}Id`] > 0) { leafCatId = catIds[`cat${i}Id`]; break; }
            }
            console.error(`[api-create] Category: ${cat._path || JSON.stringify(catIds)}, leaf=${leafCatId}`);
          }
        }
      }
    }

    const requestedCategoryHints = categorySearchTerms.length > 0
      ? categorySearchTerms
      : [params.categorySearch, ...(Array.isArray(params.categorySearchVariants) ? params.categorySearchVariants : [])].filter(Boolean);

    if (!leafCatId) {
      const knownBranchMatch = await resolveKnownCategoryBranchFallback(page, categorySearchTerms, params.title || "");
      if (knownBranchMatch?.leafCatId) {
        catIds = { ...(knownBranchMatch.catIds || {}) };
        if (knownBranchMatch.path && !catIds._path) catIds._path = knownBranchMatch.path;
        leafCatId = Number(knownBranchMatch.leafCatId) || 0;
        console.error(`[api-create] Resolved category from known branch fallback: ${knownBranchMatch.path || leafCatId}`);
      }
    }

    if (!protectedCategoryMode && !leafCatId) {
      const historyMatch = findCategoryHistoryMatch({
        title: params.title,
        categorySearch: params.categorySearch,
        catIds,
      });
      if (historyMatch && isCategoryCandidateCompatible(historyMatch, categorySearchTerms.length > 0 ? categorySearchTerms : [params.categorySearch])) {
        catIds = {
          ...(historyMatch.catIds || {}),
          ...(catIds || {}),
        };
        if (!catIds._path && historyMatch.path) catIds._path = historyMatch.path;
        leafCatId = Number(historyMatch.leafCatId) || 0;
        console.error(`[api-create] Restored category from local history: ${historyMatch.path || historyMatch.categorySearch || leafCatId} (leaf=${leafCatId}, score=${historyMatch._score})`);
      } else if (historyMatch) {
        console.error(`[api-create] Ignored mismatched history category: ${historyMatch.path || historyMatch.categorySearch || historyMatch.leafCatId}`);
      }
    }

    if (!protectedCategoryMode && !leafCatId) {
      const draftMatch = await findDraftCategoryMatch(page, params.draftIdCandidates, params.title || "");
      if (draftMatch?.leafCatId && isCategoryCandidateCompatible(draftMatch, categorySearchTerms.length > 0 ? categorySearchTerms : [params.categorySearch])) {
        catIds = { ...(draftMatch.catIds || {}) };
        if (draftMatch.path && !catIds._path) catIds._path = draftMatch.path;
        leafCatId = Number(draftMatch.leafCatId) || 0;
      } else if (draftMatch?.leafCatId) {
        console.error(`[api-create] Ignored mismatched draft category: ${draftMatch.path || draftMatch.leafCatId}`);
      }
    }

    if (!leafCatId) {
      const apiErr = __consumeLastCategoryApiError();
      let detail = "";
      if (apiErr) {
        const isAuthLike = /未登录|login|auth|cookie|forbidden|权限|过期|超时|timeout|401|403/i.test(`${apiErr.errorMsg || ""} ${apiErr.errorCode || ""}`)
          || apiErr.errorCode === 40001 || apiErr.errorCode === 40003;
        detail = isAuthLike
          ? `（疑似登录已过期或权限不足，建议在「账号管理」重新登录后重试。最近一次 ${apiErr.stage} 失败: ${apiErr.errorCode || "?"} ${apiErr.errorMsg || ""}）`
          : `（最近一次类目接口 ${apiErr.stage} 失败: ${apiErr.errorCode || "?"} ${apiErr.errorMsg || ""}）`;
      } else {
        detail = "（已尝试全部分类路径变体与标题关键词，Temu 类目树中未找到匹配项，请确认表格里的【后台分类】路径是否准确，或在「账号管理」确认登录状态有效）";
      }
      return { success: false, message: `分类搜索失败: "${params.categorySearch || params.title}" ${detail}`, step: "category" };
    }

    // 确保 leafCatId 不为 undefined
    if (!leafCatId) {
      for (let i = 10; i >= 1; i--) {
        if (catIds[`cat${i}Id`] > 0) { leafCatId = catIds[`cat${i}Id`]; break; }
      }
      console.error(`[api-create] Re-extracted leafCatId=${leafCatId} from catIds`);
    }

    catIds = catIds || {};

    // Step 3.5: AI 验证分类是否匹配商品标题
    if (!strictCategoryMode && catIds && params.title && AI_API_KEY) {
      const catPath = catIds._path || Object.keys(catIds)
        .filter(k => k.endsWith("Name") && catIds[k])
        .map(k => catIds[k]).join(" > ");
      if (catPath) {
        try {
          console.error(`[api-create] AI verifying category: "${catPath}" for "${params.title.slice(0, 30)}..."`);
          const verifyClient = getAiGeminiClient();
          if (verifyClient) {
            const vData = await verifyClient.chat.completions.create({
              model: AI_MODEL,
              messages: [{ role: "user", content: `商品标题: "${params.title.slice(0, 80)}"\n分类路径: "${catPath}"\n\n这个分类是否适合该商品？只回答 "yes" 或 "no"。如果商品明显不属于这个分类就回答no。` }],
              temperature: 0,
              max_tokens: 10,
            });
            const answer = (vData?.choices?.[0]?.message?.content || "").trim().toLowerCase();
            console.error(`[api-create] Category verify: ${answer}`);
            if (answer.includes("no")) {
              console.error(`[api-create] Category mismatch! Re-searching with product title...`);
              // 用标题重新搜索分类
              const titleCatResult = await searchCategoryAPI(page, params.title, { title: params.title });
              if (titleCatResult?.list?.[0]) {
                const cat = titleCatResult.list[0];
                const nextCatIds = {};
                for (let i = 1; i <= 10; i++) {
                  nextCatIds[`cat${i}Id`] = cat[`cat${i}Id`] || 0;
                  if (cat[`cat${i}Name`]) nextCatIds[`cat${i}Name`] = cat[`cat${i}Name`];
                }
                if (cat._path) nextCatIds._path = cat._path;
                if (!isCategoryCandidateCompatible({ catIds: nextCatIds, path: nextCatIds._path }, requestedCategoryHints)) {
                  console.error(`[api-create] Ignore mismatched title re-search category: ${nextCatIds._path || JSON.stringify(nextCatIds)}`);
                } else {
                  catIds = nextCatIds;
                  leafCatId = 0;
                  for (let i = 10; i >= 1; i--) {
                    if (catIds[`cat${i}Id`] > 0) { leafCatId = catIds[`cat${i}Id`]; break; }
                  }
                  const newPath = Object.keys(catIds).filter(k => k.endsWith("Name") && catIds[k]).map(k => catIds[k]).join(" > ");
                  console.error(`[api-create] Re-searched category: ${newPath}, leaf=${leafCatId}`);
                }
              }
            }
          }
        } catch (e) { logSilent("category.verify", e); }
      }
    }

    if (!strictCategoryMode) {
      const betterCategory = await findBetterLeafCategoryByTemplate(page, catIds, leafCatId, params.title || "");
      if (betterCategory?.catId && isCategoryCandidateCompatible(betterCategory, requestedCategoryHints)) {
        catIds = { ...(betterCategory.catIds || catIds) };
        leafCatId = Number(betterCategory.catId) || leafCatId;
        catIds._path = betterCategory.path;
        console.error(`[api-create] Category corrected by template scan: ${betterCategory.path} (leaf=${leafCatId})`);
      } else if (betterCategory?.catId) {
        console.error(`[api-create] Ignore mismatched template-scan category: ${betterCategory.path || betterCategory.catId}`);
      }
    }
    rememberResolvedCategory({
      title: params.title,
      categorySearch: params.categorySearch,
      catIds,
      leafCatId,
      path: getCategoryPathText(catIds),
      sourceProductId: params.sourceProductId,
      goodsId: params.goodsId,
      productId: params.productId,
      productSkcId: params.productSkcId,
      source: "resolved",
    });

    // Step 4: 获取分类属性和规格
    let properties = params.properties;
    if (!properties) {
      if (leafCatId) {
        console.error(`[api-create] Fetching category template for leaf=${leafCatId}...`);
        properties = await getCategoryProperties(page, leafCatId, params.title || "", getCategoryPathText(catIds));
        if (properties) {
          console.error(`[api-create] Got ${properties.length} properties from template`);
        }
      }
      if (!properties || properties.length === 0) {
        properties = config.defaultProperties;
        console.error(`[api-create] Using default properties (${properties.length})`);
      }
    }

    // 获取规格信息
    let specInfo = config.defaultSpec;
    let workflowQuantitySpecConfig = null;
    if (leafCatId) {
      const specList = await getCategorySpecList(page, leafCatId);
      if (params.workflowQuantitySpecs) {
        const quantityCounts = (Array.isArray(params.quantityCounts) && params.quantityCounts.length > 0 ? params.quantityCounts : [1, 2, 3, 4])
          .map((item) => Math.floor(Number(item)))
          .filter((item) => Number.isFinite(item) && item >= 1 && item <= 12);
        const uniqueQuantityCounts = Array.from(new Set(quantityCounts));
        const workflowRandomSpecValueCount = Math.max(1, Math.min(4, Math.floor(Number(params.workflowRandomSpecValueCount) || 2)));
        const quantityParentSpec = chooseWorkflowQuantityParentSpec(specList);
        const randomParentSpec = chooseWorkflowRandomParentSpec(specList, quantityParentSpec);
        if (!quantityParentSpec) {
          return {
            success: false,
            message: "该类目未提供数量父规格，无法创建 1PC/2PC/3PC/4PC SKU",
            step: "spec_quantity_parent",
            draftSaved: false,
          };
        }
        if (!randomParentSpec) {
          return {
            success: false,
            message: "该类目未提供可用随机父规格，无法创建双父规格 SKU",
            step: "spec_random_parent",
            draftSaved: false,
          };
        }
        const randomSpecs = [];
        for (let index = 0; index < workflowRandomSpecValueCount; index += 1) {
          const candidates = index === 0
            ? buildSpecNameCandidates(params.title || "", params.specName)
            : buildSecondarySpecNameCandidates(params.title || "", randomSpecs.map((item) => item.specName));
          const randomSpec = await resolveSpecValueForParent(
            page,
            config,
            randomParentSpec,
            candidates,
            "[api-create-workflow]",
          );
          if (!randomSpec?.specId) {
            return {
              success: false,
              message: `随机父规格【${randomParentSpec.parentSpecName}】第 ${index + 1} 个子规格创建失败`,
              step: "spec_random_value",
              draftSaved: false,
            };
          }
          randomSpecs.push(randomSpec);
        }
        const quantitySpecs = [];
        for (const count of uniqueQuantityCounts) {
          const label = `${count}PC`;
          const quantitySpec = await resolveSpecValueForParent(
            page,
            config,
            quantityParentSpec,
            [label, `${count}PCS`, `${count}件`, `${count}件装`],
            "[api-create-workflow]",
          );
          if (!quantitySpec?.specId) {
            return {
              success: false,
              message: `数量父规格【${quantityParentSpec.parentSpecName}】子规格 ${label} 创建失败`,
              step: "spec_quantity_value",
              draftSaved: false,
            };
          }
          quantitySpecs.push({ ...quantitySpec, count, label });
        }
        workflowQuantitySpecConfig = {
          randomSpec: randomSpecs[0],
          randomSpecs,
          quantityParentSpec,
          quantitySpecs,
        };
        specInfo = randomSpecs[0];
        console.error(`[api-create-workflow] Specs: random=${randomParentSpec.parentSpecName}/${randomSpecs.map((item) => item.specName).join("|")}, quantity=${quantityParentSpec.parentSpecName} values=${quantitySpecs.map((item) => item.specName).join("|")}`);
      } else {
        const catSpec = specList.length > 0 ? specList[Math.floor(Math.random() * specList.length)] : null;
        if (catSpec) {
          specInfo = { ...specInfo, ...catSpec };
          console.error(`[api-create] Spec: ${specInfo.parentSpecName} (${specInfo.parentSpecId})`);
        }
      }
    }

    if (!workflowQuantitySpecConfig) {
      // 查询/创建规格值 - 统一使用中文卖点词，并保留中文兜底候选
      const specNameCandidates = buildSpecNameCandidates(params.title || "", params.specName);
      const resolved = await resolveSpecValueForParent(page, config, specInfo, specNameCandidates, "[api-create]");
      if (resolved?.specId) {
        specInfo = { ...specInfo, ...resolved };
      } else {
        console.error(`[api-create] WARNING: specId unavailable, using default`);
      }
    }

    // Step 5: 构造 payload（基于真实抓包结构）
    const basePriceInCents = Math.max(1, Math.round((params.price || 9.99) * 100));
    const priceInCents = params.workflowQuantitySpecs
      ? basePriceInCents
      : Math.round((params.price || 9.99) * 100 * 2);  // 老流程沿用申报价 ×2
    const retailPrice = Math.round(priceInCents * config.retailPriceMultiplier);
    const buildWorkflowNetContentReq = (value = 1) => {
      const count = Math.max(1, Math.floor(Number(value) || 1));
      return {
        value: count,
        unitCode: 1,
        unit: "件",
        netContentNumber: count,
        netContentUnitCode: 1,
      };
    };
    const getWorkflowPackIncludeCount = (pieces = 1) => {
      const count = Math.max(1, Number(pieces) || 1);
      return count === 1 ? 2 + Math.floor(Math.random() * 3) : Math.floor(count);
    };
    const buildWorkflowPieceIncludeInfo = (value = 1) => {
      const count = Math.max(1, Math.floor(Number(value) || 1));
      return {
        value: count,
        unitCode: 1,
        unit: "件",
        numberOfPieces: count,
        pieceUnitCode: 1,
        numberOfPiecesNew: count,
        pieceNewUnitCode: 1,
      };
    };
    const buildWorkflowTotalNetContentReq = (value = 1) => {
      if (!params.workflowQuantitySpecs) return {};
      return buildWorkflowNetContentReq(value);
    };
    const buildSkuReq = ({ thumbUrl, skuSpecReqs, pieces = 1, priceMultiplier = 1 }) => {
      const skuPrice = Math.max(1, Math.round(priceInCents * priceMultiplier));
      const skuRetailPrice = Math.max(1, Math.round(retailPrice * priceMultiplier));
      const workflowNetContentReq = params.workflowQuantitySpecs ? buildWorkflowNetContentReq(1) : {};
      const workflowPackIncludeCount = params.workflowQuantitySpecs ? getWorkflowPackIncludeCount(pieces) : 0;
      const workflowTotalNetContentReq = buildWorkflowTotalNetContentReq(workflowPackIncludeCount);
      const workflowPackIncludeInfo = params.workflowQuantitySpecs ? buildWorkflowPieceIncludeInfo(workflowPackIncludeCount) : {};
      const workflowIndividuallyPacked = params.workflowQuantitySpecs && Math.max(1, Number(pieces) || 1) > 1
        ? 0
        : null;
      return {
        thumbUrl,
        productSkuThumbUrlI18nReqs: [],
        extCode: "",
        supplierPrice: skuPrice,
        currencyType: config.currency,
        productSkuSpecReqs: skuSpecReqs,
        productSkuId: 0,
        productSkuSuggestedPriceReq: { suggestedPrice: skuRetailPrice, suggestedPriceCurrencyType: config.currency },
        productSkuUsSuggestedPriceReq: {},
        productSkuWhExtAttrReq: {
          productSkuVolumeReq: params.dimensions || config.defaultDimensions,
          productSkuWeightReq: { value: params.weight || config.defaultWeight },
          productSkuBarCodeReqs: [],
          productSkuSensitiveAttrReq: { isSensitive: 0, sensitiveList: [] },
          productSkuSensitiveLimitReq: {},
        },
        productSkuMultiPackReq: {
          skuClassification: pieces > 1 ? 2 : 1,
          numberOfPieces: pieces,
          pieceUnitCode: 1,
          individuallyPacked: workflowIndividuallyPacked,
          productSkuNetContent: workflowNetContentReq,
          productSkuNetContentReq: workflowNetContentReq,
          totalNetContent: workflowTotalNetContentReq,
          totalNetContentReq: workflowTotalNetContentReq,
          totalNetContentInfo: workflowTotalNetContentReq,
          packIncludeInfo: workflowPackIncludeInfo,
          numberOfPiecesNew: workflowPackIncludeCount || undefined,
          pieceNewUnitCode: workflowPackIncludeCount ? 1 : undefined,
        },
        productSkuSaleExtAttrReq: {
          productSkuAccessoriesReq: { productSkuAccessories: [] },
          productSkuIndividuallyPacked: workflowIndividuallyPacked,
          productSkuIndividuallyPackedReq: workflowIndividuallyPacked === null
            ? {}
            : { individuallyPacked: workflowIndividuallyPacked },
          productSkuNetContent: workflowNetContentReq,
          productSkuNetContentReq: workflowNetContentReq,
          totalNetContent: workflowTotalNetContentReq,
          totalNetContentReq: workflowTotalNetContentReq,
          totalNetContentInfo: workflowTotalNetContentReq,
          packIncludeInfo: workflowPackIncludeInfo,
          numberOfPiecesNew: workflowPackIncludeCount || undefined,
          pieceNewUnitCode: workflowPackIncludeCount ? 1 : undefined,
          mixedType: null,
        },
        productSkuAccessoriesReq: { productSkuAccessories: [] },
        productSkuNonAuditExtAttrReq: {},
      };
    };
    const quantitySkuImages = params.quantitySkuImages && typeof params.quantitySkuImages === "object"
      ? params.quantitySkuImages
      : {};
    const workflowQuantityPriceMultipliers = normalizeWorkflowQuantityPriceMultipliers(params.workflowQuantityPriceMultipliers);
    const productSkuReqs = workflowQuantitySpecConfig
      ? workflowQuantitySpecConfig.randomSpecs.flatMap((randomSpec) => workflowQuantitySpecConfig.quantitySpecs.map((quantitySpec) => {
          const count = Math.max(1, Number(quantitySpec.count) || 1);
          const quantityThumbUrl = quantitySkuImages[count]
            || quantitySkuImages[`${count}PC`]
            || quantitySkuImages[`${count}PCS`]
            || imageUrls[0];
          return buildSkuReq({
            thumbUrl: quantityThumbUrl,
            pieces: count,
            priceMultiplier: params.multiplyPriceByQuantity === false
              ? 1
              : getWorkflowQuantityPriceMultiplier(count, workflowQuantityPriceMultipliers),
            skuSpecReqs: [
              buildSkuSpecReq(randomSpec),
              buildSkuSpecReq(quantitySpec),
            ],
          });
        }))
      : [buildSkuReq({
          thumbUrl: imageUrls[0],
          pieces: 1,
          priceMultiplier: 1,
          skuSpecReqs: [buildSkuSpecReq(specInfo)],
        })];
    const productSpecPropertyReqs = workflowQuantitySpecConfig
      ? [
          ...workflowQuantitySpecConfig.randomSpecs.map((spec) => buildProductSpecPropertyReq(spec)),
          ...workflowQuantitySpecConfig.quantitySpecs.map((spec) => buildProductSpecPropertyReq(spec)),
        ]
      : [buildProductSpecPropertyReq(specInfo)];

    const payload = {
      ...catIds,
      leafCatId,
      leafCategoryId: leafCatId,
      catId: leafCatId,
      categoryId: leafCatId,
      materialMultiLanguages: [],
      productName: params.title || "商品",
      productPropertyReqs: properties,
      productSkcReqs: [{
        previewImgUrls: imageUrls.slice(0, 10),
        productSkcCarouselImageI18nReqs: [],
        extCode: "",
        mainProductSkuSpecReqs: workflowQuantitySpecConfig
          ? workflowQuantitySpecConfig.randomSpecs.map((spec) => buildSkuSpecReq(spec))
          : [{ parentSpecId: 0, parentSpecName: "", specId: 0, specName: "" }],
        productSkuReqs,
        productSkcId: 0,
        isBasePlate: 0,
      }],
      productSpecPropertyReqs,
      carouselImageUrls: imageUrls.slice(0, 10),
      carouselImageI18nReqs: [],
      materialImgUrl: imageUrls[0],
      goodsLayerDecorationReqs: [],
      goodsLayerDecorationCustomizeI18nReqs: [],
      sizeTemplateIds: [],
      showSizeTemplateIds: [],
      goodsModelReqs: [],
      productWhExtAttrReq: {
        outerGoodsUrl: params.outerGoodsUrl || "",
        productOrigin: params.productOrigin || config.defaultRegion,
      },
      productCarouseVideoReqList: [],
      goodsAdvantageLabelTypes: [],
      productDetailVideoReqList: [],
      productOuterPackageImageReqs: params.outerPackageImages || [
        { imageUrl: "https://pfs.file.temu.com/product-material-private-tag/211a2a4a582/cb2fce63-cb55-4ea4-a43d-2754fcdd7c19_300x225.jpeg" },
        { imageUrl: "https://pfs.file.temu.com/product-material-private-tag/211a2a4a582/ee94a810-071b-41ab-8079-55c0d394da78_300x225.jpeg" },
        { imageUrl: "https://pfs.file.temu.com/product-material-private-tag/211a2a4a582/a8a2ebbd-e72d-4a33-bbee-703112dad786_300x225.jpeg" },
      ],
      productOuterPackageReq: params.outerPackageReq || { packageShape: 1, packageType: 0 },
      sensitiveTransNormalFileReqs: [],
      productGuideFileNewReqList: [],
      productGuideFileI18nReqs: [],
      productSaleExtAttrReq: {},
      productNonAuditExtAttrReq: { california65WarningInfoReq: {}, cosmeticInfoReq: {} },
      personalizationSwitch: 0,
      productComplianceStatementReq: {
        protocolVersion: "V2.0",
        protocolUrl: "https://dl.kwcdn.com/seller-public-file-us-tag/2079f603b6/56888d17d8166a6700c9f3e82972e813.html",
      },
      productOriginCertFileReqs: [],
    };
    syncLeafCategoryPayloadFields(payload, leafCatId);
    syncDraftPayloadDisplayFields(payload, params, imageUrls);

    // Step 6: 保存到 Temu 草稿箱
    const submitEndpoint = config.draftEndpoint;
    console.error(`[api-create] Saving draft to ${submitEndpoint}...`);
    console.error(`[api-create] Price: ¥${(priceInCents / 100).toFixed(2)}, Retail: ¥${(retailPrice / 100).toFixed(2)}, Images: ${imageUrls.length}, Props: ${properties.length}`);

    let result = await temuXHR(page, submitEndpoint, payload, { maxRetries: 1 });

    // ============ AI 自修复系统：最多5轮，根据错误类型智能修复 ============
    for (let attempt = 1; attempt <= 5 && !result.success; attempt++) {
      const errMsg = result.errorMsg || "";
      const errCode = result.errorCode || 0;

      // 只处理可修复的错误
      if (![6000002, 1000001, 1000003, 2000148].includes(errCode) && !errMsg.includes("不能为空") && !errMsg.includes("Category") && !errMsg.includes("packaging") && !errMsg.includes("Invalid image") && !errMsg.includes("净含量") && !errMsg.includes("属性") && !errMsg.includes("校验") && !errMsg.includes("必填") && !errMsg.includes("说明书")) {
        console.error(`[selfRepair] Error ${errCode} not repairable, stopping`);
        break;
      }

      console.error(`[selfRepair] ===== Attempt ${attempt}/5: error=${errCode} "${errMsg}" =====`);

      // 保存调试信息
      const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
      fs.mkdirSync(debugDir, { recursive: true });
      fs.writeFileSync(path.join(debugDir, `selfrepair_${attempt}_${Date.now()}.json`), JSON.stringify({
        attempt, errorCode: errCode, errorMsg: errMsg,
        submittedProps: payload.productPropertyReqs?.map(p => ({ name: p.propName, value: p.propValue })),
        leafCatId, catIds: Object.fromEntries(Object.entries(catIds).filter(([k,v]) => v > 0)),
      }, null, 2));

      // 先尝试 AI 分析，失败则用规则兜底
      let repair = await aiSelfRepair(errMsg, errCode, payload, params);
      let actions = repair?.actions || [];
      if (actions.length === 0) {
        console.error(`[selfRepair] AI returned no actions, falling back to rules`);
        actions = ruleBasedRepair(errMsg);
      }
      if (actions.length === 0) {
        console.error(`[selfRepair] No repair strategy found, stopping`);
        break;
      }

      // 智能升级：如果连续2次 retry_template 都失败（同一错误），自动升级到 retry_category
      if (attempt >= 2 && errMsg.includes("货品类目属性更新") && actions.every(a => a.type === "retry_template")) {
        console.error(`[selfRepair] retry_template failed ${attempt} times, upgrading to retry_category`);
        actions = [{ type: "retry_category" }];
      }

      // 检查是否放弃
      const giveUp = actions.find(a => a.type === "give_up");
      if (giveUp) {
        console.error(`[selfRepair] AI says give up: ${giveUp.reason}`);
        break;
      }

      // 执行修复动作
      let needResubmit = false;
      for (const action of actions) {
        switch (action.type) {
          case "remove_prop": {
            const before = payload.productPropertyReqs.length;
            payload.productPropertyReqs = payload.productPropertyReqs.filter(p => p.propName !== action.propName);
            const removed = before - payload.productPropertyReqs.length;
            console.error(`[selfRepair] remove_prop: "${action.propName}" (removed ${removed})`);
            if (removed > 0) needResubmit = true;
            break;
          }
          case "retry_template": {
            console.error(`[selfRepair] retry_template: refreshing page and re-fetching...`);
            await page.goto(page.url(), { waitUntil: "domcontentloaded" });
            await randomDelay(2000, 3500);
            const newProps = await getCategoryProperties(page, leafCatId, params.title || "", getCategoryPathText(catIds));
            if (newProps && newProps.length > 0) {
              payload.productPropertyReqs = newProps;
              console.error(`[selfRepair] Got ${newProps.length} refreshed properties`);
              needResubmit = true;
            } else {
              console.error(`[selfRepair] retry_template failed to get properties`);
            }
            break;
          }
          case "fix_net_content": {
            console.error(`[selfRepair] fix_net_content: filling default 净含量 values`);
            try {
              const defaultNetContent = { value: 1, unitCode: 1, unit: "件" };
              const defaultTotal = { value: 1, unitCode: 1, unit: "件" };
              const defaultPackInclude = {
                value: 1,
                unitCode: 1,
                unit: "件",
                numberOfPieces: 1,
                pieceUnitCode: 1,
                numberOfPiecesNew: 1,
                pieceNewUnitCode: 1,
              };
              if (Array.isArray(payload.productSkcReqs)) {
                for (const skc of payload.productSkcReqs) {
                  if (!Array.isArray(skc?.productSkuReqs)) continue;
                  for (const sku of skc.productSkuReqs) {
                    if (!sku) continue;
                    sku.productSkuMultiPackReq = sku.productSkuMultiPackReq || {};
                    const mp = sku.productSkuMultiPackReq;
                    mp.skuClassification = mp.skuClassification || 1;
                    mp.numberOfPieces = mp.numberOfPieces || 1;
                    mp.pieceUnitCode = mp.pieceUnitCode || 1;
                    mp.productSkuNetContentReq = { ...defaultNetContent };
                    mp.totalNetContent = { ...defaultTotal };
                    mp.totalNetContentReq = { ...defaultTotal };
                    mp.totalNetContentInfo = { ...defaultTotal };
                    mp.packIncludeInfo = { ...defaultPackInclude };
                    mp.numberOfPiecesNew = mp.numberOfPiecesNew || 1;
                    mp.pieceNewUnitCode = mp.pieceNewUnitCode || 1;
                    sku.productSkuSaleExtAttrReq = sku.productSkuSaleExtAttrReq || {};
                    sku.productSkuSaleExtAttrReq.productSkuNetContentReq = { ...defaultNetContent };
                    sku.productSkuSaleExtAttrReq.totalNetContent = { ...defaultTotal };
                    sku.productSkuSaleExtAttrReq.totalNetContentReq = { ...defaultTotal };
                    sku.productSkuSaleExtAttrReq.totalNetContentInfo = { ...defaultTotal };
                    sku.productSkuSaleExtAttrReq.packIncludeInfo = { ...defaultPackInclude };
                    sku.productSkuSaleExtAttrReq.numberOfPiecesNew = sku.productSkuSaleExtAttrReq.numberOfPiecesNew || 1;
                    sku.productSkuSaleExtAttrReq.pieceNewUnitCode = sku.productSkuSaleExtAttrReq.pieceNewUnitCode || 1;
                  }
                }
              }
              needResubmit = true;
            } catch (error) {
              console.error(`[selfRepair] fix_net_content error: ${error.message}`);
            }
            break;
          }
          case "fix_guide_file": {
            console.error(`[selfRepair] fix_guide_file: attaching placeholder guide file`);
            try {
              const placeholderUrl = "https://pfs.file.temu.com/product-material-private-tag/211a2a4a582/cb2fce63-cb55-4ea4-a43d-2754fcdd7c19_300x225.jpeg";
              payload.productGuideFileNewReqList = [
                { fileUrl: placeholderUrl, fileName: "user_manual.pdf", fileType: 1 },
              ];
              payload.productGuideFileI18nReqs = [
                { language: "zh", fileUrl: placeholderUrl, fileName: "user_manual.pdf" },
                { language: "en", fileUrl: placeholderUrl, fileName: "user_manual.pdf" },
              ];
              needResubmit = true;
            } catch (error) {
              console.error(`[selfRepair] fix_guide_file error: ${error.message}`);
            }
            break;
          }
          case "retry_category": {
            if (strictCategoryMode && !action.forceUnlock) {
              console.error("[selfRepair] retry_category skipped: strict category mode");
              break;
            }
            if (strictCategoryMode && action.forceUnlock) {
              console.error("[selfRepair] retry_category: strict mode override due to category-incompatible error");
            }
            console.error(`[selfRepair] retry_category: re-searching with different terms...`);
            await page.goto(page.url(), { waitUntil: "domcontentloaded" });
            await randomDelay(2000, 3500);

            // 尝试多种搜索词：原标题 → 归一化类目路径 → 标题前20字
            const titleFallbackTerms = buildTitleCategoryFallbackTerms(params.title);
            const searchTerms = guidedCategoryMode
              ? buildGuidedCategorySearchVariants(
                  params.title,
                  "",
                  ...(Array.isArray(params.categorySearchVariants) ? params.categorySearchVariants : []),
                  params.categorySearch,
                )
              : buildCategorySearchVariants(
                  params.categorySearch,
                  ...titleFallbackTerms,
                  params.title && params.title.length > 20 ? params.title.substring(0, 20) : "",
                );
            if (params.title && !searchTerms.includes(params.title)) searchTerms.unshift(params.title);

            let found = false;
            if (shouldPreferKnownCategoryBranch(searchTerms, params.title || "")) {
              const knownBranchMatch = await resolveKnownCategoryBranchFallback(page, searchTerms, params.title || "");
              if (knownBranchMatch?.leafCatId && isCategoryCandidateCompatible(knownBranchMatch, searchTerms)) {
                catIds = { ...(knownBranchMatch.catIds || catIds) };
                if (knownBranchMatch.path) catIds._path = knownBranchMatch.path;
                leafCatId = Number(knownBranchMatch.leafCatId) || leafCatId;
                for (let i = 1; i <= 10; i += 1) {
                  payload[`cat${i}Id`] = Number(catIds[`cat${i}Id`]) || 0;
                }
                syncLeafCategoryPayloadFields(payload, leafCatId);
            const newProps = await getCategoryProperties(page, leafCatId, params.title || "", getCategoryPathText(catIds));
                if (newProps && newProps.length > 0) payload.productPropertyReqs = newProps;
                console.error(`[selfRepair] Preferred known branch category: ${knownBranchMatch.path || leafCatId}`);
                needResubmit = true;
                found = true;
              }
            }
            for (const term of searchTerms) {
              if (found) break;
              console.error(`[selfRepair] Trying category search: "${term.substring(0, 30)}..."`);
              const catResult = await searchCategoryAPI(page, term, { title: params.title });
              if (catResult?.list?.[0]) {
                const cat = catResult.list[0];
                const candidateCatIds = {};
                for (let i = 1; i <= 10; i++) {
                  const cid = cat[`cat${i}Id`] || 0;
                  candidateCatIds[`cat${i}Id`] = cid;
                  if (cat[`cat${i}Name`]) candidateCatIds[`cat${i}Name`] = cat[`cat${i}Name`];
                }
                if (cat._path) candidateCatIds._path = cat._path;
                if (!isCategoryCandidateCompatible({ catIds: candidateCatIds, path: candidateCatIds._path }, searchTerms)) {
                  console.error(`[selfRepair] Reject mismatched category candidate: ${candidateCatIds._path || JSON.stringify(candidateCatIds)}`);
                  continue;
                }
                let newLeaf = null;
                let depth = 0;
                for (let i = 1; i <= 10; i++) {
                  const cid = candidateCatIds[`cat${i}Id`] || 0;
                  catIds[`cat${i}Id`] = cid;
                  if (candidateCatIds[`cat${i}Name`]) catIds[`cat${i}Name`] = candidateCatIds[`cat${i}Name`];
                  payload[`cat${i}Id`] = cid;
                  if (cid > 0) { newLeaf = cid; depth = i; }
                }
                if (candidateCatIds._path) catIds._path = candidateCatIds._path;
                // 只接受比当前更深或不同的类目
                if (newLeaf && (newLeaf !== leafCatId || depth > 3)) {
                  leafCatId = newLeaf;
                  syncLeafCategoryPayloadFields(payload, leafCatId);
                  console.error(`[selfRepair] New category: leaf=${leafCatId}, depth=${depth}`);
              const newProps = await getCategoryProperties(page, leafCatId, params.title || "", getCategoryPathText(catIds));
                  if (newProps && newProps.length > 0) payload.productPropertyReqs = newProps;
                  needResubmit = true;
                  found = true;
                } else {
                  console.error(`[selfRepair] Same/shallow category (depth=${depth}), trying next term...`);
                }
              }
            }
            if (!found) {
              const knownBranchMatch = await resolveKnownCategoryBranchFallback(page, searchTerms, params.title || "");
              if (knownBranchMatch?.leafCatId) {
                catIds = { ...(knownBranchMatch.catIds || catIds) };
                if (knownBranchMatch.path) catIds._path = knownBranchMatch.path;
                leafCatId = Number(knownBranchMatch.leafCatId) || leafCatId;
                for (let i = 1; i <= 10; i += 1) {
                  payload[`cat${i}Id`] = Number(catIds[`cat${i}Id`]) || 0;
                }
                syncLeafCategoryPayloadFields(payload, leafCatId);
            const newProps = await getCategoryProperties(page, leafCatId, params.title || "", getCategoryPathText(catIds));
                if (newProps && newProps.length > 0) payload.productPropertyReqs = newProps;
                console.error(`[selfRepair] Known branch fallback category: ${knownBranchMatch.path || leafCatId}`);
                needResubmit = true;
                found = true;
              }
            }
            break;
          }
          case "fix_packaging": {
            payload.productOuterPackageReq = { packageShape: 1, packageType: 0 };
            console.error(`[selfRepair] fix_packaging: set default packaging`);
            needResubmit = true;
            break;
          }
          case "retry_spec": {
            if (workflowQuantitySpecConfig) {
              console.error("[selfRepair] retry_spec skipped: workflow quantity SKU uses two parent specs");
              break;
            }
            console.error(`[selfRepair] retry_spec: re-querying spec...`);
            await page.goto(page.url(), { waitUntil: "domcontentloaded" });
            await randomDelay(2000, 3000);
            // 重新获取规格
            const newSpec = await getCategorySpec(page, leafCatId);
            if (newSpec) {
              const retrySpecCandidates = buildSpecNameCandidates(params.title || "", params.specName);
              for (const newSpecName of retrySpecCandidates) {
                const newSpecResult = await temuXHR(
                  page,
                  config.specQueryEndpoint,
                  { parentSpecId: newSpec.parentSpecId, specName: newSpecName },
                  { maxRetries: 1 },
                );
                if (newSpecResult.success && newSpecResult.data?.specId) {
                  const sid = newSpecResult.data.specId;
                  // 更新 payload 中所有 spec 相关字段
                  payload.productSpecPropertyReqs = [{ ...payload.productSpecPropertyReqs[0], parentSpecId: newSpec.parentSpecId, parentSpecName: newSpec.parentSpecName, specId: sid, specName: newSpecName, propName: newSpec.parentSpecName, propValue: newSpecName }];
                  payload.productSkcReqs[0].productSkuReqs[0].productSkuSpecReqs = [{ parentSpecId: newSpec.parentSpecId, parentSpecName: newSpec.parentSpecName, specId: sid, specName: newSpecName, specLangSimpleList: [] }];
                  console.error(`[selfRepair] New spec: ${newSpec.parentSpecName}=${newSpecName} id=${sid}`);
                  needResubmit = true;
                  break;
                }
              }
            }
            break;
          }
          default:
            console.error(`[selfRepair] Unknown action: ${action.type}`);
        }
      }

      if (!needResubmit) {
        console.error(`[selfRepair] No effective repair action, stopping`);
        break;
      }

      console.error(`[selfRepair] Re-submitting draft after repair...`);
      result = await temuXHR(page, submitEndpoint, payload, { maxRetries: 1 });
    }

    if (result.success) {
      const draftId = result.data?.productDraftId || result.data?.draftId || result.data?.productId || 0;
      console.error(`[api-create] SUCCESS! draftId=${draftId}`);
      if (!draftId) {
        return {
          success: false,
          message: "Temu 返回成功，但未拿到 draftId",
          step: "draft_create",
          draftSaved: false,
        };
      }
      const savePayload = {
        ...payload,
        productDraftId: draftId,
        draftId,
      };
      console.error(`[api-create] Saving draft content to ${config.draftSaveEndpoint}...`);
      const saveResult = await temuXHR(page, config.draftSaveEndpoint, savePayload, { maxRetries: 1 });
      if (!saveResult.success) {
        const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
        fs.mkdirSync(debugDir, { recursive: true });
        const debugFile = path.join(debugDir, `draft_save_failed_${Date.now()}.json`);
        fs.writeFileSync(debugFile, JSON.stringify({
          params: { title: params.title, price: params.price, categorySearch: params.categorySearch },
          payload: savePayload,
          response: saveResult.raw || saveResult,
          draftId,
        }, null, 2));
        console.error(`[api-create] Draft save failed, details saved to: ${debugFile}`);
        return {
          success: false,
          message: saveResult.errorMsg || "Temu 草稿内容保存失败",
          step: "draft_save",
          draftId,
          draftSaved: false,
          debugFile,
          uploadedImageUrls: imageUrls,
        };
      }
      result = saveResult;
      const verification = await verifyDraftPersistedContent(page, draftId, {
        logPrefix: "[draft-verify]",
        expectedQuantitySkuImages: params.workflowQuantitySpecs ? params.quantitySkuImages : null,
        expectedQuantityCounts: params.workflowQuantitySpecs ? (params.quantityCounts || [1, 2, 3, 4]) : null,
        expectedRandomSpecValueCount: params.workflowQuantitySpecs ? (params.workflowRandomSpecValueCount || 2) : null,
        expectedMainImageMin: params.expectedMainImageMin || 0,
        expectWorkflowQuantitySkuRequiredFields: Boolean(params.workflowQuantitySpecs),
      }).catch((error) => ({
        ok: false,
        reason: "verify_error",
        error: error?.message || String(error),
        summary: { hasTitle: false, hasImages: false, hasSpecs: false },
      }));
      await saveCookies();
      if (!verification?.ok) {
        const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
        fs.mkdirSync(debugDir, { recursive: true });
        const debugFile = path.join(debugDir, `draft_verify_failed_${Date.now()}.json`);
        fs.writeFileSync(debugFile, JSON.stringify({
          params: { title: params.title, price: params.price, categorySearch: params.categorySearch },
          payload,
          response: result.data,
          verification,
        }, null, 2));
        console.error(`[api-create] Draft verification failed, details saved to: ${debugFile}`);
        const verifyMessage = verification?.reason === "quantity_sku_image_mismatch"
          ? "草稿已创建，但数量SKU图片未按1PC/2PC/3PC/4PC保存"
          : (verification?.reason === "workflow_spec_matrix_mismatch"
            ? "草稿已创建，但父规格1双子规格或数量规格未完整保存"
            : (verification?.reason === "workflow_sku_required_fields_missing" || verification?.reason === "workflow_sku_dom_required_fields_missing"
              ? "草稿已创建，但SKU必填项未完整保存"
              : (verification?.reason === "main_image_count_insufficient"
                ? "草稿已创建，但主图未达到5张"
                : "草稿箱只创建了空白草稿，标题/图片未真正保存")));
        return {
          success: false,
          message: verifyMessage,
          step: "draft_verify",
          productId: result.data?.productId,
          draftId,
          result: result.data,
          draftSaved: true,
          verificationReason: verification?.reason || "",
          debugFile,
          verification,
          uploadedImageUrls: imageUrls,
        };
      }
      return {
        success: true,
        message: params.workflowQuantitySpecs
          ? "商品已保存到Temu草稿箱（已校验标题、5张主图、父规格1双值、数量SKU图片和SKU必填项）"
          : "商品已保存到Temu草稿箱（已校验标题和图片）",
        productId: result.data?.productId,
        draftId,
        skcId: result.data?.productSkcList?.[0]?.productSkcId,
        skuId: result.data?.productSkuList?.[0]?.productSkuId,
        result: result.data,
        draftSaved: true,
        verification,
      };
    } else {
      console.error(`[api-create] Failed: ${result.errorCode} - ${result.errorMsg}`);

      // 保存失败的 payload 用于调试
      const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
      fs.mkdirSync(debugDir, { recursive: true });
      const debugFile = path.join(debugDir, `failed_payload_${Date.now()}.json`);
      fs.writeFileSync(debugFile, JSON.stringify({ params: { title: params.title, price: params.price, categorySearch: params.categorySearch }, payload, response: result.raw }, null, 2));
      console.error(`[api-create] Debug payload saved to: ${debugFile}`);

      return {
        success: false,
        message: result.errorMsg || "保存Temu草稿箱失败",
        errorCode: result.errorCode,
        step: "submit",
        debugFile,
        draftSaved: false,
        uploadedImageUrls: imageUrls,
      };
    }

  } finally {
    if (!params.keepOpen) await page.close();
  }
}

/**
 * 批量 API 核价
 * @param {Object} params
 * @param {string} params.csvPath - CSV 文件路径
 * @param {number} [params.startRow=0] - 起始行号（0-based）
 * @param {number} [params.count=1] - 处理数量
 * @param {number} [params.intervalMin=0.15] - 最小间隔（分钟）
 * @param {number} [params.intervalMax=0.3] - 最大间隔（分钟）
 * @param {string[]} [params.defaultImageUrls] - 默认图片 URL 列表（CSV 中无图时使用）
 * @param {boolean} [params.generateAI=true] - 是否 AI 生成图片
 * @param {Object} [params.config] - 覆盖 PRICING_CONFIG
 *
 * CSV 列：商品名称, 商品原图, 分类（中文）, 美元价格
 * 也支持：imageUrls（多图，用 | 分隔）, 分类关键词
 */
async function batchCreateViaAPI(params) {
  console.error("[batch-api] Starting batch API creation...");
  const csvPath = params.csvPath;
  if (!csvPath || !fs.existsSync(csvPath)) {
    return { success: false, message: "CSV文件不存在: " + csvPath };
  }

  const csvContent = fs.readFileSync(csvPath, "utf8");
  const lines = csvContent.split("\n").filter(l => l.trim());
  const headers = lines[0];
  const headerCols = headers.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
  const startRow = params.startRow || 0;
  const count = params.count || 1;
  const intervalMin = normalizeIntervalMinutes(params.intervalMin, DEFAULT_PRODUCT_INTERVAL_MIN);
  const intervalMaxRaw = normalizeIntervalMinutes(params.intervalMax, DEFAULT_PRODUCT_INTERVAL_MAX);
  const intervalMax = Math.max(intervalMin, intervalMaxRaw);
  const results = [];

  // 解析CSV列（支持多种列名）
  const colIndex = (names) => {
    for (const name of names) {
      const idx = headerCols.findIndex(c => c.includes(name));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const exactColIndex = (patterns) => headerCols.findIndex((columnName) => patterns.some((pattern) => pattern.test(columnName)));
  const nameIdx = colIndex(["商品名称", "title", "productName", "name"]);
  const imageIdx = colIndex(["商品原图", "image", "imageUrl", "图片"]);
  const imagesIdx = colIndex(["imageUrls", "多图", "images"]); // 多图列（用 | 分隔）
  const frontCatIdx = colIndex(["前台分类（中文）"]);
  const backCatIdx = colIndex(["后台分类"]);
  const genericCatIdx = colIndex(["分类（中文）", "分类关键词", "category", "分类"]);
  const priceIdx = colIndex(["美元价格", "price", "价格", "USD"]);
  const priceCnyIdx = colIndex(["人民币价格", "priceCNY", "申报价"]);
  const directLeafCatIdx = exactColIndex([/^leafCatId$/i, /^leafCategoryId$/i, /^catId$/i, /^categoryId$/i, /^叶子类目ID$/i]);
  const catIdsJsonIdx = exactColIndex([/^catIds$/i, /^categoryIds$/i]);
  const goodsIdIdx = exactColIndex([/^商品ID$/i, /^goodsId$/i, /^goods_id$/i]);
  const productIdIdx = exactColIndex([/^productId$/i, /^spuId$/i, /^SPU ID$/i]);
  const productSkcIdIdx = exactColIndex([/^productSkcId$/i, /^skcId$/i, /^SKC ID$/i]);
  const catIdColumnIndexes = {};
  const catNameColumnIndexes = {};
  for (let level = 1; level <= 10; level += 1) {
    const catIdIdx = exactColIndex([new RegExp(`^cat${level}Id$`, "i")]);
    const catNameIdx = exactColIndex([new RegExp(`^cat${level}Name$`, "i")]);
    if (catIdIdx >= 0) catIdColumnIndexes[`cat${level}Id`] = catIdIdx;
    if (catNameIdx >= 0) catNameColumnIndexes[`cat${level}Name`] = catNameIdx;
  }

  console.error(`[batch-api] Columns: name=${nameIdx}, image=${imageIdx}, images=${imagesIdx}, frontCat=${frontCatIdx}, backCat=${backCatIdx}, genericCat=${genericCatIdx}, leafCat=${directLeafCatIdx}, price=${priceIdx}, priceCNY=${priceCnyIdx}`);

  function parseCSVLine(line) {
    const result = [];
    let current = "", inQuotes = false;
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ""; }
      else current += ch;
    }
    result.push(current.trim());
    return result;
  }

  const total = Math.max(0, Math.min(count, lines.length - 1 - startRow));
  console.error(`[batch-api] Processing ${total} products (rows ${startRow}-${startRow + total - 1})`);

  for (let i = startRow; i < startRow + total; i++) {
    const cols = parseCSVLine(lines[i + 1]);
    const productName = (nameIdx >= 0 ? cols[nameIdx] : "") || "";
    const frontCategoryCn = normalizeCategoryText((frontCatIdx >= 0 ? cols[frontCatIdx] : "") || "");
    const backCategoryCn = normalizeCategoryText((backCatIdx >= 0 ? cols[backCatIdx] : "") || "");
    const genericCategoryCn = normalizeCategoryText((genericCatIdx >= 0 ? cols[genericCatIdx] : "") || "");
    const preferredCategoryCn = backCategoryCn || genericCategoryCn || frontCategoryCn;
    const priceUSD = priceIdx >= 0 ? normalizePriceNumber(cols[priceIdx], 0) : 0;
    const priceCNY = priceCnyIdx >= 0 ? normalizePriceNumber(cols[priceCnyIdx], 0) : (priceUSD > 0 ? priceUSD * 7 : 9.99);
    const sourceProductId = goodsIdIdx >= 0 ? normalizeHistoryIdentifier(cols[goodsIdIdx]) : "";
    const sourceSpuId = productIdIdx >= 0 ? normalizeHistoryIdentifier(cols[productIdIdx]) : "";
    const sourceSkcId = productSkcIdIdx >= 0 ? normalizeHistoryIdentifier(cols[productSkcIdIdx]) : "";
    const directLeafCatId = directLeafCatIdx >= 0 ? (Number(cols[directLeafCatIdx]) || 0) : 0;
    const directCatIds = parseCategoryIdsCell(catIdsJsonIdx >= 0 ? cols[catIdsJsonIdx] : "") || {};
    for (const [key, idx] of Object.entries(catIdColumnIndexes)) {
      const nextId = Number(cols[idx]) || 0;
      if (nextId > 0) directCatIds[key] = nextId;
    }
    for (const [key, idx] of Object.entries(catNameColumnIndexes)) {
      const nextName = String(cols[idx] || "").trim();
      if (nextName) directCatIds[key] = nextName;
    }
    if (!directCatIds._path && (backCategoryCn || preferredCategoryCn)) {
      directCatIds._path = backCategoryCn || preferredCategoryCn;
    }

    // 图片处理：优先多图列，否则单图列，最后用默认图
    let imageUrls = [];
    if (imagesIdx >= 0 && cols[imagesIdx]) {
      imageUrls = cols[imagesIdx].split("|").map(u => u.trim()).filter(Boolean);
    } else if (imageIdx >= 0 && cols[imageIdx]) {
      imageUrls = [cols[imageIdx].trim()];
    }

    // 如果只有 1 张或没有图，尝试用 AI 生成或用默认图补齐
    if (imageUrls.length === 0 && params.defaultImageUrls?.length > 0) {
      imageUrls = [...params.defaultImageUrls];
    }

    const itemNum = i - startRow + 1;
    console.error(`\n[batch-api] === ${itemNum}/${total}: ${productName.slice(0, 40)} ¥${priceCNY.toFixed(2)} imgs=${imageUrls.length} ===`);

    // 如果只有外部图片 URL（非 kwcdn），需要下载后用 AI 生成
    let sourceImage = null;
    if (imageUrls.length > 0 && !imageUrls[0].includes("kwcdn.com") && imageUrls[0].startsWith("http")) {
      try {
        const imgResp = await fetch(imageUrls[0]);
        const imgBuf = Buffer.from(await imgResp.arrayBuffer());
        const imgDir = path.join(process.env.APPDATA || "", "temu-automation", "ai-images");
        fs.mkdirSync(imgDir, { recursive: true });
        sourceImage = path.join(imgDir, `csv_${i}_${Date.now()}.jpg`);
        fs.writeFileSync(sourceImage, imgBuf);
        imageUrls = []; // 清空，让 createProductViaAPI 用 AI 生成
        console.error(`[batch-api] Source image downloaded for AI generation`);
      } catch (e) {
        console.error(`[batch-api] Image download failed: ${e.message}`);
      }
    }

    try {
      // 任一表格类目存在即 strict，避免被启发式 fallback 带偏（同 autoPricingFromCSV）
      const categoryLockMode = (
        directLeafCatId > 0
        || Object.keys(directCatIds).some((key) => key !== "_path")
        || Boolean(backCategoryCn)
        || Boolean(genericCategoryCn)
        || Boolean(frontCategoryCn)
      )
        ? "strict"
        : "guided";
      const createParams = {
        title: productName,
        price: priceCNY,
        categorySearch: categoryLockMode === "guided"
          ? productName
          : (preferredCategoryCn || productName),
        categorySearchVariants: categoryLockMode === "strict"
          ? [backCategoryCn, genericCategoryCn, frontCategoryCn].map((value) => normalizeCategoryText(value)).filter(Boolean)
          : buildGuidedCategorySearchVariants(
              productName,
              "",
              backCategoryCn,
            ),
        categoryLockMode,
        keepOpen: false,
        config: params.config,
        sourceProductId,
        goodsId: sourceProductId || undefined,
        productId: sourceSpuId || undefined,
        productSkcId: sourceSkcId || undefined,
      };
      if (directLeafCatId > 0) createParams.leafCatId = directLeafCatId;
      if (Object.keys(directCatIds).length > 0) createParams.catIds = directCatIds;

      // 图片来源：已有 kwcdn URLs 或 AI 生成
      if (imageUrls.length > 0) {
        createParams.imageUrls = imageUrls;
      } else if (sourceImage) {
        createParams.sourceImage = sourceImage;
        createParams.generateAI = params.generateAI !== false;
        createParams.aiImageTypes = params.aiImageTypes || AI_DETAIL_IMAGE_TYPE_ORDER;
      } else if (params.defaultImageUrls?.length > 0) {
        createParams.imageUrls = params.defaultImageUrls;
      } else {
        results.push({ index: i, name: productName.slice(0, 40), success: false, message: "无可用图片" });
        console.error(`[batch-api] SKIP: no images available`);
        continue;
      }

      let result = await createProductViaAPI(createParams);

      // 失败自动重试（不重新生成图片，复用已上传的图片）
      if (!result.success && result.errorCode === 6000002) {
        console.error(`[batch-api] RETRY: 6000002 error, retrying with same images...`);
        await randomDelay(2000, 3000);

        // 重试时用已有图片URL，不重新生成AI图
        const retryParams = { ...createParams };
        if (result.uploadedImageUrls?.length > 0) {
          retryParams.imageUrls = result.uploadedImageUrls;
          delete retryParams.sourceImage;
          delete retryParams.generateAI;
        }
        result = await createProductViaAPI(retryParams);
        if (!result.success && retryParams.categoryLockMode !== "strict") {
          console.error(`[batch-api] RETRY 2: trying different category...`);
          await randomDelay(1000, 2000);
          // 第二次重试：用商品标题搜索分类
          const retryParams2 = { ...retryParams, categorySearch: productName.slice(0, 20) };
          result = await createProductViaAPI(retryParams2);
        }
      }

      results.push({ index: i, name: productName.slice(0, 40), productId: result.productId, ...result });
      console.error(`[batch-api] ${result.success ? "OK productId=" + result.productId : "FAIL: " + result.message}`);
    } catch (e) {
      // ERR_ABORTED / frame detached / CONNECTION_RESET 等网络瞬断，自动重试一次
      const isRetryable = /ERR_ABORTED|frame was detached|CONNECTION_RESET|ECONNRESET|net::/i.test(e.message);
      if (isRetryable) {
        console.error(`[batch-api] NETWORK ERROR, retrying once: ${e.message}`);
        await randomDelay(3000, 5000);
        try {
          const retryResult = await createProductViaAPI(createParams);
          results.push({ index: i, name: productName.slice(0, 40), productId: retryResult.productId, ...retryResult });
          console.error(`[batch-api] RETRY ${retryResult.success ? "OK productId=" + retryResult.productId : "FAIL: " + retryResult.message}`);
        } catch (e2) {
          results.push({ index: i, name: productName.slice(0, 40), success: false, message: e2.message });
          console.error(`[batch-api] RETRY ERROR: ${e2.message}`);
        }
      } else {
        results.push({ index: i, name: productName.slice(0, 40), success: false, message: e.message });
        console.error(`[batch-api] ERROR: ${e.message}`);
      }
    }

    // 间隔控制
    if (itemNum < total) {
      const waitMin = intervalMin + Math.random() * (intervalMax - intervalMin);
      console.error(`[batch-api] Progress: ${itemNum}/${total} (${results.filter(r => r.success).length} ok). Next in ${waitMin.toFixed(1)}min...`);
      await new Promise(r => setTimeout(r, waitMin * 60000));
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failedItems = results.filter(r => !r.success);
  console.error(`\n[batch-api] Completed: ${successCount}/${results.length} succeeded`);

  // 保存结果
  const debugDir = path.join(process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming", "temu-automation", "debug");
  fs.mkdirSync(debugDir, { recursive: true });
  const resultFile = path.join(debugDir, `batch_result_${Date.now()}.json`);
  fs.writeFileSync(resultFile, JSON.stringify({ total: results.length, successCount, failCount: failedItems.length, results }, null, 2));
  console.error(`[batch-api] Results saved to: ${resultFile}`);

  return { success: true, total: results.length, successCount, failCount: failedItems.length, results, failedItems, resultFile };
}

// 全局进度追踪
function getProgressTimestamp() {
  return new Date().toLocaleString("zh-CN");
}

function summarizeProgressResults(results) {
  const list = Array.isArray(results) ? results : [];
  const successCount = list.filter((item) => item?.success).length;
  return {
    successCount,
    failCount: list.length - successCount,
  };
}

function createProgressState(patch = {}) {
  const results = Array.isArray(patch.results) ? [...patch.results] : [];
  const summary = summarizeProgressResults(results);
  return {
    taskId: typeof patch.taskId === "string" ? patch.taskId : "",
    flowType: typeof patch.flowType === "string" ? patch.flowType : "",
    running: Boolean(patch.running),
    paused: Boolean(patch.paused),
    status: typeof patch.status === "string" ? patch.status : "idle",
    total: Number(patch.total) || 0,
    completed: Number(patch.completed) || 0,
    current: typeof patch.current === "string" ? patch.current : "",
    step: typeof patch.step === "string" ? patch.step : "",
    results,
    successCount: summary.successCount,
    failCount: summary.failCount,
    message: typeof patch.message === "string" ? patch.message : "",
    csvPath: typeof patch.csvPath === "string" ? patch.csvPath : "",
    startRow: Number(patch.startRow) || 0,
    count: Number(patch.count) || 0,
    createdAt: typeof patch.createdAt === "string" ? patch.createdAt : "",
    startedAt: typeof patch.startedAt === "string" ? patch.startedAt : "",
    updatedAt: typeof patch.updatedAt === "string" ? patch.updatedAt : "",
    finishedAt: typeof patch.finishedAt === "string" ? patch.finishedAt : "",
  };
}

const PROGRESS_HISTORY_LIMIT = 10;
let currentProgress = createProgressState();
let progressHistory = [];
let pricingPaused = false;  // 暂停标志

function shouldTrackProgressSnapshot(task) {
  return Boolean(
    task?.taskId
    || task?.running
    || task?.paused
    || task?.completed
    || (Array.isArray(task?.results) && task.results.length > 0)
    || (typeof task?.status === "string" && task.status !== "idle")
  );
}

function rememberProgressSnapshot(task) {
  if (!shouldTrackProgressSnapshot(task)) return;
  const snapshot = createProgressState(task);
  progressHistory = [
    snapshot,
    ...progressHistory.filter((item) => item?.taskId !== snapshot.taskId),
  ].slice(0, PROGRESS_HISTORY_LIMIT);
}

function replaceCurrentProgress(patch = {}) {
  currentProgress = createProgressState(patch);
  rememberProgressSnapshot(currentProgress);
  return currentProgress;
}

function getProgressSnapshot(taskId) {
  if (taskId) {
    if (currentProgress.taskId === taskId) return currentProgress;
    return progressHistory.find((item) => item?.taskId === taskId) || createProgressState({ taskId });
  }
  return currentProgress;
}

function listProgressSnapshots() {
  if (!shouldTrackProgressSnapshot(currentProgress)) {
    return [...progressHistory];
  }
  return [
    currentProgress,
    ...progressHistory.filter((item) => item?.taskId !== currentProgress.taskId),
  ].slice(0, PROGRESS_HISTORY_LIMIT);
}

function updateCurrentProgress(patch = {}) {
  const nextResults = Array.isArray(patch.results) ? [...patch.results] : currentProgress.results;
  const summary = summarizeProgressResults(nextResults);
  currentProgress = {
    ...currentProgress,
    ...patch,
    results: nextResults,
    successCount: summary.successCount,
    failCount: summary.failCount,
    updatedAt: typeof patch.updatedAt === "string" ? patch.updatedAt : getProgressTimestamp(),
  };
  rememberProgressSnapshot(currentProgress);
  return currentProgress;
}

function syncCurrentProgressResults(results, patch = {}) {
  return updateCurrentProgress({
    ...patch,
    completed: Array.isArray(results) ? results.length : currentProgress.completed,
    results: Array.isArray(results) ? [...results] : currentProgress.results,
  });
}

function isCurrentProgressTask(taskId) {
  return !taskId || !currentProgress.taskId || currentProgress.taskId === taskId;
}

// ---- 浏览器扩展 feed（免鉴权，localhost-only）----
// 持久化到磁盘：append-only JSONL，启动时读回内存，重启不丢
const EXT_FEED_MAX = 1000;
const EXT_FEED_REWRITE_THRESHOLD = Math.floor(EXT_FEED_MAX * 1.5); // 文件行数超过此值就压缩重写
const EXT_FEED_FILE = path.join(
  process.env.APPDATA || "C:/Users/Administrator/AppData/Roaming",
  "temu-automation",
  "ext-feed.jsonl",
);
const extFeedBuffer = [];
let extFeedAppendedSinceRewrite = 0;

function ensureExtFeedDir() {
  try {
    const dir = path.dirname(EXT_FEED_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

function loadExtFeedFromDisk() {
  try {
    if (!fs.existsSync(EXT_FEED_FILE)) return;
    const raw = fs.readFileSync(EXT_FEED_FILE, "utf8");
    if (!raw) return;
    const lines = raw.split("\n");
    let parsed = 0;
    // 只保留最后 EXT_FEED_MAX 行有效数据
    const tail = lines.slice(-EXT_FEED_MAX - 100);
    for (const line of tail) {
      const s = line.trim();
      if (!s) continue;
      try {
        const obj = JSON.parse(s);
        extFeedBuffer.push(obj);
        parsed += 1;
      } catch {}
    }
    if (extFeedBuffer.length > EXT_FEED_MAX) {
      extFeedBuffer.splice(0, extFeedBuffer.length - EXT_FEED_MAX);
    }
    console.log(`[ext-feed] loaded ${parsed} entries from disk (buffer=${extFeedBuffer.length})`);
    // 文件行数太多则立刻压缩
    if (lines.length > EXT_FEED_REWRITE_THRESHOLD) rewriteExtFeedFile();
  } catch (e) {
    console.warn("[ext-feed] load failed:", e?.message || e);
  }
}

function rewriteExtFeedFile() {
  try {
    ensureExtFeedDir();
    const tmp = EXT_FEED_FILE + ".tmp";
    const content = extFeedBuffer.map((e) => JSON.stringify(e)).join("\n") + (extFeedBuffer.length ? "\n" : "");
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, EXT_FEED_FILE);
    extFeedAppendedSinceRewrite = 0;
  } catch (e) {
    console.warn("[ext-feed] rewrite failed:", e?.message || e);
  }
}

function appendExtFeedToDisk(entry) {
  try {
    ensureExtFeedDir();
    fs.appendFileSync(EXT_FEED_FILE, JSON.stringify(entry) + "\n", "utf8");
    extFeedAppendedSinceRewrite += 1;
    // 阈值到了就压缩（保证文件不会无限膨胀）
    if (extFeedBuffer.length + extFeedAppendedSinceRewrite > EXT_FEED_REWRITE_THRESHOLD) {
      rewriteExtFeedFile();
    }
  } catch (e) {
    console.warn("[ext-feed] append failed:", e?.message || e);
  }
}

function pushExtFeed(entry) {
  const record = { ...entry, receivedAt: Date.now() };
  extFeedBuffer.push(record);
  if (extFeedBuffer.length > EXT_FEED_MAX) {
    extFeedBuffer.splice(0, extFeedBuffer.length - EXT_FEED_MAX);
  }
  appendExtFeedToDisk(record);
}

export function getExtFeedSnapshot() {
  return extFeedBuffer.slice();
}

// 启动时立刻从磁盘恢复
loadExtFeedFromDisk();

// ---- 对比候选池（扩展浮层"加入对比列表"写入，前端读取）----
const EXT_COMPARE_QUEUE_FILE = path.join(path.dirname(EXT_FEED_FILE), "ext-compare-queue.jsonl");
const MINE_GOODS_FILE = path.join(path.dirname(EXT_FEED_FILE), "mine-goods.json");
const extCompareQueue = [];
const extCompareIds = new Set();
const mineGoodsSet = new Set();

function loadMineGoods() {
  try {
    if (!fs.existsSync(MINE_GOODS_FILE)) return;
    const raw = fs.readFileSync(MINE_GOODS_FILE, "utf8");
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const x of arr) {
        const id = String(x || "").trim();
        if (id) mineGoodsSet.add(id);
      }
    }
  } catch (e) {
    console.warn("[mine-goods] load failed:", e?.message || e);
  }
}

function saveMineGoods() {
  try {
    ensureExtFeedDir();
    fs.writeFileSync(MINE_GOODS_FILE, JSON.stringify(Array.from(mineGoodsSet), null, 2), "utf8");
  } catch (e) {
    console.warn("[mine-goods] save failed:", e?.message || e);
  }
}

function isMineGoods(goodsId) {
  return mineGoodsSet.has(String(goodsId || ""));
}

function setMineGoods(goodsId, isMine) {
  const id = String(goodsId || "").trim();
  if (!id) return false;
  const was = mineGoodsSet.has(id);
  if (isMine) mineGoodsSet.add(id); else mineGoodsSet.delete(id);
  if (was === isMine) return false;
  saveMineGoods();
  // 回洗候选池里这条记录的 kind
  const exist = extCompareQueue.find((e) => String(e.goodsId) === id);
  if (exist) {
    exist.kind = isMine ? "mine" : "competitor";
    rewriteExtCompareQueueFile();
  }
  return true;
}

loadMineGoods();

function loadExtCompareQueue() {
  try {
    if (!fs.existsSync(EXT_COMPARE_QUEUE_FILE)) return;
    const raw = fs.readFileSync(EXT_COMPARE_QUEUE_FILE, "utf8");
    for (const line of raw.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try {
        const obj = JSON.parse(s);
        const id = String(obj?.goodsId || "");
        if (!id || extCompareIds.has(id)) continue;
        extCompareIds.add(id);
        extCompareQueue.push(obj);
      } catch {}
    }
  } catch (e) {
    console.warn("[ext-queue] load failed:", e?.message || e);
  }
}
loadExtCompareQueue();

// ---- N 家横向对比聚类：我的商品 vs 多家竞品 ----
const COMPARE_INSIGHTS_FILE = path.join(path.dirname(EXT_FEED_FILE), "compare-insights.json");
let compareInsightsCache = null;
function loadCompareInsights() {
  try {
    if (!fs.existsSync(COMPARE_INSIGHTS_FILE)) return;
    compareInsightsCache = JSON.parse(fs.readFileSync(COMPARE_INSIGHTS_FILE, "utf8"));
  } catch (e) {
    console.warn("[compare-insights] load failed:", e?.message || e);
  }
}
function saveCompareInsights(obj) {
  try {
    ensureExtFeedDir();
    fs.writeFileSync(COMPARE_INSIGHTS_FILE, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.warn("[compare-insights] save failed:", e?.message || e);
  }
}
loadCompareInsights();

function _collectReviews(entries, ratingFilter, perGoodsLimit = 40, overallLimit = 80) {
  const out = [];
  for (const g of entries) {
    const reviews = Array.isArray(g.reviews) ? g.reviews : [];
    let taken = 0;
    for (const r of reviews) {
      if (!r || typeof r.text !== "string") continue;
      const text = r.text.trim();
      if (text.length < 10) continue;
      const rating = Number(r.rating || 0);
      if (!ratingFilter(rating)) continue;
      out.push({ goodsId: g.goodsId, rating, text: text.slice(0, 400) });
      taken++;
      if (taken >= perGoodsLimit) break;
    }
  }
  // 如果总量超过 overallLimit，均匀采样而非简单截断（保留多商品覆盖）
  if (out.length <= overallLimit) return out;
  const step = out.length / overallLimit;
  const picked = [];
  for (let i = 0; i < overallLimit; i++) picked.push(out[Math.floor(i * step)]);
  return picked;
}

function _fmtReviews(arr) {
  return arr
    .map((r, i) => `[${i + 1}] goods=${r.goodsId} ★${r.rating} | ${r.text.replace(/\s+/g, " ")}`)
    .join("\n");
}

// 本地确定性统计：价格带分位数
function _computePriceStats(competitors, myPrice) {
  const prices = [];
  for (const c of competitors) {
    const p = Number(c.price);
    if (Number.isFinite(p) && p > 0) prices.push(p);
  }
  prices.sort((a, b) => a - b);
  const q = (arr, r) => {
    if (!arr.length) return null;
    if (arr.length === 1) return arr[0];
    const pos = (arr.length - 1) * r;
    const base = Math.floor(pos);
    const rest = pos - base;
    const nxt = arr[base + 1];
    return nxt !== undefined ? arr[base] + rest * (nxt - arr[base]) : arr[base];
  };
  let symbol = "";
  for (const c of competitors) {
    const cur = String(c.currency || "").toUpperCase();
    if (cur === "USD") { symbol = "$"; break; }
    if (cur === "GBP") { symbol = "£"; break; }
    if (cur === "EUR") { symbol = "€"; break; }
    if (cur === "JPY") { symbol = "¥"; break; }
  }
  if (!symbol) {
    for (const c of competitors) {
      const m = String(c.priceText || "").match(/[$£€¥]/);
      if (m) { symbol = m[0]; break; }
    }
  }
  const my = Number(myPrice);
  return {
    symbol,
    sampleSize: prices.length,
    min: prices[0] ?? null,
    p25: q(prices, 0.25),
    p50: q(prices, 0.5),
    p75: q(prices, 0.75),
    max: prices[prices.length - 1] ?? null,
    myPrice: Number.isFinite(my) && my > 0 ? my : null,
  };
}

// 本地确定性统计：视频覆盖率（基于 galleryUrls 后缀推断）
function _computeVideoStats(mineItems, competitorItems) {
  const looksLikeVideo = (u) => /\.(mp4|m3u8|mov|webm)(?:\?|#|$)/i.test(String(u || ""));
  const hasVideoInRecord = (e) => {
    if (e?.hasVideo === true) return true;
    if (e?.videoUrl) return true;
    const gal = Array.isArray(e?.galleryUrls) ? e.galleryUrls : [];
    return gal.some(looksLikeVideo);
  };
  const myHasVideo = mineItems.some(hasVideoInRecord);
  const withVideo = competitorItems.filter(hasVideoInRecord).length;
  return {
    myHasVideo,
    competitorCount: competitorItems.length,
    competitorWithVideoCount: withVideo,
    competitorVideoRate: competitorItems.length ? withVideo / competitorItems.length : 0,
  };
}

async function analyzeCompareQueue() {
  const mineItems = extCompareQueue.filter((e) => e.kind === "mine");
  const competitorItems = extCompareQueue.filter((e) => e.kind !== "mine");
  if (mineItems.length === 0) {
    return { ok: false, error: "候选池里没有「我的商品」。请先在候选池里把基准商品的 tag 切换为「我的」。" };
  }
  if (competitorItems.length === 0) {
    return { ok: false, error: "候选池里没有竞品。至少采集 1 个竞品后再分析。" };
  }

  const mineLow = _collectReviews(mineItems, (r) => r <= 3);
  const mineHigh = _collectReviews(mineItems, (r) => r >= 4);
  const compLow = _collectReviews(competitorItems, (r) => r <= 3);
  const compHigh = _collectReviews(competitorItems, (r) => r >= 4);

  if (mineLow.length + compLow.length < 5 && mineHigh.length + compHigh.length < 5) {
    return { ok: false, error: `评论样本太少（低分 ${mineLow.length + compLow.length}, 高分 ${mineHigh.length + compHigh.length}），至少需要 5 条有效评论` };
  }

  const client = getAiGeminiClient();
  if (!client) return { ok: false, error: "AI client unavailable（缺少 VECTORENGINE_API_KEY）" };

  // "最强形态"：降级链（pro → flash → flash-lite），大 token 上限，低温度
  // 记录实际命中的模型，供 UI 展示
  let lastSuccessModel = null;
  const isPermissionError = (e) => {
    const msg = String(e?.message || e?.response?.data || e);
    return /\b(403|404)\b|permission|no access|not (allowed|authorized)/i.test(msg);
  };
  async function callLlm(prompt, { chain = COMPARE_MODEL_CHAIN, maxTokens = 12000, temperature = 0.2 } = {}) {
    let lastErr = null;
    for (const model of chain) {
      const clientForModel = getAiClientForModel(model) || client;
      if (!clientForModel) {
        lastErr = new Error(`缺少可用的 AI client（model=${model}）`);
        continue;
      }
      try {
        const resp = await clientForModel.chat.completions.create({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature,
          max_tokens: maxTokens,
        });
        const content = resp?.choices?.[0]?.message?.content || "";
        const obj = extractJsonObjectLenient(content) || extractJsonObjectFromText(content);
        lastSuccessModel = model;
        return obj || { raw: String(content).slice(0, 4000) };
      } catch (e) {
        lastErr = e;
        if (!isPermissionError(e)) throw e; // 非权限错直接抛
        console.warn(`[compare-ai] model ${model} forbidden, trying next...`);
      }
    }
    throw lastErr || new Error("全部候选模型均无权限");
  }

  // 段 1：低分痛点对比（专业版）→ my_unique_pains + industry_common_pains
  const lowPrompt = `[OUTPUT MODE = RAW JSON ONLY] 直接以 { 开头，以 } 结束。禁止任何前言/解释/思考过程/markdown 代码块/\`\`\`json 围栏。不得出现除 JSON 以外的任何字符。

你是 Temu / DTC 品类运营资深分析师（10+ 年经验，精通品控、主图语言、详情页预期管理）。基于客户真实评论，为「我的商品」做一次差异化改进的专业分析。

方法论（必须严格遵守）：
1. 只基于提供的评论抽取证据，禁止脑补；每条结论必须至少引用 1 条可追溯的客户原文。
2. 严格区分「我方独有」（仅 A 频繁、B 未见或极少）与「行业共性」（A/B 都频繁）；共性问题不得出现在 my_unique_pains。
3. 归因分三类：产品侧（需改 SKU/物料）/ listing 侧（主图/标题/详情/尺码表）/ 运营侧（客服脚本、预期管理）。
4. 证据不足（< 2 条可引用原文）时 confidence 必须标 "low"，并在 root_cause 说明「样本薄弱，建议追加采集」。
5. 禁止空泛建议（"优化描述""提升品质"）。每条建议必须可 Sprint 直接执行。

【A】我的商品低分评论（${mineLow.length} 条）：
${_fmtReviews(mineLow) || "（无）"}

【B】竞品低分评论（来自 ${competitorItems.length} 个竞品，共 ${compLow.length} 条）：
${_fmtReviews(compLow) || "（无）"}

严格 JSON 输出（不加 markdown 代码块，不要任何解释文字）：
{
  "my_unique_pains": [
    {
      "label": "痛点主题（≤10 字）",
      "severity": "high|medium|low",
      "confidence": "high|medium|low",
      "frequency_in_mine": "A 里出现情况描述（如：A 共 8 条，其中 5 条提到）",
      "competitor_coverage": "B 里出现情况（未出现 / 极少 / 偶有）",
      "my_evidence": ["A 原文片段1（≤40 字）", "片段2", "片段3"],
      "root_cause": "归因：[产品侧|listing 侧|运营侧] + 一句话解释（≤50 字）",
      "actionable_fix": "总括性修正建议（≤50 字，保持向下兼容旧字段）",
      "fix_steps": ["第 1 步 具体动作（≤30 字）", "第 2 步", "第 3 步"],
      "expected_uplift": "预期影响（≤30 字，如：降低差评集中度 / 减少退货率 X%）",
      "priority_score": 1-10
    }
  ],
  "industry_common_pains": [
    {
      "label": "共性痛点（≤10 字）",
      "severity": "high|medium|low",
      "confidence": "high|medium|low",
      "evidence": ["A 或 B 原文1（≤40 字）", "另一条"],
      "expectation_mgmt": "详情页预期管理方案（≤50 字）",
      "main_image_hint": "主图可加的免责/提示元素（≤30 字）",
      "listing_copy_hint": "文案可加的句式（≤30 字）"
    }
  ]
}`;

  // 段 2：高分卖点缺口（专业版）→ competitor_selling_points_i_miss
  const highPrompt = `[OUTPUT MODE = RAW JSON ONLY] 直接以 { 开头，以 } 结束。禁止任何前言/解释/思考过程/markdown 代码块/\`\`\`json 围栏。不得出现除 JSON 以外的任何字符。

你是 Temu / DTC 品类运营资深分析师。从 B（竞品高分评论）里挖出「竞品在吹、A（我的商品）没吹或很少吹」的增量卖点，写成可直接上 listing 的中英 bullet + 主图 + 详情页建议。

方法论：
1. 只从 B 抽客户原话赞美点反推卖点；不要编造卖点。
2. gap_reason 三类归因：(a) 产品功能差异 → 我方确实没有 → 不虚假对标；(b) 产品有、listing 未强调 → 补上；(c) 使用场景/情绪价值 → 主图情景演绎补足。
3. 每个卖点必须同时给：中文 bullet / English bullet / 主图建议 / 详情页 section 建议 / 关键词种子。
4. 证据 < 2 条的卖点 confidence 必须标 "low"。
5. angle 明确划分：功能 / 情感 / 场景 / 质感 / 性价比。

【A】我的商品高分评论（${mineHigh.length} 条）：
${_fmtReviews(mineHigh) || "（无）"}

【B】竞品高分评论（来自 ${competitorItems.length} 个竞品，共 ${compHigh.length} 条）：
${_fmtReviews(compHigh) || "（无）"}

严格 JSON 输出：
{
  "competitor_selling_points_i_miss": [
    {
      "label": "卖点主题（≤10 字）",
      "angle": "功能|情感|场景|质感|性价比",
      "confidence": "high|medium|low",
      "priority_score": 1-10,
      "competitor_evidence": ["B 原文1（≤40 字）", "片段2", "片段3"],
      "competitor_mention_frequency": "在 B 里被提及的概况（如：3 个竞品各≥2 条）",
      "gap_reason": "缺口归因（产品差异 / listing 未强调 / 情境演绎不足） + 一句话",
      "listing_bullet_cn": "中文 bullet（≤18 字，直接上架）",
      "listing_bullet_en": "English bullet（≤18 words, copy-ready）",
      "main_image_suggestion": "主图/副图建议（≤50 字，具体到哪张、加什么元素）",
      "detail_section_suggestion": "详情页建议（≤50 字，具体到哪个 section、放什么内容）",
      "keyword_seeds_cn": ["中文关键词1", "关键词2"],
      "keyword_seeds_en": ["en keyword 1", "en keyword 2"]
    }
  ]
}`;

  // 本地先算好数值（确定性），再让 LLM 写定性建议
  const priceStats = _computePriceStats(competitorItems, mineItems[0]?.price);
  const videoStats = _computeVideoStats(mineItems, competitorItems);
  const fmtPrice = (n) => n == null ? "-" : `${priceStats.symbol}${Number(n).toFixed(2)}`;
  const videoPct = Math.round(videoStats.competitorVideoRate * 100);

  // 段 3：价格带 + 视频覆盖（专业版）
  const priceVideoPrompt = `[OUTPUT MODE = RAW JSON ONLY] 直接以 { 开头，以 } 结束。禁止任何前言/解释/思考过程/markdown 代码块/\`\`\`json 围栏。不得出现除 JSON 以外的任何字符。

你是 Temu 定价策略师 + 视频营销顾问。基于已算好的数值做两项专业定性分析。不要重新计算数字，只引用给定数值；不要输出模糊建议。

【我方商品】
${mineItems.map((m) => `- ${m.title || m.goodsId} / 价格: ${fmtPrice(m.price)}`).join("\n")}

【候选池价格分布】（有效样本 ${priceStats.sampleSize}）
- 最低 ${fmtPrice(priceStats.min)} / P25 ${fmtPrice(priceStats.p25)} / 中位 ${fmtPrice(priceStats.p50)} / P75 ${fmtPrice(priceStats.p75)} / 最高 ${fmtPrice(priceStats.max)}
- 我方价格: ${fmtPrice(priceStats.myPrice)}

【视频覆盖】
- 竞品总数: ${videoStats.competitorCount}，其中有视频: ${videoStats.competitorWithVideoCount}（${videoPct}%）
- 我方是否有视频: ${videoStats.myHasVideo ? "是" : "否"}

判定规则：
- 价格 tier：budget（< P25）/ mid（P25~P75）/ premium（> P75）/ unknown（样本 < 3）
- 视频 gap：竞品 ≥70% 有视频 & 我方没视频 → lagging；竞品 < 30% → leading；其他 → parity / unknown

严格 JSON 输出：
{
  "price_band_insight": {
    "tier": "budget|mid|premium|unknown",
    "headline": "一句话定位（≤32 字，必须引用具体价格数值）",
    "analysis": "3-5 句专业分析：引用 P25/中位/P75 对比，说明竞争格局、弹性空间、客户心理价位",
    "recommendation": "定性建议（≤100 字，涨/降/保持 + 理由 + 目标价区间）",
    "actionable": "一句话总括（≤50 字，保持向下兼容旧字段）",
    "action_checklist": ["步骤 1（≤35 字）", "步骤 2", "步骤 3"],
    "risks": ["风险 1（≤35 字）", "风险 2"]
  },
  "video_coverage_insight": {
    "gap": "lagging|parity|leading|unknown",
    "headline": "一句话（≤32 字，必须引用具体覆盖率）",
    "analysis": "3-5 句专业分析：视频对当前品类的重要性、竞争激烈度评估、不补的机会成本",
    "recommendation": "是否要补视频 + 优先级（≤100 字）",
    "actionable": "一句话总括（≤50 字，保持向下兼容旧字段）",
    "action_checklist": ["步骤 1（拍什么，≤35 字）", "步骤 2（时长/格式）", "步骤 3（上架位置）"],
    "risks": ["风险 1（≤35 字）"]
  }
}`;

  const [lowResult, highResult, priceVideoResult] = await Promise.all([
    callLlm(lowPrompt),
    callLlm(highPrompt),
    callLlm(priceVideoPrompt),
  ]);

  // 段 4：执行摘要 & 路线图（依赖前 3 段输出）
  const safeStringify = (obj, cap) => {
    try { return JSON.stringify(obj).slice(0, cap); } catch { return ""; }
  };
  const summaryPrompt = `[OUTPUT MODE = RAW JSON ONLY] 直接以 { 开头，以 } 结束。禁止任何前言/解释/思考过程/markdown 代码块/\`\`\`json 围栏。不得出现除 JSON 以外的任何字符。

你是 Temu 品类增长负责人（Category Manager）。前 3 段分析已产出详细洞察（见下方 JSON）。现在给产品 + 运营 team 写一份「执行摘要 + 路线图」——看完就能决定下周做什么。

方法论：
1. 不重复前 3 段明细；执行摘要是「读 30 秒做决策」级别。
2. 必须引用具体数值或字段（前 3 段 JSON + 统计快照）。
3. top_actions 优先级：P0=本周必做，P1=本月，P2=季度；每条带 effort (S/M/L) + expected_impact + success_metric。
4. critical_risks 必须含「如果不做会怎样」的后果判断。
5. data_gaps 要具体到：下一步该补采什么数据（评论样本不够？价格字段缺？视频样本少？）。
6. SWOT 必须基于前面的证据，不得凭空发挥。

【统计快照】
- 我方商品数: ${mineItems.length}，竞品数: ${competitorItems.length}
- 低分评论: 我方 ${mineLow.length} / 竞品 ${compLow.length}
- 高分评论: 我方 ${mineHigh.length} / 竞品 ${compHigh.length}
- 价格样本: ${priceStats.sampleSize}，我方 ${fmtPrice(priceStats.myPrice)} vs 中位 ${fmtPrice(priceStats.p50)}
- 视频覆盖: 竞品 ${videoPct}%，我方${videoStats.myHasVideo ? "有" : "无"}视频

【段 1 · 低分分析】
${safeStringify(lowResult, 4500)}

【段 2 · 高分分析】
${safeStringify(highResult, 4500)}

【段 3 · 价格/视频】
${safeStringify(priceVideoResult, 2500)}

严格 JSON 输出：
{
  "executive_summary": "2-3 段完整叙述（每段 2-4 句，总计 ≤350 字）。第 1 段：整体竞争定位（必须引用具体数值）；第 2 段：最关键的 1-2 个差距 + 根因；第 3 段：总体方向判断与节奏。",
  "competitive_position": {
    "strengths": ["2-4 条（≤25 字/条）"],
    "weaknesses": ["2-4 条"],
    "opportunities": ["2-4 条"],
    "threats": ["2-4 条"]
  },
  "top_actions": [
    {
      "priority": "P0|P1|P2",
      "title": "动作标题（≤18 字）",
      "why": "为什么做（引证前面洞察，≤50 字）",
      "how": "怎么做（一句话完整步骤，≤70 字）",
      "owner_hint": "产品|运营|视觉|客服|定价",
      "effort": "S|M|L",
      "expected_impact": "预期效果（≤35 字）",
      "success_metric": "衡量指标（≤30 字）"
    }
  ],
  "critical_risks": [
    { "risk": "风险（≤35 字）", "if_ignored": "不管会怎样（≤50 字）" }
  ],
  "data_gaps": ["下一步要补采什么数据（≤50 字/条）"]
}`;

  const summaryResult = await callLlm(summaryPrompt, { maxTokens: 6000 });

  const insights = {
    generatedAt: Date.now(),
    model: lastSuccessModel || COMPARE_MODEL_CHAIN[0],
    stats: {
      mineGoods: mineItems.map((e) => ({ goodsId: e.goodsId, title: e.title })),
      competitorGoods: competitorItems.map((e) => ({ goodsId: e.goodsId, title: e.title })),
      mineLowCount: mineLow.length,
      mineHighCount: mineHigh.length,
      competitorLowCount: compLow.length,
      competitorHighCount: compHigh.length,
      priceStats,
      videoStats,
    },
    myUniquePains: lowResult?.my_unique_pains || [],
    industryCommonPains: lowResult?.industry_common_pains || [],
    competitorPointsIMiss: highResult?.competitor_selling_points_i_miss || [],
    priceBandInsight: priceVideoResult?.price_band_insight || null,
    videoCoverageInsight: priceVideoResult?.video_coverage_insight || null,
    executiveSummary: summaryResult?.executive_summary || null,
    competitivePosition: summaryResult?.competitive_position || null,
    topActions: summaryResult?.top_actions || [],
    criticalRisks: summaryResult?.critical_risks || [],
    dataGaps: summaryResult?.data_gaps || [],
    _rawLowFallback: lowResult?.raw || null,
    _rawHighFallback: highResult?.raw || null,
    _rawPriceVideoFallback: priceVideoResult?.raw || null,
    _rawSummaryFallback: summaryResult?.raw || null,
  };
  compareInsightsCache = insights;
  saveCompareInsights(insights);
  return { ok: true, insights };
}

// 启动时按白名单给已有记录回填 kind（允许用户先采后标记）
(function backfillKinds() {
  let touched = false;
  for (const rec of extCompareQueue) {
    const id = String(rec?.goodsId || "");
    const want = isMineGoods(id) ? "mine" : "competitor";
    if (rec.kind !== want) { rec.kind = want; touched = true; }
  }
  if (touched) rewriteExtCompareQueueFile();
})();

function pushExtCompareQueue(entry) {
  const id = String(entry?.goodsId || "");
  if (!id) return false;
  const kind = isMineGoods(id) ? "mine" : "competitor";
  if (extCompareIds.has(id)) {
    // 已存在则覆盖字段（让浮层后续重点采带回来的新字段能更新进去），但不重复入文件
    const exist = extCompareQueue.find((e) => String(e.goodsId) === id);
    if (exist) {
      Object.assign(exist, entry, { goodsId: id, kind, updatedAt: Date.now() });
      rewriteExtCompareQueueFile();
    }
    return false;
  }
  const record = { ...entry, goodsId: id, kind, addedAt: Date.now() };
  extCompareIds.add(id);
  extCompareQueue.push(record);
  try {
    ensureExtFeedDir();
    fs.appendFileSync(EXT_COMPARE_QUEUE_FILE, JSON.stringify(record) + "\n", "utf8");
  } catch (e) {
    console.warn("[ext-queue] append failed:", e?.message || e);
  }
  return true;
}

function removeExtCompareQueue(goodsId) {
  const id = String(goodsId || "");
  if (!id || !extCompareIds.has(id)) return false;
  extCompareIds.delete(id);
  const idx = extCompareQueue.findIndex((e) => String(e.goodsId) === id);
  if (idx >= 0) extCompareQueue.splice(idx, 1);
  rewriteExtCompareQueueFile();
  return true;
}

function rewriteExtCompareQueueFile() {
  try {
    ensureExtFeedDir();
    const text = extCompareQueue.map((e) => JSON.stringify(e)).join("\n") + (extCompareQueue.length ? "\n" : "");
    fs.writeFileSync(EXT_COMPARE_QUEUE_FILE, text, "utf8");
  } catch (e) {
    console.warn("[ext-queue] rewrite failed:", e?.message || e);
  }
}

// 查 extFeed 里是否有指定 goodsId 的采集记录
function findExtCaptureForGoodsId(goodsId) {
  const id = String(goodsId || "");
  if (!id) return { captured: false };
  // 倒序扫（最新优先），匹配 url 或 body 里出现 goodsId
  for (let i = extFeedBuffer.length - 1; i >= 0; i--) {
    const e = extFeedBuffer[i];
    const url = String(e?.url || "");
    if (url.includes(id)) {
      return { captured: true, lastTs: e.receivedAt || e.ts, matchedUrl: url, matchedKind: e.kind };
    }
    const body = typeof e?.body === "string" ? e.body : "";
    if (body && body.length < 2_000_000 && body.includes(id)) {
      return { captured: true, lastTs: e.receivedAt || e.ts, matchedUrl: url, matchedKind: e.kind };
    }
  }
  return { captured: false };
}

const server = createWorkerServer(async (req, res) => {
  // CORS 预检：扩展 service worker fetch 可能触发
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "600",
    });
    res.end();
    return;
  }

  // 扩展 feed 端点：免鉴权（仅 127.0.0.1 监听，外网访问不到）
  if (req.method === "POST") {
    const parsedUrl = parseLocalUrl(req.url);
    if (parsedUrl && parsedUrl.pathname === "/ext-feed") {
      try {
        pushExtFeed(await readJsonBody(req));
      } catch {}
      sendNoContent(res, { cors: true });
      return;
    }
    if (parsedUrl && parsedUrl.pathname === "/ext-compare-queue") {
      let added = false;
      try {
        added = pushExtCompareQueue(await readJsonBody(req));
      } catch {}
      sendJson(res, { ok: true, added, size: extCompareQueue.length }, { cors: true });
      return;
    }
    if (parsedUrl && parsedUrl.pathname === "/mine-goods") {
      let changed = false;
      try {
        const payload = await readJsonBody(req, { emptyFallback: "{}" });
        const goodsId = String(payload?.goodsId || "").trim();
        const isMine = payload?.kind === "mine";
        changed = setMineGoods(goodsId, isMine);
      } catch {}
      sendJson(res, { ok: true, changed, items: Array.from(mineGoodsSet) }, { cors: true });
      return;
    }
    if (parsedUrl && parsedUrl.pathname === "/ext-focus-main") {
      // 通过 stderr 输出特殊标记，Electron main 监听 worker.stderr 识别并 show/focus 主窗
      console.error("[EXT_FOCUS_MAIN_REQUEST]");
      sendJson(res, { ok: true }, { cors: true });
      return;
    }
    if (parsedUrl && parsedUrl.pathname === "/ext-fetch-reviews") {
      let result = { reviews: [], stats: null, debug: { matchedEntries: 0, totalFeed: 0 } };
      try {
        const payload = await readJsonBody(req, { emptyFallback: "{}" });
        result = _extractReviewsFromFeed(payload, extFeedBuffer);
      } catch (e) {
        result.error = String(e?.message || e).slice(0, 200);
      }
      sendJson(res, result, { cors: true });
      return;
    }
  }
  // 扩展 GET 查询端点
  if (req.method === "GET") {
    const parsedUrl = parseLocalUrl(req.url);
    if (parsedUrl && parsedUrl.pathname === "/ext-product") {
      const goodsId = parsedUrl.searchParams.get("goodsId") || "";
      const result = findExtCaptureForGoodsId(goodsId);
      result.inCompareQueue = extCompareIds.has(String(goodsId));
      sendJson(res, result, { cors: true });
      return;
    }
    if (parsedUrl && parsedUrl.pathname === "/ext-compare-queue") {
      sendJson(res, { items: extCompareQueue.slice(), size: extCompareQueue.length }, { cors: true });
      return;
    }
    if (parsedUrl && parsedUrl.pathname === "/mine-goods") {
      sendJson(res, { items: Array.from(mineGoodsSet) }, { cors: true });
      return;
    }
  }

  if (!isAuthorizedWorkerRequest(req)) {
    sendJson(res, { type: "error", code: 401, message: "Unauthorized" }, {
      statusCode: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
    return;
  }

  // GET /progress - 实时进度查询
  if (req.method === "GET") {
    const requestUrl = new URL(req.url, "http://127.0.0.1");
    if (requestUrl.pathname === "/progress") {
      const taskId = requestUrl.searchParams.get("taskId");
      const snapshot = getProgressSnapshot(taskId);
      sendJson(res, snapshot, { cors: true });
      return;
    }
    if (requestUrl.pathname === "/tasks") {
      sendJson(res, listProgressSnapshots(), { cors: true });
      return;
    }
  }

  if (req.method !== "POST") { res.writeHead(404); res.end(); return; }

  const startTime = Date.now();
  let action = "unknown";
  try {
    const cmd = await readJsonBody(req, {
      onError: (err) => { console.error("[Worker] Request error:", err.message); },
    });
    action = cmd.action || "unknown";
    const result = await withWorkerRequestCredentials(cmd.params?.credentials, async () => handleRequest(cmd));
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[Worker] ${action} completed in ${duration}s`);
    sendJson(res, { type: "result", data: result });
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const errCode = err.code || ERR.UNKNOWN;
    const screenshotFile = await captureWorkerErrorScreenshot(`worker_${action}`);
    console.error(`[Worker] ${action} FAILED in ${duration}s: [${errCode}] ${err.message}`);
    sendJson(res, {
      type: "error",
      code: errCode,
      message: err.message || String(err),
      action,
      duration: parseFloat(duration),
      screenshotFile: screenshotFile || undefined,
    });
  }
});

const PORT = resolveWorkerPort();
startWorkerServer(server, {
  port: PORT,
  runtimeDataDir: workerRuntimeDataDir,
  authToken: WORKER_AUTH_TOKEN,
});

process.on("SIGTERM", async () => { await closeBrowser(); server.close(); process.exit(0); });
process.on("uncaughtException", (err) => {
  captureWorkerErrorScreenshot("uncaught_exception").catch(() => {});
  console.error("[Worker] Uncaught exception:", err.message, err.stack);
});
process.on("unhandledRejection", (reason) => {
  captureWorkerErrorScreenshot("unhandled_rejection").catch(() => {});
  console.error("[Worker] Unhandled rejection:", reason);
});
