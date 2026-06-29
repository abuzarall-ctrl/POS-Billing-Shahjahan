# Refund / Return Module — Deep Diagnostic

**Date:** 2026-05-19
**Scope:** Every code path that creates, lists, or refunds a return — both sale-return and purchase-return paths. Includes the supporting dialogs, listing pages, and accounts-management ledger integration.
**Status:** **DIAGNOSIS ONLY**. No fixes implemented yet. Each finding awaits triage before being moved to `bugfixed.md`.

Files audited:
- `app/(app)/returns/actions.ts`
- `app/(app)/returns/sales/page.tsx`
- `app/(app)/returns/purchases/page.tsx`
- `app/(app)/returns/refunds/page.tsx`
- `app/(app)/returns/reports/page.tsx`
- `components/sales-return-dialog.tsx`
- `components/purchase-return-dialog.tsx`
- `components/refund-dialog.tsx`
- `app/(app)/accounts-management/actions.ts` (refund integration)
- `lib/types/return.ts`

Severity legend: **🔴 Critical** (data loss, wrong money, cross-tenant) · **🟠 High** (functional gap / wrong business behavior) · **🟡 Medium** (edge case, hardening) · **⚪ Low** (cosmetic / cleanup).

---

## 🔴 CRITICAL

### RF-C0. **RETURN CREATION ITSELF IS BROKEN** — `generate_return_number()` trigger off-by-one
**Where:** `lib/db/combined-fresh-install.sql:436-453` (and the identical copy in `lib/db/migration-returns-refunds.sql:123-148`).

The PL/pgSQL function that auto-fills `returns.return_number` on insert has a SUBSTRING off-by-one bug:

```sql
prefix := 'RET-'     -- length 4
SUBSTRING(return_number FROM LENGTH(prefix) + 5 FOR 6)
                                              ^ off by one — should be + 6
```

For a value like `'RET-2026-000001'` (15 chars):
- Position 9 = `-` (the year/suffix separator)
- Position 10-15 = `000001` (the 6-digit number we WANT to read)

The current formula `LENGTH(prefix) + 5 = 9` starts the SUBSTRING at the dash. Result: `'-00000'`. PostgreSQL casts it to integer as `-0 = 0`. `MAX(...)` always returns 0. `new_num := 0 + 1 = 1`. **Every call generates the same `RET-YYYY-000001`.**

The first insert each year succeeds. Every subsequent insert fails with:
> `duplicate key value violates unique constraint "returns_return_number_key"`

This is the **observed symptom** the user reported. It blocks all return creation after the first one per year, which in turn blocks every refund attached to a new return.

**Impact:** **Module is unusable today.** Every new return blocks at insert time. No refund can be processed against a return that doesn't exist.

**Fix:** One-character SQL change. Recreate the function with `+ 6` instead of `+ 5`. Optional hardening: use a regex (`SUBSTRING(return_number FROM '\d+$')`) so the function survives format tweaks.

---

### RF-C0b. Draft sales appear in the Returns dropdown — same root as RF-C4
**Where:** `app/(app)/returns/sales/page.tsx:25-41`.

User confirmed by inspection. The `sales_invoices` lookup that powers the dialog dropdown has **no status filter**, so Drafts (which never decremented stock after R2-C1) and Cancelled invoices both show up. Filing a return against one of these inflates stock that was never decremented.

This is what RF-C4 documented from the server-side; the dropdown surface confirms it visually.

**Fix:** Add `.in("status", ["Paid", "Pending", "Credit", "Partially Returned"])` to the page query AND mirror the check in `createSaleReturn` to reject crafted requests.

---

### RF-C1. Sale-returns page leaks ALL users' sales invoices and customers
**Where:** `app/(app)/returns/sales/page.tsx:24-50`.

The page fetches `sales_invoices` and `parties` for the Sales Return dialog using `createAdminClient()` (which **bypasses RLS** — it uses the service-role key) **without filtering on `user_id`**:

```ts
const { data } = await supabase
  .from("sales_invoices")
  .select(`id, total, created_at, parties:party_id (...)`)
  .order("created_at", { ascending: false })
  .limit(100)   // ← no user_id filter

const { data } = await supabase.from("parties")
  .select("id, name, phone")
  .eq("type", "Customer")   // ← no user_id filter
```

User A logging in to create a sale return sees User B's invoices in the dropdown. Worse, picking one and submitting goes through `createSaleReturn`, which **does** check ownership via `verifyPartyOwnership` — so the insert fails — but the data is still exposed in the UI dropdown (invoice IDs, totals, dates, customer names + phones).

The mirror issue exists in `app/(app)/returns/purchases/page.tsx` for purchase invoices + suppliers (not re-read above but the symmetric file likely has the same pattern).

**Impact:** Cross-tenant data leakage. Every store using this app sees every other store's recent 100 invoices and full customer list.

---

### RF-C2. Refund can exceed what the customer actually paid on the original invoice
**Where:** `app/(app)/returns/actions.ts:613-670` (`createRefund`), and the refund cap in `components/refund-dialog.tsx:57-60`.

The refund cap is computed as:
```ts
outstandingAmount = returnTotal - alreadyRefunded
```

This caps refunds at the **return amount**, but never considers how much the customer **actually paid** on the original invoice. Scenario:
1. Customer buys items worth 1000 PKR, pays 500, owes 500 (Pending status).
2. Customer returns half (500 PKR worth).
3. Per the UI, you can refund up to 500 — but the customer never gave the store 500 in cash; they paid 500 against a 1000 invoice. The 500 return should reduce their **outstanding debt**, not be paid out as cash.
4. The cashier refunds 500 cash. Now the store has **lost** 500 (gave cash) AND the customer **still owes** 500 (the unpaid half).

The correct refund cap is `min(returnTotal − alreadyRefunded, customerPaidOnInvoice − alreadyRefunded)`. Anything above the paid amount should reduce outstanding, not be paid out.

**Impact:** Cash drain on credit sales that get partially returned. Compounded by the fact that the original invoice's outstanding balance is computed elsewhere (`getUnpaidPOSSales`) but never reconciled at refund time.

---

### RF-C3. `createSaleReturn` tax rate default = 18% but original sales default = 0%
**Where:** `app/(app)/returns/actions.ts:38`.

```ts
const taxRate = payload.taxRate ?? 18
```

POS `createPOSSale` defaults `taxRate ?? 0` (no tax baked in). Manual `createInvoice` defaults to 18 (Round 1 H8). The sales-return dialog at line 169 explicitly passes `taxRate: 0` — so via the UI the bug is masked. But:

- Any direct API call without `taxRate` adds 18% tax to the return total.
- The return total inflates to `subtotal × 1.18`, which then flows through `accounts-management` as a deduction from customer debt and into `getCustomerRefundsSummary` as "refunds issued".
- The numbers no longer line up with the original sale.

**Impact:** Wrong money. A return for 1000 PKR worth of items becomes a 1180 PKR liability — the store credits the customer 180 PKR more than they actually paid for tax that wasn't even on the original.

---

### RF-C4. Returns can be created against Drafts → stock inflation
**Where:** `app/(app)/returns/actions.ts:18-211` (`createSaleReturn`).

The function fetches `sales_invoices` without filtering on `status`:
```ts
.from("sales_invoices").select("id, party_id, total")
.eq("id", payload.sales_invoice_id)
.eq("user_id", currentUser.effectiveUserId)
.single()
```

A return can be created against:
- **Draft sales** — after R2-C1, Drafts never decrement stock. A return against a Draft **increments** stock that was never decremented → physical-vs-system drift in the **opposite** direction.
- **Cancelled sales** — same problem.

Then the sales-return-dialog's `sales_invoices` query at sales/page.tsx **also** doesn't filter by status, so Drafts show up in the dropdown.

