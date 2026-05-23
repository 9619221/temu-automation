-- @idempotent
ALTER TABLE erp_purchase_orders ADD COLUMN paid_amount REAL;
ALTER TABLE erp_purchase_orders ADD COLUMN freight_amount REAL NOT NULL DEFAULT 0;
