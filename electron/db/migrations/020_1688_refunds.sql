CREATE TABLE IF NOT EXISTS erp_1688_refunds (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  po_id TEXT,
  external_order_id TEXT,
  refund_id TEXT,
  refund_status TEXT,
  refund_type TEXT,
  refund_reason TEXT,
  refund_amount REAL,
  currency TEXT,
  raw_payload_json TEXT NOT NULL DEFAULT '{}',
  operation_log_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at TEXT,
  UNIQUE(refund_id),
  FOREIGN KEY(account_id) REFERENCES erp_accounts(id),
  FOREIGN KEY(po_id) REFERENCES erp_purchase_orders(id),
  FOREIGN KEY(created_by) REFERENCES erp_users(id)
);

CREATE INDEX IF NOT EXISTS idx_1688_refunds_po
  ON erp_1688_refunds(po_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_1688_refunds_external_order
  ON erp_1688_refunds(external_order_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_1688_refunds_status
  ON erp_1688_refunds(refund_status, updated_at);
