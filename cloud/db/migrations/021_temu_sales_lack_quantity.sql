-- @idempotent
-- 商品销售快照补「缺货件数」字段(Temu 原生 lackQuantity，SKU 级)。
-- 商品管理页实时拉 Temu API 才有此字段；商品运营面板走 cloud 快照，需在采集端落库。
-- 历史快照无值，等下次采集回填；NULL 视为 0。
ALTER TABLE temu_sales_snapshot ADD COLUMN lack_quantity INTEGER;
