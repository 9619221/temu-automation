// 物化缓存刷新:独立 cron 进程预聚合「运营工作台」四个重报表,写入 erp_report_cache。
// 高价限流/活动机会/违规风险/商品全景(管道总览)原本每次实时跨 12G cloud 库聚合
// (实测稳态 60s/26s/5s/52s,缓存过期后第一个访问者吃满),这里改为后台预算好、端点直接读表(毫秒)。
// buildXxx 内部已加「内存缓存 miss → 读 erp_report_cache」分支,本脚本负责把表喂满。
// 用法(由 cronScheduler 串行调度,ionice -c3 nice -n19 低优先级):
//   node scripts/refresh-ops-reports.cjs
const Database = require("better-sqlite3");
const ERP_DB = process.env.ERP_DB || "/opt/temu-erp-data/erp.sqlite";
const CLOUD_DB = process.env.CLOUD_DB || process.env.TEMU_CLOUD_DB_PATH || "/opt/temu-cloud/data/temu-cloud.sqlite";
const db = new Database(ERP_DB);
db.pragma("busy_timeout=60000");
db.exec(`ATTACH '${CLOUD_DB}' AS cloud`);
const svc = require("../electron/erp/services/multiStoreReport.cjs");
const up = db.prepare(
  "INSERT INTO erp_report_cache (cache_key, payload_json, updated_at) VALUES (?, ?, datetime('now')) " +
  "ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at"
);
const attach = () => true;

function mat(cacheKey, fn) {
  const t0 = Date.now();
  try {
    const data = fn();
    up.run(cacheKey, JSON.stringify(data));
    console.log(new Date().toISOString(), cacheKey, "rows=" + (data && data.row_count != null ? data.row_count : "?"), (Date.now() - t0) + "ms");
  } catch (e) {
    console.error(new Date().toISOString(), cacheKey, "FAIL", (e && e.message) || e);
  }
}

const t0 = Date.now();
for (const inc of [false, true]) {
  const k = inc ? "1" : "0";
  mat("risk_list:" + k, () => svc.buildRiskList(db, { includeTest: inc, attachCloudDb: attach, force: true }));
  mat("activity_list:" + k, () => svc.buildActivityList(db, { includeTest: inc, attachCloudDb: attach, force: true }));
  mat("high_price_flow:" + k + ":14", () => svc.buildHighPriceFlowList(db, { includeTest: inc, days: 14, attachCloudDb: attach, force: true }));
  mat("openapi_qc:" + k, () => svc.buildOpenapiQc(db, { includeTest: inc }));
  mat("quality_panel:" + k, () => svc.buildQualityPanel(db, { includeTest: inc, attachCloudDb: attach, force: true }));
}
// 管道总览(商品全景):内存缓存键固定 "pf" 不分 test,沿用既有行为,用 excludeTest 跑一次写单键。
mat("pipeline_overview", () => svc.buildPipelineOverview(db, { includeTest: false, attachCloudDb: attach, force: true }));

// 多店报表(buildMultiStoreReport 是 async,冷态实测 ~46s 独占单进程,故必须 cron 喂表)。
// 只物化默认视图 multi_store:0;includeTest=1 罕用,getMultiStoreReportFast miss 时回退实时即可。
(async () => {
  const t1 = Date.now();
  try {
    const data = await svc.buildMultiStoreReport(db, { includeTest: false, attachCloudDb: attach, force: true });
    up.run("multi_store:0", JSON.stringify(data));
    console.log(new Date().toISOString(), "multi_store:0", (Date.now() - t1) + "ms");
  } catch (e) {
    console.error(new Date().toISOString(), "multi_store:0", "FAIL", (e && e.message) || e);
  }
  console.log(new Date().toISOString(), "ops-reports refreshed in", Date.now() - t0, "ms");
  db.close();
})();
