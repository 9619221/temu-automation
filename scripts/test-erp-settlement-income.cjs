// 自测：Temu 结算收入（income-summary 抓包）采集 + 物化 + 报表聚合
// 跑：set ELECTRON_RUN_AS_NODE=1 && node scripts/test-erp-settlement-income.cjs
//   或 普通 node（若 better-sqlite3 ABI 兼容）

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { relaunchUnderElectronIfNeeded } = require("./ensure-electron-runtime.cjs");
relaunchUnderElectronIfNeeded(__filename);

const Database = require("better-sqlite3");

const db = new Database(":memory:");

// 用真实 migration 建表，确保测试与生产 schema 一致
const migPath = path.join(__dirname, "..", "electron", "db", "migrations", "081_temu_settlement_income.sql");
db.exec(fs.readFileSync(migPath, "utf8"));

const svc = require(path.join(__dirname, "..", "electron", "erp", "services", "multiStoreReport.cjs"));
const {
  extractSettlementIncomeRows,
  upsertSettlementIncomeFromDashboard,
  syncSettlementIncomeFromCapture,
  syncSettlementDetailFromCapture,
  syncSettlementOrderDetailFromCapture,
  syncFundSummaryFromCapture,
  buildSettlementIncomeByMall,
  extractSettlementIncomeListFromCaptureBody,
  SETTLEMENT_INCOME_PATH,
  SETTLEMENT_DETAIL_PATHS,
  SETTLEMENT_ORDER_DETAIL_PATH,
  FUND_SUMMARY_PATHS,
  buildFundSummaryByMall,
  buildSettlementRiskByMall,
  syncEprFeeFromCapture,
  buildEprFeeByMall,
  syncFundFrozenFromCapture,
  buildFundFrozenByMall,
  syncViolationFromCapture,
  buildViolationByMall,
  syncAccountOverviewFromCapture,
  buildAccountOverviewByMall,
  syncFulfillmentBillFromCapture,
  buildFulfillmentBillByMall,
  EPR_FEE_PATHS,
  FUND_FROZEN_PATH,
  VIOLATION_LIST_PATH,
  VIOLATION_SUMMARY_PATH,
  ACCOUNT_OVERVIEW_PATH,
  FULFILLMENT_PATHS,
} = svc._internal;

let pass = 0, fail = 0;
function ok(label, cond) {
  console.log(`  ${cond ? "✅" : "❌"} ${label}`);
  if (cond) pass++; else fail++;
}
function near(label, actual, expected) {
  const c = Math.abs(Number(actual) - Number(expected)) < 0.001;
  console.log(`  ${c ? "✅" : "❌"} ${label}  实际=${actual}  期望=${expected}`);
  if (c) pass++; else fail++;
}

// dashboard 抓包原始体：apis:[{path, data:{result:[{date, incomeAmount}]}}]
function dashboard(mallId, rows) {
  return {
    mallId,
    dashboard: {
      apis: [
        { path: "/auth/userInfo", data: { result: { mallList: [{ mallId }] } } },
        { path: SETTLEMENT_INCOME_PATH, data: { result: rows } },
      ],
    },
  };
}

console.log("\n=== 1) 解析：cents 优先，digitalText 兜底 ===\n");
{
  const rows = extractSettlementIncomeRows(
    dashboard("MALL-A", [
      { date: "2026-06-05", incomeAmount: { amount: 12345, currencyCode: "USD" } }, // 分→123.45
      { date: "2026-06-06", incomeAmount: { digitalText: "200.50" } },              // 文本→200.50
      { date: "2026-06-07", incomeAmount: { fullText: "￥10" } },                    // 仅 fullText 非数字→0
      { statDate: "2026-06-08", income: { amount: 32100 } },
    ]).dashboard,
    { mallId: "MALL-A" }
  );
  ok("解析出 4 行", rows.length === 4);
  near("第1行金额(分→元)=123.45", rows[0].income_amount, 123.45);
  ok("第1行 cents=12345", rows[0].income_amount_cents === 12345);
  ok("第1行币种=USD", rows[0].currency === "USD");
  near("第2行金额(digitalText)=200.50", rows[1].income_amount, 200.5);
  ok("第2行币种默认 CNY", rows[1].currency === "CNY");
  ok("statDate 和 income 字段兜底", rows[3].stat_date === "2026-06-08" && rows[3].income_amount === 321);
  ok("scope_key 用 mall_id", rows[0].scope_key === "MALL-A");
  ok("result.rows 列表形态可解析", extractSettlementIncomeListFromCaptureBody({ result: { rows: [{ date: "2026-06-09" }] } }).length === 1);
  const nestedRows = extractSettlementIncomeRows({
    apis: [{ path: SETTLEMENT_INCOME_PATH, data: { result: { rows: [{ dateStr: "2026/06/09", settleAmount: { amount: 12300, currencyCode: "USD" } }] } } }],
  }, { mallId: "MALL-A" });
  ok("dashboard result.rows 入口也能解析", nestedRows.length === 1 && nestedRows[0].stat_date === "2026-06-09" && nestedRows[0].currency === "USD");
}

