# Settings Module — Deep Diagnostic

**Date:** 2026-05-22
**Trigger:** "Settings me bohat hardcoded cheezein hain, bohat sare maslee hain"
**Scope:** Every `/settings/*` route, every settings form component, every settings action, plus the codebase-wide question of "which configured values actually take effect?"

**Status:** **DIAGNOSIS ONLY.** No fixes yet. Each finding awaits triage before being moved to `bugfixed.md`.

Files audited:
- `app/(app)/settings/actions.ts` (canonical settings read/write)
- `app/(app)/settings/page.tsx` (just redirects to /settings/store)
- `app/(app)/settings/layout.tsx` (essentially empty)
- `app/(app)/settings/settings-nav.tsx` (orphan)
- `app/(app)/settings/{store,invoice,tax,pos,appearance,notifications,security,hardware,advanced}/page.tsx`
- `app/(app)/pos/settings/page.tsx` (redirect to advanced)
- `components/settings/*-form.tsx` — all 7 forms
- `components/comprehensive-pos-settings.tsx` — legacy "Advanced" page
- `components/page-loader` removed earlier (unrelated)
- `app/(app)/layout.tsx` (uses `settings.theme` via ThemeSync)
- `contexts/currency-context.tsx` (where currency_symbol *should* be wired)
- `app/(app)/pos/actions.ts` (legacy `getStoreSettings` / `setStoreSettings` — parallel to the new actions)
- `components/pos/print-a4-invoice.ts` (where most settings *should* be read)
- `components/sidebar.tsx`, `components/header.tsx` (where store_name *should* be displayed)

Severity legend: **🔴 Critical** (broken / wrong number / dangerous) · **🟠 High** (feature documented but unimplemented, parallel systems) · **🟡 Medium** (gap / missing feature) · **⚪ Low** (cleanup).

---

## 🔴 CRITICAL

### SET-C1. **Settings forms collect 25+ values but ~90% are NEVER READ anywhere outside the forms themselves**
**Where:** `app/(app)/settings/actions.ts` declares 35 setting keys. Of those:

**Actually wired (3):**
- `theme` — read by `<ThemeSync>` in `app/(app)/layout.tsx`. ✓
- `store_name` / `store_address` / `store_phone` / `store_email` — read by the OLD `getStoreSettings()` action and rendered in the print template's header. Partially. ⚠️
- `print_format` (under "pos_default_print_format" key, via `getUserPrintFormat`) — controls A4 vs NCR. ✓

**Collected but NEVER READ anywhere:**
- `gst_rate` — POS still hardcodes 0% tax, manual invoices hardcode 18%. Settings value ignored.
- `tax_mode` — never queried.
- `currency_symbol` — `CurrencyContext` hardcodes `"PKR"`.
- `default_payment_method` — POS form hardcodes initial state to "Cash".
- `require_customer` — POS form has its own walk-in logic; setting is ignored.
- `allow_below_cost` — POS form always shows the warning toast regardless.
- `pos_auto_print` — no auto-print logic exists anywhere in the code.
- `pos_show_summary` — no summary-before-confirm flow exists.
- `low_stock_threshold` — dashboard uses per-item `minimum_stock`, not this global threshold.
- `email_notifications` — no email-sending infrastructure exists in the entire app.
- `invoice_prefix` — invoice numbers use `id.substring(0,8).toUpperCase()` (UUID prefix).
- `invoice_start_number` — never read.
- `show_discount_col` — print template ALWAYS shows the Disc% / Disc Amt columns.
- `show_tax_col` — print template ALWAYS shows the Tax row.
- `show_unit_col` — print template ALWAYS shows the Unit Qty column.
- `show_ntn_strn` — never rendered on the print.
- `invoice_footer` — print template has hardcoded terms ("1. Damage and expiry...").
- `store_city` — print template doesn't render it.
- `store_ntn` — print template doesn't render it.
- `store_strn` — print template doesn't render it.
- `store_logo_url` — no logo display anywhere.
- `store_whatsapp` — no WhatsApp share feature exists.
- `hw_printer_type` — no printer-type-aware code.
- `hw_printer_ip` — no network printer integration.
- `hw_printer_port` — same.
- `hw_cash_drawer` — no cash drawer code exists.
- `hw_barcode_prefix` — barcode scan handler doesn't strip prefix.
- `hw_barcode_suffix` — same.

