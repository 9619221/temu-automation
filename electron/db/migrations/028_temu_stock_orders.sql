CREATE TABLE IF NOT EXISTS erp_temu_stock_orders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  temu_purchase_order_no TEXT NOT NULL,
  parent_order_no TEXT,
  category_type TEXT,
  temu_skc_id TEXT,
  temu_sku_id TEXT,
  sku_code TEXT,
  product_name TEXT,
  demand_qty INTEGER NOT NULL DEFAULT 0,
  temu_status TEXT,
  warehouse_group TEXT,
  urgency_info TEXT,
  order_time TEXT,
  mapped_erp_sku_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  raw_json TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, temu_purchase_order_no),
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(mapped_erp_sku_id) REFERENCES erp_skus(id)
);

CREATE INDEX IF NOT EXISTS idx_temu_so_status ON erp_temu_stock_orders(account_id, sync_status);
CREATE INDEX IF NOT EXISTS idx_temu_so_skc ON erp_temu_stock_orders(account_id, temu_skc_id);

ALTER TABLE erp_outbound_shipments ADD COLUMN temu_stock_order_no TEXT;
ALTER TABLE erp_outbound_shipments ADD COLUMN temu_ship_order_sn TEXT;
ALTER TABLE erp_outbound_shipments ADD COLUMN temu_sync_status TEXT;
