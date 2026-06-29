import { createAdminClient } from "@/lib/supabase/admin"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { requirePrivilege } from "@/lib/auth/privileges"
import { getPartyLedger } from "../../actions"
import { CurrencyDisplay } from "@/components/currency-display"
import { Button } from "@/components/ui/button"
import { ArrowLeft, FileText, CreditCard, RotateCcw, Wallet, Activity, Banknote, Info } from "lucide-react"
import {
  Tooltip as InfoTooltip,
  TooltipContent as InfoTooltipContent,
  TooltipTrigger as InfoTooltipTrigger,
} from "@/components/ui/tooltip"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ExportButtons } from "@/components/export-buttons"

export default async function PartyLedgerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePrivilege("parties")
  const { id } = await params

  const result = await getPartyLedger(id)

  if (result.error || !result.data) {
    notFound()
  }

  const { party, ledgerRows } = result.data

  const currentBalance = ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].balance : 0
  const isVendor = party.type === "Vendor"

  // Per-type summary stats. The previous version summed all debits / all credits and
  // labelled them "Total Sales" / "Total Payments", which silently rolled refunds into
  // Sales and returns into Payments — both wrong against standard subsidiary-ledger
  // accounting. Each metric below filters by transaction `type` so the cards only show
  // what they claim to.
  //
  // For each filter we take `debit + credit` (one is always 0) so the same calculation
  // works for both customer and vendor ledgers without branching.
  const totalSales = ledgerRows
    .filter((r) => r.type === "invoice")
    .reduce((sum, r) => sum + r.debit, 0)
  const totalPurchases = ledgerRows
    .filter((r) => r.type === "purchase")
    .reduce((sum, r) => sum + r.credit, 0)
  const totalPayments = ledgerRows
    .filter((r) => r.type === "payment")
    .reduce((sum, r) => sum + r.debit + r.credit, 0)
  const totalReturns = ledgerRows
    .filter((r) => r.type === "return")
    .reduce((sum, r) => sum + r.debit + r.credit, 0)
  const totalRefunds = ledgerRows
    .filter((r) => r.type === "refund")
    .reduce((sum, r) => sum + r.debit + r.credit, 0)

  const transactionCount = ledgerRows.length
  const invoiceOrPurchaseCount = ledgerRows.filter((r) => r.type === "invoice" || r.type === "purchase").length
  const paymentCount = ledgerRows.filter((r) => r.type === "payment").length
  const returnCount = ledgerRows.filter((r) => r.type === "return").length
  const refundCount = ledgerRows.filter((r) => r.type === "refund").length

  // The same Card 2 slot serves both customer and vendor ledgers.
  const headlineAmount = isVendor ? totalPurchases : totalSales
  const headlineLabel = isVendor ? "Total Purchases" : "Total Sales"
  const headlineUnit = isVendor ? "purchase" : "invoice"

  // Flat display — no grouping needed
  const groupedRows = ledgerRows.map((row) => ({ row }))

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/parties">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">{party.name}</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Account Ledger</p>
        </div>
      </div>

      {/* Summary KPI cards — same visual language as the main Dashboard / Customer Payments */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Current Balance — what the party owes us (Customer) or what we owe them (Vendor). */}
        <div className="bg-card/90 backdrop-blur rounded-xl shadow-lg border border-border/70 p-4 sm:p-5 transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">Current Balance</p>
                <InfoTooltip>
                  <InfoTooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground/70 hover:text-foreground transition-colors flex-shrink-0" aria-label="More info">
                      <Info className="w-3 h-3" />
                    </button>
                  </InfoTooltipTrigger>
                  <InfoTooltipContent side="bottom" className="max-w-[260px] text-[11px] leading-relaxed">
                    {isVendor
                      ? "Amount you owe this vendor right now. Positive = Payable; negative = you overpaid."
                      : "Amount this customer owes you right now. Positive = Receivable; negative = customer overpaid."}
                  </InfoTooltipContent>
                </InfoTooltip>
              </div>
              <p
                className={`text-sm sm:text-base font-semibold leading-tight break-words ${
                  isVendor
                    ? currentBalance > 0
                      ? "text-red-600"
                      : currentBalance < 0
                        ? "text-emerald-600"
                        : "text-foreground"
                    : currentBalance > 0
                      ? "text-amber-600"
                      : currentBalance < 0
                        ? "text-red-600"
                        : "text-foreground"
                }`}
              >
                <CurrencyDisplay amount={currentBalance} />
              </p>
              {(() => {
                if (currentBalance === 0) return null
                const label = isVendor
                  ? currentBalance > 0
                    ? "Payable"
                    : "Overpaid"
                  : currentBalance > 0
                    ? "Receivable"
                    : "Overpaid"
                return (
                  <Badge variant="outline" className="text-[10px] whitespace-nowrap">
                    {label}
                  </Badge>
                )
              })()}
            </div>
            <div className="text-muted-foreground bg-muted/40 dark:bg-muted/30 p-2 sm:p-2.5 rounded-lg inline-flex flex-shrink-0">
              <Wallet className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
            </div>
          </div>
        </div>

        {/* Total Sales / Total Purchases — gross invoice activity with this party. */}
        <div className="bg-card/90 backdrop-blur rounded-xl shadow-lg border border-border/70 p-4 sm:p-5 transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">{headlineLabel}</p>
                <InfoTooltip>
                  <InfoTooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground/70 hover:text-foreground transition-colors flex-shrink-0" aria-label="More info">
                      <Info className="w-3 h-3" />
                    </button>
                  </InfoTooltipTrigger>
                  <InfoTooltipContent side="bottom" className="max-w-[260px] text-[11px] leading-relaxed">
                    Gross {headlineUnit} value (excluding cancelled). Returns are tracked separately in the Returns & Refunds card.
                  </InfoTooltipContent>
                </InfoTooltip>
              </div>
              <p className="text-sm sm:text-base font-semibold text-foreground leading-tight break-words">
                <CurrencyDisplay amount={headlineAmount} />
              </p>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground pt-1">
                {invoiceOrPurchaseCount} {headlineUnit}{invoiceOrPurchaseCount === 1 ? "" : "s"}
              </p>
            </div>
            <div className="text-muted-foreground bg-muted/40 dark:bg-muted/30 p-2 sm:p-2.5 rounded-lg inline-flex flex-shrink-0">
              <Activity className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
            </div>
          </div>
        </div>

        {/* Total Payments — actual cash received from the customer (or paid to the vendor). */}
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
                    {isVendor
                      ? "Cash paid out to this vendor against their invoices. Excludes refund debits from purchase returns."
                      : "Cash received from this customer against their invoices. Excludes refund debits and sale-return credits — those have their own card."}
                  </InfoTooltipContent>
                </InfoTooltip>
              </div>
              <p className="text-sm sm:text-base font-semibold text-foreground leading-tight break-words">
                <CurrencyDisplay amount={totalPayments} />
              </p>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground pt-1">
                {paymentCount} payment{paymentCount === 1 ? "" : "s"} {isVendor ? "made" : "received"}
              </p>
            </div>
            <div className="text-muted-foreground bg-muted/40 dark:bg-muted/30 p-2 sm:p-2.5 rounded-lg inline-flex flex-shrink-0">
              <Banknote className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
            </div>
          </div>
        </div>

        {/* Returns & Refunds — combined card. Returns reduce what the party owes; refunds are
            the cash side of those returns when the customer was given money back. Showing both
            lets users reconcile at a glance without bloating to a 5-card row. */}
        <div className="bg-card/90 backdrop-blur rounded-xl shadow-lg border border-border/70 p-4 sm:p-5 transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">Returns & Refunds</p>
                <InfoTooltip>
                  <InfoTooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground/70 hover:text-foreground transition-colors flex-shrink-0" aria-label="More info">
                      <Info className="w-3 h-3" />
                    </button>
                  </InfoTooltipTrigger>
                  <InfoTooltipContent side="bottom" className="max-w-[260px] text-[11px] leading-relaxed">
                    Returns = goods that came back from the party (credit to their account). Refunds = cash actually paid back to them (debit, clearing the credit balance from the return).
                  </InfoTooltipContent>
                </InfoTooltip>
              </div>
              {returnCount === 0 && refundCount === 0 ? (
                <p className="text-sm sm:text-base font-semibold text-foreground leading-tight">—</p>
              ) : (
                <div className="space-y-0.5 pt-0.5">
                  <div className="flex items-center justify-between gap-2 text-[10px] sm:text-[11px]">
                    <span className="text-muted-foreground">Returns ({returnCount})</span>
                    <span className="font-semibold text-foreground">
                      <CurrencyDisplay amount={totalReturns} />
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10px] sm:text-[11px]">
                    <span className="text-muted-foreground">Refunds ({refundCount})</span>
                    <span className="font-semibold text-foreground">
                      <CurrencyDisplay amount={totalRefunds} />
                    </span>
                  </div>
                </div>
              )}
              {returnCount === 0 && refundCount === 0 && (
                <p className="text-[10px] sm:text-[11px] text-muted-foreground pt-1">No returns or refunds yet</p>
              )}
            </div>
            <div className="text-muted-foreground bg-muted/40 dark:bg-muted/30 p-2 sm:p-2.5 rounded-lg inline-flex flex-shrink-0">
              <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" strokeWidth={1.75} />
            </div>
          </div>
        </div>
      </div>

      {/* Ledger Table */}
      <Card>
        <CardHeader className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base sm:text-lg">Transaction History</CardTitle>
            {/* Transaction-count breadcrumb. The previous version forgot refunds, so the
                breakdown could sum to less than `transactionCount`. This includes every
                row type so the line always reconciles. */}
            <p className="text-xs text-muted-foreground">
              {transactionCount} total · {invoiceOrPurchaseCount} {headlineUnit}{invoiceOrPurchaseCount === 1 ? "" : "s"}
              {" "}· {paymentCount} payment{paymentCount === 1 ? "" : "s"}
              {returnCount > 0 ? ` · ${returnCount} return${returnCount === 1 ? "" : "s"}` : ""}
              {refundCount > 0 ? ` · ${refundCount} refund${refundCount === 1 ? "" : "s"}` : ""}
            </p>
          </div>
          <ExportButtons
            data={ledgerRows.map((row) => ({
              date: new Date(row.date).toLocaleDateString(),
              description: row.description,
              debit: row.debit > 0 ? row.debit : "",
              credit: row.credit > 0 ? row.credit : "",
              balance: row.balance,
            }))}
            columns={[
              { key: "date", header: "Date" },
              { key: "description", header: "Description" },
              { key: "debit", header: "Debit" },
              { key: "credit", header: "Credit" },
              { key: "balance", header: "Balance" },
            ]}
            filename={`${party.name}-ledger-${new Date().toISOString().split("T")[0]}`}
            title={`${party.name} - Transaction History`}
          />
        </CardHeader>
        <CardContent className="p-0 sm:p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[20%]">Date</th>
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[30%]">Description</th>
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[15%] text-right">Debit</th>
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[15%] text-right">Credit</th>
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[20%] text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="[&>tr:not(:last-child)]:border-b">
                {groupedRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted-foreground text-xs sm:text-sm px-4">
                      No transactions found.
                    </td>
                  </tr>
                ) : (
                  groupedRows.map(({ row }, index) => {
                    // All icons in the muted-foreground colour, matching the dashboard /
                    // customer-payments / pos visual language. Returns and refunds keep a
                    // tiny coloured badge on the description text so the row is still scannable
                    // for non-standard transactions without spraying colour across the icons.
                    const icon =
                      row.type === "invoice" || row.type === "purchase" ? (
                        <FileText className="w-4 h-4 text-muted-foreground" strokeWidth={1.75} />
                      ) : row.type === "return" ? (
                        <RotateCcw className="w-4 h-4 text-muted-foreground" strokeWidth={1.75} />
                      ) : row.type === "refund" ? (
                        <RotateCcw className="w-4 h-4 text-muted-foreground" strokeWidth={1.75} />
                      ) : (
                        <CreditCard className="w-4 h-4 text-muted-foreground" strokeWidth={1.75} />
                      )
                    return (
                      <tr
                        key={`${row.type}-${row.reference_id}-${index}`}
                        className="hover:bg-muted/50"
                      >
                        <td className="py-2 sm:py-3 px-2 sm:px-4 text-foreground text-xs sm:text-sm w-[20%]">
                          <div className="flex flex-col">
                            <span>{new Date(row.date).toLocaleDateString()}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(row.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 sm:py-3 px-2 sm:px-4 text-foreground text-xs sm:text-sm w-[30%]">
                          <div className="flex items-center gap-2">
                            {icon}
                            <span>{row.description}</span>
                            {row.type === "return" && (
                              <Badge variant="outline" className="text-[9px] uppercase tracking-wider">Return</Badge>
                            )}
                            {row.type === "refund" && (
                              <Badge variant="outline" className="text-[9px] uppercase tracking-wider">Refund</Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-2 sm:py-3 px-2 sm:px-4 text-right text-xs sm:text-sm w-[15%]">
                          {row.debit > 0 ? <CurrencyDisplay amount={row.debit} /> : "—"}
                        </td>
                        <td className="py-2 sm:py-3 px-2 sm:px-4 text-right text-xs sm:text-sm w-[15%]">
                          {row.credit > 0 ? <CurrencyDisplay amount={row.credit} /> : "—"}
                        </td>
                        <td
                          className={`py-2 sm:py-3 px-2 sm:px-4 text-right text-xs sm:text-sm font-medium w-[20%] ${
                            isVendor
                              ? row.balance > 0 ? "text-red-600" : row.balance < 0 ? "text-emerald-600" : "text-foreground"
                              : row.balance > 0 ? "text-amber-600" : row.balance < 0 ? "text-red-600" : "text-foreground"
                          }`}
                        >
                          <CurrencyDisplay amount={row.balance} />
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
