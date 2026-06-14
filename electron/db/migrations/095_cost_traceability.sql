-- @idempotent
-- Cost traceability for settlement matching and SKU weighted-cost changes.

ALTER TABLE erp_temu_settlement_order_detail ADD COLUMN wb_no TEXT;

CREATE INDEX IF NOT EXISTS idx_temu_settlement_order_detail_wb
  ON erp_temu_settlement_order_detail(wb_no);

CREATE TABLE IF NOT EXISTS erp_inventory_cost_events (
  id                         TEXT PRIMARY KEY,
  sku_id                     TEXT NOT NULL,
  event_type                 TEXT NOT NULL,
  event_time                 TEXT NOT NULL,
  qty_delta                  REAL NOT NULL DEFAULT 0,
  old_qty                    REAL NOT NULL DEFAULT 0,
  new_qty                    REAL NOT NULL DEFAULT 0,
  unit_cost                  REAL,
  old_weighted_avg_cost      REAL,
  new_weighted_avg_cost      REAL,
  source_doc_type            TEXT,
  source_doc_id              TEXT,
  severity                   TEXT NOT NULL DEFAULT 'info',
  status                     TEXT NOT NULL DEFAULT 'recorded',
  message                    TEXT,
  raw_json                   TEXT NOT NULL DEFAULT '{}',
  created_at                 TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_cost_events_sku_time
  ON erp_inventory_cost_events(sku_id, event_time);

CREATE INDEX IF NOT EXISTS idx_inventory_cost_events_source
  ON erp_inventory_cost_events(source_doc_type, source_doc_id);

CREATE TABLE IF NOT EXISTS erp_sku_cost_daily_snapshot (
  sku_id                     TEXT NOT NULL,
  stat_date                  TEXT NOT NULL,
  weighted_avg_cost          REAL NOT NULL DEFAULT 0,
  cost_balance_qty           REAL NOT NULL DEFAULT 0,
  source_event_id            TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  PRIMARY KEY (sku_id, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_sku_cost_daily_snapshot_sku_date
  ON erp_sku_cost_daily_snapshot(sku_id, stat_date);
