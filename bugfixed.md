# Bugs Fixed — Resolution Log

This file tracks bugs that have been investigated and resolved.
Format: each entry contains the bug description, root cause, and the fix applied.

---

## Resolved Bugs

### [RESOLVED] Inventory + Purchase — second batch (IV-H3/H4 + IV-M1/M8 + IV-L4 polish)

**Reported:** 2026-05-22
**Resolved:** 2026-05-22
**Priority:** HIGH — operational gaps surfaced after the first inventory/purchase batch

**Symptoms:**
- Inventory Reports' "Stock Levels" table silently rendered only the first 20 items even when more existed (no pagination, no "show more").
- Legacy items (created before multi-tier pricing) showed `cash_price`/`credit_price`/`supplier_price` all empty in the edit dialog, even though `selling_price` had a value — server-side validation rejected save until each tier was filled manually.
- Archived items leaked into POS sale dropdown, purchase create/edit dropdowns — sellable/buyable even after archival.
- `deleteInventoryItem` only checked `sales_invoice_lines` for references — an item used only in a purchase or return could be hard-deleted, tripping FK violation.
- `createPurchasePayment` accepted any string as `method` — `"Bitcoin"`, typos, anything.

**Fixes:**

#### IV-H3 — Reports table no longer caps at 20 rows
- **File:** `app/(app)/stock-management/reports/page.tsx`
- Removed the silent `slice(0, 20)`. Reports render all items. Added a count indicator `(N items)` to the section title so the user knows what's being shown. Export buttons already give an out for very long lists.

#### IV-M1 — `deleteInventoryItem` checks all referencing tables
- **File:** `app/(app)/stock-management/inventory/actions.ts`
- Now runs three parallel count queries (`sales_invoice_lines`, `purchase_invoice_lines`, `return_lines`) before deciding hard-delete vs soft-archive. Any reference in ANY of those tables → soft-archive. Previous check only looked at sales; an item used only in a purchase or return would hard-delete and break the FK.

#### IV-H4 — Edit dialog backfills legacy price tiers from `selling_price`
- **File:** `app/(app)/stock-management/inventory/inventory-dialog.tsx`
- When opening the edit dialog for an item where `cash_price`/`credit_price`/`supplier_price` are 0/null but `selling_price` has a value, all three multi-tier fields now pre-fill from `selling_price` (a reasonable starting point — user can adjust upward). Previously only `cash_price` had this fallback; the other two stayed empty and validation rejected save with "must be > 0", leaving legacy items un-editable.

#### IV-L4 — Archived items filtered from POS + Purchase dropdowns
- **Files:** `app/(app)/pos/page.tsx`, `app/(app)/purchase-management/create/page.tsx`, `app/(app)/purchase-management/edit/[id]/page.tsx`
- All three inventory dropdowns now include `.eq("is_archived", false)`. Archived items no longer appear as sellable/buyable. The edit dialog still pre-fills the original line item's snapshot, so historical purchases referencing archived items still load — but the user can't pick the archived item for a new row.

#### IV-M8 — Purchase payment method allowlist
- **File:** `app/(app)/purchases/actions.ts` — `createPurchasePayment`
- Method now validated against `["Cash", "Card", "Bank Transfer", "JazzCash", "EasyPaisa", "Other"]`. Unknown methods are rejected with explicit error listing the allowed values. Previously any string was accepted.

**Files Changed:**
- `app/(app)/stock-management/reports/page.tsx` — IV-H3
- `app/(app)/stock-management/inventory/actions.ts` — IV-M1
- `app/(app)/stock-management/inventory/inventory-dialog.tsx` — IV-H4
- `app/(app)/pos/page.tsx` — IV-L4
- `app/(app)/purchase-management/create/page.tsx` — IV-L4
- `app/(app)/purchase-management/edit/[id]/page.tsx` — IV-L4
- `app/(app)/purchases/actions.ts` — IV-M8
- `.gitignore` — Playwright MCP capture dir + ad-hoc verification screenshots

**Type-check:** Clean on changed files (pre-existing `returns/purchases/page.tsx:68` cast error unchanged). No DB migrations. No RLS changes.

**Verification:**
1. `/stock-management/reports` — table now shows ALL items (not just first 20). Section title shows `(N items)`.
2. `/stock-management/inventory` — edit a legacy item (one with `selling_price` set but other prices 0). Dialog now pre-fills all three price tiers from `selling_price`. Save works.
3. POS dropdown / purchase dropdown — archived items no longer appear.
4. Try to delete an inventory item that was used in a purchase but not a sale — now correctly soft-archives instead of FK violation.
5. Try `createPurchasePayment` with `method: "Bitcoin"` via direct API → rejected with allowlist error.

**Still pending from analysis:**
- IV-H1: unique item name per user (schema constraint, needs decision)
- IV-H2: drop dead `profit_value`/`profit_percentage` columns (schema cleanup)
- IV-H10: native HTML print template for purchases (PDF download already covers practical need)
- IV-L5: "Show archived" toggle + Restore button on inventory page
- IV-M-other: pack/CTN audit row, stock adjustment reason field, expected-delivery distinction (mostly schema/design decisions)

---

### [RESOLVED] Inventory + Purchase — first batch (IV-C0/C1/C3/C4 critical + IV-C2 cost-basis + IV-H6/H7/H8/H9 hardening)

**Reported:** 2026-05-20
**Resolved:** 2026-05-20
**Priority:** CRITICAL — Total Inventory Value showing PKR 0.00 + cost basis never updating

**Symptoms:**
- "Total Inventory Value" KPI on `/stock-management/reports` permanently showed PKR 0.00 despite items with stock.
- Gross profit numbers drifted as supplier prices changed — cost basis was frozen at item-creation time.
- Draft purchases inflated stock + vendor payable immediately.
- `taxRate: 0` on direct API calls silently became 18%.
- Partially-paid purchases could be deleted, orphaning payment rows.

**Root Causes + Fixes:**

#### IV-C0 (CRITICAL) — Reports read non-populated `selling_price` column
- **File:** `app/(app)/stock-management/reports/actions.ts`
- **Cause:** `getStockLevels()` and `getInventoryValueAnalysis()` computed `value = stock × selling_price`. The schema has `selling_price` as a legacy column but `createInventoryItem` writes only `cost_price`/`cash_price`/`credit_price`/`supplier_price` — so `selling_price` stays at its DB default (0). Every item evaluated to 0.
- **Fix:** Switched both functions to use `cost_price` (the accounting standard for inventory valuation). Removed the `selling_price` + `unit_price` fallback chain.

#### IV-C1 (HIGH) — Archived items polluted report counts
- **File:** `app/(app)/stock-management/reports/actions.ts`
- **Cause:** Reports didn't filter `is_archived = false`. Archived items (typically stock=0) showed up in "Out of Stock" counts, mismatching the main inventory page.
- **Fix:** Added `.eq("is_archived", false)` to both report queries.

#### IV-C2 (CRITICAL — biggest accounting bug) — Cost price never updated on purchase
- **File:** `app/(app)/purchases/actions.ts` — `createPurchase`
- **Cause:** Purchases incremented stock + recorded movements + adjusted vendor balance, but **never updated `inventory_items.cost_price`** based on the actual purchase price. The cost basis stayed at whatever was entered at item creation — possibly years ago, possibly from a different supplier. Every gross-profit calculation used this stale cost, inflating margins forever for stores buying at rising prices.
- **Fix:** Weighted-average cost update on every non-Draft purchase line:
  ```
  new_cost = (current_stock × current_cost + bought_qty × buy_price)
             / (current_stock + bought_qty)
  ```
  Edge cases: empty stock or zero current_cost → take buy_price directly. Rounded to 4 decimals to bound float drift. Read happens BEFORE the stock increment so the denominator is the pre-purchase figure. Documented limitation: not transactional, so multi-cashier concurrent purchases of the same item can race (single-tenant stores are fine).

#### IV-C3 (CRITICAL) — Draft purchases incremented stock + payable
- **File:** `app/(app)/purchases/actions.ts` — `createPurchase`, `updatePurchase`, `deletePurchase`
- **Cause:** Same R2-C1 bug as POS sales had — Draft purchases (parked POs) immediately incremented stock and added to vendor balance, even though goods hadn't arrived. Abandoning a Draft inflated inventory forever.
- **Fix:** Gated the stock-increment block on `status !== "Draft"`. `updatePurchase` now uses an audit-trail-driven reversal (reads `stock_movements` for the invoice, computes net IN, emits matching OUTs) so legacy pre-fix Drafts get cleanly unwound on edit/delete. Mirror of `updatePOSSale` post-R2-C1.

