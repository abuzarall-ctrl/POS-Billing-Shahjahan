"use server"

import { revalidatePath } from "next/cache"
import sql from "@/lib/db"
import { verifyPartyOwnership } from "@/lib/db/party-ownership"
import { incrementStockForLines } from "@/lib/db/stock-line-mutations"
import { recalcInvoicePaymentStatus } from "@/lib/db/invoice-payment-status"
import { recordStockMovement } from "@/lib/db/stock-movements"
import { resolveAvailableBarcode } from "@/lib/db/barcode-collision"
import { getSessionOrRedirect } from "@/lib/auth"

export type PurchaseItemInput = {
  itemId?: string
  itemName?: string
  barcode?: string
  quantity: number
  unitCost: number
  sellingPrice?: number
  isNew?: boolean
}

async function upsertPurchaseInvoiceLines(
  purchaseId: string,
  items: PurchaseItemInput[],
  userId: string,
): Promise<string | null> {
  const lineItems = items.map((item) => ({
    purchase_invoice_id: purchaseId,
    item_id: item.itemId ?? null,
    quantity: item.quantity,
    unit_cost: item.unitCost,
    line_total: item.quantity * item.unitCost,
  }))
  await sql`INSERT INTO purchase_invoice_lines ${sql(lineItems)}`
  return null
}

export async function createPurchase(payload: {
  partyId: string
  items: PurchaseItemInput[]
  taxRate?: number
  status?: string
  notes?: string
}) {
  const currentUser = await getSessionOrRedirect()

  if (!payload.partyId || !payload.items?.length) {
    return { error: "Vendor and at least one line item are required", data: null }
  }

  const partyCheck = await verifyPartyOwnership(payload.partyId, currentUser.effectiveUserId)
  if (!partyCheck.ok) return { error: partyCheck.error, data: null }

  const userId = currentUser.effectiveUserId
  const resolvedItemIds: string[] = []
  const newItemIds: string[] = []

  for (const item of payload.items) {
    if (item.isNew) {
      const resolvedBarcode = item.barcode
        ? await resolveAvailableBarcode(item.barcode, userId)
        : null

      const [newItem] = await sql<{ id: string }[]>`
        INSERT INTO inventory_items (name, barcode, cost_price, selling_price, stock, user_id)
        VALUES (${item.itemName || "New Item"}, ${resolvedBarcode}, ${item.unitCost}, ${item.sellingPrice ?? item.unitCost}, 0, ${userId})
        RETURNING id
      `
      if (!newItem) return { error: "Failed to create new inventory item", data: null }
      item.itemId = newItem.id
      newItemIds.push(newItem.id)
    }
    if (!item.itemId) return { error: "Item ID is required for existing items", data: null }
    resolvedItemIds.push(item.itemId)
  }

  const existingItems = await sql<{ id: string }[]>`
    SELECT id FROM inventory_items WHERE id = ANY(${resolvedItemIds}) AND user_id = ${userId}
  `
  if (existingItems.length !== resolvedItemIds.length) {
    return { error: "One or more items not found", data: null }
  }

  const taxRate = payload.taxRate ?? 0
  const subtotal = payload.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0)
  const tax = subtotal * (taxRate / 100)
  const total = subtotal + tax
  const status = payload.status || "Pending"

  const [purchase] = await sql<{ id: string; purchase_number: string }[]>`
    INSERT INTO purchase_invoices (party_id, subtotal, tax, total, status, notes, user_id)
    VALUES (${payload.partyId}, ${subtotal}, ${tax}, ${total}, ${status}, ${payload.notes || null}, ${userId})
    RETURNING id, purchase_number
  `
  if (!purchase) return { error: "Unable to create purchase", data: null }

  const lineErr = await upsertPurchaseInvoiceLines(purchase.id, payload.items, userId)
  if (lineErr) return { error: lineErr, data: null }

  try {
    await Promise.all(
      payload.items.map(async (item) => {
        await sql`SELECT increment_inventory_stock(${item.itemId!}, ${item.quantity})`
        if (item.sellingPrice && item.sellingPrice > 0) {
          await sql`UPDATE inventory_items SET selling_price = ${item.sellingPrice}, cost_price = ${item.unitCost} WHERE id = ${item.itemId!} AND user_id = ${userId}`
        } else {
          await sql`UPDATE inventory_items SET cost_price = ${item.unitCost} WHERE id = ${item.itemId!} AND user_id = ${userId}`
        }
        await recordStockMovement({
          itemId: item.itemId!, movementType: "IN", quantity: item.quantity,
          referenceType: "Purchase", referenceId: purchase.id,
          notes: `Purchase ${purchase.purchase_number}`, userId,
        })
      }),
    )
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to process inventory", data: null }
  }

  revalidatePath("/purchase-management/purchases")
  revalidatePath("/dashboard")
  return { error: null, data: { purchaseId: purchase.id, purchaseNumber: purchase.purchase_number } }
}

