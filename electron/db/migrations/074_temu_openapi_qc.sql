-- @idempotent
-- TEMU 官方质检结果物化表(运营工作台/QC 中心「平台仓质检」)。
-- 数据源:bg.goods.qualityinspection.get(列表) + bg.goods.qualityinspectiondetail.get(疵点/次品详情)。
-- 采集策略见 electron/erp/services/temuOpenApiQc.cjs:默认只采【不合格】(量小,几十/店),逐条补详情;
-- 定时刷新 scripts/refresh-openapi-qc.cjs。一行 = 一个质检子单(qcBillId)。
-- ext_code(货号)质检接口不返回,留空,可后续按 product_sku_id join erp_temu_openapi_sku_sales 补。

CREATE TABLE IF NOT EXISTS erp_temu_openapi_qc (
  mall_id               TEXT NOT NULL,
  qc_bill_id            TEXT NOT NULL,         -- 质检子单 id(列表 qcBillId)
  product_sku_id        TEXT,
  product_skc_id        TEXT,
  spu_id                TEXT,
  ext_code              TEXT,                  -- 货号(质检接口不返回,留空待 join 补)
  sku_name              TEXT,
  spec                  TEXT,                  -- 规格
  cat_name              TEXT,                  -- 叶子类目(可能带站点,如「泳池 DE 过滤器」)
  purchase_no           TEXT,                  -- 采购/备货单号(WB...)
  thumb_url             TEXT,
  qc_result             INTEGER,               -- 1-合格 2-不合格
  qc_result_update_time TEXT,                  -- 质检结果更新时间
  finish_time           TEXT,                  -- 质检完成时间(详情最新单)
  expect_qty            INTEGER,               -- 应检数
  defective_qty         INTEGER,               -- 次品数
  qc_group_name         TEXT,                  -- 质检组别名
  receipt_no            TEXT,                  -- 收货单号
  flaw_summary          TEXT,                  -- 疵点摘要文本(如「合规标签缺失(严重)」)
  flaws_json            TEXT,                  -- 疵点完整 JSON(名称/类型/严重程度/图片)
  flaw_image_count      INTEGER,               -- 疵点图数量
  synced_at             TEXT NOT NULL,
  PRIMARY KEY (mall_id, qc_bill_id)
);
CREATE INDEX IF NOT EXISTS idx_oa_qc_mall_result ON erp_temu_openapi_qc(mall_id, qc_result);
CREATE INDEX IF NOT EXISTS idx_oa_qc_purchase ON erp_temu_openapi_qc(purchase_no);
CREATE INDEX IF NOT EXISTS idx_oa_qc_sku ON erp_temu_openapi_qc(product_sku_id);
CREATE INDEX IF NOT EXISTS idx_oa_qc_update ON erp_temu_openapi_qc(qc_result_update_time);
