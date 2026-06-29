# Phase 1 — POS: Bill Scenarios (URGENT / Immediate Implementation)

**Module:** POS (Point of Sale)  
**PDF Pages:** 14–17  
**Priority:** 🔴 URGENT — Immediately implement karna hai

---

## Overview

POS ke `New Sale` mein bill print scenarios ko handle karna hai.  
4 scenarios hain — 2 Credit (Udhaar) ke liye, 2 Cash ke liye.  
In sab scenarios ko ek **checkbox** control karega jo `New Sale` screen par hoga.

---

## Checkbox (Global Toggle)

- POS → **New Sale** screen par ek **checkbox** add karna hai.
- Jab checkbox **ON** hoga → tabhi pre-balance / scenarios wala feature kaam karega.
- Jab checkbox **OFF** hoga → koi change nahi aayega, bill normal print hoga.

---

## Scenario 1 — Credit (Udhaar) — No Payment

> Suppose ek bill udhaar pe ban raha hai aur us bill ki **koi bhi payment nahi aayi**.

**Bill mein ye add karna hai:**
- Bill ke neeche ek section add hoga jo show karega:
  - Total Bill Amount
  - Amount Received: 0
  - Outstanding Balance: (full bill amount)
- Baaki saari cheezein same rahein gi.

---

## Scenario 2 — Credit (Udhaar) — Partial Payment

> Suppose bill udhaar pe banta hai aur customer **usi time usi bill ka kuch amount deta hai**.

**Bill mein ye show hoga:**
- Total Bill Amount
- Amount Received: (jo customer ne usi waqt diya)
- Outstanding Balance: (Bill Amount − Amount Received)

---

## Scenario 1 — Cash — With Pre-Balance

> Suppose ek customer ne **cash pe saman liya** lekin kehta hai ke bill mein uska **pre-balance (pehle ka baaki)** bhi show karo.

**Bill mein ye show hoga:**
- Total Bill Amount (current purchase)
- Previous Balance (pre-balance)
- Grand Total = Current Bill + Pre-Balance

---

## Scenario 2 — Cash — Without Pre-Balance

> Agar customer cash pe saman leta hai aur **pre-balance show nahi karna**.

**Bill mein:**
- Koi change nahi aayega.
- Normal cash bill print hoga.
- Is condition mein koi extra field nahi dikhega.

---

## Implementation Checklist

- [ ] `New Sale` screen par **"Show Balance on Bill"** checkbox add karo
- [ ] Checkbox state ko bill generation logic se connect karo
- [ ] Credit Scenario 1: No payment → Outstanding = Full Amount
- [ ] Credit Scenario 2: Partial payment → Outstanding = Bill − Paid
- [ ] Cash Scenario 1: Pre-balance field add karo bill mein
- [ ] Cash Scenario 2: Default — no change (existing behavior)
- [ ] Checkbox OFF hone par saare scenarios bypass ho jayen
