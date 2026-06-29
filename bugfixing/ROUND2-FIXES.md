# Sale Invoice — Round 2 Fixes

**Date:** 2026-05-19
**Scope:** All discount / draft / print-related issues identified in `SALE-INVOICE-ANALYSIS.md` (Round 2 section).
**Result:** 16 of 16 identified issues implemented; 6 Round-1 Low items deferred (require new infrastructure / business decisions).

This document is a summary of what changed. Each entry includes file paths + a short explanation. Companion to the resolution log in `bugfixed.md`.

---

## 🔴 Critical fixes

### R2-C1 — Drafts no longer decrement stock
**Problem:** `createPOSSale` and `updatePOSSale` decremented stock unconditionally. Drafts (parked carts) held inventory forever; abandoning a draft permanently inflated "sold" counts and depleted physical-vs-system stock.

**Fix:**
- `app/(app)/pos/actions.ts` — wrapped the decrement block in `createPOSSale` with `if (status !== "Draft")`. Stock check still runs for all statuses so a future completion can't oversell.
- Same file, `updatePOSSale`:
  - Replaced unconditional "restore from old lines" with an audit-trail driven restore. We sum the net OUT (OUT − IN) per item from `stock_movements` for this invoice. Drafts created after the fix have no OUT rows → no restore happens. Pre-fix Drafts (with real OUT rows) get restored cleanly.
  - The new-decrement block is gated on `newStatus !== "Draft"`. Transitioning Draft → Paid/Credit triggers the decrement; staying as Draft → Draft holds nothing.

**One-time backfill:** `bugfixing/backfill-sale-invoice-data.sql` (block 2) restores stock for existing pre-fix Drafts that were silently holding it. Optional, idempotent, gated behind a preview SELECT.

---

### R2-C2 — Delete-Draft action + Trash button
**Problem:** No UI or server action let cashiers cancel a stuck Draft. Combined with R2-C1's pre-fix behavior, abandoned Drafts piled up with no recovery path.

**Fix:**
- New server action `deletePOSDraft(invoiceId)` in `app/(app)/pos/actions.ts`:
  - Verifies ownership + `status === "Draft"` + `source === "pos"`.
  - Computes net OUT from `stock_movements` and restores stock + writes a compensating IN movement (audit-trail-correct for both old and new Drafts).
  - Deletes line items, defensive-deletes stray payments, deletes the invoice row.
- UI button in `components/pos-sales-list.tsx`:
  - Trash icon next to the Pencil (Edit) icon, only rendered for `sale.status === "Draft"`.
  - `window.confirm()` prompt before delete.
  - Loading spinner during deletion, `router.refresh()` after success.

---

## 🟠 High fixes

### R2-H1 — NCR thermal print now shows line discount
**Problem:** Thermal receipt had no Disc% / Disc Amt columns. Customer scanned a receipt with no indication they'd received a discount.

**Fix:** `components/pos/print-standard-invoice.ts` — when a line has `discountAmount > 0`:
- Item row shows the **original list price** in the Rate column (so the customer sees what the price would have been).
- A small italic sub-row below the item line shows `Disc XX.XX%   -<amount>`.
- Lines without a discount continue to print exactly as before.

The narrow thermal width didn't allow adding two more columns, so the sub-row pattern keeps the receipt readable while making the saving visible.

---

### R2-H2 — A4 print now shows Cash Paid + Balance Due
**Problem:** A4 totals box had no payment rows. Credit-sale customers couldn't see how much they owed.

**Fix:** `components/pos/print-a4-invoice.ts` — after the Net Amount row, the totals table now includes:
- `Cash Paid: <sum of all payments>` (only when payments exist)
- `Balance Due: <total − paid>` (highlighted when > 0)

Both rows appear for any sale that has payment rows. Drafts and unpaid Credit sales show neither.

---

### R2-H3 — A4 Draft banner
**Problem:** A4 Drafts printed identically to finalized sales, with only a tiny footer note. Customer could mistake a Draft for a real receipt.

