-- @idempotent
-- 本店发货地址缓存：给店铺字典 erp_temu_malls 加 send_address_json，
-- 存 bg.mall.address.get 返回的「本店发货地址列表」JSON（每店一份，极少变）。
-- 由 scripts/refresh-openapi-mall-addresses.cjs 定时（每天）刷新；
-- 出库中心「发货地址」列直接读它，免每次点详情实时跨海调 Temu。
ALTER TABLE erp_temu_malls ADD COLUMN send_address_json TEXT;
