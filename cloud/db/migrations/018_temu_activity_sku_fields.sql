ALTER TABLE temu_activity_snapshot ADD COLUMN sku_id TEXT;
ALTER TABLE temu_activity_snapshot ADD COLUMN sku_ext_code TEXT;
ALTER TABLE temu_activity_snapshot ADD COLUMN sku_attr_text TEXT;
ALTER TABLE temu_activity_snapshot ADD COLUMN daily_price_cents INTEGER;

CREATE INDEX IF NOT EXISTS idx_temu_activity_sku
  ON temu_activity_snapshot(tenant_id, mall_id, skc_id, sku_id, stat_date);
