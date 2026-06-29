"use client"

import { useState, useMemo, Fragment } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search } from "lucide-react"
import { CurrencyDisplay } from "@/components/currency-display"
import { ExportButtons } from "@/components/export-buttons"

type StockItem = {
  id: string
  name: string
  category_name: string | null
  stock: number
  unitPrice: number
  value: number
  stockStatus: "in_stock" | "low_stock" | "out_of_stock"
  isLowStock: boolean
  isOutOfStock: boolean
}

interface InventoryStockClientProps {
  items: StockItem[]
  totalValue: number
}

export function InventoryStockClient({ items, totalValue }: InventoryStockClientProps) {
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [stockFilter, setStockFilter] = useState("all")
  const [viewMode, setViewMode] = useState<"all" | "category">("all")

  const categories = useMemo(() => {
    const set = new Set(items.map((i) => i.category_name ?? "Uncategorized"))
    return Array.from(set).sort()
  }, [items])

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase().trim()
    return items.filter((item) => {
      if (q && !item.name.toLowerCase().includes(q)) return false
      if (categoryFilter !== "all") {
        const cat = item.category_name ?? "Uncategorized"
        if (cat !== categoryFilter) return false
      }
      if (stockFilter === "in" && item.stockStatus !== "in_stock") return false
      if (stockFilter === "low" && item.stockStatus !== "low_stock") return false
      if (stockFilter === "out" && item.stockStatus !== "out_of_stock") return false
      return true
    })
  }, [items, search, categoryFilter, stockFilter])

  const categoryGroups = useMemo(() => {
    const map = new Map<string, StockItem[]>()
    for (const item of filteredItems) {
      const cat = item.category_name ?? "Uncategorized"
      const existing = map.get(cat) ?? []
      existing.push(item)
      map.set(cat, existing)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filteredItems])

  const filteredTotalValue = filteredItems.reduce((s, i) => s + i.value, 0)

  const statusBadge = (item: StockItem) =>
    item.isOutOfStock ? (
      <Badge variant="destructive" className="text-[10px]">Out of Stock</Badge>
    ) : item.isLowStock ? (
      <Badge variant="destructive" className="text-[10px]">Low Stock</Badge>
    ) : (
      <Badge variant="default" className="text-[10px]">In Stock</Badge>
    )

  const renderRow = (item: StockItem) => (
    <tr key={item.id} className="hover:bg-muted/50">
      <td className="py-2 px-2 sm:px-4 font-medium text-foreground text-xs sm:text-sm">{item.name}</td>
      <td className="py-2 px-2 sm:px-4 text-foreground text-xs sm:text-sm hidden sm:table-cell">{item.category_name ?? "—"}</td>
      <td className="py-2 px-2 sm:px-4 text-foreground text-xs sm:text-sm">{item.stock}</td>
      <td className="py-2 px-2 sm:px-4 text-foreground text-xs sm:text-sm hidden sm:table-cell">
        <CurrencyDisplay amount={item.unitPrice} />
      </td>
      <td className="py-2 px-2 sm:px-4 text-foreground text-xs sm:text-sm hidden sm:table-cell">
        <CurrencyDisplay amount={item.value} />
      </td>
      <td className="py-2 px-2 sm:px-4 text-xs sm:text-sm">{statusBadge(item)}</td>
    </tr>
  )

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <CardTitle>
          Stock Levels
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({filteredItems.length}{filteredItems.length !== items.length ? `/${items.length}` : ""} items)
          </span>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 w-48 text-xs"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stockFilter} onValueChange={setStockFilter}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stock</SelectItem>
              <SelectItem value="in">In Stock</SelectItem>
              <SelectItem value="low">Low Stock</SelectItem>
              <SelectItem value="out">Out of Stock</SelectItem>
            </SelectContent>
          </Select>
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as "all" | "category")}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Items</SelectItem>
              <SelectItem value="category">Category Wise</SelectItem>
            </SelectContent>
          </Select>
          <ExportButtons
            data={filteredItems.map((item) => ({
              item: item.name,
              category: item.category_name ?? "",
              stock: item.stock,
              costPrice: item.unitPrice,
              value: item.value,
              status: item.isOutOfStock ? "Out of Stock" : item.isLowStock ? "Low Stock" : "In Stock",
            }))}
            columns={[
              { key: "item", header: "Item" },
              { key: "category", header: "Category" },
              { key: "stock", header: "Stock" },
              { key: "costPrice", header: "Cost Price" },
              { key: "value", header: "Value" },
              { key: "status", header: "Status" },
            ]}
            filename={`stock-levels-${new Date().toISOString().split("T")[0]}`}
            title="Stock Levels"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm">Item</th>
                <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm hidden sm:table-cell">Category</th>
                <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm">Stock</th>
                <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm hidden sm:table-cell">Cost Price</th>
                <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm hidden sm:table-cell">Value</th>
                <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm">Status</th>
              </tr>
            </thead>
            <tbody className="[&>tr:not(:last-child)]:border-b">
              {viewMode === "all"
                ? filteredItems.map(renderRow)
                : categoryGroups.map(([catName, catItems]) => {
                    const catValue = catItems.reduce((s, i) => s + i.value, 0)
                    return (
                      <Fragment key={`cat-${catName}`}>
                        <tr className="bg-muted/30">
                          <td colSpan={6} className="py-1.5 px-2 sm:px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            {catName}
                            <span className="ml-2 font-normal">({catItems.length} items · <CurrencyDisplay amount={catValue} />
                            {totalValue > 0 && <> · {((catValue / totalValue) * 100).toFixed(1)}%</>})</span>
                          </td>
                        </tr>
                        {catItems.map(renderRow)}
                      </Fragment>
                    )
                  })}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground text-xs px-4">
                    No items match your filters.
                  </td>
                </tr>
              )}
            </tbody>
            {filteredItems.length > 0 && (
              <tfoot>
                <tr className="border-t font-semibold bg-muted/20">
                  <td className="py-2 px-2 sm:px-4 text-xs sm:text-sm" colSpan={2}>Total ({filteredItems.length} items)</td>
                  <td className="py-2 px-2 sm:px-4 text-xs sm:text-sm hidden sm:table-cell"></td>
                  <td className="py-2 px-2 sm:px-4 text-xs sm:text-sm hidden sm:table-cell"></td>
                  <td className="py-2 px-2 sm:px-4 text-xs sm:text-sm hidden sm:table-cell">
                    <CurrencyDisplay amount={filteredTotalValue} />
                  </td>
                  <td className="py-2 px-2 sm:px-4 text-xs sm:text-sm"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
