CREATE TABLE IF NOT EXISTS erp_companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO erp_companies (
  id, name, code, status, created_at, updated_at
)
VALUES (
  'company_default',
  'Default Company',
  'default',
  'active',
  datetime('now'),
  datetime('now')
);

ALTER TABLE erp_users
  ADD COLUMN company_id TEXT DEFAULT 'company_default';

UPDATE erp_users
SET company_id = 'company_default'
WHERE company_id IS NULL OR company_id = '';

ALTER TABLE erp_accounts
  ADD COLUMN company_id TEXT DEFAULT 'company_default';

UPDATE erp_accounts
SET company_id = 'company_default'
WHERE company_id IS NULL OR company_id = '';

ALTER TABLE erp_suppliers
  ADD COLUMN company_id TEXT DEFAULT 'company_default';

UPDATE erp_suppliers
SET company_id = 'company_default'
WHERE company_id IS NULL OR company_id = '';

ALTER TABLE erp_1688_auth_settings
  ADD COLUMN company_id TEXT DEFAULT 'company_default';

UPDATE erp_1688_auth_settings
SET company_id = 'company_default'
WHERE company_id IS NULL OR company_id = '';

ALTER TABLE erp_1688_oauth_states
  ADD COLUMN company_id TEXT DEFAULT 'company_default';

UPDATE erp_1688_oauth_states
SET company_id = 'company_default'
WHERE company_id IS NULL OR company_id = '';

ALTER TABLE erp_1688_delivery_addresses
  ADD COLUMN company_id TEXT DEFAULT 'company_default';

UPDATE erp_1688_delivery_addresses
SET company_id = 'company_default'
WHERE company_id IS NULL OR company_id = '';

CREATE TABLE IF NOT EXISTS erp_warehouses (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  name TEXT NOT NULL,
  code TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, code),
  FOREIGN KEY(company_id) REFERENCES erp_companies(id)
);

CREATE TABLE IF NOT EXISTS erp_role_permissions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  role TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'allow',
  conditions_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, role, resource_type, resource_key),
  FOREIGN KEY(company_id) REFERENCES erp_companies(id)
);

CREATE TABLE IF NOT EXISTS erp_user_resource_scopes (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'company_default',
  user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'manage',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, user_id, resource_type, resource_id),
  FOREIGN KEY(company_id) REFERENCES erp_companies(id),
  FOREIGN KEY(user_id) REFERENCES erp_users(id)
);

INSERT OR IGNORE INTO erp_role_permissions (
  id, company_id, role, resource_type, resource_key, access_level,
  conditions_json, created_at, updated_at
)
VALUES
  ('perm_default_admin_all', 'company_default', 'admin', 'menu', '*', 'manage', '{}', datetime('now'), datetime('now')),
  ('perm_default_manager_all', 'company_default', 'manager', 'menu', '*', 'manage', '{}', datetime('now'), datetime('now')),
  ('perm_default_operations_purchase', 'company_default', 'operations', 'menu', 'purchase', 'write', '{}', datetime('now'), datetime('now')),
  ('perm_default_operations_qc', 'company_default', 'operations', 'menu', 'qc', 'write', '{}', datetime('now'), datetime('now')),
  ('perm_default_operations_outbound', 'company_default', 'operations', 'menu', 'outbound', 'write', '{}', datetime('now'), datetime('now')),
  ('perm_default_buyer_purchase', 'company_default', 'buyer', 'menu', 'purchase', 'write', '{}', datetime('now'), datetime('now')),
  ('perm_default_finance_purchase', 'company_default', 'finance', 'menu', 'purchase', 'approve', '{}', datetime('now'), datetime('now')),
  ('perm_default_warehouse_warehouse', 'company_default', 'warehouse', 'menu', 'warehouse', 'write', '{}', datetime('now'), datetime('now')),
  ('perm_default_warehouse_outbound', 'company_default', 'warehouse', 'menu', 'outbound', 'write', '{}', datetime('now'), datetime('now')),
  ('perm_default_viewer_home', 'company_default', 'viewer', 'menu', 'home', 'read', '{}', datetime('now'), datetime('now'));

CREATE INDEX IF NOT EXISTS idx_erp_users_company_role
  ON erp_users(company_id, role, status);

CREATE INDEX IF NOT EXISTS idx_erp_accounts_company_status
  ON erp_accounts(company_id, status);

CREATE INDEX IF NOT EXISTS idx_erp_suppliers_company_status
  ON erp_suppliers(company_id, status);

CREATE INDEX IF NOT EXISTS idx_1688_auth_company
  ON erp_1688_auth_settings(company_id);

CREATE INDEX IF NOT EXISTS idx_1688_addresses_company_default
  ON erp_1688_delivery_addresses(company_id, status, is_default);

CREATE INDEX IF NOT EXISTS idx_erp_warehouses_company_status
  ON erp_warehouses(company_id, status);

CREATE INDEX IF NOT EXISTS idx_erp_role_permissions_company_role
  ON erp_role_permissions(company_id, role, resource_type);

CREATE INDEX IF NOT EXISTS idx_erp_user_resource_scopes_user
  ON erp_user_resource_scopes(company_id, user_id, resource_type);
