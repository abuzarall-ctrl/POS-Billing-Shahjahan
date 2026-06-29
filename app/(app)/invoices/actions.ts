"use server"

import { revalidatePath } from "next/cache"
import sql from "@/lib/db"
import { recordStockMovement, checkStockAvailability } from "@/lib/db/stock-movements"
import { verifyPartyOwnership } from "@/lib/db/party-ownership"
import { incrementStockForLines } from "@/lib/db/stock-line-mutations"
import { getSessionOrRedirect } from "@/lib/auth"
import { getAllSettings } from "@/app/(app)/settings/actions"

/** SET-H4: read the user's configured GST rate. Falls back to 18 when not set. */
async function getDefaultManualInvoiceTaxRate(): Promise<number> {
  const settings = await getAllSettings()
  const rate = Number(settings.gst_rate ?? "")
  return Number.isFinite(rate) && rate >= 0 ? rate : 18
}

export type InvoiceItemInput = { itemId: string; quantity: number; unitPrice: number }

export async function createInvoice(payload: { partyId: string; items: InvoiceItemInput[]; taxRate?: number }) {
  const currentUser = await getSessionOrRedirect()

  if (!payload.partyId || !payload.items?.length) {
    return { error: "Customer and at least one line item are required" }
  }

  const partyCheck = await verifyPartyOwnership(payload.partyId, currentUser.effectiveUserId)
  if (!partyCheck.ok) return { error: partyCheck.error }

  const itemIds = payload.items.map((item) => item.itemId)
  const invItems = await sql<{ id: string; cost_price: string | null }[]>`
    SELECT id, cost_price FROM inventory_items
    WHERE id = ANY(${itemIds}) AND user_id = ${currentUser.effectiveUserId}
  `
  if (invItems.length !== itemIds.length) {
    return { error: "One or more items not found" }
  }

  const stockCheck = await checkStockAvailability(payload.items, currentUser.effectiveUserId)
  if (!stockCheck.ok) {
    return {
      error: `Insufficient stock for "${stockCheck.itemName}". Available: ${stockCheck.available}, Requested: ${stockCheck.requested}`,
    }
  }

  const costPriceByItemId = new Map(invItems.map((row) => [row.id, Number(row.cost_price ?? 0)]))

  const taxRate = payload.taxRate ?? (await getDefaultManualInvoiceTaxRate())
  const subtotal = payload.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const tax = subtotal * (taxRate / 100)
  const total = subtotal + tax

  const [invoice] = await sql<{ id: string }[]>`
    INSERT INTO sales_invoices (party_id, subtotal, tax, total, status, user_id)
    VALUES (${payload.partyId}, ${subtotal}, ${tax}, ${total}, 'Draft', ${currentUser.effectiveUserId})
    RETURNING id
  `
  if (!invoice) return { error: "Unable to create invoice" }

  const lineItems = payload.items.map((item) => ({
    invoice_id: invoice.id,
    item_id: item.itemId,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    line_total: item.quantity * item.unitPrice,
    cost_price: costPriceByItemId.get(item.itemId) ?? null,
  }))

  try {
    await sql`INSERT INTO sales_invoice_lines ${sql(lineItems)}`

    await Promise.all(
      payload.items.map(async (item) => {
        await sql`SELECT decrement_inventory_stock(${item.itemId}, ${item.quantity})`
        await recordStockMovement({
          itemId: item.itemId,
          movementType: "OUT",
          quantity: item.quantity,
          referenceType: "Invoice",
          referenceId: invoice.id,
          notes: `Sold via invoice ${invoice.id.substring(0, 8).toUpperCase()}`,
          userId: currentUser.effectiveUserId,
        })
      }),
    )
  } catch (error) {
    await sql`DELETE FROM sales_invoices WHERE id = ${invoice.id} AND user_id = ${currentUser.effectiveUserId}`
    return { error: error instanceof Error ? error.message : "Failed to process inventory" }
  }

  revalidatePath("/invoices")
  revalidatePath("/dashboard")
  return { error: null }
}

