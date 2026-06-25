#!/usr/bin/env node
/**
 * 物化 Temu「结算收入汇总」：从 cloud.capture_events 抓包的 income-summary
 * （/api/merchant/front/finance/income-summary）按 (mall_id, stat_date) 落本地
 * erp_temu_settlement_income，供 MultiStoreReport 在预估营收外补一维「实际结算收入」。
 *
 * 官方开放平台无财务/结算 API，数据只能走 worker/扩展抓包 → cloud，故这里读 cloud 而非 OpenAPI。
 *
 * 手动跑（服务器）：
 *   PG_CONNECTION_STRING=postgres://... node scripts/sync-temu-settlement-income.cjs
 *   （SQLite 模式：不设 PG_CONNECTION_STRING，自动走 better-sqlite3）
 */
"use strict";

const fs = require("fs");
const path = require("path");

const { openErpDatabase, closePgPool, USE_PG, execRawSql } = require("../electron/db/connection.cjs");

const CLOUD_DB = process.env.TEMU_CLOUD_DB_PATH
  || "/opt/temu-cloud/data/temu-cloud.sqlite";

const {
  syncSettlementIncomeFromCapture,
  syncSettlementDetailFromCapture,
  syncFundDetailFromCapture,
  syncSettlementOrderDetailFromCapture,
  syncFundSummaryFromCapture,
  syncEprFeeFromCapture,
  syncFundFrozenFromCapture,
  syncAccountOverviewFromCapture,
  syncFulfillmentBillFromCapture,
  syncViolationFromCapture,
  clearMultiStoreReportCache,
} = require("../electron/erp/services/multiStoreReport.cjs");

const SETTLEMENT_MIGRATION = path.join(__dirname, "..", "electron", "db", "migrations", "081_temu_settlement_income.sql");

function log(...args) {
  console.log(new Date().toISOString(), "[temu-settlement-income]", ...args);
}

async function ensureSettlementIncomeSchema(db) {
  const sql = fs.readFileSync(SETTLEMENT_MIGRATION, "utf8");
  await execRawSql(db, sql);
}

// 与 lanServer.attachTemuCloudDbIfPossible 同构的轻量挂载（独立脚本不引 lanServer 避免副作用）。
// PG 模式下 cloud 表已在同一库，无需 ATTACH，直接返回 true。
function attachCloudDb(db) {
  if (USE_PG) return true;
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

async function runOnce(options = {}) {
  const t0 = Date.now();
  const db = options.db || openErpDatabase(options);
  try {
    await ensureSettlementIncomeSchema(db);
    const income = await syncSettlementIncomeFromCapture(db, { attachCloudDb });
    if (!income.attached) {
      log(`cloud 未挂载（${CLOUD_DB} 不存在或挂载失败），跳过`);
      return { ...income, incomeRows: 0, detailRows: 0, fundRows: 0, orderRows: 0, fundSummaryRows: 0, eprRows: 0, frozenRows: 0, accountOverviewRows: 0, fulfillmentRows: 0, violationRows: 0, elapsedMs: Date.now() - t0 };
    }
    const detail = await syncSettlementDetailFromCapture(db, { attachCloudDb });
    const fund = await syncFundDetailFromCapture(db, { attachCloudDb });
    const order = await syncSettlementOrderDetailFromCapture(db, { attachCloudDb });
    const fundSummary = await syncFundSummaryFromCapture(db, { attachCloudDb });
    // EPR 费用 / 资金限制 / 违规处罚（聚协云 P1+P2 对标）
    const epr = await syncEprFeeFromCapture(db, { attachCloudDb });
    const frozen = await syncFundFrozenFromCapture(db, { attachCloudDb });
    const accountOverview = await syncAccountOverviewFromCapture(db, { attachCloudDb });
    const fulfillment = await syncFulfillmentBillFromCapture(db, { attachCloudDb });
    const violation = await syncViolationFromCapture(db, { attachCloudDb });
    const totalRows = (Number(income.rows) || 0) + (Number(detail.rows) || 0) + (Number(fund.rows) || 0) + (Number(order.rows) || 0) + (Number(fundSummary.rows) || 0) + (Number(epr.rows) || 0) + (Number(frozen.rows) || 0) + (Number(accountOverview.rows) || 0) + (Number(fulfillment.rows) || 0) + (Number(violation.rows) || 0);
    if (totalRows > 0 && typeof clearMultiStoreReportCache === "function") {
      clearMultiStoreReportCache();
    }
    log(`done: income_malls=${income.malls} income_rows=${income.rows} detail_malls=${detail.malls} detail_rows=${detail.rows} fund_malls=${fund.malls} fund_rows=${fund.rows} order_malls=${order.malls} order_rows=${order.rows} fund_summary_malls=${fundSummary.malls} fund_summary_rows=${fundSummary.rows} epr_rows=${epr.rows} frozen_rows=${frozen.rows} account_overview_rows=${accountOverview.rows} fulfillment_rows=${fulfillment.rows} violation_rows=${violation.rows} in ${Math.round((Date.now() - t0) / 1000)}s`);
    return {
      ok: income.ok && detail.ok && fund.ok && order.ok && fundSummary.ok && epr.ok && frozen.ok && accountOverview.ok && fulfillment.ok && violation.ok,
      attached: true,
      malls: Math.max(Number(income.malls) || 0, Number(detail.malls) || 0, Number(fund.malls) || 0, Number(order.malls) || 0, Number(fundSummary.malls) || 0, Number(epr.malls) || 0, Number(frozen.malls) || 0, Number(accountOverview.malls) || 0, Number(fulfillment.malls) || 0, Number(violation.malls) || 0),
      rows: totalRows,
      incomeRows: income.rows || 0,
      detailRows: detail.rows || 0,
      fundRows: fund.rows || 0,
      orderRows: order.rows || 0,
      fundSummaryRows: fundSummary.rows || 0,
      eprRows: epr.rows || 0,
      frozenRows: frozen.rows || 0,
      accountOverviewRows: accountOverview.rows || 0,
      fulfillmentRows: fulfillment.rows || 0,
      violationRows: violation.rows || 0,
      income,
      detail,
      fund,
      order,
      fundSummary,
      epr,
      frozen,
      accountOverview,
      fulfillment,
      violation,
      elapsedMs: Date.now() - t0,
    };
  } finally {
    if (!options.db) {
      if (USE_PG) {
        await closePgPool();
      } else {
        db.close();
      }
    }
  }
}

async function main() {
  const result = await runOnce();
  if (result && result.attached === false) process.exit(2);
  if (result && result.ok === false) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  runOnce,
  attachCloudDb,
  ensureSettlementIncomeSchema,
};
