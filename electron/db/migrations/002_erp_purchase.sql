CREATE TABLE IF NOT EXISTS erp_purchase_requests (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  requested_by TEXT,
  reason TEXT NOT NULL,
  requested_qty INTEGER NOT NULL,
  target_unit_cost REAL,
  expected_arrival_date TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(sku_id) REFERENCES erp_skus(id),
  FOREIGN KEY(requested_by) REFERENCES erp_users(id)
);

CREATE TABLE IF NOT EXISTS erp_sourcing_candidates (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  pr_id TEXT NOT NULL,
  purchase_source TEXT NOT NULL,
  sourcing_method TEXT NOT NULL DEFAULT 'manual',
  supplier_id TEXT,
  supplier_name TEXT,
  product_title TEXT,
  product_url TEXT,
  image_url TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  moq INTEGER NOT NULL DEFAULT 1,
  lead_days INTEGER,
  logistics_fee REAL DEFAULT 0,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(pr_id) REFERENCES erp_purchase_requests(id),
  FOREIGN KEY(supplier_id) REFERENCES erp_suppliers(id),
  FOREIGN KEY(created_by) REFERENCES erp_users(id)
);

CREATE TABLE IF NOT EXISTS erp_purchase_orders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  pr_id TEXT,
  selected_candidate_id TEXT,
  supplier_id TEXT,
  po_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  expected_delivery_date TEXT,
  actual_delivery_date TEXT,
  total_amount REAL NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, po_no),
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(pr_id) REFERENCES erp_purchase_requests(id),
  FOREIGN KEY(selected_candidate_id) REFERENCES erp_sourcing_candidates(id),
  FOREIGN KEY(supplier_id) REFERENCES erp_suppliers(id),
  FOREIGN KEY(created_by) REFERENCES erp_users(id)
);

CREATE TABLE IF NOT EXISTS erp_purchase_order_lines (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  po_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  logistics_fee REAL DEFAULT 0,
  expected_qty INTEGER NOT NULL DEFAULT 0,
  received_qty INTEGER NOT NULL DEFAULT 0,
  remark TEXT,
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(po_id) REFERENCES erp_purchase_orders(id),
  FOREIGN KEY(sku_id) REFERENCES erp_skus(id)
);

CREATE TABLE IF NOT EXISTS erp_payment_approvals (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  po_id TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  paid_at TEXT,
  payment_method TEXT,
  payment_reference TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(po_id) REFERENCES erp_purchase_orders(id),
  FOREIGN KEY(requested_by) REFERENCES erp_users(id),
  FOREIGN KEY(approved_by) REFERENCES erp_users(id)
);

