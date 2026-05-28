-- 采购退货历史数据（来自聚水潭 jushuitan-purchaseout-* 导出）。
-- 1062 单头 + 1264 行明细，company_id 默认 company_default。
-- 与 purchase orders 不同：这批是已发生的退货流水，没有审核 / 状态机，只是台账。

CREATE TABLE IF NOT EXISTS purchase_returns (
  id TEXT PRIMARY KEY,                       -- jst:po-out:<io_id>
  company_id TEXT NOT NULL DEFAULT 'company_default',
  io_id INTEGER NOT NULL,                    -- 聚水潭单号
  io_date TEXT,                              -- 退货时间（业务时间）
  status TEXT,                               -- 单据状态：生效/作废
  f_status TEXT,                             -- 财务状态：生效/作废
  total_qty INTEGER,                         -- 退货总数量
  total_sku_count INTEGER,                   -- 涉及 SKU 数
  total_amount REAL,                         -- 退货总金额（成本口径）
  wms_co_name TEXT,                          -- WMS 公司（本仓等）
  warehouse TEXT,                            -- 仓库名
  supplier_name TEXT,                        -- 供应商（聚水潭原始 receiver_name）
  creator_name TEXT,                         -- 制单人
  archiver_name TEXT,                        -- 归档人
  archived_at TEXT,                          -- 归档时间
  labels TEXT,                               -- 标签：普通退货等
  remark TEXT,
  created_text TEXT,                         -- 聚水潭 created（系统时间）
  modified_text TEXT,                        -- 聚水潭 modified
  raw_json TEXT,                             -- 原始单头 JSON
  imported_at TEXT NOT NULL,                 -- 我方导入时间
  updated_at TEXT NOT NULL,                  -- 用于 since 增量
  status_internal TEXT NOT NULL DEFAULT 'active',  -- active/deleted（软删占位）
  FOREIGN KEY(company_id) REFERENCES erp_companies(id),
  UNIQUE(company_id, io_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_returns_company_updated
  ON purchase_returns(company_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_company_io_date
  ON purchase_returns(company_id, io_date);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_company_supplier
  ON purchase_returns(company_id, supplier_name);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_status_internal
  ON purchase_returns(company_id, status_internal, updated_at);

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id TEXT PRIMARY KEY,                       -- jst:po-out-item:<ioi_id>
  company_id TEXT NOT NULL DEFAULT 'company_default',
  io_id INTEGER NOT NULL,                    -- 关联单头
  ioi_id INTEGER NOT NULL,                   -- 明细行 id
  sku_id TEXT,                               -- 聚水潭 sku_id
  product_name TEXT,
  properties_value TEXT,                     -- 规格
  pic_url TEXT,
  qty INTEGER,                               -- 退货数量
  cost_price REAL,                           -- 退货单价
  cost_amount REAL,                          -- 行金额
  i_id TEXT,                                 -- 货号
  supplier_i_id TEXT,
  supplier_sku_id TEXT,
  labels TEXT,
  remark TEXT,
  raw_json TEXT,
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status_internal TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY(company_id) REFERENCES erp_companies(id),
  UNIQUE(company_id, ioi_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_return_items_company_io
  ON purchase_return_items(company_id, io_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_company_updated
  ON purchase_return_items(company_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_sku
  ON purchase_return_items(company_id, sku_id);
