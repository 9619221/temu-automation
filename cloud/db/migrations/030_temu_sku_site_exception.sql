CREATE TABLE IF NOT EXISTS temu_sku_site_exception_snapshot (
  id                TEXT    PRIMARY KEY,
  tenant_id         TEXT    NOT NULL DEFAULT '',
  mall_id           TEXT    NOT NULL DEFAULT '',
  sku_id            TEXT    NOT NULL DEFAULT '',
  goods_id          TEXT,
  skc_id            TEXT,
  site_name         TEXT    NOT NULL DEFAULT '',
  check_code        TEXT,
  exception_reason  TEXT,
  exception_time    TEXT,
  sku_spec          TEXT,
  raw_json          TEXT,
  source_event_id   INTEGER,
  sources_json      TEXT    NOT NULL DEFAULT '{}',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  last_updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, mall_id, sku_id, site_name)
);

CREATE INDEX IF NOT EXISTS idx_sku_site_exc_snap_mall
  ON temu_sku_site_exception_snapshot(tenant_id, mall_id);
