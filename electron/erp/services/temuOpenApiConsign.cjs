/**
 * 出库中心「官方 API 化」解析服务。
 *
 * 把官方 bg.purchaseorderv2.get(purchase_order) + bg.shiporderv2.get(ship_order) 的采集结果
 * (erp_temu_openapi_records)按备货单号(subPurchaseOrderSn=WB)合并成规整一行，物化到
 * erp_temu_openapi_consign(migration 066)。UNIFIED_CONSIGN_CTE 的 Temu 侧读它，替代抓包
 * cloud.temu_stock_order_snapshot。WB 与聚水潭 jst_consign_deliveries.so_id 同键，对账保得住。
 *
 * 金额：官方备货单不带金额，按 Σ(purchaseQuantity × erp_skus.weighted_avg_cost[extCode]) 自算。
 * 状态：purchase_order.status 与抓包 stock_order 同套码，直接复用映射。
 *
 * snapshot 语义：整表 DELETE + 重插。纯本地 erp.sqlite，不碰 cloud。
 */
"use strict";

// 备货单状态(= 抓包 stock_order temu_status 同套)
const PO_STATUS = { "0": "已付款待审核", "1": "待发货", "2": "已发货", "3": "已发货", "7": "已收货", "8": "取消", "10": "其他" };
// 发货单状态(= 抓包 shipping_list 同套)
const SHIP_STATUS = { "0": "待发货", "1": "已发货", "2": "已收货", "5": "取消", "6": "异常" };

function num(v) { if (v == null) return null; const x = Number(v); return Number.isFinite(x) ? x : null; }
function str(v) { return v == null ? null : String(v); }
function tsToStr(ms) { const x = Number(ms); if (!Number.isFinite(x) || x <= 0) return null; return new Date(x).toISOString().replace("T", " ").slice(0, 19); }

// 货号 → 采购成本(weighted_avg_cost 优先, 退 jst_cost_price)。一货号多行取 MAX。
function buildCostMap(db) {
  const m = new Map();
  const rows = db.prepare(`
    SELECT internal_sku_code AS code,
           MAX(COALESCE(NULLIF(weighted_avg_cost,0), NULLIF(jst_cost_price,0))) AS cost
      FROM erp_skus WHERE internal_sku_code IS NOT NULL AND internal_sku_code <> ''
     GROUP BY internal_sku_code`).all();
  for (const r of rows) if (r.code != null && r.cost != null) m.set(String(r.code), Number(r.cost));
  return m;
}

function parsePurchaseOrder(item, costMap) {
  const list = Array.isArray(item.skuQuantityDetailList) ? item.skuQuantityDetailList : [];
  let demand = 0, delivered = 0, received = 0, amountCents = 0, costCov = 0;
  const exts = new Set(), specs = new Set();
  const items = []; // 逐SKU明细,供 cloud-only 单展开显示官方明细(对齐前端 itemColumns 字段)
  for (const sk of list) {
    const pq = num(sk.purchaseQuantity) || 0, dq = num(sk.deliverQuantity) || 0, rq = num(sk.realReceiveAuthenticQuantity) || 0;
    demand += pq; delivered += dq; received += rq;
    const ext = sk.extCode ? String(sk.extCode) : null;
    if (ext) exts.add(ext);
    if (sk.className) specs.add(String(sk.className));
    const cost = ext != null ? costMap.get(ext) : null;
    if (cost != null) { amountCents += Math.round(pq * cost * 100); costCov += 1; } // 金额按备货量×采购成本
    items.push({
      name: item.productName || null,
      iId: ext,                                                    // 货号
      skuId: sk.productSkuId != null ? String(sk.productSkuId) : null,
      propertiesValue: sk.className || null,                       // 规格
      qty: pq,                                                     // 备货数
      deliverQty: dq,
      picUrl: (Array.isArray(sk.thumbUrlList) && sk.thumbUrlList[0]) || item.productSkcPicture || null,
      costPrice: cost != null ? cost : null,
      costAmount: cost != null ? Math.round(pq * cost * 100) / 100 : null,
    });
  }
  const di = (item.deliverInfo && typeof item.deliverInfo === "object") ? item.deliverInfo : {};
  return {
    so_id: str(item.subPurchaseOrderSn),
    original_po_sn: str(item.originalPurchaseOrderSn),
    delivery_order_sn: str(item.deliveryOrderSn || di.deliveryOrderSn),
    product_id: str(item.productId),
    product_skc_id: str(item.productSkcId),
    product_name: item.productName || null,
    sku_ext_codes: [...exts].join(",") || null,
    spec_names: [...specs].join(",") || null,
    demand_qty: demand, delivered_qty: delivered, received_qty: received,
    amount_cents: amountCents, cost_coverage: costCov, sku_count: list.length,
    temu_status: PO_STATUS[String(item.status)] || "其他",
    ship_status: null,
    order_time: tsToStr(item.purchaseTime),
    deliver_time: tsToStr(di.deliverTime),
    latest_ship_at: tsToStr(di.expectLatestDeliverTimeOrDefault),
    receive_warehouse_name: di.receiveWarehouseName || null,
    supplier_name: item.supplierName || null,
    items_json: JSON.stringify(items),
    // —— purchase_order 补接字段 ——
    category: item.category || null,
    today_can_deliver: item.todayCanDeliver === true ? 1 : (item.todayCanDeliver === false ? 0 : null),
    is_first: item.isFirst === true ? 1 : (item.isFirst === false ? 0 : null),
    expect_arrival_at: tsToStr(di.expectLatestArrivalTimeOrDefault),
    urgency_type: num(item.urgencyType),
    label_codes: null,
    // —— ship_order 补接字段(主行先初始 null,发货单按 WB 合并时填) ——
    express_company: null, express_delivery_sn: null, driver_name: null, plate_number: null,
    deliver_package_num: null, receive_package_num: null, sub_warehouse_name: null, receive_address_json: null,
    is_print_box_mark: null, delivery_method: null, express_batch_sn: null, predict_package_weight: null,
    ship_create_time: null, inbound_time: null,
  };
}