console.log("\n=== 2) UPSERT：累积历史 + 同日冲突覆盖 ===\n");
{
  upsertSettlementIncomeFromDashboard(db, dashboard("MALL-A", [
    { date: "2026-06-05", incomeAmount: { amount: 10000 } }, // 100.00
    { date: "2026-06-06", incomeAmount: { amount: 20000 } }, // 200.00
  ]));
  let cnt = db.prepare("SELECT COUNT(*) c FROM erp_temu_settlement_income WHERE mall_id='MALL-A'").get().c;
  ok("首次写入 2 行", cnt === 2);

  // 再来一批：06-06 改值（覆盖），新增 06-07（累积），06-05 不在本批（保留）
  upsertSettlementIncomeFromDashboard(db, dashboard("MALL-A", [
    { date: "2026-06-06", incomeAmount: { amount: 25000 } }, // 250.00 覆盖
    { date: "2026-06-07", incomeAmount: { amount: 30000 } }, // 300.00 新增
  ]));
  cnt = db.prepare("SELECT COUNT(*) c FROM erp_temu_settlement_income WHERE mall_id='MALL-A'").get().c;
  ok("累积后共 3 行（06-05 保留，06-07 新增）", cnt === 3);
  const d06 = db.prepare("SELECT income_amount a FROM erp_temu_settlement_income WHERE mall_id='MALL-A' AND stat_date='2026-06-06'").get();
  near("06-06 被覆盖为 250.00", d06.a, 250);
  const d05 = db.prepare("SELECT income_amount a FROM erp_temu_settlement_income WHERE mall_id='MALL-A' AND stat_date='2026-06-05'").get();
  near("06-05 窗口外仍保留 100.00", d05.a, 100);
}

console.log("\n=== 3) 报表聚合 buildSettlementIncomeByMall（today/7d/30d/wow）===\n");
{
  // 重置成可控数据：latest=06-30；今天 500；7天窗口(06-24..06-30)再加一天 100=600；
  // 前7天窗口(06-17..06-23) 放 300 用于算 wow
  db.exec("DELETE FROM erp_temu_settlement_income");
  upsertSettlementIncomeFromDashboard(db, dashboard("MALL-B", [
    { date: "2026-06-30", incomeAmount: { amount: 50000 } }, // today=500
    { date: "2026-06-25", incomeAmount: { amount: 10000 } }, // 在7天窗口内=100
    { date: "2026-06-20", incomeAmount: { amount: 30000 } }, // 前7天窗口=300（wow 基数）
  ]));
  const m = buildSettlementIncomeByMall(db);
  ok("返回 Map", m && typeof m.get === "function");
  const b = m.get("MALL-B");
  ok("含 MALL-B", !!b);
  ok("latest_date=2026-06-30", b.latest_date === "2026-06-30");
  near("today.income=500", b.today.income, 500);
  near("last7d.income=600", b.last7d.income, 600);
  near("last7d.income_prev=300", b.last7d.income_prev, 300);
  near("last7d.income_wow=(600-300)/300=1", b.last7d.income_wow, 1);
  near("last30d.income=900", b.last30d.income, 900);
  ok("trend_daily 升序 3 天", b.trend_daily.length === 3 && b.trend_daily[0].date === "2026-06-20");
}

console.log("\n=== 4) 维度可用性语义（对齐 buildFinancialsByMall）===\n");
{
  // 表存在但无数据 → 返回空 Map（维度可用，只是暂无数据，前端显示 ¥0 而非「不可用」）
  const empty = new Database(":memory:");
  empty.exec(fs.readFileSync(migPath, "utf8"));
  const m = buildSettlementIncomeByMall(empty);
  ok("空表返回空 Map（非 null）", m && typeof m.get === "function" && m.size === 0);
  empty.close();

  // 表不存在（迁移未跑）→ 返回 null（维度不可用）
  const noTable = new Database(":memory:");
  ok("无表返回 null", buildSettlementIncomeByMall(noTable) === null);
  noTable.close();
}

