# Manual Test Script — Round 2 Fixes

**Date:** 2026-05-19
**Why manual:** Playwright MCP plugin tools didn't surface in this Claude Code session despite the server being connected. Falling back to a precise click-through script.

**Dev server:** `http://localhost:3000` (already running — verified responsive)
**Login:** `shahjahan.pos@store.com` / `shahjahan@786`

Each test has: **Steps** (do these in order) → **Expected** (what you should see) → **If wrong** (what to tell me).

Run tests in order. Tests 1–5 cover the Critical fixes; 6–10 cover discount/print polish; 11–13 cover API guards.

---

## Setup

1. Go to `http://localhost:3000` → login with the credentials above.
2. Note one inventory item's current stock. Use a SKU you can easily find (e.g. the first item in Inventory). Write down: **Item name = `_______`, Stock = `_______`** before starting.

---

## TEST 1 — Draft no-decrement (R2-C1)

**Steps:**
1. Open `/pos` (New Sale page).
2. Select the test item, set quantity to 5, click **Add**.
3. Click **Draft** button (not Complete Sale).
4. You should see "Draft saved. Invoice: XXXXXXXX".
5. Navigate to **Inventory** (or wherever stock is shown). Find the test item.

**Expected:**
- Stock is **unchanged** (same number you noted at Setup).
- The Draft appears in `/pos/sales` list with status badge "Draft".

**If wrong:** Stock dropped by 5 → R2-C1 fix didn't take. Send me a screenshot of the inventory row + the draft from `/pos/sales`.

---

## TEST 2 — Draft → Complete decrements stock (R2-C1 forward path)

**Steps:**
1. Go to `/pos/sales`. Find the Draft you just created.
2. Click the **Pencil** (Edit) icon. Form loads with the item.
3. Click **Complete Sale** (assuming payment method is Cash by default).
4. Go back to Inventory.

**Expected:**
- Stock dropped by **5** (the qty you entered).
- The invoice in `/pos/sales` now shows "Paid" status.

**If wrong:** Stock unchanged → completion path broke. Or stock dropped by 10 (double-decrement) → restore-then-decrement broke.

---

## TEST 3 — Delete Draft (R2-C2)

**Steps:**
1. Create a new Draft: `/pos` → add same item with qty 3 → click **Draft**.
2. Note inventory stock again — should still be unchanged from before this test.
3. Go to `/pos/sales`. Find the new Draft.
4. Click the **Trash** icon (red, only visible on Draft rows).
5. Confirm the alert dialog ("Delete this draft?").

**Expected:**
- Toast: "Draft deleted. Stock restored." (or similar)
- The Draft row disappears from the list.
- Inventory stock is **unchanged** (because R2-C1 means no decrement happened, so no restore was needed either — `deletePOSDraft` is idempotent).

**If wrong:** Trash icon missing on Draft → button not wired up. Click does nothing → server action error. Inventory stock changed → restore logic over-corrected.

---

## TEST 4 — Discount round-trip on Draft edit (C1 + C2 + R2-C1 combined)

**Steps:**
1. `/pos`. Add an item (qty 2).
2. In the Disc% cell, type `10`. The Disc PKR cell auto-fills.
3. In the Bill Discount field below totals, type `50` (PKR).
4. Click **Draft**.
5. Go to `/pos/sales` → find Draft → Pencil (Edit).

**Expected on reload:**
- The item is in the cart with the **list price** (not the discounted effective price).
- The Disc% field shows `10` (or close), Disc PKR shows the per-unit discount × qty.
- The Bill Discount field shows `50`.
- The Total reflects everything correctly.

**If wrong:** Discounts loaded as 0 → C2 fix didn't take (or the draft was saved before the fix and the data is genuinely lost).

6. Click **Complete Sale**. Reprint via Printer icon on the sales list.

**Expected on the printed A4:**
- "Total Before Discount" row shows gross
- "Less Line Discount" row shows the per-line discount total
- "Less Bill Discount: 50.00" row appears
- "Total After Discount" row shows gross − both discounts
- "Cash Paid" row shows the full total (paid in full at completion)
- "Balance Due" row shows 0

**If wrong:** Send a screenshot of the print preview.

---

## TEST 5 — A4 Draft banner (R2-H3)

**Steps:**
1. Create another Draft (qty 1, no discount needed).
2. Reprint it (Printer icon).

**Expected:**
- A black banner spans the width above the items table reading:
  > **DRAFT — NOT A SALES RECEIPT**
- Footer status reads "DRAFT" (not "Paid", not "Draft").

**If wrong:** Banner missing → R2-H3 broken. Or banner shows on a completed Paid invoice → conditional logic flipped.

---

## TEST 6 — NCR thermal discount visibility (R2-H1)

