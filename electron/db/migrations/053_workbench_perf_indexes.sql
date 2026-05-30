-- @idempotent
-- workbench 慢查询治理：补 3 个缺失索引，消除 getWarehouseWorkbench 对大表的全表扫描。
--   erp_inventory_ledger_entries: 原仅 (sku_id, batch_id)，缺 account_id 维度 → 批量查账全表扫
--   erp_inbound_receipt_lines / erp_purchase_order_lines: 缺 sku_id → JOIN sku 时慢
-- 服务器 erp.sqlite 已于 2026-05-29 手动建同名索引；此处入 git 让其他环境部署可复现（IF NOT EXISTS 幂等）。
CREATE INDEX IF NOT EXISTS idx_erp_ledger_account_sku ON erp_inventory_ledger_entries(account_id, sku_id);
CREATE INDEX IF NOT EXISTS idx_erp_inbound_lines_sku ON erp_inbound_receipt_lines(sku_id);
CREATE INDEX IF NOT EXISTS idx_erp_po_lines_sku ON erp_purchase_order_lines(sku_id);
