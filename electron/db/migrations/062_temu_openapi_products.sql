-- @idempotent
-- TEMU 官方开放平台商品主数据：定时调 bg.glo.goods.list.get(PA网关) 全量翻页采集落库。
-- 数据源与抓包(cloud temu-cloud.sqlite 的 skc_snapshots/temu_sales_snapshot)不同——
-- 此处是官方 API 权威主数据，存在 erp.sqlite，按 mall_id 维度。
-- 写入：electron/erp/services/temuOpenApiProductSync.cjs  syncOneMall / syncAllMalls
-- 调度：systemd timer 跑 scripts/sync-temu-openapi-products.cjs；ERP 也提供「立即采集」手动触发。
--
-- 整文件标 @idempotent：CREATE TABLE IF NOT EXISTS 安全，下面给 erp_temu_openapi_auth
-- 加的列若已存在会被 execStatementsIdempotently 吞掉 duplicate column 错误。

-- 商品主数据表：PK=(mall_id, product_id)
CREATE TABLE IF NOT EXISTS erp_temu_openapi_products (
  mall_id                 TEXT NOT NULL,
  product_id              TEXT NOT NULL,
  product_name            TEXT,
  jit_mode                INTEGER NOT NULL DEFAULT 0,
  product_properties_json TEXT NOT NULL DEFAULT '[]',
  sku_count               INTEGER NOT NULL DEFAULT 0,
  raw_json                TEXT NOT NULL DEFAULT '{}',
  last_synced_at          TEXT NOT NULL,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  PRIMARY KEY (mall_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_erp_temu_oa_products_mall ON erp_temu_openapi_products(mall_id);
CREATE INDEX IF NOT EXISTS idx_erp_temu_oa_products_synced ON erp_temu_openapi_products(last_synced_at);

-- SKU 子表：PK=(mall_id, product_sku_id)，含货号(ext_code)/重量/体积/敏感属性
CREATE TABLE IF NOT EXISTS erp_temu_openapi_skus (
  mall_id           TEXT NOT NULL,
  product_sku_id    TEXT NOT NULL,
  product_id        TEXT NOT NULL,
  ext_code          TEXT,
  weight_value      REAL,
  weight_unit       TEXT,
  volume_len        REAL,
  volume_width      REAL,
  volume_height     REAL,
  sensitive_json    TEXT NOT NULL DEFAULT '{}',
  raw_json          TEXT NOT NULL DEFAULT '{}',
  last_synced_at    TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (mall_id, product_sku_id)
);
CREATE INDEX IF NOT EXISTS idx_erp_temu_oa_skus_mall ON erp_temu_openapi_skus(mall_id);
CREATE INDEX IF NOT EXISTS idx_erp_temu_oa_skus_product ON erp_temu_openapi_skus(mall_id, product_id);
-- 货号绑定：erp_skus.internal_sku_code == ext_code，建索引便于 JOIN
CREATE INDEX IF NOT EXISTS idx_erp_temu_oa_skus_extcode ON erp_temu_openapi_skus(ext_code);

-- 给授权表加采集状态列（@idempotent 吞 duplicate column）
ALTER TABLE erp_temu_openapi_auth ADD COLUMN last_product_sync_at TEXT;
ALTER TABLE erp_temu_openapi_auth ADD COLUMN product_sync_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE erp_temu_openapi_auth ADD COLUMN last_product_sync_status TEXT;
ALTER TABLE erp_temu_openapi_auth ADD COLUMN last_product_sync_error TEXT;
