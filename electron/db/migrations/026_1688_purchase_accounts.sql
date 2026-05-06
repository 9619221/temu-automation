-- 多 1688 采购账号支持
--
-- 现状：erp_1688_auth_settings 单表行，按 company_id 取首行作为该公司唯一的 1688 凭据
-- 目标：每个 company 可以有多个 1688 凭据，每条带 label（用户起的别名）+ status；
--       Temu 店铺可以指定一个默认 1688 采购账号，推单时优先用它。

-- 1) 给 erp_1688_auth_settings 加 label / status 字段
ALTER TABLE erp_1688_auth_settings
  ADD COLUMN label TEXT NOT NULL DEFAULT '';

ALTER TABLE erp_1688_auth_settings
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- 已有数据兜底：把已存在的行 status 设成 active
UPDATE erp_1688_auth_settings
SET status = 'active'
WHERE status IS NULL OR status = '';

-- 2) Temu 店铺 / 业务账号表加默认 1688 采购账号外键
ALTER TABLE erp_accounts
  ADD COLUMN default_1688_purchase_account_id TEXT DEFAULT NULL;

-- 3) 索引：按 company + status 列出 1688 采购账号
CREATE INDEX IF NOT EXISTS idx_1688_auth_company_status
  ON erp_1688_auth_settings(company_id, status, updated_at);

-- 4) 索引：通过默认账号反查影响的 Temu 店铺（用于删除账号时拦截）
CREATE INDEX IF NOT EXISTS idx_erp_accounts_default_1688
  ON erp_accounts(default_1688_purchase_account_id);
