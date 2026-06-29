"use server"

import sql from "@/lib/db"

export async function getCostPrice(itemId: string, userId: string): Promise<number> {
  const rows = await sql`
    SELECT cost_price FROM inventory_items
    WHERE id = ${itemId} AND user_id = ${userId} LIMIT 1
  `
  return Number(rows[0]?.cost_price ?? 0)
}

export async function getSellingPrice(itemId: string, userId: string): Promise<number> {
  const rows = await sql`
    SELECT cash_price, selling_price FROM inventory_items
    WHERE id = ${itemId} AND user_id = ${userId} LIMIT 1
  `
  const data = rows[0]
  return Number(data?.cash_price ?? data?.selling_price ?? 0)
}

export async function getPriceByType(
  itemId: string,
  userId: string,
  priceType: "cash" | "credit" | "supplier" = "cash"
): Promise<number> {
  const rows = await sql`
    SELECT cash_price, credit_price, supplier_price, selling_price FROM inventory_items
    WHERE id = ${itemId} AND user_id = ${userId} LIMIT 1
  `
  const data = rows[0]
  if (!data) return 0
  switch (priceType) {
    case "credit":  return Number(data.credit_price ?? data.cash_price ?? data.selling_price ?? 0)
    case "supplier": return Number(data.supplier_price ?? data.cash_price ?? data.selling_price ?? 0)
    default:        return Number(data.cash_price ?? data.selling_price ?? 0)
  }
}

export async function getItemPrices(itemId: string, userId: string) {
  const rows = await sql`
    SELECT cost_price, selling_price, cash_price FROM inventory_items
    WHERE id = ${itemId} AND user_id = ${userId} LIMIT 1
  `
  const data = rows[0]
  return {
    costPrice: Number(data?.cost_price ?? 0),
    sellingPrice: Number(data?.cash_price ?? data?.selling_price ?? 0),
  }
}

export async function getItemAllPrices(itemId: string, userId: string) {
  const rows = await sql`
    SELECT cost_price, cash_price, credit_price, supplier_price, profit_percentage, profit_value
    FROM inventory_items
    WHERE id = ${itemId} AND user_id = ${userId} LIMIT 1
  `
  const data = rows[0]
  return {
    costPrice: Number(data?.cost_price ?? 0),
    cashPrice: Number(data?.cash_price ?? 0),
    creditPrice: Number(data?.credit_price ?? 0),
    supplierPrice: Number(data?.supplier_price ?? 0),
    profitPercentage: Number(data?.profit_percentage ?? 0),
    profitValue: Number(data?.profit_value ?? 0),
  }
}

export async function getMultipleItemPrices(
  itemIds: string[],
  userId: string
): Promise<Map<string, { costPrice: number; sellingPrice: number }>> {
  if (!itemIds.length) return new Map()
  const rows = await sql`
    SELECT id, cost_price, selling_price, cash_price FROM inventory_items
    WHERE id IN ${sql(itemIds)} AND user_id = ${userId}
  `
  const map = new Map<string, { costPrice: number; sellingPrice: number }>()
  rows.forEach((item) => {
    map.set(item.id as string, {
      costPrice: Number(item.cost_price ?? 0),
      sellingPrice: Number(item.cash_price ?? item.selling_price ?? 0),
    })
  })
  return map
}

export async function getMultipleItemAllPrices(
  itemIds: string[],
  userId: string
): Promise<Map<string, { costPrice: number; cashPrice: number; creditPrice: number; supplierPrice: number }>> {
  if (!itemIds.length) return new Map()
  const rows = await sql`
    SELECT id, cost_price, cash_price, credit_price, supplier_price FROM inventory_items
    WHERE id IN ${sql(itemIds)} AND user_id = ${userId}
  `
  const map = new Map<string, { costPrice: number; cashPrice: number; creditPrice: number; supplierPrice: number }>()
  rows.forEach((item) => {
    map.set(item.id as string, {
      costPrice: Number(item.cost_price ?? 0),
      cashPrice: Number(item.cash_price ?? 0),
      creditPrice: Number(item.credit_price ?? 0),
      supplierPrice: Number(item.supplier_price ?? 0),
    })
  })
  return map
}

