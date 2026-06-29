"use server"

import sql from "@/lib/db"
import { getPartyBalances } from "@/app/(app)/parties/actions"
import { getSessionOrRedirect } from "@/lib/auth"

export interface AccountsOverview {
  totalReceivables: number
  totalPayables: number
  totalSales: number
  totalPurchases: number
  totalCustomerPayments: number
  totalVendorPayments: number
  customerCount: number
  vendorCount: number
}

export interface LedgerRow {
  date: string
  description: string
  debit: number
  credit: number
  type: "sale" | "purchase" | "payment" | "customer" | "vendor"
  reference_id: string
  party_id?: string
  party_name?: string
}

export interface PartyLedgerSummary {
  id: string
  name: string
  phone: string
  balance: number
  type: "Customer" | "Vendor"
}

export interface AccountsReport {
  receivables: PartyLedgerSummary[]
  payables: PartyLedgerSummary[]
  totalReceivables: number
  totalPayables: number
}

export type CashBookCategory = "SALE" | "RECV" | "PAID" | "REFUND" | "PUR-RET"

export interface CashBookEntry {
  id: string
  time: string
  description: string
  party_name: string
  category: CashBookCategory
  amount: number
  direction: "in" | "out"
  running_balance: number
}

export interface CashBookData {
  opening_balance: number
  opening_balance_is_override: boolean
  cash_in: number
  cash_out: number
  closing_balance: number
  entries: CashBookEntry[]
  date_from: string
  date_to: string
}

export async function getAccountsOverview(): Promise<{ error: string | null; data: AccountsOverview | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    const parties = await sql<{ id: string; type: string }[]>`
      SELECT id, type FROM parties WHERE user_id = ${userId}
    `
    const salesInvoices = await sql<{ id: string; party_id: string; total: string; status: string }[]>`
      SELECT id, party_id, total, status FROM sales_invoices WHERE user_id = ${userId}
    `
    const customerPayments = await sql<{ invoice_id: string; amount: string }[]>`
      SELECT invoice_id, amount FROM payments WHERE user_id = ${userId}
    `
    const purchaseInvoices = await sql<{ id: string; party_id: string; total: string; status: string }[]>`
      SELECT id, party_id, total, status FROM purchase_invoices WHERE user_id = ${userId}
    `
    const vendorPayments = await sql<{ purchase_invoice_id: string; amount: string }[]>`
      SELECT purchase_invoice_id, amount FROM purchase_payments WHERE user_id = ${userId}
    `
    const saleReturns = await sql<{ id: string; party_id: string; total: string; status: string }[]>`
      SELECT id, party_id, total, status FROM returns WHERE type = 'sale' AND user_id = ${userId}
    `
    const purchaseReturns = await sql<{ id: string; party_id: string; total: string; status: string }[]>`
      SELECT id, party_id, total, status FROM returns WHERE type = 'purchase' AND user_id = ${userId}
    `
    const refundsRaw = await sql<{ id: string; return_id: string; amount: string; return_type: string; return_party_id: string }[]>`
      SELECT rf.id, rf.return_id, rf.amount, ret.type AS return_type, ret.party_id AS return_party_id
      FROM refunds rf
      INNER JOIN returns ret ON ret.id = rf.return_id
      WHERE rf.user_id = ${userId}
    `
    const refunds = refundsRaw.map((rf) => ({
      id: rf.id,
      return_id: rf.return_id,
      amount: rf.amount,
      returns: { type: rf.return_type, party_id: rf.return_party_id },
    }))

    let totalReceivables = 0
    let customerCount = 0
    parties.forEach((party) => {
      if (party.type === "Customer") {
        customerCount++
        const partyInvoices = salesInvoices.filter((inv) => inv.party_id === party.id && inv.status !== "Cancelled")
        const totalSales = partyInvoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0)
        const invoiceIds = partyInvoices.map((inv) => inv.id)
        const partyPayments = customerPayments.filter((p) => invoiceIds.includes(p.invoice_id))
        const totalPayments = partyPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
        const partySaleReturns = saleReturns.filter((ret) => ret.party_id === party.id && ret.status === "Completed")
        const totalSaleReturns = partySaleReturns.reduce((sum, ret) => sum + Number(ret.total || 0), 0)
        const saleReturnIds = partySaleReturns.map((ret) => ret.id)
        const partyRefunds = refunds.filter((ref) => saleReturnIds.includes(ref.return_id))
        const totalRefunds = partyRefunds.reduce((sum, ref) => sum + Number(ref.amount || 0), 0)
        const balance = totalSales - totalPayments - totalSaleReturns - totalRefunds
        if (balance > 0) totalReceivables += balance
      }
    })

    let totalPayables = 0
    let vendorCount = 0
    parties.forEach((party) => {
      if (party.type === "Vendor") {
        vendorCount++
        const partyPurchases = purchaseInvoices.filter((purch) => purch.party_id === party.id && purch.status !== "Cancelled")
        const totalPurchases = partyPurchases.reduce((sum, purch) => sum + Number(purch.total || 0), 0)
        const purchaseIds = partyPurchases.map((purch) => purch.id)
        const partyPayments = vendorPayments.filter((p) => purchaseIds.includes(p.purchase_invoice_id))
        const totalPayments = partyPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
        const partyPurchaseReturns = purchaseReturns.filter((ret) => ret.party_id === party.id && ret.status === "Completed")
        const totalPurchaseReturns = partyPurchaseReturns.reduce((sum, ret) => sum + Number(ret.total || 0), 0)
        const purchaseReturnIds = partyPurchaseReturns.map((ret) => ret.id)
        const partyRefunds = refunds.filter((ref) => purchaseReturnIds.includes(ref.return_id))
        const totalRefunds = partyRefunds.reduce((sum, ref) => sum + Number(ref.amount || 0), 0)
        const balance = totalPurchases - totalPayments - totalPurchaseReturns - totalRefunds
        if (balance > 0) totalPayables += balance
      }
    })

    const totalSales = salesInvoices.filter((inv) => inv.status !== "Cancelled").reduce((sum, inv) => sum + Number(inv.total || 0), 0)
    const totalPurchases = purchaseInvoices.filter((inv) => inv.status !== "Cancelled").reduce((sum, inv) => sum + Number(inv.total || 0), 0)
    const totalCustomerPayments = customerPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
    const totalVendorPayments = vendorPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)

    return {
      error: null,
      data: { totalReceivables, totalPayables, totalSales, totalPurchases, totalCustomerPayments, totalVendorPayments, customerCount, vendorCount },
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch overview", data: null }
  }
}

