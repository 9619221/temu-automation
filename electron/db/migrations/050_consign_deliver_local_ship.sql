-- @idempotent
-- 送仓托管出库行支持「本地确认发货 → 扣本地库存 / 撤销 → 回补」。
-- 这些列只在桌面端/主控端本地动作里写，不来自聚水潭同步，因此聚水潭再同步覆盖 status 也不影响。
--
-- local_status_override：本地覆盖状态（确认发货后为「已发货」；撤销后清空，回落到聚水潭 status）。
-- inventory_deducted：是否已扣本地库存（0/1），扣减/撤销的唯一幂等依据，不看 status 列。
-- inventory_ledger_json：扣减时各明细行的 ledger 结果，供审计 / 撤销参考。
-- local_status_by / local_status_at：最近一次本地状态操作的人 / 时间。

ALTER TABLE jst_consign_deliveries ADD COLUMN local_status_override TEXT;
ALTER TABLE jst_consign_deliveries ADD COLUMN inventory_deducted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jst_consign_deliveries ADD COLUMN inventory_ledger_json TEXT;
ALTER TABLE jst_consign_deliveries ADD COLUMN local_status_by TEXT;
ALTER TABLE jst_consign_deliveries ADD COLUMN local_status_at TEXT;

CREATE INDEX IF NOT EXISTS idx_jst_consign_deliv_company_deducted
  ON jst_consign_deliveries(company_id, inventory_deducted);
