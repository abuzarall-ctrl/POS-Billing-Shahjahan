"use server"

import { revalidatePath } from "next/cache"
import sql from "@/lib/db"
import { recordStockMovement } from "@/lib/db/stock-movements"
import { resolveAvailableBarcode, generateUniqueAutoBarcode } from "@/lib/db/barcode-collision"
import { getSessionOrRedirect } from "@/lib/auth"

// ─── Local helpers ──────────────────────────────────────────────────────────────
// These three helpers used to be inlined identically in both `createInventoryItem`
// and `updateInventoryItem`. Extracted so the two action functions stay focused on
// what they actually do differently (insert vs update).

/** Pick a trimmed string out of a FormData entry; treat empties as null. */
function readOptionalString(formData: FormData, key: string): string | null {
  const raw = formData.get(key)
  return raw && String(raw).trim() ? String(raw).trim() : null
}

/** Pick a numeric FormData entry; treats blank/missing as null instead of NaN. */
function readOptionalNumber(formData: FormData, key: string): number | null {
  const raw = formData.get(key)
  if (!raw || !String(raw).trim()) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * Read every field the inventory dialog submits and return them in one normalised
 * object. Keeps the type churn of `Number()` / `String().trim()` / `?? null` out of
 * the action bodies.
 */
function parseInventoryFormData(formData: FormData) {
  return {
    name: String(formData.get("name") || "").trim(),
    stock: Number(formData.get("stock") || 0),
    costPrice: Number(formData.get("cost_price") || 0),
    cashPrice: Number(formData.get("cash_price") || 0),
    creditPrice: Number(formData.get("credit_price") || 0),
    supplierPrice: Number(formData.get("supplier_price") || 0),
    categoryId: readOptionalString(formData, "category_id"),
    unitId: readOptionalString(formData, "unit_id"),
    barcode: readOptionalString(formData, "barcode"),
    minimumStock: readOptionalNumber(formData, "minimum_stock"),
    maximumStock: readOptionalNumber(formData, "maximum_stock"),
  }
}

/**
 * Compute the profit-value and profit-percentage stored on the inventory row, both
 * derived from cost vs cash price. `cashPrice < costPrice` clamps the profit to 0
 * rather than going negative (we don't store loss-per-item).
 */
function calculateProfit(costPrice: number, cashPrice: number): { profitValue: number; profitPercentage: number } {
  if (!(costPrice > 0)) {
    return { profitValue: 0, profitPercentage: 0 }
  }
  const profitValue = Math.max(0, cashPrice - costPrice)
  const profitPercentage = Math.round((profitValue / costPrice) * 100 * 100) / 100
  return { profitValue, profitPercentage }
}

// Helper: read the optional pack_unit_id / pack_size pair from a FormData and validate
// that they're either both set (with pack_size > 0 and pack_unit_id ≠ base unit_id) or both
// cleared. Returns the normalised pair or an error string.
function readPackFields(formData: FormData, baseUnitId: string | null):
  | { packUnitId: string | null; packSize: number | null }
  | { error: string }
{
  const rawPackUnit = formData.get("pack_unit_id")
  const rawPackSize = formData.get("pack_size")
  const packUnitId = rawPackUnit && String(rawPackUnit).trim() ? String(rawPackUnit).trim() : null
  const packSizeStr = rawPackSize && String(rawPackSize).trim() ? String(rawPackSize).trim() : null
  const packSize = packSizeStr !== null ? Number(packSizeStr) : null

  if (packUnitId === null && (packSize === null || packSize === 0)) {
    return { packUnitId: null, packSize: null }
  }
  if (packUnitId === null) {
    return { error: "Pack unit is required when a pack size is given" }
  }
  if (packSize === null || !Number.isFinite(packSize) || packSize <= 0) {
    return { error: "Pack size must be a positive number" }
  }
  if (baseUnitId && packUnitId === baseUnitId) {
    return { error: "Pack unit must be different from the base unit" }
  }
  return { packUnitId, packSize }
}

export async function createInventoryItem(formData: FormData) {
  try {
    const currentUser = await getSessionOrRedirect()

    const fields = parseInventoryFormData(formData)
    const packFields = readPackFields(formData, fields.unitId)
    if ("error" in packFields) {
      return { error: packFields.error }
    }

    const { profitValue, profitPercentage } = calculateProfit(fields.costPrice, fields.cashPrice)

    const payload: Record<string, unknown> = {
      name: fields.name,
      stock: fields.stock,
      cost_price: fields.costPrice,
      cash_price: fields.cashPrice,
      credit_price: fields.creditPrice,
      supplier_price: fields.supplierPrice,
      profit_value: profitValue,
      profit_percentage: profitPercentage,
      // Pack/CTN support. Null when the item is sold only in base units.
      pack_unit_id: packFields.packUnitId,
      pack_size: packFields.packSize,
      category_id: fields.categoryId,
      unit_id: fields.unitId,
      barcode: null as string | null,
    }

    if (fields.barcode) {
      const resolved = await resolveAvailableBarcode(fields.barcode, currentUser.effectiveUserId)
      if (!resolved.ok) {
        return { error: resolved.error }
      }
      payload.barcode = resolved.barcode
    } else {
      payload.barcode = null
    }

    // Handle minimum_stock and maximum_stock
    payload.minimum_stock = fields.minimumStock !== null && fields.minimumStock >= 0 ? fields.minimumStock : null
    payload.maximum_stock = fields.maximumStock !== null && fields.maximumStock >= 0 ? fields.maximumStock : null

    // Validate that maximum_stock >= minimum_stock if both are set
    if (payload.maximum_stock !== null && payload.minimum_stock !== null && (payload.maximum_stock as number) < (payload.minimum_stock as number)) {
      return { error: "Maximum stock must be greater than or equal to minimum stock" }
    }

    // Validation
    if (!payload.name || (payload.name as string).trim() === "") {
      return { error: "Item name is required" }
    }

    if ((payload.stock as number) < 0) {
      return { error: "Stock cannot be negative" }
    }

    if ((payload.cost_price as number) <= 0) {
      return { error: "Cost price must be greater than 0" }
    }

    // Validate multi-tier prices
    if ((payload.cash_price as number) <= 0) {
      return { error: "Cash amount must be greater than 0" }
    }
    if ((payload.credit_price as number) <= 0) {
      return { error: "Credit amount must be greater than 0" }
    }
    if ((payload.supplier_price as number) <= 0) {
      return { error: "Supplier amount must be greater than 0" }
    }

    // Validate that all prices >= cost_price
    if ((payload.cash_price as number) < (payload.cost_price as number)) {
      return { error: `Cash amount (${payload.cash_price}) cannot be less than cost price (${payload.cost_price})` }
    }
    if ((payload.credit_price as number) < (payload.cost_price as number)) {
      return { error: `Credit amount (${payload.credit_price}) cannot be less than cost price (${payload.cost_price})` }
    }
    if ((payload.supplier_price as number) < (payload.cost_price as number)) {
      return { error: `Supplier amount (${payload.supplier_price}) cannot be less than cost price (${payload.cost_price})` }
    }

    // Validate category_id if provided (must belong to user)
    if (fields.categoryId) {
      const categoryRows = await sql`
        SELECT id FROM categories
        WHERE id = ${fields.categoryId} AND user_id = ${currentUser.effectiveUserId}
        LIMIT 1
      `
      if (categoryRows.length === 0) {
        return { error: "Selected category does not exist" }
      }
    }

    const [newItem] = await sql`
      INSERT INTO inventory_items (
        name, stock, cost_price, cash_price, credit_price, supplier_price,
        profit_value, profit_percentage, pack_unit_id, pack_size,
        category_id, unit_id, barcode, minimum_stock, maximum_stock, user_id
      ) VALUES (
        ${payload.name as string},
        ${payload.stock as number},
        ${payload.cost_price as number},
        ${payload.cash_price as number},
        ${payload.credit_price as number},
        ${payload.supplier_price as number},
        ${payload.profit_value as number},
        ${payload.profit_percentage as number},
        ${payload.pack_unit_id as string | null},
        ${payload.pack_size as number | null},
        ${payload.category_id as string | null},
        ${payload.unit_id as string | null},
        ${payload.barcode as string | null},
        ${payload.minimum_stock as number | null},
        ${payload.maximum_stock as number | null},
        ${currentUser.effectiveUserId}
      )
      RETURNING id
    `

    if (!newItem) {
      console.error("Error creating inventory item: no row returned")
      return { error: "Failed to create inventory item" }
    }

    // Auto-generate barcode if not provided
    if (!payload.barcode && newItem) {
      const generatedBarcode = await generateUniqueAutoBarcode(newItem.id as string, currentUser.effectiveUserId)

      // Update item with generated barcode
      try {
        await sql`
          UPDATE inventory_items SET barcode = ${generatedBarcode} WHERE id = ${newItem.id as string}
        `
      } catch (barcodeError) {
        console.error("Failed to update barcode:", barcodeError)
        // Continue - item is created, barcode generation failed
      }
    }

    // Record initial stock movement if stock > 0
    if (newItem && (payload.stock as number) > 0) {
      try {
        await recordStockMovement({
          itemId: newItem.id as string,
          movementType: "IN",
          quantity: payload.stock as number,
          referenceType: "Manual",
          notes: "Initial stock",
          userId: currentUser.effectiveUserId,
        })
      } catch (movementError) {
        console.error("Failed to record stock movement:", movementError)
        return { error: "Item created but failed to record stock movement" }
      }
    }

    revalidatePath("/stock-management/inventory")
    return { error: null }
  } catch (error) {
    console.error("Unexpected error in createInventoryItem:", error)
    return { error: error instanceof Error ? error.message : "An unexpected error occurred" }
  }
}

export async function updateInventoryItem(formData: FormData) {
  const currentUser = await getSessionOrRedirect()

  const id = String(formData.get("id") || "").trim()
  const fields = parseInventoryFormData(formData)

  const packFields = readPackFields(formData, fields.unitId)
  if ("error" in packFields) {
    return { error: packFields.error }
  }

  const { profitValue, profitPercentage } = calculateProfit(fields.costPrice, fields.cashPrice)

  const payload: Record<string, unknown> = {
    name: fields.name,
    stock: fields.stock,
    cost_price: fields.costPrice,
    cash_price: fields.cashPrice,
    credit_price: fields.creditPrice,
    supplier_price: fields.supplierPrice,
    profit_value: profitValue,
    profit_percentage: profitPercentage,
    // Pack/CTN support — always written so clearing the pack on edit actually persists as NULL.
    pack_unit_id: packFields.packUnitId,
    pack_size: packFields.packSize,
    // Always set category_id / unit_id (null if empty so clearing them on edit persists)
    category_id: fields.categoryId,
    unit_id: fields.unitId,
    minimum_stock: fields.minimumStock !== null && fields.minimumStock >= 0 ? fields.minimumStock : null,
    maximum_stock: fields.maximumStock !== null && fields.maximumStock >= 0 ? fields.maximumStock : null,
  }

  // Validate that maximum_stock >= minimum_stock if both are set
  if (payload.maximum_stock !== null && payload.minimum_stock !== null && (payload.maximum_stock as number) < (payload.minimum_stock as number)) {
    return { error: "Maximum stock must be greater than or equal to minimum stock" }
  }

  if (fields.barcode) {
    // On update, the row keeps its own barcode (excludeItemId), so we only reject collisions
    // against *other* rows owned by this user. No suffix-retry like the create path —
    // updates that hit a collision surface a clean error rather than silently rebadging.
    const existingRows = await sql`
      SELECT id FROM inventory_items
      WHERE barcode = ${fields.barcode}
        AND user_id = ${currentUser.effectiveUserId}
        AND id != ${id}
      LIMIT 1
    `
    if (existingRows.length > 0) {
      return { error: "Barcode already exists for another item" }
    }
    payload.barcode = fields.barcode
  } else {
    payload.barcode = null
  }

  // Validate required fields
  if (!id || !payload.name || (payload.stock as number) < 0 || (payload.cost_price as number) <= 0) {
    return { error: "ID, name, stock, and cost price are required" }
  }

  // Validate multi-tier prices
  if ((payload.cash_price as number) <= 0) {
    return { error: "Cash amount must be greater than 0" }
  }
  if ((payload.credit_price as number) <= 0) {
    return { error: "Credit amount must be greater than 0" }
  }
  if ((payload.supplier_price as number) <= 0) {
    return { error: "Supplier amount must be greater than 0" }
  }

  // Validate that all prices >= cost_price
  if ((payload.cash_price as number) < (payload.cost_price as number)) {
    return { error: `Cash amount (${payload.cash_price}) cannot be less than cost price (${payload.cost_price})` }
  }
  if ((payload.credit_price as number) < (payload.cost_price as number)) {
    return { error: `Credit amount (${payload.credit_price}) cannot be less than cost price (${payload.cost_price})` }
  }
  if ((payload.supplier_price as number) < (payload.cost_price as number)) {
    return { error: `Supplier amount (${payload.supplier_price}) cannot be less than cost price (${payload.cost_price})` }
  }

  // Get current stock to calculate difference (verify item belongs to user)
  const currentRows = await sql`
    SELECT stock FROM inventory_items
    WHERE id = ${id} AND user_id = ${currentUser.effectiveUserId}
    LIMIT 1
  `
  const currentItem = currentRows[0] ?? null

  if (!currentItem) {
    return { error: "Item not found" }
  }

  const currentStock = Number(currentItem.stock || 0)
  const newStock = payload.stock as number
  const stockDifference = newStock - currentStock

  try {
    await sql`
      UPDATE inventory_items SET
        name = ${payload.name as string},
        stock = ${payload.stock as number},
        cost_price = ${payload.cost_price as number},
        cash_price = ${payload.cash_price as number},
        credit_price = ${payload.credit_price as number},
        supplier_price = ${payload.supplier_price as number},
        profit_value = ${payload.profit_value as number},
        profit_percentage = ${payload.profit_percentage as number},
        pack_unit_id = ${payload.pack_unit_id as string | null},
        pack_size = ${payload.pack_size as number | null},
        category_id = ${payload.category_id as string | null},
        unit_id = ${payload.unit_id as string | null},
        barcode = ${payload.barcode as string | null},
        minimum_stock = ${payload.minimum_stock as number | null},
        maximum_stock = ${payload.maximum_stock as number | null}
      WHERE id = ${id} AND user_id = ${currentUser.effectiveUserId}
    `
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to update item" }
  }

  // Record stock movement if there's a difference
  if (stockDifference !== 0) {
    try {
      await recordStockMovement({
        itemId: id,
        movementType: stockDifference > 0 ? "IN" : "OUT",
        quantity: Math.abs(stockDifference),
        referenceType: "Adjustment",
        notes: `Stock adjusted from ${currentStock} to ${newStock}`,
        userId: currentUser.effectiveUserId,
      })
    } catch (movementError) {
      console.error("Failed to record stock movement:", movementError)
      return { error: "Item updated but failed to record stock movement" }
    }
  }

  revalidatePath("/stock-management/inventory")
  return { error: null }
}

export async function restoreInventoryItem(itemId: string) {
  const currentUser = await getSessionOrRedirect()

  if (!itemId) {
    return { error: "Item ID is required" }
  }

  try {
    await sql`
      UPDATE inventory_items SET is_archived = false
      WHERE id = ${itemId} AND user_id = ${currentUser.effectiveUserId}
    `
    revalidatePath("/stock-management/inventory")
    revalidatePath("/dashboard")
    return { error: null }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to restore item" }
  }
}

export async function deleteInventoryItem(itemId: string) {
  const currentUser = await getSessionOrRedirect()

  if (!itemId) {
    return { error: "Item ID is required" }
  }

  // IV-M1: check ALL tables that reference inventory_items.id before deciding hard-delete vs
  // soft-archive. The previous version only checked sales_invoice_lines, so an item used
  // ONLY in a purchase (received but never sold) or in a return would get hard-deleted and
  // trip a foreign-key violation downstream (or, if CASCADE is on, orphan parent records).
  // Run the three counts in parallel — all are head-only count queries so very cheap.
  const [salesRef, purchaseRef, returnRef] = await Promise.all([
    sql`SELECT COUNT(*) AS count FROM sales_invoice_lines WHERE item_id = ${itemId}`,
    sql`SELECT COUNT(*) AS count FROM purchase_invoice_lines WHERE item_id = ${itemId}`,
    sql`SELECT COUNT(*) AS count FROM return_lines WHERE item_id = ${itemId}`,
  ])

  const hasReferences =
    Number(salesRef[0]?.count ?? 0) > 0 ||
    Number(purchaseRef[0]?.count ?? 0) > 0 ||
    Number(returnRef[0]?.count ?? 0) > 0

  if (hasReferences) {
    // Soft delete — archive the item so it disappears from inventory but transaction
    // history (sales, purchases, returns) stays intact. The is_archived filter on
    // inventory listings + reports hides it from active views.
    try {
      await sql`
        UPDATE inventory_items SET is_archived = true
        WHERE id = ${itemId} AND user_id = ${currentUser.effectiveUserId}
      `
      revalidatePath("/stock-management/inventory")
      revalidatePath("/dashboard")
      return { error: null, archived: true }
    } catch (archiveError) {
      return { error: archiveError instanceof Error ? archiveError.message : "Failed to archive item" }
    }
  }

  try {
    await sql`
      DELETE FROM inventory_items
      WHERE id = ${itemId} AND user_id = ${currentUser.effectiveUserId}
    `
    revalidatePath("/stock-management/inventory")
    revalidatePath("/dashboard")
    return { error: null, archived: false }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to delete item" }
  }
}

export async function bulkImportInventory(
  rows: Array<{
    name: string
    barcode?: string | null
    category?: string | null
    unit?: string | null
    cost_price?: number | null
    cash_price?: number | null
    credit_price?: number | null
    supplier_price?: number | null
    stock?: number | null
    minimum_stock?: number | null
    maximum_stock?: number | null
  }>
): Promise<{ imported: number; updated: number; errors: string[] }> {
  try {
    const currentUser = await getSessionOrRedirect()
    const userId = currentUser.effectiveUserId

    const errors: string[] = []
    let imported = 0
    let updated = 0

    // Build category name → id map (fetch all user categories once)
    const cats = await sql`SELECT id, name FROM categories WHERE user_id = ${userId}`
    const catMap = new Map<string, string>(
      (cats as unknown as Array<{ name: string; id: string }>).map((c) => [c.name.toLowerCase(), c.id])
    )

    // Build unit symbol/name → id map
    const units = await sql`SELECT id, name, symbol FROM units WHERE user_id = ${userId}`
    const unitMap = new Map<string, string>()
    ;(units as unknown as Array<{ id: string; name: string; symbol?: string | null }>).forEach((u) => {
      if (u.symbol) unitMap.set(u.symbol.toLowerCase(), u.id)
      unitMap.set(u.name.toLowerCase(), u.id)
    })

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2 // 1-indexed, header is row 1

      if (!row.name?.trim()) {
        errors.push(`Row ${rowNum}: name is required`)
        continue
      }

      const categoryId = row.category ? (catMap.get(row.category.toLowerCase()) ?? null) : null
      const unitId = row.unit ? (unitMap.get(row.unit.toLowerCase()) ?? null) : null

      const cashPrice = row.cash_price ?? 0
      const costPrice = row.cost_price ?? 0
      const profitValue = Math.max(0, cashPrice - costPrice)
      const profitPercentage = costPrice > 0 ? Math.round((profitValue / costPrice) * 100 * 100) / 100 : 0

      const barcode = row.barcode?.trim() || null
      const name = row.name.trim()
      const creditPrice = row.credit_price ?? cashPrice
      const supplierPrice = row.supplier_price ?? costPrice
      const stock = row.stock ?? 0
      const minimumStock = row.minimum_stock ?? null
      const maximumStock = row.maximum_stock ?? null

      // If barcode given, try to find existing item
      if (barcode) {
        const existing = await sql`
          SELECT id FROM inventory_items
          WHERE user_id = ${userId} AND barcode = ${barcode}
          LIMIT 1
        `

        if (existing.length > 0) {
          try {
            await sql`
              UPDATE inventory_items SET
                name = ${name},
                barcode = ${barcode},
                category_id = ${categoryId},
                unit_id = ${unitId},
                cost_price = ${costPrice},
                cash_price = ${cashPrice},
                credit_price = ${creditPrice},
                supplier_price = ${supplierPrice},
                profit_value = ${profitValue},
                profit_percentage = ${profitPercentage},
                stock = ${stock},
                minimum_stock = ${minimumStock},
                maximum_stock = ${maximumStock}
              WHERE id = ${existing[0].id as string}
            `
            updated++
          } catch (e) {
            errors.push(`Row ${rowNum} (${row.name}): ${String(e)}`)
          }
          continue
        }
      }

      try {
        await sql`
          INSERT INTO inventory_items (
            name, barcode, category_id, unit_id, cost_price, cash_price, credit_price,
            supplier_price, profit_value, profit_percentage, stock, minimum_stock, maximum_stock, user_id
          ) VALUES (
            ${name}, ${barcode}, ${categoryId}, ${unitId}, ${costPrice}, ${cashPrice},
            ${creditPrice}, ${supplierPrice}, ${profitValue}, ${profitPercentage},
            ${stock}, ${minimumStock}, ${maximumStock}, ${userId}
          )
        `
        imported++
      } catch (e) {
        errors.push(`Row ${rowNum} (${row.name}): ${String(e)}`)
      }
    }

    revalidatePath("/stock-management/inventory")
    return { imported, updated, errors }
  } catch (e) {
    console.error("[bulkImportInventory] unexpected error:", e)
    return { imported: 0, updated: 0, errors: [String(e)] }
  }
}
