/**
 * 出库中心「新备货单快速通道」（方案 C：刷新按钮触发按需拉取）。
 *
 * 背景：备货单常规链路是 官方采集(records) → 6h 全量解析(consign) → 1h 快照重建(snapshot)，
 * 新申请的备货单最坏 7h+ 才可见。本服务由前端「刷新」按钮触发：按下单时间窗口(近 48h)调
 * bg.purchaseorderv2.get 拉最新备货单，只补写本地还没有的 WB——
 *   1) erp_temu_openapi_consign 物化行（upsert，与 refreshConsignAllChunked 同列）
 *   2) erp_temu_openapi_records 追加原始行（下次官方采集 replaceSourceRecords 整体覆盖，天然收敛）
 *   3) temu_consign_unified_snapshot 增量行（复用 lanServer 同一份 CTE 生成 payload，杜绝口径漂移）
 * 存量单一律不动，状态修正仍由 6h/1h cron 兜底。60s 防抖 + 单飞，防止连点刷新打爆 3qps 接口。
 */
"use strict";

const { queryAll, queryOne, execute, withTransaction } = require("../../db/connection.cjs");
const { callOpenApi } = require("../temuOpenApiClient.cjs");
const { parsePurchaseOrder, buildCostMap } = require("./temuOpenApiConsign.cjs");

const WINDOW_MS = 48 * 60 * 60 * 1000;
const DEBOUNCE_MS = 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 3; // 近 48h 每店超过 300 单基本不可能；超了也有 6h 全量兜底
const CALL_GAP_MS = 400; // bg.purchaseorderv2.get 3qps

let lastPullAt = 0;
let inflight = null;

function sleep(ms) {return new Promise((r) => setTimeout(r, ms));}

// 与 refreshConsignAllChunked 同一份 upsert（列/冲突策略一致），并发撞 cron 时后写者胜，无脏行。
const CONSIGN_UPSERT_SQL = `
    INSERT INTO erp_temu_openapi_consign
      (mall_id, so_id, original_po_sn, delivery_order_sn, product_id, product_skc_id, product_name,
       sku_ext_codes, spec_names, demand_qty, delivered_qty, received_qty, amount_cents, cost_coverage,
       sku_count, temu_status, ship_status, order_time, deliver_time, latest_ship_at,
       receive_warehouse_name, supplier_name, items_json, label_codes,
       express_company, express_delivery_sn, driver_name, plate_number, deliver_package_num, receive_package_num,
       sub_warehouse_name, receive_address_json, is_print_box_mark, delivery_method, express_batch_sn,
       predict_package_weight, ship_create_time, inbound_time, category, today_can_deliver, is_first,
       expect_arrival_at, urgency_type, synced_at)
    VALUES
      (@mall_id, @so_id, @original_po_sn, @delivery_order_sn, @product_id, @product_skc_id, @product_name,
       @sku_ext_codes, @spec_names, @demand_qty, @delivered_qty, @received_qty, @amount_cents, @cost_coverage,
       @sku_count, @temu_status, @ship_status, @order_time, @deliver_time, @latest_ship_at,
       @receive_warehouse_name, @supplier_name, @items_json, @label_codes,
       @express_company, @express_delivery_sn, @driver_name, @plate_number, @deliver_package_num, @receive_package_num,
       @sub_warehouse_name, @receive_address_json, @is_print_box_mark, @delivery_method, @express_batch_sn,
       @predict_package_weight, @ship_create_time, @inbound_time, @category, @today_can_deliver, @is_first,
       @expect_arrival_at, @urgency_type, @now)
    ON CONFLICT(mall_id, so_id) DO NOTHING`;

// 与 scripts/rebuild-consign-snapshot.cjs buildSearchBlob 同口径（那边是重建侧，这边是增量侧）。
function buildSearchBlob(row) {
  return [
    row.so_id, row.cloud_shop_name, row.jst_shop_name, row.jst_outer_deliver_no, row.jst_supplier_name,
    row.jst_sku_info, row.jst_skus, row.jst_logistics_company, row.jst_l_id,
    row.cloud_mall_id, row.cloud_site, row.cloud_delivery_order_sn,
    row.cloud_product_name, row.cloud_spec_name, row.cloud_sku_ext_code,
  ].filter((v) => v != null && v !== "").join("  ");
}

