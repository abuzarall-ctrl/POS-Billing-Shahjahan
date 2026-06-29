# Inventory + Purchase Modules — Deep Diagnostic

**Date:** 2026-05-20
**Trigger:** "Total Inventory Value" showing PKR 0.00 in the Inventory Reports page despite 48 items existing, 21 of which have non-zero stock.
**Scope:** Every code path that creates/updates/reads inventory items, computes inventory value, creates/updates purchases, applies purchase payments, and feeds the dashboard/reports.

**Status:** **DIAGNOSIS ONLY.** No fixes implemented yet. Each finding awaits triage before being moved to `bugfixed.md`.

Files audited:
- `app/(app)/stock-management/inventory/actions.ts`
- `app/(app)/stock-management/inventory/page.tsx`
- `app/(app)/stock-management/inventory/inventory-dialog.tsx`
- `app/(app)/stock-management/inventory/inventory-page-client.tsx`
- `app/(app)/stock-management/reports/actions.ts`
- `app/(app)/stock-management/reports/page.tsx`
- `app/(app)/purchases/actions.ts`
- `app/(app)/purchase-management/purchases/page.tsx` (+ client)
- `app/(app)/purchase-management/payments/page.tsx` (+ client)
- `app/(app)/purchase-management/create/page.tsx`
- `app/(app)/purchase-management/reports/actions.ts`
- `lib/db/inventory-pricing.ts`
- `lib/db/combined-fresh-install.sql` (schema)

Severity legend: **🔴 Critical** (wrong numbers, data loss, cross-tenant) · **🟠 High** (business-rule bug, operational gap) · **🟡 Medium** (edge case, hardening) · **⚪ Low** (cleanup).

---

## 🔴 CRITICAL — INVENTORY

### IV-C0. **Total Inventory Value always PKR 0.00** — reports read a column that's never populated
**Where:** `app/(app)/stock-management/reports/actions.ts:23, 40, 135, 137`.

The `getInventoryValueAnalysis()` function and `getStockLevels()` function both compute item value as:

```ts
const sellingPrice = Number(
  (item as { selling_price?: number }).selling_price ??
  (item as { unit_price?: number }).unit_price ??
  0
)
const value = stock * sellingPrice
totalValue += value
```

