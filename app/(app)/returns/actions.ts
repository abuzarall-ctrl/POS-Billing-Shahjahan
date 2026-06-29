"use server"

import { revalidatePath } from "next/cache"
import sql from "@/lib/db"
import { recordStockMovement } from "@/lib/db/stock-movements"
import { verifyPartyOwnership } from "@/lib/db/party-ownership"
import { getSessionOrRedirect } from "@/lib/auth"
import type {
  CreateSaleReturnInput,
  CreatePurchaseReturnInput,
  CreateRefundInput,
  Return,
  ReturnWithDetails,
  Refund,
} from "@/lib/types/return"

export async function createSaleReturn(payload: CreateSaleReturnInput) {
  const currentUser = await getSessionOrRedirect()

  if (!payload.sales_invoice_id || !payload.items?.length) {
    return { error: "Sales invoice and at least one line item are required", data: null }
  }

  const [salesInvoice] = await sql<{ id: string; party_id: string; total: string; status: string }[]>`
    SELECT id, party_id, total, status FROM sales_invoices
    WHERE id = ${payload.sales_invoice_id} AND user_id = ${currentUser.effectiveUserId}
  `
  if (!salesInvoice) return { error: "Sales invoice not found", data: null }

  if (salesInvoice.status === "Draft" || salesInvoice.status === "Cancelled") {
    return { error: `Cannot create a return against a ${salesInvoice.status} invoice. Complete the sale first.`, data: null }
  }

  const taxRate = payload.taxRate ?? 0
  const subtotal = payload.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const tax = subtotal * (taxRate / 100)
  const total = subtotal + tax

  const partyCheck = await verifyPartyOwnership(payload.party_id, currentUser.effectiveUserId)
  if (!partyCheck.ok) return { error: partyCheck.error, data: null }

  const itemIds = payload.items.map((item) => item.itemId)
  const items = await sql<{ id: string }[]>`
    SELECT id FROM inventory_items WHERE id = ANY(${itemIds}) AND user_id = ${currentUser.effectiveUserId}
  `
  if (items.length !== itemIds.length) return { error: "One or more items not found", data: null }

  for (const item of payload.items) {
    if (!item.salesInvoiceLineId) {
      return { error: "Each return item must reference an original invoice line. Reload the sale return form if you're seeing this from the UI.", data: null }
    }
  }

  const lineIds = payload.items.map((i) => i.salesInvoiceLineId!) as string[]
  if (lineIds.length > 0) {
    const originalLines = await sql<{ id: string; quantity: string; item_id: string; unit_price: string }[]>`
      SELECT id, quantity, item_id, unit_price FROM sales_invoice_lines WHERE id = ANY(${lineIds})
    `
    const existingReturnLines = await sql<{ sales_invoice_line_id: string; quantity: string }[]>`
      SELECT sales_invoice_line_id, quantity FROM return_lines
      WHERE sales_invoice_line_id = ANY(${lineIds})
    `

    const alreadyReturnedMap: Record<string, number> = {}
    existingReturnLines.forEach((rl) => {
      if (rl.sales_invoice_line_id) {
        alreadyReturnedMap[rl.sales_invoice_line_id] = (alreadyReturnedMap[rl.sales_invoice_line_id] || 0) + Number(rl.quantity)
      }
    })

    const cents = (n: number) => Math.round(n * 100)
    for (const item of payload.items) {
      const original = originalLines.find((l) => l.id === item.salesInvoiceLineId)
      if (!original) return { error: "Return line references an unknown invoice line.", data: null }
      if (original.item_id !== item.itemId) return { error: "Return item does not match the original invoice line's item.", data: null }
      const originalUnit = Number(original.unit_price ?? 0)
      if (cents(item.unitPrice) > cents(originalUnit)) {
        return { error: `Return unit price (${item.unitPrice.toFixed(2)}) cannot exceed the original sale price (${originalUnit.toFixed(2)}). Lowering the price is allowed; raising it isn't.`, data: null }
      }
      const alreadyReturned = alreadyReturnedMap[item.salesInvoiceLineId!] || 0
      const available = Number(original.quantity) - alreadyReturned
      if (cents(item.quantity) > cents(available)) {
        return { error: `Cannot return ${item.quantity} units — only ${available} unit(s) available to return for one or more items`, data: null }
      }
    }
  }

  const [returnData] = await sql<{ id: string; return_number: string }[]>`
    INSERT INTO returns (type, sales_invoice_id, purchase_invoice_id, party_id, subtotal, tax, total, status, user_id)
    VALUES ('sale', ${payload.sales_invoice_id}, null, ${payload.party_id}, ${subtotal}, ${tax}, ${total}, 'Completed', ${currentUser.effectiveUserId})
    RETURNING id, return_number
  `
  if (!returnData) return { error: "Unable to create return", data: null }

  const lineItems = payload.items.map((item) => ({
    return_id: returnData.id,
    item_id: item.itemId,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    line_total: item.quantity * item.unitPrice,
    sales_invoice_line_id: item.salesInvoiceLineId || null,
    purchase_invoice_line_id: null,
  }))
  await sql`INSERT INTO return_lines ${sql(lineItems)}`

  try {
    await Promise.all(
      payload.items.map(async (item) => {
        await sql`SELECT increment_inventory_stock(${item.itemId}, ${item.quantity})`
        await recordStockMovement({
          itemId: item.itemId, movementType: "IN", quantity: item.quantity,
          referenceType: "SaleReturn", referenceId: returnData.id,
          notes: `Sale return ${returnData.return_number}`, userId: currentUser.effectiveUserId,
        })
      }),
    )
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to process inventory", data: null }
  }

  if (payload.refunds && payload.refunds.length > 0) {
    const refundRows = payload.refunds.filter((r) => r.amount > 0).map((r) => ({
      return_id: returnData.id, amount: r.amount, method: r.method, reference: r.reference || null, user_id: currentUser.effectiveUserId,
    }))
    if (refundRows.length > 0) {
      try {
        await sql`INSERT INTO refunds ${sql(refundRows)}`
      } catch (err) {
        return { error: `Return was created but refund recording failed: ${err instanceof Error ? err.message : "Unknown error"}. Please add the refund manually from the Returns page.`, data: null }
      }
    }
  }

  const allSaleReturns = await sql<{ total: string }[]>`
    SELECT total FROM returns WHERE sales_invoice_id = ${payload.sales_invoice_id} AND type = 'sale' AND status = 'Completed'
  `
  const totalReturned = Math.round(allSaleReturns.reduce((sum, r) => sum + Number(r.total ?? 0), 0) * 100)
  const invoiceTotal = Math.round(Number(salesInvoice.total ?? 0) * 100)
  const newInvoiceStatus = totalReturned >= invoiceTotal ? "Returned" : "Partially Returned"

  await sql`
    UPDATE sales_invoices SET status = ${newInvoiceStatus}
    WHERE id = ${payload.sales_invoice_id} AND user_id = ${currentUser.effectiveUserId}
  `.catch((err) => console.error("Invoice status update failed:", err.message))

  revalidatePath("/returns")
  revalidatePath("/returns/sales")
  revalidatePath("/returns/reports")
  revalidatePath("/invoices")
  revalidatePath("/accounts-management")
  revalidatePath("/dashboard")
  return { error: null, data: { returnId: returnData.id, returnNumber: returnData.return_number } }
}

