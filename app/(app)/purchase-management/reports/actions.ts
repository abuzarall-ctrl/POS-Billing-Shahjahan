"use server"

import sql from "@/lib/db"
import { getSessionOrRedirect } from "@/lib/auth"
import { getPurchases } from "@/app/(app)/purchases/actions"
import { getAllPurchasePayments } from "@/app/(app)/purchases/actions"

export async function getPurchaseSummary() {
  const purchasesResult = await getPurchases()
  const purchases = purchasesResult.data || []

  const paymentsResult = await getAllPurchasePayments()
  const payments = paymentsResult.data || []

  const totalPurchases = purchases
    .filter((p) => p.status !== "Cancelled")
    .reduce((sum, p) => sum + Number(p.total || 0), 0)

  const totalPayments = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0)

  const outstandingPayables = totalPurchases - totalPayments
  const totalPurchaseCount = purchases.filter((p) => p.status !== "Cancelled").length

  return { totalPurchases, totalPayments, outstandingPayables, totalPurchaseCount }
}

export async function getPurchaseTrends(dateFrom?: string, dateTo?: string) {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{ id: string; total: string; created_at: string; status: string }[]>`
      SELECT id, total, created_at, status
      FROM purchase_invoices
      WHERE user_id = ${currentUser.effectiveUserId}
        ${dateFrom ? sql`AND created_at >= ${dateFrom}` : sql``}
        ${dateTo ? sql`AND created_at <= ${dateTo}` : sql``}
      ORDER BY created_at DESC
    `

    const trends: Record<string, { count: number; total: number }> = {}
    for (const purchase of rows) {
      if (purchase.status === "Cancelled") continue
      const date = new Date(purchase.created_at).toISOString().split("T")[0]
      if (!trends[date]) trends[date] = { count: 0, total: 0 }
      trends[date].count++
      trends[date].total += Number(purchase.total || 0)
    }

    const trendsArray = Object.entries(trends)
      .map(([date, data]) => ({ date, count: data.count, total: data.total }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 30)

    return { error: null, data: trendsArray }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to fetch trends", data: [] }
  }
}

export async function getTopVendors(limit: number = 10) {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{ id: string; total: string; party_id: string; party_name: string | null }[]>`
      SELECT pi.id, pi.total, pi.party_id, p.name AS party_name
      FROM purchase_invoices pi
      LEFT JOIN parties p ON p.id = pi.party_id
      WHERE pi.user_id = ${currentUser.effectiveUserId}
      ORDER BY pi.created_at DESC
    `

    const vendorMap: Record<string, { name: string; count: number; total: number }> = {}
    for (const row of rows) {
      const vendorId = row.party_id || ""
      const vendorName = row.party_name || "Unknown"
      if (!vendorMap[vendorId]) vendorMap[vendorId] = { name: vendorName, count: 0, total: 0 }
      vendorMap[vendorId].count++
      vendorMap[vendorId].total += Number(row.total || 0)
    }

    const topVendors = Object.values(vendorMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, limit)
      .map((vendor, index) => ({
        rank: index + 1,
        name: vendor.name,
        purchaseCount: vendor.count,
        totalAmount: vendor.total,
      }))

    return { error: null, data: topVendors }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to fetch top vendors", data: [] }
  }
}

export async function getPurchasePaymentSummary() {
  const purchasesResult = await getPurchases()
  const purchases = purchasesResult.data || []

  const paymentsResult = await getAllPurchasePayments()
  const payments = paymentsResult.data || []

  const paymentMap: Record<string, number> = {}
  payments.forEach((payment) => {
    const purchaseId = payment.purchaseInvoiceId
    if (!paymentMap[purchaseId]) paymentMap[purchaseId] = 0
    paymentMap[purchaseId] += Number(payment.amount || 0)
  })

  const summary = purchases
    .filter((p) => p.status !== "Cancelled")
    .map((purchase) => {
      const paymentRecordAmount = paymentMap[purchase.id] || 0
      const totalAmount = Number(purchase.total || 0)
      const purchaseStatus = purchase.status || "Draft"

      let paidAmount: number
      let outstanding: number
      let status: string

      if (purchaseStatus === "Paid") {
        paidAmount = totalAmount
        outstanding = 0
        status = "Paid"
      } else {
        paidAmount = paymentRecordAmount
        outstanding = totalAmount - paidAmount
        if (outstanding <= 0) status = "Paid"
        else if (outstanding === totalAmount) status = "Unpaid"
        else status = "Partial"
      }

      return {
        purchaseId: purchase.id,
        purchaseNumber: purchase.purchaseNumber,
        vendorName: purchase.vendorName,
        totalAmount,
        paidAmount,
        outstanding,
        status,
      }
    })
    .sort((a, b) => b.outstanding - a.outstanding)

  return { error: null, data: summary }
}
