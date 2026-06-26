-- @idempotent
ALTER TABLE erp_consign_local_state ADD COLUMN deduction_ignored INTEGER NOT NULL DEFAULT 0;
