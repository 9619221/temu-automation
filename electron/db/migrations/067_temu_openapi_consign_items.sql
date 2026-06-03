-- @idempotent
-- 出库中心官方明细:erp_temu_openapi_consign 加 items_json,存逐SKU明细(货号/规格/备货数/发货数/缩略图/成本),
-- 供 cloud-only 单(聚水潭无对账)展开显示官方明细。解析见 temuOpenApiConsign.cjs,接口见 consignDeliver.cloudItems。
ALTER TABLE erp_temu_openapi_consign ADD COLUMN items_json TEXT;