#### IV-C4 (CRITICAL) — `|| 18` short-circuited explicit 0
- **File:** `app/(app)/purchases/actions.ts` — both `createPurchase:46` and `updatePurchase:274`
- **Cause:** `const taxRate = payload.taxRate || 18`. The OR-fallback treated `taxRate: 0` as falsy and substituted 18. Same RF-C3 bug we fixed in returns.
- **Fix:** Both call sites switched to `?? 18` so only `undefined` falls back.

#### IV-H6 (HIGH) — Partially-paid purchase could be deleted
- **File:** `app/(app)/purchases/actions.ts` — `deletePurchase`
- **Cause:** Only `status === "Paid"` blocked delete. `Partially Paid` was allowed — but `purchase_payments` rows referenced the parent invoice, so deletion either threw a FK violation or orphaned the payment.
- **Fix:** Added a `COUNT(*) FROM purchase_payments` check. Any purchase with at least one payment row is blocked from delete; user must remove the payments first or mark Cancelled.

#### IV-H7 (HIGH) — No negative/NaN guards on purchase items
- **File:** `app/(app)/purchases/actions.ts` — `createPurchase`, `updatePurchase`, `createPurchasePayment`
- **Cause:** Quantity and unit_price were passed through to the DB without validation. A crafted payload with `quantity: -50` would decrement stock; `unitPrice: -100` would credit the vendor.
- **Fix:** Per-item guards: `Number.isFinite(item.quantity) && item.quantity > 0`, same for unitPrice (non-negative). `createPurchasePayment` amount also tightened to require `Number.isFinite()` AND positive.

#### IV-H8 (HIGH) — `updatePurchase` had no party-ownership check
- **File:** `app/(app)/purchases/actions.ts` — `updatePurchase`
- **Cause:** Re-audit of my own analysis: the check was actually present in the original code. Confirmed and preserved with explicit comment.
- **Fix:** No behavioral change; just clearer code comments explaining the security intent.

#### IV-H9 (HIGH) — Refund-on-Cancelled-purchase allowed for payments
- **File:** `app/(app)/purchases/actions.ts` — `createPurchasePayment`
- **Cause:** Payment could be attached to a Draft or Cancelled purchase. Mirror of RF-H2 in returns (already fixed there).
- **Fix:** Status check rejects payments against Draft/Cancelled with explicit error message.

#### IV-C5 (verified safe)
- All purchase-management pages use server actions that already filter by `user_id`. Direct queries on `create/page.tsx` also include the filter. No cross-tenant leak.

**Files Changed:**
- `app/(app)/stock-management/reports/actions.ts` — IV-C0, IV-C1
- `app/(app)/purchases/actions.ts` — IV-C2, IV-C3, IV-C4, IV-H6, IV-H7, IV-H9
- `bugfixing/INVENTORY-PURCHASE-ANALYSIS.md` — full diagnostic doc

**Type-check:** Clean. RLS untouched. No DB migrations required.

**Verification:**
1. `/stock-management/reports` — Total Inventory Value should now show a real number (sum of stock × cost_price across active items).
2. Create a Draft purchase — verify inventory stock is NOT incremented + vendor balance unchanged.
3. Finalise the Draft (set status away from Draft) — stock increments + cost_price weighted-averages with existing basis.
4. Try to delete a Partially Paid purchase — should be blocked with clear error.
5. Submit a purchase with `taxRate: 0` via direct API call — total should be subtotal (no 18% tax added).

**Still pending from analysis (next batch):**
- IV-H1: unique item name per user (schema change)
- IV-H2: drop dead `profit_value` / `profit_percentage` columns
- IV-H3: paginate stock-levels report (currently caps at 20)
- IV-H4: legacy `selling_price` backfill on edit dialog
- IV-H5: dedicated Draft trash icon (existing DeletePurchaseButton now handles it)
- IV-H10: printable purchase invoice template
- IV-M / IV-L: hardening + cosmetics

---

### [RESOLVED] Sale Invoice — Round 2 batch (R2-C1 through R2-L8, 16 issues)

**Reported:** 2026-05-19
**Resolved:** 2026-05-19
**Priority:** Mixed — 2 Critical, 6 High, 7 Medium, 4 Low (rolled into same edits)

**Full breakdown:** see `bugfixing/ROUND2-FIXES.md` for per-issue explanations. Summary list:

**Critical:**
- **R2-C1** Drafts now hold stock until completion (no longer decrement on Draft save). `createPOSSale` / `updatePOSSale` gate decrement on `status !== "Draft"`. Update path uses `stock_movements` audit table to compute net OUT, so pre-fix Drafts still get correctly restored on edit/delete.
- **R2-C2** New `deletePOSDraft` server action + Trash button in `pos-sales-list.tsx`. Restricted to Draft status. Audit-trail-based stock restore so it's correct for both old and new Drafts.

**High:**
- **R2-H1** NCR thermal print now shows per-line discount as italic sub-row below each discounted item. Rate column shows original list price when a discount exists.
- **R2-H2** A4 print added Cash Paid + Balance Due rows in totals box.
- **R2-H3** A4 Draft prints now show a black `DRAFT — NOT A SALES RECEIPT` banner above items.
- **R2-H4** Item name cell wraps instead of silently truncating long SKUs.
- **R2-H5** `applyGlobalDiscount` rounding-drift fix — drift is assigned to the largest line so sum exactly equals the typed bill discount.
- **R2-H6** A4 "Total Before Discount" label now dynamic — falls back to "Subtotal" when no line has persisted `original_unit_price`.

**Medium:**
- **R2-M1** `bugfixing/backfill-sale-invoice-data.sql` — two optional one-time backfills (legacy `original_unit_price` + Draft-held stock restore).
- **R2-M2** Negative-value guards added to `createPOSSale` and `updatePOSSale` payloads (quantity > 0, unitPrice ≥ 0, payment ≥ 0, discount ≥ 0).
- **R2-M3** Form `useEffect` clamps `payingNow` whenever `computed.total` drops below it.
- **R2-M4** Server now rejects `discount > subtotal + tax` with an explicit error instead of silently clamping total to 0.
- **R2-M5** Both A4 and NCR templates render per-payment history when there's more than one payment row.
- **R2-M6** Walk-in fake phone `"000-000-0000"` filtered out of both print templates via shared `displayableCustomerPhone` helper.
- **R2-M7** Bill-discount PKR input step changed from `1` to `0.01` to align with % input precision.

**Low:**
- **R2-L1** Friendly status labels on A4 footer (`Paid` → "Cash Sale", `Credit` → "Credit Sale (Udhaar)", etc.).
- **R2-L2** A4 footer now shows `Printed: <date> <time>` so reprints are distinguishable.
- **R2-L6** `numberToWords` rewritten to handle paise — words now match the numeric Net Amount for decimal totals.
- **R2-L8** Sales list View dialog now shows a Disc column when any line has a discount; Price column shows original list price.

**Side-effect Round-1 fix caught while in the area:**
- **H10 (Round 1)** NCR thermal phantom "Cash Paid" line for Paid invoices with deleted payment rows. Fixed: `cashPaid` is now strictly `sum(data.payments)` with no fallback to `data.total`. Also `payMethod` fallback shows `"—"` (Draft) / `"Pending"` (Credit) instead of misleading `"Cash"`.

**Files Changed:**
- `app/(app)/pos/actions.ts`
- `components/pos-new-sale-form.tsx`
- `components/pos-sales-list.tsx`
- `components/pos/print-a4-invoice.ts`
- `components/pos/print-standard-invoice.ts`
- `bugfixing/backfill-sale-invoice-data.sql` (NEW)
- `bugfixing/ROUND2-FIXES.md` (NEW)

**TypeScript:** `npx tsc --noEmit` shows no new errors in any modified file. Pre-existing errors in unrelated files are unchanged.

**Verification:** 12-step smoke-test checklist documented at the bottom of `bugfixing/ROUND2-FIXES.md`.

**Deferred (not in this round, need product decisions):**
NTN/CNIC/GST on prints (R2-L3), custom terms (R2-L4), logo (R2-L5), offline barcode font (R2-L7), sequential invoice numbers (R2-L9), REPRINT stamp (R2-L10), and the broader POS-vs-manual semantic alignment from Round-1 C4/H1/H2/H6/H7/H8.

---

### [RESOLVED] Sale Invoice — Draft edit silently wiped bill discount + per-line discounts (C1 + C2)

**Reported:** 2026-05-19
**Resolved:** 2026-05-19
**Priority:** CRITICAL — wrong money on every edited Draft

