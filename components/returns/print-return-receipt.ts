import type { ReturnWithDetails } from "@/lib/types/return"

/**
 * A4 Return / Refund Receipt — printed when a customer returns items.
 *
 * Layout mirrors print-a4-invoice but with return-specific semantics:
 *   • "RETURN RECEIPT" header (vs "InvoSync" sale invoice)
 *   • Refunds Issued block lists each refund with method + reference + date
 *   • Outstanding-refund line shown when return.total > Σ refunds
 *   • References the parent sales/purchase invoice short-ID so customer can cross-check
 *
 * Caller passes a fully-hydrated `ReturnWithDetails` from `getReturnById()` plus an
 * optional `store` block (read from user_settings) and the parent invoice short-ID for the
 * print header.
 */

interface PrintReturnReceiptInput {
  returnData: ReturnWithDetails
  parentInvoiceShortId: string // e.g. first 8 chars of sales_invoice_id
  store?: {
    name?: string
    address?: string
    phone?: string
  }
  cashier?: string
}

function esc(s: string): string {
  const div = typeof document !== "undefined" ? document.createElement("div") : null
  if (!div) return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  div.textContent = s
  return div.innerHTML
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function fmtTime(dateStr: string): string {
  const d = new Date(dateStr)
  let h = d.getHours()
  const min = String(d.getMinutes()).padStart(2, "0")
  const ampm = h >= 12 ? "pm" : "am"
  h = h % 12 || 12
  return `${h}:${min} ${ampm}`
}

export async function printReturnReceipt(input: PrintReturnReceiptInput) {
  const { returnData, parentInvoiceShortId, store, cashier } = input

  const storeName = store?.name || "Return Receipt"
  const storeAddress = store?.address || ""
  const storePhone = store?.phone || ""
  const cashierName = cashier || "—"

  const dateStr = returnData.created_at ? fmtDate(returnData.created_at) : ""
  const timeStr = returnData.created_at ? fmtTime(returnData.created_at) : ""
  const isSale = returnData.type === "sale"

  const totalRefunded = returnData.total_refunded ?? 0
  const outstandingRefund = Math.max(0, Number(returnData.total ?? 0) - totalRefunded)

  // Build item rows
  let itemRows = ""
  returnData.lines.forEach((line, i) => {
    itemRows += `
      <tr>
        <td class="tc">${i + 1}</td>
        <td class="tl">${esc(line.item?.name || "Unknown")}</td>
        <td class="tc">${line.quantity}</td>
        <td class="tr">${fmtMoney(Number(line.unit_price ?? 0))}</td>
        <td class="tr fw">${fmtMoney(Number(line.line_total ?? 0))}</td>
      </tr>`
  })

  // Build refunds breakdown
  let refundRows = ""
  returnData.refunds.forEach((refund, i) => {
    const refDate = refund.created_at ? fmtDate(refund.created_at) : ""
    refundRows += `
      <tr>
        <td class="tc">${i + 1}</td>
        <td class="tc">${esc(refDate)}</td>
        <td class="tl">${esc(refund.method)}${refund.reference ? ` <span style="color:#666;">(${esc(refund.reference)})</span>` : ""}</td>
        <td class="tr fw">${fmtMoney(Number(refund.amount ?? 0))}</td>
      </tr>`
  })

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Return ${esc(returnData.return_number)}</title>
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
    .store-name { text-align:center; font-size:20px; font-weight:900; letter-spacing:1px; }
    .return-banner {
      background:#000; color:#fff; text-align:center; font-weight:700;
      font-size:13px; letter-spacing:2px; padding:4px 0; margin-top:4px;
    }
    .store-tag { text-align:center; font-size:10px; font-weight:600; margin-top:2px; }
    .store-addr { text-align:center; font-size:9.5px; margin-top:1px; }
    .divider { border:none; border-top:2px solid #000; margin:5px 0; }
    .divider-sm { border:none; border-top:1px solid #000; margin:3px 0; }

    .info-row { width:100%; border-collapse:collapse; margin-bottom:4px; }
    .info-row td { vertical-align:top; padding:1.5px 0; font-size:10px; }
    .bill-box { border:1px solid #000; padding:3px 6px; font-size:9.5px; }
    .bill-box tr td { padding:1px 3px; }
    .bill-box .lbl { font-weight:700; white-space:nowrap; padding-right:5px; }

    .items { width:100%; border-collapse:collapse; font-size:9.5px; margin-top:3px; table-layout:fixed; }
    .items th, .items td { border:1px solid #000; padding:2.5px 4px; }
    .items th { font-weight:700; background:#fff; text-align:center; }
    .tc { text-align:center; }
    .tl { text-align:left; word-wrap:break-word; white-space:normal; }
    .tr { text-align:right; }
    .fw { font-weight:700; }

    .totals-table { border-collapse:collapse; width:100%; }
    .totals-table td { padding:2px 5px; font-size:10px; border:1px solid #000; }
    .totals-table .lbl { font-weight:600; }
    .totals-table .val { text-align:right; font-weight:600; }
    .totals-table .net { font-weight:800; font-size:11px; }
    .totals-table .outstanding { color:#b45309; font-weight:700; }

    .refunds-header { font-weight:700; font-size:10px; margin-top:6px; margin-bottom:2px; }

    .footer {
      display:flex; justify-content:space-between; align-items:flex-end;
      margin-top:6px; border-top:1.5px solid #000; padding-top:4px; font-size:9px;
    }
    .terms { font-size:9px; margin-top:5px; line-height:1.6; }
  </style>
</head>
<body>

  <div class="store-name">${esc(storeName)}</div>
  ${storeAddress ? `<div class="store-tag">${esc(storeAddress)}</div>` : ""}
  ${storePhone ? `<div class="store-addr">Contact: ${esc(storePhone)}</div>` : ""}

  <div class="return-banner">${isSale ? "RETURN RECEIPT" : "PURCHASE RETURN RECEIPT"}</div>
  <hr class="divider">

  <!-- Customer / return info -->
  <table class="info-row" cellpadding="0" cellspacing="0">
    <tr>
      <td style="width:auto;">
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-weight:700;padding-right:6px;white-space:nowrap;">${isSale ? "Customer Name:" : "Vendor Name:"}</td>
            <td>${returnData.party?.name ? esc(returnData.party.name) : "—"}</td>
          </tr>
          <tr>
            <td style="font-weight:700;padding-right:6px;white-space:nowrap;">Contact No:</td>
            <td>${returnData.party?.phone ? esc(returnData.party.phone) : "—"}</td>
          </tr>
          <tr>
            <td style="font-weight:700;padding-right:6px;white-space:nowrap;">Original Bill:</td>
            <td>${esc(parentInvoiceShortId)}</td>
          </tr>
          ${cashierName !== "—" ? `<tr>
            <td style="font-weight:700;padding-right:6px;white-space:nowrap;">User:</td>
            <td>${esc(cashierName)}</td>
          </tr>` : ""}
        </table>
      </td>
      <td style="width:1px;"></td>
      <td style="text-align:right;white-space:nowrap;">
        <table class="bill-box" cellpadding="0" cellspacing="0" style="margin-left:auto;">
          <tr>
            <td class="lbl">Return No:</td>
            <td><strong>${esc(returnData.return_number)}</strong></td>
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
            <td class="lbl">Status:</td>
            <td>${esc(returnData.status)}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <hr class="divider-sm">

  <!-- Returned items -->
  <table class="items" cellpadding="0" cellspacing="0">
    <colgroup>
      <col style="width:6%">
      <col style="width:54%">
      <col style="width:10%">
      <col style="width:14%">
      <col style="width:16%">
    </colgroup>
    <thead>
      <tr>
        <th>S#</th>
        <th style="text-align:left;">Item Name</th>
        <th>Qty</th>
        <th>Unit Price</th>
        <th>Line Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows || `<tr><td class="tc" colspan="5">No items</td></tr>`}
    </tbody>
    <tfoot>
      <tr>
        <td class="tc fw" colspan="2">Total Items: ${returnData.lines.length}</td>
        <td class="tc fw">${returnData.lines.reduce((s, l) => s + Number(l.quantity || 0), 0)}</td>
        <td></td>
        <td class="tr fw">${fmtMoney(Number(returnData.subtotal ?? 0))}</td>
      </tr>
    </tfoot>
  </table>

  <!-- Bottom: refunds list (left) + totals (right) -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;vertical-align:top;">
    <tr>
      <td style="vertical-align:top;padding-right:8px;">
        ${returnData.refunds.length > 0 ? `
        <div class="refunds-header">Refunds Issued</div>
        <table class="items" cellpadding="0" cellspacing="0" style="font-size:9px;">
          <colgroup>
            <col style="width:8%">
            <col style="width:22%">
            <col style="width:42%">
            <col style="width:28%">
          </colgroup>
          <thead>
            <tr>
              <th>S#</th>
              <th>Date</th>
              <th style="text-align:left;">Method (Ref)</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            ${refundRows}
          </tbody>
        </table>` : `
        <div class="refunds-header">Refunds Issued</div>
        <div style="border:1px solid #000;padding:4px;font-size:9px;color:#666;">
          No refunds recorded yet. Customer's outstanding balance has been reduced by the return amount.
        </div>`}

        <div class="terms">
          1. Damage and expiry item are not refundable.<br>
          2. Verify all items before leaving the counter.<br>
          3. This receipt is proof of return — keep it for your records.
        </div>
      </td>
      <td style="vertical-align:top;width:240px;">
        <table class="totals-table" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td class="lbl">Return Total:</td>
            <td class="val">${fmtMoney(Number(returnData.total ?? 0))}</td>
          </tr>
          ${Number(returnData.tax ?? 0) > 0 ? `
          <tr>
            <td class="lbl">Of which Tax:</td>
            <td class="val">${fmtMoney(Number(returnData.tax ?? 0))}</td>
          </tr>` : ""}
          <tr>
            <td class="lbl">Total Refunded:</td>
            <td class="val">${fmtMoney(totalRefunded)}</td>
          </tr>
          ${outstandingRefund > 0 ? `
          <tr>
            <td class="lbl outstanding">Outstanding Refund:</td>
            <td class="val outstanding">${fmtMoney(outstandingRefund)}</td>
          </tr>
          <tr>
            <td colspan="2" style="font-size:8.5px;color:#666;padding:3px 5px;">
              The outstanding amount has reduced the customer's open balance — no further cash refund is owed.
            </td>
          </tr>` : `
          <tr>
            <td class="lbl net">Net Refunded:</td>
            <td class="val net">${fmtMoney(totalRefunded)}</td>
          </tr>`}
        </table>
      </td>
    </tr>
  </table>

  <div class="footer">
    <div>
      ${storePhone ? `<strong>Contact:</strong> ${esc(storePhone)}<br>` : ""}
      <span style="color:#444;">Printed: ${esc(fmtDate(new Date().toISOString()))} ${esc(fmtTime(new Date().toISOString()))}</span>
    </div>
    <div style="text-align:right;">
      <strong>Return:</strong> ${esc(returnData.return_number)}
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
