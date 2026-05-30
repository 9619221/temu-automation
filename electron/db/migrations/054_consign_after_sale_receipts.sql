-- 送仓售后「确认收货」本地台账。
-- consign_after_sales(聚水潭)/平台退供单的 status 都是只读镜像，确认收货不能写回，
-- 用本表记录我方确认收货 + 增加库存的结果。统一用 outer_as_id（TGXJ.../TGSQ...）作 key，
-- 聚水潭单和平台独占单通用（平台单没有 as_id）。

CREATE TABLE IF NOT EXISTS consign_after_sale_receipts (
  id TEXT PRIMARY KEY,                       -- as-receipt:<uuid>
  company_id TEXT NOT NULL DEFAULT 'company_default',
  outer_as_id TEXT NOT NULL,                 -- 统一 key：外部售后单号
  as_id INTEGER,                             -- 聚水潭售后单号（平台独占单为 null）
  source TEXT NOT NULL,                      -- jushuitan / platform / both
  receipt_status TEXT NOT NULL DEFAULT 'confirmed',
  confirmed_by TEXT,
  confirmed_at TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status_internal TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY(company_id) REFERENCES erp_companies(id),
  UNIQUE(company_id, outer_as_id)
);

CREATE TABLE IF NOT EXISTS consign_after_sale_receipt_items (
  id TEXT PRIMARY KEY,                       -- as-receipt-item:<uuid>
  company_id TEXT NOT NULL DEFAULT 'company_default',
  outer_as_id TEXT NOT NULL,                 -- 关联 consign_after_sale_receipts.outer_as_id
  erp_sku_id TEXT,                           -- 映射到的 erp_skus.id
  internal_sku_code TEXT,                    -- 内部商品编码
  temu_sku_id TEXT,
  temu_skc_id TEXT,
  product_name TEXT,
  received_qty INTEGER NOT NULL,             -- 实收数量（加进库存的数量）
  ledger_batch_id TEXT,                      -- applyDirectInbound 生成的批次 id，便于回溯
  created_at TEXT NOT NULL,
  FOREIGN KEY(company_id) REFERENCES erp_companies(id)
);

CREATE INDEX IF NOT EXISTS idx_cas_receipt_company_outer
  ON consign_after_sale_receipts(company_id, outer_as_id);
CREATE INDEX IF NOT EXISTS idx_cas_receipt_item_company_outer
  ON consign_after_sale_receipt_items(company_id, outer_as_id);
