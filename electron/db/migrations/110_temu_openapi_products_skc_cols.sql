-- @idempotent
-- 商品资料全量查询优化：把原来查询时现场从 raw_json 解析的字段
-- （skc_id / 主图 / 货号 / SKU 摘要）落成实体列，采集入库时写好，
-- 查询直接读列。历史行由 scripts/backfill-temu-openapi-product-cols.cjs 一次性回填。

ALTER TABLE erp_temu_openapi_products ADD COLUMN skc_id TEXT;
ALTER TABLE erp_temu_openapi_products ADD COLUMN thumb_url TEXT;
ALTER TABLE erp_temu_openapi_products ADD COLUMN ext_code TEXT;
ALTER TABLE erp_temu_openapi_products ADD COLUMN skus_json TEXT;

CREATE INDEX IF NOT EXISTS idx_temu_openapi_products_skc
  ON erp_temu_openapi_products(skc_id);
