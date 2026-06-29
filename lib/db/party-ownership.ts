import sql from "@/lib/db"

/**
 * Verify a single party (customer / vendor / both) belongs to the given user.
 *
 * Server actions across the app open with the same 4-line block: fetch the party row
 * scoped by id + user_id, return an "Party not found" error if it doesn't exist. This
 * helper folds that into one call.
 *
 * Usage:
 *   const partyCheck = await verifyPartyOwnership(payload.partyId, currentUser.effectiveUserId)
 *   if (!partyCheck.ok) return { error: partyCheck.error }
 */
export async function verifyPartyOwnership(
  partyId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!partyId) return { ok: false, error: "Party ID is required" }
  if (!userId) return { ok: false, error: "User ID is required" }
  const rows = await sql`SELECT id FROM parties WHERE id = ${partyId} AND user_id = ${userId} LIMIT 1`
  return rows.length > 0 ? { ok: true } : { ok: false, error: "Party not found" }
}

/**
 * Bulk variant: verify a set of inventory item IDs all belong to the user. Used by
 * sales / purchase / return flows that need to confirm every cart line item before any
 * stock mutation. Returns { ok } only when every requested id was found.
 */
export async function verifyInventoryItemsOwnership(
  itemIds: string[],
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!itemIds || itemIds.length === 0) return { ok: true }
  const rows = await sql`SELECT id FROM inventory_items WHERE id IN ${sql(itemIds)} AND user_id = ${userId}`
  if (rows.length !== itemIds.length) {
    return { ok: false, error: "One or more items not found" }
  }
  return { ok: true }
}
