-- ============================================================
-- MIGRATION: Add per-line discount tracking to sales_invoice_lines
-- ============================================================
--
-- WHY:
-- The POS form lets the cashier apply a line-level discount (a per-item
-- percentage or PKR amount). That discount is currently baked into
-- `unit_price` at save time and the original list price + the discount
-- amount are both lost. Result: printed invoices can't show per-line
-- discount columns because the data isn't there.
--
-- WHAT THIS DOES:
-- Adds two NULL-able columns:
--   - original_unit_price : the list price before the line discount was applied
--   - discount_amount     : total per-line discount in PKR (quantity × pct, or fixed PKR)
--
-- For all existing rows the new columns stay NULL, which the UI treats as
-- "no discount info known" and falls back to the existing behaviour. So
-- this migration is fully backward compatible.
--
-- HOW TO RUN: paste into Supabase SQL Editor → Run. Safe to re-run
-- (uses IF NOT EXISTS).
-- ============================================================

ALTER TABLE sales_invoice_lines
  ADD COLUMN IF NOT EXISTS original_unit_price NUMERIC(12, 2) NULL,
  ADD COLUMN IF NOT EXISTS discount_amount     NUMERIC(12, 2) NULL DEFAULT 0;

-- Verification (read-only)
SELECT
  COUNT(*)                                          AS total_lines,
  COUNT(original_unit_price)                        AS lines_with_original_price,
  COUNT(NULLIF(discount_amount, 0))                 AS lines_with_discount,
  COALESCE(SUM(discount_amount), 0)                 AS total_line_discount
FROM sales_invoice_lines;
