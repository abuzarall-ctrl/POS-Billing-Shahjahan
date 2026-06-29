-- ============================================================
-- BACKFILL SCRIPT: Fill missing cost_price on sales_invoice_lines
-- ============================================================
--
-- WHY: updatePOSSale used to insert line items WITHOUT cost_price,
-- causing dashboard gross profit to compute as 100% on those rows.
-- The code is now fixed for new sales, but old rows still have NULL.
--
-- WHAT THIS DOES:
--   1. Reads cost_price from inventory_items (current cost on item)
--   2. Writes it into sales_invoice_lines.cost_price ONLY where it is NULL
--   3. Does NOT overwrite existing values
--   4. Does NOT delete or modify any other column
--
-- SAFE TO RE-RUN: Yes — only touches NULL rows.
--
-- HOW TO RUN: Open Supabase SQL Editor → paste this → Run.
-- ============================================================

-- Step 1: Preview how many rows will be updated (read-only check)
SELECT COUNT(*) AS rows_to_backfill
FROM sales_invoice_lines sil
WHERE sil.cost_price IS NULL;

-- Step 2: Preview a sample of what will change (read-only check)
SELECT
  sil.id AS line_id,
  sil.invoice_id,
  sil.item_id,
  sil.unit_price,
  sil.cost_price AS current_cost_price,
  ii.cost_price AS will_be_set_to
FROM sales_invoice_lines sil
JOIN inventory_items ii ON ii.id = sil.item_id
WHERE sil.cost_price IS NULL
LIMIT 20;

-- Step 3: ACTUAL BACKFILL (remove the comment before running)
-- This is the only statement that writes data. Keep it commented until
-- you have reviewed steps 1-2 and are ready to apply.

-- UPDATE sales_invoice_lines AS sil
-- SET cost_price = ii.cost_price
-- FROM inventory_items AS ii
-- WHERE sil.item_id = ii.id
--   AND sil.cost_price IS NULL;

-- Step 4: Verify (run after the UPDATE)
-- SELECT COUNT(*) AS remaining_null FROM sales_invoice_lines WHERE cost_price IS NULL;
