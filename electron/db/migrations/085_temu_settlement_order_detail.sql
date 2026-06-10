-- @idempotent
-- Temu settlement batch order detail captured from:
-- /api/merchant/fund/detail/item/semi/download
-- One row is one parsed xlsx line from a settlement fund batch.
CREATE TABLE IF NOT EXISTS erp_temu_settlement_order_detail (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  mall_id               TEXT    NOT NULL,
  site                  TEXT    NOT NULL DEFAULT 'agentseller',
  batch_id              TEXT    NOT NULL,
  fund_type             TEXT,
  create_time           TEXT,
  sheet_name            TEXT,
  source_row_count      INTEGER,
  row_index             INTEGER NOT NULL,
  order_sn              TEXT,
  parent_order_sn       TEXT,
  sku_id                TEXT,
  sku_ext_code          TEXT,
  product_name          TEXT,
  quantity              REAL,
  currency              TEXT    DEFAULT 'CNY',
  amount                REAL,
  columns_json          TEXT    NOT NULL DEFAULT '[]',
  raw_json              TEXT    NOT NULL DEFAULT '{}',
  source_received_at    INTEGER,
  captured_at           TEXT    DEFAULT (datetime('now')),
  updated_at            TEXT    DEFAULT (datetime('now')),
  UNIQUE(mall_id, batch_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_temu_settlement_order_detail_mall_batch
  ON erp_temu_settlement_order_detail(mall_id, batch_id);

CREATE INDEX IF NOT EXISTS idx_temu_settlement_order_detail_order
  ON erp_temu_settlement_order_detail(order_sn);

CREATE INDEX IF NOT EXISTS idx_temu_settlement_order_detail_sku
  ON erp_temu_settlement_order_detail(sku_ext_code, sku_id);
