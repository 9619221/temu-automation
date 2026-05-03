ALTER TABLE erp_sku_1688_sources
  ADD COLUMN mapping_group_id TEXT NOT NULL DEFAULT '';

ALTER TABLE erp_sku_1688_sources
  ADD COLUMN platform_sku_name TEXT;

ALTER TABLE erp_sku_1688_sources
  ADD COLUMN our_qty INTEGER NOT NULL DEFAULT 1;

ALTER TABLE erp_sku_1688_sources
  ADD COLUMN platform_qty INTEGER NOT NULL DEFAULT 1;

ALTER TABLE erp_sku_1688_sources
  ADD COLUMN remark TEXT;

CREATE INDEX IF NOT EXISTS idx_sku_1688_sources_mapping_group
  ON erp_sku_1688_sources(account_id, sku_id, status, mapping_group_id, is_default, updated_at);
