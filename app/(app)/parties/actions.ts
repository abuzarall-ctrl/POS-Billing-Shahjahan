"use server"

import { revalidatePath } from "next/cache"
import sql from "@/lib/db"
import { getSessionOrRedirect } from "@/lib/auth"

export async function createParty(formData: FormData) {
  const currentUser = await getSessionOrRedirect()

  const advPayment = parseFloat(String(formData.get("advance_payment") || "0")) || 0
  const preBalance = parseFloat(String(formData.get("pre_balance") || "0")) || 0

  const name = String(formData.get("name") || "").trim()
  const phone = String(formData.get("phone") || "").trim()
  const type = String(formData.get("type") || "Customer")
  const address = String(formData.get("address") || "").trim() || null
  const advance_payment = advPayment > 0 ? advPayment : 0
  const advance_payment_ref = String(formData.get("advance_payment_ref") || "").trim() || null
  const pre_balance = preBalance > 0 ? preBalance : 0
  const pre_balance_ref = String(formData.get("pre_balance_ref") || "").trim() || null
  const user_id = currentUser.effectiveUserId

  if (!name || !phone) {
    return { error: "Name and phone are required" }
  }

  try {
    await sql`
      INSERT INTO parties (name, phone, type, address, advance_payment, advance_payment_ref, pre_balance, pre_balance_ref, user_id)
      VALUES (${name}, ${phone}, ${type}, ${address}, ${advance_payment}, ${advance_payment_ref}, ${pre_balance}, ${pre_balance_ref}, ${user_id})
    `
    revalidatePath("/parties")
    revalidatePath("/parties/add")
    return { error: null }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unknown error" }
  }
}

export async function updateParty(formData: FormData) {
  const currentUser = await getSessionOrRedirect()

  const id = String(formData.get("id") || "").trim()
  const advPayment = parseFloat(String(formData.get("advance_payment") || "0")) || 0
  const preBalance = parseFloat(String(formData.get("pre_balance") || "0")) || 0

  const name = String(formData.get("name") || "").trim()
  const phone = String(formData.get("phone") || "").trim()

  if (!id || !name || !phone) {
    return { error: "ID, name, and phone are required" }
  }

  const values = {
    name,
    phone,
    type: String(formData.get("type") || "Customer"),
    address: String(formData.get("address") || "").trim() || null,
    advance_payment: advPayment > 0 ? advPayment : 0,
    advance_payment_ref: String(formData.get("advance_payment_ref") || "").trim() || null,
    pre_balance: preBalance > 0 ? preBalance : 0,
    pre_balance_ref: String(formData.get("pre_balance_ref") || "").trim() || null,
  }

  try {
    await sql`UPDATE parties SET ${sql(values)}, updated_at = NOW() WHERE id = ${id} AND user_id = ${currentUser.effectiveUserId}`
    revalidatePath("/parties")
    return { error: null }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unknown error" }
  }
}

export async function deleteParty(partyId: string) {
  const currentUser = await getSessionOrRedirect()

  if (!partyId) {
    return { error: "Party ID is required" }
  }

  try {
    await sql`DELETE FROM parties WHERE id = ${partyId} AND user_id = ${currentUser.effectiveUserId}`
    revalidatePath("/parties")
    revalidatePath("/dashboard")
    return { error: null }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unknown error" }
  }
}