export async function createPurchaseReturn(payload: CreatePurchaseReturnInput) {
  const currentUser = await getSessionOrRedirect()

  if (!payload.purchase_invoice_id || !payload.items?.length) {
    return { error: "Purchase invoice and at least one line item are required", data: null }
  }

  const [purchaseInvoice] = await sql<{ id: string; party_id: string; total: string; status: string }[]>`
    SELECT id, party_id, total, status FROM purchase_invoices
    WHERE id = ${payload.purchase_invoice_id} AND user_id = ${currentUser.effectiveUserId}
  `
  if (!purchaseInvoice) return { error: "Purchase invoice not found", data: null }

  if (purchaseInvoice.status === "Draft" || purchaseInvoice.status === "Cancelled") {
    return { error: `Cannot create a return against a ${purchaseInvoice.status} purchase. Complete the purchase first.`, data: null }
  }

  const partyCheck = await verifyPartyOwnership(payload.party_id, currentUser.effectiveUserId)
  if (!partyCheck.ok) return { error: partyCheck.error, data: null }

  const itemIds = payload.items.map((item) => item.itemId)
  const items = await sql<{ id: string }[]>`
    SELECT id FROM inventory_items WHERE id = ANY(${itemIds}) AND user_id = ${currentUser.effectiveUserId}
  `
  if (items.length !== itemIds.length) return { error: "One or more items not found", data: null }

  for (const item of payload.items) {
    if (!item.purchaseInvoiceLineId) {
      return { error: "Each return item must reference an original purchase line. Reload the purchase return form if you're seeing this from the UI.", data: null }
    }
  }

  const purchaseLineIds = payload.items.map((i) => i.purchaseInvoiceLineId!) as string[]
  if (purchaseLineIds.length > 0) {
    const originalLines = await sql<{ id: string; quantity: string; item_id: string; unit_price: string }[]>`
      SELECT id, quantity, item_id, unit_price FROM purchase_invoice_lines WHERE id = ANY(${purchaseLineIds})
    `
    const existingReturnLines = await sql<{ purchase_invoice_line_id: string; quantity: string }[]>`
      SELECT purchase_invoice_line_id, quantity FROM return_lines
      WHERE purchase_invoice_line_id = ANY(${purchaseLineIds})
    `
    const alreadyReturnedMap: Record<string, number> = {}
    existingReturnLines.forEach((rl) => {
      if (rl.purchase_invoice_line_id) {
        alreadyReturnedMap[rl.purchase_invoice_line_id] = (alreadyReturnedMap[rl.purchase_invoice_line_id] || 0) + Number(rl.quantity)
      }
    })
    const cents = (n: number) => Math.round(n * 100)
    for (const item of payload.items) {
      const original = originalLines.find((l) => l.id === item.purchaseInvoiceLineId)
      if (!original) return { error: "Return line references an unknown purchase line.", data: null }
      if (original.item_id !== item.itemId) return { error: "Return item does not match the original purchase line's item.", data: null }
      const originalUnit = Number(original.unit_price ?? 0)
      if (cents(item.unitPrice) > cents(originalUnit)) {
        return { error: `Return unit price (${item.unitPrice.toFixed(2)}) cannot exceed the original purchase price (${originalUnit.toFixed(2)}).`, data: null }
      }
      const alreadyReturned = alreadyReturnedMap[item.purchaseInvoiceLineId!] || 0
      const available = Number(original.quantity) - alreadyReturned
      if (cents(item.quantity) > cents(available)) {
        return { error: `Cannot return ${item.quantity} units — only ${available} unit(s) available to return for one or more items`, data: null }
      }
    }
  }

  const taxRate = payload.taxRate ?? 0
  const subtotal = payload.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const tax = subtotal * (taxRate / 100)
  const total = subtotal + tax

  const [returnData] = await sql<{ id: string; return_number: string }[]>`
    INSERT INTO returns (type, sales_invoice_id, purchase_invoice_id, party_id, subtotal, tax, total, status, user_id)
    VALUES ('purchase', null, ${payload.purchase_invoice_id}, ${payload.party_id}, ${subtotal}, ${tax}, ${total}, 'Completed', ${currentUser.effectiveUserId})
    RETURNING id, return_number
  `
  if (!returnData) return { error: "Unable to create return", data: null }

  const lineItems = payload.items.map((item) => ({
    return_id: returnData.id, item_id: item.itemId, quantity: item.quantity, unit_price: item.unitPrice,
    line_total: item.quantity * item.unitPrice, sales_invoice_line_id: null, purchase_invoice_line_id: item.purchaseInvoiceLineId || null,
  }))
  await sql`INSERT INTO return_lines ${sql(lineItems)}`

  try {
    await Promise.all(
      payload.items.map(async (item) => {
        await sql`SELECT decrement_inventory_stock(${item.itemId}, ${item.quantity})`
        await recordStockMovement({
          itemId: item.itemId, movementType: "OUT", quantity: item.quantity,
          referenceType: "PurchaseReturn", referenceId: returnData.id,
          notes: `Purchase return ${returnData.return_number}`, userId: currentUser.effectiveUserId,
        })
      }),
    )
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to process inventory", data: null }
  }

  if (payload.refunds && payload.refunds.length > 0) {
    const refundRows = payload.refunds.filter((r) => r.amount > 0).map((r) => ({
      return_id: returnData.id, amount: r.amount, method: r.method, reference: r.reference || null, user_id: currentUser.effectiveUserId,
    }))
    if (refundRows.length > 0) {
      try {
        await sql`INSERT INTO refunds ${sql(refundRows)}`
      } catch (err) {
        return { error: `Return was created but refund recording failed: ${err instanceof Error ? err.message : "Unknown error"}. Please add the refund manually from the Returns page.`, data: null }
      }
    }
  }

  const allPurchaseReturns = await sql<{ total: string }[]>`
    SELECT total FROM returns WHERE purchase_invoice_id = ${payload.purchase_invoice_id} AND type = 'purchase' AND status = 'Completed'
  `
  const totalReturned = Math.round(allPurchaseReturns.reduce((sum, r) => sum + Number(r.total ?? 0), 0) * 100)
  const invoiceTotal = Math.round(Number(purchaseInvoice.total ?? 0) * 100)
  const newInvoiceStatus = totalReturned >= invoiceTotal ? "Returned" : "Partially Returned"

  await sql`
    UPDATE purchase_invoices SET status = ${newInvoiceStatus}
    WHERE id = ${payload.purchase_invoice_id} AND user_id = ${currentUser.effectiveUserId}
  `.catch((err) => console.error("Purchase invoice status update failed:", err.message))

  revalidatePath("/returns")
  revalidatePath("/returns/purchases")
  revalidatePath("/returns/reports")
  revalidatePath("/purchase-management/purchases")
  revalidatePath("/accounts-management")
  revalidatePath("/dashboard")
  return { error: null, data: { returnId: returnData.id, returnNumber: returnData.return_number } }
}