console.log("\n=== 5) capture 同步 syncSettlementIncomeFromCapture（读 cloud.capture_events）===\n");
{
  // 用真实 ATTACH 一个独立 sqlite 充当 cloud，建最小 capture_events 表
  const cloudFile = path.join(require("os").tmpdir(), `test-cloud-${process.pid}.sqlite`);
  try { fs.unlinkSync(cloudFile); } catch {}
  const erp2 = new Database(":memory:");
  erp2.exec(fs.readFileSync(migPath, "utf8"));
  const attachCloudDb = (d) => {
    if (d.__cloudAttachState === "attached") return true;
    d.exec(`ATTACH DATABASE '${cloudFile.replace(/'/g, "''")}' AS cloud`);
    d.exec(`CREATE TABLE IF NOT EXISTS cloud.capture_events (
      mall_id TEXT, url_path TEXT, body_json TEXT, received_at INTEGER
    )`);
    d.exec(`CREATE TABLE IF NOT EXISTS cloud.temu_operation_risk_snapshot (
      mall_id TEXT,
      risk_type TEXT,
      severity TEXT,
      stat_date TEXT
    )`);
    d.__cloudAttachState = "attached";
    return true;
  };
  attachCloudDb(erp2);
  const insEv = erp2.prepare("INSERT INTO cloud.capture_events (mall_id, url_path, body_json, received_at) VALUES (?,?,?,?)");
  // 同店两次抓包，06-10 后一次(received_at 大)覆盖前一次
  insEv.run("MALL-C", SETTLEMENT_INCOME_PATH, JSON.stringify({ result: [
    { date: "2026-06-10", incomeAmount: { amount: 10000 } }, // 旧:100
  ] }), 1000);
  insEv.run("MALL-C", SETTLEMENT_INCOME_PATH, JSON.stringify({ result: [
    { date: "2026-06-10", incomeAmount: { amount: 15000 } }, // 新:150 覆盖
    { date: "2026-06-11", incomeAmount: { amount: 20000 } }, // 新增:200
  ] }), 2000);
  insEv.run("MALL-D", SETTLEMENT_INCOME_PATH, JSON.stringify({ data: { result: [
    { date: "2026-06-12", incomeAmount: { amount: 8000 } },
  ] } }), 3000);
  insEv.run("MALL-E", SETTLEMENT_INCOME_PATH, JSON.stringify({ result: { rows: [
    { dateStr: "2026/06/13", settleAmount: { amount: 9900 } },
  ] } }), 4000);
  insEv.run("MALL-F", SETTLEMENT_DETAIL_PATHS[2], JSON.stringify({ result: { data: { list: [
    {
      statDate: "2026-06-14",
      settlementOrderSn: "SETTLE-001",
      estimatedWaitSettlementAmount: { amount: 30000 },
      salesReceiptAmount: { amount: 24525, currencyCode: "CNY" },
      salesChargebackAmount: { amount: 690 },
      nonSellerResponsibilitySubsidy: { amount: 4353 },
    },
  ] } } }), 5000);
  insEv.run("MALL-G", SETTLEMENT_ORDER_DETAIL_PATH, JSON.stringify({
    success: true,
    batchId: "BATCH-001",
    fundType: "100",
    createTime: "2026-06-14 10:00:00",
    currency: "USD",
    sheetName: "Sheet1",
    columns: ["订单号", "商家SKU", "数量", "结算金额", "币种"],
    rowCount: 2,
    rows: [
      { "订单号": "PO-1", "商家SKU": "SKU-A", "数量": 2, "结算金额": "12.34", "币种": "USD" },
      { "订单号": "PO-2", "商品SKU ID": "SKU-ID-B", "数量": "3", "金额": "￥45.67" },
    ],
  }), 6000);
  insEv.run("MALL-H", FUND_SUMMARY_PATHS[0], JSON.stringify({ result: [
    {
      statDate: "2026-06-14",
      incomeAmount: { amount: 10000, currencyCode: "USD" },
      expenseAmount: { amount: 2300 },
      frozenAmount: { amount: 4500 },
      availableBalance: { amount: 70000 },
      totalAmount: { amount: 77700 },
    },
  ] }), 7000);
  insEv.run("MALL-H", FUND_SUMMARY_PATHS[1], JSON.stringify({ result: { rows: [
    {
      month: "2026-06",
      totalIncome: "123.45",
      totalExpense: "23.45",
      accountBalance: "100.00",
      restrictedAmount: "9.99",
    },
  ] } }), 8000);
  const insRisk = erp2.prepare("INSERT INTO cloud.temu_operation_risk_snapshot (mall_id, risk_type, severity, stat_date) VALUES (?,?,?,?)");
  insRisk.run("MALL-H", "violation_goods", "high", "2026-06-14");
  insRisk.run("MALL-H", "inbound_exception", "medium", "2026-06-15");

  const r = syncSettlementIncomeFromCapture(erp2, { attachCloudDb });
  ok("同步成功 attached", r.ok && r.attached);
  ok("覆盖 3 个店", r.malls === 3);
  ok("写入 4 个日期", r.rows === 4);
  const v10 = erp2.prepare("SELECT income_amount a FROM erp_temu_settlement_income WHERE mall_id='MALL-C' AND stat_date='2026-06-10'").get();
  near("06-10 取最新抓包=150", v10.a, 150);
  const v12 = erp2.prepare("SELECT income_amount a FROM erp_temu_settlement_income WHERE mall_id='MALL-D' AND stat_date='2026-06-12'").get();
  near("data.result 形态也能同步 80", v12.a, 80);
  const v13 = erp2.prepare("SELECT income_amount a FROM erp_temu_settlement_income WHERE mall_id='MALL-E' AND stat_date='2026-06-13'").get();
  near("result.rows + dateStr/settleAmount 形态也能同步 99", v13.a, 99);

  const detail = syncSettlementDetailFromCapture(erp2, { attachCloudDb });
  ok("结算明细同步成功 attached", detail.ok && detail.attached);
  ok("结算明细写入 1 行", detail.rows === 1 && detail.malls === 1);
  const d1 = erp2.prepare("SELECT settlement_status, sales_receipt_amount, chargeback_amount, subsidy_amount, total_amount FROM erp_temu_settlement_detail WHERE mall_id='MALL-F' AND item_key='SETTLE-001'").get();
  ok("settled 状态入库", d1?.settlement_status === "settled");
  near("销售回款=245.25", d1?.sales_receipt_amount, 245.25);
  near("销售冲回=6.90", d1?.chargeback_amount, 6.9);
  near("非商责补贴=43.53", d1?.subsidy_amount, 43.53);

  const order = syncSettlementOrderDetailFromCapture(erp2, { attachCloudDb });
  ok("结算订单明细同步成功 attached", order.ok && order.attached);
  ok("结算订单明细写入 2 行", order.rows === 2 && order.malls === 1);
  const o1 = erp2.prepare("SELECT batch_id, order_sn, sku_ext_code, quantity, currency, amount FROM erp_temu_settlement_order_detail WHERE mall_id='MALL-G' AND row_index=1").get();
  ok("结算订单第一行字段入库", o1?.batch_id === "BATCH-001" && o1?.order_sn === "PO-1" && o1?.sku_ext_code === "SKU-A");
  near("结算订单第一行数量=2", o1?.quantity, 2);
  near("结算订单第一行金额=12.34", o1?.amount, 12.34);
  ok("结算订单第一行币种=USD", o1?.currency === "USD");
  const o2 = erp2.prepare("SELECT order_sn, sku_id, quantity, amount, raw_json FROM erp_temu_settlement_order_detail WHERE mall_id='MALL-G' AND row_index=2").get();
  ok("结算订单第二行 SKU ID 入库且保留原始行", o2?.order_sn === "PO-2" && o2?.sku_id === "SKU-ID-B" && /SKU-ID-B/.test(o2?.raw_json || ""));
  near("结算订单第二行数量=3", o2?.quantity, 3);
  near("结算订单第二行金额=45.67", o2?.amount, 45.67);

  const fundSummary = syncFundSummaryFromCapture(erp2, { attachCloudDb });
  ok("资金汇总同步成功 attached", fundSummary.ok && fundSummary.attached);
  ok("资金汇总写入 2 行", fundSummary.rows === 2 && fundSummary.malls === 1);
  const fsDay = erp2.prepare("SELECT summary_scope, summary_date, currency, income_amount, expense_amount, frozen_amount, available_amount, total_amount FROM erp_temu_fund_summary WHERE mall_id='MALL-H' AND summary_scope='day'").get();
  ok("资金日汇总日期/币种入库", fsDay?.summary_scope === "day" && fsDay?.summary_date === "2026-06-14" && fsDay?.currency === "USD");
  near("资金日汇总收入=100", fsDay?.income_amount, 100);
  near("资金日汇总支出=23", fsDay?.expense_amount, 23);
  near("资金日汇总冻结=45", fsDay?.frozen_amount, 45);
  near("资金日汇总可用=700", fsDay?.available_amount, 700);
  near("资金日汇总合计=777", fsDay?.total_amount, 777);
  const fsMonth = erp2.prepare("SELECT summary_scope, summary_date, income_amount, expense_amount, balance_amount, frozen_amount, metrics_json FROM erp_temu_fund_summary WHERE mall_id='MALL-H' AND summary_scope='month'").get();
  ok("资金月汇总日期入库且保留 metrics", fsMonth?.summary_scope === "month" && fsMonth?.summary_date === "2026-06" && /totalIncome/.test(fsMonth?.metrics_json || ""));
  near("资金月汇总收入=123.45", fsMonth?.income_amount, 123.45);
  near("资金月汇总支出=23.45", fsMonth?.expense_amount, 23.45);
  near("资金月汇总余额=100", fsMonth?.balance_amount, 100);
  near("资金月汇总冻结=9.99", fsMonth?.frozen_amount, 9.99);
  const fsAgg = buildFundSummaryByMall(erp2, { startDate: "2026-06-01", endDate: "2026-06-30" }).get("MALL-H");
  ok("资金汇总聚合返回 MALL-H", !!fsAgg);
  near("资金汇总聚合优先日收入=100", fsAgg?.income_total, 100);
  near("资金汇总聚合最新账户余额=100", fsAgg?.balance_amount, 100);
  const riskAgg = buildSettlementRiskByMall(erp2, { startDate: "2026-06-01", endDate: "2026-06-30" }).get("MALL-H");
  ok("违规/异常聚合返回 MALL-H", !!riskAgg);
  ok("违规/异常计数正确", riskAgg?.violation_count === 1 && riskAgg?.inbound_exception_count === 1 && riskAgg?.high_count === 1);

  // ===== EPR 费用（eprfee goods/platform）=====
  insEv.run("MALL-I", EPR_FEE_PATHS[0], JSON.stringify({ result: {
    total: 2,
    waitDeductionEprFeeInfoList: [
      { certId: "CERT-1", certDisplayName: "法国EPR包装", regionName: "法国", amount: { value: 12.5, currencyCode: "EUR", digitalText: "12.50" }, quantity: 5, statDate: "2026-06-10" },
    ],
    deductedEprFeeInfoList: [
      { certId: "CERT-2", certDisplayName: "德国EPR", amount: { value: 3.4, digitalText: "3.40" } },
    ],
  } }), 9000);
  insEv.run("MALL-I", EPR_FEE_PATHS[1], JSON.stringify({ result: {
    total: 1,
    dataList: [
      { certId: "CERT-3", certName: "西班牙EPR代扣", deductAmount: "￥7.70" },
    ],
  } }), 9100);
  insEv.run("MALL-I", EPR_FEE_PATHS[3], JSON.stringify({
    success: true,
    source: "juxieyun_export",
    businessType: "Epr",
    type: "Epr_Product",
    taskType: 18,
    rows: [
      { "\u5546\u54c1ID": "P-EXPORT-1", "\u5546\u54c1\u540d\u79f0": "\u73af\u4fdd\u888b", "\u6570\u91cf": 2, "\u6263\u8d39\u91d1\u989d": "\uffe55.60", "\u56fd\u5bb6/\u5730\u533a": "\u5fb7\u56fd", "\u8bc1\u4e66\u540d\u79f0": "\u5fb7\u56fd\u5305\u88c5EPR" },
    ],
  }), 9150);
  const epr = syncEprFeeFromCapture(erp2, { attachCloudDb });
  ok("EPR 同步成功 attached", epr.ok && epr.attached);
  ok("EPR writes 4 rows including Juxieyun export", epr.rows === 4 && epr.malls === 1);
  const eprWait = erp2.prepare("SELECT amount, currency, cert_name, deduct_status FROM erp_temu_epr_fee WHERE mall_id='MALL-I' AND fee_scope='goods' AND deduct_status='wait'").get();
  near("EPR 待扣金额取 Format.value=12.5", eprWait?.amount, 12.5);
  ok("EPR 待扣币种/证书名入库", eprWait?.currency === "EUR" && eprWait?.cert_name === "法国EPR包装");
  const eprPlat = erp2.prepare("SELECT amount FROM erp_temu_epr_fee WHERE mall_id='MALL-I' AND fee_scope='platform'").get();
  near("EPR 平台待扣剥￥符号=7.70", eprPlat?.amount, 7.7);
  const eprExport = erp2.prepare("SELECT amount, goods_name, region, cert_name, deduct_status FROM erp_temu_epr_fee WHERE mall_id='MALL-I' AND spu_id='P-EXPORT-1'").get();
  near("EPR Juxieyun export Chinese amount=5.60", eprExport?.amount, 5.6);
  ok("EPR Juxieyun export Chinese fields stored", eprExport?.goods_name === "\u73af\u4fdd\u888b" && eprExport?.region === "\u5fb7\u56fd" && eprExport?.cert_name === "\u5fb7\u56fd\u5305\u88c5EPR" && eprExport?.deduct_status === "deducted");
  const eprAgg = buildEprFeeByMall(erp2).get("MALL-I");
  near("EPR 聚合待扣合计=20.2（含 platform）", eprAgg?.wait_amount, 12.5 + 7.7);
  near("EPR deducted amount includes Juxieyun export", eprAgg?.deducted_amount, 3.4 + 5.6);

  // ===== 资金限制（fund-frozen/rules，快照语义：最新抓包整店替换）=====
  insEv.run("MALL-J", FUND_FROZEN_PATH, JSON.stringify({ result: { currency: "CNY", rules: [
    { frozenType: "goods_refund_cost", reason: "退回服务费", amount: "￥7.40", unfreezeCondition: "出账缴费完毕" },
    { frozenType: "advertising_expenses", reason: "广告费", amount: "￥100.00" },
  ] } }), 9200);
  insEv.run("MALL-J", FUND_FROZEN_PATH, JSON.stringify({ result: { currency: "CNY", rules: [
    { frozenType: "goods_refund_cost", reason: "退回服务费", amount: "￥9.99", unfreezeCondition: "出账缴费完毕" },
  ] } }), 9300);
  const frozen = syncFundFrozenFromCapture(erp2, { attachCloudDb });
  ok("资金限制同步成功 attached", frozen.ok && frozen.attached);
  const frozenRows = erp2.prepare("SELECT COUNT(*) c FROM erp_temu_fund_frozen WHERE mall_id='MALL-J'").get().c;
  ok("快照语义：只留最新抓包 1 项（广告费旧项被清掉）", frozenRows === 1);
  const frozenRow = erp2.prepare("SELECT amount, reason FROM erp_temu_fund_frozen WHERE mall_id='MALL-J' AND frozen_type='goods_refund_cost'").get();
  near("冻结金额剥￥取最新=9.99", frozenRow?.amount, 9.99);
  const frozenAgg = buildFundFrozenByMall(erp2).get("MALL-J");
  near("冻结聚合总额=9.99", frozenAgg?.total_amount, 9.99);
  ok("冻结聚合带明细项", frozenAgg?.items?.length === 1 && frozenAgg.items[0].unfreeze_condition === "出账缴费完毕");

  // ===== 违规处罚（entrance/list 明细 + island summary）=====
  insEv.run("MALL-K", VIOLATION_LIST_PATH, JSON.stringify({ result: { total: 2, punish_appeal_entrance_list: [
    { target_id: 1001, goods_id: 606001, goods_name: "刀具A", leaf_reason_name: "欧盟刀具禁投", violation_desc: "不符合法规", punish_status_desc: "违规处理中", appeal_status: 1, can_not_appeal: false, can_rectify: true, site_num: 3, punish_num: 30 },
    { target_id: 1002, goods_name: "玩具B", leaf_reason_name: "缺CE标", can_not_appeal: true, can_rectify: false, site_num: 1, punish_num: 2 },
  ] } }), 9400);
  insEv.run("MALL-K", VIOLATION_SUMMARY_PATH, JSON.stringify({ result: {
    violationCount: 5, addSiteLimitStatus: 1, releaseLimitTime: "2026-07-01",
  } }), 9500);
  const violation = syncViolationFromCapture(erp2, { attachCloudDb });
  ok("违规同步成功 attached", violation.ok && violation.attached);
  ok("违规写入 3 行（2 明细 + 1 汇总）", violation.rows === 3 && violation.malls === 1);
  const vRow = erp2.prepare("SELECT goods_name, leaf_reason_name, can_appeal, can_rectify, punish_num FROM erp_temu_violation WHERE mall_id='MALL-K' AND target_id='1001'").get();
  ok("违规明细字段入库（can_not_appeal 取反）", vRow?.goods_name === "刀具A" && vRow?.leaf_reason_name === "欧盟刀具禁投" && vRow?.can_appeal === 1 && vRow?.can_rectify === 1 && vRow?.punish_num === 30);
  const vAgg = buildViolationByMall(erp2).get("MALL-K");
  const vAggDate = buildViolationByMall(erp2, { startDate: "1970-01-01", endDate: "1970-01-01" }).get("MALL-K");
  ok("buildViolationByMall date range uses detail rows only", vAggDate?.violation_count === 2);
  const vAggMiss = buildViolationByMall(erp2, { startDate: "2026-06-01", endDate: "2026-06-30" }).get("MALL-K");
  ok("buildViolationByMall date range excludes out-of-range rows", !vAggMiss);
  ok("违规聚合带明细", vAgg?.items?.length === 2);
  ok("违规计数取 summary 与明细的大者=5", vAgg?.violation_count === 5);
  ok("加站限制状态透出", vAgg?.add_site_limit_status === 1 && vAgg?.release_limit_time === "2026-07-01");

  // ===== 账户概览（payment/account/amount/info，快照语义：最新抓包整店替换）=====
  insEv.run("MALL-L", ACCOUNT_OVERVIEW_PATH, JSON.stringify({ result: {
    availableAmount: { amount: 123456, currencyCode: "CNY" }, // 分→1234.56
    pendingSettlementAmount: "￥3,200.00",                      // 字符串剥￥逗号→3200
    frozenAmount: 50, totalAmount: { amount: 480000 },          // 裸对象分→4800
  } }), 9600);
  insEv.run("MALL-L", ACCOUNT_OVERVIEW_PATH, JSON.stringify({ result: {
    availableAmount: { amount: 999900, currencyCode: "CNY" },  // 最新抓包→9999
    totalAmount: { amount: 999900 },
  } }), 9700);
  const account = syncAccountOverviewFromCapture(erp2, { attachCloudDb });
  ok("账户概览同步成功 attached", account.ok && account.attached);
  const accountRows = erp2.prepare("SELECT COUNT(*) c FROM erp_temu_account_overview WHERE mall_id='MALL-L'").get().c;
  ok("账户概览快照语义：每店一行", accountRows === 1);
  const accRow = erp2.prepare("SELECT available_amount, total_amount FROM erp_temu_account_overview WHERE mall_id='MALL-L'").get();
  near("账户可用取最新抓包分→元=9999", accRow?.available_amount, 9999);
  const accAgg = buildAccountOverviewByMall(erp2).get("MALL-L");
  near("账户聚合总额=9999", accAgg?.total_amount, 9999);

  // ===== 履约费用流出（warehouse/express/bill overview+detail）=====
  insEv.run("MALL-M", FULFILLMENT_PATHS[0], JSON.stringify({ result: {
    totalAmount: { amount: 654300, currencyCode: "CNY" },      // overview 总额：分→6543
  } }), 9800);
  insEv.run("MALL-M", FULFILLMENT_PATHS[1], JSON.stringify({ result: { list: [
    { billId: "WB-1", billType: "跨境运费", amount: "￥120.50", waybillNo: "SF123", statDate: "2026-06-10" },
    { billId: "WB-2", feeType: "仓储费", feeAmount: { amount: 8000, currencyCode: "CNY" } }, // 分→80
  ] } }), 9900);
  const fulfillment = syncFulfillmentBillFromCapture(erp2, { attachCloudDb });
  ok("履约费用同步成功 attached", fulfillment.ok && fulfillment.attached);
  ok("履约写入 3 行（1 overview + 2 detail）", fulfillment.rows === 3 && fulfillment.malls === 1);
  const fbOverview = erp2.prepare("SELECT amount FROM erp_temu_fulfillment_bill WHERE mall_id='MALL-M' AND record_type='overview'").get();
  near("履约 overview 总额分→元=6543", fbOverview?.amount, 6543);
  const fbDetail = erp2.prepare("SELECT amount, bill_type, waybill_no FROM erp_temu_fulfillment_bill WHERE mall_id='MALL-M' AND record_type='detail' AND item_key='WB-1'").get();
  near("履约明细剥￥=120.50", fbDetail?.amount, 120.5);
  ok("履约明细费用类型/运单号入库", fbDetail?.bill_type === "跨境运费" && fbDetail?.waybill_no === "SF123");
  const fbAgg = buildFulfillmentBillByMall(erp2).get("MALL-M");
  const fbAggDate = buildFulfillmentBillByMall(erp2, { startDate: "2026-06-10", endDate: "2026-06-10" }).get("MALL-M");
  near("buildFulfillmentBillByMall date range filters detail_total", fbAggDate?.detail_total, 120.5);
  ok("buildFulfillmentBillByMall date range ignores overview snapshot", fbAggDate?.overview_amount === 0 && fbAggDate?.detail_count === 1);
  const fbAggMiss = buildFulfillmentBillByMall(erp2, { startDate: "2026-06-11", endDate: "2026-06-11" }).get("MALL-M");
  ok("buildFulfillmentBillByMall date range excludes out-of-range rows", !fbAggMiss);
  near("履约聚合 overview_amount=6543", fbAgg?.overview_amount, 6543);
  near("履约聚合 detail_total=200.50", fbAgg?.detail_total, 120.5 + 80);
  ok("履约聚合 detail_count=2", fbAgg?.detail_count === 2);

  const { buildSettlementDetailByMall } = require("../electron/erp/services/multiStoreReport.cjs")._internal;
  const detailByMall = buildSettlementDetailByMall(erp2);
  ok("buildSettlementDetailByMall 返回 Map", detailByMall instanceof Map);
  const fAgg = detailByMall.get("MALL-F");
  ok("MALL-F 聚合存在", !!fAgg);
  near("聚合 settled.total=已到账合计", fAgg?.settled.total, 245.25 - 6.9 + 43.53);
  ok("settled.count=1", fAgg?.settled.count === 1);
  ok("wait_settlement 默认空桶", fAgg?.wait_settlement.total === 0 && fAgg?.wait_settlement.count === 0);
  const detailInRange = buildSettlementDetailByMall(erp2, { startDate: "2026-06-14", endDate: "2026-06-14" }).get("MALL-F");
  near("buildSettlementDetailByMall date range includes matching detail", detailInRange?.settled.total, 245.25 - 6.9 + 43.53);
  const detailOutRange = buildSettlementDetailByMall(erp2, { startDate: "2026-06-10", endDate: "2026-06-13" });
  ok("buildSettlementDetailByMall date range excludes out-of-range detail", !detailOutRange.has("MALL-F"));
  const emptyDetail = buildSettlementDetailByMall(new Database(":memory:"));
  ok("无表返回 null", emptyDetail === null);

  const erpFresh = new Database(":memory:");
  const fresh = syncSettlementIncomeFromCapture(erpFresh, { attachCloudDb });
  const freshCount = erpFresh.prepare("SELECT COUNT(*) c FROM erp_temu_settlement_income").get().c;
  ok("首次同步自动建结算表", fresh.ok && fresh.rows === 4 && freshCount === 4);
  erpFresh.close();

  // 未挂载 cloud 时优雅降级
  const noCloud = syncSettlementIncomeFromCapture(new Database(":memory:"), {});
  ok("无 attachCloudDb → ok=false/attached=false", noCloud.ok === false && noCloud.attached === false);

  erp2.close();
  try { fs.unlinkSync(cloudFile); } catch {}
}