export async function getPartyBalances() {
  const currentUser = await getSessionOrRedirect()
  const uid = currentUser.effectiveUserId

  const [
    parties,
    salesInvoices,
    payments,
    purchaseInvoices,
    purchasePayments,
    saleReturns,
    purchaseReturns,
    refunds,
  ] = await Promise.all([
    sql`SELECT id, type FROM parties WHERE user_id = ${uid}`,
    sql`SELECT id, party_id, total, status FROM sales_invoices WHERE user_id = ${uid}`,
    sql`SELECT invoice_id, amount FROM payments WHERE user_id = ${uid}`,
    sql`SELECT id, party_id, total, status FROM purchase_invoices WHERE user_id = ${uid}`,
    sql`SELECT purchase_invoice_id, amount FROM purchase_payments WHERE user_id = ${uid}`,
    sql`SELECT id, party_id, total, status FROM returns WHERE type = 'sale' AND user_id = ${uid}`,
    sql`SELECT id, party_id, total, status FROM returns WHERE type = 'purchase' AND user_id = ${uid}`,
    sql`
      SELECT r.id, r.return_id, r.amount, ret.type AS return_type
      FROM refunds r
      INNER JOIN returns ret ON ret.id = r.return_id
      WHERE r.user_id = ${uid}
    `,
  ])

  const balances: Record<string, number> = {}

  for (const party of parties) {
    let balance = 0

    if (party.type === "Customer" || party.type === "Both") {
      const partyInvoices = salesInvoices.filter(
        (inv) => inv.party_id === party.id && inv.status !== "Cancelled",
      )
      const totalSales = partyInvoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0)

      const invoiceIds = partyInvoices.map((inv) => inv.id)
      const partyPayments = payments.filter((p) => invoiceIds.includes(p.invoice_id))
      const totalPayments = partyPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)

      const partySaleReturns = saleReturns.filter(
        (ret) => ret.party_id === party.id && ret.status === "Completed",
      )
      const totalSaleReturns = partySaleReturns.reduce((sum, ret) => sum + Number(ret.total || 0), 0)

      const saleReturnIds = partySaleReturns.map((ret) => ret.id)
      const partyRefunds = refunds.filter(
        (ref) => saleReturnIds.includes(ref.return_id) && ref.return_type === "sale",
      )
      const totalRefunds = partyRefunds.reduce((sum, ref) => sum + Number(ref.amount || 0), 0)

      balance = totalSales - totalPayments - totalSaleReturns + totalRefunds
    }

    if (party.type === "Vendor" || party.type === "Both") {
      const partyPurchases = purchaseInvoices.filter(
        (purch) => purch.party_id === party.id && purch.status !== "Cancelled",
      )
      const totalPurchases = partyPurchases.reduce((sum, purch) => sum + Number(purch.total || 0), 0)

      const purchaseIds = partyPurchases.map((purch) => purch.id)
      const partyPurchasePayments = purchasePayments.filter((p) =>
        purchaseIds.includes(p.purchase_invoice_id),
      )
      const totalPurchasePayments = partyPurchasePayments.reduce(
        (sum, p) => sum + Number(p.amount || 0),
        0,
      )

      const partyPurchaseReturns = purchaseReturns.filter(
        (ret) => ret.party_id === party.id && ret.status === "Completed",
      )
      const totalPurchaseReturns = partyPurchaseReturns.reduce(
        (sum, ret) => sum + Number(ret.total || 0),
        0,
      )

      const purchaseReturnIds = partyPurchaseReturns.map((ret) => ret.id)
      const partyRefunds = refunds.filter(
        (ref) => purchaseReturnIds.includes(ref.return_id) && ref.return_type === "purchase",
      )
      const totalRefunds = partyRefunds.reduce((sum, ref) => sum + Number(ref.amount || 0), 0)

      if (party.type === "Both") {
        balance += totalPurchases - totalPurchasePayments - totalPurchaseReturns - totalRefunds
      } else {
        balance = totalPurchases - totalPurchasePayments - totalPurchaseReturns - totalRefunds
      }
    }

    balances[party.id as string] = balance
  }

  return balances
}

