// dev 端到端验证: 临时 ERP db ATTACH 本地 cloud db，跑 3 个 sync。
// 跑法: node_modules/.bin/electron --no-sandbox scripts/dev-e2e-stage123.cjs
// 需要环境变量: ELECTRON_RUN_AS_NODE=1（脚本内强制设置）

process.env.ELECTRON_RUN_AS_NODE = "1";
process.env.TEMU_CLOUD_DB_PATH = process.env.TEMU_CLOUD_DB_PATH
  || "C:/Users/Administrator/Desktop/temu-automation/cloud/data/temu-cloud.sqlite";

const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");

const tmpDir = path.join(os.tmpdir(), "temu-dev-e2e-" + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });
console.log("TMP ERP dir:", tmpDir);
console.log("CLOUD db:", process.env.TEMU_CLOUD_DB_PATH);

const { openErpDatabase } = require(path.join(ROOT, "electron/db/connection.cjs"));
const { runMigrations } = require(path.join(ROOT, "electron/db/migrate.cjs"));

(async () => {
const db = openErpDatabase({ dataDir: tmpDir });
const result = await runMigrations({ db });
const okCount = result?.success?.length || 0;
const failCount = result?.failure?.length || 0;
console.log(`Migrations: ${okCount} ok, ${failCount} failed`);
if (failCount) {
  for (const f of result.failure) console.log("  FAIL:", f.name, f.error?.message || f.error);
  process.exit(1);
}

const { attachTemuCloudDbIfPossible } = require(path.join(ROOT, "electron/erp/lanServer.cjs"));
const { TemuCloudJitVmiSync } = require(path.join(ROOT, "electron/erp/services/temuCloudJitVmiSync.cjs"));
const { TemuCloudSalesSync } = require(path.join(ROOT, "electron/erp/services/temuCloudSalesSync.cjs"));
const { TemuCloudReviewSync } = require(path.join(ROOT, "electron/erp/services/temuCloudReviewSync.cjs"));

function run(label, fn) {
  console.log(`--- ${label} ---`);
  try {
    const r = fn();
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
  }
}

run("JIT/VMI sync", () => new TemuCloudJitVmiSync({ db, attachCloudDb: attachTemuCloudDbIfPossible }).sync({}));
run("Sales sync", () => new TemuCloudSalesSync({ db, attachCloudDb: attachTemuCloudDbIfPossible }).sync({}));
run("Review sync", () => new TemuCloudReviewSync({ db, attachCloudDb: attachTemuCloudDbIfPossible }).sync({}));

console.log("--- ERP 表行数 ---");
function tableCount(name) {
  try { return db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n; }
  catch { return "(no table)"; }
}
console.log(`  erp_temu_jit_status:    ${tableCount("erp_temu_jit_status")}`);
console.log(`  erp_temu_vmi_suborder:  ${tableCount("erp_temu_vmi_suborder")}`);
console.log(`  erp_temu_sales_sku:     ${tableCount("erp_temu_sales_sku")}`);
console.log(`  erp_temu_sales_shop:    ${tableCount("erp_temu_sales_shop")}`);
console.log(`  erp_temu_reviews:       ${tableCount("erp_temu_reviews")}`);
console.log(`  erp_temu_robot_sync_runs:${tableCount("erp_temu_robot_sync_runs")}`);

db.close();
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("CLEANUP OK");

})().catch(e => { console.error(e); process.exit(1); });