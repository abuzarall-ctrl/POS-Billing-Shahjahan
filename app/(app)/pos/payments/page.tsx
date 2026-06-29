import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Wallet, RotateCcw, Clock, Info } from "lucide-react"
import {
  Tooltip as InfoTooltip,
  TooltipContent as InfoTooltipContent,
  TooltipTrigger as InfoTooltipTrigger,
} from "@/components/ui/tooltip"
import { isSupabaseReady } from "@/lib/supabase/config"
import { requirePrivilege } from "@/lib/auth/privileges"
import {
  getAllCustomerPayments,
  getUnpaidPOSSales,
  getPaidSales,
  getCustomerRefundsSummary,
} from "@/app/(app)/pos/actions"
import { CustomerPaymentDialog } from "@/components/customer-payment-dialog"
import { CurrencyDisplay } from "@/components/currency-display"
import { CustomerPaymentsClient } from "@/components/customer-payments-client"

export default async function CustomerPaymentsPage() {
  await requirePrivilege("pos")

  const [payments, unpaidSales, paidSales, refundsSummary] = await Promise.all([
    (async () => {
      if (!isSupabaseReady()) return []
      const result = await getAllCustomerPayments()
      return result.data || []
    })(),
    (async () => {
      if (!isSupabaseReady()) return []
      const result = await getUnpaidPOSSales()
      return result.data || []
    })(),
    (async () => {
      if (!isSupabaseReady()) return []
      const result = await getPaidSales()
      return result.data || []
    })(),
    (async () => {
      if (!isSupabaseReady()) return { totalRefunded: 0, refundCount: 0 }
      return await getCustomerRefundsSummary()
    })(),
  ])

  const grossReceived = paidSales.reduce((sum, s) => sum + Number(s.paid || 0), 0)
  const totalPaymentsCount = payments.length
  const totalRefunded = refundsSummary.totalRefunded ?? 0
  const refundCount = refundsSummary.refundCount ?? 0
  const netReceived = Math.max(0, grossReceived - totalRefunded)

  // Group outstanding balance by customer
  const outstandingByCustomer = unpaidSales.reduce<Record<string, { name: string; balance: number; invoices: number }>>((acc, s) => {
    const name = s.customerName || "Walk-in"
    const bal = Number(s.balance ?? s.total ?? 0)
    if (!acc[name]) acc[name] = { name, balance: 0, invoices: 0 }
    acc[name].balance += bal
    acc[name].invoices += 1
    return acc
  }, {})
  const outstandingList = Object.values(outstandingByCustomer).sort((a, b) => b.balance - a.balance)
  const totalOutstanding = outstandingList.reduce((sum, c) => sum + c.balance, 0)
  const outstandingInvoiceCount = unpaidSales.filter((s) => Number(s.balance ?? 0) > 0).length

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Customer Payments</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Manage payments for POS sales invoices.</p>
        </div>
        <CustomerPaymentDialog
          sales={unpaidSales.map((s) => ({
            id: s.id,
            invoiceNumber: s.invoiceNumber,
            customerName: s.customerName,
            total: Number(s.total || 0),
            status: s.status || "Draft",
            paid: s.paid,
            balance: s.balance,
          }))}
        />
      </div>

      {/* Summary KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {/* Total Payments — gross payments received from customers */}
        <div className="bg-card/90 backdrop-blur rounded-xl shadow-lg border border-border/70 p-4 sm:p-5 transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">Total Payments</p>
                <InfoTooltip>
                  <InfoTooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground/70 hover:text-foreground transition-colors flex-shrink-0" aria-label="More info">
                      <Info className="w-3 h-3" />
                    </button>
                  </InfoTooltipTrigger>
                  <InfoTooltipContent side="bottom" className="max-w-[260px] text-[11px] leading-relaxed">
                    Cash actually retained from customers — gross payments received minus refunds issued back as part of sale returns.
                  </InfoTooltipContent>
                </InfoTooltip>
              </div>
              <p className="text-sm sm:text-base font-semibold text-foreground leading-tight break-words">
                <CurrencyDisplay amount={netReceived} />
              </p>
              <div className="text-[10px] sm:text-[11px] leading-snug pt-1 space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Gross received</span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    <CurrencyDisplay amount={grossReceived} />
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Refunds issued</span>
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    <CurrencyDisplay amount={totalRefunded} />
                  </span>
                </div>
              </div>
            </div>
            <div className="text-muted-foreground bg-muted/40 dark:bg-muted/30 p-2 sm:p-2.5 rounded-lg inline-flex flex-shrink-0">
              <Wallet className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
            </div>
          </div>
        </div>

        {/* Refunds Issued */}
        <div className="bg-card/90 backdrop-blur rounded-xl shadow-lg border border-border/70 p-4 sm:p-5 transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">Refunds Issued</p>
                <InfoTooltip>
                  <InfoTooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground/70 hover:text-foreground transition-colors flex-shrink-0" aria-label="More info">
                      <Info className="w-3 h-3" />
                    </button>
                  </InfoTooltipTrigger>
                  <InfoTooltipContent side="bottom" className="max-w-[260px] text-[11px] leading-relaxed">
                    Total amount refunded to customers as part of sale returns. This is cash that left the till after the original sale was reversed.
                  </InfoTooltipContent>
                </InfoTooltip>
              </div>
              <p className="text-sm sm:text-base font-semibold text-foreground leading-tight break-words">
                <CurrencyDisplay amount={totalRefunded} />
              </p>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground pt-1">
                {refundCount} refund{refundCount === 1 ? "" : "s"} · {totalPaymentsCount} payment{totalPaymentsCount === 1 ? "" : "s"} on record
              </p>
            </div>
            <div className="text-muted-foreground bg-muted/40 dark:bg-muted/30 p-2 sm:p-2.5 rounded-lg inline-flex flex-shrink-0">
              <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
            </div>
          </div>
        </div>

        {/* Outstanding Receivables */}
        <div className="bg-card/90 backdrop-blur rounded-xl shadow-lg border border-border/70 p-4 sm:p-5 transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">Outstanding</p>
                <InfoTooltip>
                  <InfoTooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground/70 hover:text-foreground transition-colors flex-shrink-0" aria-label="More info">
                      <Info className="w-3 h-3" />
                    </button>
                  </InfoTooltipTrigger>
                  <InfoTooltipContent side="bottom" className="max-w-[260px] text-[11px] leading-relaxed">
                    Total amount still owed by customers — invoice total minus payments received minus value of returned items. Matches the Dashboard outstanding figure.
                  </InfoTooltipContent>
                </InfoTooltip>
              </div>
              <p className="text-sm sm:text-base font-semibold text-foreground leading-tight break-words">
                <CurrencyDisplay amount={totalOutstanding} />
              </p>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground pt-1">
                {outstandingInvoiceCount} unpaid invoice{outstandingInvoiceCount === 1 ? "" : "s"} · {outstandingList.length} customer{outstandingList.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="text-muted-foreground bg-muted/40 dark:bg-muted/30 p-2 sm:p-2.5 rounded-lg inline-flex flex-shrink-0">
              <Clock className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
            </div>
          </div>
        </div>
      </div>

      {/* Searchable sections (Outstanding by Customer, Paid Sales, Payment History) */}
      <CustomerPaymentsClient
        outstandingList={outstandingList}
        paidSales={paidSales.map((sale) => ({
          id: sale.id,
          invoiceNumber: sale.invoiceNumber,
          customerName: sale.customerName,
          total: Number(sale.total),
          paid: Number(sale.paid),
          balance: Number(sale.balance),
          date: sale.date ?? null,
          status: sale.status ?? "",
        }))}
        payments={payments.map((p) => ({
          id: p.id,
          invoiceNumber: p.invoiceNumber,
          customerName: p.customerName,
          amount: p.amount,
          method: p.method,
          createdAt: p.createdAt,
        }))}
      />
    </div>
  )
}
