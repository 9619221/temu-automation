-- 合规属性（制造商/欧代/土代/进口商）
-- 数据来源：扩展 hook 捕获 /ms/bg-flux-ms/compliance_property/page_query 等接口
-- 用于条码标签打印自动填充合规信息

CREATE TABLE IF NOT EXISTS temu_compliance_property (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mall_id TEXT NOT NULL DEFAULT '',
  site TEXT,
  product_skc_id TEXT NOT NULL,
  product_name TEXT,
  manufacturer_name TEXT,
  manufacturer_address TEXT,
  manufacturer_email TEXT,
  ec_rep_name TEXT,
  ec_rep_address TEXT,
  ec_rep_email TEXT,
  tur_rep_name TEXT,
  tur_rep_address TEXT,
  importer_name TEXT,
  importer_address TEXT,
  raw_json TEXT,
  source_event_id TEXT,
  sources_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, mall_id, product_skc_id)
);

CREATE INDEX IF NOT EXISTS idx_temu_compliance_tenant_mall
  ON temu_compliance_property(tenant_id, mall_id, last_updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_temu_compliance_skc
  ON temu_compliance_property(tenant_id, product_skc_id);
