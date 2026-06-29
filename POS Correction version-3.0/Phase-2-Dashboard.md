# Phase 2 — Dashboard Module Changes

**Module:** Dashboard  
**PDF Pages:** 1–2  
**Priority:** 🟡 High

---

## Change 1 — Bar Graph (No Change Needed)

- Bar graph theek hai.
- Isko change karne ki zaroorat nahi.

---

## Change 2 — Line Graph → Top 10 Products

**Current issue:** Dono graphs (bar aur line) ek hi cheez show kar rahe hain.

**Fix:**
- Line graph ko **Top 10 Products** show karne ke liye change karo.
- **X-axis:** Product Name
- **Y-axis:** Quantity sold
- Filter support:
  - Today
  - This Week
  - This Month
  - This Year

---

## Change 3 — 3rd Graph: Top 10 Sellers (BAR)

- Ek nayi **BAR graph** add karo jo **Top 10 Sellers** show kare.
- Ye filter wise show karega (same filters — Today / Week / Month / Year).

---

## Change 4 — Filters Improvement

- Saare filters ko **dropdown** mein convert karo.
- **Date filter** bahar (separate) rahega — dropdown ke andar nahi.
- Example layout:
  ```
  [Dropdown: Today / This Week / This Month / This Year]   [Date Picker: From — To]
  ```

---

## Change 5 — "This Week" Start Day Fix

- **Bug:** "This Week" Sunday se start ho raha hai.
- **Fix:** "This Week" **Monday** se start hona chahiye.

---

## Change 6 — Summary Stats Fix

- Dashboard par ye 3 stats set karne hain:
  - **Total Sale**
  - **Gross Profit**
  - **Outstanding**
- Abhi ye sahi se display nahi ho raha — fix karo.

---

## Implementation Checklist

- [ ] Line graph → Top 10 Products (X: name, Y: quantity) with Today/Week/Month/Year filter
- [ ] 3rd BAR graph add karo → Top 10 Sellers, filter wise
- [ ] All filters → dropdown mein convert
- [ ] Date filter → separate (dropdown ke bahar)
- [ ] "This Week" → Monday se start hone ki fix
- [ ] Dashboard summary: Total Sale, Gross Profit, Outstanding — set/fix karo
