-- @idempotent
-- 合并 5 组聚水潭同步产生的重复编码（保留 5/23 新记录），然后建 (company_id, internal_sku_code) 唯一索引。

-- 1) 迁移所有引用旧 skuprofile 记录的外键到新 sku 记录
-- 旧 → 新 映射：
--   jst:skuprofile:10504750345 → jst:sku:10504750345:12b86f5397
--   jst:skuprofile:10746700883 → jst:sku:10746700883:d431aff041
--   jst:skuprofile:10795153570 → jst:sku:10795153570:896954bb76
--   jst:skuprofile:11003254372 → jst:sku:11003254372:a7a6094c6d
--   jst:skuprofile:2602070008  → jst:sku:2602070008:c1ffef40af

UPDATE erp_purchase_order_lines SET sku_id = CASE sku_id WHEN 'jst:skuprofile:10504750345' THEN 'jst:sku:10504750345:12b86f5397' WHEN 'jst:skuprofile:10746700883' THEN 'jst:sku:10746700883:d431aff041' WHEN 'jst:skuprofile:10795153570' THEN 'jst:sku:10795153570:896954bb76' WHEN 'jst:skuprofile:11003254372' THEN 'jst:sku:11003254372:a7a6094c6d' WHEN 'jst:skuprofile:2602070008' THEN 'jst:sku:2602070008:c1ffef40af' ELSE sku_id END WHERE sku_id LIKE 'jst:skuprofile:%';

UPDATE erp_inbound_receipt_lines SET sku_id = CASE sku_id WHEN 'jst:skuprofile:10504750345' THEN 'jst:sku:10504750345:12b86f5397' WHEN 'jst:skuprofile:10746700883' THEN 'jst:sku:10746700883:d431aff041' WHEN 'jst:skuprofile:10795153570' THEN 'jst:sku:10795153570:896954bb76' WHEN 'jst:skuprofile:11003254372' THEN 'jst:sku:11003254372:a7a6094c6d' WHEN 'jst:skuprofile:2602070008' THEN 'jst:sku:2602070008:c1ffef40af' ELSE sku_id END WHERE sku_id LIKE 'jst:skuprofile:%';

UPDATE erp_inventory_batches SET sku_id = CASE sku_id WHEN 'jst:skuprofile:10504750345' THEN 'jst:sku:10504750345:12b86f5397' WHEN 'jst:skuprofile:10746700883' THEN 'jst:sku:10746700883:d431aff041' WHEN 'jst:skuprofile:10795153570' THEN 'jst:sku:10795153570:896954bb76' WHEN 'jst:skuprofile:11003254372' THEN 'jst:sku:11003254372:a7a6094c6d' WHEN 'jst:skuprofile:2602070008' THEN 'jst:sku:2602070008:c1ffef40af' ELSE sku_id END WHERE sku_id LIKE 'jst:skuprofile:%';

UPDATE erp_inventory_ledger_entries SET sku_id = CASE sku_id WHEN 'jst:skuprofile:10504750345' THEN 'jst:sku:10504750345:12b86f5397' WHEN 'jst:skuprofile:10746700883' THEN 'jst:sku:10746700883:d431aff041' WHEN 'jst:skuprofile:10795153570' THEN 'jst:sku:10795153570:896954bb76' WHEN 'jst:skuprofile:11003254372' THEN 'jst:sku:11003254372:a7a6094c6d' WHEN 'jst:skuprofile:2602070008' THEN 'jst:sku:2602070008:c1ffef40af' ELSE sku_id END WHERE sku_id LIKE 'jst:skuprofile:%';

UPDATE erp_sku_1688_sources SET sku_id = CASE sku_id WHEN 'jst:skuprofile:10504750345' THEN 'jst:sku:10504750345:12b86f5397' WHEN 'jst:skuprofile:10746700883' THEN 'jst:sku:10746700883:d431aff041' WHEN 'jst:skuprofile:10795153570' THEN 'jst:sku:10795153570:896954bb76' WHEN 'jst:skuprofile:11003254372' THEN 'jst:sku:11003254372:a7a6094c6d' WHEN 'jst:skuprofile:2602070008' THEN 'jst:sku:2602070008:c1ffef40af' ELSE sku_id END WHERE sku_id LIKE 'jst:skuprofile:%';

