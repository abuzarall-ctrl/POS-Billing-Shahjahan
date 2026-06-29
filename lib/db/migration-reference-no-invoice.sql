-- Phase 3: Add bill reference number to sales_invoices
-- Run once in Supabase SQL editor

ALTER TABLE sales_invoices
  ADD COLUMN IF NOT EXISTS reference_no TEXT;
