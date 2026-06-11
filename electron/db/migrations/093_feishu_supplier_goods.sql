-- 飞书货盘供应商名下货品清单（供应商详情「名下货品」展示用）
-- 字段对应飞书货盘前 12 列（7 表布局一致）。id = feishu:goods:sha1(供应商名+货号+品名)
CREATE TABLE IF NOT EXISTS erp_feishu_supplier_goods (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL DEFAULT 'company_default',
  supplier_id     TEXT NOT NULL,
  supplier_name   TEXT,
  product_name    TEXT,           -- 品名
  product_code    TEXT,           -- 货号(商品编码)
  color_spec      TEXT,           -- 颜色及规格
  purchase_price  TEXT,           -- 采购价(文本,含"贴标")
  alibaba_url     TEXT,           -- 1688链接
  label_size      TEXT,           -- 标签尺寸
  shipping_req    TEXT,           -- 快递要求
  purchase_mode   TEXT,           -- 代发/自发
  shop            TEXT,           -- 店铺
  source_table    TEXT,           -- 来自哪张货盘
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feishu_goods_supplier
  ON erp_feishu_supplier_goods(supplier_id);

CREATE INDEX IF NOT EXISTS idx_feishu_goods_company_supplier
  ON erp_feishu_supplier_goods(company_id, supplier_id);
