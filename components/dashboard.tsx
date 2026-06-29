"use client"

import { useState } from "react"
import { Activity, Users, Wallet, Clock, AlertTriangle, ShoppingCart, Package, Info, Printer } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  BarChart, Bar,
  PieChart, Pie, Cell, Legend,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import { AddCustomerDialog, AddItemDialog } from "@/components/dashboard-add-dialogs"
import {
  Tooltip as InfoTooltip,
  TooltipContent as InfoTooltipContent,
  TooltipTrigger as InfoTooltipTrigger,
} from "@/components/ui/tooltip"

interface DashboardProps {
  parties: Array<{ id: number; name: string; type: string }>
  inventory: Array<{ id: number; stock: number; unitPrice: number }>
  invoices: Array<{ totalAmount: number; status: string }>
  totalSales?: number
  grossProfit?: number
  grossProfitPercent?: number
  realizedProfit?: number
  profitAtRisk?: number
  outstandingReceivables?: number
  period?: string
  lowStockItems?: Array<{ id: string; name: string; stock: number; minimum_stock: number }>
  dailySales?: Array<{ date: string; total: number }>
  topProductsByQty?: Array<{ name: string; qty: number }>
  topSellersByRevenue?: Array<{ name: string; revenue: number }>
  dateFrom?: string
  dateTo?: string
}

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "year", label: "This Year" },
]

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
const DAY_ABBR = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]

const CHART_COLORS = {
  bar: "#10b981",
  products: "#3b82f6",
  sellers: "#f59e0b",
  pie: ["#3b82f6", "#10b981", "#f59e0b", "#f87171", "#a78bfa", "#fb923c"],
}

