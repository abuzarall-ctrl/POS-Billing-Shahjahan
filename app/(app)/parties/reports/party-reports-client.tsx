"use client"

import { useState, useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, FileText } from "lucide-react"
import { CurrencyDisplay } from "@/components/currency-display"
import Link from "next/link"
import { ExportButtons } from "@/components/export-buttons"

export interface PartyReportRow {
  id: string
  name: string
  type: string
  totalSales: number
  totalPurchases: number
  totalPayments: number
  totalPurchasePayments: number
  balance: number
}

interface PartyReportsClientProps {
  parties: PartyReportRow[]
  storeName: string
  userName: string
}

export function PartyReportsClient({ parties, storeName, userName }: PartyReportsClientProps) {
  const [search, setSearch] = useState("")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [typeFilter, setTypeFilter] = useState<"all" | "customer" | "vendor">("all")

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return parties.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false
      if (typeFilter !== "all" && p.type.toLowerCase() !== typeFilter) return false
      return true
    })
  }, [parties, search, typeFilter])

  const totalReceivable = filtered
    .filter((p) => p.type === "Customer")
    .reduce((sum, p) => sum + Math.max(p.balance, 0), 0)

  const totalPayable = filtered
    .filter((p) => p.type === "Vendor")
    .reduce((sum, p) => sum + Math.max(p.balance, 0), 0)

  const dateLabel =
    fromDate && toDate
      ? `${fromDate} to ${toDate}`
      : fromDate
        ? `From ${fromDate}`
        : toDate
          ? `To ${toDate}`
          : "ALL"

  return (
    <div className="space-y-4">
      {/* Date range filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">Date Range:</span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">From</label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-8 text-xs w-36"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">To</label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-8 text-xs w-36"
              />
            </div>
            {(fromDate || toDate) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => { setFromDate(""); setToDate("") }}
              >
                Clear
              </Button>
            )}
            {(fromDate || toDate) && (
              <span className="text-xs text-muted-foreground">
                Note: Balance shown is cumulative (all time). Date range is for display reference.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary totals */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Receivable</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-semibold text-amber-600">
              <CurrencyDisplay amount={totalReceivable} />
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {filtered.filter((p) => p.type === "Customer").length} customers shown
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Payable</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-semibold text-red-600">
              <CurrencyDisplay amount={totalPayable} />
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {filtered.filter((p) => p.type === "Vendor").length} vendors shown
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Net Balance</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p
              className={`text-2xl font-semibold ${
                totalReceivable - totalPayable >= 0 ? "text-emerald-600" : "text-red-600"
              }`}
            >
              <CurrencyDisplay amount={totalReceivable - totalPayable} />
            </p>
            <p className="text-xs text-muted-foreground mt-1">Receivable - Payable</p>
          </CardContent>
        </Card>
      </div>

      {/* Parties summary table */}
      <Card>
        <CardHeader className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <CardTitle className="text-base sm:text-lg">
            Party Summary
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({filtered.length}{filtered.length !== parties.length ? `/${parties.length}` : ""})
            </span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as "all" | "customer" | "vendor")}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="vendor">Vendor</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 w-48 sm:w-56 text-xs"
              />
            </div>
            <ExportButtons
              data={filtered.map((p) => ({
                name: p.name,
                type: p.type,
                total_sales: p.type === "Customer" ? p.totalSales : p.totalPurchases,
                total_payments: p.type === "Customer" ? p.totalPayments : p.totalPurchasePayments,
                balance: p.balance,
                status:
                  p.balance === 0
                    ? "Settled"
                    : p.type === "Customer"
                      ? p.balance > 0
                        ? "Receivable"
                        : "Overpaid"
                      : p.balance > 0
                        ? "Payable"
                        : "Overpaid",
              }))}
              columns={[
                { key: "name", header: "Name" },
                { key: "type", header: "Type" },
                { key: "total_sales", header: "Total Sales/Purchases" },
                { key: "total_payments", header: "Total Payments" },
                { key: "balance", header: "Balance" },
                { key: "status", header: "Status" },
              ]}
              filename={`party-summary-report-${new Date().toISOString().split("T")[0]}`}
              title="Party Summary Report"
              printStoreName={storeName}
              printReportParams={`Date Range: ${dateLabel} AND Party: ALL`}
              printLocation={storeName}
              printUserName={userName}
            />
          </div>
        </CardHeader>
        {/* Print-only summary header */}
        <div className="hidden print:block px-4 py-3 border-b">
          <div className="flex gap-8 text-sm">
            <span><strong>Total Receivable:</strong> PKR {totalReceivable.toLocaleString()}</span>
            <span><strong>Total Payable:</strong> PKR {totalPayable.toLocaleString()}</span>
            <span><strong>Net Balance:</strong> PKR {(totalReceivable - totalPayable).toLocaleString()}</span>
          </div>
        </div>
        <CardContent className="p-0 sm:p-3">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-1.5 px-2 sm:px-3 text-xs w-[20%]">Name</th>
                  <th className="py-1.5 px-2 sm:px-3 text-xs w-[10%]">Type</th>
                  <th className="py-1.5 px-2 sm:px-3 text-xs text-right w-[18%]">Total Sales</th>
                  <th className="py-1.5 px-2 sm:px-3 text-xs text-right w-[18%]">Total Paid</th>
                  <th className="py-1.5 px-2 sm:px-3 text-xs text-right w-[15%]">Balance</th>
                  <th className="py-1.5 px-2 sm:px-3 text-xs w-[12%]">Status</th>
                  <th className="py-1.5 px-2 sm:px-3 text-xs w-[7%]">Ledger</th>
                </tr>
              </thead>
              <tbody className="[&>tr:not(:last-child)]:border-b">
                {filtered.map((party) => {
                  const isCustomer = party.type === "Customer"
                  const salesAmt = isCustomer ? party.totalSales : party.totalPurchases
                  const paidAmt = isCustomer ? party.totalPayments : party.totalPurchasePayments
                  const bal = party.balance

                  return (
                    <tr key={party.id} className="hover:bg-muted/50">
                      <td className="py-1.5 px-2 sm:px-3 font-medium text-foreground text-xs w-[20%]">
                        {party.name}
                      </td>
                      <td className="py-1.5 px-2 sm:px-3 w-[10%]">
                        <Badge
                          variant={party.type === "Customer" ? "default" : "secondary"}
                          className="text-[10px] whitespace-nowrap px-1.5 py-0"
                        >
                          {party.type}
                        </Badge>
                      </td>
                      <td className="py-1.5 px-2 sm:px-3 text-right text-xs w-[18%]">
                        {salesAmt > 0 ? <CurrencyDisplay amount={salesAmt} /> : "—"}
                      </td>
                      <td className="py-1.5 px-2 sm:px-3 text-right text-xs w-[18%]">
                        {paidAmt > 0 ? <CurrencyDisplay amount={paidAmt} /> : "—"}
                      </td>
                      <td className="py-1.5 px-2 sm:px-3 text-right w-[15%]">
                        <span
                          className={`text-xs font-medium ${
                            isCustomer
                              ? bal > 0
                                ? "text-amber-600"
                                : bal < 0
                                  ? "text-red-600"
                                  : "text-muted-foreground"
                              : bal > 0
                                ? "text-red-600"
                                : bal < 0
                                  ? "text-emerald-600"
                                  : "text-muted-foreground"
                          }`}
                        >
                          {bal !== 0 ? <CurrencyDisplay amount={bal} /> : "—"}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 sm:px-3 w-[12%]">
                        {isCustomer ? (
                          bal > 0 ? (
                            <Badge variant="outline" className="text-[10px] text-amber-600 px-1.5 py-0">
                              Receivable
                            </Badge>
                          ) : bal < 0 ? (
                            <Badge variant="outline" className="text-[10px] text-red-600 px-1.5 py-0">
                              Overpaid
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground px-1.5 py-0">
                              Settled
                            </Badge>
                          )
                        ) : bal > 0 ? (
                          <Badge variant="outline" className="text-[10px] text-red-600 px-1.5 py-0">
                            Payable
                          </Badge>
                        ) : bal < 0 ? (
                          <Badge variant="outline" className="text-[10px] text-emerald-600 px-1.5 py-0">
                            Overpaid
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground px-1.5 py-0">
                            Settled
                          </Badge>
                        )}
                      </td>
                      <td className="py-1.5 px-2 sm:px-3 w-[7%]">
                        <Link href={`/parties/${party.id}/ledger`}>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="View Ledger">
                            <FileText className="w-3 h-3" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted-foreground text-xs px-4">
                      {search || typeFilter !== "all" ? "No parties match your search or filter." : "No parties found."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
