import type { InvoiceForPrint } from "@/lib/types/pos"
import { displayableCustomerPhone } from "./print-a4-invoice"

function esc(s: string): string {
  const div = typeof document !== "undefined" ? document.createElement("div") : null
  if (!div) return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  div.textContent = s
  return div.innerHTML
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// SET-M6: date helper now takes the configured format. Matches the A4 helper so the two
// templates stay in sync. Default DD/MM/YYYY (Pakistani standard) when unset.
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

function fmtTimeFull(dateStr: string): string {
  const d = new Date(dateStr)
  let h = d.getHours()
  const min = String(d.getMinutes()).padStart(2, "0")
  const sec = String(d.getSeconds()).padStart(2, "0")
  const ampm = h >= 12 ? "PM" : "AM"
  h = h % 12 || 12
  return `${String(h).padStart(2, "0")}:${min}:${sec}${ampm}`
}

// SET-H2 mirror: NCR thermal template now honors the same invoice-template settings as A4 —
// store_city, store_whatsapp, store_ntn, store_strn, store_logo_url for the header; the four
// show_*_col toggles for table columns; invoice_footer for terms; tax_mode for the totals row;
// date_format for every printed date. The caller passes a copyLabel (already labelled with the
// configured copy count and index, e.g. "Copy 1 of 3 — Customer Copy") so this helper just
// renders it as-is.
function buildCopy(data: InvoiceForPrint, copyLabel: string): string {
  const storeName     = data.store?.name    || ""
  const storeAddr     = data.store?.address || ""
  const storeCity     = data.store?.city    || ""
  const storePhone    = data.store?.phone   || ""
  const storeWhatsapp = data.store?.whatsapp || ""
  const storeEmail    = data.store?.email   || ""
  const storeNtn      = data.store?.ntn     || ""
  const storeStrn     = data.store?.strn    || ""
  const storeLogoUrl  = data.store?.logoUrl || ""
  const cashier       = data.cashier        || ""
  const invNo         = data.invoiceNumber  || data.id.substring(0, 8).toUpperCase()

  // SET-H2/M6/M14: pull through the print options. Defaults match the legacy hardcoded layout
  // so existing receipts look the same until a setting is actively changed.
  const showDiscountCol = data.printOptions?.showDiscountCol ?? true
  const showTaxCol      = data.printOptions?.showTaxCol      ?? true
  const showNtnStrn     = data.printOptions?.showNtnStrn     ?? false
  const footerText      = data.printOptions?.footerText      ?? "1- Only Products can be exchanged within 7 days of sales.\n2- Check your Product Before Leave Counter.\n3- Damage Product no Exchange Or Return."
  const df              = data.printOptions?.dateFormat      ?? "DD/MM/YYYY"
  const taxInclusive    = data.printOptions?.taxMode === "Inclusive"

  const dateStr    = data.date ? fmtDate(data.date, df) : ""
  const timeStr    = data.date ? fmtTime(data.date) : ""
  const printDate  = fmtDate(new Date().toISOString(), df)
  const printTime  = fmtTimeFull(new Date().toISOString())

  const discount   = Number(data.discount || 0)
  // Cash paid is *always* the sum of actual payment rows. Previously the "else" branch
  // assumed any non-Pending/Draft/Credit invoice (i.e. Paid) had implicitly received
  // `data.total` cash — but if the payment row was deleted later, the reprint would still
  // show a phantom "Cash Paid: <total>" line. Now: no payment rows ⇒ 0 paid, period.
  const cashPaid   = data.payments && data.payments.length > 0
    ? data.payments.reduce((s, p) => s + Number(p.amount || 0), 0)
    : 0
  // Payment method label: only show a method when at least one payment row exists. For
  // Drafts and unpaid Credit sales we show "—" / "Pending" — printing "Cash" implied the
  // customer had paid cash when they hadn't.
  const payMethod  = data.payments && data.payments.length > 0
    ? [...new Set(data.payments.map((p) => p.method))].join(" / ")
    : data.status === "Draft" ? "—" : data.status === "Credit" ? "Pending" : "Cash"
  const remainingBalance = data.total - cashPaid
  const isDraft   = data.status === "Draft"
  const isCredit  = data.status === "Credit"
  const showPreBal = data.printOptions?.showPreBalance === true
  const preBalance = Number(data.preBalance ?? 0)
  const grandTotal = remainingBalance + preBalance

  const itemCount  = data.items.length
  const totalQty   = data.items.reduce((s, i) => s + i.quantity, 0)

  // Build item rows — no alternating background, tight padding like real thermal paper. When
  // a line carries a per-line discount AND showDiscountCol is on, append a small italic
  // sub-row "Disc: -<amount> (<pct>%)". On narrow thermal width we use a sub-row instead of
  // dedicated columns. When showDiscountCol is off, line discounts are silently absorbed into
  // the Rate column (display the effective price the customer actually paid).
  let itemRows = ""
  data.items.forEach((item, idx) => {
    const qty = Number(item.quantity || 0)
    const effectiveUnit = Number(item.unitPrice || 0)
    const discAmt = Number(item.discountAmount || 0)
    const originalUnit =
      item.originalUnitPrice != null && Number(item.originalUnitPrice) > 0
        ? Number(item.originalUnitPrice)
        : effectiveUnit + (qty > 0 ? discAmt / qty : 0)
    const lineGross = originalUnit * qty
    const discPct = lineGross > 0 && discAmt > 0 ? (discAmt / lineGross) * 100 : 0
    // When the discount column is on, show original list price as Rate so the saving is
    // visible. When off, show the effective unit price (clean receipt with no disc info).
    const displayRate = showDiscountCol && discAmt > 0 ? originalUnit : effectiveUnit

    itemRows += `
      <tr style="border-bottom:${showDiscountCol && discAmt > 0 ? "0" : "0.5px solid #e0e0e0"};">
        <td style="padding:0.3mm 0.5mm;text-align:left;vertical-align:top;color:#000;">${idx + 1}</td>
        <td style="padding:0.3mm 0.5mm;text-align:left;vertical-align:top;color:#000;word-break:break-word;">${esc(item.name)}</td>
        <td style="padding:0.3mm 0.5mm;text-align:right;vertical-align:top;color:#000;">${qty}</td>
        <td style="padding:0.3mm 0.5mm;text-align:right;vertical-align:top;color:#000;">${fmtNum(displayRate)}</td>
        <td style="padding:0.3mm 0.5mm;text-align:right;vertical-align:top;font-weight:700;color:#000;">${fmtNum(item.lineTotal)}</td>
      </tr>`
    if (showDiscountCol && discAmt > 0) {
      itemRows += `
      <tr style="border-bottom:0.5px solid #e0e0e0;">
        <td colspan="2" style="padding:0 0.5mm 0.4mm 5mm;font-style:italic;font-size:7.5px;color:#000;">Disc ${discPct.toFixed(2)}%</td>
        <td colspan="3" style="padding:0 0.5mm 0.4mm 0.5mm;text-align:right;font-style:italic;font-size:7.5px;color:#000;">-${fmtNum(discAmt)}</td>
      </tr>`
    }
  })

  return `
  <div class="receipt">

    <!-- COPY LABEL — passed in from caller; reflects configured copy count + index. -->
    <div style="text-align:center;font-size:7.5px;border:1px solid #000;padding:1px 5px;margin-bottom:1.5mm;display:inline-block;float:right;color:#000;font-weight:700;letter-spacing:0.5px;">
      ${esc(copyLabel)}
    </div>
    <div style="clear:both;"></div>

    <!-- STORE LOGO (top, centred) — SET-H2 mirror. Skipped when no logo configured. -->
    ${storeLogoUrl ? `<div style="text-align:center;margin-bottom:1mm;"><img src="${esc(storeLogoUrl)}" alt="Logo" style="max-height:40px;max-width:120px;" /></div>` : ""}

    <!-- STORE NAME -->
    <div style="text-align:center;font-size:15px;font-weight:900;letter-spacing:0.3px;margin-bottom:0.8mm;color:#000;">
      ${esc(storeName)}
    </div>

    <!-- STORE ADDRESS + CITY + CONTACT LINE — SET-H2 mirror.
         City prints on its own line under address. Phone/WhatsApp/Email collapse into a
         single pipe-delimited contact line so the thermal header stays compact. -->
    ${storeAddr ? `<div style="text-align:center;font-size:8px;line-height:1.4;color:#000;">${esc(storeAddr)}</div>` : ""}
    ${storeCity ? `<div style="text-align:center;font-size:8px;line-height:1.4;color:#000;">${esc(storeCity)}</div>` : ""}
    ${(storePhone || storeWhatsapp || storeEmail) ? `<div style="text-align:center;font-size:8px;margin-bottom:0.5mm;color:#000;">${[
      storePhone   ? `Phone: ${esc(storePhone)}` : "",
      storeWhatsapp ? `WhatsApp: ${esc(storeWhatsapp)}` : "",
      storeEmail   ? esc(storeEmail) : "",
    ].filter(Boolean).join(" | ")}</div>` : ""}
    ${showNtnStrn && (storeNtn || storeStrn) ? `<div style="text-align:center;font-size:8px;margin-bottom:0.5mm;color:#000;">${[
      storeNtn  ? `NTN: ${esc(storeNtn)}` : "",
      storeStrn ? `STRN: ${esc(storeStrn)}` : "",
    ].filter(Boolean).join(" | ")}</div>` : ""}

    <!-- SALES RECEIPT BAR -->
    <div style="background:#000;color:#fff;text-align:center;font-weight:700;font-size:9.5px;padding:2px 0;margin:1.5mm 0;">
      ${isDraft ? "Draft Invoice" : isCredit ? "Credit Sale (Udhaar)" : "Sales Receipt"}
    </div>

    <!-- BILL INFO -->
    <table style="width:100%;font-size:8px;margin-bottom:0.8mm;color:#000;" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:0.3mm 0;color:#000;">Bill No: <strong style="color:#000;">${esc(invNo)}</strong></td>
        <td style="padding:0.3mm 0;text-align:right;color:#000;">${cashier ? `User: <strong style="color:#000;">${esc(cashier)}</strong>` : ""}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:0.3mm 0;color:#000;">Date &amp; Time: ${esc(dateStr)} - ${esc(timeStr)}</td>
      </tr>
      ${displayableCustomerPhone(data.party?.phone) ? `<tr>
        <td colspan="2" style="padding:0.3mm 0;color:#000;">Customer Contact #: ${esc(displayableCustomerPhone(data.party?.phone))}</td>
      </tr>` : ""}
      <tr>
        <td colspan="2" style="padding:0.3mm 0;color:#000;">Customer Name: ${data.party?.name ? esc(data.party.name) : ""}</td>
      </tr>
      ${data.party?.address ? `<tr>
        <td colspan="2" style="padding:0.3mm 0;color:#000;">Customer Address: ${esc(data.party.address)}</td>
      </tr>` : ""}
    </table>

    <!-- ITEMS TABLE -->
    <table style="width:100%;border-collapse:collapse;font-size:8px;color:#000;table-layout:fixed;" cellpadding="0" cellspacing="0">
      <colgroup>
        <col style="width:6%">
        <col style="width:38%">
        <col style="width:12%">
        <col style="width:20%">
        <col style="width:24%">
      </colgroup>
      <thead>
        <tr style="border-top:1.5px solid #000;border-bottom:1.5px solid #000;">
          <th style="padding:1mm 0.5mm;text-align:left;font-weight:700;color:#000;">Sr</th>
          <th style="padding:1mm 0.5mm;text-align:left;font-weight:700;color:#000;">Description</th>
          <th style="padding:1mm 0.5mm;text-align:right;font-weight:700;color:#000;">Qty</th>
          <th style="padding:1mm 0.5mm;text-align:right;font-weight:700;color:#000;">Rate</th>
          <th style="padding:1mm 0.5mm;text-align:right;font-weight:700;color:#000;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <!-- SUMMARY ROW -->
    <div style="border-top:1.5px solid #000;border-bottom:1px dashed #000;font-size:8px;padding:0.5mm 0.5mm;margin-top:0;color:#000;">
      No. Of Item(s) ${itemCount} &nbsp;&nbsp; Total Qty: ${totalQty}
    </div>

    <!-- TOTALS — SET-M14: tax label switches to "Includes Tax" when tax_mode = Inclusive. -->
    <table style="width:100%;font-size:9px;margin-top:0.5mm;color:#000;" cellpadding="0" cellspacing="0">
      ${(showTaxCol && data.tax > 0) ? `
      <tr>
        <td></td>
        <td style="text-align:right;padding:0.3mm 0.5mm;color:#000;">Subtotal:</td>
        <td style="text-align:right;padding:0.3mm 0.5mm;min-width:18mm;color:#000;">${fmtNum(data.subtotal)}</td>
      </tr>
      <tr>
        <td></td>
        <td style="text-align:right;padding:0.3mm 0.5mm;color:#000;">${taxInclusive ? "Includes Tax:" : "Tax:"}</td>
        <td style="text-align:right;padding:0.3mm 0.5mm;color:#000;">${fmtNum(data.tax)}</td>
      </tr>` : ""}
      ${discount > 0 ? `
      <tr>
        <td></td>
        <td style="text-align:right;padding:0.3mm 0.5mm;color:#000;">Total Amount:</td>
        <td style="text-align:right;padding:0.3mm 0.5mm;color:#000;">${fmtNum(data.total + discount)}</td>
      </tr>
      <tr>
        <td></td>
        <td style="text-align:right;padding:0.3mm 0.5mm;color:#000;">Discount:</td>
        <td style="text-align:right;padding:0.3mm 0.5mm;color:#000;">-${fmtNum(discount)}</td>
      </tr>` : ""}
      <tr>
        <td></td>
        <td style="text-align:right;padding:0.3mm 0.5mm;font-weight:700;font-size:9.5px;color:#000;">Net Amount:</td>
        <td style="text-align:right;padding:0.3mm 0.5mm;font-weight:700;font-size:9.5px;color:#000;">${fmtNum(data.total)}</td>
      </tr>
      ${cashPaid > 0 ? `
      <tr>
        <td></td>
        <td style="text-align:right;padding:0.3mm 0.5mm;font-weight:700;font-size:9.5px;color:#000;">${esc(payMethod)} Paid:</td>
        <td style="text-align:right;padding:0.3mm 0.5mm;font-weight:700;font-size:9.5px;color:#000;">${fmtNum(cashPaid)}</td>
      </tr>` : ""}
      <tr>
        <td colspan="3"><div style="border-top:1px dashed #000;margin:1mm 0;"></div></td>
      </tr>
      <tr>
        <td></td>
        <td style="text-align:right;padding:0.3mm 0.5mm;font-weight:700;font-size:9.5px;color:#000;">Remaining Balance:</td>
        <td style="text-align:right;padding:0.3mm 0.5mm;font-weight:700;font-size:9.5px;color:#000;">${fmtNum(remainingBalance)}</td>
      </tr>
      ${showPreBal ? `
      <tr><td colspan="3"><div style="border-top:1px dashed #000;margin:1mm 0;"></div></td></tr>
      <tr>
        <td></td>
        <td style="text-align:right;padding:0.3mm 0.5mm;font-size:9px;color:#000;">Previous Balance:</td>
        <td style="text-align:right;padding:0.3mm 0.5mm;font-size:9px;color:#000;">${fmtNum(preBalance)}</td>
      </tr>
      <tr>
        <td></td>
        <td style="text-align:right;padding:0.3mm 0.5mm;font-weight:900;font-size:10px;color:#000;">Grand Total Payable:</td>
        <td style="text-align:right;padding:0.3mm 0.5mm;font-weight:900;font-size:10px;color:#000;">${fmtNum(grandTotal)}</td>
      </tr>` : ""}
    </table>

    ${data.payments && data.payments.length > 1 ? `
    <!-- PAYMENT HISTORY — per-row breakdown. Only shown when there's more than one payment
         (otherwise the single Cash Paid line above already says it all). Lets a Credit
         customer reading a reprint reconcile each partial payment against their records. -->
    <div style="border-top:1px dashed #000;margin-top:1mm;padding-top:0.6mm;font-size:8px;color:#000;">
      <div style="font-weight:700;text-align:center;margin-bottom:0.4mm;">Payment History</div>
      ${data.payments.map((p) => `
      <div style="display:flex;justify-content:space-between;padding:0.2mm 0;">
        <span>${esc(fmtDate(p.created_at, df))} · ${esc(p.method)}${p.reference ? ` (${esc(p.reference)})` : ""}</span>
        <span style="font-weight:700;">${fmtNum(Number(p.amount || 0))}</span>
      </div>`).join("")}
    </div>` : ""}

    <!-- DASHED SEPARATOR -->
    <div style="border-top:1px dashed #000;margin:1.5mm 0;"></div>

    <!-- TERMS — SET-H2 mirror: configurable invoice_footer text. Newlines render as <br>.
         When invoice_footer is unset, the default Pakistani-retail boilerplate (no exchange
         without receipt, etc.) prints so legacy stores see the same layout as before. -->
    <div style="font-size:7.5px;line-height:1.4;color:#000;">
      ${esc(footerText).split("\n").map((line) => `<div style="color:#000;">${line}</div>`).join("")}
      <div style="margin-top:0.8mm;font-weight:700;color:#000;">*Note: No Exchange No Return Without Sale Receipt</div>
    </div>

    <!-- BARCODE AREA -->
    <div style="text-align:center;margin:2mm 0 1mm;">
      <div style="font-family:'Libre Barcode 128 Text',monospace;font-size:36px;line-height:1;letter-spacing:0;color:#000;">
        ${esc(invNo)}
      </div>
      <div style="font-size:7.5px;margin-top:0.5mm;color:#000;">* ${esc(invNo)} *</div>
    </div>

    <!-- PRINT DATE / TIME -->
    <div style="display:flex;justify-content:space-between;font-size:7.5px;border-top:1px dashed #999;padding-top:1mm;color:#000;">
      <span style="color:#000;">Print Date: ${esc(printDate)}</span>
      <span style="color:#000;">Print Time: ${esc(printTime)}</span>
    </div>

  </div>`
}

/**
 * NCR Carbon Copy — prints N copies (one per page) where N = receipt_copy_count setting,
 * clamped 1-3 server-side. Each copy gets a clearer "Copy X of N" label so the cashier can
 * sort the stack into Customer / Merchant / File piles when 2-3 copies are configured.
 */
export async function printStandardInvoice(data: InvoiceForPrint) {
  // SET-M4: read configured copy count from printOptions (defaults to 2 — historical behaviour
  // was Customer + Merchant). Re-clamp 1-3 defensively in case a stale value slips through.
  const copies = Math.max(1, Math.min(3, data.printOptions?.receiptCopyCount ?? 2))

  // Label each copy explicitly. With one copy the label is "Customer Copy" (no count prefix
  // — matches the legacy single-receipt look). With multiple copies the prefix makes the
  // stack self-sorting once they tear off the printer.
  const COPY_NAMES = ["Customer Copy", "Merchant Copy", "File Copy"]
  const copyBlocks: string[] = []
  for (let i = 0; i < copies; i++) {
    const label = copies === 1 ? COPY_NAMES[0] : `Copy ${i + 1} of ${copies} — ${COPY_NAMES[i] || `Copy ${i + 1}`}`
    copyBlocks.push(buildCopy(data, label))
    if (i < copies - 1) copyBlocks.push(`<div class="page-break"></div>`)
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt ${esc(data.invoiceNumber || data.id.substring(0, 8).toUpperCase())}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+128+Text&display=swap" rel="stylesheet">
  <style>
    @page {
      size: auto;
      margin: 2mm 5mm;
    }
    @media print {
      body {
        width: 100%;
        margin: 0;
        padding: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .page-break { page-break-after: always; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; color: #000; }
    a, a:visited, a:hover { color: #000 !important; text-decoration: none; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 8.5px;
      color: #000;
      background: #fff;
      width: 100%;
      margin: 0;
    }
    .receipt {
      width: 100%;
      padding: 1mm 3mm 2mm 3mm;
    }
    .page-break {
      page-break-after: always;
      height: 0;
      display: block;
    }
  </style>
</head>
<body>
  ${copyBlocks.join("\n")}
</body>
</html>`

  const win = window.open("", "_blank")
  if (!win) {
    console.error("Popup blocked — please allow popups to print")
    return
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => {
    win.print()
    win.close()
  }, 600)
}
