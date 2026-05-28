-- @idempotent
-- SKU 维度的移动加权平均成本（全公司一个口径，跨位置共享）。
-- 由采购入库 / 采购退货 / 平台销售出货 / 客户退货等"真正改变实物数量"的动作维护。
-- 调拨 / 平台送仓 / 平台退回自家仓 等"位置搬运"动作不影响这两个字段。
ALTER TABLE erp_skus ADD COLUMN weighted_avg_cost REAL NOT NULL DEFAULT 0;
ALTER TABLE erp_skus ADD COLUMN cost_balance_qty INTEGER NOT NULL DEFAULT 0;
