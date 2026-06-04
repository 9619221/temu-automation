-- @idempotent
-- migration 070: 出库中心官方API补接——ship_order(发货单)物流/司机/包裹/仓库/打印/批次/重量/时间
-- + purchase_order(备货单)类目/今日可发/首单/最晚到仓/加急。官方返回里本有、parser 之前没接。
-- 文件级 @idempotent: 多 ALTER 逐句幂等执行,防服务器历史手加过列撞 duplicate column。
ALTER TABLE erp_temu_openapi_consign ADD COLUMN express_company TEXT;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN express_delivery_sn TEXT;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN driver_name TEXT;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN plate_number TEXT;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN deliver_package_num INTEGER;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN receive_package_num INTEGER;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN sub_warehouse_name TEXT;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN receive_address_json TEXT;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN is_print_box_mark INTEGER;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN delivery_method INTEGER;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN express_batch_sn TEXT;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN predict_package_weight INTEGER;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN ship_create_time TEXT;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN inbound_time TEXT;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN category TEXT;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN today_can_deliver INTEGER;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN is_first INTEGER;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN expect_arrival_at TEXT;
ALTER TABLE erp_temu_openapi_consign ADD COLUMN urgency_type INTEGER;
