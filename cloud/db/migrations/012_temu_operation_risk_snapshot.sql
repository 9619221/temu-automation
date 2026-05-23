CREATE TABLE IF NOT EXISTS temu_operation_risk_snapshot (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mall_id TEXT NOT NULL DEFAULT '',
  site TEXT,
  stat_date TEXT NOT NULL,
  risk_type TEXT NOT NULL,
  risk_key TEXT NOT NULL,
  risk_title TEXT,
  risk_status TEXT,
  severity TEXT,
  product_id TEXT,
  skc_id TEXT,
  goods_id TEXT,
  order_id TEXT,
  quantity INTEGER,
  metric_json TEXT,
  raw_json TEXT,
  source_event_id TEXT,
  sources_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, mall_id, risk_type, risk_key, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_temu_operation_risk_tenant_mall_date
  ON temu_operation_risk_snapshot(tenant_id, mall_id, stat_date);

CREATE INDEX IF NOT EXISTS idx_temu_operation_risk_type
  ON temu_operation_risk_snapshot(tenant_id, mall_id, risk_type, severity, stat_date);