export async function getPurchaseForPDF(purchaseId: string) {
  const currentUser = await getSessionOrRedirect()

  const [purchase] = await sql<{
    id: string; purchase_number: string; subtotal: string; tax: string; total: string; status: string; created_at: string
    notes: string | null; party_id: string | null; party_name: string | null; party_phone: string | null
  }[]>`
    SELECT pi.id, pi.purchase_number, pi.subtotal, pi.tax, pi.total, pi.status, pi.created_at, pi.notes,
           p.id AS party_id, p.name AS party_name, p.phone AS party_phone
    FROM purchase_invoices pi
    LEFT JOIN parties p ON p.id = pi.party_id
    WHERE pi.id = ${purchaseId} AND pi.user_id = ${currentUser.effectiveUserId}
  `
  if (!purchase) return { error: "Purchase not found", data: null }

  const lineItems = await sql<{
    id: string; quantity: string; unit_cost: string; line_total: string
    item_id: string | null; item_name: string | null
  }[]>`
    SELECT pil.id, pil.quantity, pil.unit_cost, pil.line_total,
           ii.id AS item_id, ii.name AS item_name
    FROM purchase_invoice_lines pil
    LEFT JOIN inventory_items ii ON ii.id = pil.item_id
    WHERE pil.purchase_invoice_id = ${purchaseId}
  `

  const payments = await sql<{ id: string; amount: string; method: string }[]>`
    SELECT id, amount, method FROM purchase_payments
    WHERE purchase_invoice_id = ${purchaseId} ORDER BY created_at ASC
  `

  const vendor = purchase.party_id
    ? { name: purchase.party_name || "Unknown", phone: purchase.party_phone ?? undefined }
    : null

  return {
    error: null,
    data: {
      id: purchase.id, purchaseNumber: purchase.purchase_number,
      date: purchase.created_at || new Date().toISOString(),
      vendor, notes: purchase.notes,
      subtotal: Number(purchase.subtotal || 0), tax: Number(purchase.tax || 0), total: Number(purchase.total || 0),
      status: purchase.status || "Draft",
      items: lineItems.map((line) => ({
        name: line.item_name || "Unknown", quantity: Number(line.quantity || 0),
        unitCost: Number(line.unit_cost || 0), lineTotal: Number(line.line_total || 0),
      })),
      payments: payments.length > 0 ? payments.map((p) => ({ amount: Number(p.amount || 0), method: p.method })) : undefined,
    },
  }
}