**Impact:** Returning items from a Draft silently inflates stock. Reversing such a return (no UI for that — see RF-H1) would deflate it back. The net is data corruption per accidental click.

---

### RF-C5. Mojibake `â€"` in user-facing error messages
**Where:** `app/(app)/returns/actions.ts:90, 280`, and `components/refund-dialog.tsx`, `app/(app)/returns/refunds/page.tsx:63, 68, 78, 92` (and likely the `purchase-return-dialog.tsx`).

The same UTF-8-decoded-as-Latin-1 em-dash bug from Round 1 C5 (cashier fallback) is still present in:
- Server error: `"Cannot return X units â€" only Y unit(s) available to return..."` — toast.error renders the garbage characters.
- UI fallbacks: `{refund.return?.return_number || "â€"}` — shows the garbage em-dash in place of missing data.

**Impact:** Visible mojibake in error toasts and table cells. Customer / cashier sees `â€"` instead of `—`.

---

### RF-C6. Sales-return-dialog uses unfiltered `createClient()` for inventory lookups
**Where:** `components/sales-return-dialog.tsx:121-127`.

```ts
supabase.from("inventory_items").select("id, name").then(({ data }) => {
  if (data) setInventoryItems(data)
})
```

This runs in the browser via the public Supabase client. **No `user_id` filter.** Whether it's safe depends entirely on RLS policies on `inventory_items`. If RLS isn't strict (which is common), this hauls back **every user's inventory**.

Same pattern at line 90-117 for `sales_invoice_lines` lookup.

**Impact:** Inventory catalog leak from inside the return dialog. Depends on RLS configuration; needs verified.

---

## 🟠 HIGH

### RF-H1. No way to delete, cancel, or reverse a Completed return
**Where:** entire `returns` module — no `deleteSaleReturn` / `cancelReturn` action exists.

Returns auto-create with `status: "Completed"` (lines 108 + 303). Once persisted:
- Stock is moved (IN for sale, OUT for purchase) and audit-recorded.
- Invoice status updates to "Partially Returned" / "Returned".
- Refunds may already be attached.
- **No UI gives the cashier an undo path.**

If a cashier creates a return for the wrong invoice, the only recovery is direct SQL editing.

**Impact:** Operational dead-end. Mistakes are permanent in the UI.

---

### RF-H2. `createRefund` doesn't check the parent return's status
**Where:** `app/(app)/returns/actions.ts:613-670`.

The function verifies ownership (`.eq("user_id", currentUser.effectiveUserId)`) but never checks `returnData.status`. A refund can be created against:
- A return with `status = "Draft"` (the types support it).
- A return with `status = "Cancelled"`.

For a Cancelled return, the refund still inserts a row → `getCustomerRefundsSummary` sums it as "money paid out" → cash position over-reports.

**Impact:** Wrong cash position on Customer Payments page if any return was ever Cancelled but its refund row survived.

---

### RF-H3. Sale invoices dropdown hard-capped at LIMIT 100
**Where:** `app/(app)/returns/sales/page.tsx:41`.

```ts
.order("created_at", { ascending: false }).limit(100)
```

A store doing 100+ sales per week loses the ability to file a return against any invoice older than ~100 invoices ago. There's no pagination, no search-by-id fallback, no "load more". The customer who comes back 2 weeks later with a faulty item can't get a return processed.

Same hard limit likely on the purchase side.

**Impact:** Operationally crippling for any moderately busy store after the first week.

---

### RF-H4. No date-window enforcement on returns
**Where:** entire return module.

The A4 print template's terms say `"Only products can be exchanged within 7 days of sales"` (a hardcoded copy in `print-a4-invoice.ts`). The system enforces **zero days** — a 2-year-old sale can have a return filed against it. The store's stated policy and the actual enforcement diverge.

**Impact:** Cashier-driven leniency (or lack of it) replaces a system-enforced rule. Disputes follow.

---

### RF-H5. Cashier can override unit_price on return → silent over-refund
**Where:** `components/sales-return-dialog.tsx:312-324`.