**Symptom:**
Any Draft sale that had a bill-level discount, per-line discounts, or both would lose the discount info the moment the cashier reopened it via "Edit Draft" and re-saved (whether as Draft, Credit, or Paid). The printed invoice after the edit would show Disc% / Disc Amt as 0 even though the cashier had originally entered discounts. Worse, `sales_invoices.total` was recomputed from `subtotal + tax` without subtracting the bill discount, so the customer would be over-billed by exactly the discount amount.

**Root Causes & Fixes:**

#### Bug A (CRITICAL) — `updatePOSSale` had no `discount` parameter
- **File:** `app/(app)/pos/actions.ts`
- **Cause:** The function signature accepted `partyId, items, taxRate, status, payment` but no `discount`. The header update wrote only `subtotal, tax, total, status` — never touching the `discount` column. Total math was `subtotal + tax` (bill rebate forgotten).
- **Fix Applied:** Added `discount?: number` to the payload. Header update now includes the column. Total math is `Math.max(0, subtotal + tax - discount)`. The Credit branch's `payment >= total` check uses the fixed total.

#### Bug B (CRITICAL) — `getPOSSaleForEdit` did not load discount fields
- **File:** `app/(app)/pos/actions.ts`
- **Cause:** Header select pulled `id, party_id, subtotal, tax, total, status` — no `discount`. Lines select pulled `item_id, quantity, unit_price` — no `original_unit_price`, no `discount_amount`. The form initialized every cart line with `discount: 0` and the bill-discount field stayed at 0 even when the draft had non-zero values persisted.
- **Fix Applied:** Header select now includes `discount`. Lines select now includes `original_unit_price` and `discount_amount`. Return shape carries `discount` at the top level and `{ originalUnitPrice, discountAmount }` per line. For drafts predating the migration both line fields come back null/0 — same behaviour as before, no regression.

#### Wiring through the form
- **Files:** `app/(app)/pos/page.tsx`, `components/pos-new-sale-form.tsx`
- The `initialSale` type now carries `discount` and the extended item shape.
- `useState<CartItem[]>(...)` initialization maps `discountAmount → line.discount`, and uses the persisted list price (`originalUnitPrice` falling back to `unitPrice`) so the cart shows what was originally typed.
- `useState(discountAmount)` is seeded from `initialSale?.discount ?? 0`.
- All three update branches in `handleCompleteSale` (Paid / Credit / Draft) now pass `discount: computed.discount` to `updatePOSSale`.

**Will this recover previously corrupted drafts?** No. Drafts that were already edit-round-tripped before this fix had their discount columns overwritten with zeros in the DB; that data is gone. Drafts that have not been edited since the line-discount migration still have their `original_unit_price` and `discount_amount` intact and will load correctly. Going forward, every edit preserves the discount state.

**Files Changed:**
- `app/(app)/pos/actions.ts` — `updatePOSSale` signature + math, `getPOSSaleForEdit` selects + return shape, `getInvoiceForPrint` cashier fallback mojibake (see C5 below)
- `app/(app)/pos/page.tsx` — `initialSale` type
- `components/pos-new-sale-form.tsx` — prop type, state init, update payload

**Verification:**
1. Create a sale with bill discount (say 200 PKR) and a per-line discount (say 10% on one item). Save as Draft. Reopen via "Edit Draft" → both discounts should be visible in the form. Complete as Sale. Print the invoice → Disc% and Less Bill Discount lines should match what was originally entered.
2. Edit an existing pre-fix Draft that had discounts: discounts will load as 0 (already wiped in DB). New edits after the fix preserve.

---

### [RESOLVED] Sale Invoice — Cashier fallback mojibake on printed receipts (C5)

**Reported:** 2026-05-19
**Resolved:** 2026-05-19
**Priority:** CRITICAL — visible on printed customer receipts

**Symptom:**
When neither `user.name` nor `user.email` resolved (rare but possible), the printed invoice's "User:" / cashier field showed the garbage string `â€"` instead of a clean em-dash.

**Root Cause:**
The fallback literal in `getInvoiceForPrint` was the UTF-8 bytes of `—` (em-dash) decoded as Latin-1 — left over from a paste during an earlier edit. The string passed straight through to the HTML print template and rendered as-is.

**Fix Applied:**
- **File:** `app/(app)/pos/actions.ts`
- Replaced the mojibake literal with a clean `"—"` (Unicode em-dash, U+2014).

**Files Changed:**
- `app/(app)/pos/actions.ts`

---

### [RESOLVED] Dashboard — Total Sales & Gross Profit showing 85% (incorrect)

**Reported:** 2026-05-10
**Resolved:** 2026-05-10
**Priority:** FIRST PRIORITY

**Symptom:**
- Total Sales (This Month): PKR 27,164,880.00
- Gross Profit: PKR 20,229,840.00 (85%) — unrealistically high

**Root Causes & Fixes:**

#### Bug A (CRITICAL) — `updatePOSSale` did not save `cost_price`
- **File:** `app/(app)/pos/actions.ts`
- **Cause:** When a POS draft was completed, line items were re-inserted without `cost_price`, leaving NULL in the database. Dashboard treated NULL as 0, computing 100% profit on those lines.
- **Fix Applied:** Added `cost_price` fetch from `inventory_items` and included it in line item insert. Mirrors the logic in `createPOSSale`.

#### Bug B (HIGH) — Total Sales card and Gross Profit % used different bases
- **Files:** `app/(app)/dashboard/page.tsx`, `components/dashboard.tsx`
- **Cause:** Total Sales card summed `inv.total` (subtotal + tax). Gross Profit % denominator used line-item subtotal sum (no tax). The 85% was being calculated against a different number than the displayed Total Sales.
- **Fix Applied:** Server now computes `totalSales` from the same line-item base used for gross profit (with returns subtracted). Dashboard component prefers this server value, falling back to `invoices.reduce()` only for the mock-data path.

#### Bug C (HIGH) — Dashboard query did not filter by invoice status
- **File:** `app/(app)/dashboard/page.tsx`
- **Cause:** Query fetched ALL statuses including `Cancelled` and `Draft`. These should not contribute to realized sales or profit.
- **Fix Applied:** Added `.in("status", ["Paid", "Pending", "Credit", "Partial"])` filter on the sales_invoices query.

#### Bug D (MEDIUM) — Returns subtracted from gross profit denominator but NOT from Total Sales card
- **Files:** `app/(app)/dashboard/page.tsx`, `components/dashboard.tsx`
- **Cause:** Returns reduced `totalSalesForPeriod` (gross profit denominator) but `totalSales` card recomputed from raw `invoices.total`, ignoring returns. Inflated the ratio.
- **Fix Applied:** Single `totalSales` value now flows from server to client, with returns consistently subtracted.

#### Bug E (MEDIUM) — Items with `cost_price = NULL` produced 100% profit
- **File:** `app/(app)/dashboard/page.tsx`
- **Cause:** `Number(line.cost_price ?? 0)` treated missing cost as 0, inflating profit on legacy or quick-created items.
- **Fix Applied:** Changed fallback from `0` to `selling` price (assume break-even / 0% margin when cost is unknown). Both the main loop and the returns loop now use this conservative fallback. Also fixed the returns `costMap` to preserve NULL distinctly from a real 0.

**Data Backfill Required:**
A SQL backfill script was created at `bugfixing/backfill-cost-price.sql`. It safely fills `cost_price` on existing `sales_invoice_lines` rows where it is NULL, by reading from `inventory_items.cost_price`. The script:
- Includes preview queries (read-only) to inspect impact before applying
- The actual UPDATE statement is commented out by default — uncomment to apply
- Does not delete or overwrite any existing data
- Is safe to re-run

**Files Changed:**
- `app/(app)/pos/actions.ts` — added `cost_price` to `updatePOSSale` line items
- `app/(app)/dashboard/page.tsx` — status filter, NULL cost fallback, totalSales export
- `components/dashboard.tsx` — accept `totalSales` prop, prefer server value

**Verification:**
After fix + backfill, the gross profit % should reflect realistic margins. If it still shows very low %, run `bugfixing/diagnose-margins.sql` to identify items selling at-cost or at a loss.

**Display precision update (2026-05-10):**
After the fix and backfill, the dashboard showed `0%` on a 0.26% real margin (52,800 / 20,206,800). `Math.round(0.26)` was rounding to 0. Updated `grossProfitPercent` to keep 2 decimal places so thin margins remain visible. Diagnostic SQL `bugfixing/diagnose-margins.sql` was added to inspect per-item margins, at-cost sales, and selling-at-loss cases — useful when actual data shows lower-than-expected profit.

---

### [RESOLVED] POS — Decouple Rate selector from Bill Type, add Credit to Payment dropdown

**Reported:** 2026-05-10
**Resolved:** 2026-05-10
**Priority:** FIRST PRIORITY