export async function updatePurchase(
  purchaseId: string,
  payload: { partyId: string; items: PurchaseItemInput[]; taxRate?: number; status?: string; notes?: string },
) {
  const currentUser = await getSessionOrRedirect()

  if (!payload.partyId || !payload.items?.length) {
    return { error: "Vendor and at least one line item are required" }
  }

  const partyCheck = await verifyPartyOwnership(payload.partyId, currentUser.effectiveUserId)
  if (!partyCheck.ok) return { error: partyCheck.error }

  const userId = currentUser.effectiveUserId
  const [currentPurchase] = await sql<{ id: string; status: string }[]>`
    SELECT id, status FROM purchase_invoices WHERE id = ${purchaseId} AND user_id = ${userId}
  `
  if (!currentPurchase) return { error: "Purchase not found" }

  const existingLines = await sql<{ item_id: string; quantity: string }[]>`
    SELECT item_id, quantity FROM purchase_invoice_lines WHERE purchase_invoice_id = ${purchaseId}
  `

  if (existingLines.length > 0 && currentPurchase.status !== "Cancelled") {
    const restoreResult = await incrementStockForLines(
      existingLines.map((l) => ({ item_id: l.item_id, quantity: l.quantity })),
      { referenceType: "Purchase", referenceId: purchaseId, notes: "Stock reversed for purchase update", userId },
    )
    if (!restoreResult.ok) return { error: restoreResult.error }

    for (const line of existingLines) {
      await sql`SELECT decrement_inventory_stock(${line.item_id}, ${Number(line.quantity)})`
      await recordStockMovement({
        itemId: line.item_id, movementType: "OUT", quantity: Number(line.quantity),
        referenceType: "Purchase", referenceId: purchaseId,
        notes: "Stock reversed for purchase update", userId,
      })
    }
  }

  const taxRate = payload.taxRate ?? 0
  const subtotal = payload.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0)
  const tax = subtotal * (taxRate / 100)
  const total = subtotal + tax

  await sql`
    UPDATE purchase_invoices
    SET party_id = ${payload.partyId}, subtotal = ${subtotal}, tax = ${tax}, total = ${total},
        status = ${payload.status || currentPurchase.status}, notes = ${payload.notes || null}
    WHERE id = ${purchaseId} AND user_id = ${userId}
  `
  await sql`DELETE FROM purchase_invoice_lines WHERE purchase_invoice_id = ${purchaseId}`

  const resolvedItemIds: string[] = []
  for (const item of payload.items) {
    if (item.isNew) {
      const resolvedBarcode = item.barcode ? await resolveAvailableBarcode(item.barcode, userId) : null
      const [newItem] = await sql<{ id: string }[]>`
        INSERT INTO inventory_items (name, barcode, cost_price, selling_price, stock, user_id)
        VALUES (${item.itemName || "New Item"}, ${resolvedBarcode}, ${item.unitCost}, ${item.sellingPrice ?? item.unitCost}, 0, ${userId})
        RETURNING id
      `
      if (!newItem) return { error: "Failed to create new inventory item" }
      item.itemId = newItem.id
    }
    if (!item.itemId) return { error: "Item ID is required" }
    resolvedItemIds.push(item.itemId)
  }

  const lineErr = await upsertPurchaseInvoiceLines(purchaseId, payload.items, userId)
  if (lineErr) return { error: lineErr }

  const newStatus = payload.status || currentPurchase.status
  if (newStatus !== "Cancelled") {
    try {
      await Promise.all(
        payload.items.map(async (item) => {
          await sql`SELECT increment_inventory_stock(${item.itemId!}, ${item.quantity})`
          if (item.sellingPrice && item.sellingPrice > 0) {
            await sql`UPDATE inventory_items SET selling_price = ${item.sellingPrice}, cost_price = ${item.unitCost} WHERE id = ${item.itemId!} AND user_id = ${userId}`
          } else {
            await sql`UPDATE inventory_items SET cost_price = ${item.unitCost} WHERE id = ${item.itemId!} AND user_id = ${userId}`
          }
          await recordStockMovement({
            itemId: item.itemId!, movementType: "IN", quantity: item.quantity,
            referenceType: "Purchase", referenceId: purchaseId,
            notes: "Updated purchase stock received", userId,
          })
        }),
      )
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Failed to process inventory" }
    }
  }

  await recalcInvoicePaymentStatus("purchase", { invoiceId: purchaseId, userId })

  revalidatePath("/purchase-management/purchases")
  revalidatePath("/dashboard")
  return { error: null }
}