The dialog auto-loads `unit_price` from `sales_invoice_lines`. But it then renders an editable Input. The cashier can type any number. The server (`createSaleReturn`) accepts whatever's in `payload.items[*].unitPrice` and computes:
```ts
subtotal = Σ (quantity × unitPrice)
```

No comparison to what the customer actually paid for that line. Cashier could (intentionally or by mistake) increase the unitPrice and refund more than was originally charged.

**Impact:** Refund fraud surface / data-entry mistakes.

---

### RF-H6. Server doesn't validate return items belong to the original invoice
**Where:** `app/(app)/returns/actions.ts:46-95`.

The function verifies:
- The party owns the invoice ✓
- All items exist and belong to the user ✓
- Each `salesInvoiceLineId` (if passed) hasn't been over-returned ✓

But it does **not** verify that `payload.items[*].itemId` actually appears on the invoice's `sales_invoice_lines`. A crafted payload could return any owned inventory item as if it were on the invoice.

**Impact:** Stock manipulation via crafted return payloads. The store could "return" items it never sold to a customer, inflating stock fraudulently.

---

### RF-H7. Refunds page shows methods that POS no longer uses ("Mixed", "Other")
**Where:** `components/refund-dialog.tsx:194-195` and `components/sales-return-dialog.tsx:368-369`.

The refund method dropdown includes `"Mixed"` and `"Other"` even though POS payment options were trimmed to remove these earlier. Inconsistency: store accepts payments in Cash/Card/JazzCash/EasyPaisa/Credit, but allows refunds via Mixed/Other — methods nothing on the payment side ever generated.

**Impact:** Audit-trail confusion — a refund method that doesn't exist on the inbound side. Either reinstate Mixed/Other on payments, or remove them from refunds.

---

### RF-H8. No printable refund / return receipt
**Where:** entire module.

Sale invoices have an A4 + NCR print. Purchase invoices have one. Returns have **no** print template at all. After processing a return + refund, the cashier has no paper to hand the customer — only the on-screen confirmation.

**Impact:** No customer-facing audit trail for refunds. Disputes are inevitable.

---

## 🟡 MEDIUM

### RF-M1. Double-return check bypassed if `salesInvoiceLineId` is omitted
**Where:** `app/(app)/returns/actions.ts:61-95`.

The "already returned" guard only runs for items where `salesInvoiceLineId` is non-empty. The dialog always sends it (line 104) — but the field is optional on the input type. A direct API call without it silently bypasses the cap.

**Impact:** A crafted payload could return more than the original quantity. Low likelihood through UI, real API surface.

---

### RF-M2. Decimal subtraction without cents-rounding
**Where:** `app/(app)/returns/actions.ts:87, 277`.

```ts
const available = Number(original.quantity) - alreadyReturned
if (item.quantity > available) { ... }
```

Pure float arithmetic. For quantities with decimals (the dialog allows step 0.01), `available` can carry `0.000000001` drift. A return for "exactly remaining" qty might fail with the off-by-epsilon comparison, or succeed when it shouldn't.

The `total` comparison at line 189 uses cents-rounding — same pattern would help here.

**Impact:** Rare false positives/negatives on the return-cap check.

---

### RF-M3. Negative-refund guard missing
**Where:** `app/(app)/returns/actions.ts:613-670`.

```ts
if (!payload.return_id || payload.amount <= 0) {
  return { error: "Return ID and positive amount are required" }
}
```

Good — checks `<= 0` so negatives are rejected. ✓ Actually this one is *fine*; flagging here for completeness because the inline `refunds[].amount > 0` filter at lines 161, 354 *doesn't* use `Number.isFinite`. A NaN payload amount slips through `>0` as `false` so it's rejected, but the surface for inconsistency exists.

**Impact:** Minimal. Already covered.

---

### RF-M4. `getReturns` mixes Draft / Completed / Cancelled with no status filter
**Where:** `app/(app)/returns/actions.ts:407-490`.

