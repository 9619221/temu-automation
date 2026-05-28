-- 聚水潭出入库台账（jushuitan-inoutstock-detail）完整流水。
-- 18.3 万行，含 14 个月 2025-04 ~ 2026-05-25。
-- 用途：让 ERP 库存 ledger 可追溯到聚水潭原始流水的全部字段。

CREATE TABLE IF NOT EXISTS jst_inout_detail (
  id TEXT PRIMARY KEY,                       -- jst:inout:<io_no>:<seq>
  company_id TEXT NOT NULL DEFAULT 'company_default',
  io_no TEXT NOT NULL,                       -- 进出仓单号 (聚水潭流水号)
  seq INTEGER NOT NULL,                      -- io_no 内行序号
  related_no TEXT,                           -- 关联单号
  io_date TEXT,                              -- 进出仓日期
  io_type TEXT,                              -- 进出仓类型（采购进仓/销售出仓/...）
  direction TEXT,                            -- 出 / 入
  creator_name TEXT,                         -- 创建人
  sku_code TEXT,                             -- 商品编码
  style_code TEXT,                           -- 款式编码
  product_tags TEXT,                         -- 商品标签
  color_spec TEXT,                           -- 颜色规格
  category TEXT,
  virtual_category TEXT,
  supplier_name TEXT,                        -- 供应商
  bill_supplier TEXT,                        -- 单据供应商
  supplier_style_no TEXT,                    -- 供应商款号
  supplier_sku TEXT,                         -- 供应商商品编码
  brand TEXT,                                -- 品牌
  weight REAL,
  volume REAL,
  length REAL,
  width REAL,
  height REAL,
  cost_price REAL,                           -- 成本价
  cost_price_source TEXT,                    -- 成本价来源（台账成本/原单成本/...）
  warehouse_party TEXT,                      -- 仓储方
  warehouse TEXT,                            -- 仓库名
  qty INTEGER,                               -- 数量（带符号）
  unit TEXT,
  related_warehouse TEXT,                    -- 关联仓库
  remark TEXT,
  line_remark TEXT,                          -- 明细行备注
  bin TEXT,                                  -- 仓位
  original_online_order_no TEXT,             -- 原始线上订单号
  shop_name TEXT,                            -- 店铺名称
  aftersale_no TEXT,                         -- 售后单号
  online_order_no TEXT,                      -- 线上订单号
  outbound_type TEXT,                        -- 出仓类型
  bill_tags TEXT,                            -- 单据标签
  tracking_no TEXT,                          -- 快递单号
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status_internal TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY(company_id) REFERENCES erp_companies(id),
  UNIQUE(company_id, io_no, seq)
);

CREATE INDEX IF NOT EXISTS idx_jst_inout_detail_company_io_no
  ON jst_inout_detail(company_id, io_no);
CREATE INDEX IF NOT EXISTS idx_jst_inout_detail_company_date
  ON jst_inout_detail(company_id, io_date);
CREATE INDEX IF NOT EXISTS idx_jst_inout_detail_company_sku
  ON jst_inout_detail(company_id, sku_code);
CREATE INDEX IF NOT EXISTS idx_jst_inout_detail_company_type
  ON jst_inout_detail(company_id, io_type);
CREATE INDEX IF NOT EXISTS idx_jst_inout_detail_company_shop
  ON jst_inout_detail(company_id, shop_name);
CREATE INDEX IF NOT EXISTS idx_jst_inout_detail_company_updated
  ON jst_inout_detail(company_id, updated_at);