export async function getPurchaseForEdit(purchaseId: string) {
  const currentUser = await getSessionOrRedirect()

  const [purchase] = await sql<{
    id: string; party_id: string; subtotal: string; tax: string; total: string; status: string
    notes: string | null; purchase_number: string
  }[]>`
    SELECT id, party_id, subtotal, tax, total, status, notes, purchase_number
    FROM purchase_invoices WHERE id = ${purchaseId} AND user_id = ${currentUser.effectiveUserId}
  `
  if (!purchase) return { error: "Purchase not found", data: null }

  const lineItems = await sql<{
    item_id: string; quantity: string; unit_cost: string
    item_name: string | null; barcode: string | null; selling_price: string | null
  }[]>`
    SELECT pil.item_id, pil.quantity, pil.unit_cost,
           ii.name AS item_name, ii.barcode, ii.selling_price
    FROM purchase_invoice_lines pil
    LEFT JOIN inventory_items ii ON ii.id = pil.item_id
    WHERE pil.purchase_invoice_id = ${purchaseId}
  `

  const subtotal = Number(purchase.subtotal || 0)
  const tax = Number(purchase.tax || 0)
  const taxRate = subtotal > 0 ? (tax / subtotal) * 100 : 0

  return {
    error: null,
    data: {
      id: purchase.id, partyId: purchase.party_id, status: purchase.status || "Pending",
      notes: purchase.notes, taxRate,
      items: lineItems.map((line) => ({
        itemId: line.item_id, itemName: line.item_name || "Unknown", barcode: line.barcode,
        quantity: Number(line.quantity || 0), unitCost: Number(line.unit_cost || 0),
        sellingPrice: line.selling_price ? Number(line.selling_price) : undefined,
      })),
    },
  }
}

export async function deletePurchase(purchaseId: string) {
  const currentUser = await getSessionOrRedirect()

  if (!purchaseId) return { error: "Purchase ID is required" }

  const [purchase] = await sql<{ id: string; status: string }[]>`
    SELECT id, status FROM purchase_invoices WHERE id = ${purchaseId} AND user_id = ${currentUser.effectiveUserId}
  `
  if (!purchase) return { error: "Purchase not found" }

  const existingLines = await sql<{ item_id: string; quantity: string }[]>`
    SELECT item_id, quantity FROM purchase_invoice_lines WHERE purchase_invoice_id = ${purchaseId}
  `

  if (existingLines.length > 0 && purchase.status !== "Cancelled") {
    try {
      await Promise.all(
        existingLines.map(async (line) => {
          const qty = Number(line.quantity || 0)
          await sql`SELECT decrement_inventory_stock(${line.item_id}, ${qty})`
          await recordStockMovement({
            itemId: line.item_id, movementType: "OUT", quantity: qty,
            referenceType: "Purchase", referenceId: purchaseId,
            notes: "Purchase deleted — stock reversed", userId: currentUser.effectiveUserId,
          })
        }),
      )
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Failed to reverse inventory" }
    }
  }

  await sql`DELETE FROM purchase_invoice_lines WHERE purchase_invoice_id = ${purchaseId}`
  await sql`DELETE FROM purchase_invoices WHERE id = ${purchaseId} AND user_id = ${currentUser.effectiveUserId}`

  revalidatePath("/purchase-management/purchases")
  revalidatePath("/dashboard")
  return { error: null }
}

export async function getPurchases(options?: {
  partyId?: string; status?: string; dateFrom?: string; dateTo?: string
}) {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{
      id: string; purchase_number: string; party_id: string; subtotal: string; tax: string; total: string
      status: string; notes: string | null; created_at: string
      party_name: string | null; party_phone: string | null
    }[]>`
      SELECT pi.id, pi.purchase_number, pi.party_id, pi.subtotal, pi.tax, pi.total, pi.status, pi.notes, pi.created_at,
             p.name AS party_name, p.phone AS party_phone
      FROM purchase_invoices pi
      LEFT JOIN parties p ON p.id = pi.party_id
      WHERE pi.user_id = ${currentUser.effectiveUserId}
        ${options?.partyId ? sql`AND pi.party_id = ${options.partyId}` : sql``}
        ${options?.status ? sql`AND pi.status = ${options.status}` : sql``}
        ${options?.dateFrom ? sql`AND pi.created_at >= ${options.dateFrom}` : sql``}
        ${options?.dateTo ? sql`AND pi.created_at <= ${options.dateTo}` : sql``}
      ORDER BY pi.created_at DESC
    `

    const data = rows.map((row) => ({
      id: row.id, purchaseNumber: row.purchase_number, partyId: row.party_id,
      subtotal: Number(row.subtotal || 0), tax: Number(row.tax || 0), total: Number(row.total || 0),
      status: row.status || "Draft", notes: row.notes, created_at: row.created_at,
      vendorName: row.party_name || "Unknown",
      party: row.party_name ? { id: row.party_id, name: row.party_name, phone: row.party_phone } : undefined,
    }))

    return { error: null, data }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch purchases", data: [] }
  }
}