export async function getLedgersByType(
  type: "sale" | "purchase" | "payment" | "customer" | "vendor"
): Promise<{ error: string | null; data: LedgerRow[] }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    const ledgerRows: LedgerRow[] = []

    if (type === "sale") {
      const invoices = await sql<{
        id: string; party_id: string; total: string; created_at: string; status: string; party_name: string | null
      }[]>`
        SELECT si.id, si.party_id, si.total, si.created_at, si.status, p.name AS party_name
        FROM sales_invoices si
        LEFT JOIN parties p ON p.id = si.party_id
        WHERE si.user_id = ${userId}
        ORDER BY si.created_at DESC
      `
      invoices.forEach((inv) => {
        const partyName = inv.party_name || ""
        ledgerRows.push({
          date: inv.created_at,
          description: `Invoice #${inv.id.substring(0, 8).toUpperCase()}${partyName ? ` - ${partyName}` : ""}${inv.status === "Cancelled" ? " (Cancelled)" : ""}`,
          debit: inv.status !== "Cancelled" ? Number(inv.total || 0) : 0,
          credit: 0,
          type: "sale",
          reference_id: inv.id,
          party_id: inv.party_id,
          party_name: partyName,
        })
      })
    } else if (type === "purchase") {
      const purchases = await sql<{
        id: string; party_id: string; total: string; created_at: string; status: string; party_name: string | null
      }[]>`
        SELECT pi.id, pi.party_id, pi.total, pi.created_at, pi.status, p.name AS party_name
        FROM purchase_invoices pi
        LEFT JOIN parties p ON p.id = pi.party_id
        WHERE pi.user_id = ${userId}
        ORDER BY pi.created_at DESC
      `
      purchases.forEach((purch) => {
        const partyName = purch.party_name || ""
        ledgerRows.push({
          date: purch.created_at,
          description: `Purchase #${purch.id.substring(0, 8).toUpperCase()}${partyName ? ` - ${partyName}` : ""}${purch.status === "Cancelled" ? " (Cancelled)" : ""}`,
          debit: purch.status !== "Cancelled" ? Number(purch.total || 0) : 0,
          credit: 0,
          type: "purchase",
          reference_id: purch.id,
          party_id: purch.party_id,
          party_name: partyName,
        })
      })
    } else if (type === "payment") {
      const [customerPayments, vendorPayments] = await Promise.all([
        sql<{ id: string; invoice_id: string; amount: string; method: string; created_at: string }[]>`
          SELECT id, invoice_id, amount, method, created_at FROM payments
          WHERE user_id = ${userId} ORDER BY created_at DESC
        `,
        sql<{ id: string; purchase_invoice_id: string; amount: string; method: string; created_at: string }[]>`
          SELECT id, purchase_invoice_id, amount, method, created_at FROM purchase_payments
          WHERE user_id = ${userId} ORDER BY created_at DESC
        `,
      ])
      customerPayments.forEach((pay) => {
        ledgerRows.push({ date: pay.created_at, description: `Customer Payment (${pay.method})`, debit: 0, credit: Number(pay.amount || 0), type: "payment", reference_id: pay.id })
      })
      vendorPayments.forEach((pay) => {
        ledgerRows.push({ date: pay.created_at, description: `Vendor Payment (${pay.method})`, debit: 0, credit: Number(pay.amount || 0), type: "payment", reference_id: pay.id })
      })
      ledgerRows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    } else if (type === "customer" || type === "vendor") {
      const balances = await getPartyBalances()
      const partyType = type === "customer" ? "Customer" : "Vendor"
      const parties = await sql<{ id: string; name: string; phone: string; type: string }[]>`
        SELECT id, name, phone, type FROM parties
        WHERE type = ${partyType} AND user_id = ${userId}
      `
      parties.forEach((party) => {
        const balance = balances[party.id] || 0
        ledgerRows.push({
          date: new Date().toISOString(),
          description: `${party.name} (${party.phone})`,
          debit: balance > 0 ? balance : 0,
          credit: balance < 0 ? Math.abs(balance) : 0,
          type: type === "customer" ? "customer" : "vendor",
          reference_id: party.id,
          party_id: party.id,
          party_name: party.name,
        })
      })
    }

    return { error: null, data: ledgerRows }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch ledgers", data: [] }
  }
}

