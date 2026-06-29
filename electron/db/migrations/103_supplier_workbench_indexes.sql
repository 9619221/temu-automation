-- @idempotent
-- 供应商工作台 + 商品资料列表聚合查询加速

CREATE INDEX IF NOT EXISTS idx_erp_skus_supplier_status
  ON erp_skus(supplier_id, status);

CREATE INDEX IF NOT EXISTS idx_erp_po_supplier_status
  ON erp_purchase_orders(supplier_id, status);

CREATE INDEX IF NOT EXISTS idx_sku_1688_sources_sku_status
  ON erp_sku_1688_sources(sku_id, status);
