/**
 * 运营工作台「官方 API 化」解析服务。
 *
 * 把官方 bg.goods.salesv2.get 的采集结果（erp_temu_openapi_records, source='sales'）的 raw_json
 * 展开为 SKU 级规整行，物化到 erp_temu_openapi_sku_sales（migration 065）。报表层
 * buildSkuSales / buildShopHealth 直接读该表，替代抓包 cloud.temu_sales_snapshot。
 *
 * 结构：每个 product 一条 record；raw.skuQuantityDetailList[] 每项 = 一个 SKU，其顶层字段
 * （todaySaleVolume / lastSeven|ThirtyDaysSaleVolume / inventoryNumInfo 等）即跨仓组汇总值，
 * 直接采用，不必再聚合 warehouseInfoList。
 *
 * snapshot 语义：整表 DELETE + 重插（records 表本身就是各店 sales 的当前全量快照）。
 *
 * 纯函数 + 注入 db，供 scripts/refresh-openapi-sku-sales.cjs（cron）与 ipc/手动刷新复用。
 */
"use strict";

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v) { return v == null ? null : String(v); }

/** 把 records(source='sales') 行集解析为 SKU 级规整行数组。导出供测试。 */
function parseSalesRecords(recordRows) {
  const out = [];
  for (const r of recordRows) {
    let item;
    try { item = JSON.parse(r.raw_json); } catch { continue; }
    if (!item || typeof item !== "object") continue;
    const list = Array.isArray(item.skuQuantityDetailList) ? item.skuQuantityDetailList : [];
    for (const sku of list) {
      const skuId = sku && sku.productSkuId != null ? String(sku.productSkuId) : "";
      if (!skuId) continue;
      const inv = (sku.inventoryNumInfo && typeof sku.inventoryNumInfo === "object") ? sku.inventoryNumInfo : {};
      const ext = sku.skuExtCode != null && String(sku.skuExtCode).trim() !== "" ? String(sku.skuExtCode) : null;
      // 可售天数：官方 availableSaleDays(真·库存÷日均,仅活跃SKU~2.6%有值)优先；缺失则按 可用库存÷近7天日均 自算。
      // 注意 stockDays 普遍=3 是统计窗口而非可售天数，不可用。
      const whStock = num(inv.warehouseInventoryNum);
      const d7v = num(sku.lastSevenDaysSaleVolume);
      let saleDays = num(sku.availableSaleDays != null ? sku.availableSaleDays : sku.warehouseAvailableSaleDays);
      if (saleDays == null && whStock != null && whStock > 0 && d7v != null && d7v > 0) {
        saleDays = Math.round((whStock * 7 / d7v) * 10) / 10;
      }
      out.push({
        mall_id: r.mall_id,
        product_id: str(item.productId),
        product_skc_id: str(item.productSkcId),
        product_sku_id: skuId,
        ext_code: ext,
        title: item.productName || null,
        thumb_url: item.productSkcPicture || null,
        category: item.category || null,
        spec_name: sku.className || null,
        today_sales: num(sku.todaySaleVolume),
        last7d_sales: num(sku.lastSevenDaysSaleVolume),
        last30d_sales: num(sku.lastThirtyDaysSaleVolume),
        total_sales: num(sku.totalSaleVolume),
        sale_days: saleDays,
        advice_qty: num(sku.adviceQuantity),
        lack_quantity: num(sku.lackQuantity),
        warehouse_stock: num(inv.warehouseInventoryNum),
        occupy_stock: num(inv.expectedOccupiedInventoryNum),
        unavailable_stock: num(inv.unavailableWarehouseInventoryNum),
        wait_in_stock: (num(inv.waitInStock) || 0) + (num(inv.waitReceiveNum) || 0),
        supply_status: str(item.supplyStatus),
        onsales_duration_offline: num(item.onSalesDurationOffline),
        hot_tag: item.hotTag ? 1 : 0,        // 热销款（商品级）
        has_hot_sku: item.hasHotSku ? 1 : 0, // 存在爆旺款 SKU（商品级）
      });
    }
  }
  return out;
}

/** 全量重建 erp_temu_openapi_sku_sales。返回 { records, skuRows }。 */
function refreshSkuSalesAll(db) {
  const recs = db.prepare("SELECT mall_id, raw_json FROM erp_temu_openapi_records WHERE source = 'sales'").all();
  const rows = parseSalesRecords(recs);
  const now = new Date().toISOString();
  const ins = db.prepare(`
    INSERT OR REPLACE INTO erp_temu_openapi_sku_sales
      (mall_id, product_id, product_skc_id, product_sku_id, ext_code, title, thumb_url, category, spec_name,
       today_sales, last7d_sales, last30d_sales, total_sales, sale_days, advice_qty, lack_quantity,
       warehouse_stock, occupy_stock, unavailable_stock, wait_in_stock, supply_status, onsales_duration_offline, hot_tag, has_hot_sku, synced_at)
    VALUES
      (@mall_id, @product_id, @product_skc_id, @product_sku_id, @ext_code, @title, @thumb_url, @category, @spec_name,
       @today_sales, @last7d_sales, @last30d_sales, @total_sales, @sale_days, @advice_qty, @lack_quantity,
       @warehouse_stock, @occupy_stock, @unavailable_stock, @wait_in_stock, @supply_status, @onsales_duration_offline, @hot_tag, @has_hot_sku, @now)
  `);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM erp_temu_openapi_sku_sales").run();
    for (const row of rows) ins.run({ ...row, now });
  });
  tx();
  return { records: recs.length, skuRows: rows.length };
}

module.exports = { refreshSkuSalesAll, parseSalesRecords };
