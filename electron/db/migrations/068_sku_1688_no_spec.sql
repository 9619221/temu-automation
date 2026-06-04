-- @idempotent
-- 单规格/无 SKU 的 1688 商品支持：标记一条供应商映射为「无规格」。
-- 这类商品在 1688 上没有可选 SKU（图搜/Worker/官方接口都拿不到 specId），
-- 绑定时 external_spec_id 存空串、is_no_spec=1，下单走 offerId-only。
-- ADD COLUMN 必须幂等：服务器主控端可能已被其它途径加过同名列，
-- 逐语句执行时列已存在则跳过 ADD COLUMN，不致整条迁移抛错。
ALTER TABLE erp_sku_1688_sources ADD COLUMN is_no_spec INTEGER NOT NULL DEFAULT 0;
