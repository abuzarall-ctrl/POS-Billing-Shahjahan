-- ============================================================
-- MIGRATION: Add pack unit support to inventory_items
-- ============================================================
--
-- WHY:
-- Pakistani wholesale flow needs items to be entered/sold in cartons (CTN)
-- alongside the base unit (PCS), with a per-item conversion ratio.
-- Example: 1 item has pack_unit = "Carton" and pack_size = 100, meaning
-- 1 CTN = 100 base units. Different items have different pack sizes.
--
-- DESIGN:
-- - Reuse the existing `units` table for pack units (just add "Carton"/"Box"/"Dozen"
--   from the Units page like any other unit — no new master table needed).
-- - Stock, prices, and profit stay in BASE units. The pack is a display/entry helper.
-- - Both columns are NULL-able so existing items keep working without a pack.
--
-- HOW TO RUN: paste this in Supabase SQL Editor → Run. Safe to re-run (uses IF NOT EXISTS).
-- ============================================================

-- 1. Add the two columns
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS pack_unit_id UUID NULL,
  ADD COLUMN IF NOT EXISTS pack_size NUMERIC(12, 4) NULL;

-- 2. FK constraint on pack_unit_id → units(id) so deleting a unit nulls it on items.
--    Use a conditional block so re-running the migration doesn't error on the
--    "already exists" case (no IF NOT EXISTS for ADD CONSTRAINT in older Postgres).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'inventory_items'
      AND constraint_name = 'inventory_items_pack_unit_id_fkey'
  ) THEN
    ALTER TABLE inventory_items
      ADD CONSTRAINT inventory_items_pack_unit_id_fkey
      FOREIGN KEY (pack_unit_id) REFERENCES units(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- 3. Sanity constraint: pack_size must be positive when set; pack_unit must be
--    set when pack_size is set (and vice versa). Drop first if it already exists
--    so re-running this migration doesn't fail.
ALTER TABLE inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_pack_size_consistency;

ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_pack_size_consistency
  CHECK (
    (pack_unit_id IS NULL AND pack_size IS NULL)
    OR (pack_unit_id IS NOT NULL AND pack_size IS NOT NULL AND pack_size > 0)
  );

-- 4. Verify (read-only)
SELECT
  COUNT(*) AS total_items,
  COUNT(pack_unit_id) AS items_with_pack
FROM inventory_items;