async function fetchRecentOrders(creds, sinceMs) {
  const out = [];
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
    await sleep(CALL_GAP_MS);
    const { response } = await callOpenApi({
      ...creds, type: "bg.purchaseorderv2.get",
      bizParams: { pageNo, pageSize: PAGE_SIZE, purchaseTimeFrom: sinceMs }
    });
    if (!response || response.success !== true) {
      throw new Error((response && response.errorMsg) || "bg.purchaseorderv2.get 调用失败");
    }
    const items = (response.result && response.result.subOrderForSupplierList) || [];
    out.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return out;
}

// 追加原始 records 行（seq 接在店内最大值后），让 6h 全量解析在下次官方采集前也能看到新单，
// 避免全量重建把快速通道插入的 consign 行冲掉。字段映射与 LIST_COLLECTORS.purchase_order 一致。
async function appendPurchaseOrderRecords(db, mallId, items, nowIso) {
  const maxRow = await queryOne(db,
    "SELECT MAX(seq) AS s FROM erp_temu_openapi_records WHERE mall_id = ? AND source = 'purchase_order'", [mallId]);
  let seq = (maxRow && Number.isFinite(Number(maxRow.s)) ? Number(maxRow.s) : -1) + 1;
  const s = (v) => (v == null ? null : String(v));
  await withTransaction(db, async (txDb) => {
    for (const it of items) {
      await execute(txDb, `
        INSERT INTO erp_temu_openapi_records
          (mall_id, source, seq, record_key, product_id, product_skc_id, ext_code, status, biz_time, raw_json, synced_at)
        VALUES (@mall_id,'purchase_order',@seq,@record_key,@product_id,@product_skc_id,@ext_code,@status,@biz_time,@raw,@now)
      `, {
        mall_id: mallId, seq: seq++,
        record_key: s(it.originalPurchaseOrderSn || it.subPurchaseOrderSn),
        product_id: s(it.productId), product_skc_id: s(it.productSkcId),
        ext_code: s(it.skcExtCode || it.extCode),
        status: s(it.fulfilmentFormStatus || it.status),
        biz_time: s(it.purchaseTime || it.createTime),
        raw: JSON.stringify(it), now: nowIso
      });
    }
  });
}

