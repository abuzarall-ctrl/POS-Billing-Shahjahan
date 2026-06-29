"use server"

import { revalidatePath } from "next/cache"
import sql from "@/lib/db"
import { recordStockMovement, checkStockAvailability } from "@/lib/db/stock-movements"
import { verifyPartyOwnership } from "@/lib/db/party-ownership"
import { incrementStockForLines } from "@/lib/db/stock-line-mutations"
import { recalcInvoicePaymentStatus } from "@/lib/db/invoice-payment-status"
import { getSessionOrRedirect } from "@/lib/auth"

export type POSItemInput = {
  itemId: string
  quantity: number
  unitPrice: number
  discount?: number
}

// ─── POS Sales ─────────────────────────────────────────────────────────────────

export async function createPOSSale(payload: {
  items: POSItemInput[]
  partyId?: string | null
  taxRate?: number
  paymentMethod?: string
  paymentAmount?: number
  discount?: number
  notes?: string
  isDraft?: boolean
}) {
  const currentUser = await getSessionOrRedirect()

  if (!payload.items?.length) {
    return { error: "At least one item is required", data: null }
  }

  const userId = currentUser.effectiveUserId

  if (payload.partyId) {
    const partyCheck = await verifyPartyOwnership(payload.partyId, userId)
    if (!partyCheck.ok) return { error: partyCheck.error, data: null }
  }

  const itemIds = payload.items.map((i) => i.itemId)
  const invItems = await sql<{ id: string; cost_price: string | null; stock: string }[]>`
    SELECT id, cost_price, stock FROM inventory_items
    WHERE id = ANY(${itemIds}) AND user_id = ${userId}
  `
  if (invItems.length !== itemIds.length) {
    return { error: "One or more items not found", data: null }
  }

  if (!payload.isDraft) {
    const stockCheck = await checkStockAvailability(payload.items, userId)
    if (!stockCheck.ok) {
      return {
        error: `Insufficient stock for "${stockCheck.itemName}". Available: ${stockCheck.available}, Requested: ${stockCheck.requested}`,
        data: null,
      }
    }
  }

  const costByItemId = new Map(invItems.map((row) => [row.id, Number(row.cost_price ?? 0)]))
  const taxRate = payload.taxRate ?? 0
  const itemDiscount = payload.discount ?? 0

  const subtotal = payload.items.reduce((sum, item) => {
    const linePrice = item.unitPrice * item.quantity
    const lineDiscount = (item.discount ?? 0) * item.quantity
    return sum + linePrice - lineDiscount
  }, 0)
  const discountedSubtotal = subtotal - itemDiscount
  const tax = discountedSubtotal * (taxRate / 100)
  const total = discountedSubtotal + tax

  const paymentMethod = payload.paymentMethod || "Cash"
  const paymentAmount = payload.paymentAmount ?? total

  let status: string
  if (payload.isDraft) {
    status = "Draft"
  } else {
    const cents = (n: number) => Math.round(n * 100)
    if (cents(paymentAmount) >= cents(total)) status = "Paid"
    else if (paymentAmount > 0) status = "Pending"
    else if (payload.partyId) status = "Credit"
    else status = "Pending"
  }

  const [invoice] = await sql<{ id: string }[]>`
    INSERT INTO sales_invoices (party_id, subtotal, tax, total, status, notes, source, user_id)
    VALUES (${payload.partyId || null}, ${subtotal}, ${tax}, ${total}, ${status}, ${payload.notes || null}, 'pos', ${userId})
    RETURNING id
  `
  if (!invoice) return { error: "Unable to create POS sale", data: null }

  const lineItems = payload.items.map((item) => ({
    invoice_id: invoice.id,
    item_id: item.itemId,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    discount: item.discount ?? 0,
    line_total: (item.unitPrice - (item.discount ?? 0)) * item.quantity,
    cost_price: costByItemId.get(item.itemId) ?? null,
  }))

  try {
    await sql`INSERT INTO sales_invoice_lines ${sql(lineItems)}`

    if (!payload.isDraft) {
      await Promise.all(
        payload.items.map(async (item) => {
          await sql`SELECT decrement_inventory_stock(${item.itemId}, ${item.quantity})`
          await recordStockMovement({
            itemId: item.itemId, movementType: "OUT", quantity: item.quantity,
            referenceType: "POSSale", referenceId: invoice.id,
            notes: `POS Sale ${invoice.id.substring(0, 8).toUpperCase()}`, userId,
          })
        }),
      )

      if (paymentAmount > 0) {
        await sql`
          INSERT INTO payments (invoice_id, amount, method, user_id)
          VALUES (${invoice.id}, ${paymentAmount}, ${paymentMethod}, ${userId})
        `
      }
    }
  } catch (error) {
    await sql`DELETE FROM sales_invoices WHERE id = ${invoice.id} AND user_id = ${userId}`
    return { error: error instanceof Error ? error.message : "Failed to process sale", data: null }
  }

  revalidatePath("/pos")
  revalidatePath("/dashboard")
  return { error: null, data: { invoiceId: invoice.id, change: paymentAmount - total, status } }
}