export async function getReturns(
  type?: "sale" | "purchase",
  dateFrom?: string,
  dateTo?: string,
  partyId?: string,
  status?: string,
) {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{
      id: string; return_number: string; type: string; sales_invoice_id: string | null; purchase_invoice_id: string | null
      party_id: string; subtotal: string; tax: string; total: string; status: string; created_at: string; updated_at: string
      party_name: string | null; party_phone: string | null
    }[]>`
      SELECT r.id, r.return_number, r.type, r.sales_invoice_id, r.purchase_invoice_id, r.party_id,
             r.subtotal, r.tax, r.total, r.status, r.created_at, r.updated_at,
             p.name AS party_name, p.phone AS party_phone
      FROM returns r
      LEFT JOIN parties p ON p.id = r.party_id
      WHERE r.user_id = ${currentUser.effectiveUserId}
        ${type ? sql`AND r.type = ${type}` : sql``}
        ${status ? sql`AND r.status = ${status}` : sql``}
        ${dateFrom ? sql`AND r.created_at >= ${dateFrom.includes("T") ? dateFrom : `${dateFrom}T00:00:00.000Z`}` : sql``}
        ${dateTo ? sql`AND r.created_at <= ${dateTo.includes("T") ? dateTo : `${dateTo}T23:59:59.999Z`}` : sql``}
        ${partyId ? sql`AND r.party_id = ${partyId}` : sql``}
      ORDER BY r.created_at DESC
    `

    return rows.map((row) => ({
      id: row.id, return_number: row.return_number, type: row.type,
      sales_invoice_id: row.sales_invoice_id, purchase_invoice_id: row.purchase_invoice_id, party_id: row.party_id,
      subtotal: Number(row.subtotal ?? 0), tax: Number(row.tax ?? 0), total: Number(row.total ?? 0),
      status: row.status ?? "Draft", created_at: row.created_at, updated_at: row.updated_at,
      party: row.party_name ? { id: row.party_id, name: row.party_name, phone: row.party_phone } : undefined,
    })) as Return[]
  } catch {
    return []
  }
}

