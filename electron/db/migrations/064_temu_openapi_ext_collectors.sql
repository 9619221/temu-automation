-- @idempotent
-- TEMU 官方开放平台「扩展采集」状态列：广告/流量报表、爆款邀约、生命周期状态。
-- 数据本体复用 erp_temu_openapi_records（snapshot 语义），新增 source 取值：
--   ad_report_mall       店铺维度广告/流量效果（曝光/点击/转化/花费/ROAS/申报价销售额），product_id 为 null，raw_json 存整体 summary+reportsItemList
--   ad_report_goods      商品维度广告/流量效果，按 productId 一行，raw_json 存该商品窗口指标
--   best_seller_invitation 平台爆款邀约（record_key=invitationId）
--   product_lifecycle    货品生命周期/选品状态（record_key=productId, status=selectStatus）
-- 写入：electron/erp/services/temuOpenApiCollectors.cjs（syncExtendedCollectorsForMall）
-- 仅加授权表的扩展采集状态列；records 表结构 063 已就绪，无需改表。

ALTER TABLE erp_temu_openapi_auth ADD COLUMN last_ext_sync_at TEXT;
ALTER TABLE erp_temu_openapi_auth ADD COLUMN ext_sync_summary_json TEXT;   -- {"ad_report_mall":N,"ad_report_goods":N,"best_seller_invitation":N,"product_lifecycle":N}
ALTER TABLE erp_temu_openapi_auth ADD COLUMN last_ext_sync_status TEXT;
ALTER TABLE erp_temu_openapi_auth ADD COLUMN last_ext_sync_error TEXT;

-- 广告商品维度需按 (mall_id, source, product_id) join 商品，补一个覆盖索引
CREATE INDEX IF NOT EXISTS idx_erp_temu_oa_records_source_product ON erp_temu_openapi_records(mall_id, source, product_id);