export async function getInvoiceForPDF(invoiceId: string) {
  const currentUser = await getSessionOrRedirect()

  const [invoice] = await sql<{
    id: string; subtotal: string; tax: string; total: string; status: string; created_at: string
    party_id: string | null; party_name: string | null; party_phone: string | null
  }[]>`
    SELECT si.id, si.subtotal, si.tax, si.total, si.status, si.created_at,
           p.id AS party_id, p.name AS party_name, p.phone AS party_phone
    FROM sales_invoices si
    LEFT JOIN parties p ON p.id = si.party_id
    WHERE si.id = ${invoiceId} AND si.user_id = ${currentUser.effectiveUserId}
  `
  if (!invoice) return { error: "Invoice not found", data: null }

  const lineItems = await sql<{
    id: string; quantity: string; unit_price: string; line_total: string
    item_id: string | null; item_name: string | null
  }[]>`
    SELECT sil.id, sil.quantity, sil.unit_price, sil.line_total,
           ii.id AS item_id, ii.name AS item_name
    FROM sales_invoice_lines sil
    LEFT JOIN inventory_items ii ON ii.id = sil.item_id
    WHERE sil.invoice_id = ${invoiceId}
  `

  const payments = await sql<{ id: string; amount: string }[]>`
    SELECT id, amount FROM payments
    WHERE invoice_id = ${invoiceId}
    ORDER BY created_at ASC
  `

  const party = invoice.party_id
    ? { name: invoice.party_name || "Unknown", phone: invoice.party_phone ?? undefined }
    : null

  const items = lineItems.map((line) => ({
    name: line.item_name || "Unknown",
    quantity: Number(line.quantity || 0),
    unitPrice: Number(line.unit_price || 0),
    lineTotal: Number(line.line_total || 0),
  }))

  const formattedPayments = payments.map((p) => ({ amount: Number(p.amount || 0) }))

  return {
    error: null,
    data: {
      id: invoice.id,
      invoiceNumber: invoice.id.substring(0, 8).toUpperCase(),
      date: invoice.created_at || new Date().toISOString(),
      party,
      subtotal: Number(invoice.subtotal || 0),
      tax: Number(invoice.tax || 0),
      total: Number(invoice.total || 0),
      status: invoice.status || "Draft",
      items,
      payments: formattedPayments.length > 0 ? formattedPayments : undefined,
    },
  }
}

