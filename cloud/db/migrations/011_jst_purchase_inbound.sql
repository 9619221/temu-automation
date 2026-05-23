CREATE TABLE IF NOT EXISTS jst_purchase_inbound_orders (
  tenant_id TEXT NOT NULL,
  receipt_no TEXT NOT NULL,
  purchase_no TEXT,
  online_purchase_no TEXT,
  supplier_name TEXT,
  supplier_code TEXT,
  account_name TEXT,
  operation_warehouse_name TEXT,
  warehouse_name TEXT,
  status TEXT,
  finance_status TEXT,
  inbound_type TEXT,
  created_at TEXT,
  inbound_at TEXT,
  archived_at TEXT,
  modified_at TEXT,
  total_qty REAL,
  line_count INTEGER,
  sku_count INTEGER,
  total_amount REAL,
  freight_amount REAL,
  fee_amount REAL,
  paid_amount REAL,
  purchaser_name TEXT,
  creator_name TEXT,
  logistics_company TEXT,
  tracking_no TEXT,
  labels TEXT,
  remark TEXT,
  source_file TEXT,
  raw_json TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, receipt_no)
);

CREATE INDEX IF NOT EXISTS idx_jst_purchase_inbound_orders_tenant_date
  ON jst_purchase_inbound_orders(tenant_id, inbound_at DESC);

CREATE INDEX IF NOT EXISTS idx_jst_purchase_inbound_orders_purchase
  ON jst_purchase_inbound_orders(tenant_id, purchase_no);

CREATE INDEX IF NOT EXISTS idx_jst_purchase_inbound_orders_account
  ON jst_purchase_inbound_orders(tenant_id, account_name);

CREATE TABLE IF NOT EXISTS jst_purchase_inbound_lines (
  tenant_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  receipt_no TEXT NOT NULL,
  purchase_no TEXT,
  online_purchase_no TEXT,
  account_name TEXT,
  supplier_name TEXT,
  supplier_code TEXT,
  operation_warehouse_name TEXT,
  warehouse_name TEXT,
  status TEXT,
  finance_status TEXT,
  inbound_type TEXT,
  created_at TEXT,
  inbound_at TEXT,
  archived_at TEXT,
  sku_code TEXT,
  product_name TEXT,
  style_code TEXT,
  color_spec TEXT,
  image_url TEXT,
  product_tag TEXT,
  qty REAL,
  qc_qty REAL,
  qc_good_qty REAL,
  qc_defective_qty REAL,
  unit TEXT,
  box_qty REAL,
  carton_qty REAL,
  unit_price REAL,
  amount REAL,
  tax_rate REAL,
  no_tax_unit_price REAL,
  no_tax_amount REAL,
  warehouse_available_qty REAL,
  bind_location TEXT,
  shelf_location TEXT,
  supplier_style_no TEXT,
  supplier_sku_code TEXT,
  weight REAL,
  volume REAL,
  remark TEXT,
  source_file TEXT,
  raw_json TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, line_id)
);

CREATE INDEX IF NOT EXISTS idx_jst_purchase_inbound_lines_tenant_date
  ON jst_purchase_inbound_lines(tenant_id, inbound_at DESC);

CREATE INDEX IF NOT EXISTS idx_jst_purchase_inbound_lines_receipt
  ON jst_purchase_inbound_lines(tenant_id, receipt_no);

CREATE INDEX IF NOT EXISTS idx_jst_purchase_inbound_lines_purchase
  ON jst_purchase_inbound_lines(tenant_id, purchase_no);

CREATE INDEX IF NOT EXISTS idx_jst_purchase_inbound_lines_sku
  ON jst_purchase_inbound_lines(tenant_id, sku_code);

CREATE INDEX IF NOT EXISTS idx_jst_purchase_inbound_lines_account
  ON jst_purchase_inbound_lines(tenant_id, account_name);
