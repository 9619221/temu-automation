-- @idempotent
-- 商品条码号(labelCode)：Temu 平台分配的条形码编号，来自 bg.glo.goods.labelv2.get。
-- 一个备货单可能含多个 SKU，label_codes 按 sku_ext_codes 同序逗号拼接。
ALTER TABLE erp_temu_openapi_consign ADD COLUMN label_codes TEXT;
