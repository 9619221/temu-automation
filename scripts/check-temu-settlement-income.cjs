#!/usr/bin/env node
/**
 * Read-only preflight for Temu settlement income collection.
 *
 * It checks the cloud capture table, sample payload shape, query plan, and ERP
 * materialized table status without writing to either database.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { relaunchUnderElectronIfNeeded } = require("./ensure-electron-runtime.cjs");
relaunchUnderElectronIfNeeded(__filename);

const Database = require("better-sqlite3");

const SETTLEMENT_INCOME_PATH = "/api/merchant/front/finance/income-summary";
const SETTLEMENT_DETAIL_PATHS = [
  "/api/merchant/settle/detail/full/wait-settlement",
  "/api/merchant/settle/detail/full/in-settlement",
  "/api/merchant/settle/detail/full/settled",
];
const SETTLEMENT_ORDER_DETAIL_PATH = "/api/merchant/fund/detail/item/semi/download";
const FUND_SUMMARY_PATHS = [
  "/api/merchant/fund/detail/daySummary",
  "/api/merchant/fund/detail/monthSummary",
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

const ERP_DB = argValue("--erp-db") || process.env.ERP_DB || process.env.ERP_DB_PATH || defaultErpDb();
const CLOUD_DB = argValue("--cloud-db") || process.env.TEMU_CLOUD_DB_PATH || defaultCloudDb();
const AS_JSON = hasFlag("--json");
const DEEP = hasFlag("--deep");

const report = {
  generated_at: new Date().toISOString(),
  erp_db: ERP_DB,
  cloud_db: CLOUD_DB,
  options: { deep: DEEP },
  checks: [],
  cloud: {},
  erp: {},
};

function addCheck(level, id, message, data) {
  report.checks.push({ level, id, message, ...(data ? { data } : {}) });
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function tableColumns(db, name) {
  return db.prepare(`PRAGMA table_info(${name})`).all().map((row) => row.name);
}

function extractSettlementIncomeListFromCaptureBody(body) {
  const candidates = [
    body?.result,
    body?.result?.data,
    body?.result?.list,
    body?.result?.rows,
    body?.result?.items,
    body?.result?.records,
    body?.result?.incomeSummaryList,
    body?.data?.result,
    body?.data?.data,
    body?.data?.list,
    body?.data?.rows,
    body?.data?.items,
    body?.data?.records,
    body?.data?.incomeSummaryList,
    body?.data,
    body?.list,
    body?.rows,
    body?.items,
    body?.records,
    body?.incomeSummaryList,
    body,
  ];
  return candidates.find((value) => Array.isArray(value)) || [];
}

function firstDefined(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function normalizeSettlementDate(item) {
  const raw = firstDefined(item, [
    "date", "statDate", "stat_date", "dateStr", "dataDate", "day", "pt",
    "settleDate", "settlementDate",
  ]);
  if (raw === null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const match = text.match(/\d{4}-\d{2}-\d{2}/) || text.match(/\d{4}\/\d{2}\/\d{2}/);
  return (match ? match[0] : text.slice(0, 10)).replace(/\//g, "-");
}

function pickSettlementAmount(item) {
  return firstDefined(item, [
    "incomeAmount", "amount", "income", "incomeAmt", "settlementIncome",
    "settleAmount", "settlementAmount", "value",
  ]);
}

function parseIncomeAmount(value) {
  const amount = value && typeof value === "object" ? value : {};
  const cents = Number(amount.amount);
  if (Number.isFinite(cents)) return { yuan: cents / 100, cents: Math.round(cents), source: "amount_cents" };
  const yuan = Number(amount.digitalText ?? amount.fullText ?? value);
  return {
    yuan: Number.isFinite(yuan) ? yuan : null,
    cents: Number.isFinite(yuan) ? Math.round(yuan * 100) : null,
    source: Number.isFinite(yuan) ? "text_yuan" : "unparsed",
  };
}

function openReadonly(dbPath) {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function inspectCloudDeep(db, summary) {
  if (!DEEP) return;

  const events = db.prepare(`
    SELECT mall_id, body_json, received_at
      FROM capture_events
     WHERE url_path = ? AND mall_id IS NOT NULL AND mall_id <> ''
     ORDER BY received_at ASC
  `).all(SETTLEMENT_INCOME_PATH);

  const byMall = new Map();
  let invalidJson = 0;
  let eventsWithRows = 0;
  let parsedItems = 0;
  let earliestDate = null;
  let latestDate = null;
  let minIncome = null;
  let maxIncome = null;

  for (const ev of events) {
    let body;
    try { body = JSON.parse(ev.body_json); } catch { invalidJson++; continue; }
    const list = extractSettlementIncomeListFromCaptureBody(body);
    if (!Array.isArray(list) || !list.length) continue;
    eventsWithRows++;
    const mallId = String(ev.mall_id || "").trim();
    if (!mallId) continue;
    if (!byMall.has(mallId)) byMall.set(mallId, new Map());
    const dayMap = byMall.get(mallId);
    for (const item of list) {
      const statDate = normalizeSettlementDate(item);
      if (!item || !statDate) continue;
      const parsed = parseIncomeAmount(pickSettlementAmount(item));
      parsedItems++;
      dayMap.set(statDate, {
        stat_date: statDate,
        income_yuan: parsed.yuan,
        amount_source: parsed.source,
        received_at: ev.received_at,
      });
      if (!earliestDate || statDate < earliestDate) earliestDate = statDate;
      if (!latestDate || statDate > latestDate) latestDate = statDate;
      if (Number.isFinite(parsed.yuan)) {
        minIncome = minIncome == null ? parsed.yuan : Math.min(minIncome, parsed.yuan);
        maxIncome = maxIncome == null ? parsed.yuan : Math.max(maxIncome, parsed.yuan);
      }
    }
  }

  let candidateRows = 0;
  for (const dayMap of byMall.values()) candidateRows += dayMap.size;

  const detail = {
    events_scanned: events.length,
    invalid_json: invalidJson,
    events_with_rows: eventsWithRows,
    parsed_items: parsedItems,
    candidate_malls: byMall.size,
    candidate_rows: candidateRows,
    earliest_date: earliestDate,
    latest_date: latestDate,
    min_income_yuan: minIncome,
    max_income_yuan: maxIncome,
  };
  report.cloud.deep = detail;

  if (summary.capture_count && candidateRows <= 0) {
    addCheck("fail", "income_summary_deep_no_candidates", "deep scan found no syncable mall/date rows", detail);
  } else if (candidateRows > 0) {
    addCheck("ok", "income_summary_deep_candidates", "deep scan found syncable mall/date rows", detail);
  }
}

function inspectCloud() {
  report.cloud.exists = fs.existsSync(CLOUD_DB);
  if (!report.cloud.exists) {
    addCheck("fail", "cloud_db_missing", `cloud database not found: ${CLOUD_DB}`);
    return;
  }

  const db = openReadonly(CLOUD_DB);
  try {
    report.cloud.capture_events_exists = tableExists(db, "capture_events");
    if (!report.cloud.capture_events_exists) {
      addCheck("fail", "capture_events_missing", "cloud.capture_events table is missing");
      return;
    }

    const columns = tableColumns(db, "capture_events");
    report.cloud.capture_events_columns = columns;
    const required = ["url_path", "mall_id", "body_json", "received_at"];
    const missing = required.filter((name) => !columns.includes(name));
    if (missing.length) {
      addCheck("fail", "capture_events_columns_missing", "capture_events is missing required columns", { missing });
      return;
    }
    addCheck("ok", "capture_events_schema", "capture_events schema has required columns");

    const summary = db.prepare(`
      SELECT COUNT(*) AS capture_count,
             COUNT(DISTINCT NULLIF(mall_id, '')) AS mall_count,
             SUM(CASE WHEN mall_id IS NULL OR mall_id = '' THEN 1 ELSE 0 END) AS empty_mall_count,
             MAX(received_at) AS latest_received_at
        FROM capture_events
       WHERE url_path = ?
    `).get(SETTLEMENT_INCOME_PATH);
    report.cloud.summary = summary;

    const detailSummary = db.prepare(`
      SELECT url_path,
             COUNT(*) AS capture_count,
             COUNT(DISTINCT NULLIF(mall_id, '')) AS mall_count,
             SUM(CASE WHEN mall_id IS NULL OR mall_id = '' THEN 1 ELSE 0 END) AS empty_mall_count,
             MAX(received_at) AS latest_received_at
        FROM capture_events
       WHERE url_path IN (${SETTLEMENT_DETAIL_PATHS.map(() => "?").join(",")})
       GROUP BY url_path
       ORDER BY url_path
    `).all(...SETTLEMENT_DETAIL_PATHS);
    const detailTotal = detailSummary.reduce((acc, row) => acc + Number(row.capture_count || 0), 0);
    report.cloud.settlement_detail_summary = detailSummary;

    const orderSummary = db.prepare(`
      SELECT COUNT(*) AS capture_count,
             COUNT(DISTINCT NULLIF(mall_id, '')) AS mall_count,
             SUM(CASE WHEN mall_id IS NULL OR mall_id = '' THEN 1 ELSE 0 END) AS empty_mall_count,
             MAX(received_at) AS latest_received_at
        FROM capture_events
       WHERE url_path = ?
    `).get(SETTLEMENT_ORDER_DETAIL_PATH);
    report.cloud.settlement_order_detail_summary = orderSummary;

    const fundSummary = db.prepare(`
      SELECT url_path,
             COUNT(*) AS capture_count,
             COUNT(DISTINCT NULLIF(mall_id, '')) AS mall_count,
             SUM(CASE WHEN mall_id IS NULL OR mall_id = '' THEN 1 ELSE 0 END) AS empty_mall_count,
             MAX(received_at) AS latest_received_at
        FROM capture_events
       WHERE url_path IN (${FUND_SUMMARY_PATHS.map(() => "?").join(",")})
       GROUP BY url_path
       ORDER BY url_path
    `).all(...FUND_SUMMARY_PATHS);
    const fundSummaryTotal = fundSummary.reduce((acc, row) => acc + Number(row.capture_count || 0), 0);
    report.cloud.fund_summary = fundSummary;

    if (!summary.capture_count && detailTotal <= 0 && !orderSummary.capture_count && fundSummaryTotal <= 0) {
      addCheck("fail", "finance_captures_missing", "no income-summary, wait/in/settled, settlement order, or fund summary capture_events found");
    } else if (!summary.capture_count) {
      addCheck("warn", "income_summary_missing", "no income-summary capture_events found; other settlement captures can still sync");
    } else {
      addCheck("ok", "income_summary_present", "income-summary captures found", summary);
      if (Number(summary.empty_mall_count) > 0) {
        addCheck("warn", "income_summary_empty_mall_id", "some income-summary captures have empty mall_id and will be ignored", {
          empty_mall_count: summary.empty_mall_count,
        });
      }
    }

    if (detailTotal > 0) {
      addCheck("ok", "settlement_detail_present", "settlement detail captures found", { total: detailTotal, endpoints: detailSummary });
    } else {
      addCheck("warn", "settlement_detail_missing", "no wait/in/settled settlement detail captures found yet");
    }

    if (Number(orderSummary.capture_count) > 0) {
      addCheck("ok", "settlement_order_detail_present", "settlement order detail captures found", orderSummary);
    } else {
      addCheck("warn", "settlement_order_detail_missing", "no settlement order detail captures found yet");
    }

    if (fundSummaryTotal > 0) {
      addCheck("ok", "fund_summary_present", "fund day/month summary captures found", { total: fundSummaryTotal, endpoints: fundSummary });
    } else {
      addCheck("warn", "fund_summary_missing", "no fund day/month summary captures found yet");
    }

    const planRows = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT mall_id, body_json, received_at
        FROM capture_events
       WHERE url_path = ? AND mall_id IS NOT NULL AND mall_id <> ''
       ORDER BY received_at ASC
    `).all(SETTLEMENT_INCOME_PATH);
    report.cloud.query_plan = planRows.map((row) => row.detail || JSON.stringify(row));
    const planText = report.cloud.query_plan.join(" | ");
    if (/SCAN capture_events/i.test(planText) && !/USING INDEX/i.test(planText)) {
      addCheck("warn", "capture_query_full_scan", "income-summary sync query appears to full-scan capture_events", { plan: report.cloud.query_plan });
    } else {
      addCheck("ok", "capture_query_plan", "income-summary sync query has an indexed/optimized plan", { plan: report.cloud.query_plan });
    }

    const samples = db.prepare(`
      SELECT mall_id, body_json, received_at
        FROM capture_events
       WHERE url_path = ? AND mall_id IS NOT NULL AND mall_id <> ''
       ORDER BY received_at DESC
       LIMIT 5
    `).all(SETTLEMENT_INCOME_PATH);
    let parsedRows = 0;
    let firstParsed = null;
    for (const sample of samples) {
      let body;
      try { body = JSON.parse(sample.body_json); } catch { continue; }
      const list = extractSettlementIncomeListFromCaptureBody(body);
      parsedRows += list.length;
      if (!firstParsed && list.length) {
        const item = list.find((row) => row && normalizeSettlementDate(row)) || list[0];
        const parsed = parseIncomeAmount(pickSettlementAmount(item));
        firstParsed = {
          mall_id: sample.mall_id,
          received_at: sample.received_at,
          date: normalizeSettlementDate(item) || null,
          amount_source: parsed.source,
          income_yuan: parsed.yuan,
          income_cents: parsed.cents,
          currency: item?.incomeAmount?.currencyCode || item?.currency || null,
        };
      }
    }
    report.cloud.sample = { samples_checked: samples.length, parsed_rows: parsedRows, first_parsed: firstParsed };
    if (summary.capture_count && parsedRows <= 0) {
      addCheck("fail", "income_summary_unparsed", "latest income-summary payloads did not expose a parseable list");
    } else if (firstParsed) {
      addCheck("ok", "income_summary_parse_sample", "latest income-summary payload is parseable", firstParsed);
      if (firstParsed.amount_source === "amount_cents") {
        addCheck("warn", "amount_unit_verify", "incomeAmount.amount is interpreted as cents; compare one sample with the seller dashboard before go-live", firstParsed);
      }
    }
    inspectCloudDeep(db, summary);
  } finally {
    db.close();
  }
}

function inspectErp() {
  report.erp.exists = fs.existsSync(ERP_DB);
  if (!report.erp.exists) {
    addCheck("warn", "erp_db_missing", `ERP database not found: ${ERP_DB}`);
    return;
  }

  const db = openReadonly(ERP_DB);
  try {
    report.erp.settlement_table_exists = tableExists(db, "erp_temu_settlement_income");
    if (!report.erp.settlement_table_exists) {
      addCheck("warn", "settlement_table_missing", "erp_temu_settlement_income does not exist yet; first sync will create it");
    } else {
      const summary = db.prepare(`
        SELECT COUNT(*) AS rows,
               COUNT(DISTINCT NULLIF(mall_id, '')) AS mall_count,
               MAX(stat_date) AS latest_date,
               MAX(synced_at) AS latest_synced_at
          FROM erp_temu_settlement_income
      `).get();
      report.erp.summary = summary;
      if (!summary.rows) {
        addCheck("warn", "settlement_table_empty", "erp_temu_settlement_income exists but has no rows");
      } else {
        addCheck("ok", "settlement_table_populated", "ERP settlement table has rows", summary);
      }

      if (tableExists(db, "erp_temu_malls")) {
        const missingMalls = db.prepare(`
          SELECT DISTINCT s.mall_id
            FROM erp_temu_settlement_income s
            LEFT JOIN erp_temu_malls m ON m.mall_id = s.mall_id
           WHERE s.mall_id IS NOT NULL AND s.mall_id <> ''
             AND m.mall_id IS NULL
           LIMIT 10
        `).all().map((row) => row.mall_id);
        report.erp.unmatched_mall_ids = missingMalls;
        if (missingMalls.length) {
          addCheck("warn", "settlement_mall_unmatched", "some settlement mall_id values are not in erp_temu_malls", { mall_ids: missingMalls });
        } else if (summary.rows) {
          addCheck("ok", "settlement_mall_match", "settlement mall_id values match erp_temu_malls");
        }
      } else {
        addCheck("warn", "mall_dictionary_missing", "erp_temu_malls does not exist; report store-name matching cannot be verified");
      }
    }

    report.erp.settlement_detail_table_exists = tableExists(db, "erp_temu_settlement_detail");
    if (!report.erp.settlement_detail_table_exists) {
      addCheck("warn", "settlement_detail_table_missing", "erp_temu_settlement_detail does not exist yet; first sync will create it");
    } else {
      const detail = db.prepare(`
        SELECT COUNT(*) AS rows,
               COUNT(DISTINCT NULLIF(mall_id, '')) AS mall_count,
               MAX(stat_date) AS latest_date,
               MAX(synced_at) AS latest_synced_at
          FROM erp_temu_settlement_detail
      `).get();
      report.erp.settlement_detail_summary = detail;
      if (!detail.rows) {
        addCheck("warn", "settlement_detail_table_empty", "erp_temu_settlement_detail exists but has no rows");
      } else {
        addCheck("ok", "settlement_detail_table_populated", "ERP settlement detail table has rows", detail);
      }
    }

    report.erp.settlement_order_detail_table_exists = tableExists(db, "erp_temu_settlement_order_detail");
    if (!report.erp.settlement_order_detail_table_exists) {
      addCheck("warn", "settlement_order_detail_table_missing", "erp_temu_settlement_order_detail does not exist yet; first sync will create it");
    } else {
      const orderDetail = db.prepare(`
        SELECT COUNT(*) AS rows,
               COUNT(DISTINCT NULLIF(mall_id, '')) AS mall_count,
               COUNT(DISTINCT NULLIF(batch_id, '')) AS batch_count,
               MAX(updated_at) AS latest_updated_at
          FROM erp_temu_settlement_order_detail
      `).get();
      report.erp.settlement_order_detail_summary = orderDetail;
      if (!orderDetail.rows) {
        addCheck("warn", "settlement_order_detail_table_empty", "erp_temu_settlement_order_detail exists but has no rows");
      } else {
        addCheck("ok", "settlement_order_detail_table_populated", "ERP settlement order detail table has rows", orderDetail);
      }
    }

    report.erp.fund_summary_table_exists = tableExists(db, "erp_temu_fund_summary");
    if (!report.erp.fund_summary_table_exists) {
      addCheck("warn", "fund_summary_table_missing", "erp_temu_fund_summary does not exist yet; first sync will create it");
    } else {
      const fund = db.prepare(`
        SELECT COUNT(*) AS rows,
               COUNT(DISTINCT NULLIF(mall_id, '')) AS mall_count,
               MAX(summary_date) AS latest_summary_date,
               MAX(updated_at) AS latest_updated_at
          FROM erp_temu_fund_summary
      `).get();
      report.erp.fund_summary = fund;
      if (!fund.rows) {
        addCheck("warn", "fund_summary_table_empty", "erp_temu_fund_summary exists but has no rows");
      } else {
        addCheck("ok", "fund_summary_table_populated", "ERP fund summary table has rows", fund);
      }
    }
  } finally {
    db.close();
  }
}

function printText() {
  console.log(`Temu settlement income preflight`);
  console.log(`ERP DB:   ${ERP_DB}`);
  console.log(`Cloud DB: ${CLOUD_DB}`);
  console.log("");
  for (const check of report.checks) {
    const tag = check.level.toUpperCase().padEnd(4);
    console.log(`[${tag}] ${check.id}: ${check.message}`);
    if (check.data) console.log(`       ${JSON.stringify(check.data)}`);
  }
  const fails = report.checks.filter((item) => item.level === "fail").length;
  const warns = report.checks.filter((item) => item.level === "warn").length;
  console.log("");
  console.log(`Summary: ${fails} fail(s), ${warns} warning(s), ${report.checks.length} check(s)`);
}

function main() {
  try {
    inspectCloud();
    inspectErp();
  } catch (error) {
    addCheck("fail", "preflight_error", error?.message || String(error));
  }

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText();
  }

  if (report.checks.some((item) => item.level === "fail")) process.exitCode = 2;
  else if (report.checks.some((item) => item.level === "warn")) process.exitCode = 1;
}

main();
if (process.versions.electron) {
  process.exit(process.exitCode || 0);
}