**Symptom:**
The top-right "Cash Bill / Credit Bill / Supplier Bill" selector was doing two jobs at once: it changed the price tier AND auto-flipped the sale to credit mode when "Credit Bill" was picked. This made it impossible to, for example, sell to a supplier-rate customer on credit (supplier rate + credit bill) — the dropdown forced the rate and the bill type to move together. Payment method and bill type were also conflated, with no explicit "Credit" option in the payment dropdown.

**Fixes Applied:**

1. **Top dropdown renamed and decoupled** (`components/pos-new-sale-form.tsx`):
   - Labels changed: "Cash Bill" → "Cash Rate", "Credit Bill" → "Credit Rate", "Supplier Bill" → "Supplier Rate".
   - Removed the `setSaleMode(v === "credit" ? "credit" : "sale")` side effect from the priceType `onChange`. The selector now only chooses the price tier (cashPrice / creditPrice / supplierPrice) and has no relation to payment, status, or balance.

2. **Payment dropdown now drives bill type** (`components/pos-new-sale-form.tsx`, `lib/types/pos.ts`):
   - Added `"Credit"` to the `PaymentMethod` union.
   - Added a `useEffect` that syncs `saleMode` from `paymentMethod`: `"Credit"` → credit sale (status `Credit`, no payment recorded); anything else → paid sale (status `Paid`, payment recorded).
   - Payment dropdown is now always visible (was previously hidden in credit mode unless paying partial).
   - Removed `Mixed` and `Other` options from the dropdown UI (kept in the type for backward compatibility with existing payment records).
   - Removed the partial-payment ("Paying Now") input — credit sales are pure credit; partial payments can be added later from the customer-payments page. The Balance row in credit mode now simply shows the total owed.

3. **Independence verified:**
   - Rate = Supplier + Payment = Credit → uses supplier prices, saves as `Credit` status.
   - Rate = Cash + Payment = Cash → uses cash prices, saves as `Paid`.
   - Rate = Credit + Payment = Cash → uses credit prices, saves as `Paid`. (Previously impossible — the old code flipped to credit mode automatically.)

**Follow-up (2026-05-10): Re-added "Paying Now" field for Credit sales:**
A pure-binary credit flow turned out to be too restrictive — customers may pay part of a credit bill at the time of sale. Re-added a "Paying Now" input that appears only when `paymentMethod === "Credit"`. Behavior:
- `payingNow = 0` → status `Credit`, no payment record (pure udhaar).
- `0 < payingNow < total` → status `Pending`, payment recorded with method `Cash` (default for partial credit payments).
- `payingNow >= total` → status `Paid`.

Backend `updatePOSSale` was updated to insert the supplied payment for any non-Draft status (was previously gated to `status === "Paid"`) and to auto-adjust the saved status when a partial/full payment lands on a Credit sale. `createPOSSale` already handled this correctly via its existing payment-total / status logic.

**Files Changed:**
- `lib/types/pos.ts` — added `"Credit"` to `PaymentMethod`
- `components/pos-new-sale-form.tsx` — rename, decouple, sync effect, dropdown cleanup, Paying Now field
- `app/(app)/pos/actions.ts` — `updatePOSSale` payment insertion + status auto-adjust on partial credit

---

### [RESOLVED] Dashboard — Outstanding Receivables always showed PKR 0

**Reported:** 2026-05-10
**Resolved:** 2026-05-10
**Priority:** FIRST PRIORITY

**Symptom:**
A trial account had two open sales — one Credit (PKR 109) and one Pending (PKR 102) — but the dashboard's "Outstanding Receivables" card showed PKR 0.00 instead of the actual amount owed.

**Root Cause (3 bugs):**

1. **Wrong status filter:** `components/dashboard.tsx` filtered for `inv.status === "Draft" || inv.status === "Partial"`. Drafts are not realized sales, and `"Partial"` is not a status that actually exists in the database — the real outstanding statuses are `Credit` and `Pending`. Both real invoices were silently excluded.
2. **No payment subtraction:** Even if the filter were fixed, the code summed `inv.totalAmount` (full invoice total) instead of `total - paid`. A Pending invoice with a partial payment would have been overstated.
3. **Period-bound:** The receivables card was reading from the period-filtered `invoices` array. Outstanding receivables are a snapshot of "what is owed right now" and should be independent of the Today/Week/Month/Year selector — a debt from January is still owed in May.

**Fixes Applied:**

1. `app/(app)/dashboard/page.tsx`: Added a separate Supabase query that fetches all `Credit` and `Pending` invoices for the user with no period filter, plus a payments query for those invoices. Server now computes `outstandingReceivables = Σ max(0, total - paid)` and passes it to the Dashboard component as a prop.
2. `components/dashboard.tsx`: Replaced the buggy in-component filter with the server-supplied prop. Kept a corrected fallback (`Credit`/`Pending` filter) for the mock-data path.
3. Mock branch in `dashboard/page.tsx` now also passes a computed `outstandingReceivables` so behavior stays consistent when Supabase is not configured.

**Files Changed:**
- `app/(app)/dashboard/page.tsx` — added receivables query + payment join + sum calculation; passes new prop
- `components/dashboard.tsx` — accept `outstandingReceivables` prop; corrected fallback statuses

---

### [RESOLVED] Dashboard — Gross Profit looked overstated when sales were on credit

**Reported:** 2026-05-10
**Resolved:** 2026-05-10
**Priority:** FIRST PRIORITY

**Symptom:**
With two trial sales (PKR 102 Pending + PKR 109 Credit, both fully outstanding), Gross Profit showed PKR 11.00 (5.21%). Mathematically correct under accrual accounting (the goods left inventory, so the margin is "earned"), but a casual viewer reads "PKR 11 in profit" while none of that money has actually been received. The user wanted the dashboard to honestly distinguish *booked* profit from *collected* profit without breaking accounting standards.

**Decision (NOT a calculation change):**
Gross Profit itself remains accrual-basis (industry standard, consistent with FBR/tax reporting and GP reports). The fix is purely a presentational clarification — show the booked total alongside how much of it is realized vs at risk.

**Fixes Applied:**

1. `app/(app)/dashboard/page.tsx`: Added a period-bound payments query for the period's invoices. Computed `realizedRatio = periodPaidSum / periodInvoicedSum`, then `realizedProfit = grossProfit × realizedRatio` and `profitAtRisk = grossProfit − realizedProfit`. These are passed to the Dashboard component as new props. The calculation is an approximation (assumes uniform margin across paid/unpaid lines) which is accurate enough for a dashboard indicator and avoids re-aggregating per-line payment data.

2. `components/dashboard.tsx`: Each KPI item now optionally carries a `breakdown` (realized + at-risk amounts) and a `tooltip` string. The Gross Profit card renders a small "Realized X · At risk Y" line below its main value (only when at-risk > 0), and an `Info` icon next to the title opens a Radix tooltip explaining what *Realized* and *At risk* mean. The Outstanding Receivables card got an explanation tooltip too.

3. The Radix `Tooltip` is imported as `InfoTooltip` to avoid colliding with the recharts `Tooltip` component already used elsewhere in the file.

4. Mock-data path computes the same breakdown so `npm run dev` without a Supabase config still renders cleanly.

**Files Changed:**
- `app/(app)/dashboard/page.tsx` — period-bound payments query + realized/at-risk calculation
- `components/dashboard.tsx` — KPI item type extended (`breakdown`, `tooltip`); Info icon and tooltip integration; updated render

**UI polish (2026-05-10):**
- The Realized/At-risk breakdown was being clipped (`truncate` on a single line cut off "At risk PKR 10..."). Replaced with a two-row layout that aligns label-left, value-right, with no truncation.
- Translated Roman-Urdu tooltip strings on Gross Profit and Outstanding Receivables to English for consistency with the rest of the UI copy.
- Replaced the four KPI icons (`TrendingUp`, `DollarSign`, `Users`, `AlertCircle`) with a more uniform set (`Activity`, `Wallet`, `Users`, `Clock`) and dropped the colored pill backgrounds (emerald / green / blue / amber). Every icon now sits in a single muted container (`bg-muted/40 text-muted-foreground`) with a thinner stroke (`strokeWidth={1.75}`) so the dashboard reads as one cohesive surface instead of a row of differently-coloured chips.

---

### [RESOLVED] Dashboard — Outstanding Receivables exceeded Total Sales (returns not subtracted)

**Reported:** 2026-05-10
**Resolved:** 2026-05-10
**Priority:** FIRST PRIORITY