console.log("\n=== 6) cloud 已挂载但 capture_events 缺失时不能误报成功 ===\n");
{
  const cloudFile = path.join(require("os").tmpdir(), `test-cloud-missing-events-${process.pid}.sqlite`);
  try { fs.unlinkSync(cloudFile); } catch {}
  const cloudDb = new Database(cloudFile);
  cloudDb.close();
  const erpMissing = new Database(":memory:");
  const attachEmptyCloud = (d) => {
    if (d.__cloudAttachState === "attached") return true;
    d.exec(`ATTACH DATABASE '${cloudFile.replace(/'/g, "''")}' AS cloud`);
    d.__cloudAttachState = "attached";
    return true;
  };
  const incomeMissing = syncSettlementIncomeFromCapture(erpMissing, { attachCloudDb: attachEmptyCloud });
  const detailMissing = syncSettlementDetailFromCapture(erpMissing, { attachCloudDb: attachEmptyCloud });
  const orderMissing = syncSettlementOrderDetailFromCapture(erpMissing, { attachCloudDb: attachEmptyCloud });
  const fundSummaryMissing = syncFundSummaryFromCapture(erpMissing, { attachCloudDb: attachEmptyCloud });
  ok("income 同步不把缺失 capture_events 当成功", incomeMissing.attached === true && incomeMissing.ok === false);
  ok("detail 同步不把缺失 capture_events 当成功", detailMissing.attached === true && detailMissing.ok === false);
  ok("order 同步不把缺失 capture_events 当成功", orderMissing.attached === true && orderMissing.ok === false);
  ok("fund summary 同步不把缺失 capture_events 当成功", fundSummaryMissing.attached === true && fundSummaryMissing.ok === false);
  const eprMissing = syncEprFeeFromCapture(erpMissing, { attachCloudDb: attachEmptyCloud });
  const frozenMissing = syncFundFrozenFromCapture(erpMissing, { attachCloudDb: attachEmptyCloud });
  const violationMissing = syncViolationFromCapture(erpMissing, { attachCloudDb: attachEmptyCloud });
  ok("EPR 同步不把缺失 capture_events 当成功", eprMissing.attached === true && eprMissing.ok === false);
  ok("资金限制同步不把缺失 capture_events 当成功", frozenMissing.attached === true && frozenMissing.ok === false);
  ok("违规同步不把缺失 capture_events 当成功", violationMissing.attached === true && violationMissing.ok === false);
  erpMissing.close();
  try { fs.unlinkSync(cloudFile); } catch {}
}

