"use client"

import { useRouter } from "next/navigation"
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
import { ClipboardList, Printer, Search } from "lucide-react"
import type { GatePassItem } from "../actions"
import { printGatePass } from "@/components/bi-report/print-gate-pass"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtQty(n: number): string {
  return n % 1 === 0 ? n.toString() : n.toFixed(2)
}

function getCtn(totalQty: number, packSize: number | null): string {
  if (packSize == null || packSize <= 0) return "-"
  return Math.floor(totalQty / packSize).toString()
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface GatePassClientProps {
  items: GatePassItem[]
  error: string | null
  period: string
  dateFrom: string
  dateTo: string
  category: string
  categories: string[]
  periodLabel: string
  generatedAt: string
  storeName: string
  storeAddress?: string
  storePhone?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GatePassClient({
  items,
  error,
  period: initialPeriod,
  dateFrom: initialDateFrom,
  dateTo: initialDateTo,
  category: initialCategory,
  categories,
  periodLabel,
  generatedAt,
  storeName,
  storeAddress,
  storePhone,
}: GatePassClientProps) {
  const router = useRouter()
  const [period, setPeriod] = useState(initialPeriod)
  const [dateFrom, setDateFrom] = useState(initialDateFrom)
  const [dateTo, setDateTo] = useState(initialDateTo)
  const [category, setCategory] = useState(initialCategory)
  const [viewMode, setViewMode] = useState<"all" | "category">("all")
  const [search, setSearch] = useState("")

  // ── Filter navigate ────────────────────────────────────────────────────────

  const applyFilters = (
    overrides?: Partial<{ period: string; dateFrom: string; dateTo: string; category: string }>,
  ) => {
    const p = overrides?.period ?? period
    const df = overrides?.dateFrom ?? dateFrom
    const dt = overrides?.dateTo ?? dateTo
    const cat = overrides?.category ?? category

    const params = new URLSearchParams()
    params.set("period", p)
    if (p === "custom") {
      if (df) params.set("dateFrom", df)
      if (dt) params.set("dateTo", dt)
    }
    if (cat && cat !== "all") params.set("category", cat)
    router.push(`/bi-report/gate-pass?${params.toString()}`)
  }

  const handlePeriodChange = (v: string) => {
    setPeriod(v)
    if (v !== "custom") applyFilters({ period: v })
  }

  const handleCategoryChange = (v: string) => {
    setCategory(v)
    applyFilters({ category: v })
  }

  // ── Client-side search filter ─────────────────────────────────────────────

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.barcode && item.barcode.toLowerCase().includes(q)),
    )
  }, [items, search])

  // ── Totals ────────────────────────────────────────────────────────────────

  const totalQty = filteredItems.reduce((s, r) => s + r.total_qty, 0)
  const totalCtn = filteredItems.reduce((s, r) => {
    if (r.pack_size && r.pack_size > 0) {
      return s + Math.floor(r.total_qty / r.pack_size)
    }
    return s
  }, 0)
  const totalAmount = filteredItems.reduce((s, r) => s + r.total_revenue, 0)

  // ── Category-wise grouping ─────────────────────────────────────────────────

  const categoryGroups = useMemo(() => {
    const map = new Map<string, GatePassItem[]>()
    for (const item of filteredItems) {
      const cat = item.category_name
      const existing = map.get(cat) ?? []
      existing.push(item)
      map.set(cat, existing)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredItems])

  // ── Print ──────────────────────────────────────────────────────────────────

  const handlePrint = () => {
    printGatePass({
      storeName,
      storeAddress,
      storePhone,
      periodLabel,
      generatedAt,
      viewMode,
      items: filteredItems,
    })
  }

  // ── Render table rows ──────────────────────────────────────────────────────

  function renderRows(rowItems: GatePassItem[], startIdx: number) {
    return rowItems.map((item, i) => (
      <TableRow key={item.item_id}>
        <TableCell className="text-center text-muted-foreground text-sm">{startIdx + i + 1}</TableCell>
        <TableCell className="text-sm font-mono text-muted-foreground">
          {item.barcode ?? "-"}
        </TableCell>
        <TableCell className="font-medium text-sm">{item.name}</TableCell>
        <TableCell className="text-right text-sm">{fmtQty(item.total_qty)}</TableCell>
        <TableCell className="text-right text-sm">{getCtn(item.total_qty, item.pack_size)}</TableCell>
        <TableCell className="text-right text-sm font-mono">{fmt(item.unit_price)}</TableCell>
        <TableCell className="text-right text-sm font-mono">{fmt(item.total_revenue)}</TableCell>
      </TableRow>
    ))
  }

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between print:hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground flex items-center gap-2">
            <ClipboardList className="w-6 h-6" />
            Gate Pass
          </h1>
          <p className="text-sm text-muted-foreground">Items dispatched from store based on completed sales</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={handlePrint}>
          <Printer className="w-4 h-4" />
          Print
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        {/* Period */}
        <div className="flex flex-col gap-1 min-w-[180px]">
          <Label className="text-xs text-muted-foreground">Period</Label>
          <Select value={period} onValueChange={handlePeriodChange}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="this-week">This Week</SelectItem>
              <SelectItem value="last-week">Last Week</SelectItem>
              <SelectItem value="this-month">This Month</SelectItem>
              <SelectItem value="last-month">Last Month</SelectItem>
              <SelectItem value="this-year">This Year</SelectItem>
              <SelectItem value="last-year">Last Year</SelectItem>
              <SelectItem value="custom">Custom Date Range</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {period === "custom" && (
          <>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 w-36"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 w-36"
              />
            </div>
            <Button size="sm" className="h-9" onClick={() => applyFilters()}>
              Apply
            </Button>
          </>
        )}

        {/* Category (server-side filter) */}
        <div className="flex flex-col gap-1 min-w-[160px]">
          <Label className="text-xs text-muted-foreground">Category Filter</Label>
          <Select value={category} onValueChange={handleCategoryChange}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* View mode */}
        <div className="flex flex-col gap-1 min-w-[160px]">
          <Label className="text-xs text-muted-foreground">View</Label>
          <Select
            value={viewMode}
            onValueChange={(v) => setViewMode(v as "all" | "category")}
          >
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
              placeholder="Search by name or barcode..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8"
            />
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* Gate Pass Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            Gate Pass — {periodLabel}
            <Badge variant="secondary" className="ml-auto text-xs">
              {filteredItems.length} items
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">S.No</TableHead>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Item Name</TableHead>
                  <TableHead className="text-right">Unit Qty</TableHead>
                  <TableHead className="text-right">CTN</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                      {items.length === 0
                        ? "No items dispatched in this period."
                        : "No items match the search query."}
                    </TableCell>
                  </TableRow>
                ) : viewMode === "all" ? (
                  <>
                    {renderRows(filteredItems, 0)}
                    {/* Grand Total */}
                    <TableRow className="border-t-2 bg-muted/40 font-semibold">
                      <TableCell colSpan={3} className="text-sm">
                        Grand Total
                      </TableCell>
                      <TableCell className="text-right text-sm">{fmtQty(totalQty)}</TableCell>
                      <TableCell className="text-right text-sm">{totalCtn > 0 ? totalCtn : "-"}</TableCell>
                      <TableCell className="text-right text-sm">—</TableCell>
                      <TableCell className="text-right text-sm font-mono">{fmt(totalAmount)}</TableCell>
                    </TableRow>
                  </>
                ) : (
                  <>
                    {categoryGroups.map(([catName, catItems]) => {
                      const catStartIdx = filteredItems.indexOf(catItems[0])
                      const catQty = catItems.reduce((s, r) => s + r.total_qty, 0)
                      const catCtn = catItems.reduce((s, r) => {
                        if (r.pack_size && r.pack_size > 0) return s + Math.floor(r.total_qty / r.pack_size)
                        return s
                      }, 0)
                      const catAmount = catItems.reduce((s, r) => s + r.total_revenue, 0)
                      return [
                        <TableRow key={`cat-header-${catName}`} className="bg-muted/50">
                          <TableCell colSpan={7} className="py-2 px-4">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {catName}
                            </span>
                          </TableCell>
                        </TableRow>,
                        ...renderRows(catItems, catStartIdx),
                        <TableRow key={`cat-total-${catName}`} className="bg-muted/20 text-sm font-medium">
                          <TableCell colSpan={3} className="text-right text-muted-foreground text-xs pr-4">
                            {catName} Subtotal
                          </TableCell>
                          <TableCell className="text-right text-sm">{fmtQty(catQty)}</TableCell>
                          <TableCell className="text-right text-sm">{catCtn > 0 ? catCtn : "-"}</TableCell>
                          <TableCell className="text-right text-sm">—</TableCell>
                          <TableCell className="text-right text-sm font-mono">{fmt(catAmount)}</TableCell>
                        </TableRow>,
                      ]
                    })}
                    {/* Grand Total */}
                    <TableRow className="border-t-2 bg-muted/40 font-semibold">
                      <TableCell colSpan={3} className="text-sm">
                        Grand Total
                      </TableCell>
                      <TableCell className="text-right text-sm">{fmtQty(totalQty)}</TableCell>
                      <TableCell className="text-right text-sm">{totalCtn > 0 ? totalCtn : "-"}</TableCell>
                      <TableCell className="text-right text-sm">—</TableCell>
                      <TableCell className="text-right text-sm font-mono">{fmt(totalAmount)}</TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="text-xs text-muted-foreground flex flex-wrap gap-4 justify-between pt-2 print:text-black">
        <span>Period: {periodLabel}</span>
        <span>Generated: {generatedAt}</span>
      </div>
    </div>
  )
}
