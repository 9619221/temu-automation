-- @idempotent
-- 送仓托管「打开明细」慢查询治理:补一个以 o_id 打头的索引。
-- 打开明细(erp:consign-deliver:items → listJstConsignDeliverItems)按 o_id 单值查询:
--   SELECT * FROM jst_consign_deliver_items
--   WHERE [company_id=?] AND status_internal != 'deleted' AND o_id=?
--   ORDER BY o_id DESC, oi_id ASC
-- 原有索引全部以 company_id 打头(idx_..._company_oid 等)。当 currentUser.companyId 为空时,
-- 查询不带 company_id 谓词,复合索引缺打头列用不上 → 全表扫 5.5 万行明细 → 打开明细很慢。
-- 补 (o_id, oi_id) 索引:覆盖 o_id 点查 + ORDER BY oi_id,无论是否带 companyId 都走索引。
-- IF NOT EXISTS 幂等;服务器主控端随发版同步后明细查询同样受益。
CREATE INDEX IF NOT EXISTS idx_jst_consign_deliv_items_oid
  ON jst_consign_deliver_items(o_id, oi_id);
