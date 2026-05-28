-- @idempotent
-- 支持手动创建采购退货单（聚水潭历史单为 source=jushuitan_import 默认值）。
-- 手动单：id=po-ret:<uuid>；io_id=-<unix_ts_ms>（负数规避 NOT NULL + UNIQUE 约束，聚水潭不可能给负数）。
-- lifecycle：draft（草稿，未动库存）→ effective（生效，已扣库存）→ cancelled（作废，库存已加回，终态）。
-- 聚水潭历史单全部默认 source=jushuitan_import / lifecycle=effective（语义对齐）。

ALTER TABLE purchase_returns ADD COLUMN source TEXT NOT NULL DEFAULT 'jushuitan_import';
ALTER TABLE purchase_returns ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'effective';
ALTER TABLE purchase_returns ADD COLUMN account_id TEXT;
ALTER TABLE purchase_returns ADD COLUMN created_by_user_id TEXT;
ALTER TABLE purchase_returns ADD COLUMN effective_at TEXT;
ALTER TABLE purchase_returns ADD COLUMN cancelled_at TEXT;
ALTER TABLE purchase_return_items ADD COLUMN inventory_ledger_id TEXT;

CREATE INDEX IF NOT EXISTS idx_purchase_returns_company_lifecycle
  ON purchase_returns(company_id, lifecycle, updated_at);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_company_source
  ON purchase_returns(company_id, source);
