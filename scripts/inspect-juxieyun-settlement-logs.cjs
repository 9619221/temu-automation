#!/usr/bin/env node
/**
 * Read-only, sanitized inspector for Juxieyun TEMU settlement robot logs.
 *
 * Raw droplet logs can contain tokens, account payloads and signed upload URLs.
 * This script only emits businessType/type/file-name/count evidence.
 */
"use strict";

const fs = require("fs");
const path = require("path");
let iconv = null;
try { iconv = require("iconv-lite"); }
catch {}

const JXY_SETTLEMENT_ROBOT_ID = "65f019fe6656aba90709e8fa";
const JXY_SETTLEMENT_ROBOT_NAME = "\u0054\u0045\u004d\u0055\u7ed3\u7b97\u6570\u636e\u5bfc\u5165\u0045\u0052\u0050";

const LABELS = {
  account: "\u8d26\u6237\u6982\u89c8",
  limitDetail: "\u8d44\u91d1\u9650\u5236\u660e\u7ec6",
  limit: "\u8d44\u91d1\u9650\u5236",
  settlement: "\u7ed3\u7b97\u6570\u636e",
  finance: "\u8d26\u52a1\u660e\u7ec6",
  epr: "\u0045\u0050\u0052\u8d39\u7528\u660e\u7ec6",
  performance: "\u5c65\u7ea6\u670d\u52a1",
  violation: "\u8fdd\u89c4",
  deduction: "\u6263\u6b3e",
  backupViolation: "\u5907\u8d27\u8fdd\u89c4",
};

function argValue(name, argv = process.argv) {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : null;
}

function hasFlag(name, argv = process.argv) {
  return argv.includes(name);
}

function defaultLogDir() {
  return path.join(process.env.APPDATA || "", "droplet-client", "logs", "tasks");
}

function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text || ""));
}

function looksMojibake(text) {
  const value = String(text || "");
  return !hasCjk(value) && /[\u00c0-\u00ff][\u0080-\u00bf]/.test(value);
}

function readableScore(text) {
  const value = String(text || "");
  const cjk = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const replacement = (value.match(/\ufffd|\?/g) || []).length;
  const controls = (value.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g) || []).length;
  return cjk * 3 - replacement * 2 - controls;
}

function decodeMaybeMojibake(value) {
  let text = String(value || "");
  try { text = decodeURIComponent(text); }
  catch {}
  const candidates = [text];
  if (looksMojibake(text)) candidates.push(Buffer.from(text, "latin1").toString("utf8"));
  if (iconv) {
    try { candidates.push(Buffer.from(iconv.encode(text, "gbk")).toString("utf8")); }
    catch {}
  }
  return candidates
    .map((candidate) => ({ candidate, score: readableScore(candidate) }))
    .sort((a, b) => b.score - a.score)[0].candidate;
}

function cleanFileName(name) {
  return decodeMaybeMojibake(name)
    .replace(/^[a-f0-9]{32}-/i, "")
    .replace(/[?&](Expires|OSSAccessKeyId|Signature)=[^'"&\s]+/g, "")
    .replace(/https?:\/\/\S+/g, "[url]");
}

function classifyFileName(name) {
  const clean = cleanFileName(name);
  if (clean.includes(LABELS.account)) return "AccountAmount";
  if (clean.includes(LABELS.limitDetail)) return "TemuLimitDetail";
  if (clean.includes(LABELS.limit)) return "ShopFinanceLimit";
  if (clean.includes(LABELS.settlement)) return "SalesManagement";
  if (clean.includes(LABELS.epr)) return "Epr";
  if (clean.includes(LABELS.performance) || clean.includes("Performance")) return "Performance";
  if (clean.includes(LABELS.backupViolation) || clean.includes(LABELS.deduction)) return "Deduction";
  if (clean.includes(LABELS.violation)) return "ViolationInfo";
  if (clean.includes(LABELS.finance)) return "FinancialDetails";
  return "unknown";
}

function collectLogFiles(logDir) {
  if (!logDir || !fs.existsSync(logDir)) return [];
  return fs.readdirSync(logDir)
    .filter((name) => name.endsWith(".log") || name.endsWith(".old.log"))
    .map((name) => path.join(logDir, name));
}

function fileMtime(file) {
  try { return fs.statSync(file).mtimeMs; }
  catch { return 0; }
}

function extractQuotedField(line, field) {
  const re = new RegExp(String.raw`['"]${field}['"]:\s*(?:'([^']*)'|"([^"]*)"|([^,}]+))`);
  const match = line.match(re);
  if (!match) return "";
  const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
  return raw === "None" || raw === "null" ? "" : decodeMaybeMojibake(raw);
}

function extractTime(line) {
  return (line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)\]/) || [])[1] || "";
}