export async function getPartyLedger(partyId: string) {
  const currentUser = await getSessionOrRedirect()
  const uid = currentUser.effectiveUserId

  if (!partyId) {
    return { error: "Party ID is required", data: null }
  }

  const partyRows = await sql`
    SELECT id, name, type, created_at, advance_payment, advance_payment_ref, pre_balance, pre_balance_ref
    FROM parties
    WHERE id = ${partyId} AND user_id = ${uid}
    LIMIT 1
  `
  const party = partyRows[0]
  if (!party) {
    return { error: "Party not found", data: null }
  }

  type LedgerTxn = {
    date: string | Date
    description: string
    debit: number
    credit: number
    type: string
    reference_id: string
  }

  const combinedTransactions: LedgerTxn[] = []

  // Opening balance entries — prepended before all real transactions
  const advPayment = Number(party.advance_payment || 0)
  const preBalance = Number(party.pre_balance || 0)
  if (advPayment > 0) {
    combinedTransactions.push({
      date: party.created_at,
      description: (party.advance_payment_ref as string) || "Advance Payment",
      debit: 0,
      credit: advPayment,
      type: "opening",
      reference_id: party.id as string,
    })
  }
  if (preBalance > 0) {
    combinedTransactions.push({
      date: party.created_at,
      description: (party.pre_balance_ref as string) || "Opening Pre-Balance",
      debit: preBalance,
      credit: 0,
      type: "opening",
      reference_id: party.id as string,
    })
  }

  // Customer-side transactions
  if (party.type === "Customer" || party.type === "Both") {
    const invoices = await sql`
      SELECT id, total, created_at, status, reference_no
      FROM sales_invoices
      WHERE party_id = ${partyId} AND user_id = ${uid}
      ORDER BY created_at ASC
    `

    const invoiceIds = invoices.map((inv) => inv.id as string)
    let paymentRows: typeof invoices = []
    if (invoiceIds.length > 0) {
      paymentRows = await sql`
        SELECT id, invoice_id, amount, method, reference, created_at
        FROM payments
        WHERE invoice_id IN ${sql(invoiceIds)} AND user_id = ${uid}
        ORDER BY created_at ASC
      `
    }

    const saleReturns = await sql`
      SELECT id, total, created_at
      FROM returns
      WHERE party_id = ${partyId} AND type = 'sale' AND user_id = ${uid}
      ORDER BY created_at ASC
    `

    const saleReturnIds = saleReturns.map((r) => r.id as string)
    let saleRefunds: typeof saleReturns = []
    if (saleReturnIds.length > 0) {
      saleRefunds = await sql`
        SELECT id, return_id, amount, method, created_at
        FROM refunds
        WHERE return_id IN ${sql(saleReturnIds)} AND user_id = ${uid}
        ORDER BY created_at ASC
      `
    }

    for (const inv of invoices) {
      combinedTransactions.push({
        date: inv.created_at,
        description:
          inv.status === "Cancelled"
            ? `Invoice #${String(inv.id).substring(0, 8).toUpperCase()} (Cancelled)`
            : inv.reference_no
            ? `Invoice #${String(inv.id).substring(0, 8).toUpperCase()} · Ref# ${inv.reference_no}`
            : `Invoice #${String(inv.id).substring(0, 8).toUpperCase()}`,
        debit: inv.status !== "Cancelled" ? Number(inv.total || 0) : 0,
        credit: 0,
        type: "invoice",
        reference_id: inv.id as string,
      })
    }

    for (const pay of paymentRows) {
      const isCancelled = invoices.find((inv) => inv.id === pay.invoice_id)?.status === "Cancelled"
      combinedTransactions.push({
        date: pay.created_at,
        description: isCancelled
          ? `Payment (${pay.method}) - Invoice Cancelled`
          : pay.reference
          ? pay.reference as string
          : `Payment (${pay.method})`,
        debit: 0,
        credit: isCancelled ? 0 : Number(pay.amount || 0),
        type: "payment",
        reference_id: pay.invoice_id as string,
      })
    }

    for (const ret of saleReturns) {
      combinedTransactions.push({
        date: ret.created_at,
        description: `Sale Return #${String(ret.id).substring(0, 8).toUpperCase()}`,
        debit: 0,
        credit: Number(ret.total || 0),
        type: "return",
        reference_id: ret.id as string,
      })
    }

    for (const ref of saleRefunds) {
      combinedTransactions.push({
        date: ref.created_at,
        description: `Refund (${ref.method || "Cash"})`,
        debit: Number(ref.amount || 0),
        credit: 0,
        type: "refund",
        reference_id: ref.return_id as string,
      })
    }
  }

  // Vendor-side transactions
  if (party.type === "Vendor" || party.type === "Both") {
    const purchases = await sql`
      SELECT id, total, created_at, status
      FROM purchase_invoices
      WHERE party_id = ${partyId} AND user_id = ${uid}
      ORDER BY created_at ASC
    `

    const purchaseIds = purchases.map((p) => p.id as string)
    let purchasePaymentRows: typeof purchases = []
    if (purchaseIds.length > 0) {
      purchasePaymentRows = await sql`
        SELECT id, purchase_invoice_id, amount, method, reference, created_at
        FROM purchase_payments
        WHERE purchase_invoice_id IN ${sql(purchaseIds)} AND user_id = ${uid}
        ORDER BY created_at ASC
      `
    }

    const purchaseReturns = await sql`
      SELECT id, total, created_at
      FROM returns
      WHERE party_id = ${partyId} AND type = 'purchase' AND user_id = ${uid}
      ORDER BY created_at ASC
    `

    for (const purch of purchases) {
      combinedTransactions.push({
        date: purch.created_at,
        description:
          purch.status === "Cancelled"
            ? `Purchase #${String(purch.id).substring(0, 8).toUpperCase()} (Cancelled)`
            : `Purchase #${String(purch.id).substring(0, 8).toUpperCase()}`,
        // Purchase = we owe vendor → stored as credit so debit-credit gives negative
        debit: 0,
        credit: purch.status !== "Cancelled" ? Number(purch.total || 0) : 0,
        type: "purchase",
        reference_id: purch.id as string,
      })
    }

    for (const pay of purchasePaymentRows) {
      const isCancelled =
        purchases.find((p) => p.id === pay.purchase_invoice_id)?.status === "Cancelled"
      combinedTransactions.push({
        date: pay.created_at,
        description: isCancelled
          ? `Payment (${pay.method}) - Purchase Cancelled`
          : pay.reference
          ? pay.reference as string
          : `Payment (${pay.method})`,
        // Payment to vendor → stored as debit (reduces our debt)
        debit: isCancelled ? 0 : Number(pay.amount || 0),
        credit: 0,
        type: "payment",
        reference_id: pay.purchase_invoice_id as string,
      })
    }

    for (const ret of purchaseReturns) {
      combinedTransactions.push({
        date: ret.created_at,
        description: `Purchase Return #${String(ret.id).substring(0, 8).toUpperCase()}`,
        debit: Number(ret.total || 0),
        credit: 0,
        type: "return",
        reference_id: ret.id as string,
      })
    }
  }

  combinedTransactions.sort(
    (a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime(),
  )

  // Vendor-only: positive balance = we owe them (credit-debit). Customer/Both: positive = they owe us (debit-credit).
  const sign = party.type === "Vendor" ? -1 : 1
  let runningBalance = 0
  const ledgerRows = combinedTransactions.map((txn) => {
    runningBalance += sign * (txn.debit - txn.credit)
    return {
      ...txn,
      balance: runningBalance,
    }
  })

  return { error: null, data: { party, ledgerRows } }
}

export async function bulkImportParties(
  rows: Array<{
    name: string
    type?: string | null
    phone?: string | null
    address?: string | null
  }>,
): Promise<{ imported: number; errors: string[] }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  const errors: string[] = []
  let imported = 0

  const inserts: Array<{
    name: string
    type: string
    phone: string
    address: string | null
    user_id: string
  }> = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2
    if (!row.name?.trim()) {
      errors.push(`Row ${rowNum}: name is required`)
      continue
    }
    const type = row.type?.trim() === "Vendor" ? "Vendor" : "Customer"
    inserts.push({
      name: row.name.trim(),
      type,
      phone: row.phone?.trim() || "",
      address: row.address?.trim() || null,
      user_id: userId,
    })
  }

  if (inserts.length > 0) {
    try {
      await sql`INSERT INTO parties ${sql(inserts)}`
      imported = inserts.length
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Unknown error")
    }
  }

  revalidatePath("/parties")
  return { imported, errors }
}
