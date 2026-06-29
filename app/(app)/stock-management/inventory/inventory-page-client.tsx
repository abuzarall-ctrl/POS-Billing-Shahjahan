"use client"

import { useState, useMemo, useRef } from "react"
import { Search, Upload, Download, FileSpreadsheet, ChevronDown } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Pencil } from "lucide-react"
import InventoryDialog from "./inventory-dialog"
import { DeleteInventoryButton } from "@/components/delete-inventory-button"
import { RestoreInventoryButton } from "@/components/restore-inventory-button"
import { CurrencyDisplay } from "@/components/currency-display"
import { bulkImportInventory } from "./actions"
import { toast } from "sonner"

type InventoryItem = {
  id: string
  name: string
  stock: number | null
  cost_price?: number | null
  selling_price?: number | null
  cash_price?: number | null
  credit_price?: number | null
  supplier_price?: number | null
  profit_percentage?: number | null
  category_id?: string | null
  unit_id?: string | null
  barcode?: string | null
  minimum_stock?: number | null
  maximum_stock?: number | null
  pack_unit_id?: string | null
  pack_size?: number | null
  categories?: { name: string } | { name: string }[] | null
  units?: { name?: string; symbol?: string | null } | { name?: string; symbol?: string | null }[] | null
  pack_unit?: { name?: string; symbol?: string | null } | { name?: string; symbol?: string | null }[] | null
}

function pickFirst<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

type StockFilter = "all" | "in_stock" | "low_stock" | "out_of_stock"

function getStockStatus(stock: number, minStock: number | null) {
  if (stock === 0) return { label: "Out of Stock", variant: "destructive" as const }
  if (minStock !== null && stock < minStock) return { label: "Low Stock", variant: "destructive" as const }
  return { label: "In Stock", variant: "default" as const }
}