// 把新 WB 补进统一视图快照：复用 lanServer 的同一份 CTE + 行→payload 映射生成快照行。
// 快照表不存在（未初始化）时静默跳过——在线查询会走回退路径，无回归。
async function insertSnapshotRows(db, soIds) {
  let lan;
  try {lan = require("../lanServer.cjs");} catch {return 0;}
  const cte = typeof lan.buildUnifiedConsignCte === "function" ? lan.buildUnifiedConsignCte() : lan.UNIFIED_CONSIGN_CTE;
  const toPayload = lan.unifiedRowToPayload;
  if (!cte || typeof toPayload !== "function") return 0;

  const snapExists = await queryOne(db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name='temu_consign_unified_snapshot'").catch(() => null);
  // PG 模式 sqlite_master 不存在会抛错 → catch 后直接尝试插入，失败再放弃
  const companies = (await queryAll(db,
    "SELECT DISTINCT company_id FROM jst_consign_deliveries WHERE company_id IS NOT NULL"))
    .map((r) => r.company_id);
  if (!companies.includes("company_default")) companies.push("company_default");

  const values = {};
  const ph = soIds.map((id, i) => {values[`qp${i}`] = String(id);return `@qp${i}`;});
  const rebuiltAt = Date.now();
  let inserted = 0;

  for (const companyId of companies) {
    let rows;
    try {
      rows = await queryAll(db, `${cte}\nSELECT * FROM unified WHERE so_id IN (${ph.join(",")})`,
        { company_id: companyId, ...values });
    } catch {continue;}
    if (!rows.length) continue;
    try {
      await withTransaction(db, async (txDb) => {
        for (const row of rows) {
          const exists = await queryOne(txDb,
            "SELECT 1 AS x FROM temu_consign_unified_snapshot WHERE company_id = ? AND so_id = ? LIMIT 1",
            [companyId, String(row.so_id)]);
          if (exists) continue;
          await execute(txDb, `
            INSERT INTO temu_consign_unified_snapshot
              (company_id, so_id, source, jst_status, display_status, online_status, order_key, shop_name, search_blob, payload_json, rebuilt_at)
            VALUES (@company_id, @so_id, @source, @jst_status, @display_status, @online_status, @order_key, @shop_name, @search_blob, @payload_json, @rebuilt_at)
          `, {
            company_id: companyId,
            so_id: row.so_id || null,
            source: row.source || null,
            jst_status: row.jst_status || null,
            display_status: row.local_status_override || row.jst_status || "已付款待审核",
            online_status: row.cloud_temu_status || null,
            order_key: row.jst_order_date || row.cloud_order_time || null,
            shop_name: row.cloud_shop_name || row.jst_shop_name || null,
            search_blob: buildSearchBlob(row),
            payload_json: JSON.stringify(toPayload(row)),
            rebuilt_at: rebuiltAt,
          });
          inserted += 1;
        }
      });
    } catch (e) {
      // 老快照表缺 shop_name/online_status 等列时退化为最小列集插入
      try {
        await withTransaction(db, async (txDb) => {
          for (const row of rows) {
            const exists = await queryOne(txDb,
              "SELECT 1 AS x FROM temu_consign_unified_snapshot WHERE company_id = ? AND so_id = ? LIMIT 1",
              [companyId, String(row.so_id)]);
            if (exists) continue;
            await execute(txDb, `
              INSERT INTO temu_consign_unified_snapshot
                (company_id, so_id, source, jst_status, order_key, search_blob, payload_json, rebuilt_at)
              VALUES (@company_id, @so_id, @source, @jst_status, @order_key, @search_blob, @payload_json, @rebuilt_at)
            `, {
              company_id: companyId, so_id: row.so_id || null, source: row.source || null,
              jst_status: row.jst_status || null,
              order_key: row.jst_order_date || row.cloud_order_time || null,
              search_blob: buildSearchBlob(row),
              payload_json: JSON.stringify(toPayload(row)),
              rebuilt_at: rebuiltAt,
            });
            inserted += 1;
          }
        });
      } catch {/* 快照没初始化，跳过；列表读取会自行回退 */}
    }
  }
  void snapExists;
  return inserted;
}

async function doPull(db) {
  lastPullAt = Date.now();
  const malls = await queryAll(db,
    "SELECT mall_id, app_key, app_secret, access_token, region FROM erp_temu_openapi_auth " +
    "WHERE status = 'active' AND access_token IS NOT NULL AND access_token != ''");
  const costMap = await buildCostMap(db);
  const sinceMs = Date.now() - WINDOW_MS;
  const nowIso = new Date().toISOString();
  const summary = { malls: malls.length, fetched: 0, inserted: 0, snapshotInserted: 0, errors: [] };
  const newSoIds = [];

  for (const m of malls) {
    const mallId = String(m.mall_id);
    const appSecret = m.app_secret || process.env.TEMU_OPENAPI_APP_SECRET || "";
    if (!appSecret) {summary.errors.push(`${mallId}: 缺 app_secret`);continue;}
    let items;
    try {
      items = await fetchRecentOrders(
        { appKey: m.app_key, appSecret, accessToken: m.access_token, region: m.region || "CN" }, sinceMs);
    } catch (e) {summary.errors.push(`${mallId}: ${e.message || e}`);continue;}
    summary.fetched += items.length;

    const fresh = [];
    for (const it of items) {
      const row = parsePurchaseOrder(it, costMap);
      if (!row.so_id) continue;
      const exists = await queryOne(db,
        "SELECT 1 AS x FROM erp_temu_openapi_consign WHERE mall_id = ? AND so_id = ?", [mallId, row.so_id]);
      if (exists) continue;
      row.mall_id = mallId;
      fresh.push({ row, item: it });
    }
    if (!fresh.length) continue;

    await withTransaction(db, async (txDb) => {
      for (const f of fresh) await execute(txDb, CONSIGN_UPSERT_SQL, { ...f.row, now: nowIso });
    });
    try {await appendPurchaseOrderRecords(db, mallId, fresh.map((f) => f.item), nowIso);}
    catch (e) {summary.errors.push(`${mallId}: records 追加失败 ${e.message || e}`);}
    summary.inserted += fresh.length;
    for (const f of fresh) newSoIds.push(f.row.so_id);
  }

  if (newSoIds.length) {
    try {summary.snapshotInserted = await insertSnapshotRows(db, newSoIds);}
    catch (e) {summary.errors.push(`snapshot: ${e.message || e}`);}
  }
  return summary;
}

/** 刷新按钮入口：60s 防抖 + 单飞（并发调用共享同一次拉取结果）。 */
async function quickPullNewConsign({ db, force = false } = {}) {
  if (inflight) return inflight;
  if (!force && Date.now() - lastPullAt < DEBOUNCE_MS) {
    return { skipped: true, reason: "debounced", lastPullAt };
  }
  inflight = doPull(db).finally(() => {inflight = null;});
  return inflight;
}

module.exports = { quickPullNewConsign };
