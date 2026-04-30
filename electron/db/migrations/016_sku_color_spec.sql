ALTER TABLE erp_skus ADD COLUMN color_spec TEXT;

UPDATE erp_skus
SET color_spec = category
WHERE color_spec IS NULL
  AND category IS NOT NULL;
