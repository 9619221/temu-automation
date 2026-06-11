-- @idempotent
-- 供应商级标签（飞书货盘对齐）：可开票 / 不可开票 / 可做品牌 / 不可做品牌
ALTER TABLE erp_suppliers ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