export async function getCustomerLedgers(): Promise<{ error: string | null; data: PartyLedgerSummary[] }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    const balances = await getPartyBalances()
    const parties = await sql<{ id: string; name: string; phone: string }[]>`
      SELECT id, name, phone FROM parties
      WHERE type = 'Customer' AND user_id = ${userId}
      ORDER BY name ASC
    `
    const customerLedgers: PartyLedgerSummary[] = parties.map((party) => ({
      id: party.id, name: party.name, phone: party.phone, balance: balances[party.id] || 0, type: "Customer",
    }))
    return { error: null, data: customerLedgers }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch customer ledgers", data: [] }
  }
}

export async function getVendorLedgers(): Promise<{ error: string | null; data: PartyLedgerSummary[] }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    const balances = await getPartyBalances()
    const parties = await sql<{ id: string; name: string; phone: string }[]>`
      SELECT id, name, phone FROM parties
      WHERE type = 'Vendor' AND user_id = ${userId}
      ORDER BY name ASC
    `
    const vendorLedgers: PartyLedgerSummary[] = parties.map((party) => ({
      id: party.id, name: party.name, phone: party.phone, balance: balances[party.id] || 0, type: "Vendor",
    }))
    return { error: null, data: vendorLedgers }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch vendor ledgers", data: [] }
  }
}

export async function getAccountsReports(): Promise<{ error: string | null; data: AccountsReport | null }> {
  try {
    const customerLedgers = await getCustomerLedgers()
    const vendorLedgers = await getVendorLedgers()

    if (customerLedgers.error || vendorLedgers.error) {
      return { error: customerLedgers.error || vendorLedgers.error || "Failed to fetch reports", data: null }
    }

    const receivables = customerLedgers.data.filter((c) => c.balance > 0)
    const payables = vendorLedgers.data.filter((v) => v.balance > 0)
    const totalReceivables = receivables.reduce((sum, r) => sum + r.balance, 0)
    const totalPayables = payables.reduce((sum, p) => sum + p.balance, 0)

    return { error: null, data: { receivables, payables, totalReceivables, totalPayables } }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch reports", data: null }
  }
}