function formatChartDate(dateStr: string, period: string): string {
  if (period === "year") {
    const month = parseInt(dateStr.split("-")[1]) - 1
    return MONTH_ABBR[month] ?? dateStr
  }
  const d = new Date(dateStr + "T00:00:00")
  if (period === "week") return DAY_ABBR[d.getDay()] ?? dateStr
  return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`
}

function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) {
  if (percent < 0.06) return null
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

// Truncate long product names for chart axis
function truncateName(name: string, max = 18): string {
  return name.length > max ? name.slice(0, max - 1) + "…" : name
}

export function Dashboard({
  parties,
  inventory,
  invoices,
  totalSales: totalSalesProp,
  grossProfit = 0,
  grossProfitPercent = 0,
  realizedProfit,
  profitAtRisk,
  outstandingReceivables: outstandingReceivablesProp,
  period = "month",
  lowStockItems = [],
  dailySales = [],
  topProductsByQty = [],
  topSellersByRevenue = [],
  dateFrom,
  dateTo,
}: DashboardProps) {
  const { formatCurrency } = useCurrency()
  const router = useRouter()

  const isCustomRange = !!(dateFrom && dateTo)

  // Local state for date inputs (controlled locally, applied on button click)
  const [dateFromLocal, setDateFromLocal] = useState(dateFrom ?? "")
  const [dateToLocal, setDateToLocal] = useState(dateTo ?? "")

  function handlePeriodChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(`/dashboard?period=${e.target.value}`)
  }

  function handleApplyRange() {
    if (dateFromLocal && dateToLocal) {
      router.push(`/dashboard?dateFrom=${dateFromLocal}&dateTo=${dateToLocal}`)
    }
  }

  function handleClearRange() {
    setDateFromLocal("")
    setDateToLocal("")
    router.push(`/dashboard?period=${period}`)
  }

  const totalSales = totalSalesProp ?? invoices.reduce((sum, inv) => sum + inv.totalAmount, 0)
  const totalCustomers = parties.filter((p) => p.type === "Customer").length
  const outstandingReceivables =
    outstandingReceivablesProp ??
    invoices
      .filter((inv) => inv.status === "Credit" || inv.status === "Pending")
      .reduce((sum, inv) => sum + inv.totalAmount, 0)

  const showProfitBreakdown =
    realizedProfit !== undefined &&
    profitAtRisk !== undefined &&
    profitAtRisk > 0.01

  const periodLabel = isCustomRange
    ? `${dateFrom} → ${dateTo}`
    : PERIODS.find((p) => p.value === period)?.label ?? "MTD"

  type KpiItem = {
    title: string
    value: string | number
    icon: typeof Activity
    breakdown?: { realized: number; atRisk: number }
    tooltip?: string
  }

  const kpis: KpiItem[] = [
    {
      title: `Total Sales (${periodLabel})`,
      value: formatCurrency(totalSales),
      icon: Activity,
    },
    {
      title: "Gross Profit",
      value: `${formatCurrency(grossProfit)} (${grossProfitPercent}%)`,
      icon: Wallet,
      breakdown: showProfitBreakdown ? { realized: realizedProfit!, atRisk: profitAtRisk! } : undefined,
      tooltip:
        "Total profit booked on your sales. 'Realized' is the portion received from paid sales. 'At risk' is the portion sitting in unpaid (Credit / Pending) sales — it will not be realized until the customer pays.",
    },
    {
      title: "Total Customers",
      value: totalCustomers,
      icon: Users,
    },
    {
      title: "Outstanding Receivables",
      value: formatCurrency(outstandingReceivables),
      icon: Clock,
      tooltip:
        "Total amount still owed by customers (all-time snapshot). Only Credit and Pending invoices are counted — invoice total minus what has already been paid.",
    },
  ]

  const totalStockValue = inventory.reduce((sum, item) => sum + item.stock * item.unitPrice, 0)
  const customerCount = parties.filter((p) => p.type === "Customer").length
  const vendorCount = parties.filter((p) => p.type === "Vendor").length

  const invoiceStatusData = [
    { name: "Paid", value: invoices.filter(i => i.status === "Paid").length },
    { name: "Credit", value: invoices.filter(i => i.status === "Credit").length },
    { name: "Partial", value: invoices.filter(i => i.status === "Partial").length },
    { name: "Draft", value: invoices.filter(i => i.status === "Draft").length },
  ].filter(d => d.value > 0)

  const adequateItems = Math.max(0, inventory.length - lowStockItems.length)
  const stockHealthData = [
    { name: "Healthy", value: adequateItems },
    { name: "Low Stock", value: lowStockItems.length },
  ].filter(d => d.value > 0)

  const tooltipStyle = {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "8px",
    fontSize: "12px",
    color: "#f1f5f9",
  }

  // Prepare chart-friendly arrays with truncated names
  const productsChartData = topProductsByQty.map(p => ({ name: truncateName(p.name), qty: p.qty }))
  const sellersChartData = topSellersByRevenue.map(s => ({ name: truncateName(s.name), revenue: s.revenue }))

  // Dynamic height based on number of bars (min 200, ~28px per bar)
  const productsChartHeight = Math.max(200, productsChartData.length * 30 + 20)
  const sellersChartHeight = Math.max(200, sellersChartData.length * 30 + 20)

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header + Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight">Dashboard</h2>
            <p className="text-xs sm:text-sm text-muted-foreground">Quick pulse of your business</p>
          </div>
          <button
            onClick={() => window.print()}
            className="print:hidden flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
        </div>

        {/* Filter row: period dropdown + date range */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Period dropdown */}
          <select
            value={isCustomRange ? "" : period}
            onChange={handlePeriodChange}
            className="h-9 rounded-lg border border-border bg-background text-foreground text-sm px-3 pr-8 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
            {isCustomRange && <option value="" disabled>Custom Range</option>}
          </select>

          {/* Date range */}
          <span className="text-xs text-muted-foreground">or</span>
          <input
            type="date"
            value={dateFromLocal}
            onChange={(e) => setDateFromLocal(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background text-foreground text-sm px-3 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <input
            type="date"
            value={dateToLocal}
            onChange={(e) => setDateToLocal(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background text-foreground text-sm px-3 focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={handleApplyRange}
            disabled={!dateFromLocal || !dateToLocal}
            className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
          >
            Apply
          </button>
          {isCustomRange && (
            <button
              onClick={handleClearRange}
              className="h-9 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Low Stock Alert */}
      {lowStockItems.length > 0 && (
        <Link href="/stock-management/inventory?filter=low_stock">
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-xl cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-950 transition-colors">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {lowStockItems.length} item{lowStockItems.length > 1 ? "s" : ""} low on stock
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 truncate">
                {lowStockItems.slice(0, 3).map((i) => `${i.name} (${i.stock})`).join(", ")}
                {lowStockItems.length > 3 ? ` +${lowStockItems.length - 3} more` : ""}
              </p>
            </div>
            <span className="text-xs text-amber-600 dark:text-amber-400 flex-shrink-0">View →</span>
          </div>
        </Link>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <Link href="/pos">
          <button className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            <ShoppingCart className="w-4 h-4" />
            New Sale
          </button>
        </Link>
        <AddItemDialog />
        <Link href="/purchase-management/create">
          <button className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors">
            <Package className="w-4 h-4" />
            New Purchase
          </button>
        </Link>
        <AddCustomerDialog />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {kpis.map((kpi, index) => {
          const Icon = kpi.icon
          return (
            <div
              key={index}
              className="bg-card/90 backdrop-blur rounded-xl shadow-lg border border-border/70 p-4 sm:p-5 transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">{kpi.title}</p>
                    {kpi.tooltip && (
                      <InfoTooltip>
                        <InfoTooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-muted-foreground/70 hover:text-foreground transition-colors flex-shrink-0"
                            aria-label="More info"
                          >
                            <Info className="w-3 h-3" />
                          </button>
                        </InfoTooltipTrigger>
                        <InfoTooltipContent side="bottom" className="max-w-[260px] text-[11px] leading-relaxed">
                          {kpi.tooltip}
                        </InfoTooltipContent>
                      </InfoTooltip>
                    )}
                  </div>
                  <p className="text-sm sm:text-base font-semibold text-foreground leading-tight break-words">{kpi.value}</p>
                  {kpi.breakdown && (
                    <div className="text-[10px] sm:text-[11px] leading-snug pt-1 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Realized</span>
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(kpi.breakdown.realized)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">At risk</span>
                        <span className="font-medium text-amber-600 dark:text-amber-400">{formatCurrency(kpi.breakdown.atRisk)}</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="text-muted-foreground bg-muted/40 dark:bg-muted/30 p-2 sm:p-2.5 rounded-lg inline-flex flex-shrink-0">
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Top 10 Products by Qty + Daily Sales Histogram */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top 10 Products by Quantity */}
        <div className="bg-card/90 backdrop-blur rounded-xl shadow-lg border border-border/70 p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm sm:text-base font-semibold text-foreground">Top 10 Products</h3>
            <span className="text-[10px] text-muted-foreground">by Qty Sold · {periodLabel}</span>
          </div>
          {productsChartData.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-10">No sales in this period</p>
          ) : (
            <ResponsiveContainer width="100%" height={productsChartHeight}>
              <BarChart
                data={productsChartData}
                layout="vertical"
                margin={{ top: 0, right: 16, left: 4, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 9, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={130}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value: number) => [value + " units", "Qty"]}
                  contentStyle={tooltipStyle}
                />
                <Bar dataKey="qty" fill={CHART_COLORS.products} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Daily Sales Histogram */}
        <div className="bg-card/90 backdrop-blur rounded-xl shadow-lg border border-border/70 p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm sm:text-base font-semibold text-foreground">Daily Sales</h3>
            <span className="text-[10px] text-muted-foreground">Histogram</span>
          </div>
          {dailySales.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-10">No sales in this period</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={dailySales} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => formatChartDate(v, period)}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickFormatter={(v) => formatCurrency(v)}
                  tick={{ fontSize: 9, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  width={82}
                />
                <Tooltip
                  formatter={(value: number) => [formatCurrency(value), "Sales"]}
                  labelFormatter={(label) => formatChartDate(label, period)}
                  contentStyle={tooltipStyle}
                />
                <Bar dataKey="total" fill={CHART_COLORS.bar} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top 10 Sellers by Revenue */}
      <div className="bg-card/90 backdrop-blur rounded-xl shadow-lg border border-border/70 p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm sm:text-base font-semibold text-foreground">Top 10 Best-Selling Items</h3>
          <span className="text-[10px] text-muted-foreground">by Revenue · {periodLabel}</span>
        </div>
        {sellersChartData.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-10">No sales in this period</p>
        ) : (
          <ResponsiveContainer width="100%" height={sellersChartHeight}>
            <BarChart
              data={sellersChartData}
              layout="vertical"
              margin={{ top: 0, right: 16, left: 4, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(v) => formatCurrency(v)}
                tick={{ fontSize: 9, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={130}
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value: number) => [formatCurrency(value), "Revenue"]}
                contentStyle={tooltipStyle}
              />
              <Bar dataKey="revenue" fill={CHART_COLORS.sellers} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Pie Charts — invoice status + stock health */}
      {(invoiceStatusData.length > 0 || stockHealthData.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {invoiceStatusData.length > 0 && (
            <div className="bg-card/90 backdrop-blur rounded-xl shadow-lg border border-border/70 p-4 sm:p-5">
              <h3 className="text-sm sm:text-base font-semibold text-foreground mb-1">Invoice Status</h3>
              <p className="text-[10px] text-muted-foreground mb-3">{periodLabel} breakdown</p>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={invoiceStatusData}
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    dataKey="value"
                    labelLine={false}
                    label={PieLabel}
                  >
                    {invoiceStatusData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS.pie[i % CHART_COLORS.pie.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [value + " invoices", name]}
                    contentStyle={tooltipStyle}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {stockHealthData.length > 0 && (
            <div className="bg-card/90 backdrop-blur rounded-xl shadow-lg border border-border/70 p-4 sm:p-5">
              <h3 className="text-sm sm:text-base font-semibold text-foreground mb-1">Stock Health</h3>
              <p className="text-[10px] text-muted-foreground mb-3">
                {inventory.length} total items · {lowStockItems.length} low
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={stockHealthData}
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    dataKey="value"
                    labelLine={false}
                    label={PieLabel}
                  >
                    <Cell fill="#10b981" />
                    <Cell fill="#f87171" />
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [value + " items", name]}
                    contentStyle={tooltipStyle}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Quick Stats */}
      <div className="bg-card/90 backdrop-blur rounded-xl shadow-lg border border-border/70 p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base sm:text-lg font-semibold text-foreground">Quick Stats</h3>
          <span className="text-[10px] sm:text-xs text-muted-foreground">Live snapshot</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-border/70 p-3 sm:p-4 bg-muted/30">
            <p className="text-xs sm:text-sm text-muted-foreground">Total Inventory Items</p>
            <p className="text-xl sm:text-2xl font-semibold text-foreground mt-1">{inventory.length}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-2">
              Stock Value: <span className="font-semibold text-foreground">{formatCurrency(totalStockValue)}</span>
            </p>
          </div>
          <div className="rounded-xl border border-border/70 p-3 sm:p-4 bg-muted/30">
            <p className="text-xs sm:text-sm text-muted-foreground">Total Parties</p>
            <p className="text-xl sm:text-2xl font-semibold text-foreground mt-1">{parties.length}</p>
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-2">
              Customers: <span className="font-semibold text-foreground">{customerCount}</span> | Vendors:{" "}
              <span className="font-semibold text-foreground">{vendorCount}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