**Symptom:**
On a real account, the dashboard showed Total Sales (This Month) PKR 20,206,800 and Outstanding Receivables PKR 23,685,840 — outstanding *exceeded* sales, which is impossible if the customer can't owe more than they bought. The 23.6M figure was the sum of original `sales_invoices.total` for Credit/Pending invoices; the 20.2M was the same sales after returns (3,479,040) were subtracted in the gross-profit pipeline.

**Root Causes:**

1. **Returns not subtracted from receivables.** `Math.max(0, total - paid)` did not account for goods that were returned. When a customer returns part of a credit purchase, the returned items reduce what they owe — but the original `invoices.total` field is intentionally not mutated by the return flow (see `app/(app)/returns/actions.ts`); it gets reflected through a separate `returns` row instead. Outstanding-receivables math therefore needs to read returns and subtract them.
2. **`Partially Returned` excluded from the receivable-status filter.** When a sale return is created, `createSaleReturn` updates the original invoice's status to either `Returned` (fully) or `Partially Returned` (partial). Partially-returned credit invoices still carry an unpaid, unreturned balance, but the previous `IN ("Credit", "Pending")` filter dropped them silently.

**Fixes Applied:**

1. `app/(app)/dashboard/page.tsx`: 
   - Receivables status filter now includes `"Partially Returned"` (`["Credit", "Pending", "Partially Returned"]`).
   - Added a parallel query to fetch completed sale returns linked to those invoices, summed into a `returnedByInvoice` map.
   - Per-invoice outstanding is now `max(0, total − paid − returned)`.
   - Total Sales status filter also normalised to include `"Partially Returned"` and drop the never-used `"Partial"`. The full subtotal of partially-returned invoices counts in sales; the existing returns subtraction step nets out the returned portion. Net effect: the dashboard cards (sales / receivables) sit on consistent math now.

**Verification with the user's data:**
```
Original credit invoice totals (Credit/Pending) ........ 23,685,840
Sale returns linked to those invoices .................. -3,479,040
Payments received ......................................         0
Outstanding receivables (after fix) .................... 20,206,800   ✓ matches Total Sales
```

**Files Changed:**
- `app/(app)/dashboard/page.tsx` — receivables status filter + returns query + per-invoice net calculation; sales status filter aligned.

---

### [RESOLVED] Dashboard — Total Sales double-deducting Returned-invoice returns

**Reported:** 2026-05-10
**Resolved:** 2026-05-10
**Priority:** FIRST PRIORITY

**Symptom:**
Same account, the Sales card showed PKR 20,206,800 while the three open Credit invoices summed to PKR 23,685,840. The Sales line and the Outstanding line did not match. A separate, fully-returned invoice (status `Returned`, total 3,479,040) existed in the same period.

**Root Cause:**
The dashboard's returns subtraction was period-bound by the return's *creation date* (`returns.created_at >= periodStart`), without checking whether the original invoice was actually counted in the sales total. When an invoice's status flipped to `Returned`, the status filter excluded it (correct — its lines should not contribute to net sales). But the corresponding `returns` row still passed through the date-based filter and was subtracted from `totalSalesForPeriod`. Net effect: the same returned amount was deducted once via filter exclusion and once via the returns query — a double deduction.

**Fix Applied:**
Changed the returns query in `app/(app)/dashboard/page.tsx` to filter returns by `sales_invoice_id IN (invoiceIds)` instead of by `created_at`. `invoiceIds` is the period's already-filtered invoice id list. With this, returns are only subtracted when their original invoice was also added — symmetric math, no double-deduct.

Behaviour matrix after the fix:
| Original sale status | Lines in period | Linked return | Result |
|---|---|---|---|
| Credit / Pending | added | none | full sale counted |
| Partially Returned | added | yes (subtracted) | net = unreturned portion |
| Returned | excluded by filter | not subtracted (id not in list) | 0 contribution |
| Cancelled | excluded by filter | n/a | 0 contribution |

**Verification with the user's data:**
```
3 Credit invoices' line totals .................... 23,685,840
Returns linked to those 3 invoices ................          0
Returns linked to the Returned invoice ............ (no longer subtracted from filtered sales)
─────────────────────────────────────────────────────────────
Total Sales (after fix) ........................... 23,685,840   ✓ matches Outstanding
```

**Files Changed:**
- `app/(app)/dashboard/page.tsx` — `saleReturns` query now uses `.in("sales_invoice_id", invoiceIds)` instead of `.gte("created_at", periodStart)`.

---

### [RESOLVED] Customer Payments page — "Total Received" overstated, Outstanding inconsistent with dashboard

**Reported:** 2026-05-10
**Resolved:** 2026-05-10
**Priority:** FIRST PRIORITY

**Symptom:**
On `/pos/payments` the user saw `Total Received: PKR 3,479,040`, `Total Payments: PKR 3,479,040`, `Outstanding: PKR 23,685,840`. The 3,479,040 came from a payment that had been refunded in full when the customer returned all the goods — net cash retained from that sale was zero, but the page was still showing the gross figure as if the money was in the till. Outstanding Receivables also did not match the dashboard (no `Partially Returned` invoices, no return-amount subtraction).

**Root Causes:**
1. `getPaidSales()` sums payment records, with no awareness of refunds. The page's "Total Received" therefore counted refunded payments as cash received.
2. The "Total Payments" card was numerically identical to "Total Received" in every realistic scenario — both summed the `payments` table — making one of them dead weight.
3. `getUnpaidPOSSales()` only looked at status `Credit / Pending` and did not subtract returns, so the page disagreed with the dashboard whenever a partial return existed.

**Fixes Applied:**

1. `app/(app)/pos/actions.ts`:
   - `getUnpaidPOSSales()` now matches the dashboard logic — status filter includes `Partially Returned`, and a parallel returns-by-invoice query feeds into `balance = max(0, total - paid - returned)`. Each row also exposes a `returned` field so the UI can show context if needed.
   - Added `getCustomerRefundsSummary()` — returns total refunded amount and refund count, scoped to sale returns (purchase-return refunds are money the *user* gets back from a vendor, irrelevant to customer cash position).

2. `app/(app)/pos/payments/page.tsx` — full UI redesign to match the dashboard's KPI card style:
   - Replaced the `Card` components with the same divs the dashboard uses: muted-pill icon container, two-line title with an `Info` tooltip, optional breakdown rows under the value.
   - **Net Received** card replaces "Total Received". Headline is `gross - refunds` (real cash retained); breakdown rows show *Gross received* (the old "Total Received") and *Refunds issued*, so the previous numbers are still visible at a glance.
   - **Refunds Issued** card replaces "Total Payments". Shows total refunds and a sub-line with refund count + payment count (the old "Total Payments" count moved here).
   - **Outstanding Receivables** uses the new outstanding logic and shows `X unpaid invoices · Y customers` underneath.
   - Icons: `Wallet`, `RotateCcw`, `Clock` — same family as the dashboard (`Activity`, `Wallet`, `Users`, `Clock`), uniform muted style with `strokeWidth={1.75}`.

**Verification with the user's data:**
```
Gross received  ........................ 3,479,040
Refunds issued .........................-3,479,040
─────────────────────────────────────────
Net received ...........................          0   ← real cash position
Outstanding ............................ 23,685,840   ← matches dashboard
```

**Files Changed:**
- `app/(app)/pos/actions.ts` — `getUnpaidPOSSales` updated; new `getCustomerRefundsSummary` action.
- `app/(app)/pos/payments/page.tsx` — KPI cards rewritten in dashboard style; refunds + new outstanding wired in.

---

### [RESOLVED] Gross Profit Report — Returned/Cancelled invoices counted, returns never subtracted, NULL cost inflated profit

**Reported:** 2026-05-10
**Resolved:** 2026-05-10
**Priority:** FIRST PRIORITY

**Symptom:**
The Gross Profit tab on `/pos/sales` was using a different (older, looser) ruleset than the dashboard. Status filter was just `.neq("status", "Draft")`, so Cancelled and fully-Returned invoices contributed to sales and profit. Returns were never subtracted at all — neither from quantity nor from sale_amount — so partial returns were invisible to the report. NULL `cost_price` on a line silently became 0, which made some items show 100 % margin. The result was a report that disagreed with the dashboard and overstated both sales and profit.

**Fixes Applied (all in `app/(app)/pos/reports/actions.ts`):**

1. **Status filter aligned with dashboard:** `.neq("status", "Draft")` replaced with `.in("status", ["Paid", "Pending", "Credit", "Partially Returned"])`. Cancelled and fully-Returned invoices no longer contribute. The two screens now agree on what counts as a realised sale.

