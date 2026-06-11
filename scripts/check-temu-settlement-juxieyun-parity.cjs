#!/usr/bin/env node
/**
 * Read-only parity checker for Temu settlement collection vs. the Juxieyun
 * settlement robot evidence found in local droplet logs.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { relaunchUnderElectronIfNeeded } = require("./ensure-electron-runtime.cjs");
relaunchUnderElectronIfNeeded(__filename);

const Database = require("better-sqlite3");
const { inspectJuxieyunSettlementLogs } = require("./inspect-juxieyun-settlement-logs.cjs");

const ROOT = path.join(__dirname, "..");
const WORKER_FILE = path.join(ROOT, "automation", "worker.mjs");
const SERVICE_FILE = path.join(ROOT, "electron", "erp", "services", "multiStoreReport.cjs");

const CATEGORIES = [
  {
    id: "account_amount",
    jxy: "AccountAmount / account overview",
    jxyBusinessTypes: ["AccountAmount"],
    ours: "accountOverview",
    workerTasks: ["accountOverview"],
    servicePaths: ["/api/merchant/payment/account/amount/info"],
    erpTables: ["erp_temu_account_overview"],
  },
  {
    id: "finance_limit",
    jxy: "ShopFinanceLimit + TemuLimitDetail / fund limits",
    jxyBusinessTypes: ["ShopFinanceLimit", "TemuLimitDetail"],
    ours: "fundFrozen",
    workerTasks: ["fundFrozen"],
    servicePaths: ["/api/merchant/fund-frozen/rules"],
    erpTables: ["erp_temu_fund_frozen"],
  },
  {
    id: "sales_management",
    jxy: "SalesManagement / settlement data",
    jxyBusinessTypes: ["SalesManagement"],
    ours: "income summary + pending/in settlement",
    workerTasks: ["settleWait", "settleIn"],
    servicePaths: [
      "/api/merchant/front/finance/income-summary",
      "/api/merchant/settle/detail/full/wait-settlement",
      "/api/merchant/settle/detail/full/in-settlement",
    ],
    erpTables: ["erp_temu_settlement_income", "erp_temu_settlement_detail"],
  },
  {
    id: "financial_details_settlement",
    jxy: "FinancialDetails / settlement detail",
    jxyBusinessTypes: ["FinancialDetails"],
    ours: "fund detail",
    workerTasks: ["fundDetail"],
    specialWorkerChecks: ["wantFundDetail"],
    servicePaths: ["/api/merchant/fund/detail/pageSearch"],
    erpTables: ["erp_temu_fund_detail"],
  },
  {
    id: "deduction_detail",
    jxy: "Deduction / backup violation and outflow deductions",
    jxyBusinessTypes: ["Deduction"],
    observedInJxyLogs: [
      "\u53d1\u8d27\u5c65\u7ea6\u4fdd\u969c-\u5ef6\u8fdf\u53d1\u8d27",
      "\u53d1\u8d27\u5c65\u7ea6\u4fdd\u969c-\u5ef6\u8fdf\u5230\u8d27",
      "\u53d1\u8d27\u5c65\u7ea6\u4fdd\u969c-\u7f3a\u8d27",
      "\u5546\u54c1\u54c1\u8d28\u4fdd\u969c-\u8d28\u91cf\u95ee\u9898(JIT\u5546\u54c1)",
      "\u5546\u54c1\u54c1\u8d28\u4fdd\u969c-\u8d28\u91cf\u95ee\u9898(\u5b9a\u5236\u5546\u54c1)",
      "\u6d88\u8d39\u8005\u53ca\u5c65\u7ea6\u4fdd\u969c-\u552e\u540e\u8865\u5bc4",
    ],
    ours: "fund detail category mapping",
    workerTasks: ["fundDetail"],
    specialWorkerChecks: ["wantFundDetail"],
    servicePaths: ["/api/merchant/fund/detail/pageSearch"],
    erpTables: ["erp_temu_fund_detail"],
  },
  {
    id: "epr_fee",
    jxy: "EPR fee detail",
    jxyBusinessTypes: ["Epr"],
    observedInJxyLogs: [
      "Epr_Product / \u5546\u54c1\u73af\u4fdd\u8d39-\u5df2\u6263\u8d39\u6b3e\u9879",
      "Epr_Proxy / \u4ee3\u4ed8\u670d\u52a1\u8d39-\u5df2\u6263\u8d39",
      "Epr_Agency / \u6388\u6743\u4ee3\u7406\u8d39-\u5df2\u6263\u8d39",
    ],
    ours: "epr export history files",
    workerTasks: ["eprExport"],
    servicePaths: ["/api/merchant/file/export/history/page"],
    erpTables: ["erp_temu_epr_fee"],
  },
  {
    id: "violation_info",
    jxy: "ViolationInfo",
    jxyBusinessTypes: ["ViolationInfo"],
    ours: "settlementViolation",
    workerTasks: ["settlementViolation"],
    servicePaths: ["/mms/tmod_punish/agent/merchant_appeal/entrance/list"],
    erpTables: ["erp_temu_violation", "erp_temu_violation_summary"],
  },
  {
    id: "performance_outflow",
    jxy: "Performance / fulfillment outflow",
    jxyBusinessTypes: ["Performance"],
    observedInJxyLogs: ["Paid / \u5c65\u7ea6\u670d\u52a1-\u5df2\u7f34\u8d39"],
    ours: "fulfillment bill overview/detail",
    workerTasks: ["fulfillmentBillOverview", "fulfillmentBillDetail"],
    servicePaths: [
      "/api/merchant/warehouse/express/bill/global/overview",
      "/api/merchant/warehouse/express/bill/detail/list",
    ],
    erpTables: ["erp_temu_fulfillment_bill"],
  },
];

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function defaultErpDb() {
  const local = path.join(process.cwd(), "data", "erp.sqlite");
  if (fs.existsSync(local)) return local;
  return path.join(process.env.ERP_DATA_DIR || "/opt/temu-erp-data", "erp.sqlite");
}

function defaultCloudDb() {
  const local = path.join(process.cwd(), "cloud", "data", "temu-cloud.sqlite");
  if (fs.existsSync(local)) return local;
  return "/opt/temu-cloud/data/temu-cloud.sqlite";
}

function defaultJxyLogDir() {
  return path.join(process.env.APPDATA || "", "droplet-client", "logs", "tasks");
}

const ERP_DB = argValue("--erp-db") || process.env.ERP_DB || process.env.ERP_DB_PATH || defaultErpDb();
const CLOUD_DB = argValue("--cloud-db") || process.env.TEMU_CLOUD_DB_PATH || defaultCloudDb();
const JXY_LOG_DIR = argValue("--jxy-log-dir") || process.env.JUXIEYUN_LOG_DIR || defaultJxyLogDir();
const JXY_LOG_FILE = argValue("--jxy-log-file") || process.env.JUXIEYUN_LOG_FILE || "";
const JXY_LATEST = hasFlag("--jxy-latest");
const AS_JSON = hasFlag("--json");
const STRICT = hasFlag("--strict");
const COVERAGE_ONLY = hasFlag("--coverage-only");

function readText(file) {
  try { return fs.readFileSync(file, "utf8"); }
  catch { return ""; }
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function tableColumns(db, name) {
  return db.prepare(`PRAGMA table_info(${name})`).all().map((row) => row.name);
}

function firstExistingColumn(columns, candidates) {
  return candidates.find((name) => columns.includes(name)) || null;
}

function summarizeTable(db, table) {
  if (!tableExists(db, table)) return { table, exists: false, rows: 0, mall_count: 0, latest: null };
  const columns = tableColumns(db, table);
  const mallCol = firstExistingColumn(columns, ["mall_id", "platform_shop_id", "mall_supplier_id"]);
  const latestCol = firstExistingColumn(columns, [
    "synced_at", "updated_at", "received_at", "stat_date", "summary_date", "bill_date", "created_at",
  ]);
  const mallSql = mallCol ? `COUNT(DISTINCT NULLIF(${mallCol}, '')) AS mall_count` : "0 AS mall_count";
  const latestSql = latestCol ? `MAX(${latestCol}) AS latest` : "NULL AS latest";
  const row = db.prepare(`SELECT COUNT(*) AS rows, ${mallSql}, ${latestSql} FROM ${table}`).get();
  return {
    table,
    exists: true,
    rows: Number(row.rows) || 0,
    mall_count: Number(row.mall_count) || 0,
    latest: row.latest || null,
  };
}

function summarizeCaptureEvents(db, paths) {
  if (!tableExists(db, "capture_events")) return { capture_events_exists: false, rows: [] };
  const columns = tableColumns(db, "capture_events");
  const required = ["url_path", "mall_id", "received_at"];
  const missing = required.filter((name) => !columns.includes(name));
  if (missing.length) return { capture_events_exists: true, missing_columns: missing, rows: [] };
  const placeholders = paths.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT url_path,
           COUNT(*) AS capture_count,
           COUNT(DISTINCT NULLIF(mall_id, '')) AS mall_count,
           MAX(received_at) AS latest_received_at
      FROM capture_events
     WHERE url_path IN (${placeholders})
     GROUP BY url_path
     ORDER BY url_path
  `).all(...paths);
  return { capture_events_exists: true, rows };
}

function inspectCode() {
  const worker = readText(WORKER_FILE);
  const service = readText(SERVICE_FILE);
  const settlementExpansion = worker.match(/rawTasks\.includes\("settlement"\)[\s\S]{0,900}/)?.[0] || "";
  return CATEGORIES.map((cat) => {
    const taskChecks = cat.workerTasks.map((task) => ({
      task,
      defined: worker.includes(`${task}:`) || worker.includes(`"${task}"`),
      inSettlementExpansion: task === "fundDetail"
        ? /wantFundDetail\s*=/.test(worker)
        : settlementExpansion.includes(`"${task}"`),
    }));
    const specialChecks = (cat.specialWorkerChecks || []).map((needle) => ({
      check: needle,
      present: worker.includes(needle),
    }));
    const pathChecks = cat.servicePaths.map((apiPath) => ({
      path: apiPath,
      inService: service.includes(apiPath),
      inWorker: worker.includes(apiPath),
    }));
    return { id: cat.id, taskChecks, specialChecks, pathChecks };
  });
}

function inspectCloud() {
  const result = { exists: fs.existsSync(CLOUD_DB), categories: {} };
  if (!result.exists) return result;
  const db = new Database(CLOUD_DB, { readonly: true, fileMustExist: true });
  try {
    for (const cat of CATEGORIES) {
      result.categories[cat.id] = summarizeCaptureEvents(db, cat.servicePaths);
    }
  } finally {
    db.close();
  }
  return result;
}

function inspectErp() {
  const result = { exists: fs.existsSync(ERP_DB), categories: {} };
  if (!result.exists) return result;
  const db = new Database(ERP_DB, { readonly: true, fileMustExist: true });
  try {
    for (const cat of CATEGORIES) {
      result.categories[cat.id] = cat.erpTables.map((table) => summarizeTable(db, table));
    }
  } finally {
    db.close();
  }
  return result;
}

function inspectJxyLogs() {
  try {
    return inspectJuxieyunSettlementLogs({ logDir: JXY_LOG_DIR, file: JXY_LOG_FILE || null, latest: JXY_LATEST });
  } catch (error) {
    return { logDir: JXY_LOG_DIR, error: error?.message || String(error), summary: [] };
  }
}

function jxyLogEvidenceFor(cat, jxyLogs) {
  const rows = (jxyLogs?.summary || []).filter((row) => (cat.jxyBusinessTypes || []).includes(row.businessType));
  const types = [...new Set(rows.flatMap((row) => row.types || []))].sort();
  const uploadFileCount = rows.reduce((sum, row) => sum + Number(row.uploadFileCount || 0), 0);
  const eventCount = rows.reduce((sum, row) => sum + Number(row.eventCount || 0), 0);
  return {
    businessTypes: cat.jxyBusinessTypes || [],
    eventCount,
    uploadFileCount,
    types,
    rows,
  };
}

function classifyCoverage(code) {
  const missingWorker = code.taskChecks.filter((item) => !item.defined || !item.inSettlementExpansion);
  const missingSpecial = code.specialChecks.filter((item) => !item.present);
  const missingServicePaths = code.pathChecks.filter((item) => !item.inService);
  const missingWorkerPaths = code.pathChecks.filter((item) => !item.inWorker);

  if (missingWorker.length || missingSpecial.length || missingServicePaths.length) {
    return {
      level: "fail",
      reason: "code coverage is incomplete",
      missingWorker,
      missingSpecial,
      missingServicePaths,
      missingWorkerPaths,
    };
  }

  return {
    level: "ok",
    reason: "code coverage is present",
    missingWorker,
    missingSpecial,
    missingServicePaths,
    missingWorkerPaths,
  };
}

function classifyRuntime(cloudCat, erpCat) {
  const cloudRows = (cloudCat?.rows || []).reduce((sum, row) => sum + Number(row.capture_count || 0), 0);
  const erpRows = (erpCat || []).reduce((sum, row) => sum + Number(row.rows || 0), 0);
  const missingTables = (erpCat || []).filter((row) => !row.exists);

  if (missingTables.length) {
    return { level: "warn", reason: "ERP materialized table is missing", missingTables };
  }
  if (erpRows > 0) {
    return { level: "ok", reason: "ERP rows exist", erpRows, cloudRows, missingWorkerPaths };
  }
  if (cloudRows > 0) {
    return { level: "warn", reason: "cloud captures exist but ERP has no rows; run settlement sync or inspect parser", cloudRows };
  }
  return {
    level: "warn",
    reason: "no runtime evidence yet; collect the same stores/date range before claiming parity",
    cloudRows,
    erpRows,
  };
}

function summarizeStatus(coverageStatus, runtimeStatus) {
  if (coverageStatus.level === "fail") return coverageStatus;
  if (COVERAGE_ONLY) return coverageStatus;
  return runtimeStatus;
}

function buildReport() {
  const codeList = inspectCode();
  const cloud = inspectCloud();
  const erp = inspectErp();
  const jxyLogs = inspectJxyLogs();
  const categories = CATEGORIES.map((cat) => {
    const code = codeList.find((item) => item.id === cat.id);
    const cloudCat = cloud.categories[cat.id] || null;
    const erpCat = erp.categories[cat.id] || null;
    return {
      id: cat.id,
      jxy: cat.jxy,
      ours: cat.ours,
      expectedJxyTypes: cat.observedInJxyLogs || [],
      coverageStatus: classifyCoverage(code),
      runtimeStatus: classifyRuntime(cloudCat, erpCat),
      code,
      jxyLog: jxyLogEvidenceFor(cat, jxyLogs),
      cloud: cloudCat,
      erp: erpCat,
    };
  });
  for (const cat of categories) {
    cat.status = summarizeStatus(cat.coverageStatus, cat.runtimeStatus);
  }
  return {
    generated_at: new Date().toISOString(),
    erp_db: ERP_DB,
    cloud_db: CLOUD_DB,
    jxy_log_dir: JXY_LOG_DIR,
    jxy_log_file: JXY_LOG_FILE || null,
    options: { strict: STRICT, coverage_only: COVERAGE_ONLY, jxy_latest: JXY_LATEST },
    cloud_exists: cloud.exists,
    erp_exists: erp.exists,
    jxy_logs: {
      scannedFiles: jxyLogs.scannedFiles || 0,
      matchingFiles: jxyLogs.matchingFiles || 0,
      selectedFiles: jxyLogs.selectedFiles || [],
      error: jxyLogs.error || null,
    },
    categories,
  };
}

function printText(report) {
  console.log("Temu settlement vs Juxieyun parity check");
  console.log(`ERP DB:   ${ERP_DB}`);
  console.log(`Cloud DB: ${CLOUD_DB}`);
  console.log(`JXY logs: ${JXY_LOG_DIR}`);
  if (JXY_LOG_FILE) console.log(`JXY file: ${JXY_LOG_FILE}`);
  if (JXY_LATEST) console.log("JXY mode: latest matching settlement log only");
  if (COVERAGE_ONLY) console.log("Mode: coverage-only (runtime evidence warnings do not affect exit code)");
  console.log("");
  if (!report.cloud_exists) console.log("[WARN] cloud database not found; runtime capture evidence is unavailable");
  if (!report.erp_exists) console.log("[WARN] ERP database not found; materialized table evidence is unavailable");
  if (!report.jxy_logs.matchingFiles) console.log("[WARN] no Juxieyun settlement task logs were found");
  if (report.jxy_logs.selectedFiles?.length) {
    console.log(`[INFO] selected JXY logs: ${report.jxy_logs.selectedFiles.map((file) => path.basename(file)).join(", ")}`);
  }
  for (const cat of report.categories) {
    const tag = cat.status.level.toUpperCase().padEnd(4);
    const coverageTag = cat.coverageStatus.level.toUpperCase();
    const runtimeTag = cat.runtimeStatus.level.toUpperCase();
    const cloudRows = (cat.cloud?.rows || []).reduce((sum, row) => sum + Number(row.capture_count || 0), 0);
    const erpRows = (cat.erp || []).reduce((sum, row) => sum + Number(row.rows || 0), 0);
    console.log(`[${tag}] ${cat.id}: ${cat.jxy} -> ${cat.ours}`);
    console.log(`       coverage=${coverageTag} (${cat.coverageStatus.reason}); runtime=${runtimeTag} (${cat.runtimeStatus.reason})`);
    console.log(`       jxy_uploads=${cat.jxyLog.uploadFileCount}, cloud_captures=${cloudRows}, erp_rows=${erpRows}`);
    if (cat.expectedJxyTypes.length) console.log(`       expected_from_logs=${cat.expectedJxyTypes.join("; ")}`);
    if (cat.jxyLog.types.length) console.log(`       observed_now=${cat.jxyLog.types.join("; ")}`);
    const missingWorkerPaths = cat.coverageStatus.missingWorkerPaths || [];
    if (missingWorkerPaths.length) {
      console.log(`       note: endpoint is synced from capture but not actively fetched in worker: ${missingWorkerPaths.map((x) => x.path).join(", ")}`);
    }
  }
  const fails = report.categories.filter((cat) => cat.status.level === "fail").length;
  const warns = report.categories.filter((cat) => cat.status.level === "warn").length;
  const coverageFails = report.categories.filter((cat) => cat.coverageStatus.level === "fail").length;
  const runtimeWarns = report.categories.filter((cat) => cat.runtimeStatus.level === "warn").length;
  console.log("");
  console.log(`Summary: ${fails} fail(s), ${warns} warning(s), ${report.categories.length} category checks`);
  console.log(`Coverage: ${coverageFails} fail(s); Runtime evidence: ${runtimeWarns} warning(s)`);
}

function main() {
  const report = buildReport();
  if (AS_JSON) console.log(JSON.stringify(report, null, 2));
  else printText(report);

  if (report.categories.some((cat) => cat.coverageStatus.level === "fail")) process.exitCode = 2;
  else if (!COVERAGE_ONLY && report.categories.some((cat) => cat.status.level === "fail")) process.exitCode = 2;
  else if (STRICT && !COVERAGE_ONLY && report.categories.some((cat) => cat.status.level === "warn")) process.exitCode = 1;
}

main();
if (process.versions.electron) {
  process.exit(process.exitCode || 0);
}