export async function getCashBook(
  dateFrom: string,
  dateTo: string
): Promise<{ error: string | null; data: CashBookData | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    // 1. Opening balance
    const [settingsRow] = await sql<{ opening_balance_override: string | null }[]>`
      SELECT opening_balance_override FROM cash_book_settings
      WHERE user_id = ${userId} AND date = ${dateFrom}
    `

    let opening_balance = 0
    let opening_balance_is_override = false

    if (settingsRow?.opening_balance_override != null) {
      opening_balance = Number(settingsRow.opening_balance_override)
      opening_balance_is_override = true
    } else {
      const beforeDate = `${dateFrom}T00:00:00`
      const [prevPayments, prevPurchasePayments, prevRefundsRaw] = await Promise.all([
        sql<{ amount: string }[]>`SELECT amount FROM payments WHERE user_id = ${userId} AND created_at < ${beforeDate}`,
        sql<{ amount: string }[]>`SELECT amount FROM purchase_payments WHERE user_id = ${userId} AND created_at < ${beforeDate}`,
        sql<{ amount: string; return_type: string }[]>`
          SELECT rf.amount, ret.type AS return_type
          FROM refunds rf
          INNER JOIN returns ret ON ret.id = rf.return_id
          WHERE rf.user_id = ${userId} AND rf.created_at < ${beforeDate}
        `,
      ])
      const prevIn = prevPayments.reduce((s, r) => s + Number(r.amount || 0), 0)
      const prevOut = prevPurchasePayments.reduce((s, r) => s + Number(r.amount || 0), 0)
      let prevRefundIn = 0
      let prevRefundOut = 0
      prevRefundsRaw.forEach((r) => {
        if (r.return_type === "purchase") prevRefundIn += Number(r.amount || 0)
        else prevRefundOut += Number(r.amount || 0)
      })
      opening_balance = prevIn + prevRefundIn - prevOut - prevRefundOut
    }

    // 2. Fetch period transactions
    const startTs = `${dateFrom}T00:00:00`
    const endTs = `${dateTo}T23:59:59`

    const [payments, purchasePayments, refundsRaw] = await Promise.all([
      sql<{ id: string; amount: string; created_at: string; source: string; party_name: string | null }[]>`
        SELECT p.id, p.amount, p.created_at, si.source, pa.name AS party_name
        FROM payments p
        INNER JOIN sales_invoices si ON si.id = p.invoice_id
        LEFT JOIN parties pa ON pa.id = si.party_id
        WHERE p.user_id = ${userId} AND p.created_at >= ${startTs} AND p.created_at <= ${endTs}
        ORDER BY p.created_at ASC
      `,
      sql<{ id: string; amount: string; created_at: string; party_name: string | null }[]>`
        SELECT pp.id, pp.amount, pp.created_at, pa.name AS party_name
        FROM purchase_payments pp
        INNER JOIN purchase_invoices pi ON pi.id = pp.purchase_invoice_id
        LEFT JOIN parties pa ON pa.id = pi.party_id
        WHERE pp.user_id = ${userId} AND pp.created_at >= ${startTs} AND pp.created_at <= ${endTs}
        ORDER BY pp.created_at ASC
      `,
      sql<{ id: string; amount: string; created_at: string; return_type: string; party_name: string | null }[]>`
        SELECT r.id, r.amount, r.created_at, ret.type AS return_type, pa.name AS party_name
        FROM refunds r
        INNER JOIN returns ret ON ret.id = r.return_id
        LEFT JOIN parties pa ON pa.id = ret.party_id
        WHERE r.user_id = ${userId} AND r.created_at >= ${startTs} AND r.created_at <= ${endTs}
        ORDER BY r.created_at ASC
      `,
    ])

    // 3. Build entries
    const rawEntries: Array<Omit<CashBookEntry, "running_balance">> = []

    payments.forEach((p) => {
      const partyName = p.party_name || "Walk-in"
      rawEntries.push({
        id: p.id,
        time: new Date(p.created_at).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", hour12: false }),
        description: p.source === "pos" ? `POS Sale — ${partyName}` : `Payment Received — ${partyName}`,
        party_name: partyName,
        category: p.source === "pos" ? "SALE" : "RECV",
        amount: Number(p.amount || 0),
        direction: "in",
      })
    })

    purchasePayments.forEach((p) => {
      const partyName = p.party_name || "Vendor"
      rawEntries.push({
        id: p.id,
        time: new Date(p.created_at).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", hour12: false }),
        description: `Vendor Payment — ${partyName}`,
        party_name: partyName,
        category: "PAID",
        amount: Number(p.amount || 0),
        direction: "out",
      })
    })

    refundsRaw.forEach((r) => {
      const isPurchaseReturn = r.return_type === "purchase"
      const partyName = r.party_name || "Customer"
      rawEntries.push({
        id: r.id,
        time: new Date(r.created_at).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", hour12: false }),
        description: isPurchaseReturn ? `Purchase Return — ${partyName}` : `Refund Given — ${partyName}`,
        party_name: partyName,
        category: isPurchaseReturn ? "PUR-RET" : "REFUND",
        amount: Number(r.amount || 0),
        direction: isPurchaseReturn ? "in" : "out",
      })
    })

    rawEntries.sort((a, b) => a.time.localeCompare(b.time))

    // 4. Running balance
    let running = opening_balance
    const entries: CashBookEntry[] = rawEntries.map((e) => {
      running = e.direction === "in" ? running + e.amount : running - e.amount
      return { ...e, running_balance: running }
    })

    const cash_in = entries.filter((e) => e.direction === "in").reduce((s, e) => s + e.amount, 0)
    const cash_out = entries.filter((e) => e.direction === "out").reduce((s, e) => s + e.amount, 0)

    return {
      error: null,
      data: { opening_balance, opening_balance_is_override, cash_in, cash_out, closing_balance: opening_balance + cash_in - cash_out, entries, date_from: dateFrom, date_to: dateTo },
    }
  } catch (err: any) {
    return { error: err.message || "Failed to load cash book", data: null }
  }
}

