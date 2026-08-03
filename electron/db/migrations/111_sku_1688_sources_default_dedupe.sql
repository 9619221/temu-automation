-- 修复历史脏数据：同一商品（account_id + sku_id）存在多条跨 1688 链接的默认供应商绑定
-- （默认互斥逻辑上线前遗留），推单时会把多个链接一起推出去。
-- 每个商品只保留最新更新的默认分组（同分组 = 同链接多规格，整组保留），其余默认标记清零。
-- 纯 UPDATE，天然可重复执行；窗口函数写法 SQLite / PostgreSQL 通用。
-- @idempotent
UPDATE erp_sku_1688_sources
SET is_default = 0
WHERE is_default = 1
  AND status = 'active'
  AND COALESCE(NULLIF(mapping_group_id, ''), id) NOT IN (
    SELECT keep_group FROM (
      SELECT
        COALESCE(NULLIF(mapping_group_id, ''), id) AS keep_group,
        ROW_NUMBER() OVER (
          PARTITION BY account_id, sku_id
          ORDER BY updated_at DESC, created_at DESC
        ) AS rn
      FROM erp_sku_1688_sources
      WHERE is_default = 1 AND status = 'active'
    ) ranked
    WHERE rn = 1
  );
