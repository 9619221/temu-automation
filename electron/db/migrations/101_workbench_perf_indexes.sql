-- @idempotent
-- 采购工作台热路径：消除 N+1 子查询和 EXISTS 全表扫描
CREATE INDEX IF NOT EXISTS idx_sku_1688_sources_acct_sku_status
  ON erp_sku_1688_sources(account_id, sku_id, status);

CREATE INDEX IF NOT EXISTS idx_po_lines_po_sku
  ON erp_purchase_order_lines(po_id, sku_id);

CREATE INDEX IF NOT EXISTS idx_1688_refunds_po_updated
  ON erp_1688_refunds(po_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_approvals_po_updated
  ON erp_payment_approvals(po_id, updated_at DESC);

-- 库存查询
CREATE INDEX IF NOT EXISTS idx_batches_sku_account
  ON erp_inventory_batches(sku_id, account_id);

-- 采购候选
CREATE INDEX IF NOT EXISTS idx_sourcing_pr_status
  ON erp_sourcing_candidates(pr_id, status);
