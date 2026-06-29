import sql from "@/lib/db"
import { recordStockMovement } from "@/lib/db/stock-movements"

/**
 * Atomically increment inventory stock for a list of lines and record one stock-movement
 * audit row per line. Used by every "restore stock" path on the sales side and the
 * "increment stock" path on the purchase side — invoice updates, deletions, draft
 * reopens etc.
 *
 * Errors short-circuit and return the first failure so the caller can roll back. Lines
 * with zero or negative quantity are skipped silently.
 */
export async function incrementStockForLines(
  lines: Array<{ item_id: string; quantity: number | string }>,
  ctx: {
    referenceType: "Invoice" | "Purchase" | "SaleReturn" | "PurchaseReturn" | "Adjustment" | "Manual"
    referenceId?: string
    notes?: string
    userId: string
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const line of lines || []) {
    const itemId = line?.item_id
    const qty = Number(line?.quantity ?? 0)
    if (!itemId || qty <= 0) continue
    try {
      await sql`SELECT increment_inventory_stock(${itemId}, ${qty})`
    } catch (err) {
      return {
        ok: false,
        error: `Failed to increment stock for item ${itemId}: ${err instanceof Error ? err.message : "Unknown error"}`,
      }
    }
    await recordStockMovement({
      itemId,
      movementType: "IN",
      quantity: qty,
      referenceType: ctx.referenceType,
      referenceId: ctx.referenceId,
      notes: ctx.notes,
      userId: ctx.userId,
    })
  }
  return { ok: true }
}

/**
 * Counterpart to `incrementStockForLines` — atomically decrement stock for a list of
 * lines and write OUT movement audit rows. Used by every "decrement stock for new line
 * items" path on the sales side and the "stock came back from purchase return" path on
 * the purchase side.
 */
export async function decrementStockForLines(
  lines: Array<{ itemId?: string; item_id?: string; quantity: number | string }>,
  ctx: {
    referenceType: "Invoice" | "Purchase" | "SaleReturn" | "PurchaseReturn" | "Adjustment" | "Manual"
    referenceId?: string
    notes?: string
    userId: string
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const line of lines || []) {
    const itemId = (line as any).item_id ?? (line as any).itemId
    const qty = Number(line?.quantity ?? 0)
    if (!itemId || qty <= 0) continue
    try {
      await sql`SELECT decrement_inventory_stock(${itemId}, ${qty})`
    } catch (err) {
      return {
        ok: false,
        error: `Failed to decrement stock for item ${itemId}: ${err instanceof Error ? err.message : "Unknown error"}`,
      }
    }
    await recordStockMovement({
      itemId,
      movementType: "OUT",
      quantity: qty,
      referenceType: ctx.referenceType,
      referenceId: ctx.referenceId,
      notes: ctx.notes,
      userId: ctx.userId,
    })
  }
  return { ok: true }
}