The `selling_price` column **does exist** in the schema (`combined-fresh-install.sql:166` — legacy from before the multi-tier pricing refactor). BUT **`createInventoryItem` never writes to it** ([inventory/actions.ts:104-118](app/(app)/stock-management/inventory/actions.ts#L104)). Items today are inserted with `cost_price`, `cash_price`, `credit_price`, `supplier_price` — `selling_price` stays at its DB default (0 or NULL).

`unit_price` is also not in the active schema for new installs (older column from earlier era).

So both report functions read 0 → totalValue = Σ (stock × 0) = **0**, regardless of how many items have stock.

Confirming: a helper file `lib/db/inventory-pricing.ts` already documents this and correctly uses `cash_price ?? selling_price ?? 0` everywhere. The reports just bypass the helper.

**Impact:** **The store cannot see what their inventory is worth.** "Total Inventory Value" is a permanent zero. Same for the per-item "Value" column. Same for the "Value Analysis by Category" breakdown — every category shows PKR 0.00.

**Fix:** One-line per call site. Read `cost_price` (inventory at cost — accounting standard) or `cash_price` (inventory at retail) instead of `selling_price`. Recommended: **cost_price** for inventory value (matches GAAP / Pakistani accounting), keep `cash_price` available for a separate "Retail value" metric if needed later.

---

### IV-C1. Inventory reports include archived items in counts + totals
**Where:** `getStockLevels()` and `getInventoryValueAnalysis()` in [reports/actions.ts:9-46, 98-162](app/(app)/stock-management/reports/actions.ts).

Neither function filters on `is_archived: false`. Once `deleteInventoryItem` soft-archives an item (because it's referenced by sales lines), it still appears in:
- "Stock Levels" table (Out of Stock status, since archived items typically have stock = 0)
- "Total Items" count
- "Out of Stock" count

The inventory MAIN page (`stock-management/inventory/page.tsx`) does filter on `is_archived = false` (verified via grep). Reports don't, so the two screens disagree on totals.

**Impact:** Reports overcount items and out-of-stock counts. User sees "48 total, 27 out of stock" on Reports but a different number on the Inventory page.

---

## 🔴 CRITICAL — PURCHASE

### IV-C2. **Purchasing items NEVER updates `cost_price`** — gross profit math drifts forever
**Where:** [purchases/actions.ts:15-113](app/(app)/purchases/actions.ts#L15-L113) (`createPurchase`) and [purchases/actions.ts:202-353](app/(app)/purchases/actions.ts#L202-L353) (`updatePurchase`).

When a user purchases items at PKR 100 each, then later purchases the same item at PKR 120 each:
- Stock increments correctly (RPC `increment_inventory_stock`)
- A `stock_movements` row is recorded
- **But `inventory_items.cost_price` is NEVER updated.**

The cost basis stays at whatever was entered when the item was first created — possibly years ago, possibly at a different supplier price. Every subsequent gross-profit calculation uses this stale cost.

This is **THE single biggest cost-accounting bug in the entire app**. Affects:
- Dashboard gross profit (uses `sales_invoice_lines.cost_price`, which is snapshotted FROM inventory at sale time — so the stale cost propagates into every new sale)
- Inventory value at cost (per IV-C0 fix — would use the stale cost)
- Profit-per-item analytics
- Vendor cost comparisons

Standard accounting approach: weighted-average cost OR FIFO/LIFO. The simplest correct fix is **weighted-average**:
```
new_cost_price = (current_stock × current_cost + purchased_qty × purchase_unit_price)
                 / (current_stock + purchased_qty)
```
Updated on every purchase line, written back to `inventory_items.cost_price`.

**Impact:** Gross profit calculations across the entire app use **costs frozen at item-creation time**. A store buying at increasing supplier prices over months will show inflated profit margins forever. Conversely, a store getting better deals will show deflated margins.

---

### IV-C3. Draft purchases decrement supplier balance + add stock
**Where:** [purchases/actions.ts:46-107](app/(app)/purchases/actions.ts#L46-L107).

`createPurchase` defaults `status: "Draft"` ([line 58](app/(app)/purchases/actions.ts#L58)) but unconditionally:
1. Increments inventory stock (line 87)
2. Records the IN stock movement (line 93)
3. Creates the purchase invoice header that the ledger then treats as a payable

If the cashier saves a Draft purchase to come back to later, **stock has already gone up, vendor's balance is now owed** — even though the purchase hasn't been finalized.

This is the exact mirror of the **R2-C1** bug we fixed in POS sales last week. The Draft status needs the same gating: skip stock + ledger effects until status is finalized.

**Impact:** Same as POS Drafts before R2-C1 — abandoned Draft purchases inflate stock + accounts payable. Cleanup requires manual SQL.

---

### IV-C4. `taxRate || 18` short-circuits 0
**Where:** `createPurchase:46` and `updatePurchase:274` — `const taxRate = payload.taxRate || 18`.

The OR-fallback treats `taxRate: 0` as falsy and substitutes 18. Same bug as RF-C3 in the returns module (already fixed there with `?? 0`). Any caller explicitly passing `taxRate: 0` gets a purchase with 18% tax tacked on.

**Impact:** Tax-free purchases (common in B2B Pakistan) get 18% appended. Bill totals are silently inflated.

---

### IV-C5. Cross-tenant leak risk on purchase-management pages
**Where:** [purchase-management/purchases/page.tsx](app/(app)/purchase-management/purchases/page.tsx) and [purchase-management/payments/page.tsx](app/(app)/purchase-management/payments/page.tsx) — need verification.

The returns module had three queries using `createAdminClient()` without `user_id` filters (RF-C1, RF-C6, RF-M7). The purchase-management list page likely has the same pattern for `purchase_invoices` and `parties` (vendor) queries used to populate dropdowns and lists.

**Action:** grep the two pages — same fix pattern as RF-C1: add `.eq("user_id", currentUser.effectiveUserId)`.

---

## 🟠 HIGH — INVENTORY

### IV-H1. No uniqueness on item name within a user
**Where:** `createInventoryItem` in [inventory/actions.ts:91](app/(app)/stock-management/inventory/actions.ts#L91).

Two items can have the exact same `name` for the same `user_id`. The POS dropdown will show duplicates with identical labels. Cashier picks one — ambiguous which one's stock decrements.

**Fix:** Add unique constraint on `(user_id, name)` or unique partial index `WHERE is_archived = false`.

---

### IV-H2. `profit_percentage` + `profit_value` stored on the row but never read by any report
**Where:** Written in `createInventoryItem:111-112` and `updateInventoryItem:259-260`. Read by no report (only `lib/db/inventory-pricing.ts:111` reads `profit_percentage` via a helper that nobody calls in reports).

These columns are computed at item-creation time from `cash_price - cost_price`. They go stale the moment cost_price changes (which it never does — see IV-C2 — but should). Reports compute profit on the fly from invoice lines, so these stored values are pure overhead.

**Fix:** Either start using them (faster reads) or drop the columns + the calculation logic. Currently both writing-and-not-reading is the worst of both worlds.

---

### IV-H3. Stock-level reports cap silently at 20 rows
**Where:** [reports/page.tsx:130](app/(app)/stock-management/reports/page.tsx#L130) — `stockLevels.slice(0, 20).map(...)`.

The query in `getStockLevels()` returns ALL items, but the page only renders the first 20. No "Show more" link, no pagination, no indicator that data is being truncated. A store with 100+ items sees only 20 in the report.

**Fix:** Either paginate, or remove the cap and render all (with virtualization if needed for very long lists).

---

### IV-H4. Inventory dialog allows clearing all multi-tier prices
**Where:** `inventory-dialog.tsx` UI + server validation in [inventory/actions.ts:148-172](app/(app)/stock-management/inventory/actions.ts#L148-L172).

Server requires `cost_price`, `cash_price`, `credit_price`, `supplier_price` all > 0. Good. BUT — if the user is editing an item that was created BEFORE the multi-tier pricing was added, the legacy `selling_price` column may have a value but `cash_price`/`credit_price`/`supplier_price` are all 0. Loading the edit dialog for such an item shows zeros in the price fields. Saving without filling them returns the "must be > 0" error. **The dialog should backfill from `selling_price` when the multi-tier fields are empty.**

**Fix:** On edit, when cash/credit/supplier are NULL/0, populate from `selling_price` as a one-time backfill.

---

## 🟠 HIGH — PURCHASE

### IV-H5. No `deletePurchaseDraft` path / no Trash button on Draft purchases
**Where:** UI in `purchase-management/purchases/purchases-page-client.tsx` (not re-read; behavior inferred from absence of action).

After IV-C3 fix lands, Draft purchases will be parked correctly. But until then, a Draft can be abandoned and the only way to clean it is manual SQL. Mirror of R2-C2 deletePOSDraft — add `deletePurchaseDraft` action + Trash button on Draft rows.

**Fix:** Same pattern as `deletePOSDraft`: query stock_movements for the invoice, reverse the net IN, delete refunds/lines/invoice, recompute vendor balance.

---

### IV-H6. `deletePurchase` allows deleting a Partially Paid invoice
**Where:** [purchases/actions.ts:420-422](app/(app)/purchases/actions.ts#L420-L422).

```ts
if (purchase.status === "Paid") {
  return { error: "Paid purchase bills cannot be deleted. Cancel it first if needed." }
}
```

Only `"Paid"` is blocked. `"Partially Paid"` is allowed — but money has already been sent to the vendor! Deleting a partially-paid purchase orphans the `purchase_payments` row (the parent invoice is gone), and the vendor's outstanding balance silently flips.

**Fix:** Block delete on any status where payments exist. Use a query like `SELECT 1 FROM purchase_payments WHERE purchase_invoice_id = X LIMIT 1` and block if any.

---

### IV-H7. `createPurchase` doesn't validate negative quantities or prices
**Where:** [purchases/actions.ts:24-44](app/(app)/purchases/actions.ts#L24-L44).

The function checks `partyId` exists, items array non-empty, item ownership. But each item's `quantity` and `unitPrice` are passed straight through. A crafted payload with `quantity: -50` would decrement stock instead of increment, and `unitPrice: -100` would deduct from the vendor balance.

**Fix:** Add per-item guards: `if (!Number.isFinite(item.quantity) || item.quantity <= 0) return error`. Same for unitPrice.

---

### IV-H8. `updatePurchase` skips party-ownership check (mirror of RF-M3)
**Where:** [purchases/actions.ts:213-217](app/(app)/purchases/actions.ts#L213-L217).

`createPurchase` calls `verifyPartyOwnership`. `updatePurchase` doesn't. A crafted update could swap the vendor on an existing purchase to another user's party_id.

**Fix:** Add `verifyPartyOwnership` call to `updatePurchase` (same as POS bug we already fixed in the sales side).

---

### IV-H9. `createPurchasePayment` doesn't validate purchase status
**Where:** [purchases/actions.ts:523-577](app/(app)/purchases/actions.ts#L523-L577).

A payment can be created against a Cancelled or Draft purchase. Mirror of RF-H2 in returns (already fixed). Same fix: gate on `status IN ('Paid', 'Partially Paid', 'Pending', 'Credit')` — i.e. not Cancelled/Draft.

---

### IV-H10. No printable purchase invoice
**Where:** `getPurchaseForPDF` exists ([purchases/actions.ts:115](app/(app)/purchases/actions.ts#L115)) but there's no A4 / NCR print template for purchases. The function returns data; nothing renders it.

**Impact:** Vendor invoices can't be printed. Store has no paper record to file. Vendor disputes have no shareable artifact.

**Fix:** Mirror the sales-invoice print template — `components/purchases/print-a4-purchase.ts`, A4 only initially (vendor receipts don't need thermal).

---

## 🟡 MEDIUM — INVENTORY

### IV-M1. `deleteInventoryItem` only checks `sales_invoice_lines`
**Where:** [inventory/actions.ts:387-425](app/(app)/stock-management/inventory/actions.ts#L387-L425).

The function checks if the item is referenced by any sales line — if yes, soft-archive; if no, hard-delete. But it doesn't check:
- `purchase_invoice_lines` (item referenced by a purchase)
- `return_lines` (item referenced by a return)
- `stock_movements` (audit trail)

If the item exists only in a purchase (not yet sold), `count` is 0, and the hard delete fires. The FK on `purchase_invoice_lines.item_id` then throws a constraint violation OR (if CASCADE is set) the purchase line is deleted, orphaning the purchase invoice.

**Fix:** Check all four tables before hard-delete. Soft-archive if any reference exists.

---

### IV-M2. Pack/CTN changes are silent (no audit row)
**Where:** [inventory/actions.ts:262-263](app/(app)/stock-management/inventory/actions.ts#L262-L263) — `updateInventoryItem` writes `pack_unit_id` and `pack_size` without any audit.

Changing pack_size from 24 to 12 retroactively reinterprets historical stock movements: "we received 100 cartons" suddenly means 1200 base units instead of 2400. No record of when the change happened.

**Fix:** Either record pack changes in `stock_movements` as a special movement_type, or version pack_size with effective dates.

---

### IV-M3. Stock adjustments lack reason field
**Where:** `updateInventoryItem` records movements with hardcoded note `"Stock adjusted from X to Y"` ([line 351](app/(app)/stock-management/inventory/actions.ts#L351)). No way to capture WHY (damage, expiry, theft, count correction).

**Impact:** Stock reports show movements without business context. Audits later can't distinguish a stock-take correction from a theft loss.

**Fix:** Add a `reason` field to the inventory dialog when stock changes — feed to the `notes` column.

---

### IV-M4. `cost_price` field allows decrease to less than weighted-average
**Where:** `updateInventoryItem` accepts any positive cost_price.

If cost has been weighted-averaging at PKR 100 from past purchases, the user can manually set cost_price to PKR 50, making all subsequent profit calcs over-inflated. No guard.

(This is moot until IV-C2 is fixed and cost_price actually gets updated programmatically. Once weighted-average is in place, manual edits should be flagged.)

---

## 🟡 MEDIUM — PURCHASE

### IV-M5. Purchase listing has no status filter
**Where:** `getPurchases` in [purchases/actions.ts:472-520](app/(app)/purchases/actions.ts#L472).

Returns all purchases regardless of status. Drafts/Cancelled mixed with finalized. The UI list shows them all without a filter chip.

**Fix:** Add status filter chips on the page (like sales returns page).

---

### IV-M6. Purchase invoice number is UUID prefix
**Where:** `purchase_number` not in schema; the UI synthesizes it as `id.substring(0, 8).toUpperCase()` ([purchases/actions.ts:511](app/(app)/purchases/actions.ts#L511)).

Pakistani business convention is sequential numbering (PUR-2026-000001). Same finding as RF-L10 / M10 on returns. Business decision.

---

### IV-M7. Negative-amount guard missing in `createPurchasePayment`
**Where:** [purchases/actions.ts:532](app/(app)/purchases/actions.ts#L532).

```ts
if (!payload.purchaseInvoiceId || !payload.amount || payload.amount <= 0) {
  return { error: "Purchase invoice ID and valid amount are required" }
}
```

Already covers `<= 0`. ✓ But doesn't check `Number.isFinite()` — NaN slips through `!amount` check as falsy → rejected. Actually safe by accident. Flag for completeness.

---

### IV-M8. Purchase payment doesn't validate `method` value
**Where:** [purchases/actions.ts:548-554](app/(app)/purchases/actions.ts#L548-L554).

The `method` field is inserted raw into the DB. No enum validation that it's one of `Cash | Card | Bank Transfer | JazzCash | EasyPaisa | Other`. A crafted payload could insert arbitrary strings.

**Fix:** Validate against an allowlist (same shape as the POS payment method type).

---

### IV-M9. Purchase listing leaks vendor info if cross-tenant filter is missing
**Where:** TBD — needs grep verification of `purchase-management/purchases/page.tsx`.

(See IV-C5 above. If admin-client queries lack user_id filters, vendor data leaks.)

---

### IV-M10. No "Expected delivery date" or "Date received" distinction
**Where:** Schema only has `created_at`.

A purchase placed today might not arrive for 2 weeks. Stock shouldn't IN until physical receipt. Currently stock IN happens at PO creation. Reorder/restock decisions get wrong signals.

(Larger design decision — flag, don't fix without user input.)

---

## ⚪ LOW — INVENTORY + PURCHASE

### IV-L1. Mojibake `â€"` in code
Already swept earlier; spot-check shows no fresh ones in inventory/purchase paths.

### IV-L2. `purchases/actions.ts:46` — `taxRate || 18` should be `?? 18`
Same finding as IV-C4. Listed twice intentionally; one-line fix per call site.

### IV-L3. `getPurchases` only returns `total + status` per row — no party name for direct UI use
The query DOES join parties ([line 484](app/(app)/purchases/actions.ts#L484)). Fine. Just noting that the page-side mapping ([line 506](app/(app)/purchases/actions.ts#L506)) does the unwrap correctly via `pickFirst`.

### IV-L4. `archived` items still show in dropdowns
Inventory pickers (POS, return dialog, purchase dialog) likely filter by stock > 0 but not by `is_archived`. Spot-check needed.

### IV-L5. `restoreInventoryItem` has no UI affordance
Action exists ([inventory/actions.ts:364](app/(app)/stock-management/inventory/actions.ts#L364)) but there's no "Show archived items" toggle on the inventory page. Once archived, items disappear with no UI to bring them back.

### IV-L6. No bulk operations
Can't import inventory from CSV. Can't bulk-update prices. Can't bulk-archive. Each item edited individually.

### IV-L7. No "Supplier item code" linkage on inventory
A vendor's SKU for the same product is different. No place to track this — receiving inventory from vendor invoices requires manual matching.

### IV-L8. Cost-price history not retained
When IV-C2 is fixed and cost_price starts updating, the historical cost is lost. A `cost_price_history` table (item_id, cost_price, effective_at) would let later reports show "cost over time" charts.

### IV-L9. No purchase reorder suggestion
Low-stock items show on the dashboard ([lowStockItems](app/(app)/dashboard/page.tsx#L273)) but there's no "Create Purchase Order" CTA. Manual flow only.

### IV-L10. No vendor lead-time tracking
For a future "Smart Reorder" feature, we'd need to record purchase date vs received date per vendor + item. Currently not captured.

---

## Cross-cutting themes

1. **`selling_price` / `unit_price` / `cash_price` ambiguity** is the root of IV-C0. The codebase has three column names for "the price a customer pays" depending on which era it was written. A schema audit + cleanup would prevent recurring bugs.

2. **Cost-basis updates are missing entirely (IV-C2).** Single biggest accounting bug. Affects gross profit, inventory value, and every downstream report.

3. **Draft state semantics aren't consistent.** POS sales were fixed in R2-C1. Purchases still have the same bug (IV-C3). Drafts on sale returns are blocked (RF-C0b). Drafts on inventory items don't exist (no concept). Need a coherent policy.

4. **Soft-archive vs hard-delete** is implemented unevenly. Inventory does soft-archive (IV-M1 — incomplete). Purchases hard-delete (IV-H6 — incomplete check). Returns don't have either (RF-H1 already fixed). Worth a uniform "deletable when…" matrix.

5. **Reports vs Inventory page** disagree (IV-C1). The two should hit a single shared query function.

---

## Recommended triage order

If implementing fixes one priority at a time:

1. **IV-C0** — fix the Total Inventory Value bug. 3 column-name changes in `reports/actions.ts`. **Trivial. Visible win.**
2. **IV-C1** — add `is_archived: false` filter to reports queries. One line each.
3. **IV-C4** — `|| 18` → `?? 18` in two places. One-character fix.
4. **IV-C5** — verify cross-tenant filters on purchase-management pages (mirror of RF-C1).
5. **IV-C3** — Draft purchase stock-decrement gate (mirror of R2-C1). Medium effort.
6. **IV-H5** — `deletePurchaseDraft` action + Trash button (mirror of R2-C2).
7. **IV-C2** — **THE BIG ONE.** Weighted-average cost_price update on every purchase. Largest effort + biggest accounting impact. Affects gross profit, inventory value, every report.
8. **IV-H6, IV-H7, IV-H8, IV-H9** — purchase hardening (delete-block on partial-paid, negative guards, ownership check, status validation).
9. **IV-H1, IV-H2, IV-H3, IV-H4** — inventory polish (unique name, drop dead columns, paginate, backfill legacy items).
10. **IV-H10** — printable purchase invoice template.
11. **IV-M-series + IV-L-series** — cleanup and feature polish.

Per workflow: **none of these are implemented yet.** Bata do kahan se shuru karein.

**My recommendation:** start with **IV-C0** (one-line fix to make Total Inventory Value show a real number — instant visual confirmation), then **IV-C4 + IV-C5** (5 minutes, mirror of fixes we already shipped on returns), then a sit-down for **IV-C2** (the cost-price update) which is the biggest fix and needs careful migration thinking.
