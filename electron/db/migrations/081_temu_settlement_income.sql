-- @idempotent
-- Temu seller-center settlement/income summary captured from the dashboard web API.
-- The web endpoint returns daily income rows but may not include mall_id, so account_id
-- is kept as a fallback scope and mall_id is nullable until the source is unambiguous.
CREATE TABLE IF NOT EXISTS erp_temu_settlement_income (
  scope_key           TEXT NOT NULL,
  mall_id             TEXT,
  account_id          TEXT,
  stat_date           TEXT NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'CNY',
  income_amount       REAL NOT NULL DEFAULT 0,
  income_amount_cents INTEGER,
  raw_json            TEXT NOT NULL DEFAULT '{}',
  synced_at           TEXT NOT NULL,
  PRIMARY KEY (scope_key, stat_date)
);

CREATE INDEX IF NOT EXISTS idx_temu_settlement_income_mall_date
  ON erp_temu_settlement_income(mall_id, stat_date);

CREATE INDEX IF NOT EXISTS idx_temu_settlement_income_account_date
  ON erp_temu_settlement_income(account_id, stat_date);
