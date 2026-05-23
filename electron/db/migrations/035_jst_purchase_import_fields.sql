-- @idempotent
ALTER TABLE erp_purchase_orders ADD COLUMN jst_purchaser_name TEXT;
ALTER TABLE erp_purchase_order_lines ADD COLUMN jst_payload_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_erp_purchase_order_lines_po
  ON erp_purchase_order_lines(po_id);