export async function getPOSSales(options?: {
  partyId?: string; status?: string; dateFrom?: string; dateTo?: string; source?: string
}) {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{
      id: string; party_id: string | null; subtotal: string; tax: string; total: string
      status: string; notes: string | null; source: string | null; created_at: string
      party_name: string | null; party_phone: string | null
    }[]>`
      SELECT si.id, si.party_id, si.subtotal, si.tax, si.total, si.status, si.notes, si.source, si.created_at,
             p.name AS party_name, p.phone AS party_phone
      FROM sales_invoices si
      LEFT JOIN parties p ON p.id = si.party_id
      WHERE si.user_id = ${currentUser.effectiveUserId}
        AND si.source = ${options?.source || "pos"}
        ${options?.partyId ? sql`AND si.party_id = ${options.partyId}` : sql``}
        ${options?.status ? sql`AND si.status = ${options.status}` : sql``}
        ${options?.dateFrom ? sql`AND si.created_at >= ${options.dateFrom}` : sql``}
        ${options?.dateTo ? sql`AND si.created_at <= ${options.dateTo}` : sql``}
      ORDER BY si.created_at DESC
    `

    return rows.map((row) => ({
      id: row.id, partyId: row.party_id, subtotal: Number(row.subtotal || 0), tax: Number(row.tax || 0),
      total: Number(row.total || 0), status: row.status || "Draft", notes: row.notes, source: row.source,
      created_at: row.created_at,
      party: row.party_name ? { id: row.party_id!, name: row.party_name, phone: row.party_phone } : null,
    }))
  } catch {
    return []
  }
}

export async function getUserPrintFormat(): Promise<string | null> {
  const currentUser = await getSessionOrRedirect()

  const [row] = await sql<{ value: string }[]>`
    SELECT value FROM user_settings
    WHERE user_id = ${currentUser.effectiveUserId} AND key = 'print_format'
  `
  return row?.value ?? null
}

export async function setUserPrintFormat(format: string): Promise<{ error: string | null }> {
  const currentUser = await getSessionOrRedirect()

  try {
    await sql`
      INSERT INTO user_settings (user_id, key, value)
      VALUES (${currentUser.effectiveUserId}, 'print_format', ${format})
      ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
    `
    return { error: null }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to save print format" }
  }
}

export async function getPartyOutstandingBalance(partyId: string): Promise<number> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  const invoices = await sql<{ id: string; total: string; status: string }[]>`
    SELECT id, total, status FROM sales_invoices
    WHERE party_id = ${partyId} AND user_id = ${userId} AND status != 'Cancelled'
  `
  const invoiceIds = invoices.filter((i) => i.status !== "Draft").map((i) => i.id)
  const totalSales = invoices
    .filter((i) => i.status !== "Draft")
    .reduce((sum, i) => sum + Number(i.total || 0), 0)

  let totalPaid = 0
  if (invoiceIds.length > 0) {
    const payments = await sql<{ amount: string }[]>`
      SELECT amount FROM payments WHERE invoice_id = ANY(${invoiceIds}) AND user_id = ${userId}
    `
    totalPaid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  }

  const saleReturns = await sql<{ total: string }[]>`
    SELECT total FROM returns
    WHERE party_id = ${partyId} AND user_id = ${userId} AND type = 'sale' AND status = 'Completed'
  `
  const totalReturns = saleReturns.reduce((sum, r) => sum + Number(r.total || 0), 0)

  return Math.max(0, totalSales - totalPaid - totalReturns)
}

