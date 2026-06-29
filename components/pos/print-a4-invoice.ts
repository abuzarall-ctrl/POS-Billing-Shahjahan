import type { InvoiceForPrint } from "@/lib/types/pos"

function esc(s: string): string {
  const div = typeof document !== "undefined" ? document.createElement("div") : null
  if (!div) return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  div.textContent = s
  return div.innerHTML
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// SET-M6: every printed date now respects the configured date_format setting. The format
// string is passed in from the template's render call so this helper stays pure (no DOM /
// settings read on the hot path). Falls back to Pakistani-standard DD/MM/YYYY when unset.
function fmtDate(dateStr: string, format = "DD/MM/YYYY"): string {
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const yyyy = d.getFullYear()
  switch (format) {
    case "MM/DD/YYYY": return `${mm}/${dd}/${yyyy}`
    case "YYYY-MM-DD": return `${yyyy}-${mm}-${dd}`
    case "DD/MM/YYYY":
    default:           return `${dd}/${mm}/${yyyy}`
  }
}

function fmtTime(dateStr: string): string {
  const d = new Date(dateStr)
  let h = d.getHours()
  const min = String(d.getMinutes()).padStart(2, "0")
  const ampm = h >= 12 ? "pm" : "am"
  h = h % 12 || 12
  return `${h}:${min} ${ampm}`
}

function numberToWords(num: number): string {
  const ones = [
    "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE",
    "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN",
    "SEVENTEEN", "EIGHTEEN", "NINETEEN",
  ]
  const tens = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"]

  function convert(n: number): string {
    if (n === 0) return "ZERO"
    if (n < 20) return ones[n]
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "")
    if (n < 1000) return ones[Math.floor(n / 100)] + " HUNDRED" + (n % 100 ? " " + convert(n % 100) : "")
    if (n < 100000) return convert(Math.floor(n / 1000)) + " THOUSAND" + (n % 1000 ? " " + convert(n % 1000) : "")
    if (n < 10000000) return convert(Math.floor(n / 100000)) + " LAKH" + (n % 100000 ? " " + convert(n % 100000) : "")
    return convert(Math.floor(n / 10000000)) + " CRORE" + (n % 10000000 ? " " + convert(n % 10000000) : "")
  }

  // Split into rupees + paise (PKR has paise like INR), so the printed words match the
  // displayed numeric Net Amount even when there's a decimal portion. Previously this
  // function rounded the whole amount before converting, which made the words disagree with
  // the bill total for any invoice ending in .50 etc.
  const rupees = Math.floor(num)
  const paise = Math.round((num - rupees) * 100)
  const rupeesText = convert(rupees) + " RUPEES"
  if (paise === 0) return rupeesText + " ONLY"
  return rupeesText + " AND " + convert(paise) + " PAISA ONLY"
}

// Friendly status label for the print footer. Raw enums ("Paid", "Credit") read like
// developer jargon on a customer-facing receipt — these map to Pakistani-wholesale tones.
function friendlyStatus(s: string): string {
  switch (s) {
    case "Paid": return "Cash Sale"
    case "Credit": return "Credit Sale (Udhaar)"
    case "Pending": return "Partial Payment Pending"
    case "Draft": return "Draft — Not a Sales Receipt"
    case "Partially Returned": return "Partially Returned"
    case "Cancelled": return "Cancelled"
    default: return s
  }
}

// Walk-in customer auto-creates with phone "000-000-0000". That fake number shouldn't be
// printed onto the customer-facing receipt — strip it here in one place so both the A4 and
// the NCR template (which calls this) can share the rule.
export function displayableCustomerPhone(phone: string | undefined | null): string {
  if (!phone) return ""
  if (phone.trim() === "000-000-0000") return ""
  return phone
}

/**
 * A4 Portrait Invoice — Black & White, SHOKIA TRADERS style
 */
