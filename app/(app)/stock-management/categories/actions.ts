"use server"

import { revalidatePath } from "next/cache"
import sql from "@/lib/db"
import { getSessionOrRedirect } from "@/lib/auth"

export async function createCategory(formData: FormData) {
  const currentUser = await getSessionOrRedirect()
  const name = String(formData.get("name") || "").trim()
  const description = String(formData.get("description") || "").trim() || null

  if (!name) {
    return { error: "Category name is required" }
  }

  try {
    await sql`
      INSERT INTO categories (name, description, user_id)
      VALUES (${name}, ${description}, ${currentUser.effectiveUserId})
    `
    revalidatePath("/stock-management/categories")
    return { error: null }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create category" }
  }
}

export async function updateCategory(formData: FormData) {
  const currentUser = await getSessionOrRedirect()
  const id = String(formData.get("id") || "").trim()
  const name = String(formData.get("name") || "").trim()
  const description = String(formData.get("description") || "").trim() || null

  if (!id || !name) {
    return { error: "ID and category name are required" }
  }

  try {
    await sql`
      UPDATE categories
      SET name = ${name}, description = ${description}
      WHERE id = ${id} AND user_id = ${currentUser.effectiveUserId}
    `
    revalidatePath("/stock-management/categories")
    return { error: null }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to update category" }
  }
}

export async function deleteCategory(categoryId: string) {
  const currentUser = await getSessionOrRedirect()

  if (!categoryId) {
    return { error: "Category ID is required" }
  }

  try {
    // Check if category has items (only check items belonging to this user)
    const items = await sql`
      SELECT id FROM inventory_items
      WHERE category_id = ${categoryId} AND user_id = ${currentUser.effectiveUserId}
      LIMIT 1
    `

    if (items.length > 0) {
      return { error: "Cannot delete category. It has items assigned to it." }
    }

    await sql`
      DELETE FROM categories
      WHERE id = ${categoryId} AND user_id = ${currentUser.effectiveUserId}
    `
    revalidatePath("/stock-management/categories")
    return { error: null }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to delete category" }
  }
}

export async function quickCreateCategory(name: string) {
  const currentUser = await getSessionOrRedirect()

  if (!name.trim()) {
    return { error: "Category name is required", data: null }
  }

  try {
    const [row] = await sql`
      INSERT INTO categories (name, user_id)
      VALUES (${name.trim()}, ${currentUser.effectiveUserId})
      RETURNING id, name
    `
    if (!row) {
      return { error: "Failed to create category", data: null }
    }
    revalidatePath("/stock-management/categories")
    return { error: null, data: { id: row.id as string, name: row.name as string } }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to create category", data: null }
  }
}

export async function fetchCategories() {
  const currentUser = await getSessionOrRedirect()
  try {
    const rows = await sql`
      SELECT id, name, description, created_at
      FROM categories
      WHERE user_id = ${currentUser.effectiveUserId}
      ORDER BY name ASC
    `
    return rows as unknown as Array<{ id: string; name: string; description: string | null; created_at: string }>
  } catch {
    return []
  }
}