export async function getCostPriceMap(itemIds: string[], userId: string): Promise<Map<string, number>> {
  if (!itemIds.length) return new Map()
  const rows = await sql`
    SELECT id, cost_price FROM inventory_items
    WHERE id IN ${sql(itemIds)} AND user_id = ${userId}
  `
  const map = new Map<string, number>()
  rows.forEach((item) => { map.set(item.id as string, Number(item.cost_price ?? 0)) })
  return map
}

export async function getMultipleItemPricesByType(
  itemIds: string[],
  userId: string,
  priceType: "cash" | "credit" | "supplier" = "cash"
): Promise<Map<string, number>> {
  if (!itemIds.length) return new Map()
  const rows = await sql`
    SELECT id, cash_price, credit_price, supplier_price, selling_price FROM inventory_items
    WHERE id IN ${sql(itemIds)} AND user_id = ${userId}
  `
  const map = new Map<string, number>()
  rows.forEach((item) => {
    let price = 0
    switch (priceType) {
      case "credit":   price = Number(item.credit_price ?? item.cash_price ?? item.selling_price ?? 0); break
      case "supplier": price = Number(item.supplier_price ?? item.cash_price ?? item.selling_price ?? 0); break
      default:         price = Number(item.cash_price ?? item.selling_price ?? 0)
    }
    map.set(item.id as string, price)
  })
  return map
}

export function calculateLineItemProfit(unitPrice: number, costPrice: number, quantity: number): number {
  return (unitPrice - costPrice) * quantity
}

export function calculateInvoiceProfit(lineItems: Array<{ unitPrice: number; costPrice: number; quantity: number }>): number {
  return lineItems.reduce((total, item) => total + calculateLineItemProfit(item.unitPrice, item.costPrice, item.quantity), 0)
}

export function validatePricing(
  costPrice: number,
  cashPrice: number,
  creditPrice: number,
  supplierPrice: number
): { valid: boolean; error?: string } {
  if (costPrice <= 0)    return { valid: false, error: "Cost price must be greater than 0" }
  if (cashPrice <= 0)    return { valid: false, error: "Cash amount must be greater than 0" }
  if (creditPrice <= 0)  return { valid: false, error: "Credit amount must be greater than 0" }
  if (supplierPrice <= 0) return { valid: false, error: "Supplier amount must be greater than 0" }
  if (cashPrice < costPrice)    return { valid: false, error: `Cash amount (${cashPrice}) cannot be less than cost price (${costPrice})` }
  if (creditPrice < costPrice)  return { valid: false, error: `Credit amount (${creditPrice}) cannot be less than cost price (${costPrice})` }
  if (supplierPrice < costPrice) return { valid: false, error: `Supplier amount (${supplierPrice}) cannot be less than cost price (${costPrice})` }
  return { valid: true }
}

export function calculateMarginPercentage(costPrice: number, sellingPrice: number): number {
  if (sellingPrice === 0) return 0
  return ((sellingPrice - costPrice) / sellingPrice) * 100
}

export function calculateMarkupPercentage(costPrice: number, sellingPrice: number): number {
  if (costPrice === 0) return 0
  return ((sellingPrice - costPrice) / costPrice) * 100
}

export function calculateProfitPercentageByType(
  costPrice: number,
  priceType: "cash" | "credit" | "supplier",
  prices: { cashPrice: number; creditPrice: number; supplierPrice: number }
): number {
  if (costPrice === 0) return 0
  const price = priceType === "credit" ? prices.creditPrice : priceType === "supplier" ? prices.supplierPrice : prices.cashPrice
  return Math.round(((price - costPrice) / costPrice) * 100 * 100) / 100
}

export function calculateProfitValueByType(
  costPrice: number,
  priceType: "cash" | "credit" | "supplier",
  prices: { cashPrice: number; creditPrice: number; supplierPrice: number }
): number {
  const price = priceType === "credit" ? prices.creditPrice : priceType === "supplier" ? prices.supplierPrice : prices.cashPrice
  return Math.max(0, price - costPrice)
}
