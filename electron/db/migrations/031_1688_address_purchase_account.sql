-- 多 1688 采购账号(v0.2.8+) 漏补的 erp_1688_delivery_addresses 字段。
--
-- 背景：026_1688_purchase_accounts.sql 只动了 erp_1688_auth_settings 与 erp_accounts，
--       忘了给 erp_1688_delivery_addresses 加 purchase_1688_account_id。
--       但 ipc.cjs save1688DeliveryAddressAction / sync1688DeliveryAddressesAction /
--       resolve1688AuthRowForPurchase 一直在 INSERT / UPDATE / WHERE 这一列。
--
-- 后果：跑过 026 但没有这列的库，sync_1688_addresses 会撞 "no such column"，
--       而该调用是前端撞 ADDRESS_INACTIVE / AddressId invalid 之后自救的唯一路径，
--       异常被 .catch(() => {}) 吞掉，用户只看到红色 toast，下一步无路可走。
--
-- 这里补字段 + 一条 (company, account, buyer, status) 复合索引，
-- 让 sync 里 deactivate scope 的 SELECT 走索引而不是全表扫。

ALTER TABLE erp_1688_delivery_addresses
  ADD COLUMN purchase_1688_account_id TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_1688_delivery_addresses_buyer_scope
  ON erp_1688_delivery_addresses(company_id, account_id, purchase_1688_account_id, status);
