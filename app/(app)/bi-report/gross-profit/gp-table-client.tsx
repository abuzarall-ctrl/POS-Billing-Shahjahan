"use client"

import { useState, useMemo } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Search, Printer, Download, BarChart2 } from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts"
import type { GrossProfitItem } from "../actions"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPct(n: number): string {
  return n.toFixed(1) + "%"
}
function truncate(name: string, max = 24): string {
  return name.length > max ? name.slice(0, max - 1) + "…" : name
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface GPTableClientProps {
  items: GrossProfitItem[]
  totalRevenue: number
  totalCost: number
  totalGP: number
  totalGPPct: number
  periodLabel: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GPTableClient({
  items,
  totalRevenue,
  totalCost,
  totalGP,
  totalGPPct,
  periodLabel,
}: GPTableClientProps) {
  const [viewMode, setViewMode] = useState<"all" | "category">("all")
  const [search, setSearch] = useState("")

  // ── Client-side search filter ─────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q),
    )
  }, [items, search])

  // ── Filtered totals ────────────────────────────────────────────────────────
  const filteredTotals = useMemo(() => {
    const revenue = filteredItems.reduce((s, r) => s + r.revenue, 0)
    const cost = filteredItems.reduce((s, r) => s + r.cost, 0)
    const gp = filteredItems.reduce((s, r) => s + r.gp, 0)
    const gpPct = revenue > 0 ? (gp / revenue) * 100 : 0
    return { revenue, cost, gp, gpPct }
  }, [filteredItems])

  // ── Chart data: top 10 items by GP ────────────────────────────────────────
  const chartData = useMemo(
    () =>
      [...filteredItems]
        .sort((a, b) => b.gp - a.gp)
        .slice(0, 10)
        .map((item) => ({ name: truncate(item.name), gp: item.gp, gpPct: item.gpPct })),
    [filteredItems],
  )

  // ── Category-wise grouping ─────────────────────────────────────────────────
  const categoryGroups = useMemo(() => {
    const map = new Map<string, GrossProfitItem[]>()
    for (const item of filteredItems) {
      const arr = map.get(item.category) ?? []
      arr.push(item)
      map.set(item.category, arr)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredItems])

  // ── CSV Export ────────────────────────────────────────────────────────────
  const handleExport = () => {
    const header = [
      "#",
      "Item Name",
      "Category",
      "Qty Sold",
      "Revenue (PKR)",
      "Cost (PKR)",
      "Gross Profit (PKR)",
      "GP %",
    ]
    const rows = filteredItems.map((item, i) => [
      i + 1,
      `"${item.name.replace(/"/g, '""')}"`,
      `"${item.category.replace(/"/g, '""')}"`,
      item.qty.toFixed(2),
      item.revenue.toFixed(2),
      item.cost.toFixed(2),
      item.gp.toFixed(2),
      item.gpPct.toFixed(1) + "%",
    ])
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n")
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `gross-profit-${periodLabel.replace(/\s+|\//g, "-")}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Print popup ────────────────────────────────────────────────────────────
  const handlePrint = () => {
    let rowsHtml = ""
    let sno = 1

    if (viewMode === "category") {
      for (const [catName, catItems] of categoryGroups) {
        const catRevenue = catItems.reduce((s, r) => s + r.revenue, 0)
        const catCost = catItems.reduce((s, r) => s + r.cost, 0)
        const catGP = catItems.reduce((s, r) => s + r.gp, 0)
        const catGPPct = catRevenue > 0 ? (catGP / catRevenue) * 100 : 0
        rowsHtml += `<tr class="cat-hdr"><td colspan="7"><b>${catName}</b></td></tr>`
        for (const item of catItems) {
          rowsHtml += `<tr><td>${sno++}</td><td>${item.name}</td><td>${item.category}</td><td class="r">${item.qty.toFixed(2)}</td><td class="r mono">${fmt(item.revenue)}</td><td class="r mono">${fmt(item.cost)}</td><td class="r mono ${item.gp >= 0 ? "pos" : "neg"}">${fmt(item.gp)}</td></tr>`
        }
        rowsHtml += `<tr class="sub-row"><td colspan="2" class="r"><i>${catName} Subtotal</i></td><td></td><td class="r">—</td><td class="r mono">${fmt(catRevenue)}</td><td class="r mono">${fmt(catCost)}</td><td class="r mono"><b class="${catGP >= 0 ? "pos" : "neg"}">${fmt(catGP)}</b> <small>(${fmtPct(catGPPct)})</small></td></tr>`
      }
    } else {
      for (const item of filteredItems) {
        rowsHtml += `<tr><td>${sno++}</td><td>${item.name}</td><td>${item.category}</td><td class="r">${item.qty.toFixed(2)}</td><td class="r mono">${fmt(item.revenue)}</td><td class="r mono">${fmt(item.cost)}</td><td class="r mono ${item.gp >= 0 ? "pos" : "neg"}">${fmt(item.gp)}</td></tr>`
      }
    }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Gross Profit — ${periodLabel}</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:11px;color:#000;padding:20px}
.title{text-align:center;font-size:16px;font-weight:bold;margin-bottom:2px}
.subtitle{text-align:center;font-size:10px;color:#555;margin-bottom:8px}
.divider{border-top:2px solid #000;margin:8px 0}
.doc-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:10px}
.doc-hdr .center{font-size:13px;font-weight:bold;text-align:center;flex:1}
table{width:100%;border-collapse:collapse}
th{background:#f0f0f0;padding:5px 6px;text-align:left;border-bottom:1px solid #999;font-size:10px}
td{padding:4px 6px;border-bottom:1px solid #eee;vertical-align:middle}
.r{text-align:right}.mono{font-family:monospace}
.pos{color:#16a34a}.neg{color:#dc2626}
.cat-hdr td{background:#e5e5e5;font-size:10px;text-transform:uppercase;letter-spacing:.5px;padding:5px 6px}
.sub-row td{background:#f5f5f5;font-style:italic}
.grand-total td{background:#ddd;font-weight:bold;border-top:2px solid #888}
.footer-credit{text-align:center;font-size:9px;color:#999;margin-top:12px;border-top:1px solid #ddd;padding-top:6px}
@media print{body{padding:10px}}
</style></head><body>
<div class="title">Gross Profit Report</div>
<div class="subtitle">Period: ${periodLabel}</div>
<div class="divider"></div>
<div class="doc-hdr">
  <div class="left">Items: ${filteredItems.length}</div>
  <div class="center">GROSS PROFIT ANALYSIS</div>
  <div class="right">Total GP: ${fmt(filteredTotals.gp)}</div>
</div>
<table>
  <thead><tr>
    <th style="width:36px">#</th>
    <th>Item Name</th>
    <th>Category</th>
    <th class="r">Qty</th>
    <th class="r">Revenue</th>
    <th class="r">Cost</th>
    <th class="r">Gross Profit</th>
  </tr></thead>
  <tbody>
    ${rowsHtml}
    <tr class="grand-total">
      <td colspan="3">Total</td>
      <td class="r">—</td>
      <td class="r mono">${fmt(filteredTotals.revenue)}</td>
      <td class="r mono">${fmt(filteredTotals.cost)}</td>
      <td class="r mono ${filteredTotals.gp >= 0 ? "pos" : "neg"}">${fmt(filteredTotals.gp)} (${fmtPct(filteredTotals.gpPct)})</td>
    </tr>
  </tbody>
</table>
<div class="footer-credit">Software generated by AN-Tech Solution</div>
</body></html>`

    const w = window.open("", "_blank", "width=1050,height=750")
    if (!w) {
      alert("Please allow popups for printing.")
      return
    }
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => {
      w.print()
    }, 400)
  }

  const tooltipStyle = {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "8px",
    fontSize: "12px",
    color: "#f1f5f9",
  }

  return (
    <div className="space-y-4">
      {/* Client-side controls row */}
      <div className="flex flex-wrap items-end gap-3">
        {/* View toggle */}
        <div className="flex flex-col gap-1 min-w-[160px]">
          <Label className="text-xs text-muted-foreground">View</Label>
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as "all" | "category")}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Items</SelectItem>
              <SelectItem value="category">Category Wise</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Search */}
        <div className="flex flex-col gap-1 min-w-[200px] flex-1">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by item or category..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8"
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={handlePrint}>
            <Printer className="w-4 h-4" />
            Print
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={handleExport}>
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Bar Chart — Top items by GP */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-emerald-600" />
              Top {chartData.length} Items by Gross Profit — {periodLabel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer
              width="100%"
              height={Math.max(220, chartData.length * 36 + 20)}
            >
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ left: 8, right: 70, top: 4, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis
                  type="number"
                  tickFormatter={(v) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                  }
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={170}
                  tick={{ fontSize: 10 }}
                />
                <Tooltip
                  formatter={(v: number, _name: string, props: any) => [
                    `PKR ${fmt(v)} (${fmtPct(props.payload?.gpPct ?? 0)})`,
                    "Gross Profit",
                  ]}
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: "#94a3b8", marginBottom: 2 }}
                />
                <Bar dataKey="gp" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.gp >= 0 ? "#10b981" : "#f87171"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Item-wise GP Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Item-wise Gross Profit</span>
            <Badge variant="secondary" className="text-xs ml-auto">
              {filteredItems.length} items
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 text-center">#</TableHead>
                  <TableHead>Item Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Qty Sold</TableHead>
                  <TableHead className="text-right">Revenue (PKR)</TableHead>
                  <TableHead className="text-right">Cost (PKR)</TableHead>
                  <TableHead className="text-right">Gross Profit (PKR)</TableHead>
                  <TableHead className="text-right">GP %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                      {items.length === 0
                        ? "No sales data for this period."
                        : "No items match your search."}
                    </TableCell>
                  </TableRow>
                ) : viewMode === "all" ? (
                  <>
                    {filteredItems.map((row, idx) => (
                      <TableRow key={`${row.name}-${idx}`}>
                        <TableCell className="text-center text-muted-foreground text-sm">
                          {idx + 1}
                        </TableCell>
                        <TableCell className="font-medium text-sm">{row.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs font-normal">
                            {row.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm">{row.qty.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-sm font-mono">
                          {fmt(row.revenue)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono">
                          {fmt(row.cost)}
                        </TableCell>
                        <TableCell
                          className={`text-right text-sm font-mono font-medium ${
                            row.gp >= 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {fmt(row.gp)}
                        </TableCell>
                        <TableCell
                          className={`text-right text-sm font-mono ${
                            row.gpPct >= 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {fmtPct(row.gpPct)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 bg-muted/40 font-semibold">
                      <TableCell colSpan={3} className="text-sm">
                        Total
                      </TableCell>
                      <TableCell className="text-right text-sm">—</TableCell>
                      <TableCell className="text-right text-sm font-mono">
                        {fmt(filteredTotals.revenue)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono">
                        {fmt(filteredTotals.cost)}
                      </TableCell>
                      <TableCell
                        className={`text-right text-sm font-mono ${
                          filteredTotals.gp >= 0 ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {fmt(filteredTotals.gp)}
                      </TableCell>
                      <TableCell
                        className={`text-right text-sm font-mono ${
                          filteredTotals.gpPct >= 0 ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {fmtPct(filteredTotals.gpPct)}
                      </TableCell>
                    </TableRow>
                  </>
                ) : (
                  <>
                    {categoryGroups.map(([catName, catItems]) => {
                      const catRevenue = catItems.reduce((s, r) => s + r.revenue, 0)
                      const catCost = catItems.reduce((s, r) => s + r.cost, 0)
                      const catGP = catItems.reduce((s, r) => s + r.gp, 0)
                      const catGPPct = catRevenue > 0 ? (catGP / catRevenue) * 100 : 0
                      const startIdx = filteredItems.indexOf(catItems[0])
                      return [
                        <TableRow key={`cat-header-${catName}`} className="bg-muted/50">
                          <TableCell colSpan={8} className="py-2 px-4">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {catName}
                            </span>
                          </TableCell>
                        </TableRow>,
                        ...catItems.map((row, i) => (
                          <TableRow key={`${catName}-${row.name}-${i}`}>
                            <TableCell className="text-center text-muted-foreground text-sm">
                              {startIdx + i + 1}
                            </TableCell>
                            <TableCell className="font-medium text-sm">{row.name}</TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-xs font-normal">
                                {row.category}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {row.qty.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right text-sm font-mono">
                              {fmt(row.revenue)}
                            </TableCell>
                            <TableCell className="text-right text-sm font-mono">
                              {fmt(row.cost)}
                            </TableCell>
                            <TableCell
                              className={`text-right text-sm font-mono font-medium ${
                                row.gp >= 0 ? "text-emerald-600" : "text-red-600"
                              }`}
                            >
                              {fmt(row.gp)}
                            </TableCell>
                            <TableCell
                              className={`text-right text-sm font-mono ${
                                row.gpPct >= 0 ? "text-emerald-600" : "text-red-600"
                              }`}
                            >
                              {fmtPct(row.gpPct)}
                            </TableCell>
                          </TableRow>
                        )),
                        <TableRow
                          key={`cat-total-${catName}`}
                          className="bg-muted/20 text-sm font-medium"
                        >
                          <TableCell
                            colSpan={3}
                            className="text-right text-muted-foreground text-xs pr-4"
                          >
                            {catName} Subtotal
                          </TableCell>
                          <TableCell className="text-right text-sm">—</TableCell>
                          <TableCell className="text-right text-sm font-mono">
                            {fmt(catRevenue)}
                          </TableCell>
                          <TableCell className="text-right text-sm font-mono">
                            {fmt(catCost)}
                          </TableCell>
                          <TableCell
                            className={`text-right text-sm font-mono ${
                              catGP >= 0 ? "text-emerald-600" : "text-red-600"
                            }`}
                          >
                            {fmt(catGP)}
                          </TableCell>
                          <TableCell
                            className={`text-right text-sm font-mono ${
                              catGPPct >= 0 ? "text-emerald-600" : "text-red-600"
                            }`}
                          >
                            {fmtPct(catGPPct)}
                          </TableCell>
                        </TableRow>,
                      ]
                    })}
                    <TableRow className="border-t-2 bg-muted/40 font-semibold">
                      <TableCell colSpan={3} className="text-sm">
                        Total
                      </TableCell>
                      <TableCell className="text-right text-sm">—</TableCell>
                      <TableCell className="text-right text-sm font-mono">
                        {fmt(filteredTotals.revenue)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono">
                        {fmt(filteredTotals.cost)}
                      </TableCell>
                      <TableCell
                        className={`text-right text-sm font-mono ${
                          filteredTotals.gp >= 0 ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {fmt(filteredTotals.gp)}
                      </TableCell>
                      <TableCell
                        className={`text-right text-sm font-mono ${
                          filteredTotals.gpPct >= 0 ? "text-emerald-600" : "text-red-600"
                        }`}
                      >
                        {fmtPct(filteredTotals.gpPct)}
                      </TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
