// 物化缓存刷新:独立 cron 进程预聚合「运营工作台」重报表,写入 erp_report_cache。
// 优化: activity_list / high_price_flow 只跑一次 includeTest=true(超集),JS 过滤出非测试版写两个 cache key,
// 省掉完整的第二轮 cloud 库扫描(~60-80s)。fast-path 报表(risk/qc/quality)仍双轮(本身极快)。
const { openErpDatabase, closePgPool, USE_PG, queryAll, execute, execRawSql } = require("../electron/db/connection.cjs");
const CLOUD_DB = process.env.CLOUD_DB || process.env.TEMU_CLOUD_DB_PATH || "/opt/temu-cloud/data/temu-cloud.sqlite";

(async () => {
  const db = openErpDatabase();

  if (!USE_PG) {
    db.exec(`ATTACH '${CLOUD_DB}' AS cloud`);
  }

  // 补充 cloud 索引(幂等):PG 模式跳过(cloud 表已在同库,PG 有自己的索引策略)
  if (!USE_PG) {
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS cloud.idx_risk_tenant_rtype_mall_pid_date
               ON temu_operation_risk_snapshot(tenant_id, risk_type, mall_id, product_id, stat_date)`);
    } catch (e) { console.warn("index risk_type_mall_pid:", e.message); }
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS cloud.idx_skc_tenant_skcid
               ON skc_snapshots(tenant_id, skc_id)`);
    } catch (e) { console.warn("index skc_id:", e.message); }
    // settlement order detail: date(create_time) 表达式索引(PG 语法不同,跳过)
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_settlement_od_create_date_mall
               ON erp_temu_settlement_order_detail(date(create_time), mall_id)`);
    } catch (e) { console.warn("index settlement_od_date:", e.message); }
    // stock_order: 覆盖索引让 GROUP BY mall_id 走纯索引扫描
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS cloud.idx_stock_order_grp_mall
               ON temu_stock_order_snapshot(tenant_id, mall_id, demand_qty, delivered_qty, temu_status)`);
    } catch (e) { console.warn("index stock_order_grp_mall:", e.message); }
  }

  const svc = require("../electron/erp/services/multiStoreReport.cjs");
  const upsertSql =
    "INSERT INTO erp_report_cache (cache_key, payload_json, updated_at) VALUES (?, ?, datetime('now')) " +
    "ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at";
  const attach = USE_PG ? () => true : () => true; // cloud 表已 ATTACH 或在同库,均返回 true

  // 读测试店铺集合,用于从超集结果中过滤生成 includeTest=false 版本
  const testMalls = new Set();
  try {
    const rows = await queryAll(db, "SELECT mall_id FROM erp_temu_malls WHERE status = 'test'");
    for (const r of rows) {
      testMalls.add(r.mall_id);
    }
  } catch {}

  async function mat(cacheKey, fn) {
    const t0 = Date.now();
    try {
      const data = await fn();
      await execute(db, upsertSql, [cacheKey, JSON.stringify(data)]);
      console.log(new Date().toISOString(), cacheKey, "rows=" + (data && data.row_count != null ? data.row_count : "?"), (Date.now() - t0) + "ms");
    } catch (e) {
      console.error(new Date().toISOString(), cacheKey, "FAIL", (e && e.message) || e);
    }
  }

  const t0 = Date.now();

  // ── 慢报表: 只跑 includeTest=true 一次,JS 过滤出 :0 版 ──

  // activity_list (~25s): 超集跑一次 → 过滤 test 店铺 → 写两个 cache key
  const actT0 = Date.now();
  try {
    const actAll = await svc.buildActivityList(db, { includeTest: true, attachCloudDb: attach, force: true });
    await execute(db, upsertSql, ["activity_list:1", JSON.stringify(actAll)]);
    console.log(new Date().toISOString(), "activity_list:1", "products=" + (actAll.product_count || "?"), (Date.now() - actT0) + "ms");
    if (testMalls.size > 0) {
      const filtered = { ...actAll,
        products: actAll.products.filter(p => !testMalls.has(p.mall_id)),
        enrolled: actAll.enrolled.filter(e => !testMalls.has(e.mall_id)),
      };
      filtered.product_count = filtered.products.length;
      await execute(db, upsertSql, ["activity_list:0", JSON.stringify(filtered)]);
      console.log(new Date().toISOString(), "activity_list:0", "products=" + filtered.product_count, "(filtered)");
    } else {
      await execute(db, upsertSql, ["activity_list:0", JSON.stringify(actAll)]);
    }
  } catch (e) {
    console.error(new Date().toISOString(), "activity_list", "FAIL", (e && e.message) || e);
  }

  // high_price_flow (~50s): 无 LIMIT,超集 → 过滤精确等价
  const hpfT0 = Date.now();
  try {
    const hpfAll = await svc.buildHighPriceFlowList(db, { includeTest: true, days: 14, attachCloudDb: attach, force: true });
    await execute(db, upsertSql, ["high_price_flow:1:14", JSON.stringify(hpfAll)]);
    console.log(new Date().toISOString(), "high_price_flow:1:14", "rows=" + hpfAll.row_count, (Date.now() - hpfT0) + "ms");
    if (testMalls.size > 0) {
      const filtered = { ...hpfAll, rows: hpfAll.rows.filter(r => !testMalls.has(r.mall_id)) };
      filtered.row_count = filtered.rows.length;
      await execute(db, upsertSql, ["high_price_flow:0:14", JSON.stringify(filtered)]);
      console.log(new Date().toISOString(), "high_price_flow:0:14", "rows=" + filtered.row_count, "(filtered)");
    } else {
      await execute(db, upsertSql, ["high_price_flow:0:14", JSON.stringify(hpfAll)]);
    }
  } catch (e) {
    console.error(new Date().toISOString(), "high_price_flow", "FAIL", (e && e.message) || e);
  }

  // ── 快报表: 本身 <5s,双轮保持原样 ──
  for (const inc of [false, true]) {
    const k = inc ? "1" : "0";
    await mat("risk_list:" + k, () => svc.buildRiskList(db, { includeTest: inc, attachCloudDb: attach, force: true }));
    await mat("openapi_qc:" + k, () => svc.buildOpenapiQc(db, { includeTest: inc }));
    await mat("quality_panel:" + k, () => svc.buildQualityPanel(db, { includeTest: inc, attachCloudDb: attach, force: true }));
  }

  // 管道总览(商品全景)
  await mat("pipeline_overview", () => svc.buildPipelineOverview(db, { includeTest: false, attachCloudDb: attach, force: true }));

  // 多店报表
  const t1 = Date.now();
  try {
    const data = await svc.buildMultiStoreReport(db, { includeTest: false, attachCloudDb: attach, force: true });
    await execute(db, upsertSql, ["multi_store:0", JSON.stringify(data)]);
    console.log(new Date().toISOString(), "multi_store:0", (Date.now() - t1) + "ms");
  } catch (e) {
    console.error(new Date().toISOString(), "multi_store:0", "FAIL", (e && e.message) || e);
  }

  console.log(new Date().toISOString(), "ops-reports refreshed in", Date.now() - t0, "ms");

  if (USE_PG) {
    await closePgPool();
  } else {
    db.close();
  }
})();
