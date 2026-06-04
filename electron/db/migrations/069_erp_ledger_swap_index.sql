-- @idempotent
-- 性能优化：商品编码换货(swap_sku)接入「其他出入库」列表后，列表与计数会按 type 聚合
-- erp_inventory_ledger_entries 里的换货流水。该表 20 万+行且 type 列无索引，
-- WHERE type IN ('sku_swap_out','sku_swap_in') 会全表扫(~1.5s)，列表+计数各扫一次≈3s 且阻塞单进程。
-- 加部分索引只覆盖换货两腿(约百行)，聚合从 ~1500ms 降到 ~1ms。
-- CREATE INDEX IF NOT EXISTS，可重复执行；不改表结构、不动数据。

CREATE INDEX IF NOT EXISTS idx_erp_ledger_swap_doc
  ON erp_inventory_ledger_entries(source_doc_id)
  WHERE type IN ('sku_swap_out', 'sku_swap_in');
