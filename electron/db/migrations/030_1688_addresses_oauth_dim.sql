-- 1688 收货地址改按 OAuth 维度归属
--
-- 背景：erp_1688_delivery_addresses 当前用 account_id（ERP 店铺）维度强绑地址，
-- 但 1688 那边收货地址是挂在 buyer 账号（OAuth）下的。当多个 ERP 店铺共享同一
-- 个 1688 OAuth（jst:brand 22560 店铺共用 68 个 OAuth 的现实），跨店铺推单就会
-- 撞 "1688 delivery address does not belong to this store" 本地预校验。
--
-- 解决：加 purchase_1688_account_id 列，新增/同步逻辑按 OAuth 写入。account_id
-- 列保留兼容旧版客户端（旧版只读 account_id 也能跑），新逻辑只看新列。

ALTER TABLE erp_1688_delivery_addresses
  ADD COLUMN purchase_1688_account_id TEXT;

-- 现有数据回填：按 account_id 反查 erp_accounts.default_1688_purchase_account_id
-- 拿到该店铺挂的默认 1688 OAuth，写进新列。回填不了的（店铺没绑 OAuth）保持 NULL。
UPDATE erp_1688_delivery_addresses
SET purchase_1688_account_id = (
  SELECT a.default_1688_purchase_account_id
  FROM erp_accounts a
  WHERE a.id = erp_1688_delivery_addresses.account_id
)
WHERE account_id IS NOT NULL
  AND account_id != ''
  AND purchase_1688_account_id IS NULL;

-- 按 OAuth 维度查询的索引
CREATE INDEX IF NOT EXISTS idx_1688_delivery_addresses_oauth_default
  ON erp_1688_delivery_addresses(company_id, purchase_1688_account_id, status, is_default, updated_at);
