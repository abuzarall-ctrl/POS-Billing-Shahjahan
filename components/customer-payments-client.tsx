"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"
import { CurrencyDisplay } from "@/components/currency-display"
import { DeleteCustomerPaymentButton } from "@/components/delete-customer-payment-button"
import { ExportButtons } from "@/components/export-buttons"

interface OutstandingEntry {
  name: string
  balance: number
  invoices: number
}

interface PaidSale {
  id: string
  invoiceNumber: string
  customerName: string
  total: number
  paid: number
  balance: number
  date: string | null
  status: string
}

interface Payment {
  id: string
  invoiceNumber: string
  customerName: string
  amount: number | string
  method: string
  createdAt: string
}

interface CustomerPaymentsClientProps {
  outstandingList: OutstandingEntry[]
  paidSales: PaidSale[]
  payments: Payment[]
}

export function CustomerPaymentsClient({
  outstandingList,
  paidSales,
  payments,
}: CustomerPaymentsClientProps) {
  const [outstandingSearch, setOutstandingSearch] = useState("")
  const [paidSearch, setPaidSearch] = useState("")
  const [paymentSearch, setPaymentSearch] = useState("")

  const filteredOutstanding = outstandingList.filter((c) =>
    c.name.toLowerCase().includes(outstandingSearch.toLowerCase()),
  )

  const filteredPaidSales = paidSales.filter(
    (s) =>
      s.customerName?.toLowerCase().includes(paidSearch.toLowerCase()) ||
      s.invoiceNumber?.toLowerCase().includes(paidSearch.toLowerCase()),
  )

  const filteredPayments = payments.filter(
    (p) =>
      p.customerName?.toLowerCase().includes(paymentSearch.toLowerCase()) ||
      p.invoiceNumber?.toLowerCase().includes(paymentSearch.toLowerCase()),
  )

  return (
    <>
      {/* Outstanding by Customer */}
      {outstandingList.length > 0 && (
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <CardTitle className="text-base sm:text-lg">Outstanding by Customer</CardTitle>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search customer…"
                  value={outstandingSearch}
                  onChange={(e) => setOutstandingSearch(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 sm:p-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 sm:py-3 px-4 text-xs sm:text-sm">Customer</th>
                    <th className="py-2 sm:py-3 px-4 text-xs sm:text-sm text-right">Invoices</th>
                    <th className="py-2 sm:py-3 px-4 text-xs sm:text-sm text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody className="[&>tr:not(:last-child)]:border-b">
                  {filteredOutstanding.length > 0 ? (
                    filteredOutstanding.map((c) => (
                      <tr key={c.name} className="hover:bg-muted/50">
                        <td className="py-2 sm:py-3 px-4 font-medium text-xs sm:text-sm">{c.name}</td>
                        <td className="py-2 sm:py-3 px-4 text-xs sm:text-sm text-right text-muted-foreground">
                          {c.invoices}
                        </td>
                        <td className="py-2 sm:py-3 px-4 text-xs sm:text-sm text-right font-semibold text-amber-600 dark:text-amber-400">
                          <CurrencyDisplay amount={c.balance} />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-muted-foreground text-xs sm:text-sm px-4">
                        No customers match your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Paid Sales */}
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-base sm:text-lg">Paid Sales</CardTitle>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search customer or invoice…"
                value={paidSearch}
                onChange={(e) => setPaidSearch(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 sm:p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[15%]">Invoice</th>
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm hidden sm:table-cell w-[20%]">Customer</th>
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[12%]">Total</th>
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[12%]">Paid</th>
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[12%]">Balance</th>
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm hidden sm:table-cell w-[15%]">Date</th>
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[14%]">Status</th>
                </tr>
              </thead>
              <tbody className="[&>tr:not(:last-child)]:border-b">
                {filteredPaidSales.length > 0 ? (
                  filteredPaidSales.map((sale) => (
                    <tr key={sale.id} className="hover:bg-muted/50">
                      <td className="py-2 sm:py-3 px-2 sm:px-4 font-medium text-foreground text-xs sm:text-sm w-[15%]">
                        <div className="flex flex-col min-w-0 overflow-hidden">
                          <span className="truncate break-words">{sale.invoiceNumber}</span>
                          <span className="text-[10px] text-muted-foreground sm:hidden truncate">
                            {sale.customerName}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 sm:py-3 px-2 sm:px-4 text-foreground text-xs sm:text-sm hidden sm:table-cell w-[20%]">
                        <span className="truncate block">{sale.customerName}</span>
                      </td>
                      <td className="py-2 sm:py-3 px-2 sm:px-4 text-foreground text-xs sm:text-sm w-[12%]">
                        <span className="truncate block">
                          <CurrencyDisplay amount={sale.total} />
                        </span>
                      </td>
                      <td className="py-2 sm:py-3 px-2 sm:px-4 font-semibold text-emerald-600 text-xs sm:text-sm w-[12%]">
                        <span className="truncate block">
                          <CurrencyDisplay amount={sale.paid} />
                        </span>
                      </td>
                      <td className="py-2 sm:py-3 px-2 sm:px-4 text-foreground text-xs sm:text-sm w-[12%]">
                        <span className={`truncate block ${sale.balance > 0 ? "text-red-600" : "text-emerald-600"}`}>
                          <CurrencyDisplay amount={sale.balance} />
                        </span>
                      </td>
                      <td className="py-2 sm:py-3 px-2 sm:px-4 text-foreground text-xs sm:text-sm hidden sm:table-cell w-[15%]">
                        <span className="truncate block">
                          {sale.date ? new Date(sale.date).toLocaleDateString() : "—"}
                        </span>
                      </td>
                      <td className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[14%]">
                        <Badge
                          variant={sale.balance === 0 ? "default" : "outline"}
                          className="text-[10px] sm:text-xs whitespace-nowrap"
                        >
                          {sale.balance === 0 ? "Fully Paid" : "Partial"}
                        </Badge>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted-foreground text-xs sm:text-sm px-4">
                      {paidSales.length === 0 ? "No paid sales yet." : "No results match your search."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Payment History */}
      <Card>
        <CardHeader className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
            <CardTitle className="text-base sm:text-lg shrink-0">Payment History</CardTitle>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search customer or invoice…"
                value={paymentSearch}
                onChange={(e) => setPaymentSearch(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
          </div>
          <ExportButtons
            data={payments.map((payment) => ({
              invoice: payment.invoiceNumber,
              customer: payment.customerName,
              amount: payment.amount,
              method: payment.method,
              date: new Date(payment.createdAt).toLocaleDateString(),
            }))}
            columns={[
              { key: "invoice", header: "Invoice" },
              { key: "customer", header: "Customer" },
              { key: "amount", header: "Amount" },
              { key: "method", header: "Method" },
              { key: "date", header: "Date" },
            ]}
            filename={`customer-payments-${new Date().toISOString().split("T")[0]}`}
            title="Customer Payments"
          />
        </CardHeader>
        <CardContent className="p-0 sm:p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[15%]">Invoice</th>
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm hidden sm:table-cell w-[20%]">Customer</th>
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[15%]">Amount</th>
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm hidden sm:table-cell w-[15%]">Method</th>
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm hidden sm:table-cell w-[15%]">Date</th>
                  <th className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm w-[10%]">Actions</th>
                </tr>
              </thead>
              <tbody className="[&>tr:not(:last-child)]:border-b">
                {filteredPayments.length > 0 ? (
                  filteredPayments.map((payment) => (
                    <tr key={payment.id} className="hover:bg-muted/50">
                      <td className="py-2 sm:py-3 px-2 sm:px-4 font-medium text-foreground text-xs sm:text-sm w-[15%]">
                        <div className="flex flex-col min-w-0 overflow-hidden">
                          <span className="truncate break-words">{payment.invoiceNumber}</span>
                          <span className="text-[10px] text-muted-foreground sm:hidden truncate">
                            {payment.customerName}
                          </span>
                          <span className="text-[10px] text-muted-foreground sm:hidden truncate">
                            {payment.method}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 sm:py-3 px-2 sm:px-4 text-foreground text-xs sm:text-sm hidden sm:table-cell w-[20%]">
                        <span className="truncate block">{payment.customerName}</span>
                      </td>
                      <td className="py-2 sm:py-3 px-2 sm:px-4 font-semibold text-foreground text-xs sm:text-sm w-[15%]">
                        <span className="truncate block">
                          <CurrencyDisplay amount={Number(payment.amount || 0)} />
                        </span>
                      </td>
                      <td className="py-2 sm:py-3 px-2 sm:px-4 text-foreground text-xs sm:text-sm hidden sm:table-cell w-[15%]">
                        <Badge variant="outline" className="text-[10px] sm:text-xs whitespace-nowrap">
                          {payment.method}
                        </Badge>
                      </td>
                      <td className="py-2 sm:py-3 px-2 sm:px-4 text-foreground text-xs sm:text-sm hidden sm:table-cell w-[15%]">
                        <span className="truncate block">
                          {payment.createdAt ? new Date(payment.createdAt).toLocaleDateString() : "—"}
                        </span>
                      </td>
                      <td className="py-2 sm:py-3 px-2 sm:px-4 w-[10%]">
                        <DeleteCustomerPaymentButton paymentId={payment.id} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-muted-foreground text-xs sm:text-sm px-4">
                      {payments.length === 0
                        ? "No payments yet. Add your first payment to see it here."
                        : "No results match your search."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