export async function getInvoiceForPrint(invoiceId: string) {
  const currentUser = await getSessionOrRedirect()

  const [invoice] = await sql<{
    id: string; party_id: string | null; subtotal: string; tax: string; total: string
    status: string; notes: string | null; source: string | null; created_at: string
    party_name: string | null; party_phone: string | null; party_address: string | null
  }[]>`
    SELECT si.id, si.party_id, si.subtotal, si.tax, si.total, si.status, si.notes, si.source, si.created_at,
           p.name AS party_name, p.phone AS party_phone, p.address AS party_address
    FROM sales_invoices si
    LEFT JOIN parties p ON p.id = si.party_id
    WHERE si.id = ${invoiceId} AND si.user_id = ${currentUser.effectiveUserId}
  `
  if (!invoice) return { error: "Invoice not found", data: null }

  const lineItems = await sql<{
    id: string; item_id: string | null; quantity: string; unit_price: string; discount: string | null; line_total: string
    item_name: string | null; barcode: string | null
  }[]>`
    SELECT sil.id, sil.item_id, sil.quantity, sil.unit_price, sil.discount, sil.line_total,
           ii.name AS item_name, ii.barcode
    FROM sales_invoice_lines sil
    LEFT JOIN inventory_items ii ON ii.id = sil.item_id
    WHERE sil.invoice_id = ${invoiceId}
  `

  const payments = await sql<{ id: string; amount: string; method: string; created_at: string }[]>`
    SELECT id, amount, method, created_at FROM payments
    WHERE invoice_id = ${invoiceId} ORDER BY created_at ASC
  `

  return {
    error: null,
    data: {
      id: invoice.id,
      invoiceNumber: invoice.id.substring(0, 8).toUpperCase(),
      date: invoice.created_at, notes: invoice.notes, source: invoice.source,
      subtotal: Number(invoice.subtotal || 0), tax: Number(invoice.tax || 0), total: Number(invoice.total || 0),
      status: invoice.status || "Draft",
      party: invoice.party_id ? {
        id: invoice.party_id, name: invoice.party_name || "Walk-in",
        phone: invoice.party_phone, address: invoice.party_address,
      } : null,
      items: lineItems.map((line) => ({
        id: line.id, itemId: line.item_id, name: line.item_name || "Unknown", barcode: line.barcode,
        quantity: Number(line.quantity || 0), unitPrice: Number(line.unit_price || 0),
        discount: Number(line.discount || 0), lineTotal: Number(line.line_total || 0),
      })),
      payments: payments.map((p) => ({ id: p.id, amount: Number(p.amount || 0), method: p.method, created_at: p.created_at })),
    },
  }
}

export async function getStoreSettings() {
  const currentUser = await getSessionOrRedirect()

  const rows = await sql<{ key: string; value: string }[]>`
    SELECT key, value FROM user_settings
    WHERE user_id = ${currentUser.effectiveUserId}
      AND key = ANY(ARRAY['store_name','store_address','store_phone','store_logo_url','currency','gst_rate','print_format'])
  `

  const settings: Record<string, string> = {}
  rows.forEach((row) => {
    settings[row.key] = row.value
  })
  return settings
}

// ─── Customer Payments ──────────────────────────────────────────────────────────

export async function createCustomerPayment(payload: {
  invoiceId: string
  amount: number
  method: string
  reference?: string
}) {
  const currentUser = await getSessionOrRedirect()

  if (!payload.invoiceId || !Number.isFinite(payload.amount) || payload.amount <= 0) {
    return { error: "Invoice ID and positive amount are required", data: null }
  }

  const [invoice] = await sql<{ id: string; total: string; status: string; source: string | null }[]>`
    SELECT id, total, status, source FROM sales_invoices
    WHERE id = ${payload.invoiceId} AND user_id = ${currentUser.effectiveUserId}
  `
  if (!invoice) return { error: "Invoice not found", data: null }

  if (invoice.status === "Cancelled") {
    return { error: "Cannot add payment to a cancelled invoice", data: null }
  }

  const existingPayments = await sql<{ amount: string }[]>`
    SELECT amount FROM payments WHERE invoice_id = ${payload.invoiceId} AND user_id = ${currentUser.effectiveUserId}
  `
  const totalPaid = existingPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  const remaining = Number(invoice.total || 0) - totalPaid

  if (payload.amount > remaining + 0.001) {
    return { error: `Payment amount (${payload.amount.toFixed(2)}) exceeds outstanding balance (${remaining.toFixed(2)})`, data: null }
  }

  const [payment] = await sql<{ id: string }[]>`
    INSERT INTO payments (invoice_id, amount, method, reference, user_id)
    VALUES (${payload.invoiceId}, ${payload.amount}, ${payload.method}, ${payload.reference || null}, ${currentUser.effectiveUserId})
    RETURNING id
  `
  if (!payment) return { error: "Unable to create payment", data: null }

  await recalcInvoicePaymentStatus("sale", { invoiceId: payload.invoiceId, userId: currentUser.effectiveUserId })

  revalidatePath("/pos/sales")
  revalidatePath("/invoices")
  revalidatePath("/accounts-management")
  return { error: null, data: { paymentId: payment.id } }
}

