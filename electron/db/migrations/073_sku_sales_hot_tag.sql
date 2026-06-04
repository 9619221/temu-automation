-- 商品面板「热销/爆旺款标记」：salesv2 的 hotTag(热销款) / hasHotSku(存在爆旺款SKU)，均为商品级，
-- 补到 SKU 销售物化表。解析见 temuOpenApiSkuSales.cjs，刷新见 scripts/refresh-openapi-sku-sales.cjs。
-- @idempotent
ALTER TABLE erp_temu_openapi_sku_sales ADD COLUMN hot_tag INTEGER;
-- @idempotent
ALTER TABLE erp_temu_openapi_sku_sales ADD COLUMN has_hot_sku INTEGER;