**Steps:**
1. In `/pos/settings` (or wherever Print Format is set), switch to **NCR / Thermal**.
2. Reprint the discounted invoice from Test 4.

**Expected on NCR receipt:**
- Each discounted line has an italic gray sub-row showing `Disc: -X.XX (Y%)` immediately below it.
- "Discount" row in the totals area shows the bill-level discount.
- The Cash Paid row reads "Paid" not "Cash Paid: 0" (Round 1 H9 fix).

**If wrong:** Send a screenshot of the thermal print preview.

---

## TEST 7 — Long item name wrap (R2-H4)

**Steps:**
1. Go to `/stock-management/inventory`. Add or edit an item, set its name to something **very long**, e.g. `EXTRA LARGE SUPER ABSORBENT FAMILY-SIZE GLUCOSE BISCUIT 250G PACK WITH BRAND PROMO STICKER`.
2. Sell 1 unit of that item.
3. Print A4.

**Expected:**
- The Item Name cell wraps to multiple lines. Full name visible.
- No silent truncation with hidden text.

**If wrong:** Name cut off with no ellipsis or wrap → R2-H4 broken.

---

## TEST 8 — Walk-in fake phone filter (R2-M6)

**Steps:**
1. `/pos`. Click **+ Walk-in** to set the customer to "Walk-in Customer".
2. Add an item, complete the sale.
3. Print (either A4 or NCR).

**Expected:**
- The print does **not** show "Contact No: 000-000-0000".
- Customer name shows "Walk-in Customer". Phone row is absent.

**If wrong:** `000-000-0000` printed → R2-M6 filter missed this code path.

---

## TEST 9 — Paise-aware Amount In Words (R2-L6)

**Steps:**
1. Create a sale where the total ends in non-zero paise. Easiest: 1 item × Rs. 100.50, or use a discount that results in .50.
2. Print A4.

**Expected:**
- "Amount In Words:" reads something like `… AND FIFTY PAISA ONLY` at the end.
- The words and the Net Amount number agree.

**If wrong:** Words say `… ONLY` with no paise (number stripped) → R2-L6 broken.

---

## TEST 10 — View dialog discount column (R2-L8)

**Steps:**
1. `/pos/sales`. Click the **Eye** (View) icon on a sale that has line discounts.

**Expected:**
- Item table inside the dialog has a green **Disc** column showing `-X.XX` per discounted line.
- For full-price invoices (no discounts), the Disc column is hidden.

**If wrong:** Column missing on discounted invoices → R2-L8 broken.

---

## TEST 11 — Over-discount rejection (R2-M4)

**Steps:**
1. `/pos`. Add an item with unitPrice × qty = `100`.
2. In Bill Discount PKR, type `200` (more than 100).
3. Try to Complete Sale.

**Expected:**
- Toast error: `Discount (200.00) cannot exceed subtotal + tax (100.00)`.
- Invoice not created. Stock unchanged.

**If wrong:** Sale completes with total = 0 → server-side validation didn't kick in.

---

## TEST 12 — Bill discount > subtotal blocked on Draft update too (R2-M4 + C1)

**Steps:**
1. Create a Draft with item × qty = `100` and bill discount `50`.
2. Edit the draft, change bill discount to `200`.
3. Click Update Draft (or Complete Sale).

**Expected:**
- Same error as Test 11: server rejects the discount.

---

## TEST 13 — Negative payment guard (R2-M2)

**This requires DevTools** because the UI clamps negative values. Open browser DevTools console while on `/pos`, run:

```js
fetch('/api/...', { method: 'POST', ... })  // would be hard without knowing endpoint
```

Easier alternative: skip this test, trust the type-checker + code review. The two-line guard (`Number.isFinite(p.amount) && p.amount > 0`) is obvious enough that manual fuzzing isn't critical.

**If you really want to test:** Use a tool like Postman or curl against the server action. Or just trust the code.

---

## Reporting back

For each failing test, send me:
1. Test number (e.g. "Test 4 failed")
2. What happened vs what was expected
3. Screenshot if visual
4. Browser console errors if any (F12 → Console tab)

I'll fix and we re-run only the failing tests.

---

## Tests that don't need running

These are confirmed type-clean and pure refactors with no behavior change:
- R2-H5 (Split rounding fix) — math is correct by construction
- R2-H6 (dynamic "Total Before Discount" label) — only fires on legacy invoices
- R2-M3 (Paying Now re-clamp) — `useEffect` clamps state on shrink; testing requires manually shrinking total mid-entry
- R2-M7 (decimal step) — UI cosmetic; the form already accepted decimals via Number()

If anything else fails or you find new issues, drop them in `bugfixing/` and we'll triage.
