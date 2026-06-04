-- @idempotent
-- 商品面板「加入站点天数」:salesv2 的 onSalesDurationOffline(商品级,单位天,约38%商品有值),
-- 补到 SKU 销售物化表。解析见 temuOpenApiSkuSales.cjs,刷新见 scripts/refresh-openapi-sku-sales.cjs。
ALTER TABLE erp_temu_openapi_sku_sales ADD COLUMN onsales_duration_offline INTEGER;
