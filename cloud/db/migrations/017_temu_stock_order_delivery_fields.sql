ALTER TABLE temu_stock_order_snapshot ADD COLUMN source_type TEXT;
ALTER TABLE temu_stock_order_snapshot ADD COLUMN online_order_no TEXT;
ALTER TABLE temu_stock_order_snapshot ADD COLUMN internal_order_no TEXT;
ALTER TABLE temu_stock_order_snapshot ADD COLUMN order_amount_cents INTEGER;
ALTER TABLE temu_stock_order_snapshot ADD COLUMN currency TEXT;
ALTER TABLE temu_stock_order_snapshot ADD COLUMN shipping_qty INTEGER;
ALTER TABLE temu_stock_order_snapshot ADD COLUMN inbound_qty INTEGER;
ALTER TABLE temu_stock_order_snapshot ADD COLUMN weight_kg REAL;
ALTER TABLE temu_stock_order_snapshot ADD COLUMN package_count INTEGER;
ALTER TABLE temu_stock_order_snapshot ADD COLUMN package_no TEXT;
ALTER TABLE temu_stock_order_snapshot ADD COLUMN logistics_info TEXT;

CREATE INDEX IF NOT EXISTS idx_temu_stock_order_source_type
  ON temu_stock_order_snapshot(tenant_id, mall_id, source_type, last_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_temu_stock_order_delivery_identity
  ON temu_stock_order_snapshot(tenant_id, mall_id, stock_order_no, delivery_order_sn, delivery_batch_sn);
