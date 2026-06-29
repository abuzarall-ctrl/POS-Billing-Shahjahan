-- Migration: BI Report — Expense Sheet
-- Run this in Supabase SQL editor ONLY if you are doing a fresh install.
-- If you already ran combined-fresh-install.sql and the expenses table already exists
-- with a different schema, adapt accordingly.

-- Drop and recreate the expenses table for the BI Report module.
-- This version uses a simpler schema suited for the Expense Sheet feature:
--   - references pos_users (not auth.users)
--   - only description + amount (no category / payment_method / date fields)
--   - amount allows 0 (CHECK amount >= 0)

-- NOTE: If you have existing data in the expenses table, back it up first!

DROP TABLE IF EXISTS expenses;  

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES pos_users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(created_at DESC);

ALTER TABLE expenses DISABLE ROW LEVEL SECURITY;
