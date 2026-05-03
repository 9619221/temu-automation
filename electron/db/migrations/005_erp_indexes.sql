CREATE INDEX IF NOT EXISTS idx_erp_skus_account ON erp_skus(account_id);
CREATE INDEX IF NOT EXISTS idx_erp_skus_temu_product ON erp_skus(temu_product_id);
CREATE INDEX IF NOT EXISTS idx_erp_pr_account_status ON erp_purchase_requests(account_id, status);
CREATE INDEX IF NOT EXISTS idx_erp_sourcing_pr_status ON erp_sourcing_candidates(pr_id, status);
CREATE INDEX IF NOT EXISTS idx_erp_po_account_status ON erp_purchase_orders(account_id, status);
CREATE INDEX IF NOT EXISTS idx_erp_payment_po_status ON erp_payment_approvals(po_id, status);
CREATE INDEX IF NOT EXISTS idx_erp_inbound_account_status ON erp_inbound_receipts(account_id, status);
CREATE INDEX IF NOT EXISTS idx_erp_batches_account_sku ON erp_inventory_batches(account_id, sku_id);
CREATE INDEX IF NOT EXISTS idx_erp_batches_qc_status ON erp_inventory_batches(account_id, qc_status);
CREATE INDEX IF NOT EXISTS idx_erp_ledger_sku_batch ON erp_inventory_ledger_entries(sku_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_erp_qc_batch_status ON erp_qc_inspections(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_erp_outbound_account_status ON erp_outbound_shipments(account_id, status);
CREATE INDEX IF NOT EXISTS idx_erp_work_items_owner_status ON erp_work_items(account_id, owner_role, status);
CREATE INDEX IF NOT EXISTS idx_erp_work_items_priority ON erp_work_items(account_id, priority, status);
CREATE INDEX IF NOT EXISTS idx_erp_audit_entity ON erp_audit_logs(entity_type, entity_id);