function extractUploadFilesFromNotification(line) {
  const files = [];
  const urls = [...line.matchAll(/['"]fileUrl['"]:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  const names = [...line.matchAll(/['"]fileName['"]:\s*['"]([^'"]+?\.xlsx)['"]/g)].map((match) => cleanFileName(match[1]));
  for (let index = 0; index < Math.max(urls.length, names.length); index += 1) {
    files.push({
      fileUrl: urls[index] || "",
      fileName: names[index] || "",
    });
  }
  return files.filter((item) => item.fileName || item.fileUrl);
}

function extractRowsFromNotification(line, source) {
  if (!line.includes("notification:") || !line.includes("settle")) return [];
  const businessType = extractQuotedField(line, "businessType");
  if (!businessType || businessType === "notice") return [];
  const type = extractQuotedField(line, "type");
  const shopId = extractQuotedField(line, "shopId");
  const area = extractQuotedField(line, "area");
  const rpaParam = extractQuotedField(line, "rpaParam");
  const files = extractUploadFilesFromNotification(line);
  const time = extractTime(line);
  if (!files.length) {
    return [{ source, time, businessType, type, shopId, area, rpaParam, fileName: "" }];
  }
  return files.map(({ fileName, fileUrl }) => ({
    source,
    time,
    businessType,
    type: type || classifyFileName(fileName),
    shopId,
    area,
    rpaParam,
    fileName,
    fileUrl,
  }));
}

function extractRowsFromUploadLine(line, source) {
  if (!line.includes(".xlsx") || !/(upload_file_to_oss|\u4e0a\u4f20\u6210\u529f|fileName|filename)/.test(line)) return [];
  const names = [...line.matchAll(/(?:^|[\/'" ])([^\/'"?\s]+\.xlsx)/g)]
    .map((match) => cleanFileName(match[1]))
    .filter((name, index, arr) => name && classifyFileName(name) !== "unknown" && arr.indexOf(name) === index);
  return names.map((fileName) => ({
    source,
    time: extractTime(line),
    businessType: classifyFileName(fileName),
    type: "",
    shopId: "",
    area: "",
    rpaParam: "",
    fileName,
  }));
}

function isSettlementLog(text, robotId) {
  if (!text.includes(robotId) && !text.includes(JXY_SETTLEMENT_ROBOT_NAME)) return false;
  return /(settle|SalesManagement|FinancialDetails|AccountAmount|Epr|Deduction|Performance)/i.test(text);
}

function addEvidence(map, row) {
  const category = row.businessType || classifyFileName(row.fileName) || "unknown";
  if (!map.has(category)) {
    map.set(category, {
      businessType: category,
      eventCount: 0,
      uploadFileCount: 0,
      types: new Set(),
      areas: new Set(),
      shopIds: new Set(),
      rpaParams: new Set(),
      examples: [],
      sources: new Set(),
      firstEventAt: "",
      latestEventAt: "",
    });
  }
  const item = map.get(category);
  item.eventCount += 1;
  if (row.fileName) item.uploadFileCount += 1;
  if (row.type) item.types.add(row.type);
  if (row.area) item.areas.add(row.area);
  if (row.shopId) item.shopIds.add(row.shopId);
  if (row.rpaParam) item.rpaParams.add(row.rpaParam);
  if (row.fileName && item.examples.length < 12) item.examples.push(cleanFileName(row.fileName));
  if (row.source) item.sources.add(row.source);
  if (row.time && (!item.firstEventAt || row.time < item.firstEventAt)) item.firstEventAt = row.time;
  if (row.time && row.time > item.latestEventAt) item.latestEventAt = row.time;
}

function inspectFile(file, robotId) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); }
  catch { return null; }
  if (!isSettlementLog(text, robotId)) return null;
  const source = path.basename(file);
  const notificationRows = [];
  const fallbackRows = [];
  for (const line of text.split(/\r?\n/)) {
    const rows = extractRowsFromNotification(line, source);
    if (rows.length) notificationRows.push(...rows);
    else fallbackRows.push(...extractRowsFromUploadLine(line, source));
  }
  const rows = notificationRows.length ? notificationRows : fallbackRows;
  return { file, source, rows, mtimeMs: fileMtime(file) };
}

function inspectJuxieyunSettlementLogs(options = {}) {
  const logDir = options.logDir || defaultLogDir();
  const robotId = options.robotId || JXY_SETTLEMENT_ROBOT_ID;
  let files = options.file ? [path.resolve(options.file)] : collectLogFiles(logDir);
  const inspected = files.map((file) => inspectFile(file, robotId)).filter(Boolean);
  const selected = options.latest && inspected.length
    ? [inspected.slice().sort((a, b) => b.mtimeMs - a.mtimeMs)[0]]
    : inspected;

  const evidence = new Map();
  const events = [];
  for (const fileReport of selected) {
    const seen = new Set();
    for (const row of fileReport.rows) {
      const key = [row.source, row.time, row.businessType, row.type, row.shopId, row.area, row.fileName].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      addEvidence(evidence, row);
      if (options.includeRows) {
        events.push({
          source: row.source,
          time: row.time || null,
          businessType: row.businessType || "unknown",
          type: row.type || "",
          shopId: row.shopId || "",
          area: row.area || "",
          rpaParam: row.rpaParam || "",
          fileName: row.fileName ? cleanFileName(row.fileName) : "",
          ...(options.includeUrls && row.fileUrl ? { fileUrl: row.fileUrl } : {}),
        });
      }
    }
  }

  const summary = [...evidence.values()]
    .map((item) => ({
      businessType: item.businessType,
      eventCount: item.eventCount,
      uploadFileCount: item.uploadFileCount,
      types: [...item.types].sort(),
      areas: [...item.areas].sort(),
      shopIds: [...item.shopIds].sort(),
      rpaParams: [...item.rpaParams].sort(),
      firstEventAt: item.firstEventAt || null,
      latestEventAt: item.latestEventAt || null,
      examples: [...new Set(item.examples)].slice(0, 12),
      sources: [...item.sources].sort(),
    }))
    .sort((a, b) => a.businessType.localeCompare(b.businessType));

  const report = {
    logDir,
    scannedFiles: files.length,
    matchingFiles: inspected.length,
    selectedFiles: selected.map((item) => item.file),
    robotId,
    summary,
  };
  if (options.includeRows) {
    report.events = events.sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
  }
  return report;
}

function printText(report) {
  console.log("Juxieyun TEMU settlement log evidence");
  console.log(`Log dir: ${report.logDir}`);
  console.log(`Files: scanned=${report.scannedFiles}, matching=${report.matchingFiles}, selected=${report.selectedFiles.length}`);
  if (report.selectedFiles.length) {
    console.log(`Selected: ${report.selectedFiles.map((file) => path.basename(file)).join(", ")}`);
  }
  console.log("");
  for (const row of report.summary) {
    console.log(`[${row.businessType}] events=${row.eventCount}, uploads=${row.uploadFileCount}`);
    if (row.shopIds.length) console.log(`  shops: ${row.shopIds.join(", ")}`);
    if (row.rpaParams.length) console.log(`  params: ${row.rpaParams.join(" | ")}`);
    if (row.types.length) console.log(`  types: ${row.types.join("; ")}`);
    if (row.areas.length) console.log(`  areas: ${row.areas.join("; ")}`);
    if (row.firstEventAt || row.latestEventAt) console.log(`  time: ${row.firstEventAt || "?"} -> ${row.latestEventAt || "?"}`);
    if (row.examples.length) console.log(`  examples: ${row.examples.slice(0, 5).join(" | ")}`);
  }
}

function main() {
  const logDir = argValue("--log-dir") || defaultLogDir();
  const file = argValue("--file");
  const report = inspectJuxieyunSettlementLogs({ logDir, file, latest: hasFlag("--latest"), includeRows: hasFlag("--events") });
  if (hasFlag("--json")) console.log(JSON.stringify(report, null, 2));
  else printText(report);
  if (!report.matchingFiles) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  JXY_SETTLEMENT_ROBOT_ID,
  inspectJuxieyunSettlementLogs,
  cleanFileName,
  decodeMaybeMojibake,
};
