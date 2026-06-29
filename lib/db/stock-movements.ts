"use server"

import sql from "@/lib/db"

export type StockMovementType = "IN" | "OUT"
export type StockReferenceType = "Invoice" | "Purchase" | "Adjustment" | "Manual" | "SaleReturn" | "PurchaseReturn"

export interface StockMovementInput {
  itemId: string
  movementType: StockMovementType
  quantity: number
  referenceType?: StockReferenceType
  referenceId?: string
  notes?: string
  userId: string
}

export async function checkStockAvailability(
  items: Array<{ itemId: string; quantity: number }>,
  userId: string
): Promise<{ ok: true } | { ok: false; itemName: string; available: number; requested: number }> {
  if (items.length === 0) return { ok: true }

  const itemIds = items.map((i) => i.itemId)
  const rows = await sql`
    SELECT id, name, stock FROM inventory_items
    WHERE id IN ${sql(itemIds)} AND user_id = ${userId}
  `

  for (const item of items) {
    const inv = rows.find((r) => r.id === item.itemId)
    const available = Number(inv?.stock ?? 0)
    if (available < item.quantity) {
      return {
        ok: false,
        itemName: (inv?.name as string) ?? "Unknown item",
        available,
        requested: item.quantity,
      }
    }
  }

  return { ok: true }
}

export async function recordStockMovement(input: StockMovementInput) {
  await sql`
    INSERT INTO stock_movements (item_id, movement_type, quantity, reference_type, reference_id, notes, user_id)
    VALUES (
      ${input.itemId},
      ${input.movementType},
      ${input.quantity},
      ${input.referenceType ?? null},
      ${input.referenceId ?? null},
      ${input.notes ?? null},
      ${input.userId}
    )
  `
  return { success: true, error: null }
}