export async function getReturnById(returnId: string): Promise<ReturnWithDetails | null> {
  const currentUser = await getSessionOrRedirect()

  const [returnData] = await sql<{
    id: string; return_number: string; type: string; sales_invoice_id: string | null; purchase_invoice_id: string | null
    party_id: string; subtotal: string; tax: string; total: string; status: string; created_at: string; updated_at: string
    party_name: string | null; party_phone: string | null
  }[]>`
    SELECT r.id, r.return_number, r.type, r.sales_invoice_id, r.purchase_invoice_id, r.party_id,
           r.subtotal, r.tax, r.total, r.status, r.created_at, r.updated_at,
           p.id AS party_id, p.name AS party_name, p.phone AS party_phone
    FROM returns r
    LEFT JOIN parties p ON p.id = r.party_id
    WHERE r.id = ${returnId} AND r.user_id = ${currentUser.effectiveUserId}
  `
  if (!returnData) return null

  const linesData = await sql<{
    id: string; return_id: string; item_id: string; quantity: string; unit_price: string; line_total: string
    sales_invoice_line_id: string | null; purchase_invoice_line_id: string | null; created_at: string
    item_name: string | null
  }[]>`
    SELECT rl.id, rl.return_id, rl.item_id, rl.quantity, rl.unit_price, rl.line_total,
           rl.sales_invoice_line_id, rl.purchase_invoice_line_id, rl.created_at,
           ii.name AS item_name
    FROM return_lines rl
    LEFT JOIN inventory_items ii ON ii.id = rl.item_id
    WHERE rl.return_id = ${returnId}
  `

  const refundsData = await sql<any[]>`
    SELECT * FROM refunds WHERE return_id = ${returnId} AND user_id = ${currentUser.effectiveUserId}
    ORDER BY created_at DESC
  `

  const totalRefunded = refundsData.reduce((sum, r) => sum + Number(r.amount ?? 0), 0)

  return {
    id: returnData.id, return_number: returnData.return_number, type: returnData.type,
    sales_invoice_id: returnData.sales_invoice_id, purchase_invoice_id: returnData.purchase_invoice_id,
    party_id: returnData.party_id, subtotal: Number(returnData.subtotal ?? 0), tax: Number(returnData.tax ?? 0),
    total: Number(returnData.total ?? 0), status: returnData.status ?? "Draft",
    created_at: returnData.created_at, updated_at: returnData.updated_at,
    party: returnData.party_name ? { id: returnData.party_id, name: returnData.party_name, phone: returnData.party_phone } : undefined,
    lines: linesData.map((line) => ({
      id: line.id, return_id: line.return_id, item_id: line.item_id, quantity: Number(line.quantity ?? 0),
      unit_price: Number(line.unit_price ?? 0), line_total: Number(line.line_total ?? 0),
      sales_invoice_line_id: line.sales_invoice_line_id, purchase_invoice_line_id: line.purchase_invoice_line_id,
      created_at: line.created_at, item: line.item_name ? { id: line.item_id, name: line.item_name } : undefined,
    })),
    refunds: refundsData.map((refund: any) => ({
      id: refund.id, return_id: refund.return_id, amount: Number(refund.amount ?? 0),
      method: refund.method, reference: refund.reference, created_at: refund.created_at,
    })),
    total_refunded: totalRefunded,
  }
}

