-- @idempotent
-- 性能优化：补充缺失的数据库索引，解决工作台/库存/采购/出库多处慢查询

-- 入库明细：batch_id、po_line_id 用于库存详情 JOIN（此前全表扫）
CREATE INDEX IF NOT EXISTS idx_erp_inbound_lines_batch ON erp_inbound_receipt_lines(batch_id);
CREATE INDEX IF NOT EXISTS idx_erp_inbound_lines_po_line ON erp_inbound_receipt_lines(po_line_id);

-- 库存批次：po_id、inbound_receipt_id 用于 JOIN 采购单和入库单
CREATE INDEX IF NOT EXISTS idx_erp_batches_po ON erp_inventory_batches(po_id);
CREATE INDEX IF NOT EXISTS idx_erp_batches_receipt ON erp_inventory_batches(inbound_receipt_id);

-- 采购单：po_no 搜索
CREATE INDEX IF NOT EXISTS idx_erp_po_po_no ON erp_purchase_orders(po_no);

-- 送仓发货：官方 API 表复合索引（mall_id + so_id 联合 JOIN 条件）
CREATE INDEX IF NOT EXISTS idx_oa_consign_mall_so ON erp_temu_openapi_consign(mall_id, so_id);

-- OAuth 状态：state 字段精确查询
CREATE INDEX IF NOT EXISTS idx_erp_1688_oauth_state ON erp_1688_oauth_states(state);

-- 库存批次：按收货时间排序（消除 filesort）
CREATE INDEX IF NOT EXISTS idx_erp_batches_account_received ON erp_inventory_batches(account_id, received_at DESC);
