-- ============================================================
-- SEED: Admin User — shahjahan
-- Run this in Supabase SQL Editor AFTER combined-fresh-install.sql
--
-- Email for login: shahjahan@store.com
-- Password: shahjahan@786
--
-- This creates TWO records:
--   1. admins table  → logs into /admin (super-admin panel, manages pos_users)
--   2. pos_users     → logs into /login (main POS app, all privileges)
-- ============================================================

-- 1. Super-admin record (for /admin/login page)
INSERT INTO admins (email, password_hash, name, is_active)
VALUES (
  'shahjahan@store.com',
  '$2b$10$wpUAe4eeSna/jh3q/sVg6Ozj77LiqZ5MbN1SeRIVvYHLpfGQqY4ku',
  'Shahjahan',
  true
)
ON CONFLICT (email) DO NOTHING;

-- 2. POS user record (for /login page — main app access, all privileges ON)
INSERT INTO pos_users (email, password_hash, role, name, is_active, privileges)
VALUES (
  'shahjahan@store.com',
  '$2b$10$wpUAe4eeSna/jh3q/sVg6Ozj77LiqZ5MbN1SeRIVvYHLpfGQqY4ku',
  'pos_user',
  'Shahjahan',
  true,
  '{
    "dashboard": true,
    "parties": true,
    "inventory": true,
    "inventory_report": true,
    "categories": true,
    "units": true,
    "barcode": true,
    "pos": true,
    "invoices_list": true,
    "accounts": true,
    "returns_refunds": true,
    "employees_payroll": true,
    "purchases": true,
    "backup": true
  }'::jsonb
)
ON CONFLICT (email) DO NOTHING;
