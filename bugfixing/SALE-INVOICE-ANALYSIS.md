# Sale Invoice — Deep Diagnostic

Scope: every code path that creates, edits, fetches, lists, displays, or prints a sale invoice. POS path + manual `app/(app)/invoices` path. Print: A4 and NCR/thermal templates.

Status: **DIAGNOSIS ONLY**. No fixes applied. Each finding is pending approval before implementation.

Files audited:
- `app/(app)/pos/actions.ts`
- `app/(app)/invoices/actions.ts`
- `components/pos-new-sale-form.tsx`
- `components/pos-sales-list.tsx`
- `components/pos/print-a4-invoice.ts`
- `components/pos/print-standard-invoice.ts`
- `app/(app)/pos/page.tsx`
- `app/(app)/pos/sales/page.tsx`
- `lib/types/pos.ts`
- `migrations/add-line-discount-columns.sql`

Severity legend: **🔴 Critical** (data loss / wrong money) · **🟠 High** (visible UX or business-rule bug) · **🟡 Medium** (functional gap, edge case) · **⚪ Low** (cosmetic / cleanup).

---

## 🔴 CRITICAL

### C1. `updatePOSSale` silently drops the bill-level discount and miscomputes the total
**Where:** `app/(app)/pos/actions.ts:1013-1117` (function signature + total math).

The function signature has **no `discount` field** in its payload. Then at line 1082:

```ts
const subtotal = payload.items.reduce(...)
const tax = subtotal * (taxRate / 100)
const total = subtotal + tax        //  ← bill discount NOT subtracted
```

Header update at line 1090 writes `{ subtotal, tax, total }` — never touches the `discount` column. Two consequences:

1. If the original Draft was saved with `discount = 250`, after edit `sales_invoices.discount` stays at 250 but `total` is recomputed without subtracting it → **stored `total` is now 250 PKR too high**.
2. If the cashier changes the bill discount on the draft editor, **the change is silently discarded**.

`createPOSSale` does this correctly (line 62: `total = subtotal + tax - discount`). The two paths diverge.

**Impact:** Wrong invoice total whenever a Draft with a bill discount is edited. The customer is over-billed by the discount amount.

---

### C2. `getPOSSaleForEdit` does not load discount info at all
**Where:** `app/(app)/pos/actions.ts:975-1011`.

The select pulls `item_id, quantity, unit_price` only — no `original_unit_price`, no `discount_amount`, no header `discount`.

When you load a Draft to edit it, every line walks in with discount = 0 and the bill-level discount field shows blank. If the operator clicks "Update Draft" or "Complete Sale" from that screen, the persisted discount info is **overwritten with zeros**.

Pair this with C1: Drafts with discounts cannot survive an edit round-trip.

**Impact:** Line discounts + bill discounts are destructive-on-edit. The Disc% / Disc Amt / Net Price columns on the printed invoice will show 0 after an edit even when they were non-zero before.

---

### C3. ~~`isOwner` is inverted on the New Sale page~~ — **WITHDRAWN**
**Where:** `app/(app)/pos/page.tsx:80`.

Withdrawn after verifying `lib/types/user.ts:3`: the `UserRole` enum is `"pos_user" | "sub_pos_user"`, where **`pos_user` is the owner/admin** (main POS account) and `sub_pos_user` is the cashier. The naming is confusing but the check `isOwner: currentUser.role === "pos_user"` is **correct as written** — Margin shows for owners, hidden for sub-users. No bug here. Apologies for the noise.

---

### C4. `getInvoiceForPrint` does not restrict to `source = "pos"`
**Where:** `app/(app)/pos/actions.ts:279-300`.

A user who owns both a manual invoice and a POS invoice could pass *either* ID into `getInvoiceForPrint`. For a manual invoice:
- `pack_size`, `pack_unit` will be present (same `inventory_items`) — OK
- `original_unit_price`, `discount_amount` will be null/zero — OK
- `payments` will be the manual-invoice payment rows — OK
- but the template renders an A4/thermal **POS** receipt for a non-POS document

Not a security hole (ownership is checked), but a data-shape inconsistency. Mirror the constraint added to `createCustomerPayment` (line 597: `.eq("source", "pos")`).

Cross-check: `getInvoiceForPDF` (the manual path, `app/(app)/invoices/actions.ts:119`) has no `discount` field in its return, and its `InvoiceForPrint`-shaped object is missing fields — see **H6** below.

**Impact:** Currently survivable, but the moment manual-invoice tooling diverges further (e.g. CTN columns) this will misrender.

---

### C5. The mojibake em-dash in the cashier fallback
**Where:** `app/(app)/pos/actions.ts:428`.

```ts
cashier: user.name || user.email || "â€”"
```

That literal is the UTF-8 bytes of `—` decoded as Latin-1 — left over from a paste at some point. When `user.name` and `user.email` are both falsy, the printed receipt's "User:" field shows the garbage string `â€"` instead of a clean dash.

**Impact:** Visible printed-receipt glitch in a fallback path. Trivial fix (`"—"` or `"-"`) but worth catching now because it sits in produced HTML.