The query has no status filter. The Refund Dialog at `refunds/page.tsx:28` passes the returned list straight into a Select dropdown. So:
- Drafts (never used in current flow but supported by the type) → would show in dropdown.
- Cancelled returns (also never reachable in current flow) → would show.

If either of those statuses gets used later, refunds will be attachable to non-final returns.

**Impact:** Defense-in-depth: when Draft/Cancel return flows are added, this query needs the filter.

---

### RF-M5. Refund-dialog max-amount validation only client-side
**Where:** `components/refund-dialog.tsx:62-72`.

The cap check `refundAmount > maxRefundAmount` runs in the client only. Server-side `createRefund` does its own cap check (line 643) — good. But the server check uses `returnTotal` (return.total), not `customerPaid`. Same flaw as RF-C2.

**Impact:** See RF-C2.

---

### RF-M6. `Card` refunds don't require a reference
**Where:** `components/refund-dialog.tsx:201-214`, `sales-return-dialog.tsx:373-384`.

Reference is mandatory for `JazzCash` and `EasyPaisa` (orange highlight + validation). For `Card` refunds, the reference is optional even though card refunds always produce a transaction ID. Bad audit trail for the most refundable method.

**Impact:** Disputes hard to investigate without the transaction ID.

---

### RF-M7. `customers` query in sales return page leaks across users
**Where:** `app/(app)/returns/sales/page.tsx:47-50`.

```ts
const { data } = await supabase.from("parties")
  .select("id, name, phone").eq("type", "Customer")
// no user_id filter
```

Same flavor as RF-C1, listed separately because it leaks the **full customer database** of every user. Names + phones.

**Impact:** PII leakage of every customer in every store.

---

### RF-M8. Refunds listing doesn't show "pending/outstanding" per return
**Where:** `app/(app)/returns/refunds/page.tsx:32-110`.

The Refunds table shows: Return #, Type, Party, Method, Amount, Date. Nothing tells you whether `total_refunded < return.total` — i.e. whether a return is still owed money. Cashier has to dig into each return individually.

**Impact:** Operational drag. Outstanding-refund visibility belongs on the listing page.

---

### RF-M9. `accounts-management` ledger reads refunds without cross-checking return.type
**Where:** `app/(app)/accounts-management/actions.ts:115-147, 174-182`.

Refund rows are filtered by `returns.type === "sale"` / `"purchase"` to decide direction. If a refund row's `returns.type` is somehow missing (NULL or NULL join), the refund is silently dropped from both ledger sides. Better: explicit assertion that every refund has a matching return.type, or migration to add the type column to refunds directly.

**Impact:** Edge case — a return row with NULL type (data corruption) would silently zero out its refunds from the ledger.

---

### RF-M10. Stock-restore on return assumes original invoice decremented
**Where:** `app/(app)/returns/actions.ts:134-156`.

```ts
// Reverse stock (add stock back) — Sale return means stock comes back IN
await supabase.rpc("increment_inventory_stock", ...)
```

This blindly increments. But after R2-C1, Drafts don't decrement. If a return is filed against a Draft (RF-C4 above), this increments stock that was never decremented. The same applies to Cancelled invoices.

**Impact:** Stock inflation. Pair with RF-C4.

---

## ⚪ LOW

### RF-L1. Comments contain mojibake `â€"` em-dashes
**Where:** `app/(app)/returns/actions.ts:61, 181, 251, 376`. Harmless in source (not customer-facing) but a code-quality smell.

### RF-L2. `return_number` is auto-generated by DB trigger — but the format isn't visible in code
The Return dialog dropdowns show `ret.return_number`. The numbering scheme is a DB-side mystery (trigger). Should be documented.

### RF-L3. `Mixed` payment method in dialogs but no logic supports a "mixed" refund of multiple methods
"Mixed" is selectable in the dropdown but the form takes a single method + single amount. Selecting "Mixed" simply tags the refund as type Mixed — no actual multi-method split happens.

