-- 核心表：租户 / 用户 / 设备 / 店铺 / 事件 / 维度统计

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  device_uuid TEXT NOT NULL UNIQUE,
  user_id TEXT,
  user_agent TEXT,
  last_seen TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_devices_tenant ON devices(tenant_id);

CREATE TABLE IF NOT EXISTS mall_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site TEXT NOT NULL,
  mall_id TEXT NOT NULL,
  mall_name TEXT,
  last_seen TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, site, mall_id)
);

CREATE TABLE IF NOT EXISTS capture_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  device_id TEXT,
  mall_id TEXT,
  site TEXT,
  page TEXT,
  kind TEXT NOT NULL,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  url_path TEXT NOT NULL,
  status INTEGER,
  body_size INTEGER,
  body_json TEXT,
  ts INTEGER NOT NULL,
  captured_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_capture_events_tenant_ts ON capture_events(tenant_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_capture_events_url_path ON capture_events(url_path);
CREATE INDEX IF NOT EXISTS idx_capture_events_mall ON capture_events(tenant_id, mall_id);
CREATE INDEX IF NOT EXISTS idx_capture_events_received ON capture_events(tenant_id, received_at DESC);

CREATE TABLE IF NOT EXISTS api_endpoint_stats (
  tenant_id TEXT NOT NULL,
  site TEXT NOT NULL,
  method TEXT NOT NULL,
  url_path TEXT NOT NULL,
  count_total INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER,
  PRIMARY KEY (tenant_id, site, method, url_path)
);
