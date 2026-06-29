# POS-Billing-Shahjahan — Bug & Duplication Analysis

**Status:** SECOND PRIORITY — Wait for user instruction before fixing.
**Date:** 2026-05-10

---

## PART 1 — DUPLICATIONS

### 1. Stock Restore Loop — 4 jagah exact same pattern
- `app/(app)/invoices/actions.ts` lines 294-326 (updateInvoice)
- `app/(app)/invoices/actions.ts` lines 499-531 (deleteInvoice)
- `app/(app)/purchases/actions.ts` lines 270-305 (updatePurchase)
- `app/(app)/purchases/actions.ts` lines 473-505 (deletePurchase)

Pattern: fetch existing lines → loop → get current stock → call RPC → recordStockMovement

### 2. Party Ownership Verification — 5 jagah same block
- `app/(app)/invoices/actions.ts` lines 18-28
- `app/(app)/purchases/actions.ts` lines 23-33
- `app/(app)/pos/actions.ts` lines 27-35
- (Plus updateInvoice and updatePurchase)

```ts
const { data: party } = await supabase.from("parties").select("id")
  .eq("id", payload.partyId).eq("user_id", currentUser.effectiveUserId).single()
if (!party) { return { error: "Party not found" } }
```

### 3. Supabase Joined Data Extraction — 15+ jagah same ternary
- `app/(app)/pos/actions.ts` line 211
- `app/(app)/purchases/actions.ts` lines 565-566
- `app/(app)/invoices/actions.ts` lines 184-186
- Plus 10+ more locations

```ts
const partyData = row.parties
  ? (Array.isArray(row.parties) ? row.parties[0] : row.parties)
  : null
```

### 4. Payment Status Recalculation — 4 jagah duplicate logic
- `app/(app)/pos/actions.ts` lines 587-595 (createCustomerPayment)
- `app/(app)/pos/actions.ts` lines 687-698 (deleteCustomerPayment)
- `app/(app)/purchases/actions.ts` lines 619-628 (createPurchasePayment)
- `app/(app)/purchases/actions.ts` lines 721-723 (deletePurchasePayment)

### 5. FormData Extraction Duplicate
- `app/(app)/stock-management/inventory/actions.ts` lines 12-28 (createInventoryItem)
- `app/(app)/stock-management/inventory/actions.ts` lines 238-255 (updateInventoryItem)

Same ~18 lines, sirf ek `id` ka farq.

### 6. Profit Calculation Duplicate
- `app/(app)/stock-management/inventory/actions.ts` lines 31-32
- `app/(app)/stock-management/inventory/actions.ts` lines 258-259

### 7. Barcode Collision Loop — 2 jagah
- `app/(app)/stock-management/inventory/actions.ts` lines 64-85 (user-provided)
- `app/(app)/stock-management/inventory/actions.ts` lines 179-195 (auto-generated)

### 8. Invoice/Purchase PDF Fetch Pattern — 3 jagah same structure
- `getInvoiceForPDF` — `app/(app)/invoices/actions.ts` line 122
- `getPurchaseForPDF` — `app/(app)/purchases/actions.ts` line 116
- `getInvoiceForPrint` — `app/(app)/pos/actions.ts` line 273

### 9. Dead Utilities — Banaye gaye lekin kabhi use nahi kiye

| File | Status |
|------|--------|
| `lib/db/transaction-helper.ts` | 3 functions, koi bhi action file import nahi karta |
| `lib/validation/schemas.ts` | Poore Zod schemas bane hain — koi bhi `actions.ts` use nahi karta |
| `lib/db/pagination-helper.ts` | Exists, lekin koi bhi query limit nahi lagati |
| `lib/supabase/mock.ts` | Mock client production code mein hai |

---

## PART 2 — LOOPHOLES / BUGS

### Bug 1 (HIGH) — `user.id` vs `user.effectiveUserId` inconsistency
- `app/(app)/pos/actions.ts` line 239 (getUserPrintFormat)
- `app/(app)/pos/actions.ts` line 256 (setUserPrintFormat)
- `app/(app)/pos/actions.ts` line 298 (getInvoiceForPrint)
- `app/(app)/pos/actions.ts` line 455 (getStoreSettings)
- Plus setStoreSettings (multiple places)

Baaki poora codebase `currentUser.effectiveUserId` use karta hai — ye 4 functions `user.id` use karte hain. Tenant isolation breach risk.

### Bug 2 (HIGH) — `isChangingToCancelled` / `isChangingFromCancelled` declare hote hain, use nahi hote
- `app/(app)/invoices/actions.ts` lines 280-281
- `app/(app)/purchases/actions.ts` lines 256-257

Variables computed hote hain par kahin if/else mein use nahi. Cancelled invoice update karte time stock incorrectly restore ho sakta hai.

### Bug 3 (MEDIUM) — `updatePOSSale` stock restore direct update se karta hai, RPC se nahi
- `app/(app)/pos/actions.ts` lines 980-982

```ts
await supabase.from("inventory_items")
  .update({ stock: Number(invItem.stock) + Number(line.quantity) })
```

Baaki codebase `increment_inventory_stock` RPC use karta hai. Yahan direct update — koi stock movement record nahi hota.