export async function getCustomerPayments(invoiceId: string) {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{
      id: string; invoice_id: string; amount: string; method: string; reference: string | null; created_at: string
    }[]>`
      SELECT id, invoice_id, amount, method, reference, created_at
      FROM payments
      WHERE invoice_id = ${invoiceId} AND user_id = ${currentUser.effectiveUserId}
      ORDER BY created_at DESC
    `
    return rows.map((row) => ({
      id: row.id, invoiceId: row.invoice_id, amount: Number(row.amount || 0),
      method: row.method, reference: row.reference, created_at: row.created_at,
    }))
  } catch {
    return []
  }
}

export async function deleteCustomerPayment(paymentId: string) {
  const currentUser = await getSessionOrRedirect()

  if (!paymentId) return { error: "Payment ID is required" }

  const [payment] = await sql<{ id: string; invoice_id: string }[]>`
    SELECT id, invoice_id FROM payments WHERE id = ${paymentId} AND user_id = ${currentUser.effectiveUserId}
  `
  if (!payment) return { error: "Payment not found" }

  await sql`DELETE FROM payments WHERE id = ${paymentId} AND user_id = ${currentUser.effectiveUserId}`
  await recalcInvoicePaymentStatus("sale", { invoiceId: payment.invoice_id, userId: currentUser.effectiveUserId })

  revalidatePath("/pos/sales")
  revalidatePath("/invoices")
  revalidatePath("/accounts-management")
  return { error: null }
}

export async function getAllCustomerPayments(options?: { partyId?: string; dateFrom?: string; dateTo?: string }) {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{
      id: string; invoice_id: string; amount: string; method: string; reference: string | null; created_at: string
    }[]>`
      SELECT p.id, p.invoice_id, p.amount, p.method, p.reference, p.created_at
      FROM payments p
      ${options?.partyId ? sql`INNER JOIN sales_invoices si ON si.id = p.invoice_id AND si.party_id = ${options.partyId}` : sql``}
      WHERE p.user_id = ${currentUser.effectiveUserId}
        ${options?.dateFrom ? sql`AND p.created_at >= ${options.dateFrom}` : sql``}
        ${options?.dateTo ? sql`AND p.created_at <= ${options.dateTo}` : sql``}
      ORDER BY p.created_at DESC
    `
    return {
      error: null,
      data: rows.map((row) => ({
        id: row.id, invoiceId: row.invoice_id, amount: Number(row.amount || 0),
        method: row.method, reference: row.reference, created_at: row.created_at,
      })),
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch payments", data: [] }
  }
}

export async function getCustomerRefundsSummary(partyId: string) {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  const refunds = await sql<{ amount: string; created_at: string }[]>`
    SELECT rf.amount, rf.created_at
    FROM refunds rf
    INNER JOIN returns ret ON ret.id = rf.return_id
    WHERE rf.user_id = ${userId} AND ret.party_id = ${partyId} AND ret.type = 'sale'
    ORDER BY rf.created_at DESC
  `

  return {
    totalRefunded: refunds.reduce((sum, r) => sum + Number(r.amount || 0), 0),
    refunds: refunds.map((r) => ({ amount: Number(r.amount || 0), created_at: r.created_at })),
  }
}

export async function getPaidSales(dateFrom?: string, dateTo?: string) {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{
      id: string; party_id: string | null; total: string; status: string; source: string | null
      created_at: string; party_name: string | null
    }[]>`
      SELECT si.id, si.party_id, si.total, si.status, si.source, si.created_at, p.name AS party_name
      FROM sales_invoices si
      LEFT JOIN parties p ON p.id = si.party_id
      WHERE si.user_id = ${currentUser.effectiveUserId}
        AND si.status = 'Paid'
        ${dateFrom ? sql`AND si.created_at >= ${dateFrom}` : sql``}
        ${dateTo ? sql`AND si.created_at <= ${dateTo}` : sql``}
      ORDER BY si.created_at DESC
    `
    return rows.map((row) => ({
      id: row.id, partyId: row.party_id, total: Number(row.total || 0),
      status: row.status || "Paid", source: row.source, created_at: row.created_at,
      customerName: row.party_name || "Walk-in",
    }))
  } catch {
    return []
  }
}

