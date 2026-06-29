"use client"

import { useState, useTransition, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Plus, Trash2, Search, BarChart2, Receipt, Printer, Download, Upload, FileSpreadsheet } from "lucide-react"
import { toast } from "sonner"
import { addExpense, getExpenses, deleteExpense, importExpenses } from "../actions"
import type { Expense } from "../actions"

// ─── Period helpers (PKT = UTC+5) ────────────────────────────────────────────

type PeriodKey =
  | "this-week"
  | "last-week"
  | "this-month"
  | "last-month"
  | "this-year"
  | "last-year"
  | "custom"

function getPKTNow(): Date {
  return new Date(Date.now() + 5 * 60 * 60 * 1000)
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

function endOfDay(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(23, 59, 59, 999)
  return out
}

function computePeriodRange(period: PeriodKey): { from: Date; to: Date } {
  const now = getPKTNow()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const day = now.getUTCDate()
  const dow = now.getUTCDay() // 0=Sun,1=Mon,...,6=Sat

  switch (period) {
    case "this-week": {
      const daysBack = dow === 0 ? 6 : dow - 1
      const monday = new Date(now)
      monday.setUTCDate(day - daysBack)
      return { from: startOfDay(monday), to: endOfDay(now) }
    }
    case "last-week": {
      const daysBack = dow === 0 ? 6 : dow - 1
      const thisMonday = new Date(now)
      thisMonday.setUTCDate(day - daysBack)
      const lastMonday = new Date(thisMonday)
      lastMonday.setUTCDate(thisMonday.getUTCDate() - 7)
      const lastSunday = new Date(thisMonday)
      lastSunday.setUTCDate(thisMonday.getUTCDate() - 1)
      return { from: startOfDay(lastMonday), to: endOfDay(lastSunday) }
    }
    case "this-month": {
      const first = new Date(Date.UTC(year, month, 1))
      return { from: startOfDay(first), to: endOfDay(now) }
    }
    case "last-month": {
      const firstOfLastMonth = new Date(Date.UTC(year, month - 1, 1))
      const lastOfLastMonth = new Date(Date.UTC(year, month, 0))
      return { from: startOfDay(firstOfLastMonth), to: endOfDay(lastOfLastMonth) }
    }
    case "this-year": {
      const jan1 = new Date(Date.UTC(year, 0, 1))
      return { from: startOfDay(jan1), to: endOfDay(now) }
    }
    case "last-year": {
      const jan1 = new Date(Date.UTC(year - 1, 0, 1))
      const dec31 = new Date(Date.UTC(year - 1, 11, 31))
      return { from: startOfDay(jan1), to: endOfDay(dec31) }
    }
    default:
      return { from: startOfDay(now), to: endOfDay(now) }
  }
}

function fmt(n: number): string {
  return n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDatetime(iso: string): string {
  return new Date(iso).toLocaleString("en-PK", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// ─── Sub-page Tab Bar ─────────────────────────────────────────────────────────

function BiReportTabs() {
  const pathname = usePathname()
  const tabs = [
    { href: "/bi-report/expense-sheet", label: "Expense Sheet", icon: Receipt },
    { href: "/bi-report/gross-profit", label: "Gross Profit", icon: BarChart2 },
  ]
  return (
    <div className="flex gap-1 border-b border-border mb-6">
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/")
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        )
      })}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ExpenseSheetClient() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  // Period filter state
  const [period, setPeriod] = useState<PeriodKey>("this-month")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")

  // Add expense form state
  const [showForm, setShowForm] = useState(false)
  const [description, setDescription] = useState("")
  const [amount, setAmount] = useState("")

  // Search
  const [search, setSearch] = useState("")

  // Import/Export
  const [showImportExport, setShowImportExport] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Compute date range from period
  const getDateRange = useCallback((): { from: string; to: string } => {
    if (period === "custom") {
      const from = customFrom ? new Date(customFrom + "T00:00:00+05:00").toISOString() : ""
      const to = customTo ? new Date(customTo + "T23:59:59+05:00").toISOString() : ""
      return { from, to }
    }
    const range = computePeriodRange(period)
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    }
  }, [period, customFrom, customTo])

  // Load expenses
  const loadExpenses = useCallback(() => {
    const { from, to } = getDateRange()
    setLoading(true)
    startTransition(async () => {
      const result = await getExpenses(from || undefined, to || undefined)
      if (result.error) {
        toast.error(result.error)
      } else {
        setExpenses(result.data)
      }
      setLoading(false)
    })
  }, [getDateRange])

  useEffect(() => {
    loadExpenses()
  }, [loadExpenses])

  // Handle add expense
  const handleAddExpense = () => {
    const amt = parseFloat(amount)
    if (!description.trim()) {
      toast.error("Description is required")
      return
    }
    if (!Number.isFinite(amt) || amt < 0) {
      toast.error("Amount must be a non-negative number")
      return
    }
    startTransition(async () => {
      const result = await addExpense(description.trim(), amt)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success("Expense added")
        setDescription("")
        setAmount("")
        setShowForm(false)
        loadExpenses()
      }
    })
  }

  // Handle delete expense
  const handleDelete = (id: string) => {
    startTransition(async () => {
      const result = await deleteExpense(id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success("Expense deleted")
        setExpenses((prev) => prev.filter((e) => e.id !== id))
      }
    })
  }

  // Filter by search
  const filtered = expenses.filter(
    (e) => search === "" || e.description.toLowerCase().includes(search.toLowerCase()),
  )

  // Compute running total (ascending by created_at, already sorted from server)
  const withRunningTotal = filtered.reduce<Array<Expense & { runningTotal: number }>>(
    (acc, expense) => {
      const prev = acc[acc.length - 1]?.runningTotal ?? 0
      acc.push({ ...expense, runningTotal: prev + expense.amount })
      return acc
    },
    [],
  )

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0)

  // Export handler
  const handleExport = () => {
    const header = ["#", "Date / Time", "Description", "Amount (PKR)", "Running Total (PKR)"]
    const rows = withRunningTotal.map((e, i) => [
      i + 1,
      fmtDatetime(e.created_at),
      `"${e.description.replace(/"/g, '""')}"`,
      e.amount,
      e.runningTotal,
    ])
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n")
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `expenses-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Import handler
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const lines = text.split("\n").filter(Boolean)
    const firstLine = lines[0]?.toLowerCase() ?? ""
    if (!firstLine.includes("description") && !firstLine.includes("amount")) {
      toast.error("Wrong file format. Please use the expense sheet import template.")
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }
    const dataLines = firstLine.includes("description") ? lines.slice(1) : lines

    let imported = 0
    let errors = 0
    for (const line of dataLines) {
      // Parse CSV line (handle quoted fields)
      const parts = line.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)?.map((p) =>
        p.replace(/^,/, "").replace(/^"|"$/g, "").replace(/""/g, '"')
      ) ?? []
      // Expected format: Description, Amount (columns 0 and 1)
      // Also accept export format: #, Date, Description, Amount (columns 2 and 3)
      let desc = ""
      let amt = 0
      if (parts.length >= 4 && !isNaN(Number(parts[3]))) {
        // Export format
        desc = parts[2]?.trim() ?? ""
        amt = Number(parts[3])
      } else if (parts.length >= 2) {
        desc = parts[0]?.trim() ?? ""
        amt = Number(parts[1])
      }
      if (!desc || isNaN(amt) || amt < 0) { errors++; continue }
      const result = await importExpenses([{ description: desc, amount: amt }])
      if (result.error) errors++; else imported++
    }

    toast.success(`Imported ${imported} expense(s)${errors > 0 ? `, ${errors} skipped` : ""}`)
    loadExpenses()
    if (fileInputRef.current) fileInputRef.current.value = ""
    setShowImportExport(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">BI Report</h1>
        <p className="text-sm text-muted-foreground">
          Business Intelligence — Expense Sheet &amp; Gross Profit
        </p>
      </div>

      {/* Tab Navigation */}
      <BiReportTabs />

      {/* Filters Row */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 min-w-[180px]">
          <Label className="text-xs text-muted-foreground">Period</Label>
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
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
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-9 w-36"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-9 w-36"
              />
            </div>
          </>
        )}

        {/* Action buttons on the right */}
        <div className="ml-auto flex items-center gap-2">
          {/* Print button */}
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => window.print()}>
            <Printer className="w-4 h-4" />
            Print
          </Button>

          {/* Import/Export dropdown */}
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => setShowImportExport((v) => !v)}
            >
              <FileSpreadsheet className="w-4 h-4" />
              Import/Export
            </Button>
            {showImportExport && (
              <div className="absolute right-0 top-10 z-20 w-40 rounded-lg border border-border bg-popover shadow-lg">
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 rounded-t-lg"
                  onClick={() => { fileInputRef.current?.click(); setShowImportExport(false) }}
                >
                  <Upload className="w-4 h-4" />
                  Import
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 rounded-b-lg"
                  onClick={() => { handleExport(); setShowImportExport(false) }}
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
              </div>
            )}
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleImportFile}
          />

          {/* Add Expense button */}
          <Button size="sm" className="h-9" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            Add Expense
          </Button>
        </div>
      </div>

      {/* Add Expense Form */}
      {showForm && (
        <Card className="border-dashed border-primary/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                <Label htmlFor="description" className="text-xs">
                  Description
                </Label>
                <Input
                  id="description"
                  placeholder="e.g. Electricity bill"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddExpense()}
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1 w-36">
                <Label htmlFor="amount" className="text-xs">
                  Amount (PKR)
                </Label>
                <Input
                  id="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddExpense()}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAddExpense} disabled={isPending} size="sm">
                  {isPending ? "Saving..." : "Save"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowForm(false)
                    setDescription("")
                    setAmount("")
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Card */}
      <div className="flex gap-4">
        <Card className="flex-1 max-w-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">PKR {fmt(totalExpenses)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{expenses.length} entries</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      {/* Expenses Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead>Date / Time</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount (PKR)</TableHead>
                  <TableHead className="text-right">Running Total (PKR)</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : withRunningTotal.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                      {search
                        ? "No expenses match your search."
                        : "No expenses in this period."}
                    </TableCell>
                  </TableRow>
                ) : (
                  withRunningTotal.map((expense, idx) => (
                    <TableRow key={expense.id}>
                      <TableCell className="text-center text-muted-foreground text-sm">
                        {idx + 1}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {fmtDatetime(expense.created_at)}
                      </TableCell>
                      <TableCell className="text-sm">{expense.description}</TableCell>
                      <TableCell className="text-right text-sm font-mono">
                        {fmt(expense.amount)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono font-medium">
                        {fmt(expense.runningTotal)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDelete(expense.id)}
                          disabled={isPending}
                          aria-label="Delete expense"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
