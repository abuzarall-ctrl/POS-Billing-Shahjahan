# Phase 4 — Parties Module Changes

**Module:** Parties  
**PDF Pages:** 2–4  
**Priority:** 🟡 High

---

## Change 1 — Compact / Congested View

**Current issue:** Parties list layout spacious aur open hai.

**Fix:**
- Parties list ko **compact/congested** view mein convert karo.
- Har row kam jagah le — zyada records ek screen mein dikhne chahiye.
- (PDF mein reference screenshot diya gaya hai neeche wali style mein)

---

## Change 2 — Parties Ledger vs Parties Report — Differentiate

**Current issue:**  
- Parties module ke andar bhi ledger dekha ja sakta hai.
- Parties Report se bhi same ledger khulta hai.
- Dono same hain — Parties Report ka koi faida nahi lag raha.

**Fix:**
- **Parties Report** alag information ya format show kare jo Parties module ke andar ledger se alag ho.
- Ya phir Parties Report mein extra features/columns hon jo andar wale ledger mein nahi hain.
  - Example: summary view, date-range filter, export option, multi-party comparison, etc.
- Dono mein **clearly visible difference** hona chahiye.

---

## Change 3 — URL Mein ID Nahi, Specific Path

**Current issue:**  
URL mein party ki UUID show ho rahi hai:  
```
/parties/d382f791-3afe-4ef4-90a1-837588304f39/ledger
```

**Fix:**
- URL mein **party ka naam ya slug** dikhna chahiye, ID nahi.
- Example:
  ```
  /parties/ali-traders/ledger
  ```
  ya
  ```
  /parties/ledger?party=ali-traders
  ```

---

## Change 4 — Search Bar Add Karo

**Current issue:** Parties Report ke upar search bar nahi hai.

**Fix:**
- Parties Report / Parties List mein **search bar** add karo.
- User party name se search kar sake.

---

## Implementation Checklist

- [ ] Parties list → compact/congested view
- [ ] Parties Report ko Parties Ledger (inside) se differentiate karo
- [ ] URL → party ID ki jagah meaningful path ya slug use karo
- [ ] Search bar add karo Parties section mein