UPDATE erp_sku_bundle_components SET bundle_sku_id = CASE bundle_sku_id WHEN 'jst:skuprofile:10504750345' THEN 'jst:sku:10504750345:12b86f5397' WHEN 'jst:skuprofile:10746700883' THEN 'jst:sku:10746700883:d431aff041' WHEN 'jst:skuprofile:10795153570' THEN 'jst:sku:10795153570:896954bb76' WHEN 'jst:skuprofile:11003254372' THEN 'jst:sku:11003254372:a7a6094c6d' WHEN 'jst:skuprofile:2602070008' THEN 'jst:sku:2602070008:c1ffef40af' ELSE bundle_sku_id END WHERE bundle_sku_id LIKE 'jst:skuprofile:%';

UPDATE erp_sku_bundle_components SET component_sku_id = CASE component_sku_id WHEN 'jst:skuprofile:10504750345' THEN 'jst:sku:10504750345:12b86f5397' WHEN 'jst:skuprofile:10746700883' THEN 'jst:sku:10746700883:d431aff041' WHEN 'jst:skuprofile:10795153570' THEN 'jst:sku:10795153570:896954bb76' WHEN 'jst:skuprofile:11003254372' THEN 'jst:sku:11003254372:a7a6094c6d' WHEN 'jst:skuprofile:2602070008' THEN 'jst:sku:2602070008:c1ffef40af' ELSE component_sku_id END WHERE component_sku_id LIKE 'jst:skuprofile:%';

UPDATE erp_temu_stock_orders SET mapped_erp_sku_id = CASE mapped_erp_sku_id WHEN 'jst:skuprofile:10504750345' THEN 'jst:sku:10504750345:12b86f5397' WHEN 'jst:skuprofile:10746700883' THEN 'jst:sku:10746700883:d431aff041' WHEN 'jst:skuprofile:10795153570' THEN 'jst:sku:10795153570:896954bb76' WHEN 'jst:skuprofile:11003254372' THEN 'jst:sku:11003254372:a7a6094c6d' WHEN 'jst:skuprofile:2602070008' THEN 'jst:sku:2602070008:c1ffef40af' ELSE mapped_erp_sku_id END WHERE mapped_erp_sku_id LIKE 'jst:skuprofile:%';

UPDATE erp_inventory_cost_events SET sku_id = CASE sku_id WHEN 'jst:skuprofile:10504750345' THEN 'jst:sku:10504750345:12b86f5397' WHEN 'jst:skuprofile:10746700883' THEN 'jst:sku:10746700883:d431aff041' WHEN 'jst:skuprofile:10795153570' THEN 'jst:sku:10795153570:896954bb76' WHEN 'jst:skuprofile:11003254372' THEN 'jst:sku:11003254372:a7a6094c6d' WHEN 'jst:skuprofile:2602070008' THEN 'jst:sku:2602070008:c1ffef40af' ELSE sku_id END WHERE sku_id LIKE 'jst:skuprofile:%';

UPDATE erp_sku_cost_daily_snapshot SET sku_id = CASE sku_id WHEN 'jst:skuprofile:10504750345' THEN 'jst:sku:10504750345:12b86f5397' WHEN 'jst:skuprofile:10746700883' THEN 'jst:sku:10746700883:d431aff041' WHEN 'jst:skuprofile:10795153570' THEN 'jst:sku:10795153570:896954bb76' WHEN 'jst:skuprofile:11003254372' THEN 'jst:sku:11003254372:a7a6094c6d' WHEN 'jst:skuprofile:2602070008' THEN 'jst:sku:2602070008:c1ffef40af' ELSE sku_id END WHERE sku_id LIKE 'jst:skuprofile:%';

UPDATE erp_sku_site_exceptions SET sku_id = CASE sku_id WHEN 'jst:skuprofile:10504750345' THEN 'jst:sku:10504750345:12b86f5397' WHEN 'jst:skuprofile:10746700883' THEN 'jst:sku:10746700883:d431aff041' WHEN 'jst:skuprofile:10795153570' THEN 'jst:sku:10795153570:896954bb76' WHEN 'jst:skuprofile:11003254372' THEN 'jst:sku:11003254372:a7a6094c6d' WHEN 'jst:skuprofile:2602070008' THEN 'jst:sku:2602070008:c1ffef40af' ELSE sku_id END WHERE sku_id LIKE 'jst:skuprofile:%';

-- 2) 删除旧的 skuprofile 记录
DELETE FROM erp_skus WHERE id IN ('jst:skuprofile:10504750345', 'jst:skuprofile:10746700883', 'jst:skuprofile:10795153570', 'jst:skuprofile:11003254372', 'jst:skuprofile:2602070008');

-- 3) 建唯一索引（同公司下编码不可重复）
CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_skus_company_code_uniq ON erp_skus(company_id, internal_sku_code);
