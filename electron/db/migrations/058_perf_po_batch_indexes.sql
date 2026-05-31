-- @idempotent
-- 性能优化：补采购单 / 采购明细 / 库存批次的缺失索引，消除工作台与出库的全表扫描 + 内存排序。
-- 全部 CREATE INDEX IF NOT EXISTS，可重复执行；不改表结构、不动数据。
--
-- 背景（详见性能分析报告）：
--   1) 采购工作台按 created_at 排序 + account_id/status 过滤，缺复合索引 → 全表扫 + filesort
--   2) 采购明细 JOIN/GROUP 走 po_id，仅有 sku_id 单列索引，缺 (po_id, sku_id) 覆盖
--   3) 出库取可用批次按 (account_id, qc_status, available_qty) 过滤，仅有 (account_id, sku_id)

-- 1) 采购单：账号+状态+时间，覆盖「队列筛选 + 默认按时间倒序」的主路径
CREATE INDEX IF NOT EXISTS idx_erp_po_account_status_created
  ON erp_purchase_orders(account_id, status, created_at);

-- 2) 采购单：全局按创建时间排序（不带账号过滤时）
CREATE INDEX IF NOT EXISTS idx_erp_po_created
  ON erp_purchase_orders(created_at);

-- 3) 采购明细：JOIN 主单 + 按 SKU 聚合
CREATE INDEX IF NOT EXISTS idx_erp_po_lines_po_sku
  ON erp_purchase_order_lines(po_id, sku_id);

-- 4) 库存批次：出库可用批次过滤（状态 + 可用量）
CREATE INDEX IF NOT EXISTS idx_erp_batches_account_qc_avail
  ON erp_inventory_batches(account_id, qc_status, available_qty);
