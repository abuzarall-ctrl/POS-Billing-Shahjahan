-- ============================================================
-- DIAGNOSTIC QUERIES: Investigate why gross profit is so low
-- ============================================================
--
-- Run these one by one in Supabase SQL Editor. They are READ-ONLY —
-- they do NOT modify any data.
--
-- After running, share the results so we can pinpoint the issue.
-- ============================================================

-- Q1: Overall margin breakdown across all sales lines
-- Shows: how many lines are at-cost / loss / profitable
SELECT
  CASE
    WHEN cost_price IS NULL THEN 'NULL cost (uncertain)'
    WHEN cost_price = 0 THEN 'Zero cost (free goods?)'
    WHEN unit_price < cost_price THEN 'SELLING AT LOSS'
    WHEN unit_price = cost_price THEN 'AT COST (0% margin)'
    WHEN (unit_price - cost_price) / NULLIF(cost_price, 0) < 0.05 THEN 'Thin margin (<5%)'
    WHEN (unit_price - cost_price) / NULLIF(cost_price, 0) < 0.20 THEN 'Normal margin (5-20%)'
    ELSE 'Healthy margin (>20%)'
  END AS margin_bucket,
  COUNT(*) AS line_count,
  SUM(quantity * unit_price) AS total_sales_value,
  SUM(quantity * (unit_price - COALESCE(cost_price, unit_price))) AS total_profit
FROM sales_invoice_lines
GROUP BY 1
ORDER BY total_sales_value DESC;

-- Q2: Top items by sales volume — and their actual margin
-- Helps identify which items are driving the low profit
SELECT
  ii.id,
  ii.name,
  ii.cost_price AS item_cost,
  ii.cash_price AS item_cash_price,
  COUNT(sil.id) AS times_sold,
  SUM(sil.quantity) AS total_qty_sold,
  SUM(sil.quantity * sil.unit_price) AS total_revenue,
  SUM(sil.quantity * (sil.unit_price - COALESCE(sil.cost_price, sil.unit_price))) AS total_profit,
  CASE
    WHEN SUM(sil.quantity * sil.unit_price) > 0
    THEN ROUND(
      (SUM(sil.quantity * (sil.unit_price - COALESCE(sil.cost_price, sil.unit_price)))::numeric
       / SUM(sil.quantity * sil.unit_price)::numeric) * 100,
      2
    )
    ELSE 0
  END AS margin_percent
FROM sales_invoice_lines sil
JOIN inventory_items ii ON ii.id = sil.item_id
GROUP BY ii.id, ii.name, ii.cost_price, ii.cash_price
ORDER BY total_revenue DESC
LIMIT 20;

-- Q3: Items where cost_price = cash_price (no markup configured)
-- These are items where you set the same price for buying and selling
SELECT
  id,
  name,
  cost_price,
  cash_price,
  credit_price,
  supplier_price
FROM inventory_items
WHERE cost_price > 0 AND cost_price = cash_price
ORDER BY name;

-- Q4: Items with zero or null cost_price in inventory_items table itself
-- These cause inflated profit (or after Bug E fix, 0 profit)
SELECT
  id,
  name,
  cost_price,
  cash_price,
  stock
FROM inventory_items
WHERE cost_price IS NULL OR cost_price = 0;

-- Q5: Sales lines where selling price is BELOW cost (selling at a loss!)
SELECT
  sil.invoice_id,
  ii.name,
  sil.quantity,
  sil.unit_price,
  sil.cost_price,
  (sil.unit_price - sil.cost_price) AS margin_per_unit,
  sil.quantity * (sil.unit_price - sil.cost_price) AS total_loss
FROM sales_invoice_lines sil
JOIN inventory_items ii ON ii.id = sil.item_id
WHERE sil.cost_price IS NOT NULL
  AND sil.unit_price < sil.cost_price
ORDER BY total_loss ASC
LIMIT 20;

-- Q6: This-month-only summary (matches dashboard period)
-- Adjust the date if needed to match "This Month" in dashboard
SELECT
  COUNT(DISTINCT si.id) AS total_invoices,
  COUNT(sil.id) AS total_lines,
  SUM(sil.quantity * sil.unit_price) AS total_subtotal,
  SUM(sil.quantity * (sil.unit_price - COALESCE(sil.cost_price, sil.unit_price))) AS total_profit,
  ROUND(
    (SUM(sil.quantity * (sil.unit_price - COALESCE(sil.cost_price, sil.unit_price)))::numeric
     / NULLIF(SUM(sil.quantity * sil.unit_price), 0)::numeric) * 100,
    4
  ) AS margin_percent
FROM sales_invoices si
JOIN sales_invoice_lines sil ON sil.invoice_id = si.id
WHERE si.created_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Karachi')
  AND si.status IN ('Paid', 'Pending', 'Credit', 'Partial');
