-- @idempotent
-- Temu seller-center settlement detail captured from:
-- /api/merchant/settle/detail/full/wait-settlement
-- /api/merchant/settle/detail/full/in-settlement
-- /api/merchant/settle/detail/full/settled
CREATE TABLE IF NOT EXISTS erp_temu_settlement_detail (
  scope_key                TEXT NOT NULL,
  mall_id                  TEXT,
  site                     TEXT NOT NULL DEFAULT '',
  settlement_status        TEXT NOT NULL,
  stat_date                TEXT NOT NULL,
  item_key                 TEXT NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'CNY',
  estimated_amount         REAL NOT NULL DEFAULT 0,
  sales_receipt_amount     REAL NOT NULL DEFAULT 0,
  chargeback_amount        REAL NOT NULL DEFAULT 0,
  subsidy_amount           REAL NOT NULL DEFAULT 0,
  total_amount             REAL NOT NULL DEFAULT 0,
  amounts_json             TEXT NOT NULL DEFAULT '{}',
  raw_json                 TEXT NOT NULL DEFAULT '{}',
  source_received_at       INTEGER,
  synced_at                TEXT NOT NULL,
  PRIMARY KEY (scope_key, site, settlement_status, stat_date, item_key)
);

CREATE INDEX IF NOT EXISTS idx_temu_settlement_detail_mall_status_date
  ON erp_temu_settlement_detail(mall_id, settlement_status, stat_date);

CREATE INDEX IF NOT EXISTS idx_temu_settlement_detail_status_date
  ON erp_temu_settlement_detail(settlement_status, stat_date);
