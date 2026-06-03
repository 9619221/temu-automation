-- @idempotent
-- 运营工作台「官方 API 化」物化表：把 bg.goods.salesv2.get 采集结果(erp_temu_openapi_records,
-- source='sales')的 raw_json 展开成 SKU 级规整行，供报表层(buildSkuSales/buildShopHealth)直接读，
-- 替代抓包 cloud.temu_sales_snapshot。解析+回填见 electron/erp/services/temuOpenApiSkuSales.cjs，
-- 定时刷新见 scripts/refresh-openapi-sku-sales.cjs（snapshot 语义，整表重建）。
--
-- 字段来源（官方 salesv2 raw）：product 顶层 productName/productSkcPicture/category/productId/productSkcId；
-- skuQuantityDetailList[] 每项=一个 SKU（顶层即跨仓汇总）：todaySaleVolume / lastSevenDaysSaleVolume /
-- lastThirtyDaysSaleVolume / stockDays / adviceQuantity / lackQuantity / className /
-- inventoryNumInfo{warehouseInventoryNum,expectedOccupiedInventoryNum,unavailableWarehouseInventoryNum,waitInStock,waitReceiveNum}

CREATE TABLE IF NOT EXISTS erp_temu_openapi_sku_sales (
  mall_id            TEXT NOT NULL,
  product_id         TEXT,
  product_skc_id     TEXT,
  product_sku_id     TEXT NOT NULL,
  ext_code           TEXT,              -- skuExtCode（货号，可能为空字符串→存 NULL）
  title              TEXT,              -- productName
  thumb_url          TEXT,              -- productSkcPicture
  category           TEXT,
  spec_name          TEXT,              -- className（如「咖啡色-35」）
  today_sales        INTEGER,           -- todaySaleVolume
  last7d_sales       INTEGER,           -- lastSevenDaysSaleVolume
  last30d_sales      INTEGER,           -- lastThirtyDaysSaleVolume
  total_sales        INTEGER,           -- totalSaleVolume
  sale_days          REAL,              -- availableSaleDays(真可售天数,仅活跃SKU~2.6%有值);缺失按 可用库存÷近7天日均 自算
  advice_qty         INTEGER,           -- adviceQuantity（建议补货）
  lack_quantity      INTEGER,           -- lackQuantity（缺货件数，Temu 原生）
  warehouse_stock    INTEGER,           -- inventoryNumInfo.warehouseInventoryNum（可用库存）
  occupy_stock       INTEGER,           -- expectedOccupiedInventoryNum（预期占用）
  unavailable_stock  INTEGER,           -- unavailableWarehouseInventoryNum（不可用库存）
  wait_in_stock      INTEGER,           -- waitInStock + waitReceiveNum（待入库/待收）
  supply_status      TEXT,              -- product.supplyStatus
  synced_at          TEXT NOT NULL,
  PRIMARY KEY (mall_id, product_sku_id)
);
CREATE INDEX IF NOT EXISTS idx_oa_sku_sales_skc ON erp_temu_openapi_sku_sales(product_skc_id);
CREATE INDEX IF NOT EXISTS idx_oa_sku_sales_ext ON erp_temu_openapi_sku_sales(ext_code);
CREATE INDEX IF NOT EXISTS idx_oa_sku_sales_mall_product ON erp_temu_openapi_sku_sales(mall_id, product_id);
