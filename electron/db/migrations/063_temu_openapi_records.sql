-- @idempotent
-- TEMU 官方开放平台多源采集通用记录表：采购单/发货单/销售/售后/库存等「列表型/快照型」数据。
-- 设计：一张通用表承载多源，按 (mall_id, source, seq) 存当前快照；每次采集对某 mall+source
-- 先 DELETE 再重插（snapshot 语义，避免各源主键不一/历史脏数据）。通用列便于查询/JOIN，
-- 细节全在 raw_json。商品主数据仍走独立的 erp_temu_openapi_products（结构稳定，单独维护）。
-- 写入：electron/erp/services/temuOpenApiCollectors.cjs
-- source 取值：purchase_order | ship_order | sales | return | inventory

CREATE TABLE IF NOT EXISTS erp_temu_openapi_records (
  mall_id        TEXT NOT NULL,
  source         TEXT NOT NULL,
  seq            INTEGER NOT NULL,
  record_key     TEXT,            -- 尽力提取的业务键(订单号/skuId)，便于人读，不作唯一约束
  product_id     TEXT,
  product_skc_id TEXT,
  ext_code       TEXT,            -- 货号(对接 erp_skus.internal_sku_code)
  status         TEXT,
  biz_time       TEXT,            -- 业务时间(下单/发货/出库/供货)
  raw_json       TEXT NOT NULL DEFAULT '{}',
  synced_at      TEXT NOT NULL,
  PRIMARY KEY (mall_id, source, seq)
);
CREATE INDEX IF NOT EXISTS idx_erp_temu_oa_records_mall_source ON erp_temu_openapi_records(mall_id, source);
CREATE INDEX IF NOT EXISTS idx_erp_temu_oa_records_skc ON erp_temu_openapi_records(product_skc_id);
CREATE INDEX IF NOT EXISTS idx_erp_temu_oa_records_extcode ON erp_temu_openapi_records(ext_code);

-- 授权表加多源采集状态
ALTER TABLE erp_temu_openapi_auth ADD COLUMN last_records_sync_at TEXT;
ALTER TABLE erp_temu_openapi_auth ADD COLUMN records_sync_summary_json TEXT;   -- {"purchase_order":N,"ship_order":N,...}
ALTER TABLE erp_temu_openapi_auth ADD COLUMN last_records_sync_status TEXT;
ALTER TABLE erp_temu_openapi_auth ADD COLUMN last_records_sync_error TEXT;
