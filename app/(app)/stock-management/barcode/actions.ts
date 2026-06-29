"use server"

import sql from "@/lib/db"
import { revalidatePath } from "next/cache"
import { getSessionOrRedirect } from "@/lib/auth"

export async function generateBarcode(itemId: string, format: string = "CODE128") {
  const currentUser = await getSessionOrRedirect()

  const barcode = `BC${itemId.substring(0, 8).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`

  const result = await sql`
    UPDATE inventory_items SET barcode = ${barcode}
    WHERE id = ${itemId} AND user_id = ${currentUser.effectiveUserId}
    RETURNING id
  `
  if (!result.length) return { error: "Item not found or access denied", barcode: null }

  revalidatePath("/stock-management/barcode")
  revalidatePath("/stock-management/inventory")
  return { error: null, barcode }
}

export async function bulkGenerateBarcodes(itemIds: string[]) {
  const currentUser = await getSessionOrRedirect()
  const results = []

  for (const itemId of itemIds) {
    const barcode = `BC${itemId.substring(0, 8).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`
    try {
      const result = await sql`
        UPDATE inventory_items SET barcode = ${barcode}
        WHERE id = ${itemId} AND user_id = ${currentUser.effectiveUserId}
        RETURNING id
      `
      results.push({ itemId, barcode: result.length ? barcode : null, error: result.length ? null : "Item not found" })
    } catch (err) {
      results.push({ itemId, barcode: null, error: err instanceof Error ? err.message : "Update failed" })
    }
  }

  revalidatePath("/stock-management/barcode")
  revalidatePath("/stock-management/inventory")
  return results
}

export async function lookupItemByBarcode(barcode: string) {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  // 1. Exact match first
  let [matched] = await sql<{ id: string; name: string; stock: string; cost_price: string | null; selling_price: string | null; barcode: string | null }[]>`
    SELECT id, name, stock, cost_price, selling_price, barcode
    FROM inventory_items WHERE barcode = ${barcode} AND user_id = ${userId}
  `

  // 2. Scanner stripped check digit: DB barcode starts with scanned barcode
  if (!matched) {
    const [startsWith] = await sql<{ id: string; name: string; stock: string; cost_price: string | null; selling_price: string | null; barcode: string | null }[]>`
      SELECT id, name, stock, cost_price, selling_price, barcode
      FROM inventory_items WHERE user_id = ${userId} AND barcode LIKE ${barcode + "%"}
      LIMIT 1
    `
    matched = startsWith
  }

  // 3. Scanned barcode has extra check digit that DB doesn't store
  if (!matched && barcode.length > 1) {
    const [withoutCheck] = await sql<{ id: string; name: string; stock: string; cost_price: string | null; selling_price: string | null; barcode: string | null }[]>`
      SELECT id, name, stock, cost_price, selling_price, barcode
      FROM inventory_items WHERE barcode = ${barcode.slice(0, -1)} AND user_id = ${userId}
    `
    matched = withoutCheck
  }

  if (!matched) return { error: "Item not found", item: null }

  const sellingPrice = Number(matched.selling_price ?? 0)
  return {
    error: null,
    item: { id: matched.id, name: matched.name, stock: Number(matched.stock || 0), unitPrice: sellingPrice, barcode: matched.barcode },
  }
}

export async function getItemsWithoutBarcode() {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM inventory_items
      WHERE barcode IS NULL AND user_id = ${currentUser.effectiveUserId}
      ORDER BY name ASC
    `
    return rows
  } catch {
    return []
  }
}

export async function getAllItemsWithBarcodes() {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{ id: string; name: string; barcode: string | null; stock: string; selling_price: string | null }[]>`
      SELECT id, name, barcode, stock, selling_price
      FROM inventory_items
      WHERE barcode IS NOT NULL AND user_id = ${currentUser.effectiveUserId}
      ORDER BY name ASC
    `
    return rows.map((item) => ({
      id: item.id, name: item.name, barcode: item.barcode,
      stock: Number(item.stock || 0), unitPrice: Number(item.selling_price ?? 0),
    }))
  } catch {
    return []
  }
}

export async function updateBarcode(itemId: string, newBarcode: string) {
  const currentUser = await getSessionOrRedirect()

  const trimmedBarcode = newBarcode.trim()
  if (!trimmedBarcode) return { error: "Barcode cannot be empty", barcode: null }

  // Check if barcode already exists for another item (within same user)
  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM inventory_items
    WHERE barcode = ${trimmedBarcode} AND user_id = ${currentUser.effectiveUserId} AND id != ${itemId}
  `
  if (existing) return { error: "Barcode already exists for another item", barcode: null }

  const result = await sql`
    UPDATE inventory_items SET barcode = ${trimmedBarcode}
    WHERE id = ${itemId} AND user_id = ${currentUser.effectiveUserId}
    RETURNING id
  `
  if (!result.length) return { error: "Item not found or access denied", barcode: null }

  revalidatePath("/stock-management/barcode")
  revalidatePath("/stock-management/inventory")
  return { error: null, barcode: trimmedBarcode }
}