export async function getUnpaidPOSSales() {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{
      id: string; party_id: string | null; total: string; status: string; created_at: string
      party_name: string | null; party_phone: string | null
    }[]>`
      SELECT si.id, si.party_id, si.total, si.status, si.created_at, p.name AS party_name, p.phone AS party_phone
      FROM sales_invoices si
      LEFT JOIN parties p ON p.id = si.party_id
      WHERE si.user_id = ${currentUser.effectiveUserId}
        AND si.source = 'pos'
        AND si.status = ANY(ARRAY['Pending','Credit','Partial'])
      ORDER BY si.created_at DESC
    `
    return rows.map((row) => ({
      id: row.id, partyId: row.party_id, total: Number(row.total || 0),
      status: row.status, created_at: row.created_at,
      party: row.party_id ? { id: row.party_id, name: row.party_name || "", phone: row.party_phone } : null,
    }))
  } catch {
    return []
  }
}

export async function getPOSSaleForEdit(invoiceId: string) {
  const currentUser = await getSessionOrRedirect()

  const [invoice] = await sql<{
    id: string; party_id: string | null; subtotal: string; tax: string; total: string
    status: string; notes: string | null; source: string | null; created_at: string
  }[]>`
    SELECT id, party_id, subtotal, tax, total, status, notes, source, created_at
    FROM sales_invoices
    WHERE id = ${invoiceId} AND user_id = ${currentUser.effectiveUserId}
  `
  if (!invoice) return { error: "Sale not found", data: null }

  if (invoice.status !== "Draft") {
    return { error: "Only Draft sales can be edited", data: null }
  }

  const lineItems = await sql<{
    item_id: string; quantity: string; unit_price: string; discount: string | null
    item_name: string | null; barcode: string | null; stock: string | null
  }[]>`
    SELECT sil.item_id, sil.quantity, sil.unit_price, sil.discount,
           ii.name AS item_name, ii.barcode, ii.stock
    FROM sales_invoice_lines sil
    LEFT JOIN inventory_items ii ON ii.id = sil.item_id
    WHERE sil.invoice_id = ${invoiceId}
  `

  const subtotal = Number(invoice.subtotal || 0)
  const tax = Number(invoice.tax || 0)
  const taxRate = subtotal > 0 ? (tax / subtotal) * 100 : 0

  return {
    error: null,
    data: {
      id: invoice.id, partyId: invoice.party_id, status: invoice.status,
      notes: invoice.notes, taxRate, source: invoice.source, created_at: invoice.created_at,
      items: lineItems.map((line) => ({
        itemId: line.item_id, itemName: line.item_name || "Unknown", barcode: line.barcode,
        quantity: Number(line.quantity || 0), unitPrice: Number(line.unit_price || 0),
        discount: Number(line.discount || 0), stock: Number(line.stock || 0),
      })),
    },
  }
}