export async function createRefund(payload: CreateRefundInput) {
  const currentUser = await getSessionOrRedirect()

  if (!payload.return_id || !Number.isFinite(payload.amount) || payload.amount <= 0) {
    return { error: "Return ID and a positive payment amount are required", data: null }
  }

  const [returnData] = await sql<{ id: string; total: string; status: string; type: string; sales_invoice_id: string | null; purchase_invoice_id: string | null }[]>`
    SELECT id, total, status, type, sales_invoice_id, purchase_invoice_id FROM returns
    WHERE id = ${payload.return_id} AND user_id = ${currentUser.effectiveUserId}
  `
  if (!returnData) return { error: "Return not found", data: null }

  if (returnData.status !== "Completed") {
    return { error: `Cannot refund a return with status "${returnData.status}". Only Completed returns are refundable.`, data: null }
  }

  const existingRefunds = await sql<{ amount: string }[]>`
    SELECT amount FROM refunds WHERE return_id = ${payload.return_id} AND user_id = ${currentUser.effectiveUserId}
  `
  const totalRefunded = existingRefunds.reduce((sum, r) => sum + Number(r.amount ?? 0), 0)
  const returnTotal = Number(returnData.total ?? 0)

  let invoicePaid = 0
  if (returnData.type === "sale" && returnData.sales_invoice_id) {
    const salesPayments = await sql<{ amount: string }[]>`
      SELECT amount FROM payments WHERE invoice_id = ${returnData.sales_invoice_id} AND user_id = ${currentUser.effectiveUserId}
    `
    invoicePaid = salesPayments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0)
  } else if (returnData.type === "purchase" && returnData.purchase_invoice_id) {
    const purchasePayments = await sql<{ amount: string }[]>`
      SELECT amount FROM purchase_payments WHERE purchase_invoice_id = ${returnData.purchase_invoice_id} AND user_id = ${currentUser.effectiveUserId}
    `
    invoicePaid = purchasePayments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0)
  }

  const toCents = (n: number) => Math.round(n * 100)
  const remainingReturn = Math.max(0, returnTotal - totalRefunded)
  const remainingPaid = Math.max(0, invoicePaid - totalRefunded)
  const maxRefundable = Math.min(remainingReturn, remainingPaid)

  if (toCents(payload.amount) > toCents(maxRefundable)) {
    if (remainingPaid === 0) {
      return { error: `Cannot refund — no payment has been collected on the original invoice yet. Returned items should reduce the customer's outstanding balance instead of being paid out in cash.`, data: null }
    }
    return { error: `Refund amount exceeds available cap. Maximum refundable: ${maxRefundable.toFixed(2)} (return total ${returnTotal.toFixed(2)} − already refunded ${totalRefunded.toFixed(2)}, capped by amount paid on original invoice).`, data: null }
  }

  const [refundData] = await sql<{ id: string }[]>`
    INSERT INTO refunds (return_id, amount, method, reference, user_id)
    VALUES (${payload.return_id}, ${payload.amount}, ${payload.method}, ${payload.reference || null}, ${currentUser.effectiveUserId})
    RETURNING id
  `
  if (!refundData) return { error: "Unable to create refund", data: null }

  revalidatePath("/returns")
  revalidatePath("/returns/refunds")
  revalidatePath("/accounts-management")
  return { error: null, data: { refundId: refundData.id } }
}

