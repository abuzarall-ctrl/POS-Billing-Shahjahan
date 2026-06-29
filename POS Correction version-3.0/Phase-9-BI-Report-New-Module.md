# Phase 9 — BI Report: New Module (Create From Scratch)

**Module:** BI Report (Brand New)  
**PDF Pages:** 9–10, 19–20  
**Priority:** 🟢 Medium

---

## Overview

Ek bilkul **naya module** create karna hai: **BI Report**

Is module mein 2 features honge:
1. **Expense Sheet**
2. **Gross Profit** (shifted from POS/Sales module)

---

## Feature 1 — Expense Sheet

### Add Expense Button
- "**Add Expense**" button hoga jisse expense voucher add hoga.

### Columns (5 total)
| Column | Filled By |
|--------|-----------|
| S. No | Auto (system pick karta hai) |
| Date / Time | Auto (system pick karta hai) |
| Description | User fill karega |
| Amount | User fill karega |
| Total | Auto (running total — cumulative sum) |

### Example View
```
S.No | Date/Time           | Description         | Amount | Total
-----|---------------------|---------------------|--------|-------
1    | 9/6/2026 / 1:08 am  | Electric bill       | 10000  | 10,000
2    | 10/6/2026 / 2:08 am | Daily Lunch         | 1500   | 11,500
3    | 12/6/2026 / 3:08 am | Transport Expense   | 5000   | 15,500
```

### Search Bar
- Expense Sheet mein **search bar** bhi hoga.

---

## Feature 2 — Gross Profit (Shifted from POS)

### Source
- **Gross Profit feature POS module se shift** karke yahan lao.
- Abhi ye "All Items Wise" kaam karta hai — that's fine, but expand karo.

### New Filters Add Karo
- **Category Wise** — items ki category ke hisaab se GP
- **All Item Wise** — sab items ka GP (existing)
- Category ka connection: **Add Item → Category** field se hoga.

### Net Gross Profit Section (New)
- GP table ke **aakhir mein** ek aur section add karo: **Net Gross Profit**
- Formula:
  ```
  Net Gross Profit = Gross Profit − Expenses
  ```
  (Expenses → Expense Sheet se aayengi)

---

## Filters (Both Features)

Dono features mein ye **filters** add honge:
- This Week
- Last Week
- This Month
- Last Month
- This Year
- Last Year
- **Date Wise** (custom date range picker)

---

## Navigation

- Sidebar mein **"BI Report"** ka link add karo.
- (Gross Profit ka link POS / Sales module se **remove** karo — Phase 5 se linked)

---

## Implementation Checklist

- [ ] BI Report module create karo (sidebar mein add)
- [ ] Expense Sheet feature:
  - [ ] "Add Expense" button
  - [ ] 5 columns: S.No (auto), Date/Time (auto), Description, Amount, Total (cumulative)
  - [ ] Search bar
- [ ] Gross Profit feature:
  - [ ] Shift from POS/Sales to BI Report
  - [ ] Add "Category Wise" filter
  - [ ] Keep "All Item Wise" filter
  - [ ] Category connection → Add Item → Category field
  - [ ] Net Gross Profit section: Net GP = GP − Expenses
- [ ] Filters apply karo dono features par: This Week / Last Week / This Month / Last Month / This Year / Last Year / Date Wise
- [ ] Gross Profit link remove karo POS/Sales module se (Phase 5 ke saath sync)