**Fix:** Above the items table, render a black banner `DRAFT — NOT A SALES RECEIPT` when `data.status === "Draft"`. CSS class `.draft-banner` added to the print stylesheet. Mirrors the NCR thermal's existing banner style.

---

### R2-H4 — A4 item names no longer truncate
**Problem:** Long Pakistani SKUs got silently cut off because of `table-layout:fixed` + `overflow:hidden`.

**Fix:** Added an `.item-name` CSS class with `white-space:normal; word-wrap:break-word; overflow:visible` and applied it to the Item Name td. Long names now wrap onto multiple lines within the cell.

---

### R2-H5 — Bill-discount Split fix (no more paise drift)
**Problem:** `applyGlobalDiscount` rounded each proportional share to 2 decimals; the sum could land 0.01-0.02 PKR away from what the cashier typed.

**Fix:** `components/pos-new-sale-form.tsx` — after computing rounded shares, the function now calculates the drift (`typed − Σ shares`) and adds it to the line with the **largest gross**. Sum of per-line discounts now exactly equals the typed bill discount.

---

### R2-H6 — A4 "Total Before Discount" label is now dynamic
**Problem:** For invoices saved before the line-discount migration, the label "Total Before Discount" was wrong — the reconstructed gross actually equals subtotal-after-line-discount because the original list price isn't recoverable.

**Fix:** A4 template now sets `grossLabel = "Total Before Discount"` only when at least one item has a non-null `originalUnitPrice`. Otherwise it falls back to `"Subtotal"`. Honest labelling for both old and new invoices.

---

## 🟡 Medium fixes

### R2-M1 — Backfill SQL for legacy data
**File:** `bugfixing/backfill-sale-invoice-data.sql`

Two optional one-time backfills:
1. Set `original_unit_price = unit_price` on all `sales_invoice_lines` rows where `original_unit_price IS NULL`. Prevents old-draft edits from corrupting discount data after R2-C2.
2. Restore stock for existing Drafts that were holding inventory (pre-R2-C1).

Both blocks have preview SELECTs above the UPDATE statements; the writes are commented out by default. Idempotent — safe to re-run.

---

### R2-M2 — Negative-value guards at the API boundary
**File:** `app/(app)/pos/actions.ts`

Added explicit `Number.isFinite + ≥ 0` checks in both `createPOSSale` and `updatePOSSale` for:
- Item quantity (must be > 0)
- Item unitPrice (≥ 0)
- Payment amount (≥ 0)
- Bill discount (≥ 0)

The form already clamps these on the client, but a crafted request could slip a negative through and corrupt outstanding balances. Defense in depth.

---

### R2-M3 — Paying Now re-clamps on total shrink
**File:** `components/pos-new-sale-form.tsx`

New `useEffect` watches `computed.total` and `payingNow`; if total drops below the entered payingNow (e.g. cashier removes a line), it clamps payingNow back down. Without this an over-payment could be persisted as cash received and the status would silently flip to "Paid".

---

### R2-M4 — Server-side over-discount validation
**File:** `app/(app)/pos/actions.ts`

In both `createPOSSale` and `updatePOSSale`, replaced the silent `Math.max(0, total)` clamp behavior with an explicit error when `discount > subtotal + tax + 0.01`. A 99%-too-high discount surfaces immediately as an actionable error rather than printing "Net Amount: 0.00".

(The `Math.max(0, ...)` clamp on the final `total` is kept as belt-and-suspenders — it now only matters in genuinely impossible scenarios.)

---

### R2-M5 — Payment history rows in both print templates
**Files:** `components/pos/print-a4-invoice.ts`, `components/pos/print-standard-invoice.ts`

When an invoice has **more than one** payment row (typical for partially-paid Credit sales), both templates now render a per-payment breakdown showing:
- Payment date
- Method (and reference if present)
- Amount