export async function createPurchasePayment(payload: {
  purchaseInvoiceId: string
  amount: number
  method: string
  reference?: string
}) {
  const currentUser = await getSessionOrRedirect()

  if (!payload.purchaseInvoiceId || !Number.isFinite(payload.amount) || payload.amount <= 0) {
    return { error: "Purchase ID and positive amount are required", data: null }
  }

  const [purchase] = await sql<{ id: string; total: string; status: string }[]>`
    SELECT id, total, status FROM purchase_invoices
    WHERE id = ${payload.purchaseInvoiceId} AND user_id = ${currentUser.effectiveUserId}
  `
  if (!purchase) return { error: "Purchase not found", data: null }

  const existingPayments = await sql<{ amount: string }[]>`
    SELECT amount FROM purchase_payments WHERE purchase_invoice_id = ${payload.purchaseInvoiceId}
  `
  const totalPaid = existingPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  const remaining = Number(purchase.total || 0) - totalPaid

  if (payload.amount > remaining + 0.001) {
    return { error: `Payment amount (${payload.amount.toFixed(2)}) exceeds outstanding balance (${remaining.toFixed(2)})`, data: null }
  }

  const [payment] = await sql<{ id: string }[]>`
    INSERT INTO purchase_payments (purchase_invoice_id, amount, method, reference, user_id)
    VALUES (${payload.purchaseInvoiceId}, ${payload.amount}, ${payload.method}, ${payload.reference || null}, ${currentUser.effectiveUserId})
    RETURNING id
  `
  if (!payment) return { error: "Unable to create payment", data: null }

  await recalcInvoicePaymentStatus("purchase", { invoiceId: payload.purchaseInvoiceId, userId: currentUser.effectiveUserId })

  revalidatePath("/purchase-management/purchases")
  revalidatePath("/accounts-management")
  return { error: null, data: { paymentId: payment.id } }
}

export async function getPurchasePayments(purchaseInvoiceId: string) {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{
      id: string; purchase_invoice_id: string; amount: string; method: string; reference: string | null; created_at: string
    }[]>`
      SELECT id, purchase_invoice_id, amount, method, reference, created_at
      FROM purchase_payments
      WHERE purchase_invoice_id = ${purchaseInvoiceId} AND user_id = ${currentUser.effectiveUserId}
      ORDER BY created_at DESC
    `
    return rows.map((row) => ({
      id: row.id, purchaseInvoiceId: row.purchase_invoice_id,
      amount: Number(row.amount || 0), method: row.method,
      reference: row.reference, created_at: row.created_at,
    }))
  } catch {
    return []
  }
}

export async function deletePurchasePayment(paymentId: string) {
  const currentUser = await getSessionOrRedirect()

  if (!paymentId) return { error: "Payment ID is required" }

  const [payment] = await sql<{ id: string; purchase_invoice_id: string }[]>`
    SELECT id, purchase_invoice_id FROM purchase_payments
    WHERE id = ${paymentId} AND user_id = ${currentUser.effectiveUserId}
  `
  if (!payment) return { error: "Payment not found" }

  await sql`DELETE FROM purchase_payments WHERE id = ${paymentId} AND user_id = ${currentUser.effectiveUserId}`
  await recalcInvoicePaymentStatus("purchase", { invoiceId: payment.purchase_invoice_id, userId: currentUser.effectiveUserId })

  revalidatePath("/purchase-management/purchases")
  revalidatePath("/accounts-management")
  return { error: null }
}

