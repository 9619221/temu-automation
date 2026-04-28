CREATE TABLE IF NOT EXISTS erp_migration_log (
  id TEXT PRIMARY KEY,
  migration_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  remark TEXT
);

CREATE TABLE IF NOT EXISTS erp_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  source TEXT NOT NULL DEFAULT 'json_store',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS erp_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  access_code_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS erp_suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  wechat TEXT,
  address TEXT,
  categories_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS erp_skus (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  internal_sku_code TEXT NOT NULL,
  temu_sku_id TEXT,
  temu_product_id TEXT,
  temu_skc_id TEXT,
  product_name TEXT NOT NULL,
  category TEXT,
  image_url TEXT,
  supplier_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, internal_sku_code),
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(supplier_id) REFERENCES erp_suppliers(id)
);