export async function getRefunds(returnId?: string, dateFrom?: string, dateTo?: string) {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{
      id: string; return_id: string; amount: string; method: string; reference: string | null; created_at: string
      ret_id: string | null; return_number: string | null; ret_type: string | null; ret_total: string | null
      party_id: string | null; party_name: string | null
    }[]>`
      SELECT r.id, r.return_id, r.amount, r.method, r.reference, r.created_at,
             ret.id AS ret_id, ret.return_number, ret.type AS ret_type, ret.total AS ret_total,
             pa.id AS party_id, pa.name AS party_name
      FROM refunds r
      LEFT JOIN returns ret ON ret.id = r.return_id
      LEFT JOIN parties pa ON pa.id = ret.party_id
      WHERE r.user_id = ${currentUser.effectiveUserId}
        ${returnId ? sql`AND r.return_id = ${returnId}` : sql``}
        ${dateFrom ? sql`AND r.created_at >= ${dateFrom.includes("T") ? dateFrom : `${dateFrom}T00:00:00.000Z`}` : sql``}
        ${dateTo ? sql`AND r.created_at <= ${dateTo.includes("T") ? dateTo : `${dateTo}T23:59:59.999Z`}` : sql``}
      ORDER BY r.created_at DESC
    `

    return rows.map((row) => ({
      id: row.id, return_id: row.return_id, amount: Number(row.amount ?? 0),
      method: row.method, reference: row.reference, created_at: row.created_at,
      return: row.ret_id ? {
        id: row.ret_id, return_number: row.return_number, type: row.ret_type, total: Number(row.ret_total ?? 0),
        party: row.party_id ? { id: row.party_id, name: row.party_name } : undefined,
      } : undefined,
    })) as Refund & { return?: Return }[]
  } catch {
    return []
  }
}

interface InvoiceSearchResult {
  id: string; total: number; created_at: string
  parties: { id: string; name: string; phone: string } | null
}

export async function searchSalesInvoicesForReturn(query: string): Promise<InvoiceSearchResult[]> {
  const currentUser = await getSessionOrRedirect()
  const q = query.trim()
  if (!q || q.length < 2) return []

  try {
    const rows = await sql<{
      id: string; total: string; created_at: string; party_id: string | null; party_name: string | null; party_phone: string | null
    }[]>`
      SELECT si.id, si.total, si.created_at, p.id AS party_id, p.name AS party_name, p.phone AS party_phone
      FROM sales_invoices si
      LEFT JOIN parties p ON p.id = si.party_id
      WHERE si.user_id = ${currentUser.effectiveUserId}
        AND si.status = ANY(ARRAY['Paid','Pending','Credit','Partially Returned'])
        AND (si.id::text ILIKE ${q + "%"} OR p.name ILIKE ${"%" + q + "%"})
      ORDER BY si.created_at DESC
      LIMIT 50
    `
    return rows.map((row) => ({
      id: row.id, total: Number(row.total ?? 0), created_at: row.created_at,
      parties: row.party_id ? { id: row.party_id, name: row.party_name || "", phone: row.party_phone || "" } : null,
    }))
  } catch {
    return []
  }
}

