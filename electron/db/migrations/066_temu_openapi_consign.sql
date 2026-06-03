-- @idempotent
-- 出库中心「官方 API 化」物化表：把官方 bg.purchaseorderv2.get(备货单) + bg.shiporderv2.get(发货单)
-- 按备货单号(subPurchaseOrderSn=WB,与聚水潭 jst_consign_deliveries.so_id 同键)合并成规整一行，
-- 供 UNIFIED_CONSIGN_CTE 的 Temu 侧读取，替代抓包 cloud.temu_stock_order_snapshot。
-- 金额按「Σ(数量 × erp_skus.weighted_avg_cost[extCode])」自算(官方备货单不带金额)。
-- 状态复用抓包 stock_order 同套码(7已收货/8取消/2,3已发货/1待发货/0已付款待审核)。
-- 解析回填见 electron/erp/services/temuOpenApiConsign.cjs，定时刷新 scripts/refresh-openapi-consign.cjs。

CREATE TABLE IF NOT EXISTS erp_temu_openapi_consign (
  mall_id              TEXT NOT NULL,
  so_id                TEXT NOT NULL,     -- subPurchaseOrderSn (WB, = 聚水潭 so_id 对账键)
  original_po_sn       TEXT,              -- originalPurchaseOrderSn (WP 采购母单)
  delivery_order_sn    TEXT,              -- FH 发货单
  product_id           TEXT,
  product_skc_id       TEXT,
  product_name         TEXT,              -- productName
  sku_ext_codes        TEXT,              -- 货号(多 SKU 逗号拼)
  spec_names           TEXT,              -- className 拼
  demand_qty           INTEGER,           -- Σ purchaseQuantity
  delivered_qty        INTEGER,           -- Σ deliverQuantity
  received_qty         INTEGER,           -- Σ realReceiveAuthenticQuantity
  amount_cents         INTEGER,           -- Σ(deliverQuantity × weighted_avg_cost) ×100;货号无成本则该行计 0
  cost_coverage        INTEGER,           -- 算到成本的 SKU 数(用于判断金额完整度)
  sku_count            INTEGER,           -- SKU 行数
  temu_status          TEXT,              -- purchase_order.status 映射中文
  ship_status          TEXT,              -- ship_order.status 映射(有发货单时)
  order_time           TEXT,              -- purchaseTime → 'YYYY-MM-DD HH:MM:SS'(统一格式,避免排序乱)
  deliver_time         TEXT,              -- ship deliverTime / deliverInfo.deliverTime
  latest_ship_at       TEXT,              -- expectLatestDeliverTimeOrDefault
  receive_warehouse_name TEXT,
  supplier_name        TEXT,
  synced_at            TEXT NOT NULL,
  PRIMARY KEY (mall_id, so_id)
);
CREATE INDEX IF NOT EXISTS idx_oa_consign_so ON erp_temu_openapi_consign(so_id);
CREATE INDEX IF NOT EXISTS idx_oa_consign_mall ON erp_temu_openapi_consign(mall_id);
CREATE INDEX IF NOT EXISTS idx_oa_consign_status ON erp_temu_openapi_consign(temu_status);