export async function getAllPurchasePayments(options?: { partyId?: string; dateFrom?: string; dateTo?: string }) {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{
      id: string; purchase_invoice_id: string; amount: string; method: string; reference: string | null; created_at: string
    }[]>`
      SELECT pp.id, pp.purchase_invoice_id, pp.amount, pp.method, pp.reference, pp.created_at
      FROM purchase_payments pp
      ${options?.partyId ? sql`INNER JOIN purchase_invoices pi ON pi.id = pp.purchase_invoice_id AND pi.party_id = ${options.partyId}` : sql``}
      WHERE pp.user_id = ${currentUser.effectiveUserId}
        ${options?.dateFrom ? sql`AND pp.created_at >= ${options.dateFrom}` : sql``}
        ${options?.dateTo ? sql`AND pp.created_at <= ${options.dateTo}` : sql``}
      ORDER BY pp.created_at DESC
    `
    return {
      error: null,
      data: rows.map((row) => ({
        id: row.id, purchaseInvoiceId: row.purchase_invoice_id,
        amount: Number(row.amount || 0), method: row.method,
        reference: row.reference, created_at: row.created_at,
      })),
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to fetch payments", data: [] }
  }
}

export async function getPaidPurchases(dateFrom?: string, dateTo?: string) {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{
      id: string; purchase_number: string; party_id: string; total: string; status: string; created_at: string
      party_name: string | null
    }[]>`
      SELECT pi.id, pi.purchase_number, pi.party_id, pi.total, pi.status, pi.created_at, p.name AS party_name
      FROM purchase_invoices pi
      LEFT JOIN parties p ON p.id = pi.party_id
      WHERE pi.user_id = ${currentUser.effectiveUserId}
        AND pi.status = 'Paid'
        ${dateFrom ? sql`AND pi.created_at >= ${dateFrom}` : sql``}
        ${dateTo ? sql`AND pi.created_at <= ${dateTo}` : sql``}
      ORDER BY pi.created_at DESC
    `
    return rows.map((row) => ({
      id: row.id, purchaseNumber: row.purchase_number, partyId: row.party_id,
      total: Number(row.total || 0), status: row.status || "Paid", created_at: row.created_at,
      vendorName: row.party_name || "Unknown",
    }))
  } catch {
    return []
  }
}

export async function quickCreateInventoryItem(payload: {
  name: string
  barcode?: string
  costPrice: number
  sellingPrice: number
  categoryId?: string
}) {
  const currentUser = await getSessionOrRedirect()

  if (!payload.name?.trim()) return { error: "Item name is required", data: null }
  if (!Number.isFinite(payload.costPrice) || payload.costPrice < 0) return { error: "Valid cost price required", data: null }
  if (!Number.isFinite(payload.sellingPrice) || payload.sellingPrice < 0) return { error: "Valid selling price required", data: null }

  const userId = currentUser.effectiveUserId
  const resolvedBarcode = payload.barcode ? await resolveAvailableBarcode(payload.barcode, userId) : null

  const [item] = await sql<{ id: string; name: string }[]>`
    INSERT INTO inventory_items (name, barcode, cost_price, selling_price, stock, category_id, user_id)
    VALUES (${payload.name.trim()}, ${resolvedBarcode}, ${payload.costPrice}, ${payload.sellingPrice}, 0, ${payload.categoryId || null}, ${userId})
    RETURNING id, name
  `
  if (!item) return { error: "Unable to create item", data: null }

  revalidatePath("/inventory")
  return { error: null, data: { id: item.id, name: item.name } }
}

export async function quickCreateVendor(payload: { name: string; phone?: string; address?: string }) {
  const currentUser = await getSessionOrRedirect()

  if (!payload.name?.trim()) return { error: "Vendor name is required", data: null }

  const [vendor] = await sql<{ id: string; name: string }[]>`
    INSERT INTO parties (name, phone, address, type, user_id)
    VALUES (${payload.name.trim()}, ${payload.phone || null}, ${payload.address || null}, 'Vendor', ${currentUser.effectiveUserId})
    RETURNING id, name
  `
  if (!vendor) return { error: "Unable to create vendor", data: null }

  revalidatePath("/parties")
  return { error: null, data: { id: vendor.id, name: vendor.name } }
}