### RF-L4. `getReturnById` returns refunds **filtered by user_id**, but `getRefunds` (top-level) also filters by user_id. Defensive double-check is good but worth noting.

### RF-L5. The refund dialog's `Maximum refund amount: Rs. X` displays the max but doesn't explain why
For credit sales where the customer paid only partially, the displayed max is misleading (says e.g. 500 max even though only 200 was actually paid in cash).

### RF-L6. `taxRate ?? 18` literal magic number
Same literal hardcoded at `actions.ts:38` (sale) and `actions.ts:287` (purchase). Should be a named constant or come from store settings.

### RF-L7. No "reason for return" field
Return types: damage / wrong item / change of mind etc. Currently no way to record. Reports later can't slice by reason.

### RF-L8. Returns can be filed without any customer-supplied evidence
No photo, no invoice scan, no signature. Audit weak.

### RF-L9. `inventoryItems` state in sales-return-dialog is computed but only used as a fallback for naming
Could be eliminated since the auto-populate path already provides names via the join.

### RF-L10. Return ID UUID prefix used as `return_number` fallback? No — looks like there's a real `return_number` column auto-generated. But the format/sequencing isn't documented.

---

## Cross-cutting themes

1. **Service-role queries without `user_id` filters are the root of the cross-tenant issues** (RF-C1, RF-C6, RF-M7). Whenever a page uses `createAdminClient()` it MUST add `.eq("user_id", currentUser.effectiveUserId)`. There's no schema-level safety net.

2. **The system treats every return as immediately final.** No Draft return concept used, no cancellation path, no edit path. A typo by the cashier becomes a permanent data event.

3. **Refund cap is anchored to the wrong number.** It uses `return.total` instead of `min(return.total, customer_paid_so_far)`. This is the bug behind both RF-C2 and RF-M5.

4. **The two creation paths (sale vs purchase return) are 90% duplicate code** — same structure, same guards, same bugs in parallel. Worth extracting a shared helper after the bugfixes land.

5. **No printable artifact for returns** means the customer leaves with no paper. Disputes inevitable.

---

## Recommended triage order

If implementing fixes one priority at a time, my recommended sequence:

0. **RF-C0** — **DO THIS FIRST.** SQL trigger off-by-one is currently blocking ALL return creation after the first per year. One-character DB change. Unblocks everything else.
0b. **RF-C0b** — add status filter so Drafts/Cancelled invoices don't show up in the return dropdown. Pair with C0 fix.
1. **RF-C1 + RF-C6 + RF-M7** — close the cross-tenant data leaks. Three queries that need `.eq("user_id", ...)`. One commit.
2. **RF-C5** — mojibake em-dashes in user-facing strings. Trivial sweep.
3. **RF-C3** — taxRate default should match POS (0, not 18). One-line change.
4. **RF-C4 + RF-M10** — disallow returns against Draft/Cancelled invoices. Server-side `.in("status", ["Paid", "Pending", "Credit", "Partially Returned"])` filter on the invoice lookup, plus dropdown filter.
5. **RF-C2 + RF-M5** — refund cap should consider customer's actual paid amount. Requires summing `payments` for the original invoice in `createRefund` + the refund-dialog. Most invasive of the lot but most impactful.
6. **RF-H1** — add `deleteSaleReturn` + Trash button. Mirror of R2-C2.
7. **RF-H2** — add Return status check to `createRefund`.
8. **RF-H3** — server-side search for invoices in the dialog instead of LIMIT 100.
9. **RF-H5 + RF-H6** — validate return-item identity + price against original invoice line.
10. **RF-H7** — strip Mixed/Other from refund methods (or restore them on payment side). Decision needed.
11. **RF-H4** — date-window policy. Decision needed (system-enforced vs cashier discretion).
12. **RF-H8** — printable return receipt. Larger work item.

Per workflow ("phele bug fixing then bugfiesd files ko use karo"): **none of these are implemented yet**. Bata do kaunsa pehle uthana hai aur mein move karta hoon `bugfixed.md` ki taraf as we resolve them.
