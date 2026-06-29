-- ============================================================
-- VERIFICATION QUERIES: Cross-check Party Ledger summary cards
-- ============================================================
--
-- Run these one-by-one in Supabase SQL Editor. All read-only — they do NOT
-- modify any data. Replace 'Ahmed Traders' below with whichever party you
-- want to verify (or copy the UUID from Q0 into the variables further down).
--
-- For each query, compare the result with what the ledger UI shows. If they
-- match, the cards are correct. If they don't, the bug is real — share the
-- SQL output and we'll dig deeper.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Q0: Get the party_id by name (copy this UUID for the queries below)
-- ────────────────────────────────────────────────────────────
SELECT id, name, type, user_id
FROM parties
WHERE name ILIKE '%Ahmed Traders%';
-- Expected: 1 row. Note down the `id` and `user_id`.


-- ────────────────────────────────────────────────────────────
-- Q1: All sales invoices for this party
-- → matches the "Total Sales" card and "X invoices" sub-line
-- ────────────────────────────────────────────────────────────
SELECT
  id,
  total,
  status,
  source,
  created_at
FROM sales_invoices
WHERE party_id = (SELECT id FROM parties WHERE name ILIKE '%Ahmed Traders%' LIMIT 1)
ORDER BY created_at ASC;
-- Compare:
--   COUNT(*)      ↔ "X invoices" sub-line          (UI shows: 2 invoices)
--   SUM(total)    ↔ "Total Sales" amount           (UI shows: PKR 6,969,600)
--
-- NOTE: Cancelled invoices are EXCLUDED from the UI's Total Sales (debit=0
-- in the ledger for those rows), so if you see any rows with status='Cancelled'
-- here, run Q1b below to recompute SUM excluding them.


-- Q1b: Total Sales excluding Cancelled invoices (matches UI logic)
SELECT
  COUNT(*)           AS invoice_count,
  COALESCE(SUM(total), 0) AS total_sales
FROM sales_invoices
WHERE party_id = (SELECT id FROM parties WHERE name ILIKE '%Ahmed Traders%' LIMIT 1)
  AND COALESCE(status, '') <> 'Cancelled';
-- Compare both columns with the UI card.


-- ────────────────────────────────────────────────────────────
-- Q2: All payments received for this party's invoices
-- → matches the "Total Payments" card and "X payment received" sub-line
-- ────────────────────────────────────────────────────────────
SELECT
  p.id,
  p.invoice_id,
  p.amount,
  p.method,
  p.reference,
  p.created_at,
  si.status AS invoice_status
FROM payments p
JOIN sales_invoices si ON si.id = p.invoice_id
WHERE si.party_id = (SELECT id FROM parties WHERE name ILIKE '%Ahmed Traders%' LIMIT 1)
ORDER BY p.created_at ASC;
-- Compare:
--   COUNT(*)         ↔ "X payment received" sub-line (UI: 1 payment received)
--   SUM(p.amount)    ↔ "Total Payments" amount        (UI: PKR 3,479,040)
--
-- NOTE: Payments against Cancelled invoices contribute credit=0 to the ledger,
-- so if any row above has invoice_status='Cancelled', use Q2b for the strict match.


-- Q2b: Total Payments excluding Cancelled invoices (matches UI logic)
SELECT
  COUNT(*)               AS payment_count,
  COALESCE(SUM(p.amount), 0) AS total_payments
FROM payments p
JOIN sales_invoices si ON si.id = p.invoice_id
WHERE si.party_id = (SELECT id FROM parties WHERE name ILIKE '%Ahmed Traders%' LIMIT 1)
  AND COALESCE(si.status, '') <> 'Cancelled';


-- ────────────────────────────────────────────────────────────
-- Q3: All sale returns for this party
-- → matches "Returns (X)" line in the Returns & Refunds card
-- ────────────────────────────────────────────────────────────
SELECT
  id,
  sales_invoice_id,
  total,
  status,
  created_at
FROM returns
WHERE party_id = (SELECT id FROM parties WHERE name ILIKE '%Ahmed Traders%' LIMIT 1)
  AND type = 'sale'
ORDER BY created_at ASC;
-- Compare:
--   COUNT(*)      ↔ Returns count    (UI: Returns (1))
--   SUM(total)    ↔ Returns amount   (UI: PKR 3,479,040)


-- ────────────────────────────────────────────────────────────
-- Q4: All refunds for this party's sale returns
-- → matches "Refunds (X)" line in the Returns & Refunds card
-- ────────────────────────────────────────────────────────────
SELECT
  r.id            AS refund_id,
  r.return_id,
  r.amount,
  r.method,
  r.reference,
  r.created_at
FROM refunds r
JOIN returns ret ON ret.id = r.return_id
WHERE ret.party_id = (SELECT id FROM parties WHERE name ILIKE '%Ahmed Traders%' LIMIT 1)
  AND ret.type = 'sale'
