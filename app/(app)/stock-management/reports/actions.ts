"use server"

import sql from "@/lib/db"
import { getSessionOrRedirect } from "@/lib/auth"

export async function getStockLevels() {
  const currentUser = await getSessionOrRedirect()

  // IV-C1: only active items. Archived items have stock=0 and would otherwise pollute the
  // "Out of Stock" count, mismatching the main /stock-management/inventory listing which
  // already filters them out.
  const items = await sql<{
    id: string; name: string; stock: string; cost_price: string | null
    minimum_stock: string | null; category_id: string | null
  }[]>`
    SELECT id, name, stock, cost_price, minimum_stock, category_id
    FROM inventory_items
    WHERE user_id = ${currentUser.effectiveUserId} AND is_archived = false
    ORDER BY stock ASC
  `

  const categoryIds = [...new Set(items.map((i) => i.category_id).filter(Boolean))] as string[]
  const categoryLookup = new Map<string, string>()
  if (categoryIds.length > 0) {
    const cats = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM categories
      WHERE id = ANY(${categoryIds}) AND user_id = ${currentUser.effectiveUserId}
    `
    cats.forEach((c) => categoryLookup.set(c.id, c.name))
  }

  return items.map((item) => {
    const stock = Number(item.stock || 0)
    const minStock = item.minimum_stock !== null ? Number(item.minimum_stock) : null
    // IV-C0: value is computed at COST (accounting standard for inventory valuation).
    const costPrice = Number(item.cost_price ?? 0)

    let stockStatus: "out_of_stock" | "low_stock" | "in_stock" = "in_stock"
    if (stock === 0) stockStatus = "out_of_stock"
    else if (minStock !== null && stock < minStock) stockStatus = "low_stock"

    return {
      id: item.id, name: item.name,
      category_name: item.category_id ? (categoryLookup.get(item.category_id) ?? null) : null,
      stock, unitPrice: costPrice, value: stock * costPrice, stockStatus,
      isLowStock: stockStatus === "low_stock", isOutOfStock: stockStatus === "out_of_stock",
    }
  })
}

export async function getStockMovements(startDate?: string, endDate?: string) {
  const currentUser = await getSessionOrRedirect()

  try {
    const movements = await sql<{
      id: string; movement_type: string; quantity: string; reference_type: string | null
      reference_id: string | null; notes: string | null; created_at: string
      item_id: string | null; item_name: string | null
    }[]>`
      SELECT sm.id, sm.movement_type, sm.quantity, sm.reference_type, sm.reference_id, sm.notes, sm.created_at,
             ii.id AS item_id, ii.name AS item_name
      FROM stock_movements sm
      LEFT JOIN inventory_items ii ON ii.id = sm.item_id
      WHERE sm.user_id = ${currentUser.effectiveUserId}
        ${startDate ? sql`AND sm.created_at >= ${startDate}` : sql``}
        ${endDate ? sql`AND sm.created_at <= ${endDate}` : sql``}
      ORDER BY sm.created_at DESC
      LIMIT 100
    `

    return movements.map((m) => ({
      id: m.id, itemId: m.item_id || "", itemName: m.item_name || "Unknown",
      movementType: m.movement_type, quantity: Number(m.quantity || 0),
      referenceType: m.reference_type, referenceId: m.reference_id,
      notes: m.notes, createdAt: m.created_at,
    }))
  } catch {
    return []
  }
}

export async function getInventoryValueAnalysis() {
  const currentUser = await getSessionOrRedirect()

  try {
    // IV-C0 + IV-C1: read cost_price (the real basis), and exclude archived items.
    const items = await sql<{
      stock: string; cost_price: string | null; category_id: string | null; minimum_stock: string | null
    }[]>`
      SELECT stock, cost_price, category_id, minimum_stock
      FROM inventory_items
      WHERE user_id = ${currentUser.effectiveUserId} AND is_archived = false
    `

    const categoryIds = [...new Set(items.map((item) => item.category_id).filter(Boolean))] as string[]
    const categoryLookup = new Map<string, string>()
    if (categoryIds.length > 0) {
      const cats = await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM categories
        WHERE id = ANY(${categoryIds}) AND user_id = ${currentUser.effectiveUserId}
      `
      cats.forEach((c) => categoryLookup.set(c.id, c.name))
    }

    let totalValue = 0
    let lowStockCount = 0
    let outOfStockCount = 0
    const categoryMap = new Map<string, { name: string; value: number; count: number }>()

    for (const item of items) {
      const stock = Number(item.stock || 0)
      const costPrice = Number(item.cost_price ?? 0)
      const minStock = item.minimum_stock !== null ? Number(item.minimum_stock) : null
      const value = stock * costPrice
      totalValue += value

      if (stock === 0) outOfStockCount++
      else if (minStock !== null && stock < minStock) lowStockCount++

      const categoryName = item.category_id ? categoryLookup.get(item.category_id) || "Uncategorized" : "Uncategorized"
      const existing = categoryMap.get(categoryName) || { name: categoryName, value: 0, count: 0 }
      existing.value += value
      existing.count += 1
      categoryMap.set(categoryName, existing)
    }

    return {
      totalValue, totalItems: items.length, lowStockCount, outOfStockCount,
      byCategory: Array.from(categoryMap.values()).sort((a, b) => b.value - a.value),
    }
  } catch {
    return { totalValue: 0, totalItems: 0, lowStockCount: 0, outOfStockCount: 0, byCategory: [] }
  }
}
