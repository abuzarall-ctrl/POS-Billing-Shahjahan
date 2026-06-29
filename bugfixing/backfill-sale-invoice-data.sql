-- =============================================================================
-- Backfill SQL — Sale invoice fixes (Round 2)
-- =============================================================================
-- Two one-time backfills addressing data created BEFORE the Round-2 fixes:
--
-- (1) Pre-migration sales_invoice_lines rows: `original_unit_price` and
--     `discount_amount` are NULL/0 even though some of those invoices had baked-in
--     discounts. After the C1/C2 fix, *editing* such a draft can write a bogus
--     `original_unit_price` because the form treats the effective DB price as the
--     list price. Setting `original_unit_price = unit_price` (with discount_amount
--     left at 0) makes the print template reconstruct cleanly and old-draft edits
--     stop corrupting data.
--
-- (2) Pre-R2-C1 Draft sales: Drafts USED to decrement stock on creation. After
--     R2-C1, Drafts don't decrement. Existing Drafts are still holding stock
--     against an unfinalized invoice. The OPTIONAL second block restores that
--     stock based on the stock_movements audit trail, so abandoned Drafts no
--     longer hide physical inventory.
--
-- All UPDATE / INSERT statements below are commented out by default. Run the
-- preview SELECTs first to see what would change. Uncomment the writes only when
-- you're satisfied with the preview output.
--
-- Safe to re-run: each block is idempotent.
-- =============================================================================


-- =============================================================================
-- (1) Backfill `original_unit_price` on legacy sales_invoice_lines
-- =============================================================================

-- Preview: how many rows would be touched?
SELECT
  COUNT(*) FILTER (WHERE original_unit_price IS NULL)              AS lines_with_null_original,
  COUNT(*) FILTER (WHERE original_unit_price IS NULL AND discount_amount > 0) AS suspicious_lines,
  COUNT(*)                                                          AS total_lines
FROM sales_invoice_lines;

-- Preview: a sample of the rows that would change
SELECT id, invoice_id, item_id, quantity, unit_price, original_unit_price, discount_amount
FROM sales_invoice_lines
WHERE original_unit_price IS NULL
ORDER BY id
LIMIT 20;

-- Apply (uncomment to run):
-- UPDATE sales_invoice_lines
--   SET original_unit_price = unit_price
--   WHERE original_unit_price IS NULL;

-- Verify after running:
-- SELECT
--   COUNT(*) FILTER (WHERE original_unit_price IS NULL) AS still_null,
--   COUNT(*)                                            AS total_lines
-- FROM sales_invoice_lines;


