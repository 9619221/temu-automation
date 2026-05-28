-- 送仓售后历史数据（聚水潭 jushuitan-aftersale-consign-* 导出）。
-- 5483 单头 + 10325 行明细。半托管送仓业务：Temu 买家 → 我们送仓仓库。
-- 跟 purchase_returns（自己退给 1688 供应商）是两套不同业务。

CREATE TABLE IF NOT EXISTS consign_after_sales (
  id TEXT PRIMARY KEY,                       -- jst:as-consign:<as_id>
  company_id TEXT NOT NULL DEFAULT 'company_default',
  as_id INTEGER NOT NULL,                    -- 聚水潭售后单号
  outer_as_id TEXT,                          -- Temu/外部售后单号
  as_date TEXT,                              -- 售后时间
  shop_type TEXT,                            -- 普通退货等
  type TEXT,                                 -- 售后类型
  status TEXT,                               -- 内部状态：待确认/已确认等
  shop_status TEXT,                          -- 平台状态：等待买家退货等
  good_status TEXT,                          -- 货品状态
  shop_name TEXT,                            -- temu-037店铺
  shop_id INTEGER,                           -- 店铺 id
  shop_site TEXT,                            -- Temu
  warehouse TEXT,                            -- 仓库名
  wh_id INTEGER,
  wh_code TEXT,                              -- wh 编码
  receiver_name TEXT,                        -- 送仓收货人（聚水潭 receiver_name_en）
  receiver_mobile TEXT,                      -- 收货电话
  receiver_phone TEXT,                       -- 备用电话
  refund_qty INTEGER,                        -- 退货数量
  r_qty INTEGER,                             -- 实退数量
  box_id_count INTEGER,                      -- 包裹数
  payment REAL,                              -- 付款
  total_amount REAL,                         -- 总金额
  refund_total_amount REAL,                  -- 退款总额
  buyer_apply_refund TEXT,                   -- 买家申请退款
  refund REAL,
  logistics_company TEXT,                    -- 物流公司
  l_id TEXT,                                 -- 物流单号
  o_id TEXT,                                 -- 订单 id
  so_id TEXT,                                -- 网店订单 id
  labels TEXT,                               -- 标签
  remark TEXT,                               -- 退货说明
  modifier_name TEXT,
  creator_name TEXT,
  confirm_date TEXT,                         -- 确认时间
  created_text TEXT,                         -- 聚水潭 created
  modified_text TEXT,                        -- 聚水潭 modified
  raw_json TEXT,
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status_internal TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY(company_id) REFERENCES erp_companies(id),
  UNIQUE(company_id, as_id)
);

CREATE INDEX IF NOT EXISTS idx_consign_as_company_date
  ON consign_after_sales(company_id, as_date);
CREATE INDEX IF NOT EXISTS idx_consign_as_company_updated
  ON consign_after_sales(company_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_consign_as_company_shop
  ON consign_after_sales(company_id, shop_name);
CREATE INDEX IF NOT EXISTS idx_consign_as_company_status
  ON consign_after_sales(company_id, status);
CREATE INDEX IF NOT EXISTS idx_consign_as_outer_id
  ON consign_after_sales(company_id, outer_as_id);

CREATE TABLE IF NOT EXISTS consign_after_sale_items (
  id TEXT PRIMARY KEY,                       -- jst:as-consign-item:<asi_id>
  company_id TEXT NOT NULL DEFAULT 'company_default',
  asi_id INTEGER NOT NULL,
  as_id INTEGER NOT NULL,                    -- 关联单头（来自 __as_id）
  outer_as_id TEXT,                          -- __outer_as_id
  shop_name TEXT,                            -- __shop_name
  sku_id TEXT,                               -- 聚水潭 sku_id
  i_id TEXT,                                 -- 货号
  sku_code TEXT,                             -- 自定义 SKU 码
  product_name TEXT,
  properties_value TEXT,
  pic_url TEXT,
  qty INTEGER,                               -- 退货数量
  r_qty INTEGER,                             -- 实退数量
  defective_qty INTEGER,                     -- 不良数
  price REAL,
  amount REAL,
  refund_amount REAL,
  shop_amount TEXT,                          -- 字符串（聚水潭原始）
  supplier_name TEXT,
  type TEXT,                                 -- 退货/补发等
  des TEXT,                                  -- 原因（JSON 数组）
  outer_oi_id TEXT,                          -- 订单明细外部 id
  o_id TEXT,                                 -- 内部订单 id
  o_id_en TEXT,                              -- 加密订单号
  box_id TEXT,                               -- 包裹号
  item_sign TEXT,                            -- 行签名
  temu_bill_ids TEXT,                        -- Temu 账单 id
  temu_has_flaw INTEGER,                     -- 0/1
  temu_so_id TEXT,                           -- Temu 网店订单号
  item_labels TEXT,                          -- 数组 JSON
  shelf_life INTEGER,
  is_enable_batch INTEGER,
  receive_date TEXT,
  raw_json TEXT,
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status_internal TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY(company_id) REFERENCES erp_companies(id),
  UNIQUE(company_id, asi_id)
);

CREATE INDEX IF NOT EXISTS idx_consign_as_items_company_as
  ON consign_after_sale_items(company_id, as_id);
CREATE INDEX IF NOT EXISTS idx_consign_as_items_company_updated
  ON consign_after_sale_items(company_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_consign_as_items_sku
  ON consign_after_sale_items(company_id, sku_id);
CREATE INDEX IF NOT EXISTS idx_consign_as_items_outer_oi
  ON consign_after_sale_items(company_id, outer_oi_id);