export async function updatePOSSale(
  invoiceId: string,
  payload: {
    items: POSItemInput[]
    partyId?: string | null
    taxRate?: number
    paymentMethod?: string
    paymentAmount?: number
    discount?: number
    notes?: string
    confirmSale?: boolean
  },
) {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  const [currentInvoice] = await sql<{ id: string; status: string; source: string | null }[]>`
    SELECT id, status, source FROM sales_invoices WHERE id = ${invoiceId} AND user_id = ${userId}
  `
  if (!currentInvoice) return { error: "Sale not found" }
  if (currentInvoice.status !== "Draft") return { error: "Only Draft sales can be edited" }

  if (payload.partyId) {
    const partyCheck = await verifyPartyOwnership(payload.partyId, userId)
    if (!partyCheck.ok) return { error: partyCheck.error }
  }

  const existingLines = await sql<{ item_id: string; quantity: string }[]>`
    SELECT item_id, quantity FROM sales_invoice_lines WHERE invoice_id = ${invoiceId}
  `

  const taxRate = payload.taxRate ?? 0
  const itemDiscount = payload.discount ?? 0

  const subtotal = payload.items.reduce((sum, item) => {
    const linePrice = item.unitPrice * item.quantity
    const lineDiscount = (item.discount ?? 0) * item.quantity
    return sum + linePrice - lineDiscount
  }, 0)
  const discountedSubtotal = subtotal - itemDiscount
  const tax = discountedSubtotal * (taxRate / 100)
  const total = discountedSubtotal + tax
  const paymentMethod = payload.paymentMethod || "Cash"
  const paymentAmount = payload.paymentAmount ?? total

  let status: string
  if (payload.confirmSale) {
    const cents = (n: number) => Math.round(n * 100)
    if (cents(paymentAmount) >= cents(total)) status = "Paid"
    else if (paymentAmount > 0) status = "Pending"
    else if (payload.partyId) status = "Credit"
    else status = "Pending"
  } else {
    status = "Draft"
  }

  await sql`
    UPDATE sales_invoices
    SET party_id = ${payload.partyId ?? null}, subtotal = ${subtotal}, tax = ${tax}, total = ${total},
        status = ${status}, notes = ${payload.notes || null}
    WHERE id = ${invoiceId} AND user_id = ${userId}
  `
  await sql`DELETE FROM sales_invoice_lines WHERE invoice_id = ${invoiceId}`

  const itemIds = payload.items.map((i) => i.itemId)
  const invItems = await sql<{ id: string; cost_price: string | null }[]>`
    SELECT id, cost_price FROM inventory_items WHERE id = ANY(${itemIds}) AND user_id = ${userId}
  `
  const costByItemId = new Map(invItems.map((row) => [row.id, Number(row.cost_price ?? 0)]))

  const lineItems = payload.items.map((item) => ({
    invoice_id: invoiceId, item_id: item.itemId, quantity: item.quantity, unit_price: item.unitPrice,
    discount: item.discount ?? 0, line_total: (item.unitPrice - (item.discount ?? 0)) * item.quantity,
    cost_price: costByItemId.get(item.itemId) ?? null,
  }))
  await sql`INSERT INTO sales_invoice_lines ${sql(lineItems)}`

  if (payload.confirmSale) {
    await Promise.all(
      payload.items.map(async (item) => {
        await sql`SELECT decrement_inventory_stock(${item.itemId}, ${item.quantity})`
        await recordStockMovement({
          itemId: item.itemId, movementType: "OUT", quantity: item.quantity,
          referenceType: "POSSale", referenceId: invoiceId,
          notes: `POS Sale ${invoiceId.substring(0, 8).toUpperCase()}`, userId,
        })
      }),
    )

    if (paymentAmount > 0) {
      await sql`
        INSERT INTO payments (invoice_id, amount, method, user_id)
        VALUES (${invoiceId}, ${paymentAmount}, ${paymentMethod}, ${userId})
      `
    }
  }

  revalidatePath("/pos")
  revalidatePath("/pos/sales")
  return { error: null }
}

export async function deletePOSDraft(invoiceId: string) {
  const currentUser = await getSessionOrRedirect()

  if (!invoiceId) return { error: "Invoice ID is required" }

  const [invoice] = await sql<{ id: string; status: string }[]>`
    SELECT id, status FROM sales_invoices WHERE id = ${invoiceId} AND user_id = ${currentUser.effectiveUserId}
  `
  if (!invoice) return { error: "Sale not found" }
  if (invoice.status !== "Draft") return { error: "Only Draft sales can be deleted this way" }

  await sql`DELETE FROM sales_invoice_lines WHERE invoice_id = ${invoiceId}`
  await sql`DELETE FROM sales_invoices WHERE id = ${invoiceId} AND user_id = ${currentUser.effectiveUserId}`

  revalidatePath("/pos")
  revalidatePath("/pos/sales")
  return { error: null }
}

export async function quickCreateCustomer(payload: { name: string; phone?: string; address?: string }) {
  const currentUser = await getSessionOrRedirect()

  if (!payload.name?.trim()) return { error: "Customer name is required", data: null }

  const [party] = await sql<{ id: string; name: string; phone: string | null }[]>`
    INSERT INTO parties (name, phone, address, type, user_id)
    VALUES (${payload.name.trim()}, ${payload.phone || null}, ${payload.address || null}, 'Customer', ${currentUser.effectiveUserId})
    RETURNING id, name, phone
  `
  if (!party) return { error: "Unable to create customer", data: null }

  revalidatePath("/parties")
  return { error: null, data: { id: party.id, name: party.name, phone: party.phone } }
}
