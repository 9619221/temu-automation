-- 送仓托管出库历史数据（来自聚水潭 jushuitan-temu-consign-deliver-* 导出）。
-- 45,918 单头 + 55,622 行明细。Temu 半托管业务：我们 → Temu 送仓仓库。
-- 跟 consign_after_sales（Temu 退回我们）方向相反。

CREATE TABLE IF NOT EXISTS jst_consign_deliveries (
  id TEXT PRIMARY KEY,                       -- jst:consign-deliver:<o_id>
  company_id TEXT NOT NULL DEFAULT 'company_default',
  o_id INTEGER NOT NULL,                     -- 聚水潭订单 id
  so_id TEXT,                                -- 网店订单 id (WB2605...)
  pre_so_id TEXT,                            -- 备货单号
  drp_so_id TEXT,                            -- DRP 订单号
  o_id_en TEXT,                              -- 加密订单号
  outer_pay_id TEXT,                         -- 外部支付单号
  outer_deliver_no TEXT,                     -- 外部送仓单号
  order_date TEXT,                           -- 下单时间
  pay_date TEXT,                             -- 付款时间
  plan_delivery_date TEXT,                   -- 计划发货时间
  send_date TEXT,                            -- 实际发货时间
  sign_time TEXT,                            -- 签收时间
  shop_id INTEGER,
  shop_name TEXT,                            -- temu-074店铺
  shop_site TEXT,                            -- Temu
  type TEXT,                                 -- 送仓订单
  status TEXT,                               -- 异常/正常等
  src_status TEXT,                           -- Question 等
  shop_status TEXT,                          -- 平台状态
  shop_status_text TEXT,                     -- 待接单等
  shop_delivery_status TEXT,                 -- Jst_WaitCreate
  shop_delivery_status_text TEXT,            -- 待创建等
  delivery_status TEXT,                      -- WaitCreate
  question_type TEXT,                        -- 线上锁定等
  question_desc TEXT,                        -- 等待确认等
  is_refund INTEGER,                         -- 0/1
  is_paid INTEGER,                           -- 0/1
  is_cod INTEGER,
  is_split INTEGER,
  is_merge INTEGER,
  wms_co_id INTEGER,
  wms_co_name TEXT,                          -- 发货仓库
  bin_name TEXT,                             -- 货位
  logistics_company TEXT,                    -- 现场取货等
  l_id TEXT,                                 -- 物流单号
  receiver_name TEXT,
  receiver_country TEXT,
  receiver_state TEXT,
  receiver_city TEXT,
  receiver_district TEXT,
  receiver_town TEXT,
  receiver_address TEXT,
  receiver_zip TEXT,
  supplier_name TEXT,
  buyer_id INTEGER,
  item_amount REAL,                          -- 商品总额
  items_qty INTEGER,                         -- 商品总数
  shipped_qty INTEGER,
  instocked_qty INTEGER,
  return_qty INTEGER,
  weight REAL,
  freight REAL,                              -- 运费
  free_amount REAL,
  currency TEXT,
  sku_info TEXT,                             -- SKU 信息
  skus TEXT,                                 -- SKU summary (5.2604180045*5)
  labels TEXT,                               -- 今日可发货,普通,...
  remark TEXT,
  created_text TEXT,                         -- 聚水潭 created
  modified_text TEXT,                        -- 聚水潭 modified
  raw_json TEXT,                             -- 原始单头 JSON（去掉 items）
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status_internal TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY(company_id) REFERENCES erp_companies(id),
  UNIQUE(company_id, o_id)
);

CREATE INDEX IF NOT EXISTS idx_jst_consign_deliv_company_date
  ON jst_consign_deliveries(company_id, order_date);
CREATE INDEX IF NOT EXISTS idx_jst_consign_deliv_company_updated
  ON jst_consign_deliveries(company_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_jst_consign_deliv_company_shop
  ON jst_consign_deliveries(company_id, shop_name);
CREATE INDEX IF NOT EXISTS idx_jst_consign_deliv_company_status
  ON jst_consign_deliveries(company_id, status);
CREATE INDEX IF NOT EXISTS idx_jst_consign_deliv_so_id
  ON jst_consign_deliveries(company_id, so_id);

CREATE TABLE IF NOT EXISTS jst_consign_deliver_items (
  id TEXT PRIMARY KEY,                       -- jst:consign-deliver-item:<oi_id>
  company_id TEXT NOT NULL DEFAULT 'company_default',
  oi_id INTEGER NOT NULL,                    -- 明细 id
  o_id INTEGER NOT NULL,                     -- 关联单头
  so_id TEXT,                                -- 网店订单 id
  shop_name TEXT,                            -- temu-074店铺
  shop_status TEXT,                          -- _status
  order_date TEXT,                           -- _order_date
  sku_id TEXT,                               -- 聚水潭 sku_id
  i_id TEXT,                                 -- 货号
  sku_code TEXT,
  name TEXT,                                 -- 商品名
  properties_value TEXT,
  pic_url TEXT,
  qty INTEGER,                               -- 数量
  base_price REAL,                           -- 基础价
  price REAL,                                -- 实际价
  amount REAL,                               -- 行金额
  cost_price REAL,                           -- 成本价（如有）
  cost_amount REAL,
  raw_json TEXT,
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status_internal TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY(company_id) REFERENCES erp_companies(id),
  UNIQUE(company_id, oi_id)
);

CREATE INDEX IF NOT EXISTS idx_jst_consign_deliv_items_company_oid
  ON jst_consign_deliver_items(company_id, o_id);
CREATE INDEX IF NOT EXISTS idx_jst_consign_deliv_items_company_updated
  ON jst_consign_deliver_items(company_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_jst_consign_deliv_items_sku
  ON jst_consign_deliver_items(company_id, sku_id);
CREATE INDEX IF NOT EXISTS idx_jst_consign_deliv_items_shop
  ON jst_consign_deliver_items(company_id, shop_name);
