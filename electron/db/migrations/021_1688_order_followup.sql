ALTER TABLE erp_purchase_orders
  ADD COLUMN external_payment_url TEXT;

ALTER TABLE erp_purchase_orders
  ADD COLUMN external_payment_url_synced_at TEXT;

ALTER TABLE erp_purchase_orders
  ADD COLUMN external_order_detail_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE erp_purchase_orders
  ADD COLUMN external_order_detail_synced_at TEXT;

ALTER TABLE erp_purchase_orders
  ADD COLUMN external_logistics_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE erp_purchase_orders
  ADD COLUMN external_logistics_synced_at TEXT;

CREATE INDEX IF NOT EXISTS idx_erp_po_external_payment_url
  ON erp_purchase_orders(external_payment_url_synced_at);
