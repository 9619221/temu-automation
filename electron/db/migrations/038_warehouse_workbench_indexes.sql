-- @idempotent
CREATE INDEX IF NOT EXISTS idx_erp_inbound_receipts_account_status_received
  ON erp_inbound_receipts(account_id, status, received_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_erp_inbound_receipts_account_received
  ON erp_inbound_receipts(account_id, received_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_erp_inbound_receipts_po
  ON erp_inbound_receipts(po_id);

CREATE INDEX IF NOT EXISTS idx_erp_inbound_lines_receipt
  ON erp_inbound_receipt_lines(receipt_id);

CREATE INDEX IF NOT EXISTS idx_erp_inbound_lines_receipt_issue
  ON erp_inbound_receipt_lines(receipt_id, shortage_qty, over_qty, damaged_qty);

CREATE INDEX IF NOT EXISTS idx_erp_purchase_orders_supplier
  ON erp_purchase_orders(supplier_id);
