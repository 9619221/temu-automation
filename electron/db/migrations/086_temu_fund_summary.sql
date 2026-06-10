-- @idempotent
-- Temu fund summary captured from seller.kuajingmaihuo.com:
-- /api/merchant/fund/detail/daySummary
-- /api/merchant/fund/detail/monthSummary
CREATE TABLE IF NOT EXISTS erp_temu_fund_summary (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  mall_id               TEXT    NOT NULL,
  site                  TEXT    NOT NULL DEFAULT 'kuajingmaihuo',
  summary_scope         TEXT    NOT NULL, -- day | month
  summary_date          TEXT    NOT NULL, -- yyyy-mm-dd for day, yyyy-mm for month
  currency              TEXT    DEFAULT 'CNY',
  income_amount         REAL    DEFAULT 0,
  expense_amount        REAL    DEFAULT 0,
  balance_amount        REAL    DEFAULT 0,
  frozen_amount         REAL    DEFAULT 0,
  available_amount      REAL    DEFAULT 0,
  total_amount          REAL    DEFAULT 0,
  metrics_json          TEXT    NOT NULL DEFAULT '{}',
  raw_json              TEXT    NOT NULL DEFAULT '{}',
  source_received_at    INTEGER,
  captured_at           TEXT    DEFAULT (datetime('now')),
  updated_at            TEXT    DEFAULT (datetime('now')),
  UNIQUE(mall_id, site, summary_scope, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_temu_fund_summary_mall_scope_date
  ON erp_temu_fund_summary(mall_id, summary_scope, summary_date);