export async function printA4Invoice(data: InvoiceForPrint) {
  const invoiceNumber = data.invoiceNumber || data.id.substring(0, 8).toUpperCase()
  const storeName     = data.store?.name    || ""
  const storeAddress  = data.store?.address || ""
  const storeCity     = data.store?.city    || ""
  const storePhone    = data.store?.phone   || ""
  const storeEmail    = data.store?.email   || ""
  const storeWhatsapp = data.store?.whatsapp || ""
  const storeNtn      = data.store?.ntn     || ""
  const storeStrn     = data.store?.strn    || ""
  const storeLogoUrl  = data.store?.logoUrl || ""
  const cashier       = data.cashier        || ""
  // `dateStr` is rebound below once we read printOptions.dateFormat — declared `let` so we
  // can keep the variable name everywhere it's already used in the template body.
  let dateStr         = data.date ? fmtDate(data.date) : ""
  const timeStr       = data.date ? fmtTime(data.date) : ""

  // SET-H2: invoice template options — read from settings, threaded through getInvoiceForPrint.
  // Default each toggle to "on" so a fresh install behaves like the previous hardcoded layout,
  // and store-specific opt-outs (e.g. hide Tax column for tax-free shops) actually take effect.
  const showDiscountCol = data.printOptions?.showDiscountCol ?? true
  const showTaxCol      = data.printOptions?.showTaxCol      ?? true
  const showUnitCol     = data.printOptions?.showUnitCol     ?? true
  const showNtnStrn     = data.printOptions?.showNtnStrn     ?? false
  const footerText      = data.printOptions?.footerText      ?? "1. Damage and expiry item are not refundable.\n2. Plz Count Cash Before Leave Counter."
  // SET-M6: rebind the two date strings to the configured format. dateStr above was computed
  // before we knew the format — re-derive using `df` so reprints respect the latest setting.
  const df              = data.printOptions?.dateFormat       ?? "DD/MM/YYYY"
  // SET-M14: if the store priced items tax-inclusive, the totals row should show
  // "Includes tax: X" instead of "+ Tax: X" — the tax was already in the line subtotal.
  const taxInclusive    = data.printOptions?.taxMode === "Inclusive"
  // Print Date / Time — when this paper actually came out of the printer. Always "now" at
  // render time. Useful when reprinting an older invoice — the customer can tell which copy
  // is fresh. NCR template already has this; A4 was missing it.
  const printDateStr  = fmtDate(new Date().toISOString(), df)
  const printTimeStr  = fmtTime(new Date().toISOString())
  // Re-bind dateStr now that we know the configured format.
  if (data.date) dateStr = fmtDate(data.date, df)

  const billDiscount  = Number(data.discount || 0)

  // Payment method display. For a Draft / unpaid Credit there are no payment rows yet —
  // show "—" instead of misleading "Cash". For sales with payments, show the unique
  // methods joined.
  const isDraft = data.status === "Draft"
  const hasPayments = !!(data.payments && data.payments.length > 0)
  const payMethod = hasPayments
    ? [...new Set(data.payments!.map((p) => p.method))].join(" / ")
    : isDraft ? "—" : data.status === "Credit" ? "Pending" : "Cash"

  // Cash Paid / Balance Due rows in the totals box. Sum all payment rows for the cash-paid
  // figure; balance is the remainder of the net amount. Both default to 0 for Drafts.
  const cashPaid = hasPayments
    ? data.payments!.reduce((s, p) => s + Number(p.amount || 0), 0)
    : 0
  const balanceDue = Math.max(0, Number(data.total || 0) - cashPaid)
  const showPreBal = data.printOptions?.showPreBalance === true
  const preBalance = Number(data.preBalance ?? 0)
  const grandTotal = balanceDue + preBalance

  // Decide whether to render the CTN column. Show it only when at least one item on the
  // invoice has a pack configured, otherwise keep the table compact for non-pack stores.
  const anyPack = data.items.some(
    (it) => !!(it.packSize && it.packSize > 0 && it.packLabel),
  )

  // Build items table rows. Per-line discount info (originalUnit, discAmt, netUnit) renders
  // directly in the Disc%/Disc Amt/Net Price columns on each row — no aggregate sums needed
  // in the totals box on the right, so we don't accumulate gross-or-discount totals here.
  let itemRows = ""
  data.items.forEach((item, i) => {
    const qty = Number(item.quantity || 0)
    const effectiveUnit = Number(item.unitPrice || 0)
    const persistedDiscount = Number(item.discountAmount || 0)
    // Original list price per unit. For invoices saved before the line-discount migration
    // both fields are absent, so we synthesise the gross from (effective × qty) + 0 disc.
    const originalUnit =
      item.originalUnitPrice != null && Number(item.originalUnitPrice) > 0
        ? Number(item.originalUnitPrice)
        : effectiveUnit + (qty > 0 ? persistedDiscount / qty : 0)
    const lineGross = originalUnit * qty
    const discAmt = persistedDiscount
    const discPct = lineGross > 0 ? (discAmt / lineGross) * 100 : 0
    // Net per-unit price = effective unit price actually charged. New column in the
    // invoice so the customer can see exactly what they paid per unit after the discount.
    const netUnit = qty > 0 ? (lineGross - discAmt) / qty : effectiveUnit

    // CTN cell: qty / pack_size, em-dash when this row has no pack but other rows do.
    const ctnCell = anyPack
      ? item.packSize && item.packSize > 0
        ? (() => {
            const ctnCount = qty / item.packSize
            const ctnStr = Number.isInteger(ctnCount)
              ? String(ctnCount)
              : (Math.round(ctnCount * 100) / 100).toString()
            return `<td class="tc">${ctnStr}</td>`
          })()
        : `<td class="tc">—</td>`
      : ""

    // Column rendering is gated by the user's invoice settings. Discount cols + Unit Qty
    // col are show-by-default but a tax-free / pack-only store can hide them.
    const unitCell      = showUnitCol     ? `<td class="tc">${qty}</td>` : ""
    const discPctCell   = showDiscountCol ? `<td class="tc">${discPct === 0 ? "0.00%" : `${(Math.round(discPct * 100) / 100).toFixed(2)}%`}</td>` : ""
    const discAmtCell   = showDiscountCol ? `<td class="tr">${fmtMoney(discAmt)}</td>` : ""
    const netPriceCell  = showDiscountCol ? `<td class="tr">${fmtMoney(netUnit)}</td>` : ""

    itemRows += `
      <tr>
        <td class="tc">${i + 1}</td>
        <td class="tl item-name">${esc(item.name)}</td>
        ${unitCell}
        ${ctnCell}
        <td class="tr">${fmtMoney(originalUnit)}</td>
        ${discPctCell}
        ${discAmtCell}
        ${netPriceCell}
        <td class="tr fw">${fmtMoney(item.lineTotal)}</td>
      </tr>`
  })

  // Net Amount = what the customer actually pays (already correct on `sales_invoices.total`).
  // Bill discount + tax render conditionally above the Net Amount row in the totals box.
  const netAmount = data.total
  // Pass the unrounded net amount so `numberToWords` can emit "… AND FIFTY PAISA ONLY"
  // for invoices ending in non-zero paise. Previously rounding to integer here threw away
  // the paise and the words disagreed with the displayed Net Amount by up to 0.99 PKR.
  const amountWords = numberToWords(showPreBal ? grandTotal : netAmount)

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice ${esc(invoiceNumber)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10px;
      color: #000;
      background: #fff;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }

    /* ── Header ── */
    .store-name  { text-align:center; font-size:20px; font-weight:900; letter-spacing:1px; }
    .store-tag   { text-align:center; font-size:10px; font-weight:600; margin-top:1px; }
    .store-addr  { text-align:center; font-size:9.5px; margin-top:1px; }
    .divider     { border:none; border-top:2px solid #000; margin:4px 0; }
    .divider-sm  { border:none; border-top:1px solid #000; margin:3px 0; }

    /* ── Customer / Bill info row ── */
    .info-row    { width:100%; border-collapse:collapse; margin-bottom:4px; }
    .info-row td { vertical-align:top; padding:1.5px 0; font-size:10px; }
    .bill-box    { border:1px solid #000; padding:3px 6px; font-size:9.5px; }
    .bill-box tr td { padding:1px 3px; }
    .bill-box .lbl { font-weight:700; white-space:nowrap; padding-right:5px; }

    /* ── Items table ── */
    .items { width:100%; border-collapse:collapse; font-size:9.5px; margin-top:3px; table-layout:fixed; }
    .items th {
      border:1px solid #000;
      padding:3px 4px;
      font-weight:700;
      background:#fff;
      text-align:center;
      overflow:hidden;
    }
    .items td { border:1px solid #000; padding:2.5px 4px; overflow:hidden; }
    /* Item Name cell wraps onto multiple lines instead of silently truncating long
       Pakistani SKUs (e.g. "PARLE-G ORIGINAL GLUCOSE BISCUIT 250G FAMILY PACK"). */
    .items td.item-name { white-space:normal; word-wrap:break-word; overflow:visible; }

    /* ── Draft banner ── prominent label so a Draft print can't be mistaken for a finalized
       sales receipt. NCR has this already; the A4 footer "Status: Draft" was too easy to miss. */
    .draft-banner {
      background:#000; color:#fff;
      text-align:center; font-weight:900; letter-spacing:2px;
      font-size:13px; padding:4px 0; margin:3px 0;
    }
    .tc { text-align:center; }
    .tl { text-align:left; }
    .tr { text-align:right; }
    .fw { font-weight:700; }

    /* ── Totals ── */
    .totals-table { border-collapse:collapse; width:100%; }
    .totals-table td { padding:2px 5px; font-size:10px; border:1px solid #000; }
    .totals-table .lbl { font-weight:600; }
    .totals-table .val { text-align:right; font-weight:600; }
    .totals-table .net { font-weight:800; font-size:11px; }

    /* ── Words ── */
    .words-box {
      border:1px solid #000;
      padding:3px 6px;
      font-size:9.5px;
    }
    .words-box strong { font-weight:700; }

    /* ── Terms ── */
    .terms { font-size:9px; margin-top:5px; line-height:1.6; }

    /* ── Footer ── */
    .footer {
      display:flex;
      justify-content:space-between;
      align-items:flex-end;
      margin-top:6px;
      border-top:1.5px solid #000;
      padding-top:4px;
      font-size:9px;
    }
  </style>
</head>
<body>

  <!-- STORE HEADER — SET-H2 dynamic from settings. Logo top-centred if set, then name,
       address + city (city below address), then contact line combining phone / whatsapp /
       email. NTN/STRN line renders only when showNtnStrn is true (Pakistani registered
       businesses opt in). -->
  ${storeLogoUrl ? `<div style="text-align:center;margin-bottom:4px;"><img src="${esc(storeLogoUrl)}" alt="Logo" style="max-height:60px;max-width:180px;" /></div>` : ""}
  <div class="store-name">${esc(storeName)}</div>
  ${storeAddress ? `<div class="store-tag">${esc(storeAddress)}</div>` : ""}
  ${storeCity ? `<div class="store-addr">${esc(storeCity)}</div>` : ""}
  ${(storePhone || storeWhatsapp || storeEmail) ? `<div class="store-addr">${[
    storePhone   ? `Phone: ${esc(storePhone)}` : "",
    storeWhatsapp ? `WhatsApp: ${esc(storeWhatsapp)}` : "",
    storeEmail   ? esc(storeEmail) : "",
  ].filter(Boolean).join(" | ")}</div>` : ""}
  ${showNtnStrn && (storeNtn || storeStrn) ? `<div class="store-addr">${[
    storeNtn  ? `NTN: ${esc(storeNtn)}` : "",
    storeStrn ? `STRN: ${esc(storeStrn)}` : "",
  ].filter(Boolean).join("  |  ")}</div>` : ""}
  <hr class="divider">

  <!-- CUSTOMER INFO + BILL BOX -->
  <table class="info-row" cellpadding="0" cellspacing="0">
    <tr>
      <td style="width:auto;">
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-weight:700;padding-right:6px;white-space:nowrap;">Customer Name:</td>
            <td style="white-space:nowrap;">${data.party?.name ? esc(data.party.name) : ""}</td>
          </tr>
          ${displayableCustomerPhone(data.party?.phone) ? `<tr>
            <td style="font-weight:700;padding-right:6px;white-space:nowrap;">Contact No:</td>
            <td style="white-space:nowrap;">${esc(displayableCustomerPhone(data.party?.phone))}</td>
          </tr>` : ""}
          ${data.party?.address ? `<tr>
            <td style="font-weight:700;padding-right:6px;white-space:nowrap;">Address:</td>
            <td>${esc(data.party.address)}</td>
          </tr>` : ""}
          ${cashier ? `<tr>
            <td style="font-weight:700;padding-right:6px;white-space:nowrap;">User:</td>
            <td style="white-space:nowrap;">${esc(cashier)}</td>
          </tr>` : ""}
        </table>
      </td>
      <td style="width:1px;"></td>
      <td style="text-align:right;white-space:nowrap;">
        <table class="bill-box" cellpadding="0" cellspacing="0" style="margin-left:auto;">
          <tr>
            <td class="lbl">Bill No:</td>
            <td><strong>${esc(invoiceNumber)}</strong></td>
          </tr>
          <tr>
            <td class="lbl">Date:</td>
            <td>${esc(dateStr)}</td>
          </tr>
          <tr>
            <td class="lbl">Time:</td>
            <td>${esc(timeStr)}</td>
          </tr>
          <tr>
            <td class="lbl">Payment:</td>
            <td>${esc(payMethod)}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <hr class="divider-sm">

  ${isDraft ? `<div class="draft-banner">DRAFT — NOT A SALES RECEIPT</div>` : ""}

  <!-- ITEMS TABLE — SET-H2 columns are gated on showUnitCol / showDiscountCol toggles.
       The S#, Item Name, Unit Price, and Amount columns are always present (core to any
       invoice). CTN is conditional on at least one item having pack info (anyPack).
       Tfoot colspan is computed dynamically below to match whatever columns are visible. -->
  <table class="items" cellpadding="0" cellspacing="0">
    <colgroup>
      <col style="width:4%">
      <col>
      ${showUnitCol ? `<col style="width:7%">` : ""}
      ${anyPack ? `<col style="width:7%">` : ""}
      <col style="width:12%">
      ${showDiscountCol ? `<col style="width:8%">` : ""}
      ${showDiscountCol ? `<col style="width:11%">` : ""}
      ${showDiscountCol ? `<col style="width:12%">` : ""}
      <col style="width:18%">
    </colgroup>
    <thead>
      <tr>
        <th>S#</th>
        <th style="text-align:left;">Item Name</th>
        ${showUnitCol ? `<th>Unit Qty</th>` : ""}
        ${anyPack ? `<th>CTN</th>` : ""}
        <th>Unit Price</th>
        ${showDiscountCol ? `<th>Disc%</th>` : ""}
        ${showDiscountCol ? `<th>Disc Amt</th>` : ""}
        ${showDiscountCol ? `<th>Net Price</th>` : ""}
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
    <tfoot>
      <tr>
        <td class="tc fw" colspan="2">Total Items: ${data.items.length}</td>
        ${showUnitCol ? `<td class="tc fw">${data.items.reduce((s, i) => s + i.quantity, 0)}</td>` : ""}
        ${anyPack ? `<td class="tc fw">${(() => {
          const totalPack = data.items.reduce((s, i) => {
            if (i.packSize && i.packSize > 0) return s + i.quantity / i.packSize
            return s
          }, 0)
          return Number.isInteger(totalPack) ? String(totalPack) : (Math.round(totalPack * 100) / 100).toString()
        })()}</td>` : ""}
        <!-- Empty cells covering: Unit Price + (Disc%/DiscAmt/NetPrice if visible) + Amount.
             Per-line totals already render on each row; the Net Amount is in the right-side
             totals box. A repeated sum in the table footer would be redundant. -->
        <td colspan="${1 + (showDiscountCol ? 3 : 0) + 1}"></td>
      </tr>
    </tfoot>
  </table>

  <!-- BOTTOM ROW: Words+Terms (left) | Totals (right) -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;vertical-align:top;">
    <tr>
      <!-- LEFT: Amount in words + Terms. SET-H2: terms come from the user-configured
           invoice_footer setting (newlines render as line breaks). Default keeps the
           historical "Damage and expiry... / Plz Count Cash..." until customised. -->
      <td style="vertical-align:top;padding-right:8px;">
        <div class="words-box">
          <strong>Amount In Words:</strong> ${esc(amountWords)}
        </div>
        <div class="terms">
          ${esc(footerText).split("\n").join("<br>")}
        </div>
      </td>
      <!-- RIGHT: Totals box — minimal by design.
            • Per-line discounts already render in the "Disc Amt" column on every item row,
              so we don't sum them into a separate "Less Line Discount" row here.
            • "Less Bill Discount" appears ONLY when the cashier added a bill-level rebate
              on top of the line items (most invoices have none, so the row is hidden).
            • "Tax" likewise hidden when 0%.
            • Cash Paid / Balance Due only shown when a payment is recorded. -->
      <td style="vertical-align:top;width:240px;">
        <table class="totals-table" width="100%" cellpadding="0" cellspacing="0">
          ${billDiscount > 0 ? `
          <tr>
            <td class="lbl">Total Amount:</td>
            <td class="val">${fmtMoney(Number(netAmount) + billDiscount)}</td>
          </tr>
          <tr>
            <td class="lbl">Less Bill Discount:</td>
            <td class="val">${fmtMoney(billDiscount)}</td>
          </tr>` : ""}
          ${(showTaxCol && data.tax > 0) ? `
          <tr>
            <td class="lbl">${taxInclusive ? "Includes Tax:" : "Tax:"}</td>
            <td class="val">${fmtMoney(data.tax)}</td>
          </tr>` : ""}
          <tr>
            <td class="lbl net">Net Amount:</td>
            <td class="val net">${fmtMoney(netAmount)}</td>
          </tr>
          ${hasPayments ? `
          <tr>
            <td class="lbl">Cash Paid:</td>
            <td class="val">${fmtMoney(cashPaid)}</td>
          </tr>
          <tr>
            <td class="lbl ${balanceDue > 0 ? "net" : ""}">Balance Due:</td>
            <td class="val ${balanceDue > 0 ? "net" : ""}">${fmtMoney(balanceDue)}</td>
          </tr>` : ""}
          ${showPreBal ? `
          <tr><td colspan="2"><hr style="border:none;border-top:1px dashed #999;margin:3px 0;"></td></tr>
          <tr>
            <td class="lbl">Previous Balance:</td>
            <td class="val">${fmtMoney(preBalance)}</td>
          </tr>
          <tr>
            <td class="lbl net">Grand Total Payable:</td>
            <td class="val net">${fmtMoney(grandTotal)}</td>
          </tr>` : ""}
        </table>
        ${hasPayments && data.payments!.length > 1 ? `
        <!-- Payment history — per-row breakdown so a Credit customer reading a reprint can
             reconcile against their own records. Hidden when there's only one payment row
             (already implicit in the Cash Paid line above). -->
        <table class="totals-table" width="100%" cellpadding="0" cellspacing="0" style="margin-top:3px;">
          <tr>
            <td class="lbl" colspan="2" style="text-align:center;font-size:9px;">Payment History</td>
          </tr>
          ${data.payments!.map((p) => `<tr>
            <td class="lbl" style="font-size:9px;font-weight:500;">${esc(fmtDate(p.created_at, df))} · ${esc(p.method)}${p.reference ? ` (${esc(p.reference)})` : ""}</td>
            <td class="val" style="font-size:9px;font-weight:500;">${fmtMoney(Number(p.amount || 0))}</td>
          </tr>`).join("")}
        </table>` : ""}
      </td>
    </tr>
  </table>

  <!-- FOOTER -->
  <div class="footer">
    <div>
      ${storePhone ? `<strong>Contact No:</strong> ${esc(storePhone)}<br>` : ""}
      <span style="color:#444;">Printed: ${esc(printDateStr)} ${esc(printTimeStr)}</span>
    </div>
    <div style="text-align:right;">
      <strong>Status:</strong> ${esc(friendlyStatus(data.status))}
    </div>
  </div>

</body>
</html>`

  const win = window.open("", "_blank")
  if (!win) {
    console.error("Popup blocked — allow popups to print")
    return
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => {
    win.print()
    win.close()
  }, 300)
}