export interface PLStatement {
  dateFrom: string; dateTo: string; revenue: number; salesReturns: number; netRevenue: number
  cogs: number; grossProfit: number; grossProfitPct: number; totalExpenses: number
  netProfit: number; netProfitPct: number; invoiceCount: number; returnCount: number
}

export async function getPLStatement(
  dateFrom: string,
  dateTo: string
): Promise<{ error: string | null; data: PLStatement | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId
  const from = `${dateFrom}T00:00:00`
  const to = `${dateTo}T23:59:59`

  try {
    const invoices = await sql<{ id: string; total: string; status: string }[]>`
      SELECT id, total, status FROM sales_invoices
      WHERE user_id = ${userId}
        AND status = ANY(ARRAY['Paid','Credit','Partial','Pending','Partially Returned'])
        AND created_at >= ${from} AND created_at <= ${to}
    `

    const invoiceIds = invoices.map((i) => i.id)
    let revenue = 0
    let cogs = 0

    if (invoiceIds.length > 0) {
      const lines = await sql<{ quantity: string; unit_price: string; cost_price: string | null }[]>`
        SELECT quantity, unit_price, cost_price FROM sales_invoice_lines
        WHERE invoice_id = ANY(${invoiceIds})
      `
      for (const line of lines) {
        const qty = Number(line.quantity || 0)
        revenue += Number(line.unit_price || 0) * qty
        cogs += Number(line.cost_price || 0) * qty
      }
    }

    const saleReturns = await sql<{ id: string; subtotal: string }[]>`
      SELECT id, subtotal FROM returns
      WHERE user_id = ${userId} AND type = 'sale' AND status = 'Completed'
        AND created_at >= ${from} AND created_at <= ${to}
    `

    let salesReturns = 0
    const returnIds = saleReturns.map((r) => r.id)
    if (returnIds.length > 0) {
      const returnLines = await sql<{ quantity: string; unit_price: string }[]>`
        SELECT quantity, unit_price FROM return_lines WHERE return_id = ANY(${returnIds})
      `
      for (const rl of returnLines) {
        salesReturns += Number(rl.unit_price || 0) * Number(rl.quantity || 0)
      }
    }

    const netRevenue = revenue - salesReturns
    const grossProfit = netRevenue - cogs
    const grossProfitPct = netRevenue > 0 ? Math.round((grossProfit / netRevenue) * 100 * 10) / 10 : 0
    const totalExpenses = 0
    const netProfit = grossProfit
    const netProfitPct = grossProfitPct

    return {
      error: null,
      data: { dateFrom, dateTo, revenue, salesReturns, netRevenue, cogs, grossProfit, grossProfitPct, totalExpenses, netProfit, netProfitPct, invoiceCount: invoiceIds.length, returnCount: saleReturns.length },
    }
  } catch (err: any) {
    return { error: err.message || "Failed to fetch P&L", data: null }
  }
}

export async function upsertOpeningOverride(
  date: string,
  amount: number,
  notes?: string
): Promise<{ error: string | null }> {
  const currentUser = await getSessionOrRedirect()

  try {
    await sql`
      INSERT INTO cash_book_settings (user_id, date, opening_balance_override, notes)
      VALUES (${currentUser.effectiveUserId}, ${date}, ${amount}, ${notes || null})
      ON CONFLICT (user_id, date) DO UPDATE SET
        opening_balance_override = EXCLUDED.opening_balance_override,
        notes = EXCLUDED.notes
    `
    return { error: null }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Database error" }
  }
}