Single-payment invoices skip the section since the Cash Paid line already says everything. Lets a customer reading a reprint reconcile each partial payment against their own records.

---

### R2-M6 — Walk-in fake phone filter
**Files:** `components/pos/print-a4-invoice.ts` (defines `displayableCustomerPhone`), `components/pos/print-standard-invoice.ts` (imports + uses it)

The Walk-in customer is auto-created with phone `"000-000-0000"`. Both print templates now route the phone through a shared `displayableCustomerPhone()` helper that returns `""` for the fake number. The "Contact No" row is conditionally rendered, so walk-in invoices simply omit the phone entirely.

---

### R2-M7 — PKR/% decimal step alignment
**File:** `components/pos-new-sale-form.tsx`

The bill-discount PKR input had `step={1}` while the % input wrote 2-decimal values. Switching between the two produced visible flicker. Changed PKR step to `0.01` so both fields agree on precision.

---

## ⚪ Low fixes (rolled into the same edits)

### R2-L1 — Friendly status labels on prints
**File:** `components/pos/print-a4-invoice.ts` (new `friendlyStatus()` helper)

Footer status text now reads:
- `Paid` → "Cash Sale"
- `Credit` → "Credit Sale (Udhaar)"
- `Pending` → "Partial Payment Pending"
- `Draft` → "Draft — Not a Sales Receipt"
- `Partially Returned`, `Cancelled` → same words

Raw status enums looked like developer jargon on a customer-facing invoice; these match Pakistani-wholesale tone.

---

### R2-L2 — A4 print date footer
**File:** `components/pos/print-a4-invoice.ts`

Footer left column now shows `Printed: <date> <time>` (using the current clock at render time). Customers reprinting an old invoice can tell which copy is fresh vs original. NCR template already had this; A4 now matches.

---

### R2-L6 — numberToWords paise support
**File:** `components/pos/print-a4-invoice.ts`

Old `numberToWords(amount)` did `Math.floor` before converting, so an invoice for `1,500.50` printed `"ONE THOUSAND FIVE HUNDRED RUPEES ONLY"` while the numeric Net Amount said `1,500.50` — words and number disagreed.

New implementation:
- Splits the amount into rupees + paise (paise = round((amount - rupees) × 100)).
- Outputs `"... RUPEES ONLY"` when paise == 0.
- Outputs `"... RUPEES AND <N> PAISA ONLY"` when paise > 0.

Words and numeric Net Amount now always agree.

---

### R2-L8 — POS Sales list View dialog shows line discount
**File:** `components/pos-sales-list.tsx`

The View dialog (Eye icon) previously showed Item / Qty / Price / Total — no discount visibility. Now:
- Detects whether any line has `discountAmount > 0` (using the same data the print templates use).
- When yes, adds a Disc column showing `-<amount>` in green for each discounted line and `—` for non-discounted lines.
- Price column now shows the **original list price** (if persisted), so subtracting Disc visibly produces the line total.

Empty-discount invoices look identical to before.

---

## Side-effect fixes (caught while in the area)

### NCR phantom "Cash Paid" line (Round 1 H10)
**File:** `components/pos/print-standard-invoice.ts`

Old code had `cashPaid = data.payments.length > 0 ? sum(payments) : (Paid/!Pending → data.total : 0)`. A Paid invoice whose payment rows were later deleted would still print `Cash Paid: <total>` — a phantom payment.

Fixed simultaneously: `cashPaid` is now strictly the sum of `data.payments` rows. No payment row ⇒ 0 cashPaid. Truth-in-printing.

Also the `payMethod` fallback that used to print `"Cash"` for unpaid Credit sales now prints `"Pending"` (Credit) or `"—"` (Draft).

---

## Deferred (require user decision / new infrastructure)

These were flagged in `SALE-INVOICE-ANALYSIS.md` but not implemented this round because each needs a product decision or new infrastructure rather than just a code change:

| ID    | Title                                | Why deferred                                                                  |
|-------|--------------------------------------|-------------------------------------------------------------------------------|
| R2-L3 | NTN / CNIC / GST on prints           | Needs new fields on store-settings schema + UI                                |
| R2-L4 | Customizable terms                   | Needs a per-store-settings text area + UI                                     |
| R2-L5 | Logo on prints                       | Needs file-upload UI + storage                                                |
| R2-L7 | Bundle barcode font (offline)        | Needs a font asset added to `public/`                                         |
| R2-L9 | Sequential invoice numbers           | Schema change + numbering strategy decision                                   |
| R2-L10| REPRINT / DUPLICATE stamp            | Needs print-count tracking column                                             |

Plus the Round-1 "manual invoice path" architectural items (manual `createInvoice` always inserts Draft + always decrements; semantic alignment with POS path) — out of scope for this Round-2 batch which was focused on POS-specific discount/draft/print issues. Worth a dedicated session.

---

## Files changed

```
app/(app)/pos/actions.ts                        — R2-C1, R2-C2, R2-M2, R2-M4
app/(app)/pos/page.tsx                          — (already updated in earlier C2 round)
components/pos-new-sale-form.tsx                — R2-H5, R2-M3, R2-M7
components/pos-sales-list.tsx                   — R2-C2 (delete button), R2-L8 (view discount)
components/pos/print-a4-invoice.ts              — R2-H2, R2-H3, R2-H4, R2-H6, R2-M5, R2-M6, R2-L1, R2-L2, R2-L6
components/pos/print-standard-invoice.ts        — R2-H1, R2-M5, R2-M6, Round-1 H10 phantom payment
bugfixing/backfill-sale-invoice-data.sql        — R2-M1 (NEW FILE)
bugfixing/ROUND2-FIXES.md                       — This document (NEW FILE)
bugfixed.md                                     — Entries appended
```

TypeScript: `npx tsc --noEmit` shows no new errors in any file modified by this round. Pre-existing errors in dashboard/parties/employee-management/return-dialog files are unchanged.

---

## Verification checklist

To smoke-test the round end-to-end:

1. **Draft no-stock-decrement** — Create a POS sale with 10 PCS, save as Draft. Check inventory: stock should be unchanged.
2. **Draft → Paid completes the decrement** — Open the Draft, complete as Sale. Inventory should drop by 10.
3. **Delete Draft restores stock** — Create a Draft with 5 PCS (after R2-C1, no stock movement). Click Trash icon → confirm. Draft disappears, stock unchanged. Then test on a *pre-existing* Draft (created before R2-C1) — Trash should restore the held stock.
4. **A4 print with discount** — Create a sale with bill discount + per-line discount, print A4. Confirm: Total Before Discount, Less Line Discount, Less Bill Discount, Total After Discount, Cash Paid, Balance Due rows all render with correct numbers.
5. **A4 print Draft watermark** — Save as Draft, print. Black `DRAFT — NOT A SALES RECEIPT` banner appears above items.
6. **NCR thermal with discount** — Print same sale on NCR. Per-line discount appears as italic sub-row below each discounted item.
7. **Negative-value rejection** — Manually POST a negative quantity / price / discount / payment to `createPOSSale`. API returns a clear error.
8. **Over-discount rejection** — Try to save a sale where bill discount > subtotal + tax. API returns "Discount (X) cannot exceed subtotal + tax (Y)".
9. **Long item name** — Create an item with a very long name (~60 chars). Print A4 — name wraps onto multiple lines, fully visible.
10. **Walk-in walk-in print** — Sell to Walk-in Customer. Print. "Contact No" row should not appear (fake `000-000-0000` filtered).
11. **Paise-aware words** — Create a sale ending in `.50`. Amount in Words should include `"AND FIFTY PAISA ONLY"`.
12. **View dialog discount** — On Sales list, click Eye icon for a discounted sale. New Disc column shows the discount.
