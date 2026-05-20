-- 027 去掉入库 QC 闸门：把存量「待质检」批次一次性放行
--
-- 背景：之前入库建批次时数量全进 blocked 桶、qc_status=pending，必须做完 QC
-- 才会释放到 available 才能出库。现已去掉该闸门（入库直接进 available）。
-- 本迁移把历史上仍卡在 pending 的批次一次性放行，使其立即可出库。
--
-- 只处理 qc_status='pending' 的批次；'failed'（质检判废）保持不动。
-- 同步补一条 qc_release 流水，保证库存账（ledger）与批次桶一致。

INSERT INTO erp_inventory_ledger_entries (
  id, account_id, sku_id, batch_id, type, qty_delta,
  from_bucket, to_bucket, unit_cost, source_doc_type, source_doc_id,
  created_at, created_by
)
SELECT
  lower(hex(randomblob(16))),
  batch.account_id,
  batch.sku_id,
  batch.id,
  'qc_release',
  0,
  'blocked',
  'available',
  NULL,
  'migration',
  '027_drop_qc_gate',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL
FROM erp_inventory_batches batch
WHERE batch.qc_status = 'pending'
  AND batch.blocked_qty > 0;

UPDATE erp_inventory_batches
SET available_qty = available_qty + blocked_qty,
    blocked_qty = 0,
    qc_status = 'passed',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE qc_status = 'pending';
