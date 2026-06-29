import sql from "@/lib/db"

/**
 * Resolve a barcode collision for a new or quickly-created inventory item.
 *
 * Given a requested barcode, scan for existing items owned by the same user that already
 * use it. If found, fall back to a time-suffixed variant, then a random-suffix variant,
 * and finally give up after three attempts so the caller can surface a clean error to
 * the cashier instead of a raw Postgres unique-violation.
 *
 * `excludeItemId` is for the update-item path: a row keeping its own barcode shouldn't
 * count as a collision against itself.
 */
export async function resolveAvailableBarcode(
  requested: string,
  userId: string,
  options: { excludeItemId?: string } = {},
): Promise<{ ok: true; barcode: string } | { ok: false; error: string }> {
  if (!requested) return { ok: false, error: "Barcode is required" }
  let finalBarcode = requested
  const maxAttempts = 3
  for (let attempts = 0; attempts < maxAttempts; attempts++) {
    const rows = await sql`
      SELECT id FROM inventory_items
      WHERE barcode = ${finalBarcode}
        AND user_id = ${userId}
        ${options.excludeItemId ? sql`AND id != ${options.excludeItemId}` : sql``}
      LIMIT 1
    `
    if (rows.length === 0) {
      return { ok: true, barcode: finalBarcode }
    }
    finalBarcode =
      attempts === 0
        ? `${requested}-${Date.now().toString(36).toUpperCase()}`
        : `${requested}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`
  }
  return { ok: false, error: "Barcode collision detected. Please try a different barcode." }
}

/**
 * Generate a new random barcode for an item that didn't supply one, retrying on
 * collisions. Used by `createInventoryItem` after the row is inserted so the new id can
 * be embedded in the barcode.
 */
export async function generateUniqueAutoBarcode(
  seedId: string,
  userId: string,
): Promise<string> {
  let candidate = `BC${seedId.substring(0, 8).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`
  const maxAttempts = 3
  for (let attempts = 0; attempts < maxAttempts; attempts++) {
    const rows = await sql`
      SELECT id FROM inventory_items
      WHERE barcode = ${candidate}
        AND user_id = ${userId}
      LIMIT 1
    `
    if (rows.length === 0) return candidate
    candidate = `BC${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`
  }
  return candidate
}