/** 全量重建 erp_temu_openapi_consign。返回 { purchaseOrders, shipMerged, rows }。 */
function refreshConsignAll(db) {
  const costMap = buildCostMap(db);
  const now = new Date().toISOString();
  const byWb = new Map();
  // 1) purchase_order 为主行
  const poRows = db.prepare("SELECT mall_id, raw_json FROM erp_temu_openapi_records WHERE source='purchase_order'").all();
  for (const r of poRows) {
    let it; try { it = JSON.parse(r.raw_json); } catch { continue; }
    const row = parsePurchaseOrder(it, costMap);
    if (!row.so_id) continue;
    row.mall_id = r.mall_id;
    byWb.set(r.mall_id + "|" + row.so_id, row);
  }
  // 2) ship_order 补发货状态/时间(按 WB)
  let shipMerged = 0;
  for (const r of db.prepare("SELECT mall_id, raw_json FROM erp_temu_openapi_records WHERE source='ship_order'").all()) {
    let it; try { it = JSON.parse(r.raw_json); } catch { continue; }
    const wb = str(it.subPurchaseOrderSn); if (!wb) continue;
    const row = byWb.get(r.mall_id + "|" + wb);
    if (!row) continue;
    row.ship_status = SHIP_STATUS[String(it.status)] || row.ship_status;
    const dt = tsToStr(it.deliverTime); if (dt) row.deliver_time = dt;
    if (!row.delivery_order_sn && it.deliveryOrderSn) row.delivery_order_sn = str(it.deliveryOrderSn);
    // —— ship_order 补接:物流/司机/包裹/仓库/打印/批次/重量/时间 ——
    row.express_company = it.expressCompany || null;
    row.express_delivery_sn = str(it.expressDeliverySn);
    row.driver_name = it.driverName || null;
    row.plate_number = it.plateNumber || null;
    row.deliver_package_num = num(it.deliverPackageNum);
    row.receive_package_num = num(it.receivePackageNum);
    row.sub_warehouse_name = it.subWarehouseName || null;
    row.receive_address_json = it.receiveAddressInfo ? JSON.stringify(it.receiveAddressInfo) : null;
    row.is_print_box_mark = it.isPrintBoxMark === true ? 1 : (it.isPrintBoxMark === false ? 0 : null);
    row.delivery_method = num(it.deliveryMethod);
    row.express_batch_sn = str(it.expressBatchSn);
    row.predict_package_weight = num(it.predictTotalPackageWeight);
    row.ship_create_time = tsToStr(it.deliveryOrderCreateTime);
    row.inbound_time = tsToStr(it.inboundTime);
    shipMerged += 1;
  }
  const rows = [...byWb.values()];
  const ins = db.prepare(`
    INSERT OR REPLACE INTO erp_temu_openapi_consign
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
       @expect_arrival_at, @urgency_type, @now)`);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM erp_temu_openapi_consign").run();
    for (const row of rows) ins.run({ ...row, now });
  });
  tx();
  return { purchaseOrders: poRows.length, shipMerged, rows: rows.length };
}

