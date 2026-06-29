"use server"

import { revalidatePath } from "next/cache"
import sql from "@/lib/db"
import { getSessionOrRedirect } from "@/lib/auth"

export async function createUnit(formData: FormData) {
  const currentUser = await getSessionOrRedirect()
  const name = String(formData.get("name") || "").trim()
  const symbol = String(formData.get("symbol") || "").trim() || null

  if (!name) {
    return { error: "Unit name is required" }
  }

  try {
    await sql`
      INSERT INTO units (name, symbol, user_id)
      VALUES (${name}, ${symbol}, ${currentUser.effectiveUserId})
    `
    revalidatePath("/stock-management/units")
    return { error: null }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create unit" }
  }
}

export async function updateUnit(formData: FormData) {
  const currentUser = await getSessionOrRedirect()
  const id = String(formData.get("id") || "").trim()
  const name = String(formData.get("name") || "").trim()
  const symbol = String(formData.get("symbol") || "").trim() || null

  if (!id || !name) {
    return { error: "ID and unit name are required" }
  }

  try {
    await sql`
      UPDATE units
      SET name = ${name}, symbol = ${symbol}
      WHERE id = ${id} AND user_id = ${currentUser.effectiveUserId}
    `
    revalidatePath("/stock-management/units")
    return { error: null }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to update unit" }
  }
}

export async function deleteUnit(unitId: string) {
  const currentUser = await getSessionOrRedirect()

  if (!unitId) {
    return { error: "Unit ID is required" }
  }

  try {
    // Check if unit has items (only check items belonging to this user)
    const items = await sql`
      SELECT id FROM inventory_items
      WHERE unit_id = ${unitId} AND user_id = ${currentUser.effectiveUserId}
      LIMIT 1
    `

    if (items.length > 0) {
      return { error: "Cannot delete unit. It has items assigned to it." }
    }

    await sql`
      DELETE FROM units
      WHERE id = ${unitId} AND user_id = ${currentUser.effectiveUserId}
    `
    revalidatePath("/stock-management/units")
    return { error: null }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to delete unit" }
  }
}

export async function quickCreateUnit(name: string, symbol?: string) {
  const currentUser = await getSessionOrRedirect()

  if (!name.trim()) {
    return { error: "Unit name is required", data: null }
  }

  try {
    const [row] = await sql`
      INSERT INTO units (name, symbol, user_id)
      VALUES (${name.trim()}, ${symbol?.trim() || null}, ${currentUser.effectiveUserId})
      RETURNING id, name, symbol
    `
    if (!row) {
      return { error: "Failed to create unit", data: null }
    }
    revalidatePath("/stock-management/units")
    return { error: null, data: { id: row.id as string, name: row.name as string, symbol: row.symbol as string | null } }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create unit", data: null }
  }
}

export async function fetchUnits() {
  const currentUser = await getSessionOrRedirect()
  try {
    const rows = await sql`
      SELECT id, name, symbol, created_at
      FROM units
      WHERE user_id = ${currentUser.effectiveUserId}
      ORDER BY name ASC
    `
    return rows as unknown as Array<{ id: string; name: string; symbol: string | null; created_at: string }>
  } catch {
    return []
  }
}