ORDER BY r.created_at ASC;
-- Compare:
--   COUNT(*)        ↔ Refunds count    (UI: Refunds (1))
--   SUM(r.amount)   ↔ Refunds amount   (UI: PKR 3,479,040)


-- ────────────────────────────────────────────────────────────
-- Q5: Current Balance — full math reproduction in one query
-- ────────────────────────────────────────────────────────────
-- Replicates exactly what the ledger action does to compute the running balance
-- for a customer-type party:
--     debit  = invoice.total (when not Cancelled)  +  refund.amount
--     credit = payment.amount (when invoice not Cancelled)  +  return.total
--     balance = SUM(debit) - SUM(credit)
--
-- Note: `parties.type` and `returns.type` share the same column name, so we
-- alias the `returns` reference explicitly and only pull `id` into the CTE.
WITH
party AS (
  SELECT id FROM parties WHERE name ILIKE '%Ahmed Traders%' LIMIT 1
),
invoice_debit AS (
  SELECT COALESCE(SUM(si.total), 0) AS amt
  FROM sales_invoices si, party
  WHERE si.party_id = party.id
    AND COALESCE(si.status, '') <> 'Cancelled'
),
payment_credit AS (
  SELECT COALESCE(SUM(p.amount), 0) AS amt
  FROM payments p
  JOIN sales_invoices si ON si.id = p.invoice_id, party
  WHERE si.party_id = party.id
    AND COALESCE(si.status, '') <> 'Cancelled'
),
return_credit AS (
  SELECT COALESCE(SUM(ret.total), 0) AS amt
  FROM returns ret, party
  WHERE ret.party_id = party.id
    AND ret.type = 'sale'
),
refund_debit AS (
  SELECT COALESCE(SUM(r.amount), 0) AS amt
  FROM refunds r
  JOIN returns ret ON ret.id = r.return_id, party
  WHERE ret.party_id = party.id
    AND ret.type = 'sale'
)
SELECT
  invoice_debit.amt                                   AS total_sales,
  refund_debit.amt                                    AS total_refunds,
  payment_credit.amt                                  AS total_payments,
  return_credit.amt                                   AS total_returns,
  (invoice_debit.amt + refund_debit.amt)              AS total_debits,
  (payment_credit.amt + return_credit.amt)            AS total_credits,
  (invoice_debit.amt + refund_debit.amt)
    - (payment_credit.amt + return_credit.amt)        AS current_balance
FROM invoice_debit, refund_debit, payment_credit, return_credit;
-- This row should match the UI as a whole:
--   total_sales       ↔ "Total Sales"   card
--   total_payments    ↔ "Total Payments" card
--   total_returns     ↔ "Returns" line inside Returns & Refunds card
--   total_refunds     ↔ "Refunds" line inside Returns & Refunds card
--   current_balance   ↔ "Current Balance" card


-- ────────────────────────────────────────────────────────────
-- Q6: Full transaction list (mirrors what the table at the bottom of the
-- ledger page shows). Use this to confirm that everything is accounted for
-- and the running balance ties out row-by-row.
-- ────────────────────────────────────────────────────────────
WITH party AS (
  SELECT id FROM parties WHERE name ILIKE '%Ahmed Traders%' LIMIT 1
),
txn AS (
  SELECT
    si.created_at AS date,
    'Invoice #' || UPPER(LEFT(si.id::text, 8))
      || CASE WHEN si.status = 'Cancelled' THEN ' (Cancelled)' ELSE '' END AS description,
    CASE WHEN COALESCE(si.status, '') <> 'Cancelled' THEN si.total ELSE 0 END AS debit,
    0::numeric AS credit,
    'invoice' AS type
  FROM sales_invoices si, party
  WHERE si.party_id = party.id

  UNION ALL

  SELECT
    p.created_at,
    'Payment (' || p.method || ')'
      || CASE WHEN si.status = 'Cancelled' THEN ' - Invoice Cancelled' ELSE '' END,
    0,
    CASE WHEN COALESCE(si.status, '') <> 'Cancelled' THEN p.amount ELSE 0 END,
    'payment'
  FROM payments p
  JOIN sales_invoices si ON si.id = p.invoice_id, party
  WHERE si.party_id = party.id

  UNION ALL

  SELECT
    ret.created_at,
    'Sale Return #' || UPPER(LEFT(ret.id::text, 8)),
    0,
    ret.total,
    'return'
  FROM returns ret, party
  WHERE ret.party_id = party.id AND ret.type = 'sale'

  UNION ALL

  SELECT
    r.created_at,
    'Refund (' || COALESCE(r.method, 'Cash') || ')',
    r.amount,
    0,
    'refund'
  FROM refunds r
  JOIN returns ret ON ret.id = r.return_id, party
  WHERE ret.party_id = party.id AND ret.type = 'sale'
)
SELECT
  date,
  description,
  debit,
  credit,
  type,
  SUM(debit - credit) OVER (ORDER BY date, type) AS running_balance
FROM txn
ORDER BY date, type;
-- The final row's running_balance should equal current_balance from Q5
-- and the "Current Balance" card on the UI.