export async function searchPurchaseInvoicesForReturn(query: string): Promise<InvoiceSearchResult[]> {
  const currentUser = await getSessionOrRedirect()
  const q = query.trim()
  if (!q || q.length < 2) return []

  try {
    const rows = await sql<{
      id: string; total: string; created_at: string; party_id: string | null; party_name: string | null; party_phone: string | null
    }[]>`
      SELECT pi.id, pi.total, pi.created_at, p.id AS party_id, p.name AS party_name, p.phone AS party_phone
      FROM purchase_invoices pi
      LEFT JOIN parties p ON p.id = pi.party_id
      WHERE pi.user_id = ${currentUser.effectiveUserId}
        AND pi.status != ALL(ARRAY['Draft','Cancelled'])
        AND (pi.id::text ILIKE ${q + "%"} OR p.name ILIKE ${"%" + q + "%"})
      ORDER BY pi.created_at DESC
      LIMIT 50
    `
    return rows.map((row) => ({
      id: row.id, total: Number(row.total ?? 0), created_at: row.created_at,
      parties: row.party_id ? { id: row.party_id, name: row.party_name || "", phone: row.party_phone || "" } : null,
    }))
  } catch {
    return []
  }
}

export async function deleteSaleReturn(returnId: string) {
  const currentUser = await getSessionOrRedirect()
  if (!returnId) return { error: "Return ID is required" }

  const [returnRow] = await sql<{ id: string; status: string; sales_invoice_id: string | null; total: string }[]>`
    SELECT id, status, sales_invoice_id, total FROM returns
    WHERE id = ${returnId} AND user_id = ${currentUser.effectiveUserId} AND type = 'sale'
  `
  if (!returnRow) return { error: "Sale return not found" }
  if (returnRow.status !== "Completed") return { error: `Can only delete Completed returns (this one is ${returnRow.status}).` }

  const movements = await sql<{ item_id: string; quantity: string; movement_type: string }[]>`
    SELECT item_id, quantity, movement_type FROM stock_movements
    WHERE reference_id = ${returnId} AND reference_type = 'SaleReturn' AND user_id = ${currentUser.effectiveUserId}
  `
  const netInByItem = new Map<string, number>()
  for (const m of movements) {
    const qty = Number(m.quantity ?? 0)
    if (!m.item_id || qty === 0) continue
    const delta = m.movement_type === "IN" ? qty : m.movement_type === "OUT" ? -qty : 0
    netInByItem.set(m.item_id, (netInByItem.get(m.item_id) ?? 0) + delta)
  }
  for (const [itemId, netIn] of netInByItem.entries()) {
    if (netIn <= 0) continue
    await sql`SELECT decrement_inventory_stock(${itemId}, ${netIn})`
    await recordStockMovement({
      itemId, movementType: "OUT", quantity: netIn, referenceType: "SaleReturn", referenceId: returnId,
      notes: `Sale return deleted — stock unwound`, userId: currentUser.effectiveUserId,
    })
  }

  await sql`DELETE FROM refunds WHERE return_id = ${returnId} AND user_id = ${currentUser.effectiveUserId}`
  await sql`DELETE FROM return_lines WHERE return_id = ${returnId}`
  const deleteResult = await sql`DELETE FROM returns WHERE id = ${returnId} AND user_id = ${currentUser.effectiveUserId} RETURNING id`
  if (!deleteResult.length) return { error: "Failed to delete return" }

  if (returnRow.sales_invoice_id) {
    const [invoice] = await sql<{ id: string; total: string }[]>`
      SELECT id, total FROM sales_invoices WHERE id = ${returnRow.sales_invoice_id} AND user_id = ${currentUser.effectiveUserId}
    `
    if (invoice) {
      const remainingReturns = await sql<{ total: string }[]>`
        SELECT total FROM returns WHERE sales_invoice_id = ${returnRow.sales_invoice_id} AND type = 'sale' AND status = 'Completed'
      `
      const remainingTotal = Math.round(remainingReturns.reduce((sum, r) => sum + Number(r.total ?? 0), 0) * 100)
      const invoiceTotalCents = Math.round(Number(invoice.total ?? 0) * 100)
      let newStatus: string
      if (remainingTotal >= invoiceTotalCents && invoiceTotalCents > 0) newStatus = "Returned"
      else if (remainingTotal > 0) newStatus = "Partially Returned"
      else {
        const payments = await sql<{ amount: string }[]>`
          SELECT amount FROM payments WHERE invoice_id = ${returnRow.sales_invoice_id} AND user_id = ${currentUser.effectiveUserId}
        `
        const paidCents = Math.round(payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0) * 100)
        if (paidCents >= invoiceTotalCents && invoiceTotalCents > 0) newStatus = "Paid"
        else if (paidCents > 0) newStatus = "Pending"
        else newStatus = "Credit"
      }
      await sql`UPDATE sales_invoices SET status = ${newStatus} WHERE id = ${returnRow.sales_invoice_id} AND user_id = ${currentUser.effectiveUserId}`
    }
  }

  revalidatePath("/returns")
  revalidatePath("/returns/sales")
  revalidatePath("/returns/refunds")
  revalidatePath("/pos/sales")
  revalidatePath("/accounts-management")
  revalidatePath("/dashboard")
  return { error: null }
}