async function refreshConsignAllChunked(db, batchSize = 500) {
  const costMap = buildCostMap(db);
  const now = new Date().toISOString();
  const byWb = new Map();
  const poRows = db.prepare("SELECT mall_id, raw_json FROM erp_temu_openapi_records WHERE source='purchase_order'").all();
  await new Promise((r) => setImmediate(r));
  for (let off = 0; off < poRows.length; off += batchSize) {
    const batch = poRows.slice(off, off + batchSize);
    for (const r of batch) {
      let it; try { it = JSON.parse(r.raw_json); } catch { continue; }
      const row = parsePurchaseOrder(it, costMap);
      if (!row.so_id) continue;
      row.mall_id = r.mall_id;
      byWb.set(r.mall_id + "|" + row.so_id, row);
    }
    await new Promise((r) => setImmediate(r));
  }
  let shipMerged = 0;
  const shipRows = db.prepare("SELECT mall_id, raw_json FROM erp_temu_openapi_records WHERE source='ship_order'").all();
  await new Promise((r) => setImmediate(r));
  for (let off = 0; off < shipRows.length; off += batchSize) {
    const batch = shipRows.slice(off, off + batchSize);
    for (const r of batch) {
      let it; try { it = JSON.parse(r.raw_json); } catch { continue; }
      const wb = str(it.subPurchaseOrderSn); if (!wb) continue;
      const row = byWb.get(r.mall_id + "|" + wb);
      if (!row) continue;
      row.ship_status = SHIP_STATUS[String(it.status)] || row.ship_status;
      const dt = tsToStr(it.deliverTime); if (dt) row.deliver_time = dt;
      if (!row.delivery_order_sn && it.deliveryOrderSn) row.delivery_order_sn = str(it.deliveryOrderSn);
      row.express_company = it.expressCompany || null;
      row.express_delivery_sn = str(it.expressDeliverySn);
      row.driver_name = it.driverName || null;
      row.plate_number = it.plateNumber || null;
      row.deliver_package_num = num(it.deliverPackageNum);
      row.receive_package_num = num(it.receivePackageNum);
      row.sub_warehouse_name = it.subWarehouseName || null;
      row.receive_address_json = it.receiveAddressInfo ? JSON.stringify(it.receiveAddressInfo) : null;
      row.is_print_box_mark = it.isPrintBoxMark === true ? 1 : (it.isPrintBoxMark === false ? 0 : null);
      row.delivery_method = num(it.deliveryMethod);
      row.express_batch_sn = str(it.expressBatchSn);
      row.predict_package_weight = num(it.predictTotalPackageWeight);
      row.ship_create_time = tsToStr(it.deliveryOrderCreateTime);
      row.inbound_time = tsToStr(it.inboundTime);
      shipMerged += 1;
    }
    await new Promise((r) => setImmediate(r));
  }
  const rows = [...byWb.values()];
  const ins = db.prepare(`
    INSERT OR REPLACE INTO erp_temu_openapi_consign
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
       @expect_arrival_at, @urgency_type, @now)`);
  db.prepare("DELETE FROM erp_temu_openapi_consign").run();
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const tx = db.transaction(() => { for (const row of chunk) ins.run({ ...row, now }); });
    tx();
    await new Promise((r) => setImmediate(r));
  }
  try { await backfillLabelCodes(db); } catch { /* labelCode 回填失败不阻塞 */ }
  return { purchaseOrders: poRows.length, shipMerged, rows: rows.length };
}

async function backfillLabelCodes(db) {
  const { queryGoodsLabelCodes } = require("./temuOpenApiShipping.cjs");
  const rows = db.prepare(
    "SELECT DISTINCT mall_id, product_skc_id FROM erp_temu_openapi_consign WHERE product_skc_id IS NOT NULL"
  ).all();
  const byMall = new Map();
  for (const r of rows) {
    if (!byMall.has(r.mall_id)) byMall.set(r.mall_id, new Set());
    byMall.get(r.mall_id).add(r.product_skc_id);
  }
  const upd = db.prepare(
    "UPDATE erp_temu_openapi_consign SET label_codes = @lc WHERE mall_id = @mall_id AND product_skc_id = @skc_id"
  );
  let filled = 0;
  console.log(`[backfillLabelCodes] 开始: ${byMall.size} 店铺, ${rows.length} SKC`);
  for (const [mallId, skcSet] of byMall) {
    try {
      const map = await queryGoodsLabelCodes({ db, mallId, skcIds: [...skcSet] });
      const cnt = Object.keys(map).length;
      const tx = db.transaction(() => {
        for (const [skcId, lc] of Object.entries(map)) {
          upd.run({ lc: String(lc), mall_id: mallId, skc_id: skcId });
          filled++;
        }
      });
      tx();
      if (cnt) console.log(`[backfillLabelCodes] mall=${mallId} skcs=${skcSet.size} filled=${cnt}`);
    } catch (e) {
      console.log(`[backfillLabelCodes] mall=${mallId} skcs=${skcSet.size} ERROR: ${e.message}`);
    }
  }
  console.log(`[backfillLabelCodes] 完成: 共填充 ${filled} 条`);
  return filled;
}

module.exports = { refreshConsignAll, refreshConsignAllChunked, backfillLabelCodes, parsePurchaseOrder, buildCostMap, PO_STATUS, SHIP_STATUS };
