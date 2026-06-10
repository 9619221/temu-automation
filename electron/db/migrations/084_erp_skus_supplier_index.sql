-- 供应商档案列表统计子查询（listSuppliers 的 sku_count / mapped_sku_count）按 erp_skus.supplier_id 关联，
-- 档案表导入 4836 行后该查询无索引需 6.6s（阻塞单进程服务），建索引后 16ms。
-- 服务器已于 2026-06-10 手动建过，IF NOT EXISTS 幂等。
CREATE INDEX IF NOT EXISTS idx_erp_skus_supplier ON erp_skus(supplier_id);