2. **Returns subtraction added:** After grouping the sales lines per item, the action now fetches `returns` linked to the same `invoiceIds` (type=`sale`, status=`Completed`), pulls their `return_lines`, and subtracts `quantity`, `line_total`, and the original line's cost from each item's bucket. A `costBySalesLine` map (built while reading the sale lines) lets the return subtraction use the cost as it was at the time of sale, not whatever the inventory currently has — so historical accuracy is preserved if cost prices have changed since.

3. **NULL cost fallback flipped to break-even:** Old code did `Number(line.cost_price ?? item.cost_price ?? 0)`, which turned missing cost into a 100 % profit on those lines. New code falls back to the line's selling price (`unitPrice`), so missing cost shows up as a 0 % margin instead — same convention used on the dashboard.

4. **Dropped current-inventory cost fallback:** the old `?? item.cost_price` path could pull today's cost into yesterday's profit calculation. Removed; only the at-sale `cost_price` is used now (with the break-even fallback above).

5. **Empty rows filtered out:** items whose totals fully netted to zero (e.g. an item that was sold and then entirely returned within the period) are filtered from the per-item table so the report doesn't list zero-contribution rows.

6. **Removed bogus 100% on zero-cost branch:** `gp_pct_purchase` no longer special-cases "no cost ⇒ 100%". With the break-even fallback in place, the divide-by-zero scenario only happens when sale_amount is also zero, in which case the metric is reported as 0 (not 100).

**Net effect:**
For the user's account this brings the GP report into agreement with the dashboard:
```
3 Credit invoices' lines (in period) ......... 23,685,840
Returns linked to these 3 ....................          0
─────────────────────────────────────────────────────────
Total Sale Amount (after fix) ................ 23,685,840
Total Purchase Amount (cost) .................   ~23,610,000
Total GP Value ...............................        ~75,840
Overall GP % .................................        ~0.32%
```

The fully-returned invoice (3,479,040) and its return are both excluded, no double-counting, no double-deduction.

**Files Changed:**
- `app/(app)/pos/reports/actions.ts` — status filter, returns subtraction, cost fallback, removed inflated 100% branch, filter empty rows.

**UI polish (2026-05-10):**
- The Gross Profit tab was showing two stacked rows of identical KPIs — one in `app/(app)/pos/sales/page.tsx` (Total Sales / COGS / Gross Profit / GP%) and one inside `GrossProfitTable` (Total Revenue / Total Cost / Gross Profit / GP%). Removed the page-level row so the table component is the single source of truth. The standalone `/pos/reports` page (separate route from the `/pos/sales?tab=gp` tab) had the *same* duplicate row and was patched the same way.
- Refreshed the remaining KPI row in `GrossProfitTable` to match the dashboard's card style: same muted icon pill (`bg-muted/40 text-muted-foreground`), thin stroke icons (`Activity` / `ShoppingBag` / `Wallet` / `Percent`), and the same padding/typography as the main dashboard cards. No more colour-coded chips.
- KPI cards in `GrossProfitTable` are now rendered unconditionally — previously they were gated on `!isPending && data.length > 0` so they vanished entirely when a filter (e.g. "Today" with no sales yet) returned an empty set. Cards now show `PKR 0.00` placeholders in that case and a Skeleton row while a filter change is loading. Result: the user always sees the four KPI slots, and they update dynamically as filters change.
- Removed the "Gross Profit" tab from `app/(app)/pos/sales/page.tsx`. The same view already exists as a top-level sidebar/sub-nav item at `/pos/reports`, and keeping it under Sales as well meant the report mounted under two URLs with two different KPI rows — confusing and a maintenance hazard. The Sales page is now just the sales list (no tabs).
- The shared `Skeleton` component was using `bg-accent`, which resolves to the brand's orange tint and made loading states look like real data. Switched to `bg-muted` so skeletons read as a neutral hollow placeholder, consistent with how loading is shown across the rest of the app.

---

### [RESOLVED] Topbar theme toggle reverted on every navigation

**Reported:** 2026-05-10
**Resolved:** 2026-05-10
**Priority:** FIRST PRIORITY

**Symptom:**
Clicking the moon/sun icon in the topbar appeared to flip the theme, but as soon as the user navigated to another page, the theme snapped back to whatever was last saved on the Settings → Appearance form. Effectively, the topbar toggle felt broken — it worked for the current page only and never persisted.

**Root Cause:**
`app/(app)/layout.tsx` mounts a `<ThemeSync theme={settings.theme}>` client component on every server render. `ThemeSync`'s `useEffect` calls `setTheme(theme)` whenever the prop changes, force-syncing the next-themes state to whatever the database returns.

The topbar `Header` toggle, on the other hand, only called `next-themes`' client-side `setTheme` and never persisted the change to the user's settings row. So:
1. User clicks moon → next-themes flips locally.
2. User navigates anywhere → server fetches `getAllSettings()` → returns the (unchanged) old theme.
3. New layout render passes the old theme into ThemeSync → `setTheme("light")` overwrites the user's pick.

**Fix Applied:**
`components/header.tsx`:
- `toggleTheme` now also calls the existing `updateAppearance(next)` server action inside a `startTransition`, persisting the new theme to the DB. The next layout render sees the updated value, ThemeSync receives it, and there's nothing to snap back to.
- Toggle uses `resolvedTheme` (instead of `theme`) so users who have `theme = "system"` saved still get a sensible flip — the icon and the "what's visible right now" stay in sync.
- Icon display also uses `resolvedTheme` so the sun/moon glyph reflects the actually-rendered theme rather than the literal `"system"` value.

**Files Changed:**
- `components/header.tsx` — `toggleTheme` persists to settings; uses `resolvedTheme` for both the toggle and the icon.

**Note:** The admin top bar (`components/admin-header.tsx`) has a similar local-only toggle but its layout (`app/admin/(dashboard)/layout.tsx`) doesn't mount `ThemeSync`, so the same revert behaviour doesn't occur there. Left untouched.

---

### [RESOLVED] Party Ledger — "Total Sales" rolled in refunds, "Total Payments" rolled in returns

**Reported:** 2026-05-10
**Resolved:** 2026-05-10
**Priority:** FIRST PRIORITY

**Symptom (real example from `Ahmed Traders` ledger):**
```
Current Balance ........... PKR  3,490,560 (Receivable)
Total Sales ............... PKR 10,448,640   ← inflated
Total Payments ............ PKR  6,958,080   ← inflated
Total Transactions ........ 5
Breakdown:                  2 invoices · 1 payments · 1 returns   (sums to 4, not 5)
```
The transaction history showed one invoice for 3,479,040 and one payment for the same amount, yet the summary advertised 10.4M of sales and 6.9M of payments. The cards were summing the wrong rows.

**Root Cause:**
`app/(app)/parties/[id]/ledger/page.tsx` was doing:
```ts
const totalDebits  = ledgerRows.reduce((s, r) => s + r.debit,  0)   // → labelled "Total Sales"
const totalCredits = ledgerRows.reduce((s, r) => s + r.credit, 0)   // → labelled "Total Payments"
```
But the ledger builder in `app/(app)/parties/actions.ts` puts **refunds on the debit side** (cash going back to the customer increases what they owe) and **sale returns on the credit side** (returned goods reduce what they owe). So both summary cards happily mixed in the wrong transaction types:
- "Total Sales" = invoice totals **+ refund amounts**
- "Total Payments" = payment amounts **+ sale-return values**

The "Total Transactions" breadcrumb also forgot to mention refunds, so 1 invoice + 1 payment + 1 return = 3 but `transactionCount` was 4 once a refund existed.

**Math verification:**
```
Invoices  (debits)  : 3,479,040
Refunds   (debits)  : 6,969,600    → old totalDebits  = 10,448,640
Payments  (credits) : 3,479,040
Returns   (credits) : 3,479,040    → old totalCredits =  6,958,080
Balance = 10,448,640 − 6,958,080  =  3,490,560 ✓
```
The running balance on each ledger row was always correct — only the summary cards were misclassified.

**Fixes Applied (all in `app/(app)/parties/[id]/ledger/page.tsx`):**

1. **Per-type stat calculations** — replaced the two blanket reduces with type-filtered ones:
   ```ts
   totalSales     = rows.filter(r => r.type === "invoice").sum(debit)
   totalPurchases = rows.filter(r => r.type === "purchase").sum(credit)
   totalPayments  = rows.filter(r => r.type === "payment").sum(debit + credit)
   totalReturns   = rows.filter(r => r.type === "return").sum(debit + credit)
   totalRefunds   = rows.filter(r => r.type === "refund").sum(debit + credit)
   ```
   Using `debit + credit` (one is always 0) keeps the same calculation valid for both customer and vendor ledgers.