export async function deletePurchaseReturn(returnId: string) {
  const currentUser = await getSessionOrRedirect()
  if (!returnId) return { error: "Return ID is required" }

  const [returnRow] = await sql<{ id: string; status: string; purchase_invoice_id: string | null; total: string }[]>`
    SELECT id, status, purchase_invoice_id, total FROM returns
    WHERE id = ${returnId} AND user_id = ${currentUser.effectiveUserId} AND type = 'purchase'
  `
  if (!returnRow) return { error: "Purchase return not found" }
  if (returnRow.status !== "Completed") return { error: `Can only delete Completed returns (this one is ${returnRow.status}).` }

  const movements = await sql<{ item_id: string; quantity: string; movement_type: string }[]>`
    SELECT item_id, quantity, movement_type FROM stock_movements
    WHERE reference_id = ${returnId} AND reference_type = 'PurchaseReturn' AND user_id = ${currentUser.effectiveUserId}
  `
  const netOutByItem = new Map<string, number>()
  for (const m of movements) {
    const qty = Number(m.quantity ?? 0)
    if (!m.item_id || qty === 0) continue
    const delta = m.movement_type === "OUT" ? qty : m.movement_type === "IN" ? -qty : 0
    netOutByItem.set(m.item_id, (netOutByItem.get(m.item_id) ?? 0) + delta)
  }
  for (const [itemId, netOut] of netOutByItem.entries()) {
    if (netOut <= 0) continue
    await sql`SELECT increment_inventory_stock(${itemId}, ${netOut})`
    await recordStockMovement({
      itemId, movementType: "IN", quantity: netOut, referenceType: "PurchaseReturn", referenceId: returnId,
      notes: `Purchase return deleted — stock unwound`, userId: currentUser.effectiveUserId,
    })
  }

  await sql`DELETE FROM refunds WHERE return_id = ${returnId} AND user_id = ${currentUser.effectiveUserId}`
  await sql`DELETE FROM return_lines WHERE return_id = ${returnId}`
  const deleteResult = await sql`DELETE FROM returns WHERE id = ${returnId} AND user_id = ${currentUser.effectiveUserId} RETURNING id`
  if (!deleteResult.length) return { error: "Failed to delete return" }

  if (returnRow.purchase_invoice_id) {
    const [invoice] = await sql<{ id: string; total: string }[]>`
      SELECT id, total FROM purchase_invoices WHERE id = ${returnRow.purchase_invoice_id} AND user_id = ${currentUser.effectiveUserId}
    `
    if (invoice) {
      const remainingReturns = await sql<{ total: string }[]>`
        SELECT total FROM returns WHERE purchase_invoice_id = ${returnRow.purchase_invoice_id} AND type = 'purchase' AND status = 'Completed'
      `
      const remainingTotal = Math.round(remainingReturns.reduce((sum, r) => sum + Number(r.total ?? 0), 0) * 100)
      const invoiceTotalCents = Math.round(Number(invoice.total ?? 0) * 100)
      let newStatus: string
      if (remainingTotal >= invoiceTotalCents && invoiceTotalCents > 0) newStatus = "Returned"
      else if (remainingTotal > 0) newStatus = "Partially Returned"
      else {
        const payments = await sql<{ amount: string }[]>`
          SELECT amount FROM purchase_payments WHERE purchase_invoice_id = ${returnRow.purchase_invoice_id} AND user_id = ${currentUser.effectiveUserId}
        `
        const paidCents = Math.round(payments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0) * 100)
        if (paidCents >= invoiceTotalCents && invoiceTotalCents > 0) newStatus = "Paid"
        else if (paidCents > 0) newStatus = "Partially Paid"
        else newStatus = "Pending"
      }
      await sql`UPDATE purchase_invoices SET status = ${newStatus} WHERE id = ${returnRow.purchase_invoice_id} AND user_id = ${currentUser.effectiveUserId}`
    }
  }

  revalidatePath("/returns")
  revalidatePath("/returns/purchases")
  revalidatePath("/returns/refunds")
  revalidatePath("/purchase-management/purchases")
  revalidatePath("/accounts-management")
  revalidatePath("/dashboard")
  return { error: null }
}