### Bug 4 (MEDIUM) — `updatePurchase` mein `invItem` fetch hota hai, use nahi hota
- `app/(app)/purchases/actions.ts` lines 360-363

`invItem.stock` kabhi read nahi hota — sirf existence check ke liye unnecessary DB query.

### Bug 5 (MEDIUM) — `getAllCustomerPayments` in-memory filter
- `app/(app)/pos/actions.ts` line 769

`.filter((p) => p.source === "pos")` — pehle sab payments fetch hote hain, phir JS mein filter. Should be DB-level filter.

### Bug 6 (MEDIUM) — `createCustomerPayment` POS source check nahi karta
- `app/(app)/pos/actions.ts` lines 562-570

Invoice ownership verify hoti hai par `source = "pos"` check nahi hota. Non-POS invoice ke liye bhi POS payment add ho sakti hai.

### Bug 7 (LOW-MEDIUM) — `deleteInvoice` aur `deletePurchase` mein redundant explicit line deletion
- `app/(app)/invoices/actions.ts` line 535
- `app/(app)/purchases/actions.ts` lines 511-512

Comment kehta hai "cascade should handle this, but being explicit." Confusion — agar cascade hai toh waste hai.

### Bug 8 (LOW) — `quickCreateInventoryItem` mein koi barcode collision check nahi
- `app/(app)/purchases/actions.ts` lines 896-899

Agar barcode pehle se exists karta hai toh raw DB error.

---

## PART 3 — ARCHITECTURAL ISSUES

### A. Zod Schemas Bane, Use Nahi Kiye
`lib/validation/schemas.ts` mein `inventoryItemSchema`, `partySchema`, `createInvoiceSchema` sab define hain. Actions mein manual inline validation. Maintenance double.

### B. Transaction Helper Dead Code
`lib/db/transaction-helper.ts` — 3 functions, koi use nahi karta. Stock operations jo fail hone par inconsistent state chhod deti hain — isi ke liye bana tha.

### C. `effectiveUserId` Concept Undocumented
Poora codebase use karta hai, koi documentation nahi ke `id` se kab alag hoga.

### D. No Pagination on Heavy Queries
`getPaidSales`, `getPaidPurchases`, `getAllCustomerPayments` — unbounded fetch.

### E. Session Cookie ka Data Stale Hai
`lib/auth/session.ts` lines 15-20 — Cookie mein `userId, email, role, privileges` store hote hain. `getUserSession()` mein DB se fresh fetch hota hai. Cookie data (email, role, privileges) kabhi use nahi hota.

---

## Priority Order for Fixing (when user says "second priority")

1. **Bug 1** — user.id vs effectiveUserId (data correctness, HIGH)
2. **Bug 2** — Dead cancellation logic (data correctness, HIGH)
3. **Bug 3** — updatePOSSale stock restore (data integrity, MEDIUM)
4. **Bug 6** — POS payment source check (data integrity, MEDIUM)
5. **Bug 5** — in-memory filter (performance, MEDIUM)
6. **Bug 4** — unused query (performance, MEDIUM)
7. **Bug 7, 8** — minor issues (LOW)
8. **Duplications 1-8** — refactoring (maintainability)
9. **Dead utilities** — either wire up or remove

---

## Summary Table

| # | Issue | Severity | Files |
|---|-------|----------|-------|
| Bug 1 | user.id vs effectiveUserId inconsistency | HIGH | pos/actions.ts (4 functions) |
| Bug 2 | Cancellation logic declared but never runs | HIGH | invoices/actions.ts, purchases/actions.ts |
| Bug 3 | POS draft update bypasses stock RPC | MEDIUM | pos/actions.ts:980 |
| Bug 4 | Unnecessary DB query in updatePurchase | MEDIUM | purchases/actions.ts:360 |
| Bug 5 | In-memory filter after full fetch | MEDIUM | pos/actions.ts:769 |
| Bug 6 | POS payment action allows non-POS invoices | MEDIUM | pos/actions.ts:562 |
| Bug 7 | Redundant cascade deletion | LOW-MED | invoices, purchases |
| Bug 8 | Quick-create no barcode collision check | LOW | purchases/actions.ts:896 |
| Dup 1 | Stock restore loop — 4 copies | Maintainability | invoices + purchases |
| Dup 2 | Party verify block — 5 copies | Maintainability | invoices, purchases, pos |
| Dup 3 | Joined data ternary — 15+ copies | Maintainability | Multiple files |
| Dup 4 | Payment status recalc — 4 copies | Maintainability | pos + purchases |
| Dup 5 | FormData extraction — 2 copies | Maintainability | inventory/actions.ts |
| Dup 6 | Profit calculation — 2 copies | Maintainability | inventory/actions.ts |
| Dup 7 | Barcode collision loop — 2 copies | Maintainability | inventory/actions.ts |
| Dup 8 | PDF fetch pattern — 3 copies | Maintainability | invoices, purchases, pos |
| Dead | Zod schemas unused | Waste | lib/validation/schemas.ts |
| Dead | Transaction helper unused | Waste | lib/db/transaction-helper.ts |
| Dead | Pagination helper unused | Waste | lib/db/pagination-helper.ts |