2. **4-card layout aligned with standard subsidiary-ledger presentation** (Tally / Sage / QuickBooks pattern):
   - Card 1: Current Balance (unchanged) with Receivable/Payable badge.
   - Card 2: **Total Sales** (or "Total Purchases" for vendor ledgers) — invoices/purchases only.
   - Card 3: **Total Payments** — payment records only.
   - Card 4: **Returns & Refunds** — combined card with a 2-row breakdown showing each amount + count, with a graceful "No returns or refunds yet" placeholder when both are zero.

3. **Transaction-history breadcrumb fixed** — moved from the (removed) "Total Transactions" card to the table card header, and now includes refunds in the breakdown so the line always sums to `transactionCount`:
   ```
   5 total · 2 invoices · 1 payment · 1 return · 1 refund
   ```

**Expected values after the fix (on the user's data):**
| Card | Before | After |
|---|---|---|
| Total Sales | PKR 10,448,640 | PKR 3,479,040 (single invoice) |
| Total Payments | PKR 6,958,080 | PKR 3,479,040 (single payment) |
| Returns & Refunds | not shown | Returns 3,479,040 (1) / Refunds 6,969,600 (varies) |
| Current Balance | PKR 3,490,560 | PKR 3,490,560 *(unchanged — the balance math was always right)* |

**Files Changed:**
- `app/(app)/parties/[id]/ledger/page.tsx` — per-type stat calculations, replaced "Total Transactions" card with "Returns & Refunds", moved transaction-count breadcrumb into the table card header with refunds included.

**Follow-up (2026-05-10): the toggle was *still* reverting on navigation**
The first fix persisted the new theme to the DB but the revert kept happening. Two more issues turned up once the obvious one was out of the way:

1. `updateAppearance` was calling `revalidatePath("/settings/appearance")` only — so every other route still served its cached layout payload with the stale `settings.theme`. On navigation, ThemeSync received the old prop and force-applied the old theme. Switched to `revalidatePath("/", "layout")` so all cached app routes are invalidated and the next request re-fetches the user's settings.
2. `ThemeSync` re-ran `setTheme(theme)` on every render where the prop reference changed. Even with revalidation, an outdated layout payload sitting in the router cache could still trigger a sync to the wrong value before the new payload landed. Reworked `ThemeSync` to fire **once per mount** (via a `useRef` flag) **and** only when the server theme actually differs from the current next-themes value. The hydrate-from-DB behaviour is still there for fresh logins; it just stops fighting client-side toggles.

Also tightened the topbar toggle: `updateAppearance` is now awaited inside the transition so any failure surfaces a toast and reverts the local theme back, instead of silently leaving the UI and the DB out of sync.

**Files Changed (follow-up):**
- `app/(app)/settings/actions.ts` — `revalidatePath("/", "layout")`
- `components/theme-sync.tsx` — once-per-mount + diff-check guard
- `components/header.tsx` — error handling, toast + local revert on save failure

---

### [RESOLVED] Phase 1 of `bugfixing/ANALYSIS.md` — four correctness fixes

**Resolved:** 2026-05-14
**Priority:** SECOND-PRIORITY analysis, Phase 1 (the four highest-impact correctness bugs from `bugfixing/ANALYSIS.md`).

**Bug 1 — `user.id` vs `effectiveUserId` inconsistency in `app/(app)/pos/actions.ts`:**
Seven occurrences across `getUserPrintFormat`, `setUserPrintFormat`, `getInvoiceForPrint`, `getStoreSettings`, and `setStoreSettings` were keying `user_settings` / `sales_invoices` queries by the raw `user.id` while the rest of the codebase scopes everything to `currentUser.effectiveUserId`. On a sub-user / impersonation setup that would let one identity write into another's settings row and could surface another tenant's invoice in `getInvoiceForPrint`. All seven replaced with `user.effectiveUserId` for consistency.

**Bug 2 — Dead `isChangingToCancelled` / `isChangingFromCancelled` booleans in `updateInvoice` and `updatePurchase`:**
Both functions computed these flags but never read them. The real stock-handling branches (old-line restore + new-line decrement/increment) use `currentStatus !== "Cancelled"` and `newStatus !== "Cancelled"` directly, which already covers every cancel/reactivate transition correctly. The dead vars were just lint noise; tracing every transition confirmed there's no missing behaviour. Removed both pairs and left a short comment explaining the in-place checks.

**Bug 3 — `updatePOSSale` direct stock UPDATE bypassed audit:**
The "restore stock for old items" loop was doing a read-modify-write on `inventory_items.stock` (race-prone) and never wrote a `stock_movements` row, so undoing a draft's prior stock decrement was invisible in audit reports. Replaced with the same primitives the rest of the codebase already uses elsewhere: the atomic `increment_inventory_stock` RPC plus a `recordStockMovement` IN entry referencing the invoice.

**Bug 6 — `createCustomerPayment` accepted non-POS invoices:**
This action lives on the POS payments screen but only verified ownership (`user_id`), not the invoice source. A crafted `invoiceId` for a manual invoice could attach a POS payment to it, bypassing the manual-invoice payment flow. Added `.eq("source", "pos")` to the invoice lookup and updated the error message.

**Files Changed:**
- `app/(app)/pos/actions.ts` — all four bugs touched this file in different places.
- `app/(app)/invoices/actions.ts` — removed dead variables, comment-only swap.
- `app/(app)/purchases/actions.ts` — same as invoices.

---

### [RESOLVED] Phase 2 of `bugfixing/ANALYSIS.md` — four smaller correctness / hygiene fixes

**Resolved:** 2026-05-14
**Priority:** SECOND-PRIORITY analysis, Phase 2 (the four smaller bugs from `bugfixing/ANALYSIS.md`).

**Bug 5 — `getAllCustomerPayments` in-memory source filter:**
The action was fetching every payment for the user and then dropping non-POS rows via `.filter((p) => p.source === "pos")` in JS. On a busy store that means hauling manual-invoice payments over the wire just to discard them. Switched to an inner-joined embedded select: `sales_invoices:invoice_id!inner(...)` plus `.eq("sales_invoices.source", "pos")` pushes the filter down so the DB never returns the unwanted rows. The post-process filter was removed.

**Bug 4 — `updatePurchase` dead `invItem` SELECT per item:**
The increment-stock loop in `updatePurchase` was running a per-item `SELECT stock FROM inventory_items` whose returned `stock` was never read — only the row's existence was checked. Ownership of every itemId is already verified at the top of the function, so the lookup was pure waste (one extra round-trip per line). Removed the SELECT; the loop now calls `increment_inventory_stock` + `recordStockMovement` directly.

**Bug 8 — `quickCreateInventoryItem` no barcode collision check:**
The full `createInventoryItem` action checks for barcode collisions with a retry loop, but the quick-create variant called from a purchase form was just inserting the barcode raw. A duplicate scan would bubble a raw Postgres unique-violation back to the UI. Mirrored the retry logic from the full create: try the requested barcode, then append a timestamp suffix, then a random suffix, give up after three attempts with a clean error message.

**Bug 7 — Misleading "cascade should handle this" comment:**
Both `deleteInvoice` and `deletePurchase` had a comment saying the child-row delete was redundant because the FK should cascade. The schema doesn't actually guarantee ON DELETE CASCADE on `sales_invoice_lines.invoice_id` / `purchase_invoice_lines.purchase_invoice_id`, so removing the explicit delete would risk a foreign-key violation. Kept the explicit deletes (defensive) and rewrote the comments to be honest about why they're there.

**Files Changed:**
- `app/(app)/pos/actions.ts` — bug 5
- `app/(app)/purchases/actions.ts` — bugs 4, 8, 7 (purchase half)
- `app/(app)/invoices/actions.ts` — bug 7 (invoice half)

---

### [RESOLVED] Phase 3 of `bugfixing/ANALYSIS.md` — duplication cleanup via shared helpers

**Resolved:** 2026-05-19
**Priority:** SECOND-PRIORITY analysis, Phase 3 (refactor the eight duplicated patterns identified in `bugfixing/ANALYSIS.md`).

**Five new helpers, ~25 inline copies of the same logic collapsed:**

- **Dup 3 — `pickFirst` (`lib/db/supabase-joined.ts`)**: replaced the
  `row.parties ? (Array.isArray(row.parties) ? row.parties[0] : row.parties) : null`
  defensive ternary at 15+ sites across `pos/actions.ts`, `invoices/actions.ts`,
  `purchases/actions.ts`, `returns/actions.ts`, and `purchase-management/reports/actions.ts`.

- **Dup 2 — `verifyPartyOwnership` (`lib/db/party-ownership.ts`)**: replaced the
  4-line "fetch party by id+user_id, return Party not found if missing" block at
  five sites: `createPOSSale`, `createInvoice`/`updateInvoice`,
  `createPurchase`/`updatePurchase`, and `createSaleReturn`. Bonus
  `verifyInventoryItemsOwnership` for the bulk-item case.

- **Dup 1 — `incrementStockForLines` / `decrementStockForLines`
  (`lib/db/stock-line-mutations.ts`)**: replaced the four near-identical
  "loop over old lines, fetch current stock, call RPC, record movement" blocks
  in `updateInvoice`, `deleteInvoice`, `updatePurchase`, `deletePurchase`. Each
  call is now four lines instead of thirty, and the per-item ownership re-fetch
  (Bug 4 hygiene) is gone since ownership is guaranteed by the parent invoice.

- **Dup 4 — `recalcInvoicePaymentStatus` (`lib/db/invoice-payment-status.ts`)**:
  replaced the four "re-read remaining payments and update parent invoice
  status" copies in `createCustomerPayment` / `deleteCustomerPayment` /
  `createPurchasePayment` / `deletePurchasePayment`. Sales-side keeps the
  "Pending" terminology, purchase-side keeps "Partially Paid"; the helper takes
  a discriminator (`"sales" | "purchase"`) so both paths share one piece of
  logic with cents-based comparison (no float-precision near-equality bugs).

- **Dup 5+6 — `parseInventoryFormData` + `calculateProfit` (local helpers in
  `app/(app)/stock-management/inventory/actions.ts`)**: the inventory dialog's
  FormData parsing (`String(formData.get(...)).trim()` repeated ~12 times per
  action) and the profit-value/profit-percentage calculation are now two
  helpers shared between `createInventoryItem` and `updateInventoryItem`.

- **Dup 7 — `resolveAvailableBarcode` + `generateUniqueAutoBarcode`
  (`lib/db/barcode-collision.ts`)**: the barcode collision retry loop existed
  in three flavours: full-create, auto-generate-after-insert, and the recently
  added quick-create path on the purchase form. All three now go through the
  same helper.

- **Dup 8 — skipped intentionally**: `getInvoiceForPDF`, `getPurchaseForPDF`,
  and `getInvoiceForPrint` are structurally similar but query different tables,
  expose different output shapes, and the POS-side variant has diverged
  further (it now fetches pack info + line discount + payments + refunds that
  the other two don't). Folding them into one helper would require enough
  feature flags that the abstraction cost would outweigh the savings. The
  largest visual duplication inside them — the joined-data ternaries — was
  already removed by Dup 3.

**Files Changed:**
- **New:** `lib/db/supabase-joined.ts`, `lib/db/party-ownership.ts`,
  `lib/db/stock-line-mutations.ts`, `lib/db/invoice-payment-status.ts`,
  `lib/db/barcode-collision.ts`.
- **Modified:** `app/(app)/pos/actions.ts`, `app/(app)/invoices/actions.ts`,
  `app/(app)/purchases/actions.ts`, `app/(app)/returns/actions.ts`,
  `app/(app)/purchase-management/reports/actions.ts`,
  `app/(app)/stock-management/inventory/actions.ts`.

---

### [RESOLVED] Settings Module — Final Batch (SET-M3, M4, M6, M7, M14, L8, L10, NCR mirror)

Final settings-module pass closing every item from
`bugfixing/SETTINGS-MODULE-ANALYSIS.md` that didn't require a business decision.
Net effect: every screen reads from the same `user_settings` table, the NCR
thermal template honors the same toggles as A4, and items without a per-item
minimum_stock finally surface in low-stock alerts.

- **SET-M3 default category + default unit for new inventory items**: POS
  Preferences exposes two new pickers (`default_category_id`,
  `default_unit_id`). The inventory dialog pre-selects these on a NEW item
  (edit flow untouched). Stale ids (settings still pointing at a deleted
  category/unit) are silently ignored so a deleted category can't ghost-select
  itself.

- **SET-M4 receipt copy count**: NCR thermal template used to hardcode 2
  copies (Customer + Merchant). New `receipt_copy_count` setting clamps 1-3
  server-side; the template loops that many copies labelled
  "Copy X of N — Customer/Merchant/File Copy". A4 ignores the setting (each
  print tab is one document by definition).

- **SET-M6 date format**: every printed date — bill date, payment-history
  rows, "Print Date" footer, payment-history rows on A4 + NCR — now respects
  the `date_format` setting (DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD). Threaded
  through `getInvoiceForPrint → printOptions.dateFormat → fmtDate(...)` so
  the helper stays pure (no settings read on the hot path).

- **SET-M7 decimal places**: `formatCurrency` now uses the configured
  `decimal_places` (clamped 0-4) instead of hardcoded 2. Affects every
  CurrencyContext consumer app-wide. Saving the setting revalidates `/` at
  layout level so cached routes pick up the new format on next nav.

- **SET-M14 tax-inclusive label**: when `tax_mode = Inclusive`, the tax row
  on the printed totals box reads "Includes Tax:" instead of "Tax:" — matching
  how the in-store price label is presented. Both A4 and NCR honor it.

- **SET-L8 print_format key consolidation**: two parallel keys
  (`pos_default_print_format` for the POS quick-toggle, `print_format` for the
  /settings/invoice form) used to disagree silently — the toolbar toggle and
  the settings page wrote to different rows. Now `getUserPrintFormat` reads
  the canonical `print_format` first with the legacy key as fallback;
  `setUserPrintFormat` writes only the canonical key using the settings-page
  vocabulary ("A4" / "Thermal80mm"). Legacy values ("a4", "pos_thermal",
  "Thermal80mm", "A5") all normalise to the same PrintFormat union via a
  single helper.

- **SET-L10 low_stock_threshold global fallback**: the dashboard low-stock
  query used to filter `minimum_stock > 0` at the database level — items
  without a per-item minimum NEVER appeared on the dashboard low-stock card,
  even on a fresh install. Now the query returns every non-archived item, and
  the per-item minimum is OR'd with the configured `low_stock_threshold`
  setting (default 10). The surfaced `minimum_stock` on the dashboard card
  reflects whichever threshold was applied so the "below minimum" copy
  matches the rule that fired.

- **NCR thermal template — SET-H2 mirror**: previously the thermal receipt
  only read `store.name / address / phone`. It now mirrors the A4 template —
  uses `store_city`, `store_whatsapp`, `store_ntn`, `store_strn`,
  `store_logo_url` in the header; honors the `show_discount_col` /
  `show_tax_col` / `show_ntn_strn` toggles; renders the configured
  `invoice_footer` text in place of the hardcoded terms (newlines preserved);
  uses the configured `invoice_prefix` via the same path A4 already uses.
  Receipts now look consistent across thermal and A4.

- **Cleanup (parallel-systems removal):** deleted
  `components/comprehensive-pos-settings.tsx` (legacy localStorage all-in-one
  settings page) and the orphan `components/pos-settings-form.tsx`. The
  `/settings/advanced` route now 307-redirects to `/settings/store` so any
  bookmarked link still lands somewhere useful. The "Advanced Settings" nav
  item was removed.

**Files Changed:**
- `app/(app)/pos/actions.ts` — print_format consolidation,
  `getInvoiceForPrint` extended with M4/M6/M14 settings.
- `app/(app)/dashboard/page.tsx` — global low-stock fallback.
- `app/(app)/settings/actions.ts` — five new keys (`default_category_id`,
  `default_unit_id`, `receipt_copy_count`, `date_format`, `decimal_places`),
  `updateTaxSettings` + `updatePOSPreferences` extended.
- `app/(app)/settings/pos/page.tsx` — fetches categories + units for the form.
- `app/(app)/stock-management/inventory/inventory-dialog.tsx` — pre-fills
  defaults from settings on new-item create.
- `components/settings/pos-preferences-form.tsx` — receipt copies + default
  category/unit pickers.
- `components/settings/tax-settings-form.tsx` — date format + decimal places.
- `components/pos/print-a4-invoice.ts` — date format consumption,
  tax-inclusive label.
- `components/pos/print-standard-invoice.ts` — full SET-H2 mirror + date
  format + tax-inclusive + N-copy loop.
- `contexts/currency-context.tsx` — accepts `decimalPlaces`.
- `app/(app)/layout.tsx` — threads `decimal_places` through CurrencyProvider.
- `lib/types/pos.ts` — `printOptions` extended with `dateFormat` /
  `receiptCopyCount` / `taxMode`.
- **Deleted:** `components/comprehensive-pos-settings.tsx`,
  `components/pos-settings-form.tsx`.

---

## Pending Bugs (Awaiting Fix)

(none currently — see `bugfixing/ANALYSIS.md` for second-priority items; Phase 4 dead-code + Phase 5 architectural still to go)
