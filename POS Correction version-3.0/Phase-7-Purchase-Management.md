# Phase 7 — Purchase Management Changes

**Module:** Purchase Management  
**PDF Pages:** 11–13  
**Priority:** 🟢 Medium

---

## Change 1 — Keyboard Navigation: Pg Up / Pg Down Fix

**Current issue:**
- `Tab` button kaam kar raha hai.
- `Page Up` aur `Page Down` keyboard buttons kaam nahi kar rahe.

**Fix:**
- Item selection ke liye **`Pg Up` / `Pg Down` keyboard buttons** enable karo.
- User bina mouse ke items navigate aur select kar sake.

---

## Change 2 — Selling Price Cells Add Karo

**Current issue:**  
- Purchase Management form mein sirf **Cost Price** aa rahi hai.
- **Selling Price** show nahi ho rahi.

**Fix:**
- **3 Selling Price cells** add karo:
  1. Cash Rate (Selling Price)
  2. Credit Rate (Selling Price)
  3. Supplier Rate (Selling Price)
- Ye cells purchase entry form mein dikh'en taake user ek hi jagah se saari prices set kar sake.

---

## Change 3 — Dropdown → Search Bar Replace

**Current issue:** Ek jagah par dropdown hai jo item ya party select karne ke liye use hoti hai.

**Fix:**
- Is **dropdown ko search bar se replace** karo.
- User type karke directly search kare — dropdown scroll karne ki zaroorat na rahe.

---

## Implementation Checklist

- [ ] `Pg Up` / `Pg Down` keyboard support add karo item navigation ke liye
- [ ] 3 Selling Price cells add karo (Cash Rate, Credit Rate, Supplier Rate)
- [ ] Dropdown → Search bar replace karo