console.log("\n=== 7) check-temu-settlement-income --deep 只读预检 ===\n");
{
  const os = require("os");
  const cloudFile = path.join(os.tmpdir(), `test-check-cloud-${process.pid}.sqlite`);
  const erpFile = path.join(os.tmpdir(), `test-check-erp-${process.pid}.sqlite`);
  try { fs.unlinkSync(cloudFile); } catch {}
  try { fs.unlinkSync(erpFile); } catch {}
  const cloudDb = new Database(cloudFile);
  cloudDb.exec(`
    CREATE TABLE capture_events (
      mall_id TEXT,
      url_path TEXT,
      body_json TEXT,
      received_at INTEGER
    );
    CREATE INDEX idx_capture_events_url_path ON capture_events(url_path);
  `);
  cloudDb.prepare("INSERT INTO capture_events (mall_id, url_path, body_json, received_at) VALUES (?,?,?,?)")
    .run("MALL-CHECK", SETTLEMENT_INCOME_PATH, JSON.stringify({ result: { rows: [
      { statDate: "2026-06-20", incomeAmount: { amount: 12300 } },
      { dateStr: "2026/06/21", settleAmount: { amount: 45600 } },
    ] } }), 4000);
  cloudDb.close();
  const erpDb = new Database(erpFile);
  erpDb.close();

  const checkPath = path.join(__dirname, "check-temu-settlement-income.cjs");
  const check = spawnSync(process.execPath, [
    checkPath,
    "--erp-db", erpFile,
    "--cloud-db", cloudFile,
    "--deep",
  ], { cwd: path.join(__dirname, ".."), encoding: "utf8" });
  const output = `${check.stdout || ""}\n${check.stderr || ""}`;
  ok("--deep 找到候选同步行", /income_summary_deep_candidates/.test(output) && /"candidate_rows":2/.test(output));
  const verifyErpDb = new Database(erpFile);
  ok("--deep 不写 ERP 结算表", verifyErpDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='erp_temu_settlement_income'").get() == null);
  verifyErpDb.close();

  try { fs.unlinkSync(cloudFile); } catch {}
  try { fs.unlinkSync(erpFile); } catch {}
}

console.log("\n=== 8) check-temu-settlement-income：仅三态结算明细也可通过预检 ===\n");
{
  const os = require("os");
  const cloudFile = path.join(os.tmpdir(), `test-check-detail-cloud-${process.pid}.sqlite`);
  const erpFile = path.join(os.tmpdir(), `test-check-detail-erp-${process.pid}.sqlite`);
  try { fs.unlinkSync(cloudFile); } catch {}
  try { fs.unlinkSync(erpFile); } catch {}
  const cloudDb = new Database(cloudFile);
  cloudDb.exec(`
    CREATE TABLE capture_events (
      mall_id TEXT,
      url_path TEXT,
      body_json TEXT,
      received_at INTEGER
    );
    CREATE INDEX idx_capture_events_url_path ON capture_events(url_path);
  `);
  cloudDb.prepare("INSERT INTO capture_events (mall_id, url_path, body_json, received_at) VALUES (?,?,?,?)")
    .run("MALL-CHECK-DETAIL", SETTLEMENT_DETAIL_PATHS[2], JSON.stringify({ result: { data: { list: [
      { statDate: "2026-06-22", settlementOrderSn: "SETTLE-CHECK-001", salesReceiptAmount: { amount: 10000 } },
    ] } } }), 5000);
  cloudDb.close();
  const erpDb = new Database(erpFile);
  erpDb.close();

  const checkPath = path.join(__dirname, "check-temu-settlement-income.cjs");
  const check = spawnSync(process.execPath, [
    checkPath,
    "--erp-db", erpFile,
    "--cloud-db", cloudFile,
    "--deep",
  ], { cwd: path.join(__dirname, ".."), encoding: "utf8" });
  const output = `${check.stdout || ""}\n${check.stderr || ""}`;
  ok("仅结算明细不会触发 fail 退出码", check.status !== 2);
  ok("预检识别 settlement_detail_present", /settlement_detail_present/.test(output));

  try { fs.unlinkSync(cloudFile); } catch {}
  try { fs.unlinkSync(erpFile); } catch {}
}

console.log("\n=== 9) check-temu-settlement-income：仅结算订单明细也可通过预检 ===\n");
{
  const os = require("os");
  const cloudFile = path.join(os.tmpdir(), `test-check-order-detail-cloud-${process.pid}.sqlite`);
  const erpFile = path.join(os.tmpdir(), `test-check-order-detail-erp-${process.pid}.sqlite`);
  try { fs.unlinkSync(cloudFile); } catch {}
  try { fs.unlinkSync(erpFile); } catch {}
  const cloudDb = new Database(cloudFile);
  cloudDb.exec(`
    CREATE TABLE capture_events (
      mall_id TEXT,
      url_path TEXT,
      body_json TEXT,
      received_at INTEGER
    );
    CREATE INDEX idx_capture_events_url_path ON capture_events(url_path);
  `);
  cloudDb.prepare("INSERT INTO capture_events (mall_id, url_path, body_json, received_at) VALUES (?,?,?,?)")
    .run("MALL-CHECK-ORDER", SETTLEMENT_ORDER_DETAIL_PATH, JSON.stringify({
      batchId: "BATCH-CHECK-001",
      rows: [{ "订单号": "PO-CHECK-001", "商家SKU": "SKU-CHECK", "结算金额": "10" }],
    }), 6000);
  cloudDb.close();
  const erpDb = new Database(erpFile);
  erpDb.close();

  const checkPath = path.join(__dirname, "check-temu-settlement-income.cjs");
  const check = spawnSync(process.execPath, [
    checkPath,
    "--erp-db", erpFile,
    "--cloud-db", cloudFile,
    "--deep",
  ], { cwd: path.join(__dirname, ".."), encoding: "utf8" });
  const output = `${check.stdout || ""}\n${check.stderr || ""}`;
  ok("仅结算订单明细不会触发 fail 退出码", check.status !== 2);
  ok("预检识别 settlement_order_detail_present", /settlement_order_detail_present/.test(output));

  try { fs.unlinkSync(cloudFile); } catch {}
  try { fs.unlinkSync(erpFile); } catch {}
}

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
db.close();
process.exit(fail === 0 ? 0 : 1);
