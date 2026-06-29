-- Version 4: Add advance_payment and pre_balance opening balance fields to parties
ALTER TABLE parties
  ADD COLUMN IF NOT EXISTS advance_payment     NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS advance_payment_ref TEXT,
  ADD COLUMN IF NOT EXISTS pre_balance         NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pre_balance_ref     TEXT;
