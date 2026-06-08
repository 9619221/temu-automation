#!/usr/bin/env node
/**
 * 物化 Temu「结算收入汇总」：从 cloud.capture_events 抓包的 income-summary
 * （/api/merchant/front/finance/income-summary）按 (mall_id, stat_date) 落本地
 * erp_temu_settlement_income，供 MultiStoreReport 在预估营收外补一维「实际结算收入」。
 *
 * 官方开放平台无财务/结算 API，数据只能走 worker/扩展抓包 → cloud，故这里读 cloud 而非 OpenAPI。
 *
 * 手动跑（服务器）：
 *   ERP_DB=/opt/temu-erp-data/erp.sqlite \
 *   TEMU_CLOUD_DB_PATH=/opt/temu-cloud/data/temu-cloud.sqlite \
 *   node scripts/sync-temu-settlement-income.cjs
 */
"use strict";

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const ERP_DB = process.env.ERP_DB
  || process.env.ERP_DB_PATH
  || path.join(process.env.ERP_DATA_DIR || "/opt/temu-erp-data", "erp.sqlite");

const CLOUD_DB = process.env.TEMU_CLOUD_DB_PATH
  || "/opt/temu-cloud/data/temu-cloud.sqlite";

const {
  syncSettlementIncomeFromCapture,
  syncSettlementDetailFromCapture,
  syncFundDetailFromCapture,
  clearMultiStoreReportCache,
} = require("../electron/erp/services/multiStoreReport.cjs");

const SETTLEMENT_MIGRATION = path.join(__dirname, "..", "electron", "db", "migrations", "081_temu_settlement_income.sql");

function log(...args) {
  console.log(new Date().toISOString(), "[temu-settlement-income]", ...args);
}

function ensureSettlementIncomeSchema(db) {
  db.exec(fs.readFileSync(SETTLEMENT_MIGRATION, "utf8"));
}

// 与 lanServer.attachTemuCloudDbIfPossible 同构的轻量挂载（独立脚本不引 lanServer 避免副作用）。
function attachCloudDb(db) {
  if (db.__cloudAttachState === "attached") return true;
  if (db.__cloudAttachState === "failed") return false;
  try {
    if (!fs.existsSync(CLOUD_DB)) { db.__cloudAttachState = "failed"; return false; }
    db.exec(`ATTACH DATABASE '${CLOUD_DB.replace(/'/g, "''")}' AS cloud`);
    db.__cloudAttachState = "attached";
    return true;
  } catch (error) {
    db.__cloudAttachState = "failed";
    log("attach cloud failed:", error?.message || String(error));
    return false;
  }
}

function runOnce(options = {}) {
  const t0 = Date.now();
  const dbPath = options.erpDb || options.erpDbPath || ERP_DB;
  const db = new Database(dbPath);
  db.pragma("busy_timeout=60000");
  try {
    ensureSettlementIncomeSchema(db);
    const income = syncSettlementIncomeFromCapture(db, { attachCloudDb });
    if (!income.attached) {
      log(`cloud 未挂载（${CLOUD_DB} 不存在或挂载失败），跳过`);
      return { ...income, incomeRows: 0, detailRows: 0, elapsedMs: Date.now() - t0 };
    }
    const detail = syncSettlementDetailFromCapture(db, { attachCloudDb });
    const fund = syncFundDetailFromCapture(db, { attachCloudDb });
    if ((income.rows > 0 || detail.rows > 0 || fund.rows > 0) && typeof clearMultiStoreReportCache === "function") {
      clearMultiStoreReportCache();
    }
    log(`done: income_malls=${income.malls} income_rows=${income.rows} detail_malls=${detail.malls} detail_rows=${detail.rows} fund_malls=${fund.malls} fund_rows=${fund.rows} in ${Math.round((Date.now() - t0) / 1000)}s`);
    return {
      ok: income.ok && detail.ok && fund.ok,
      attached: true,
      malls: Math.max(Number(income.malls) || 0, Number(detail.malls) || 0, Number(fund.malls) || 0),
      rows: (Number(income.rows) || 0) + (Number(detail.rows) || 0) + (Number(fund.rows) || 0),
      incomeRows: income.rows || 0,
      detailRows: detail.rows || 0,
      fundRows: fund.rows || 0,
      income,
      detail,
      fund,
      elapsedMs: Date.now() - t0,
    };
  } finally {
    db.close();
  }
}

function main() {
  const result = runOnce();
  if (result && result.attached === false) process.exit(2);
  if (result && result.ok === false) process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  runOnce,
  attachCloudDb,
  ensureSettlementIncomeSchema,
};
