ALTER TABLE temu_activity_snapshot ADD COLUMN activity_type TEXT;
ALTER TABLE temu_activity_snapshot ADD COLUMN signup_price_cents INTEGER;
ALTER TABLE temu_activity_snapshot ADD COLUMN suggested_price_cents INTEGER;
ALTER TABLE temu_activity_snapshot ADD COLUMN price_currency TEXT;
ALTER TABLE temu_activity_snapshot ADD COLUMN activity_stock INTEGER;
ALTER TABLE temu_activity_snapshot ADD COLUMN signup_price_diff_cents INTEGER;
