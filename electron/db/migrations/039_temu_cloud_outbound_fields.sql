-- @idempotent
ALTER TABLE erp_outbound_shipments ADD COLUMN temu_stock_order_no TEXT;
ALTER TABLE erp_outbound_shipments ADD COLUMN temu_delivery_order_sn TEXT;
ALTER TABLE erp_outbound_shipments ADD COLUMN temu_delivery_batch_sn TEXT;
ALTER TABLE erp_outbound_shipments ADD COLUMN temu_sync_status TEXT;

CREATE INDEX IF NOT EXISTS idx_erp_outbound_temu_stock_order
  ON erp_outbound_shipments(account_id, temu_stock_order_no);
