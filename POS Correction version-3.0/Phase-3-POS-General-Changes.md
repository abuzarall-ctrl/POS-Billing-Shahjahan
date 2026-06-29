# Phase 3 — POS: General Changes

**Module:** POS (Point of Sale)  
**PDF Pages:** 5–7, 18  
**Priority:** 🟡 High

---

## Change 1 — Auto Cursor Return

**Current issue:** Item add karne ke baad cursor agle field mein chala jaata hai.

**Fix:**
- Item add karne ke baad cursor **automatically "Add Item" cell mein wapas** aa jaana chahiye.
- Matlab: user bina mouse click kiye directly agla item type kar sake.

---

## Change 2 — Rate Selector: Rename Labels (No. 1)

**Current names:** `cash bill`, `credit bill`, `supplier bill`  
**New names:** `Cash Rate`, `Credit Rate`, `Supplier Rate`

**Important:** Ye sirf **rate change** karta hai.  
Iska bill type (cash/credit/draft) se koi relation nahi.

---

## Change 3 — Bill Type Selector: New Dropdown (No. 2)

**Add a new separate selector** with options:
- `Cash Bill`
- `Credit Bill`
- `Draft`

**Ye decide karega** ke bill cash ka hai, credit ka hai, ya draft.

**Why separate?**  
- Supplier wala customer bhi credit pe maal le ja sakta hai.
- Is liye rate aur bill type dono alag-alag selectors hain.
- No. 1 (Rate) aur No. 2 (Bill Type) ek doosre se **independent** hain.

---

## Change 4 — Restore PKR / % Toggle in Discount

**Current issue:** Pehle discount field mein `PKR` aur `%` ka option tha, ab nahi hai.

**Fix:**
- Discount field ke andar dobara **PKR / %** toggle add karo.
- Jaise pehle tha waise hi restore karo.

---

## Change 5 — Reference Number in Ledger

**Current issue:** Bill mein reference number likha jaata hai, lekin woh ledger ke Description column mein show nahi hota.

**Fix:**
- Jab bill mein reference number enter kiya jaaye → woh **ledger ke Description column** mein bhi dikhna chahiye.
- Format example:
  ```
  Description: Ref# [reference_number] — [item/bill info]
  ```

---

## Implementation Checklist

- [ ] After "Add Item" → cursor auto-return to add item cell
- [ ] Rename No.1 selector: Cash Rate / Credit Rate / Supplier Rate
- [ ] Add No.2 selector: Cash Bill / Credit Bill / Draft (independent of No.1)
- [ ] Restore PKR / % toggle in discount field
- [ ] Reference number → show in ledger Description column