export function InventoryPageClient({ items, tab }: { items: InventoryItem[]; tab: "active" | "archived" }) {
  const [search, setSearch] = useState("")
  const [stockFilter, setStockFilter] = useState<StockFilter>("all")
  const [showImportExport, setShowImportExport] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const counts = useMemo(() => {
    let inStock = 0, lowStock = 0, outOfStock = 0
    items.forEach((item) => {
      const s = Number(item.stock ?? 0)
      const min = item.minimum_stock != null ? Number(item.minimum_stock) : null
      if (s === 0) outOfStock++
      else if (min !== null && s < min) lowStock++
      else inStock++
    })
    return { inStock, lowStock, outOfStock }
  }, [items])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return items.filter((item) => {
      if (q) {
        const catName = Array.isArray(item.categories)
          ? item.categories[0]?.name ?? ""
          : (item.categories as { name?: string } | null)?.name ?? ""
        const matches =
          item.name?.toLowerCase().includes(q) ||
          item.barcode?.toLowerCase().includes(q) ||
          catName.toLowerCase().includes(q)
        if (!matches) return false
      }
      if (stockFilter === "all") return true
      const s = Number(item.stock ?? 0)
      const min = item.minimum_stock != null ? Number(item.minimum_stock) : null
      if (stockFilter === "out_of_stock") return s === 0
      if (stockFilter === "low_stock") return s > 0 && min !== null && s < min
      if (stockFilter === "in_stock") return s > 0 && (min === null || s >= min)
      return true
    })
  }, [items, search, stockFilter])

  const filterButtons: { key: StockFilter; label: string }[] = [
    { key: "all", label: `All (${items.length})` },
    { key: "in_stock", label: `In Stock (${counts.inStock})` },
    { key: "low_stock", label: `Low (${counts.lowStock})` },
    { key: "out_of_stock", label: `Out (${counts.outOfStock})` },
  ]

  const handleExport = () => {
    const headers = [
      "name", "barcode", "category", "unit",
      "cost_price", "cash_price", "credit_price", "supplier_price",
      "stock", "minimum_stock", "maximum_stock"
    ]
    const rows = items.map((item) => {
      const cat = pickFirst(item.categories)
      const unit = pickFirst(item.units)
      return [
        `"${(item.name ?? "").replace(/"/g, '""')}"`,
        item.barcode ?? "",
        `"${(cat?.name ?? "").replace(/"/g, '""')}"`,
        unit?.symbol ?? unit?.name ?? "",
        item.cost_price ?? 0,
        item.cash_price ?? 0,
        item.credit_price ?? 0,
        item.supplier_price ?? 0,
        item.stock ?? 0,
        item.minimum_stock ?? "",
        item.maximum_stock ?? "",
      ].join(",")
    })
    const csv = "﻿" + headers.join(",") + "\n" + rows.join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `inventory-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setShowImportExport(false)
  }

  const handleDownloadTemplate = () => {
    const csv = "﻿name,barcode,category,unit,cost_price,cash_price,credit_price,supplier_price,stock,minimum_stock,maximum_stock\nExample Item,BC001,General,PCS,100,120,125,95,50,5,200"
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "inventory-import-template.csv"
    a.click()
    URL.revokeObjectURL(url)
    setShowImportExport(false)
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const lines = text.replace(/^﻿/, "").split("\n").filter((l) => l.trim())
    if (lines.length < 2) { toast.error("CSV is empty or has only headers"); return }

    const firstLine = lines[0].toLowerCase()
    const headerCols = firstLine.split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
    const hasName = headerCols.includes("name")
    const hasInventoryCol = ["cost_price", "cash_price", "stock", "barcode", "category"].some((c) => headerCols.includes(c))
    if (!hasName || !hasInventoryCol) {
      toast.error("Wrong file format. Please use the inventory import template.")
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }
    const dataLines = lines.slice(1)

    const parseCSVLine = (line: string): string[] => {
      const result: string[] = []
      let current = ""
      let inQuotes = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
          else inQuotes = !inQuotes
        } else if (ch === ',' && !inQuotes) {
          result.push(current.trim()); current = ""
        } else {
          current += ch
        }
      }
      result.push(current.trim())
      return result
    }

    const rows = dataLines.map((line) => {
      const cols = parseCSVLine(line)
      const n = (i: number) => { const v = Number(cols[i]); return isNaN(v) ? null : v }
      return {
        name: cols[0] ?? "",
        barcode: cols[1] || null,
        category: cols[2] || null,
        unit: cols[3] || null,
        cost_price: n(4),
        cash_price: n(5),
        credit_price: n(6),
        supplier_price: n(7),
        stock: n(8),
        minimum_stock: n(9),
        maximum_stock: n(10),
      }
    }).filter((r) => r.name)

    if (!rows.length) { toast.error("No valid rows found"); return }

    toast.loading(`Importing ${rows.length} rows...`, { id: "bulk-import" })
    const result = await bulkImportInventory(rows)
    toast.dismiss("bulk-import")

    if (result.errors.length > 0) {
      toast.warning(`Imported ${result.imported} new, updated ${result.updated}. ${result.errors.length} error(s): ${result.errors[0]}`)
    } else {
      toast.success(`Done! ${result.imported} new items, ${result.updated} updated.`)
    }
    if (fileInputRef.current) fileInputRef.current.value = ""
    setShowImportExport(false)
  }

  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base sm:text-lg">
            {tab === "archived" ? "Archived Items" : "Items"}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({filtered.length}{filtered.length !== items.length ? `/${items.length}` : ""})
            </span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {tab === "active" && (
              <div className="flex items-center gap-1">
                {filterButtons.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setStockFilter(key)}
                    className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
                      stockFilter === key
                        ? "bg-primary text-primary-foreground border-primary"
                        : "hover:bg-muted"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Name, barcode, category..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 w-48 sm:w-64 text-xs"
              />
            </div>
            {/* Import/Export dropdown */}
            {tab === "active" && (
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={() => setShowImportExport((v) => !v)}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Import/Export
                  <ChevronDown className="w-3 h-3" />
                </Button>
                {showImportExport && (
                  <div className="absolute right-0 top-9 z-20 w-44 rounded-lg border border-border bg-popover shadow-lg">
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50 rounded-t-lg"
                      onClick={handleDownloadTemplate}
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Template
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50"
                      onClick={() => { fileInputRef.current?.click(); setShowImportExport(false) }}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Import CSV
                    </button>
                    <button
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50 rounded-b-lg"
                      onClick={handleExport}
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export CSV
                    </button>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleImportFile}
                />
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[18%]">Item</th>
                <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[8%]">Stock</th>
                <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm hidden md:table-cell w-[10%]">Cost</th>
                <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm hidden lg:table-cell w-[10%]">💵 Cash</th>
                <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm hidden lg:table-cell w-[10%]">📱 Credit</th>
                <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm hidden xl:table-cell w-[10%]">🏢 Supplier</th>
                <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm hidden sm:table-cell w-[10%]">Value</th>
                <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[12%]">Actions</th>
              </tr>
            </thead>
            <tbody className="[&>tr:not(:last-child)]:border-b">
              {filtered.map((item) => {
                const stock = Number(item.stock ?? 0)
                const minStock = item.minimum_stock != null ? Number(item.minimum_stock) : null
                const costPrice = Number(item.cost_price ?? 0)
                const cashPrice = Number(item.cash_price ?? item.selling_price ?? 0)
                const creditPrice = Number(item.credit_price ?? cashPrice)
                const supplierPrice = Number(item.supplier_price ?? cashPrice)
                const stockValue = stock * cashPrice
                const status = getStockStatus(stock, minStock)
                const catName = Array.isArray(item.categories)
                  ? item.categories[0]?.name ?? ""
                  : (item.categories as { name?: string } | null)?.name ?? ""

                // Pack-unit display: "2400 PCS (24 CTN)". Falls back to the base unit symbol
                // when no pack is configured. Pack count is allowed to be fractional.
                const baseUnit = pickFirst(item.units)
                const packUnit = pickFirst(item.pack_unit)
                const packSize = item.pack_size != null ? Number(item.pack_size) : 0
                const baseLabel = baseUnit?.symbol || baseUnit?.name || ""
                const packLabel = packUnit?.symbol || packUnit?.name || ""
                const packCount = packSize > 0 ? stock / packSize : 0
                const formatPackCount = (n: number) =>
                  Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toString()

                return (
                  <tr key={item.id} className="hover:bg-muted/50">
                    <td className="py-2 sm:py-3 px-2 sm:px-4 font-medium text-foreground text-xs sm:text-sm">
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{item.name}</span>
                        <div className="flex items-center gap-2 mt-1">
                          {catName && <Badge variant="outline" className="text-[10px]">{catName}</Badge>}
                          {item.barcode && <span className="text-[10px] text-muted-foreground">BC: {item.barcode}</span>}
                        </div>
                        <div className="flex items-center gap-2 md:hidden mt-1">
                          <span className="text-[10px] text-muted-foreground">💵 <CurrencyDisplay amount={cashPrice} /></span>
                        </div>
                        <span className="text-[10px] text-muted-foreground sm:hidden">Value: <CurrencyDisplay amount={stockValue} /></span>
                      </div>
                    </td>
                    <td className="py-2 sm:py-3 px-2 sm:px-4 text-foreground text-xs sm:text-sm">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span>
                            {stock}
                            {baseLabel ? <span className="text-muted-foreground"> {baseLabel}</span> : null}
                          </span>
                          {tab === "active" && status.label !== "In Stock" && (
                            <Badge variant={status.variant} className="text-[10px] whitespace-nowrap">{status.label}</Badge>
                          )}
                        </div>
                        {packSize > 0 && packLabel && (
                          <span className="text-[10px] text-muted-foreground">
                            {formatPackCount(packCount)} {packLabel}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 sm:py-3 px-2 sm:px-4 text-foreground text-xs sm:text-sm hidden md:table-cell">
                      <CurrencyDisplay amount={costPrice} />
                    </td>
                    <td className="py-2 sm:py-3 px-2 sm:px-4 text-foreground text-xs sm:text-sm hidden lg:table-cell">
                      <CurrencyDisplay amount={cashPrice} />
                    </td>
                    <td className="py-2 sm:py-3 px-2 sm:px-4 text-foreground text-xs sm:text-sm hidden lg:table-cell">
                      <CurrencyDisplay amount={creditPrice} />
                    </td>
                    <td className="py-2 sm:py-3 px-2 sm:px-4 text-foreground text-xs sm:text-sm hidden xl:table-cell">
                      <CurrencyDisplay amount={supplierPrice} />
                    </td>
                    <td className="py-2 sm:py-3 px-2 sm:px-4 font-semibold text-foreground text-xs sm:text-sm hidden sm:table-cell">
                      <CurrencyDisplay amount={stockValue} />
                    </td>
                    <td className="py-2 sm:py-3 px-2 sm:px-4">
                      <div className="flex items-center gap-1 sm:gap-2">
                        {tab === "active" ? (
                          <>
                            <InventoryDialog
                              item={{
                                id: item.id,
                                name: item.name,
                                stock,
                                cost_price: costPrice,
                                cash_price: cashPrice,
                                credit_price: creditPrice,
                                supplier_price: supplierPrice,
                                category_id: item.category_id ?? null,
                                unit_id: item.unit_id ?? null,
                                barcode: item.barcode ?? null,
                                minimum_stock: item.minimum_stock != null ? Number(item.minimum_stock) : null,
                                maximum_stock: item.maximum_stock != null ? Number(item.maximum_stock) : null,
                                pack_unit_id: item.pack_unit_id ?? null,
                                pack_size: item.pack_size != null ? Number(item.pack_size) : null,
                              }}
                              trigger={
                                <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10">
                                  <Pencil className="w-3 h-3 sm:w-4 sm:h-4" />
                                </Button>
                              }
                            />
                            <DeleteInventoryButton itemId={item.id} itemName={item.name} />
                          </>
                        ) : (
                          <RestoreInventoryButton itemId={item.id} itemName={item.name} />
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground text-xs sm:text-sm px-4">
                    {search || stockFilter !== "all"
                      ? "No items match your search or filter."
                      : tab === "archived"
                      ? "No archived items."
                      : "No items yet. Add your first service or SKU."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