export async function updateInvoice(
  invoiceId: string,
  payload: { partyId: string; items: InvoiceItemInput[]; status?: string; taxRate?: number },
) {
  const currentUser = await getSessionOrRedirect()

  if (!payload.partyId || !payload.items?.length) {
    return { error: "Customer and at least one line item are required" }
  }

  const partyCheck = await verifyPartyOwnership(payload.partyId, currentUser.effectiveUserId)
  if (!partyCheck.ok) return { error: partyCheck.error }

  const itemIds = payload.items.map((item) => item.itemId)
  const items = await sql<{ id: string }[]>`
    SELECT id FROM inventory_items
    WHERE id = ANY(${itemIds}) AND user_id = ${currentUser.effectiveUserId}
  `
  if (items.length !== itemIds.length) {
    return { error: "One or more items not found" }
  }

  const [currentInvoice] = await sql<{ status: string }[]>`
    SELECT status FROM sales_invoices
    WHERE id = ${invoiceId} AND user_id = ${currentUser.effectiveUserId}
  `
  if (!currentInvoice) return { error: "Invoice not found" }

  const currentStatus = currentInvoice.status || "Draft"
  const newStatus = payload.status || currentStatus

  const existingLines = await sql<{ item_id: string; quantity: string }[]>`
    SELECT item_id, quantity FROM sales_invoice_lines WHERE invoice_id = ${invoiceId}
  `

  if (existingLines.length > 0 && currentStatus !== "Cancelled") {
    const restoreResult = await incrementStockForLines(existingLines, {
      referenceType: "Invoice",
      referenceId: invoiceId,
      notes: `Stock restored from invoice update`,
      userId: currentUser.effectiveUserId,
    })
    if (!restoreResult.ok) return { error: restoreResult.error }
  }

  const taxRate = payload.taxRate ?? (await getDefaultManualInvoiceTaxRate())
  const subtotal = payload.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const tax = subtotal * (taxRate / 100)
  const total = subtotal + tax

  await sql`
    UPDATE sales_invoices
    SET party_id = ${payload.partyId}, subtotal = ${subtotal}, tax = ${tax}, total = ${total},
        status = ${payload.status || "Draft"}
    WHERE id = ${invoiceId} AND user_id = ${currentUser.effectiveUserId}
  `

  await sql`DELETE FROM sales_invoice_lines WHERE invoice_id = ${invoiceId}`

  const payloadItemIds = payload.items.map((item) => item.itemId)
  const invItems = await sql<{ id: string; cost_price: string | null }[]>`
    SELECT id, cost_price FROM inventory_items
    WHERE id = ANY(${payloadItemIds}) AND user_id = ${currentUser.effectiveUserId}
  `
  const costPriceByItemId = new Map(invItems.map((row) => [row.id, Number(row.cost_price ?? 0)]))

  const lineItems = payload.items.map((item) => ({
    invoice_id: invoiceId,
    item_id: item.itemId,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    line_total: item.quantity * item.unitPrice,
    cost_price: costPriceByItemId.get(item.itemId) ?? null,
  }))

  await sql`INSERT INTO sales_invoice_lines ${sql(lineItems)}`

  if (newStatus !== "Cancelled") {
    try {
      for (const item of payload.items) {
        const [invItem] = await sql<{ stock: string }[]>`
          SELECT stock FROM inventory_items
          WHERE id = ${item.itemId} AND user_id = ${currentUser.effectiveUserId}
        `
        if (invItem) {
          await sql`SELECT decrement_inventory_stock(${item.itemId}, ${item.quantity})`
          await recordStockMovement({
            itemId: item.itemId,
            movementType: "OUT",
            quantity: item.quantity,
            referenceType: "Invoice",
            referenceId: invoiceId,
            notes: `Sold via invoice ${invoiceId.substring(0, 8).toUpperCase()}`,
            userId: currentUser.effectiveUserId,
          })
        }
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Failed to process inventory" }
    }
  }

  revalidatePath("/invoices")
  revalidatePath("/dashboard")
  return { error: null }
}

export async function getInvoiceForEdit(invoiceId: string) {
  const currentUser = await getSessionOrRedirect()

  const [invoice] = await sql<{
    id: string; party_id: string; subtotal: string; tax: string; total: string; status: string; created_at: string
  }[]>`
    SELECT id, party_id, subtotal, tax, total, status, created_at
    FROM sales_invoices
    WHERE id = ${invoiceId} AND user_id = ${currentUser.effectiveUserId}
  `
  if (!invoice) return { error: "Invoice not found", data: null }

  const lineItems = await sql<{ item_id: string; quantity: string; unit_price: string }[]>`
    SELECT item_id, quantity, unit_price FROM sales_invoice_lines WHERE invoice_id = ${invoiceId}
  `

  const subtotal = Number(invoice.subtotal || 0)
  const tax = Number(invoice.tax || 0)
  const taxRate = subtotal > 0 ? (tax / subtotal) * 100 : 18

  return {
    error: null,
    data: {
      id: invoice.id,
      partyId: invoice.party_id,
      status: invoice.status || "Draft",
      taxRate,
      items: lineItems.map((line) => ({
        itemId: line.item_id,
        quantity: Number(line.quantity || 0),
        unitPrice: Number(line.unit_price || 0),
      })),
    },
  }
}

export async function deleteInvoice(invoiceId: string) {
  const currentUser = await getSessionOrRedirect()

  if (!invoiceId) return { error: "Invoice ID is required" }

  const [invoice] = await sql<{ id: string; status: string }[]>`
    SELECT id, status FROM sales_invoices
    WHERE id = ${invoiceId} AND user_id = ${currentUser.effectiveUserId}
  `
  if (!invoice) return { error: "Invoice not found" }

  const existingLines = await sql<{ item_id: string; quantity: string }[]>`
    SELECT item_id, quantity FROM sales_invoice_lines WHERE invoice_id = ${invoiceId}
  `

  if (existingLines.length > 0 && invoice.status !== "Cancelled") {
    const restoreResult = await incrementStockForLines(existingLines, {
      referenceType: "Invoice",
      referenceId: invoiceId,
      notes: `Stock restored from invoice deletion`,
      userId: currentUser.effectiveUserId,
    })
    if (!restoreResult.ok) return { error: restoreResult.error }
  }

  await sql`DELETE FROM sales_invoice_lines WHERE invoice_id = ${invoiceId}`
  await sql`DELETE FROM sales_invoices WHERE id = ${invoiceId} AND user_id = ${currentUser.effectiveUserId}`

  revalidatePath("/invoices")
  revalidatePath("/dashboard")
  return { error: null }
}