---

## 🟠 HIGH

### H1. `subtotal` stored on `sales_invoices` is post-line-discount, but client + print template treat it as pre-discount
**Where:**
- Form (`components/pos-new-sale-form.tsx:625`): `subtotal = Σ unitPrice × quantity` — uses the *list price* `line.unitPrice` ⇒ **gross**.
- Server (`app/(app)/pos/actions.ts:60`): `subtotal = Σ item.quantity × item.unitPrice` — but `item.unitPrice` here is the *effective* per-unit (the client passes the after-discount unit, see form line 767) ⇒ **post-line-discount**.

So the column `sales_invoices.subtotal` semantics are different between create vs the in-form preview. The A4 print template currently reconstructs gross via `originalUnitPrice × quantity` (line 95), so the print is correct **for new invoices**. But:
- the **POS Sales List dialog** (`components/pos-sales-list.tsx:234`) shows `sale.subtotal` straight as "Subtotal", which is the post-line-discount value — and never shows the line-discount delta. The customer-facing dialog therefore disagrees with what the printed invoice shows.
- For old invoices saved before the line-discount migration, `unitPrice` *was* the effective price (discount baked in), so `subtotal` was post-line-discount. The print template now treats `originalUnitPrice == null` as "no discount", which produces correct visible output, but the column-meaning drift remains.

**Impact:** Inconsistent semantics. Subtle off-by-discount in any future report that reads `subtotal`. Recommended decision: pick one definition (gross before any discount is the cleaner choice — matches the printed "Total Before Discount" line) and back-compute on save.

---

### H2. `Sale` and `InvoiceForPrint` types are out of sync with the DB
**Where:** `lib/types/pos.ts:6-19` and `lib/types/pos.ts:41-77`.

- `Sale` has no `discount` field at all. The DB column exists; queries selectively return it. Anything that iterates `Sale[]` is blind to bill discounts.
- `InvoiceForPrint.discount` is **required** (not optional). But `getInvoiceForPDF` (manual invoice path) returns an object without `discount` and without `cashier`/`store`/`payments` etc., yet some call sites expect `InvoiceForPrint`. Likely a TS hole hidden by `as any` casts elsewhere.

**Impact:** Easy to break when new code does `sale.discount` and gets undefined. Hidden bugs ride along.

---

### H3. `updatePOSSale` does not use `recalcInvoicePaymentStatus`
**Where:** `app/(app)/pos/actions.ts:1108-1116`.

Inline logic: `payment.amount >= total ? "Paid" : "Pending"`. Three problems:
1. Floating-point — see how `recalcInvoicePaymentStatus` does cents-rounded comparison; this inline version doesn't.
2. Does not sum *existing* payments on the invoice; only looks at the new payment in the current update. If the draft already had partial payments (somehow), they're ignored.
3. The non-Credit branches (e.g. transitioning a draft → Paid with status "Paid" already passed in) skip status recalc entirely.

The codebase has a centralized helper for exactly this; the POS update path opts out.

