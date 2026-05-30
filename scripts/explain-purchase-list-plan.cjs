#!/usr/bin/env node
/**
 * 采购单列表查询「执行计划」回归守护(opt-in,只读)。
 *
 * 用途:发版前或改动 getPurchaseWorkbench 后,人工确认采购单列表的两条核心 SQL
 * (Step 1 取当页 po_id、COUNT 总数)在「日常翻页」场景下走索引、不退回膨胀 JOIN/全表扫。
 * 详见 docs/frontend-response-cache-spec.md §7、§9。
 *
 * 用法:
 *   node scripts/explain-purchase-list-plan.cjs [sqlite路径]
 * 不传路径时按常见 dev/prod 位置探测。仅打印 EXPLAIN QUERY PLAN,不做硬断言,
 * 但会对大表 SCAN(全表扫描)给出醒目告警,便于肉眼复核。
 */

const fs = require("fs");
const path = require("path");

function resolveDbPath() {
  const fromArg = process.argv[2];
  if (fromArg) return fromArg;
  const candidates = [
    process.env.ERP_SQLITE_PATH,
    "/opt/temu-erp-data/erp.sqlite",
    path.join(process.env.APPDATA || "", "temu-automation", "erp.sqlite"),
    path.join(process.env.HOME || process.env.USERPROFILE || "", "erp.sqlite"),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// 日常翻页(默认队列 + 默认排序,无搜索/供应商/采购员/货号过滤)= 不引用任何 JOIN。
// 这是最高频场景,必须走 (account_id, status) 索引、且不触碰 erp_purchase_order_lines。
const STEP1_NO_JOIN = `
  SELECT po.id
  FROM erp_purchase_orders po
  WHERE po.account_id = @account_id
    AND po.status IN ('draft', 'pushed_pending_price')
  ORDER BY po.updated_at DESC, po.id DESC
  LIMIT 20 OFFSET 0
`;

const COUNT_NO_JOIN = `
  SELECT COUNT(*) AS total
  FROM erp_purchase_orders po
  WHERE po.account_id = @account_id
    AND po.status IN ('draft', 'pushed_pending_price')
`;

const BIG_TABLES = ["erp_purchase_order_lines", "erp_skus"];

function explain(db, label, sql) {
  console.log(`\n=== ${label} ===`);
  let rows;
  try {
    rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all({ account_id: "__probe__" });
  } catch (err) {
    console.log(`  (跳过:${err.message})`);
    return;
  }
  for (const r of rows) {
    const detail = r.detail || "";
    const isBigScan = BIG_TABLES.some((t) => detail.includes(`SCAN ${t}`));
    const flag = isBigScan ? "  ⚠️ 大表全表扫描——疑似退回膨胀 JOIN!" : "";
    console.log(`  ${detail}${flag}`);
  }
}

function main() {
  const dbPath = resolveDbPath();
  if (!dbPath) {
    console.error("未找到 sqlite。请传路径:node scripts/explain-purchase-list-plan.cjs <db路径>");
    process.exit(2);
  }
  console.log(`DB: ${dbPath}`);
  let Database;
  try {
    Database = require("better-sqlite3");
  } catch {
    console.error("缺少 better-sqlite3 依赖,无法运行。");
    process.exit(2);
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    explain(db, "Step 1 取当页 po_id(日常翻页,应走 idx_erp_po_account_status)", STEP1_NO_JOIN);
    explain(db, "COUNT 总数(日常翻页,不应出现大表 SCAN)", COUNT_NO_JOIN);
    console.log("\n提示:计划里出现 `SCAN erp_purchase_order_lines` / `SCAN erp_skus` 即为退化,需检查 getPurchaseWorkbench 的按需 JOIN 逻辑。");
  } finally {
    db.close();
  }
}

main();
