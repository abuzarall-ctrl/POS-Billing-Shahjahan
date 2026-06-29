import sql from "@/lib/db"
import { Dashboard } from "@/components/dashboard"
import { requirePrivilege } from "@/lib/auth/privileges"
import { getSessionOrRedirect } from "@/lib/auth"
import { getAllSettings } from "@/app/(app)/settings/actions"

function getPKTStart(period: string): Date {
  const now = new Date()
  const pkt = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Karachi" }))
  if (period === "today") {
    pkt.setHours(0, 0, 0, 0)
  } else if (period === "week") {
    // Week starts Monday: Sun=0→go back 6, Mon=1→0, Tue=2→1, ...
    const day = pkt.getDay()
    const daysBack = day === 0 ? 6 : day - 1
    pkt.setDate(pkt.getDate() - daysBack)
    pkt.setHours(0, 0, 0, 0)
  } else if (period === "year") {
    pkt.setMonth(0, 1)
    pkt.setHours(0, 0, 0, 0)
  } else {
    pkt.setDate(1)
    pkt.setHours(0, 0, 0, 0)
  }
  return pkt
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; dateFrom?: string; dateTo?: string }>
}) {
  await requirePrivilege("dashboard")
  const { period = "month", dateFrom, dateTo } = await searchParams

  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  const isCustomRange = !!(dateFrom && dateTo)
  const periodStart = isCustomRange
    ? new Date(dateFrom + "T00:00:00+05:00").toISOString()
    : getPKTStart(period).toISOString()
  const periodEnd = isCustomRange
    ? new Date(dateTo + "T23:59:59+05:00").toISOString()
    : undefined

  // SET-L10: read the global low-stock threshold setting in parallel with the rest of the
  // dashboard queries. Falls back to 10 (the form default) when unset. Items with no
  // per-item minimum_stock will use this as their threshold below.
  const settingsPromise = getAllSettings()

  const invoiceStatuses = ["Paid", "Pending", "Credit", "Partially Returned"]
  const receivableStatuses = ["Credit", "Pending", "Partially Returned"]

  const [
    parties,
    inventoryRaw,
    invoices,
    lowStockRaw,
    receivableInvoices,
  ] = await Promise.all([
    sql`
      SELECT id, name, type
      FROM parties
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `,

    sql`
      SELECT id, stock, cost_price
      FROM inventory_items
      WHERE user_id = ${userId}
      ORDER BY stock DESC
      LIMIT 10
    `,

    sql`
      SELECT id, total, subtotal, status, created_at
      FROM sales_invoices
      WHERE user_id = ${userId}
        AND created_at >= ${periodStart}
        AND status = ANY(${invoiceStatuses})
        ${periodEnd ? sql`AND created_at <= ${periodEnd}` : sql``}
      LIMIT 500
    `,

    // SET-L10: low-stock query no longer restricts to `minimum_stock > 0`. Items with no
    // per-item minimum fall back to the configured global low_stock_threshold setting,
    // applied client-side below. The previous filter silently dropped any item without an
    // individual minimum — meaning a fresh install never showed ANY low-stock warnings.
    sql`
      SELECT id, name, stock, minimum_stock
      FROM inventory_items
      WHERE user_id = ${userId} AND is_archived = false
    `,

    // Outstanding receivables — all-time snapshot, NOT period-filtered.
    // A receivable from January is still owed in May regardless of which period the user views.
    // "Partially Returned" must be included: those invoices still have an unreturned-and-unpaid balance.
    sql`
      SELECT id, total
      FROM sales_invoices
      WHERE user_id = ${userId}
        AND status = ANY(${receivableStatuses})
    `,
  ])

  // Outstanding receivables = sum of max(0, total - paid - returned) for each open invoice.
  // - paid:     payments table sum
  // - returned: completed sale returns linked to the invoice (goods came back, balance reduces)
  //             without this subtraction, a partially-returned credit invoice overstates what
  //             the customer actually owes — the bug that made Outstanding > Total Sales.
  let outstandingReceivables = 0
  const receivableIds = receivableInvoices
    .map((row) => (row as { id?: string }).id)
    .filter((id): id is string => Boolean(id))
  const paidByInvoice = new Map<string, number>()
  const returnedByInvoice = new Map<string, number>()

  if (receivableIds.length > 0) {
    const [receivablePayments, invoiceReturns] = await Promise.all([
      sql`
        SELECT invoice_id, amount FROM payments
        WHERE invoice_id = ANY(${receivableIds})
      `,
      sql`
        SELECT sales_invoice_id, total FROM returns
        WHERE type = 'sale'
          AND status = 'Completed'
          AND sales_invoice_id = ANY(${receivableIds})
      `,
    ])

    for (const payment of receivablePayments) {
      const invId = (payment as { invoice_id?: string }).invoice_id
      if (!invId) continue
      const amount = Number((payment as { amount?: number }).amount ?? 0)
      paidByInvoice.set(invId, (paidByInvoice.get(invId) ?? 0) + amount)
    }
    for (const ret of invoiceReturns) {
      const invId = (ret as { sales_invoice_id?: string }).sales_invoice_id
      if (!invId) continue
      const amount = Number((ret as { total?: number }).total ?? 0)
      returnedByInvoice.set(invId, (returnedByInvoice.get(invId) ?? 0) + amount)
    }
  }

  for (const inv of receivableInvoices) {
    const total = Number((inv as { total?: number }).total ?? 0)
    const id = (inv as { id?: string }).id ?? ""
    const paid = paidByInvoice.get(id) ?? 0
    const returned = returnedByInvoice.get(id) ?? 0
    outstandingReceivables += Math.max(0, total - paid - returned)
  }

  // Gross profit calculation
  // NOTE: When cost_price is NULL (missing data), we assume break-even (cost = selling)
  // to avoid inflating profit. Run the cost_price backfill SQL to fix old line items.
  let grossProfit = 0
  let totalSalesForPeriod = 0
  const invoiceIds = invoices.map((inv) => (inv as any).id).filter(Boolean) as string[]

  // Top 10 products by quantity + top 10 by revenue — single query, grouped in JS.
  let topProductsByQty: Array<{ name: string; qty: number }> = []
  let topSellersByRevenue: Array<{ name: string; revenue: number }> = []

  if (invoiceIds.length > 0) {
    const lines = await sql`
      SELECT sil.quantity, sil.unit_price, sil.cost_price, sil.line_total, sil.item_id, ii.name AS item_name
      FROM sales_invoice_lines sil
      INNER JOIN inventory_items ii ON ii.id = sil.item_id
      WHERE sil.invoice_id = ANY(${invoiceIds})
    `
    const _productQtyMap: Record<string, { name: string; qty: number }> = {}
    const _sellerRevMap: Record<string, { name: string; revenue: number }> = {}
    for (const line of lines) {
      const qty = Number((line as any).quantity || 0)
      const selling = Number((line as any).unit_price ?? 0)
      const rawCost = (line as any).cost_price
      // If cost_price is NULL/undefined, fall back to selling (assume break-even, 0% profit)
      const cost = rawCost === null || rawCost === undefined ? selling : Number(rawCost)
      totalSalesForPeriod += selling * qty
      grossProfit += (selling - cost) * qty

      // Accumulate top products (by qty) and top sellers (by revenue)
      const itemId = (line as any).item_id as string
      const itemName = (line as any).item_name ?? "Unknown"
      const lineRev = Number((line as any).line_total ?? selling * qty)
      if (itemId) {
        if (!_productQtyMap[itemId]) _productQtyMap[itemId] = { name: itemName, qty: 0 }
        _productQtyMap[itemId].qty += qty
        if (!_sellerRevMap[itemId]) _sellerRevMap[itemId] = { name: itemName, revenue: 0 }
        _sellerRevMap[itemId].revenue += lineRev
      }
    }

    topProductsByQty = Object.values(_productQtyMap)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10)
    topSellersByRevenue = Object.values(_sellerRevMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
  }

  // Subtract returns from sales/profit — but ONLY returns linked to invoices that are
  // already in our filter. Otherwise we double-deduct: a fully Returned invoice's lines
  // are excluded by the status filter (so they were never added to totalSalesForPeriod),
  // and naively subtracting its return on top would push the total below zero. Tying the
  // returns query to invoiceIds keeps the math symmetric.
  let saleReturns: Array<{ id: string; subtotal: number; sales_invoice_id: string }> = []
  if (invoiceIds.length > 0) {
    const data = await sql`
      SELECT id, subtotal, sales_invoice_id FROM returns
      WHERE user_id = ${userId}
        AND type = 'sale'
        AND status = 'Completed'
        AND sales_invoice_id = ANY(${invoiceIds})
    `
    saleReturns = data as typeof saleReturns
  }

  const returnIds = saleReturns.map((r) => r.id)
  if (returnIds.length > 0) {
    const returnLines = await sql`
      SELECT quantity, unit_price, sales_invoice_line_id FROM return_lines
      WHERE return_id = ANY(${returnIds})
    `

    const origLineIds = returnLines
      .map((rl) => (rl as any).sales_invoice_line_id)
      .filter(Boolean) as string[]
    let costMap: Record<string, number | null> = {}
    if (origLineIds.length > 0) {
      const origLines = await sql`
        SELECT id, cost_price FROM sales_invoice_lines WHERE id = ANY(${origLineIds})
      `
      ;(origLines as any[]).forEach((l: any) => {
        costMap[l.id] = l.cost_price === null || l.cost_price === undefined ? null : Number(l.cost_price)
      })
    }

    for (const rl of returnLines) {
      const qty = Number((rl as any).quantity || 0)
      const selling = Number((rl as any).unit_price || 0)
      // Same fallback as above — if original line has no cost_price, assume break-even
      const origLineId = (rl as any).sales_invoice_line_id
      const mappedCost = origLineId ? costMap[origLineId] : undefined
      const cost = mappedCost === null || mappedCost === undefined ? selling : mappedCost
      totalSalesForPeriod -= selling * qty
      grossProfit -= (selling - cost) * qty
    }
  }

  // Keep 2 decimal places so very thin margins (e.g. 0.26%) don't get rounded down to 0%
  const grossProfitPercent = totalSalesForPeriod > 0
    ? Math.round((grossProfit / totalSalesForPeriod) * 10000) / 100
    : 0

  // Split gross profit into "realized" (on actually-received money) and "at risk" (on unpaid sales)
  // for the period. We use the period invoices' total vs payments to compute the realized fraction.
  // This is an approximation that assumes uniform margin across paid/unpaid lines — accurate enough
  // for a dashboard indicator, and avoids re-aggregating per-line payment data.
  let realizedProfit = grossProfit
  let profitAtRisk = 0
  const periodInvoiceIds = invoices
    .map((inv) => (inv as { id?: string }).id)
    .filter((id): id is string => Boolean(id))
  if (periodInvoiceIds.length > 0) {
    const periodPayments = await sql`
      SELECT invoice_id, amount FROM payments
      WHERE invoice_id = ANY(${periodInvoiceIds})
    `
    const periodPaidByInvoice = new Map<string, number>()
    for (const payment of periodPayments) {
      const invId = (payment as { invoice_id?: string }).invoice_id
      if (!invId) continue
      const amount = Number((payment as { amount?: number }).amount ?? 0)
      periodPaidByInvoice.set(invId, (periodPaidByInvoice.get(invId) ?? 0) + amount)
    }

    let periodInvoicedSum = 0
    let periodPaidSum = 0
    for (const inv of invoices) {
      const total = Number((inv as { total?: number }).total ?? 0)
      const id = (inv as { id?: string }).id ?? ""
      const paid = Math.min(periodPaidByInvoice.get(id) ?? 0, total)
      periodInvoicedSum += total
      periodPaidSum += paid
    }

    if (periodInvoicedSum > 0) {
      const realizedRatio = periodPaidSum / periodInvoicedSum
      realizedProfit = grossProfit * realizedRatio
      profitAtRisk = grossProfit - realizedProfit
    }
  }

  // SET-L10: items with a per-item minimum_stock use that as their threshold; items without
  // one fall back to the configured global low_stock_threshold setting (default 10). The
  // server-side filter no longer drops items that lack a per-item minimum.
  const appSettings = await settingsPromise
  const globalLowStockThreshold = Math.max(0, Number(appSettings.low_stock_threshold ?? 10))
  const lowStockItems = lowStockRaw.filter((item) => {
    const itemMin = Number((item as any).minimum_stock || 0)
    const threshold = itemMin > 0 ? itemMin : globalLowStockThreshold
    return threshold > 0 && Number((item as any).stock) <= threshold
  })

  const normalizedInventory = inventoryRaw.map((item) => ({
    id: (item as any).id,
    stock: (item as any).stock,
    unitPrice: (item as any).cost_price ?? (item as any).unit_price ?? 0,
  }))

  const normalizedInvoices = invoices.map((inv) => ({
    totalAmount: (inv as any).total ?? 0,
    status: (inv as any).status ?? "Draft",
  }))

  // Total Sales = subtotal of realized sales minus returns, matching gross profit denominator
  const totalSales = totalSalesForPeriod

  // Group invoices by date (day for non-year periods, month for year)
  const salesAccumulator: Record<string, number> = {}
  for (const inv of invoices) {
    if (!(inv as any).created_at) continue
    const pktDate = new Date(new Date((inv as any).created_at).getTime() + 5 * 60 * 60 * 1000)
    const key = period === "year"
      ? pktDate.toISOString().substring(0, 7)
      : pktDate.toISOString().split("T")[0]
    salesAccumulator[key] = (salesAccumulator[key] ?? 0) + ((inv as any).total ?? 0)
  }
  const dailySales = Object.entries(salesAccumulator)
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return (
    <Dashboard
      parties={parties as any[]}
      inventory={normalizedInventory}
      invoices={normalizedInvoices}
      totalSales={totalSales}
      grossProfit={grossProfit}
      grossProfitPercent={grossProfitPercent}
      realizedProfit={realizedProfit}
      profitAtRisk={profitAtRisk}
      outstandingReceivables={outstandingReceivables}
      period={period}
      lowStockItems={lowStockItems.map((i) => {
        // SET-L10: surface the effective threshold (per-item OR global fallback) so the
        // dashboard "Below minimum_stock" text matches the rule that flagged the item.
        const itemMin = Number((i as any).minimum_stock || 0)
        const effectiveMin = itemMin > 0 ? itemMin : globalLowStockThreshold
        return { id: (i as any).id, name: (i as any).name, stock: Number((i as any).stock), minimum_stock: effectiveMin }
      })}
      dailySales={dailySales}
      topProductsByQty={topProductsByQty}
      topSellersByRevenue={topSellersByRevenue}
      dateFrom={dateFrom}
      dateTo={dateTo}
    />
  )
}