**Impact:** Users configure these settings, click Save, see "Settings saved" toast — but **nothing actually changes in the app**. The settings module is largely cosmetic.

---

### SET-C2. **Header/sidebar shows user's first name as "store name" — `store_name` setting bypassed**
**Where:** `app/(app)/layout.tsx:14` → `const businessName = user.name || "InvoSync"`.

`businessName` is passed to `<Header>` and rendered as the title bar. It comes from `pos_users.name` (the user's personal name), NOT from `store_name` setting. So a user "Shahjahan" with store "Al-Madina Traders" sees "Shahjahan" in the topbar instead.

The store_name setting is collected, written to DB, and ignored. The OLD `getStoreSettings()` reads it for print but the layout doesn't.

**Impact:** Single-user accounts show personal name where store name belongs. Multi-tenant deployments look unprofessional.

---

### SET-C3. **SecurityForm is broken — uses Supabase Auth, but this app uses custom `pos_users` table**
**Where:** `components/settings/security-form.tsx:33` → `supabase.auth.updateUser({ password: newPassword })`.

This app has a custom auth model: `pos_users` table with bcrypt-hashed `password_hash` (verified in `lib/db/users.ts`). Supabase Auth is unused. Calling `supabase.auth.updateUser` either:
- Silently fails (no auth session in Supabase Auth tier), OR
- Worse: creates/updates an anon Supabase Auth user that has nothing to do with `pos_users`.

Compounding: the form takes a `currentPassword` field but **never verifies it** before calling updateUser. A successful auth-bypass on the Supabase Auth side wouldn't even require the current password.

**Impact:** Users cannot change their password from settings. The form silently misbehaves. Security concern if Supabase Auth ever does become wired.

---

### SET-C4. **`SettingsNav` component is orphaned — not imported anywhere**
**Where:** `app/(app)/settings/settings-nav.tsx` defined; `app/(app)/settings/layout.tsx` is just `<div>{children}</div>`; no settings page imports SettingsNav.

Result: there's NO tab navigation inside the Settings module. Users land on `/settings/store`, see only that card, and have to navigate to other sub-pages by directly typing URLs or going back through the sidebar.

**Impact:** Effectively unusable settings UX. Every settings sub-page is a dead-end.

---

### SET-C5. **Hardware page exists but is missing from `SettingsNav` even if it were rendered**
**Where:** `app/(app)/settings/settings-nav.tsx:6-15` lists 8 nav items. Hardware is not one of them. But `app/(app)/settings/hardware/page.tsx` exists and renders `HardwareForm`.

So even if SET-C4 were fixed, Hardware would still be unreachable through the nav. Only by URL.

**Impact:** Hardware settings page is fully orphaned.

---

### SET-C6. **Two parallel settings systems coexist**
**Where:**
- **New system:** `app/(app)/settings/actions.ts` — `getAllSettings()` reads ALL 35 keys from `user_settings`. Forms in `/settings/{store,invoice,tax,pos,appearance,notifications,hardware}` use this.
- **Old system:** `app/(app)/pos/actions.ts` — `getStoreSettings()` / `setStoreSettings()` reads/writes a SUBSET (name/address/phone/email only) to the SAME `user_settings` table. Print template (`getInvoiceForPrint`) uses this OLD system. Plus there's the LEGACY `ComprehensivePOSSettings` page at `/settings/advanced` which uses both `setStoreSettings` (old) and `localStorage` (older) to persist.

So a user can:
1. Set store name via `/settings/store` (new system → writes `store_name` key).
2. ALSO set store name via `/settings/advanced` (old system → writes `store_name` key).
3. Both target the same key. Last-write-wins.

But the **print template only reads via the OLD `getStoreSettings()`**, which only fetches name/address/phone/email — not city/ntn/strn/whatsapp/footer. So even if you set NTN in the new form, the print doesn't show it.

**Impact:** Confusing developer experience. Risk of data divergence. Most importantly, the new system's extra fields (NTN/STRN/WhatsApp/city) get written but never read because the read path only loads the old subset.

---

### SET-C7. **`ComprehensivePOSSettings` page uses `localStorage` for some settings**
**Where:** `components/comprehensive-pos-settings.tsx:46-48`.

```ts
setDefaultTaxRate(Number(localStorage.getItem("defaultTaxRate")) || 18)
setNotifications(localStorage.getItem("notifications") !== "false")
```

So `defaultTaxRate` and `notifications` are per-browser, NOT per-user. Open the same account from a different browser → different values. And the rest of the app reads neither of these anywhere.

**Impact:** Settings that pretend to be account-level but are actually browser-local. Cross-device users see inconsistent state.

---

## 🟠 HIGH

### SET-H1. **POS form silently uses hardcoded defaults instead of POSPreferences settings**
**Where:** `components/pos-new-sale-form.tsx`.
- `default_payment_method` setting → ignored. Form hardcodes initial `paymentMethod` state to `"Cash"`.
- `require_customer` setting → ignored. Form always allows walk-in via the `+ Walk-in` button.
- `allow_below_cost` setting → ignored. Below-cost warning toast fires unconditionally.

The settings UI implies these toggles control POS behavior. They don't.

**Fix scope:** Read settings in POS page server component, pass as props to the form, read in form's initial state + relevant guards.

---

### SET-H2. **Invoice settings (prefix / start_number / show_*_col / footer) all ignored by print template**
**Where:** `components/pos/print-a4-invoice.ts`.

Hardcoded values in the print template that should come from settings:
- Invoice number = `data.id.substring(0,8).toUpperCase()` — ignores `invoice_prefix` and `invoice_start_number`.
- Items table headers — Disc%, Disc Amt, Net Price columns always rendered. `show_discount_col` ignored.
- "Tax" row in totals box — controlled by `data.tax > 0` only, not the user's `show_tax_col` preference.
- "Unit Qty" column always shown — `show_unit_col` ignored.
- NTN/STRN — never rendered. `show_ntn_strn` ignored AND `store_ntn`/`store_strn` not in the read path.
- Terms text: hardcoded "1. Damage and expiry... 2. Plz Count Cash..." — `invoice_footer` ignored.
- Fallback store name: "InvoSync" hardcoded.

**Fix scope:** Pass settings into the print template (via the `getInvoiceForPrint` data load), then render conditionally / dynamically.

---

### SET-H3. **Currency symbol setting → ignored by `CurrencyContext`**
**Where:** `contexts/currency-context.tsx:12-18`.

```ts
const formatCurrency = (amount: number): string => {
  const formatted = amount.toLocaleString("en-US", { ... })
  return `PKR ${formatted}`
}
```

Hardcoded `"PKR "` prefix. The provider doesn't read `currency_symbol` from settings. Switching to `"Rs."` or `"₨"` in the UI does nothing.

**Fix scope:** `CurrencyProvider` accepts the symbol (loaded server-side and threaded through layout) and uses it in formatCurrency.

---

### SET-H4. **Tax rate setting → ignored by POS and manual invoices**
**Where:**
- POS: `app/(app)/pos/actions.ts` `createPOSSale`: `taxRate = payload.taxRate ?? 0`. Setting `gst_rate` not consulted.
- Manual invoices: `app/(app)/invoices/actions.ts` `createInvoice`: `taxRate = payload.taxRate || 18`. Setting not consulted.

So a store configures `gst_rate = 17` in settings — every new sale still uses 0 (POS) or 18 (manual). Misleading.

**Fix scope:** Both action paths should default to `gst_rate` setting, with payload as override. Same for `updatePOSSale` and `updateInvoice`.

---

### SET-H5. **`ComprehensivePOSSettings` legacy page duplicates the new individual pages**
**Where:** `app/(app)/settings/advanced/page.tsx` + `components/comprehensive-pos-settings.tsx`.

This is the older "all-in-one" settings page. The new architecture is the per-concern pages (`/settings/store`, `/settings/invoice`, etc.). The Advanced page should either:
- Be removed entirely (the new pages cover everything), OR
- Be turned into a power-user "Show me everything" view that just composes the individual forms.

Currently it's a parallel implementation that competes with the new system and stores some data in localStorage (SET-C7).

---

### SET-H6. **Email notifications setting saved but no email infrastructure exists**
**Where:** `components/settings/notifications-form.tsx:63` collects `emailNotifications` toggle. The app has NO Nodemailer / SendGrid / Resend / SES integration. No code anywhere sends an email.

Toggle does nothing. Better to either:
- Hide the toggle entirely until email is implemented, OR
- Replace with a "Coming soon" badge.

---

### SET-H7. **Store logo never uploaded or displayed**
**Where:** `AppSettings.store_logo_url` exists in the type; no form has an upload UI; no display location renders it. Dead field.

Pakistani stores typically want a logo on receipts. Fix needs:
- File upload component (Supabase Storage or local path)
- Logo display in print template
- Logo display in header/sidebar (optional)

---

### SET-H8. **Hardware settings (printer IP / cash drawer / barcode scanner) all written but never wired**
**Where:** `components/settings/hardware-form.tsx` collects 6 hardware-related values. None are read anywhere in printing, cash handling, or barcode scanning code.

The barcode scanner does work (via `BarcodeScanToPOS` window-event handler) but doesn't honor `hw_barcode_prefix` or `hw_barcode_suffix`. Network printers / cash drawers are fully un-integrated.

**Realistic scope:** Most of this needs significant per-feature work (printer driver, cash drawer signaling). For now, either:
- Mark these as "Coming soon" / hide from UI
- Or wire just the barcode prefix/suffix stripping (lowest effort, immediate user value)

---

### SET-H9. **No backup/restore link from Settings**
**Where:** The backup feature exists at `/backup` (per sidebar) but Settings doesn't mention it. Standard POS expects backup config under Settings (frequency, retention, destination).

---

## 🟡 MEDIUM — Standard POS settings entirely missing

A standard Pakistani retail POS typically has these settings. None exist in this app:

| ID | Missing | Why it matters |
|----|---------|----------------|
| **SET-M1** | "Round Net Amount to nearest 5 / 10" | Cash-only stores round to avoid coin shortage. Common Pakistani practice. |
| **SET-M2** | "Allow negative stock" | Some stores prefer to allow overselling and reconcile later (special orders, pre-orders). |
| **SET-M3** | "Default category / default unit" for new items | Speeds up bulk item creation. |
| **SET-M4** | "Receipt copy count" | Cashier needs N copies (customer + merchant + audit). |
| **SET-M5** | "Working hours / day-close time" | For shift reports, day-end Z-out. |
| **SET-M6** | "Date format" (DD/MM/YYYY vs MM/DD/YYYY) | Pakistani convention is DD/MM/YYYY, but currently hardcoded. |
| **SET-M7** | "Decimal places on prices" | Some stores prefer integer rupees only. |
| **SET-M8** | "Auto-logout idle time" | Security in multi-cashier environments. |
| **SET-M9** | "Default supplier" for purchases | Common-supplier shops can skip vendor selection. |
| **SET-M10** | "Backup frequency / retention" | Cron exists but no UI to configure. |
| **SET-M11** | "Invoice language" (English / Urdu) | Pakistani market split — many stores prefer Urdu receipts. |
| **SET-M12** | "Discount approval threshold" | Cashier can apply up to X% discount without manager approval. |
| **SET-M13** | "Cash count / opening float" | Day-start cash drawer balance. |
| **SET-M14** | "Tax-inclusive vs exclusive display" | Setting exists (`tax_mode`) but nothing reads it. |

---

## ⚪ LOW

### SET-L1. `settings/page.tsx` redirects to `/settings/store` — fine, but no breadcrumb to clarify "Settings" is a group.

### SET-L2. No "Reset to defaults" button on any settings form. User who messed up the values has to remember defaults.

### SET-L3. No "Unsaved changes" guard when navigating away mid-edit.

### SET-L4. Settings forms don't show **loading states** while data is being fetched (each is a server component but the children client forms render immediately with stale defaults).

### SET-L5. `app/(app)/pos/settings/page.tsx` redirects to `/settings/advanced` — should probably redirect to `/settings/pos` (the new POS Preferences page).

### SET-L6. `comprehensive-pos-settings.tsx` imports `MapPin` icon that's never rendered (unused import in a 100+ line file).

### SET-L7. `SettingsNav` uses `pathname === item.href` for active state — strict equality breaks if Next.js adds trailing slash. Should use `pathname.startsWith(item.href)`.

### SET-L8. Print format is stored under TWO different keys: `print_format` (new) and `pos_default_print_format` (old). Cross-write potential.

### SET-L9. Hardware page doesn't expose printer-test functionality. User configures IP / port and has no way to verify without doing a real print.

### SET-L10. `low_stock_threshold` would be a **global default** but inventory items have their own `minimum_stock` column. The two should reconcile: if item has minimum_stock set use it, else fall back to the global setting.

---

## Cross-cutting themes

1. **Settings module is mostly cosmetic.** ~28 out of 35 settings keys are written but never read. Pakistani users will configure things expecting the app to honor them.

2. **Two parallel systems** (`getStoreSettings` old + `getAllSettings` new + localStorage) are confusing to reason about and risk drift.

3. **Print template is the chokepoint.** Most user-visible settings effects should propagate through there (NTN/STRN/footer/show columns/logo). Currently the template is hardcoded.

4. **POS form is the second chokepoint.** Behavior settings (require_customer, allow_below_cost, default_payment, auto_print) all need to be read at form mount.

5. **No "test" or "preview"** anywhere — user can configure but can't immediately verify the effect.

6. **SecurityForm is dangerously broken** — wrong API entirely.

7. **Email + Hardware settings advertise features that don't exist.**

---

## Recommended triage order

If implementing fixes one priority at a time:

1. **SET-C4 + SET-C5** — wire `SettingsNav` into `app/(app)/settings/layout.tsx`, add Hardware + Backup links. Settings UX usable. 10-line fix.
2. **SET-C2** — Header reads `store_name` from settings. 2-line fix in `app/(app)/layout.tsx`.
3. **SET-C3** — Remove broken SecurityForm, replace with a server-action-backed password change against `pos_users` table.
4. **SET-H3** — Wire `currency_symbol` into CurrencyContext.
5. **SET-H4** — POS + manual invoice default tax from `gst_rate` setting.
6. **SET-H2** — Print template reads from settings: footer text, NTN/STRN display, show_*_col toggles, store_logo_url. Biggest user-visible win — but a significant template refactor.
7. **SET-H1** — POS form reads behavior settings (default_payment, require_customer, allow_below_cost).
8. **SET-C6 + SET-H5** — Consolidate the two settings systems. Delete `ComprehensivePOSSettings`, update `getInvoiceForPrint` to use `getAllSettings`.
9. **SET-H6 + SET-H8** — Hide / "Coming soon" badge email + hardware fields that have no backing implementation.
10. **SET-H7** — Implement logo upload + display (Supabase Storage + print template).
11. **SET-M-series** — Add missing standard POS settings one by one based on user priority.
12. **SET-L-series** — Cleanup polish.

**My recommendation:** start with the **"unbreak the basics" pack** (SET-C2 + SET-C4 + SET-C5 + SET-H3), then **"wire the existing settings"** (SET-H1 + SET-H4 + SET-H2 in that order), and **finally** address the "missing standard POS settings" (SET-M series) based on which Pakistani conventions you most want to support.

Per workflow: **none implemented yet.** Bata do kahaan se shuru karein.
