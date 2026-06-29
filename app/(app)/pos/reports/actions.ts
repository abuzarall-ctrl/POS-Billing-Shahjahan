"use server"

import { getSessionOrRedirect } from "@/lib/auth"
import sql from "@/lib/db"
import { getPurchases } from "@/app/(app)/purchases/actions"
import { getAllPurchasePayments } from "@/app/(app)/purchases/actions"

export interface GrossProfitRow {
  item_id: string
  barcode: string | null
  item_name: string
  total_sale_qty: number
  avg_price: number
  sale_amount: number
  purchase_price: number
  purchase_amount: number
  gp_value: number
  gp_pct_purchase: number
  gp_pct_sale: number
}

export interface GrossProfitSummary {
  total_sale_amount: number
  total_purchase_amount: number
  total_gp_value: number
  overall_gp_pct: number
}

export interface GrossProfitResult {
  rows: GrossProfitRow[]
  summary: GrossProfitSummary
}

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
    const rows = await sql<{
      id: string; total: string; party_id: string; party_name: string | null
    }[]>`
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

export async function getGrossProfitReport(
  dateFrom?: string,
  dateTo?: string,
  timeFrom?: string,
  timeTo?: string,
): Promise<GrossProfitResult> {
  const empty: GrossProfitResult = {
    rows: [],
    summary: { total_sale_amount: 0, total_purchase_amount: 0, total_gp_value: 0, overall_gp_pct: 0 },
  }

  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  const fromTime = timeFrom || "09:00"
  const toTime = timeTo || "23:59"

  try {
    const invoices = await sql<{ id: string }[]>`
      SELECT id FROM sales_invoices
      WHERE user_id = ${userId}
        AND source = 'pos'
        AND status = ANY(ARRAY['Paid','Pending','Credit','Partially Returned'])
        ${dateFrom ? sql`AND created_at >= ${dateFrom.includes("T") ? dateFrom : `${dateFrom}T${fromTime}:00+05:00`}` : sql``}
        ${dateTo ? sql`AND created_at <= ${dateTo.includes("T") ? dateTo : `${dateTo}T${toTime}:59+05:00`}` : sql``}
    `

    if (!invoices.length) return empty

    const invoiceIds = invoices.map((i) => i.id)

    const lines = await sql<{
      id: string; item_id: string; quantity: string; line_total: string; cost_price: string | null
      item_name: string | null; barcode: string | null
    }[]>`
      SELECT sil.id, sil.item_id, sil.quantity, sil.line_total, sil.cost_price,
             ii.name AS item_name, ii.barcode
      FROM sales_invoice_lines sil
      LEFT JOIN inventory_items ii ON ii.id = sil.item_id
      WHERE sil.invoice_id = ANY(${invoiceIds})
    `

    if (!lines.length) return empty

    type Bucket = {
      item_id: string; barcode: string | null; item_name: string
      total_qty: number; total_line_total: number; total_cost_amount: number
    }
    const grouped = new Map<string, Bucket>()
    const costBySalesLine = new Map<string, number>()

    for (const line of lines) {
      const itemId = line.item_id
      const qty = Number(line.quantity ?? 0)
      const lineTotal = Number(line.line_total ?? 0)
      const unitPrice = qty > 0 ? lineTotal / qty : 0
      const rawCost = line.cost_price
      const unitCost = rawCost === null || rawCost === undefined ? unitPrice : Number(rawCost)
      const lineCostAmount = unitCost * qty

      if (line.id) costBySalesLine.set(line.id, unitCost)

      const existing = grouped.get(itemId)
      if (existing) {
        existing.total_qty += qty
        existing.total_line_total += lineTotal
        existing.total_cost_amount += lineCostAmount
      } else {
        grouped.set(itemId, {
          item_id: itemId,
          barcode: line.barcode ?? null,
          item_name: line.item_name ?? "Unknown",
          total_qty: qty,
          total_line_total: lineTotal,
          total_cost_amount: lineCostAmount,
        })
      }
    }

    const relatedReturns = await sql<{ id: string }[]>`
      SELECT id FROM returns
      WHERE user_id = ${userId} AND type = 'sale' AND status = 'Completed'
        AND sales_invoice_id = ANY(${invoiceIds})
    `

    const returnIds = relatedReturns.map((r) => r.id)
    if (returnIds.length > 0) {
      const returnLines = await sql<{
        item_id: string; quantity: string; line_total: string; sales_invoice_line_id: string | null
      }[]>`
        SELECT item_id, quantity, line_total, sales_invoice_line_id
        FROM return_lines WHERE return_id = ANY(${returnIds})
      `

      for (const rl of returnLines) {
        const itemId = rl.item_id
        if (!itemId || !grouped.has(itemId)) continue
        const qty = Number(rl.quantity ?? 0)
        const lineTotal = Number(rl.line_total ?? 0)
        const origUnitCost = rl.sales_invoice_line_id ? costBySalesLine.get(rl.sales_invoice_line_id) ?? 0 : 0
        const costAmount = origUnitCost * qty

        const bucket = grouped.get(itemId)!
        bucket.total_qty -= qty
        bucket.total_line_total -= lineTotal
        bucket.total_cost_amount -= costAmount
      }
    }

    const rows: GrossProfitRow[] = Array.from(grouped.values())
      .filter((g) => g.total_qty > 0 || g.total_line_total !== 0 || g.total_cost_amount !== 0)
      .map((g) => {
        const total_sale_qty = g.total_qty
        const sale_amount = g.total_line_total
        const purchase_amount = g.total_cost_amount
        const avg_price = total_sale_qty > 0 ? sale_amount / total_sale_qty : 0
        const purchase_price = total_sale_qty > 0 ? purchase_amount / total_sale_qty : 0
        const gp_value = sale_amount - purchase_amount
        const gp_pct_purchase = purchase_amount > 0 ? (gp_value / purchase_amount) * 100 : 0
        const gp_pct_sale = sale_amount > 0 ? (gp_value / sale_amount) * 100 : 0
        return {
          item_id: g.item_id, barcode: g.barcode, item_name: g.item_name,
          total_sale_qty, avg_price, sale_amount, purchase_price, purchase_amount,
          gp_value, gp_pct_purchase, gp_pct_sale,
        }
      })
      .sort((a, b) => b.gp_value - a.gp_value)

    const total_sale_amount = rows.reduce((sum, r) => sum + r.sale_amount, 0)
    const total_purchase_amount = rows.reduce((sum, r) => sum + r.purchase_amount, 0)
    const total_gp_value = total_sale_amount - total_purchase_amount
    const overall_gp_pct = total_sale_amount > 0 ? (total_gp_value / total_sale_amount) * 100 : 0

    return { rows, summary: { total_sale_amount, total_purchase_amount, total_gp_value, overall_gp_pct } }
  } catch {
    return empty
  }
}
