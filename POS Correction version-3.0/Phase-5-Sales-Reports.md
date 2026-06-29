# Phase 5 — Sales Reports Module Changes

**Module:** Sales Reports (Outstanding, Paid Sale, Payment History, Gross Profit)  
**PDF Pages:** 8–10  
**Priority:** 🟡 High

---

## Change 1 — Fix Calculations Display

**Current issue:** Top section mein calculations clear nahi hain.  
- "Total Received", "Total Payments", and "Outstanding" theek se show nahi ho rahe.

**Fix:**
- Calculations ko clearly display karo.
- Each value ka label aur amount clearly readable ho.

---

## Change 2 — Rename "Total Received" → "Total Payments"

- Label: `Total Received` → `Total Payments`
- Placement bhi change karna hai — "Total Payments" ki jagah change hogi.

---

## Change 3 — Search Bars Add Karo (3 Sections)

Search bar add karo in teeno sections mein:
1. **Outstanding by Customer**
2. **Paid Sale**
3. **Payment History**

---

## Change 4 — Fix "Gross Profit" Spelling

- **Gross Profit** ki spelling galat hai — fix karo.
- (PDF mein highlight kiya gaya tha ke spelling set karni hai)

---

## Change 5 — Remove Rectangle (Reports Page)

- Reports page par ek extra **rectangle** (box/shape) hai.
- Use **remove** karo — woh display mein show nahi hona chahiye.

---

## Change 6 — Graphs Merge Karo

**Current issue:** Do alag graphs hain:
- Left graph: Gross Profit related
- Right graph: Sale vs Cost by GP

**Fix (Merge):**
- **Right graph (Sale vs Cost by GP):** Is mein already cost aur sale amount show ho raha hai.
  - Iske **neeche ek profit section bhi add karo** usi graph mein.
  - Ab left graph ki zaroorat nahi rahegi.
- **Left graph ko replace karo** → **Top 10 Items by Quantity** se
  - X-axis: Item Name
  - Y-axis: Quantity Sold

---

## Change 7 — "avg price" → "selling price"

- Column/field ka naam: `avg price` → `selling price`

---

## Change 8 — "Gross Profit" Feature → Shift to BI Report

- "Gross Profit" feature abhi Sales/POS mein hai.
- Use **BI Report module** mein shift karo. *(See Phase 9)*

---

## Implementation Checklist

- [ ] Fix Total Received / Total Payments / Outstanding calculations clarity
- [ ] Rename "Total Received" → "Total Payments"
- [ ] Add search bar: Outstanding by Customer
- [ ] Add search bar: Paid Sale
- [ ] Add search bar: Payment History
- [ ] Fix "Gross Profit" spelling
- [ ] Remove extra rectangle from reports page
- [ ] Merge graphs: right graph mein profit section add, left graph → Top 10 Items by Qty
- [ ] Rename "avg price" → "selling price"
- [ ] Move Gross Profit feature to BI Report module (Phase 9)