**Impact:** Status drift on edge-case edits (extremely rare in practice today because Drafts don't carry payments, but the inconsistency is a foot-gun for any future flow).

---

### H4. Bill-discount UX inconsistency — "Split" rewrites it as line discounts
**Where:** `components/pos-new-sale-form.tsx:718-732` (`applyGlobalDiscount`).

When the cashier types a PKR amount in **Bill Discount** and clicks **Split →**, the function pro-rates the amount onto each line's `discount` field, **then sets `discountAmount = 0`** so the bill-level field clears.

Result on the printed invoice:
- *Without Split:* "Less Bill Discount: X" row appears.
- *With Split:* "Less Line Discount: X" row appears, no Bill Discount row.

Same input from the cashier produces a different printed invoice depending on which button they tapped. Customers receiving rebills will see different layouts.

**Impact:** Confusing audit trail. The "what kind of discount this was" information is lost the moment Split is clicked. Decision needed: keep Split + relabel, or remove Split and let the server handle distribution at calc-time.

---

### H5. `applyGlobalDiscount` proportional rounding can drift
**Where:** `components/pos-new-sale-form.tsx:723-729`.

Each line gets `Math.round(proportionalPKR * 100) / 100`. After rounding, `Σ line.discount` may differ from the input total by a few paise. The "total" line will then be off by that rounding error — silently — because the server recomputes from line items.

**Impact:** Penny drift. Per-invoice ≤ 0.5 PKR. Accumulates over many sales. Fix: assign the remainder to the largest line.

---

### H6. Manual `getInvoiceForPDF` returns an incomplete shape
**Where:** `app/(app)/invoices/actions.ts:206-222`.

Returns `{ id, invoiceNumber, date, party, subtotal, tax, total, status, items, payments }` — no `discount`, no `cashier`, no `store`, no `transactionId`. If anyone routes a manual invoice through the same print templates (which expect `InvoiceForPrint`), the store header is blank, the cashier line shows the mojibake fallback (C5), and discounts/CTN are silent.

Today this isn't called from a print path that I can find — but the type promise is broken.

**Impact:** Footgun for the next person who wires manual invoices into the POS print pipeline.

---

### H7. `createInvoice` (manual) does not write `source`
**Where:** `app/(app)/invoices/actions.ts:55-65`.

The insert omits `source`, so manual invoices land with `source = NULL` (or the column default if any). Queries that filter `.eq("source", "pos")` correctly exclude them; queries that don't filter (e.g. dashboard "Total Sales") will include them — which is correct only if your dashboard *intends* to count them. The lack of an explicit `source: "manual"` makes this implicit and hard to audit.

**Impact:** Currently benign but brittle. Any future "POS-only" report that forgets the filter will silently include manual invoices.

---

### H8. Manual `createInvoice` defaults `taxRate` to 18; POS defaults to 0
**Where:** `app/(app)/invoices/actions.ts:49` vs `app/(app)/pos/actions.ts:58`.

Two creation paths, two different defaults. Manual `updateInvoice` line 297 also defaults to 18. POS `updatePOSSale` defaults to 0 (line 1079).

**Impact:** Identical-looking forms produce different totals depending on path. Pick one and document it.

---

### H9. NCR thermal print: `payMethod` falls back to literal "Cash" when no payments exist
**Where:** `components/pos/print-standard-invoice.ts:56-58`.

```ts
const payMethod = data.payments?.length > 0
  ? [...new Set(data.payments.map((p) => p.method))].join(" / ")
  : "Cash"
```

Drafts and pure-Credit sales have **no payment row**. The receipt then prints `Cash Paid: 0` and `Payment: Cash` — implying "paid in cash" when the customer paid nothing. The same fallback is in A4 (`print-a4-invoice.ts:67-69`).

**Impact:** Customer-facing printed receipt says "Cash" for an unpaid credit sale. Misleading.

---

### H10. NCR print misreports "Remaining Balance" for fully-paid Drafts
**Where:** `components/pos/print-standard-invoice.ts:54-59`.

```ts
const cashPaid = data.payments?.length > 0
  ? data.payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  : (data.status === "Pending" || data.status === "Draft" || data.status === "Credit") ? 0 : data.total
```

For a *Draft* with no payments, `cashPaid = 0`, `remainingBalance = data.total` → receipt prints "Remaining Balance: <total>". OK for drafts. But:
- A **Paid** invoice whose `payments[]` array is empty (data anomaly) falls into the `else` branch → `cashPaid = data.total` → "Cash Paid: <total>" row, even though no payment row exists. Phantom payment.

**Impact:** Reprinting a Paid invoice whose payment was deleted will lie about cash received.

---

## 🟡 MEDIUM

### M1. `recalcInvoicePaymentStatus` ignores returns / refunds for status decisions
**Where:** `lib/db/invoice-payment-status.ts` (called from POS payment lifecycle).

The function is called with `invoiceTotal = sales_invoices.total` (gross). Returns reduce what the customer actually owes, but the helper does not subtract them. A customer who returned half the invoice but has paid the other half stays in "Pending" forever instead of going to "Paid".

This is why the *Outstanding Receivables* card has to do its own returns subtraction in JS (`getUnpaidPOSSales` lines 927-948). Status column on the DB is therefore unreliable for "is this paid off?" — every consumer reimplements the same delta.

**Impact:** Inflated outstanding counts visible on status badges. Already worked around in two places (dashboard, payments page); not worked around in `getCustomerPayments`, `getPaidSales`, the Sales list status badge, or any external integration.

---

### M2. `addLine` doesn't reset `packQty`
**Where:** `components/pos-new-sale-form.tsx:655-692`.

After adding a line, `setSelectedItem("")` + `setQuantity(1)` run, but `packQty` retains the previous CTN string. The CTN input is hidden when `hasPack` becomes false (no selected item), so it's not visible — but the value persists until the next item is selected.

Then the `useEffect` at line 410 re-syncs `packQty` from `quantity / selectedPackSize` *only when `selectedItem` changes*. If the next selected item has the same packSize, the effect dependency may not refire on the same value. Minor edge case — usually re-syncs because `selectedItem` (the ID) changes.

**Impact:** Possible stale CTN display on second item add. Cosmetic.

---

### M3. `updatePOSSale` doesn't validate party ownership
**Where:** `app/(app)/pos/actions.ts:1013-1092`.

`createPOSSale` calls `verifyPartyOwnership` (line 30). `updatePOSSale` accepts `payload.partyId` and writes it into the invoice header (line 1090) without checking that the party belongs to the user.

A determined caller could swap the party on their own draft to *another user's* party ID. The invoice itself remains owned by them (because `eq("user_id", currentUser.effectiveUserId)`), but the row will reference a foreign party — manifesting as orphaned ledger entries on the victim's party.

**Impact:** Cross-tenant data corruption potential via crafted request. Low likelihood of exploitation, real risk surface.

---

### M4. `updatePOSSale` doesn't validate inventory item ownership
**Where:** `app/(app)/pos/actions.ts:1119-1128`.

Same flavor as M3: items are queried by `id IN (...)`, but the result is used only to fetch `cost_price`. There's no check that all requested items came back. A draft can be updated to reference a foreign user's item; stock decrement happens (via the RPC) on whichever row matches the ID.

**Impact:** Could decrement another user's stock by editing your own draft. Defensive `eq("user_id", ...)` is on the SELECT but the size check `invItems.length !== itemIds.length` is missing — so a missing item just gets `cost_price = null` and proceeds.

---

### M5. Stock-restore on draft update may race
**Where:** `app/(app)/pos/actions.ts:1053-1073` + `1144-1167`.

Sequence: restore old stock → delete old lines → update header → insert payment → fetch costs → insert new lines → decrement new stock. No transaction. If decrement fails on the new stock, the old stock was already restored, old lines were already deleted, and the new lines were already inserted. We `return error` but the invoice now has new lines with no stock decrement recorded.

The same problem exists in `createPOSSale` rollback (line 156 deletes the invoice on stock failure — but if `recordStockMovement` succeeded for the first item then `decrement_inventory_stock` fails for the second, the first item's stock IS decremented but stock movement was recorded and **never undone**; invoice gets deleted, accounting drift).

**Impact:** Partial-failure inventory drift on draft edits and concurrent POS sales. Rare but real. Fix is broader — needs a true DB transaction (the codebase already has `lib/db/transaction-helper.ts` per ANALYSIS.md Phase 4).

---

### M6. A4 print: `setTimeout(300)` before `win.print()` is fragile
**Where:** `components/pos/print-a4-invoice.ts:399-402`.

`document.write` is sync but layout isn't guaranteed in 300ms on slow Windows machines. The NCR template uses 600ms because of font load. If a customer adds a `<link>` to a Google Font in the A4 template later, 300ms breaks.

**Impact:** Occasionally blank-first-page prints on slow hardware. Cosmetic, easy to harden with `onload` + `setTimeout` fallback.

---

### M7. A4 print: popup blocked → silent no-op
**Where:** `components/pos/print-a4-invoice.ts:391-395` (and the equivalent in standard print).

```ts
const win = window.open(...)
if (!win) { console.error(...); return }
```

`handlePrint` in the form wraps the call in `try/catch` and shows `toast.success("Print dialog opened")` *after* the await resolves. If `printA4Invoice` returns early without opening a window, the toast is still success — user sees green toast, no print dialog, nothing in browser dev tools they'd think to check.

**Impact:** Confusing UX when popups are blocked. Fix: return a result from the print helpers and surface a real `toast.error` on failure.

---

### M8. `numberToWords` rounds the net amount to integer for words
**Where:** `components/pos/print-a4-invoice.ts:143`.

`numberToWords(Math.round(netAmount))` — `4500.50` becomes `"FOUR THOUSAND FIVE HUNDRED ONE ONLY"` while the numeric "Net Amount" row shows `4,500.50`. The words and the number disagree by 0.50 paise.

Pakistani convention is to drop or write "AND FIFTY PAISA". Pick one and align.

**Impact:** Customer notices "FIVE HUNDRED ONE" written but bill shows 500.50 — looks like a fraud trigger.

---

### M9. CTN total in footer can show floating-point garbage
**Where:** `components/pos/print-a4-invoice.ts:313-319`.

`totalPack = Σ qty / packSize`. If a row has `qty = 100, packSize = 24`, that's `4.16666...`. Display uses `Math.round(totalPack * 100) / 100` → `4.17`. Fine. But if multiple rows compound, the floor may show as `12.6700000001`. The rounding catches it.

**Impact:** None today. Flagged because the same `Number.isInteger(totalPack)` check before rounding will be false even when the displayed value rounds to an integer.

---

### M10. Print invoice number = first 8 chars of UUID
**Where:** Multiple — `getInvoiceForPrint` line 417, `getInvoiceForPDF` line 211, NCR template line 46, A4 template line 57.

Customers in Pakistani wholesale expect sequential bill numbers (1001, 1002, …). The current first-8-chars-of-UUID is non-sequential, looks like noise. There's no `invoice_number` column with a monotonic counter.

**Impact:** Major UX gap for the target market. Business decision — flag for the user to confirm whether they want a real sequential numbering scheme.

---

### M11. `store.name` falls back to "InvoyncSync" on the print template
**Where:** `app/(app)/pos/actions.ts:399-403`.

If a user hasn't set their store name, every printed receipt says "InvoSync". Should probably be empty or a more neutral fallback so the cashier notices and configures it.

**Impact:** Branding wrong on initial setup. Easy fix.

---

### M12. `store.email` is stored, never printed
**Where:** `getStoreSettings` returns `email`, but neither print template includes it.

**Impact:** User-configured email field is dead data. Either show it on prints or drop the field.

---

## ⚪ LOW

### L1. `(invoice as any).discount` cast
**Where:** `app/(app)/pos/actions.ts:422`. The select on line 287 includes `discount`, so the typed result already has it. Cast is unnecessary noise.

### L2. Sale list `Eye` dialog hides line discount
**Where:** `components/pos-sales-list.tsx:203-229`. Shows Item / Qty / Price / Total but doesn't show Disc% or original price. The user just told us (a few iterations ago) that discount visibility matters — yet the in-app preview is silent on line discounts.

### L3. A4 print colgroup widths sum to 101% in the no-pack case
**Where:** `print-a4-invoice.ts:283-292`. Cosmetic; browsers normalize.

### L4. A4 print has no `page-break-inside: avoid` rules
**Where:** Whole template. Long invoices may split mid-row across pages.

### L5. A4 print fmtDate uses local timezone
**Where:** `print-a4-invoice.ts:14-20`. Two browsers in different timezones print different dates for the same invoice.

### L6. Walk-in phone "000-000-0000" leaks onto the printed receipt
**Where:** `app/(app)/pos/actions.ts:466` (insert) + A4 template line 242. Cosmetic — printed invoices for walk-in customers show a fake phone.

### L7. `Cancelled` status isn't reflected on the print
**Where:** No template handles the status. A cancelled invoice prints as if it's live. Minor — but if a return is processed via cancellation, the printout doesn't say so.

### L8. `transactionId` computed but never used in templates
**Where:** `getInvoiceForPrint` line 393. Field is set, neither template renders it.

### L9. `pos_thermal` legacy print format
**Where:** `getUserPrintFormat` line 248. A previous value `pos_thermal` maps to `pos_ncr`. Old setting still in DB; comment notes the migration but no rewrite is performed. Stays a string in user_settings forever.

### L10. POS New Sale form's `priceType` effect overwrites cart prices
**Where:** `components/pos-new-sale-form.tsx:537-552`. Switching the rate selector (Cash/Credit/Supplier) rewrites unit prices on **every existing line**, blowing away any manual price overrides the cashier typed in. No warning dialog. Major UX papercut if you don't know about it.

### L11. NCR Print barcode font load via Google Fonts
**Where:** `print-standard-invoice.ts:228-229`. Requires internet to render the bottom barcode. Offline POS prints the digits but no scannable barcode. Worth flagging.

### L12. Search box on Sales list searches only invoice # and customer name
**Where:** `pos-sales-list.tsx:34-40`. No search by amount, date, item. Adequate for now.

### L13. POSSalesList view dialog's "Discount" row reads `viewInvoiceData?.discount`
**Where:** `pos-sales-list.tsx:242`. Only the bill-level discount shows; line discounts are invisible. Combined with L2, the dialog severely understates what was discounted.

---

## Cross-cutting themes

1. **The `subtotal` / `discount` / `total` columns have ambiguous semantics.** Different code paths treat them differently. A one-page "schema contract" doc plus a migration to normalize would prevent recurrent regressions.

2. **No DB transactions on multi-step writes.** Every action (`createPOSSale`, `updatePOSSale`, `createInvoice`, `updateInvoice`, `deleteInvoice`) does a sequence of inserts/updates/RPCs that can partial-fail. The `lib/db/transaction-helper.ts` exists but is not wired in — this is Phase 4 of `ANALYSIS.md`.

3. **POS path vs Manual-invoice path have diverged.** Different defaults, different status logic, different shape of returned data. Even though the user said "phase 4 nahi karna", these two paths sharing 90% of their logic is the root of several Critical findings here (C1/C2/H7/H8).

4. **Print templates re-derive numbers client-side.** Tax rate %, gross before discount, payment-method labels — all reconstructed in the template instead of being sent down clean. Every reconstruction is a chance to disagree with the server's version. Sending pre-computed display values would shrink the bug surface.

5. **The cashier sub-user role check is inconsistent.** C3 flips it for the Margin toggle. Other privilege checks elsewhere may have the same flip — worth a focused audit pass.

---

## Suggested triage order

If you want to ship fixes one priority at a time, my recommended sequence:

1. **Fix C1 + C2 together** — the "edit a draft loses its discounts" pair. Visible, reproducible, costs the cashier real money on every reprint of an edited draft.
2. **Fix C3** — `isOwner` flip. One-line change, biggest impact on data privacy.
3. **Fix C5** — mojibake em-dash. One-character change, visible on every receipt with the fallback path.
4. **Fix H9 + H10** — receipt lies about payments. Visible on every Credit / Draft receipt.
5. **Decide on H4** — keep "Split" or remove it; relabel either way.
6. **Decide on M10** — sequential invoice numbers. Business decision that should be made before more invoices are generated under the current scheme.
7. **Sweep C4 + H1 + H2 + H6 + H7 + H8** — semantic alignment of the POS vs manual paths. Best done as one refactor.
8. **M3 + M4** — ownership checks on `updatePOSSale`. Defensive hardening.
9. **M5 + M11 + M12 + L-series** — cleanups and cosmetics.

Per your workflow rule ("phele bug fixing then bugfiesd files ko use karo"): **none of the above are implemented yet.** Tell me which finding(s) you want to tackle first and I'll move them to `bugfixed.md` as Pending → Resolved as we go.

---

# Round 2 — Deeper findings (added 2026-05-19)

After implementing C1 / C2 / C5, second pass on discount / draft / print specifically. These are NEW findings on top of the Round 1 list above.

## 🔴 ROUND-2 CRITICAL

### R2-C1. Drafts decrement stock immediately — abandoned Drafts hold stock forever
**Where:** `app/(app)/pos/actions.ts:136-159` (createPOSSale), `app/(app)/pos/actions.ts:1146-1184` (updatePOSSale), `app/(app)/invoices/actions.ts:87-112` (manual createInvoice).

`createPOSSale` decrements stock and writes a stock movement audit row **unconditionally**, regardless of whether the invoice is being saved as Paid, Credit, **or Draft**. Same for `updatePOSSale`. Manual `createInvoice` hardcodes `status: "Draft"` and *also* decrements stock.

Scenario that breaks today:
1. Cashier rings up 100 PCS of an item, customer is undecided → cashier hits "Draft" to park the cart.
2. Inventory now shows `stock = stock - 100`.
3. Customer walks out without buying. Cashier moves on.
4. The Draft sits in `pos/sales` indefinitely with no cancel/delete UI (see R2-C2 below).
5. Physical inventory has 100 units. System inventory says 100 less. Re-order triggers fire incorrectly. Stock reports diverge from reality.

There's no "reservation" concept in the schema — the decrement is permanent until the Draft is completed or deleted. And it can't be deleted (R2-C2).

**Impact:** Permanent inventory drift the moment a cashier uses Drafts as a "park the cart" feature. The bigger the operation, the worse the drift.

**Decision needed:** Either
(a) Skip stock decrement for `status = "Draft"` and decrement only when the Draft is upgraded to Paid/Credit, **OR**
(b) Introduce an explicit `reserved_stock` concept (separate column) so Drafts hold stock visibly without inflating "sold" totals, **OR**
(c) Add a hard "Drafts expire after N hours and auto-restore stock" job.

(a) is the simplest and least invasive — the change is a `if (status !== "Draft")` guard around the existing decrement block, plus the mirrored restore on `updatePOSSale` if the previous status was Draft.

---

### R2-C2. No way to delete or cancel a Draft from the UI
**Where:** `components/pos-sales-list.tsx:146-282` — action buttons are only Edit / View / Reprint. No `deleteInvoice`-equivalent for POS sales exists in `app/(app)/pos/actions.ts`.

Combined with R2-C1, this means abandoned Drafts pile up forever, each one silently holding its line-item stock. The Sales list shows them as "Draft" badge but offers no way to expire or remove them.

**Impact:** Cashier has no recovery path. The only way to "fix" a stuck Draft is to load it via Edit, change items to zero (which fails — quantity must be ≥ 1), or complete it as a fake Paid sale (which corrupts revenue reports).

**Suggested fix:** Add a `deletePOSDraft(invoiceId)` server action that:
- Verifies ownership + `status === "Draft"`
- Restores stock for every line (mirrors the existing `incrementStockForLines` helper)
- Deletes lines + invoice rows
Wire to a Trash icon next to the Edit/View/Reprint buttons in `pos-sales-list.tsx`, gated on `sale.status === "Draft"`.

---

## 🟠 ROUND-2 HIGH

### R2-H1. NCR thermal receipt shows no per-line discount columns
**Where:** `components/pos/print-standard-invoice.ts:124-145`.

The thermal item table has columns: `Sr | Description | Qty | Rate | Amount`. Rate is the **effective** per-unit (post-discount). Amount is the line total post-discount. There is no Disc% column, no Disc Amt column, no original list price.

If a customer got a 20% discount on an item, the thermal receipt just shows the discounted rate as if it were the normal price. The customer can't tell they were given a discount. The A4 print *does* show it.

**Impact:** Customer doesn't see the value they received. Operationally, returns become a headache — when a customer comes back to return an item bought at 20% off, the thermal receipt shows the discounted rate; the cashier has to remember/look up the original.

---

### R2-H2. A4 print missing payment / balance-due row
**Where:** `components/pos/print-a4-invoice.ts:325-376` (bottom totals box).

The A4 totals box shows Gross / Less Discount / Tax / Net Amount. There is no "Cash Paid" row, no "Balance Due" row. For a Credit sale where the customer paid 500 of 1000, the A4 print just says "Net Amount: 1000" — the customer can't see they owe 500.

The NCR template *does* have these rows. Inconsistency.

**Impact:** Customer leaves with a printed Credit invoice that doesn't show their balance. Disputes follow.

---

### R2-H3. Drafts can be printed with no DRAFT watermark
**Where:** `components/pos/print-a4-invoice.ts` (no special handling); `components/pos/print-standard-invoice.ts:99-101` (shows "Draft Invoice" header bar but only on NCR, not A4).

On A4 the Draft prints with the same layout as a final sale. The bottom-right footer says `Status: Draft` in 9px text — easy to miss. A customer could accept a Draft print thinking it's a final receipt.

NCR is better — it has a "Draft Invoice" header bar. A4 should mirror this (a "DRAFT — NOT A SALES RECEIPT" watermark or banner).

**Impact:** Walk-in customer takes a Draft print, leaves; cashier never finalizes; no revenue recorded; stock already gone (because of R2-C1). Double-hit.

---

### R2-H4. A4 print: long item names get cut off
**Where:** `components/pos/print-a4-invoice.ts:178-191` (`.items td { overflow:hidden; }` + `table-layout:fixed`).

The Item Name column is fixed-width (22-26%). Long Pakistani SKUs like "PARLE-G ORIGINAL GLUCOSE BISCUIT 250G FAMILY PACK" will be silently truncated with no ellipsis or wrap. The customer can't verify what they bought.

`overflow:hidden` + `table-layout:fixed` was probably added to keep alignment stable, but the trade-off is invisible truncation.

**Impact:** Disputes when the customer comes back and the receipt says "PARLE-G ORIG..." instead of the full name.

**Suggested fix:** Either `word-wrap:break-word; white-space:normal` on the Item Name td, or use `text-overflow:ellipsis` so at least the cashier *sees* there's hidden text.

---

### R2-H5. `applyGlobalDiscount` proportional split drops paise on round
**Where:** `components/pos-new-sale-form.tsx:723-729`.

Each line: `Math.round(proportionalPKR * 100) / 100`. With 3 lines and 100 PKR bill discount, the sum of per-line discounts can land at 99.99 or 100.01. The form's total is computed from the per-line discounts (rounded), so the printed "Less Line Discount" row will be 99.99, not the 100 the cashier typed. The cashier feels the math is wrong.

Already in Round 1 (H5), restated here because it interacts with the Split→ button which is specifically for bill-level discount.

**Suggested fix:** assign the rounding remainder to the largest line so the sum exactly equals the typed amount.

---

### R2-H6. "Total Before Discount" label is misleading for old (pre-migration) invoices
**Where:** `components/pos/print-a4-invoice.ts:346`.

For invoices saved *after* the line-discount migration, `trueGrossSum = Σ originalUnitPrice × qty` ⇒ true gross. For invoices saved *before* the migration, `original_unit_price` is null, so `originalUnit = effectiveUnit + (persistedDiscount/qty)` = `effectiveUnit + 0` = `effectiveUnit`. The "Total Before Discount" therefore equals the **post-line-discount** subtotal.

In other words: when reprinting an old invoice that had a 10 PKR/unit line discount, the label "Total Before Discount" actually means "Total Before *Bill* Discount" — line discount is silently absorbed.

**Impact:** Reprints of historical invoices look wrong. The label promises something the data can't back up.

**Suggested fix:** Either rename the row dynamically based on whether any line has `original_unit_price` set, or backfill `original_unit_price = unit_price` on old rows so the math reconstructs cleanly (with discount_amount left at 0, the gross-vs-net distinction collapses to 0 line discount — which is accurate for old data).

---

## 🟡 ROUND-2 MEDIUM

### R2-M1. Old drafts edited after migration get bogus `original_unit_price` written
**Where:** `components/pos-new-sale-form.tsx:264-273` (cart state init) + `handleCompleteSale:764` (lineItems map).

For drafts saved before the line-discount migration, `getPOSSaleForEdit` returns `originalUnitPrice: null`. The cart init now does:
```ts
unitPrice: i.originalUnitPrice && i.originalUnitPrice > 0 ? i.originalUnitPrice : i.unitPrice
```
So cart `unitPrice` = the *effective* DB unit_price (the post-discount value).

If the cashier then adds a new discount to that line, `handleCompleteSale` sends:
```ts
originalUnitPrice: line.unitPrice,    // = effective DB price, NOT real list price
discountAmount: ...new discount...
```
The DB now holds `original_unit_price = effective` and a non-zero `discount_amount`. The next reprint thinks the *effective* price was the list price and shows the new discount as if it were the only one. The customer's invoice silently double-counts the discount (or rather, the old built-in discount disappears).

**Impact:** Only affects pre-migration drafts that get re-edited with new discounts after the C1/C2 fix. Edge case. Mitigation: backfill `original_unit_price = unit_price` on all old rows so old drafts behave like new ones.

---

### R2-M2. No negative-value guard on payment amounts
**Where:** `app/(app)/pos/actions.ts:584` (`createCustomerPayment` checks `amount <= 0` and rejects), but `createPOSSale:23` only checks `p.amount > 0` truthy — a negative number is truthy if not 0. `payments` are inserted with the raw negative value.

A crafted payload `{ payments: [{ amount: -500, ... }] }` could insert a negative payment, which decreases outstanding and confuses status calculations.

**Impact:** Low likelihood (UI doesn't allow it), real surface area on the API. Add `p.amount > 0` filter on the insert, and Math.abs / reject on `createCustomerPayment`'s amount.

---

### R2-M3. Form's "Paying Now" can exceed total via direct setter
**Where:** `components/pos-new-sale-form.tsx:1371`.

```tsx
onChange={(e) => setPayingNow(Math.max(0, Math.min(computed.total, Number(e.target.value) || 0)))}
```

Clamped at `Math.min(computed.total, ...)`. But if `computed.total` later shrinks (cashier removes a line), `payingNow` isn't re-clamped. State stays at the old higher value. On save, `payingNow > total` may be sent, status falls to "Paid" (because `payment >= total`), the over-payment is recorded as cash received, ledger over-counts.

**Suggested fix:** `useEffect` that clamps `payingNow` whenever `computed.total` decreases.

---

### R2-M4. `total = Math.max(0, ...)` silently clamps over-discount instead of rejecting
**Where:** `app/(app)/pos/actions.ts:1110` (my C1 fix).

I added `Math.max(0, subtotal + tax - discount)`. If the cashier mistakenly enters a discount higher than the subtotal + tax, the total becomes 0 silently — no error, the invoice prints as "Net Amount: 0". This is defensive but masks data entry errors.

**Suggested fix:** Validate `discount <= subtotal + tax` server-side and return an error if not. UI already clamps the input via `BillDiscountPercent`, so this is a belt-and-suspenders check.

---

### R2-M5. Reprinting a Credit sale with partial payment doesn't show the payment date
**Where:** `components/pos/print-standard-invoice.ts:152-189` (totals table).

The NCR shows "Cash Paid: X" but no per-payment breakdown. If the customer made 3 partial payments over a month, the reprint sums them as one line. The customer can't reconcile against their own records.

**Suggested fix:** A "Payment History" section in the print (NCR + A4) listing each payment row with date, method, amount.

---

### R2-M6. Walk-in fake phone "000-000-0000" leaks onto printed invoices
**Where:** `app/(app)/pos/actions.ts:466` writes the literal `"000-000-0000"` when auto-creating the Walk-in party. The print template then renders this on every walk-in invoice.

Already in Round 1 (L6). Re-flagged here because it interacts with the customer-facing print specifically.

**Suggested fix:** Either store `null` for walk-in phone, or have the print template recognize "000-000-0000" / known walk-in phone and skip the row.

---

### R2-M7. Bill-discount input has no decimal-step alignment with the % side
**Where:** `components/pos-new-sale-form.tsx:1336` (PKR input has `step={1}`), but the `BillDiscountPercent` writes a PKR value that may have 2 decimals. Switching back and forth between the two inputs produces drift.

**Impact:** Cosmetic flicker on the PKR field after editing %.

---

## ⚪ ROUND-2 LOW

### R2-L1. A4 print: status label uses raw enum
`Status: Paid` / `Status: Credit` / `Status: Pending`. Pakistani conventions prefer "Cash Sale" / "Credit Sale (Udhaar)" / "Partial Payment Pending". Already in NCR's header bar; A4 footer doesn't follow suit.

### R2-L2. A4 print has no "Print Date" footer
NCR has it. If you reprint an old invoice the customer has no way to know when this paper came out vs the original.

### R2-L3. Both templates omit NTN / CNIC / GST registration number
Pakistani business invoices typically print these. The store settings don't have fields for them either.

### R2-L4. Terms text is hardcoded
`1. Damage and expiry... 2. Plz Count Cash...` — no user customization. Different stores want different terms.

### R2-L5. No logo support
Header is text-only. Pakistani stores typically want a logo image.

### R2-L6. A4 print: `numberToWords` rounding mismatch with Net Amount
Already in Round 1 (M8). For invoices ending in .50, words and number disagree.

### R2-L7. NCR uses Google Fonts for the bottom barcode
Already in Round 1 (L11). Offline POS prints no scannable barcode.

### R2-L8. POS Sales list "View" dialog doesn't show line discount
Already in Round 1 (L2/L13). Re-flagged because it's the only in-app preview of a sale, and it lies about discount visibility.

### R2-L9. Print invoice number is UUID prefix
Already in Round 1 (M10). Re-flagged because Pakistani sequential numbering is a baseline expectation for the target market.

### R2-L10. Reprinting an already-printed invoice has no visual difference
There's no "REPRINT" or "DUPLICATE" stamp added on the second-and-later prints. Customer / cashier can't tell which is the original.

---

## Round 2 — Suggested next batch

Given you said discount + draft + print specifically, the most impactful next batch is:

1. **R2-C1 + R2-C2 together** — Drafts should not decrement stock, and there should be a way to delete them. Biggest operational bug remaining.
2. **R2-H1** — NCR thermal needs Disc% / Disc Amt visibility. Aligning with what A4 already shows.
3. **R2-H2** — A4 needs payment + balance-due rows. Aligning with NCR.
4. **R2-H3** — A4 DRAFT watermark / banner.
5. **R2-H4** — Item name wrap (one-line CSS fix).
6. **R2-H5** — Fix the rounding-drift in bill-discount Split.
7. **R2-H6 + R2-M1** — Backfill `original_unit_price = unit_price` on old `sales_invoice_lines` rows so the print template reconstructs correctly and old-draft edits don't silently corrupt data.

Bata do kaunsa pehle. Mein recommend karta hoon **R2-C1 + R2-C2 ek saath** — wo abhi sabse zyada damage kar raha hai (silent inventory drift via abandoned Drafts).
