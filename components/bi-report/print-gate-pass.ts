import type { GatePassItem } from "@/app/(app)/bi-report/actions"

interface PrintGatePassOptions {
  storeName: string
  storeAddress?: string | null
  storePhone?: string | null
  periodLabel: string
  generatedAt: string
  viewMode: "all" | "category"
  items: GatePassItem[]
}

function fmt(n: number): string {
  return n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtQty(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2)
}
function getCtn(qty: number, packSize: number | null): number {
  if (!packSize || packSize <= 0) return 0
  return Math.floor(qty / packSize)
}

export function printGatePass(opts: PrintGatePassOptions): void {
  const { storeName, storeAddress, storePhone, periodLabel, generatedAt, viewMode, items } = opts

  const totalQty = items.reduce((s, r) => s + r.total_qty, 0)
  const totalCtn = items.reduce((s, r) => s + getCtn(r.total_qty, r.pack_size), 0)
  const totalAmount = items.reduce((s, r) => s + r.total_revenue, 0)

  // Build rows
  let rowsHtml = ""
  let sno = 1

  if (viewMode === "category") {
    const groups = new Map<string, GatePassItem[]>()
    for (const item of items) {
      const arr = groups.get(item.category_name) ?? []
      arr.push(item)
      groups.set(item.category_name, arr)
    }
    for (const [catName, catItems] of Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const catQty = catItems.reduce((s, r) => s + r.total_qty, 0)
      const catCtn = catItems.reduce((s, r) => s + getCtn(r.total_qty, r.pack_size), 0)
      const catAmt = catItems.reduce((s, r) => s + r.total_revenue, 0)
      rowsHtml += `<tr class="cat-hdr"><td colspan="7"><b>${catName}</b></td></tr>`
      for (const item of catItems) {
        const ctn = getCtn(item.total_qty, item.pack_size)
        rowsHtml += `<tr><td>${sno++}</td><td class="mono">${item.barcode ?? "-"}</td><td>${item.name}</td><td class="r">${fmtQty(item.total_qty)}</td><td class="r">${ctn > 0 ? ctn : "-"}</td><td class="r mono">${fmt(item.unit_price)}</td><td class="r mono">${fmt(item.total_revenue)}</td></tr>`
      }
      rowsHtml += `<tr class="sub-row"><td colspan="3" class="r"><i>${catName} Subtotal</i></td><td class="r">${fmtQty(catQty)}</td><td class="r">${catCtn > 0 ? catCtn : "-"}</td><td class="r">—</td><td class="r mono"><b>${fmt(catAmt)}</b></td></tr>`
    }
  } else {
    for (const item of items) {
      const ctn = getCtn(item.total_qty, item.pack_size)
      rowsHtml += `<tr><td>${sno++}</td><td class="mono">${item.barcode ?? "-"}</td><td>${item.name}</td><td class="r">${fmtQty(item.total_qty)}</td><td class="r">${ctn > 0 ? ctn : "-"}</td><td class="r mono">${fmt(item.unit_price)}</td><td class="r mono">${fmt(item.total_revenue)}</td></tr>`
    }
  }

  const storeInfo = [storeAddress, storePhone].filter(Boolean).join(" | ")

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Gate Pass — ${periodLabel}</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:11px;color:#000;padding:20px}
.sname{text-align:center;font-size:18px;font-weight:bold;margin-bottom:2px}
.sinfo{text-align:center;font-size:10px;color:#444;margin-bottom:8px}
.divider{border-top:2px solid #000;margin:8px 0}
.doc-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.doc-hdr .left{font-size:10px;min-width:120px}
.doc-hdr .center{font-size:14px;font-weight:bold;text-align:center;flex:1}
.doc-hdr .right{font-size:10px;text-align:right;min-width:120px}
table{width:100%;border-collapse:collapse}
th{background:#f0f0f0;padding:5px 6px;text-align:left;border-bottom:1px solid #999;font-size:10px}
td{padding:4px 6px;border-bottom:1px solid #eee;vertical-align:middle}
.r{text-align:right}.mono{font-family:monospace}
.cat-hdr td{background:#e5e5e5;font-size:10px;text-transform:uppercase;letter-spacing:.5px;padding:5px 6px}
.sub-row td{background:#f5f5f5;font-style:italic}
.grand-total td{background:#ddd;font-weight:bold;border-top:2px solid #888}
.footer{display:flex;justify-content:space-between;margin-top:14px;font-size:10px;color:#555;border-top:1px solid #ccc;padding-top:6px}
.footer-credit{text-align:center;font-size:9px;color:#999;margin-top:4px}
@media print{body{padding:10px}}
</style></head><body>
<div class="sname">${storeName}</div>
${storeInfo ? `<div class="sinfo">${storeInfo}</div>` : ""}
<div class="divider"></div>
<div class="doc-hdr">
  <div class="left">Date/Time<br/><b>${generatedAt}</b></div>
  <div class="center">GATE PASS — ${periodLabel.toUpperCase()}</div>
  <div class="right">Total Items: ${items.length}</div>
</div>
<table>
  <thead><tr>
    <th style="width:40px">S.No</th>
    <th>Barcode</th>
    <th>Item Name</th>
    <th class="r">Unit Qty</th>
    <th class="r">CTN</th>
    <th class="r">Unit Price</th>
    <th class="r">Amount</th>
  </tr></thead>
  <tbody>
    ${rowsHtml}
    <tr class="grand-total">
      <td colspan="3">Grand Total</td>
      <td class="r">${fmtQty(totalQty)}</td>
      <td class="r">${totalCtn > 0 ? totalCtn : "—"}</td>
      <td class="r">—</td>
      <td class="r mono">${fmt(totalAmount)}</td>
    </tr>
  </tbody>
</table>
<div class="footer">
  <span>Period: ${periodLabel}</span>
  <span>Generated: ${generatedAt}</span>
</div>
<div class="footer-credit">Software generated by AN-Tech Solution</div>
</body></html>`

  const w = window.open("", "_blank", "width=900,height=700")
  if (!w) { alert("Please allow popups for printing."); return }
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { w.print() }, 400)
}
