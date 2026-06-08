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
  buildSettlementIncomeByMall,
  extractSettlementIncomeListFromCaptureBody,
  SETTLEMENT_INCOME_PATH,
  SETTLEMENT_DETAIL_PATHS,
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

  const { buildSettlementDetailByMall } = require("../electron/erp/services/multiStoreReport.cjs")._internal;
  const detailByMall = buildSettlementDetailByMall(erp2);
  ok("buildSettlementDetailByMall 返回 Map", detailByMall instanceof Map);
  const fAgg = detailByMall.get("MALL-F");
  ok("MALL-F 聚合存在", !!fAgg);
  near("聚合 settled.total=已到账合计", fAgg?.settled.total, 245.25 - 6.9 + 43.53);
  ok("settled.count=1", fAgg?.settled.count === 1);
  ok("wait_settlement 默认空桶", fAgg?.wait_settlement.total === 0 && fAgg?.wait_settlement.count === 0);
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
  ok("income 同步不把缺失 capture_events 当成功", incomeMissing.attached === true && incomeMissing.ok === false);
  ok("detail 同步不把缺失 capture_events 当成功", detailMissing.attached === true && detailMissing.ok === false);
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

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
db.close();
process.exit(fail === 0 ? 0 : 1);
