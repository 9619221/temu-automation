-- @idempotent
ALTER TABLE erp_inventory_ledger_entries ADD COLUMN cancelled_at TEXT DEFAULT NULL;
