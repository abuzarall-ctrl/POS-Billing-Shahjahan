"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface GrossProfitFiltersProps {
  period: string
  dateFrom: string
  dateTo: string
  category: string
  categories: string[]
}

export function GrossProfitFilters({
  period: initialPeriod,
  dateFrom: initialDateFrom,
  dateTo: initialDateTo,
  category: initialCategory,
  categories,
}: GrossProfitFiltersProps) {
  const router = useRouter()
  const [period, setPeriod] = useState(initialPeriod)
  const [dateFrom, setDateFrom] = useState(initialDateFrom)
  const [dateTo, setDateTo] = useState(initialDateTo)
  const [category, setCategory] = useState(initialCategory)

  const applyFilters = (overrides?: Partial<{ period: string; dateFrom: string; dateTo: string; category: string }>) => {
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
    router.push(`/bi-report/gross-profit?${params.toString()}`)
  }

  const handlePeriodChange = (v: string) => {
    setPeriod(v)
    if (v !== "custom") {
      applyFilters({ period: v })
    }
  }

  const handleCategoryChange = (v: string) => {
    setCategory(v)
    applyFilters({ category: v })
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1 min-w-[180px]">
        <Label className="text-xs text-muted-foreground">Period</Label>
        <Select value={period} onValueChange={handlePeriodChange}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
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

      <div className="flex flex-col gap-1 min-w-[160px]">
        <Label className="text-xs text-muted-foreground">Category</Label>
        <Select value={category} onValueChange={handleCategoryChange}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Items</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
