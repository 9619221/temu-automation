-- 其他出入库历史数据（来自聚水潭 jushuitan-otherout-* 导出）。
-- 968 单头 + 1,076 行明细。聚水潭"其他出库"业务：损耗、调拨、盘点差、人工调整等。
-- 跟 purchase_returns（退给供应商）/ consign_after_sales（Temu 退回）都不同。

CREATE TABLE IF NOT EXISTS jst_other_inout (
  id TEXT PRIMARY KEY,                       -- jst:other-io:<io_id>
  company_id TEXT NOT NULL DEFAULT 'company_default',
  io_id INTEGER NOT NULL,                    -- 聚水潭出入库单号
  io_date TEXT,                              -- 业务时间
  type TEXT,                                 -- 其他出库 / 其他入库 / 调拨等
  status TEXT,                               -- 单据状态：生效/作废
  f_status TEXT,                             -- 财务状态
  wh_id INTEGER,                             -- 仓库 id
  lwh_id INTEGER,                            -- 货位 id
  lwh_name TEXT,                             -- 货位名
  warehouse TEXT,                            -- 仓库名（苏州崭得恒...）
  wms_co_id INTEGER,
  wms_co_name TEXT,
  total_qty INTEGER,                         -- 总数量
  total_amount REAL,                         -- 总金额
  total_cost REAL,                           -- 总成本
  reason TEXT,                               -- 出入库原因
  drp_co_id INTEGER,
  node TEXT,                                 -- 节点
  labels TEXT,                               -- 标签
  remark TEXT,
  creator_name TEXT,                         -- 制单人
  archiver_name TEXT,                        -- 归档人
  archived_at TEXT,
  modifier_name TEXT,
  created_text TEXT,                         -- 聚水潭 created
  modified_text TEXT,                        -- 聚水潭 modified
  raw_json TEXT,
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status_internal TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY(company_id) REFERENCES erp_companies(id),
  UNIQUE(company_id, io_id)
);

CREATE INDEX IF NOT EXISTS idx_jst_other_io_company_date
  ON jst_other_inout(company_id, io_date);
CREATE INDEX IF NOT EXISTS idx_jst_other_io_company_updated
  ON jst_other_inout(company_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_jst_other_io_company_type
  ON jst_other_inout(company_id, type);
CREATE INDEX IF NOT EXISTS idx_jst_other_io_status_internal
  ON jst_other_inout(company_id, status_internal, updated_at);

CREATE TABLE IF NOT EXISTS jst_other_inout_items (
  id TEXT PRIMARY KEY,                       -- jst:other-io-item:<io_id>:<seq>
  company_id TEXT NOT NULL DEFAULT 'company_default',
  io_id INTEGER NOT NULL,                    -- 关联单头
  seq INTEGER NOT NULL,                      -- 行号（聚水潭明细本身无 PK）
  sku_id TEXT,                               -- 聚水潭 sku_id
  i_id TEXT,                                 -- 货号
  name TEXT,                                 -- 商品名
  properties_value TEXT,                     -- 规格
  pic_url TEXT,
  qty INTEGER,                               -- 数量（出库为负 / 入库为正）
  unit TEXT,                                 -- 单位
  shelf_life INTEGER,                        -- 保质期
  cost_price REAL,                           -- 成本单价
  cost_amount REAL,                          -- 行金额
  supplier_id TEXT,
  supplier_i_id TEXT,
  supplier_sku_id TEXT,
  labels TEXT,
  remark TEXT,
  raw_json TEXT,
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status_internal TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY(company_id) REFERENCES erp_companies(id),
  UNIQUE(company_id, io_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_jst_other_io_items_company_io
  ON jst_other_inout_items(company_id, io_id);
CREATE INDEX IF NOT EXISTS idx_jst_other_io_items_company_updated
  ON jst_other_inout_items(company_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_jst_other_io_items_sku
  ON jst_other_inout_items(company_id, sku_id);
