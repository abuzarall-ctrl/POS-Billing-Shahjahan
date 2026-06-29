import Link from "next/link"
import { requirePrivilege } from "@/lib/auth/privileges"
import { getGrossProfitItems, getExpenses, getInventoryCategories, getPayrollTotal } from "../actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BarChart2, Receipt, TrendingUp, TrendingDown } from "lucide-react"
import { GrossProfitFilters } from "./filters-client"
import { GPTableClient } from "./gp-table-client"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number): string {
  return n.toFixed(1) + "%"
}

function getPKTNow(): Date {
  return new Date(Date.now() + 5 * 60 * 60 * 1000)
}

function computePeriodRange(period: string): { from: string; to: string } | null {
  const now = getPKTNow()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const day = now.getUTCDate()
  const dow = now.getUTCDay()

  function startOfDay(d: Date): string {
    const out = new Date(d)
    out.setUTCHours(0, 0, 0, 0)
    return out.toISOString()
  }
  function endOfDay(d: Date): string {
    const out = new Date(d)
    out.setUTCHours(23, 59, 59, 999)
    return out.toISOString()
  }

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
      return null
  }
}

// ─── Tab Bar (server-rendered) ────────────────────────────────────────────────

function BiReportTabs({ currentPath }: { currentPath: string }) {
  const tabs = [
    { href: "/bi-report/expense-sheet", label: "Expense Sheet", icon: Receipt },
    { href: "/bi-report/gross-profit", label: "Gross Profit", icon: BarChart2 },
  ]
  return (
    <div className="flex gap-1 border-b border-border mb-6">
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = currentPath === href || currentPath.startsWith(href + "/")
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

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<{
    period?: string
    dateFrom?: string
    dateTo?: string
    category?: string
  }>
}

export default async function GrossProfitPage({ searchParams }: PageProps) {
  await requirePrivilege("bi-report")
  const params = await searchParams

  const period = params.period ?? "this-month"
  const category = params.category ?? "all"

  // Resolve date range
  let from: string | undefined
  let to: string | undefined

  if (period === "custom") {
    from = params.dateFrom ? new Date(params.dateFrom + "T00:00:00+05:00").toISOString() : undefined
    to = params.dateTo ? new Date(params.dateTo + "T23:59:59+05:00").toISOString() : undefined
  } else {
    const range = computePeriodRange(period)
    if (range) {
      from = range.from
      to = range.to
    }
  }

  // Fetch data in parallel
  const [gpResult, expResult, categoriesResult, payrollTotal] = await Promise.all([
    getGrossProfitItems(from, to, category === "all" ? undefined : category),
    getExpenses(from, to),
    getInventoryCategories(),
    getPayrollTotal(from, to),
  ])

  const gpItems = gpResult.data
  const expenses = expResult.data
  const categories = categoriesResult.data

  // Totals
  const totalRevenue = gpItems.reduce((s, r) => s + r.revenue, 0)
  const totalCost = gpItems.reduce((s, r) => s + r.cost, 0)
  const totalGP = gpItems.reduce((s, r) => s + r.gp, 0)
  const totalGPPct = totalRevenue > 0 ? (totalGP / totalRevenue) * 100 : 0

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
  const netGP = totalGP - totalExpenses - payrollTotal

  // Period label for chart title / print / export
  const PERIOD_LABELS: Record<string, string> = {
    "this-week": "This Week",
    "last-week": "Last Week",
    "this-month": "This Month",
    "last-month": "Last Month",
    "this-year": "This Year",
    "last-year": "Last Year",
  }
  const periodLabel =
    period === "custom" && params.dateFrom && params.dateTo
      ? `${params.dateFrom} → ${params.dateTo}`
      : (PERIOD_LABELS[period] ?? "This Month")

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">BI Report</h1>
        <p className="text-sm text-muted-foreground">Business Intelligence — Expense Sheet & Gross Profit</p>
      </div>

      {/* Tabs — client nav highlights current tab via URL */}
      <BiReportTabs currentPath="/bi-report/gross-profit" />

      {/* Client filters component */}
      <GrossProfitFilters
        period={period}
        dateFrom={params.dateFrom ?? ""}
        dateTo={params.dateTo ?? ""}
        category={category}
        categories={categories}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-bold">PKR {fmt(totalRevenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-bold">PKR {fmt(totalCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Gross Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-lg font-bold ${totalGP >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              PKR {fmt(totalGP)}
            </p>
            <p className="text-xs text-muted-foreground">{fmtPct(totalGPPct)} margin</p>
          </CardContent>
        </Card>
        <Card className={netGP >= 0 ? "border-emerald-200 bg-emerald-50/50" : "border-red-200 bg-red-50/50"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              {netGP >= 0 ? (
                <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5 text-red-600" />
              )}
              Net Gross Profit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-lg font-bold ${netGP >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              PKR {fmt(netGP)}
            </p>
            <p className="text-xs text-muted-foreground">
              GP − Expenses{payrollTotal > 0 ? " − Salaries" : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Client component: chart + search + view toggle + table + print/export */}
      <GPTableClient
        items={gpItems}
        totalRevenue={totalRevenue}
        totalCost={totalCost}
        totalGP={totalGP}
        totalGPPct={totalGPPct}
        periodLabel={periodLabel}
      />

      {/* Net Gross Profit Section */}
      <Card className="border-2 border-dashed">
        <CardContent className="pt-5 pb-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Net Gross Profit Calculation</h2>
          <div className="space-y-2 text-sm max-w-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gross Profit</span>
              <span className="font-mono font-medium">PKR {fmt(totalGP)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">− Expenses ({expenses.length} items)</span>
              <span className="font-mono font-medium text-red-600">− PKR {fmt(totalExpenses)}</span>
            </div>
            {payrollTotal > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">− Employee Salaries</span>
                <span className="font-mono font-medium text-red-600">− PKR {fmt(payrollTotal)}</span>
              </div>
            )}
            <div className="border-t pt-2 flex justify-between font-semibold">
              <span>Net Gross Profit</span>
              <span className={`font-mono ${netGP >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                PKR {fmt(netGP)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