-- =============================================================================
-- (2) Restore stock for pre-R2-C1 Drafts that decremented inventory
-- =============================================================================
-- Strategy: for every Draft sales_invoice, sum the net OUT (sum OUT − sum IN)
-- recorded in stock_movements against that invoice. If positive, increment the
-- inventory stock by that amount and insert a compensating IN movement so the
-- audit trail explains the change. After this, abandoned Drafts no longer hold
-- stock — they sit there as parked carts (which is what they were supposed to
-- be all along).
--
-- This block is fully optional. If your install never had abandoned Drafts (or
-- you're OK with the current drift), skip it.

-- Preview: list Drafts that have a positive net OUT stock movement
SELECT
  inv.id                                AS invoice_id,
  inv.created_at,
  inv.user_id,
  sum_out.item_id,
  sum_out.net_out
FROM sales_invoices inv
JOIN (
  SELECT
    sm.reference_id,
    sm.item_id,
    sm.user_id,
    SUM(CASE WHEN sm.movement_type = 'OUT' THEN sm.quantity
             WHEN sm.movement_type = 'IN'  THEN -sm.quantity
             ELSE 0 END) AS net_out
  FROM stock_movements sm
  WHERE sm.reference_type = 'Invoice'
  GROUP BY sm.reference_id, sm.item_id, sm.user_id
  HAVING SUM(CASE WHEN sm.movement_type = 'OUT' THEN sm.quantity
                  WHEN sm.movement_type = 'IN'  THEN -sm.quantity
                  ELSE 0 END) > 0
) sum_out ON sum_out.reference_id = inv.id AND sum_out.user_id = inv.user_id
WHERE inv.status = 'Draft'
  AND inv.source = 'pos'
ORDER BY inv.created_at DESC
LIMIT 50;

-- Apply (uncomment ALL THREE statements together to run as a unit):
-- BEGIN;
--
-- -- Increment inventory_items.stock by the net OUT per item per Draft
-- UPDATE inventory_items ii
--   SET stock = COALESCE(ii.stock, 0) + restore.net_out
--   FROM (
--     SELECT
--       sum_out.item_id,
--       SUM(sum_out.net_out) AS net_out
--     FROM sales_invoices inv
--     JOIN (
--       SELECT
--         sm.reference_id,
--         sm.item_id,
--         sm.user_id,
--         SUM(CASE WHEN sm.movement_type = 'OUT' THEN sm.quantity
--                  WHEN sm.movement_type = 'IN'  THEN -sm.quantity
--                  ELSE 0 END) AS net_out
--       FROM stock_movements sm
--       WHERE sm.reference_type = 'Invoice'
--       GROUP BY sm.reference_id, sm.item_id, sm.user_id
--       HAVING SUM(CASE WHEN sm.movement_type = 'OUT' THEN sm.quantity
--                       WHEN sm.movement_type = 'IN'  THEN -sm.quantity
--                       ELSE 0 END) > 0
--     ) sum_out ON sum_out.reference_id = inv.id AND sum_out.user_id = inv.user_id
--     WHERE inv.status = 'Draft' AND inv.source = 'pos'
--     GROUP BY sum_out.item_id
--   ) restore
--   WHERE ii.id = restore.item_id;
--
-- -- Insert compensating IN movements so the audit trail is honest
-- INSERT INTO stock_movements (item_id, movement_type, quantity, reference_type, reference_id, notes, user_id)
-- SELECT
--   sum_out.item_id,
--   'IN',
--   sum_out.net_out,
--   'Invoice',
--   inv.id,
--   'Stock restored by R2-C1 backfill (Draft no longer holds stock)',
--   inv.user_id
-- FROM sales_invoices inv
-- JOIN (
--   SELECT
--     sm.reference_id,
--     sm.item_id,
--     sm.user_id,
--     SUM(CASE WHEN sm.movement_type = 'OUT' THEN sm.quantity
--              WHEN sm.movement_type = 'IN'  THEN -sm.quantity
--              ELSE 0 END) AS net_out
--   FROM stock_movements sm
--   WHERE sm.reference_type = 'Invoice'
--   GROUP BY sm.reference_id, sm.item_id, sm.user_id
--   HAVING SUM(CASE WHEN sm.movement_type = 'OUT' THEN sm.quantity
--                   WHEN sm.movement_type = 'IN'  THEN -sm.quantity
--                   ELSE 0 END) > 0
-- ) sum_out ON sum_out.reference_id = inv.id AND sum_out.user_id = inv.user_id
-- WHERE inv.status = 'Draft' AND inv.source = 'pos';
--
-- COMMIT;

-- Verify after running the second block:
-- SELECT COUNT(*) FROM (
--   SELECT sm.reference_id
--   FROM sales_invoices inv
--   JOIN stock_movements sm ON sm.reference_id = inv.id AND sm.reference_type = 'Invoice'
--   WHERE inv.status = 'Draft' AND inv.source = 'pos'
--   GROUP BY sm.reference_id, sm.item_id
--   HAVING SUM(CASE WHEN sm.movement_type = 'OUT' THEN sm.quantity
--                   WHEN sm.movement_type = 'IN'  THEN -sm.quantity
--                   ELSE 0 END) > 0
-- ) still_holding;
-- Expected: 0 rows.
