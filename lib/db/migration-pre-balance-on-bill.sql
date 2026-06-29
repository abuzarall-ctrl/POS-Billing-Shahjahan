-- Phase 1: Pre-balance on bill feature
-- Adds two columns to sales_invoices to snapshot the customer's outstanding
-- balance at the time of sale and whether to print it on the bill.

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS pre_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS show_pre_balance BOOLEAN NOT NULL DEFAULT FALSE;
