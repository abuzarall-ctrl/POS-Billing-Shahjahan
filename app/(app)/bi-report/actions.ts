"use server"

import { revalidatePath } from "next/cache"
import sql from "@/lib/db"
import { getSessionOrRedirect } from "@/lib/auth"

export interface Expense {
  id: string
  user_id: string
  description: string
  amount: number
  created_at: string
}

export interface GrossProfitItem {
  name: string
  category: string
  qty: number
  revenue: number
  cost: number
  gp: number
  gpPct: number
}

export async function addExpense(
  description: string,
  amount: number,
): Promise<{ error: string | null }> {
  const currentUser = await getSessionOrRedirect()

  if (!description || description.trim() === "") {
    return { error: "Description is required" }
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return { error: "Amount must be a non-negative number" }
  }

  try {
    await sql`
      INSERT INTO expenses (user_id, description, amount)
      VALUES (${currentUser.effectiveUserId}, ${description.trim()}, ${amount})
    `
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to add expense" }
  }

  revalidatePath("/bi-report/expense-sheet")
  return { error: null }
}

export async function getExpenses(
  from?: string,
  to?: string,
): Promise<{ data: Expense[]; error: string | null }> {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{ id: string; user_id: string; description: string; amount: string; created_at: string }[]>`
      SELECT id, user_id, description, amount, created_at
      FROM expenses
      WHERE user_id = ${currentUser.effectiveUserId}
        ${from ? sql`AND created_at >= ${from}` : sql``}
        ${to ? sql`AND created_at <= ${to}` : sql``}
      ORDER BY created_at ASC
    `

    return {
      data: rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        description: row.description,
        amount: Number(row.amount),
        created_at: row.created_at,
      })),
      error: null,
    }
  } catch (err) {
    return { data: [], error: err instanceof Error ? err.message : "Failed to fetch expenses" }
  }
}

export async function deleteExpense(id: string): Promise<{ error: string | null }> {
  const currentUser = await getSessionOrRedirect()

  if (!id) return { error: "Expense ID is required" }

  try {
    await sql`DELETE FROM expenses WHERE id = ${id} AND user_id = ${currentUser.effectiveUserId}`
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to delete expense" }
  }

  revalidatePath("/bi-report/expense-sheet")
  return { error: null }
}

export async function getGrossProfitItems(
  from?: string,
  to?: string,
  category?: string,
): Promise<{ data: GrossProfitItem[]; error: string | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    const invoices = await sql<{ id: string; subtotal: string; discount: string }[]>`
      SELECT id, subtotal, discount FROM sales_invoices
      WHERE user_id = ${userId}
        AND status = ANY(ARRAY['Paid','Credit','Partial','Pending','Partially Returned'])
        ${from ? sql`AND created_at >= ${from}` : sql``}
        ${to ? sql`AND created_at <= ${to}` : sql``}
    `

    if (!invoices.length) return { data: [], error: null }

    const invoiceIds = invoices.map((i) => i.id)

    // ratio = (subtotal - bill_discount) / subtotal distributes the bill-level
    // discount proportionally across lines (line_total already handles per-line discounts)
    const invoiceRatioMap = new Map<string, number>()
    for (const inv of invoices) {
      const subtotal = Number(inv.subtotal ?? 0)
      const billDiscount = Number(inv.discount ?? 0)
      invoiceRatioMap.set(inv.id, subtotal > 0 ? (subtotal - billDiscount) / subtotal : 1)
    }

    const lines = await sql<{
      invoice_id: string
      item_id: string
      quantity: string
      line_total: string
      line_cost_price: string | null
      item_cost_price: string | null
      item_name: string
      category_name: string | null
    }[]>`
      SELECT
        sil.invoice_id,
        sil.item_id,
        sil.quantity,
        sil.line_total,
        sil.cost_price AS line_cost_price,
        ii.cost_price AS item_cost_price,
        ii.name AS item_name,
        cat.name AS category_name
      FROM sales_invoice_lines sil
      LEFT JOIN inventory_items ii ON ii.id = sil.item_id
      LEFT JOIN categories cat ON cat.id = ii.category_id
      WHERE sil.invoice_id = ANY(${invoiceIds})
    `

    type Bucket = { name: string; category: string; qty: number; revenue: number; cost: number }
    const grouped = new Map<string, Bucket>()

    for (const line of lines) {
      const itemId = line.item_id
      const qty = Number(line.quantity ?? 0)
      const ratio = invoiceRatioMap.get(line.invoice_id) ?? 1
      const revenue = Number(line.line_total ?? 0) * ratio
      const itemCategory = line.category_name ?? "Uncategorized"

      if (category && category !== "all" && itemCategory !== category) continue

      const rawLineCost = line.line_cost_price
      const rawItemCost = line.item_cost_price
      const unitCost =
        rawLineCost !== null && rawLineCost !== undefined
          ? Number(rawLineCost)
          : rawItemCost !== null && rawItemCost !== undefined
            ? Number(rawItemCost)
            : 0
      const costAmount = unitCost * qty

      const existing = grouped.get(itemId)
      if (existing) {
        existing.qty += qty
        existing.revenue += revenue
        existing.cost += costAmount
      } else {
        grouped.set(itemId, {
          name: line.item_name ?? "Unknown",
          category: itemCategory,
          qty,
          revenue,
          cost: costAmount,
        })
      }
    }

    const data: GrossProfitItem[] = Array.from(grouped.values())
      .filter((g) => g.qty > 0)
      .map((g) => {
        const gp = g.revenue - g.cost
        const gpPct = g.revenue > 0 ? (gp / g.revenue) * 100 : 0
        return { name: g.name, category: g.category, qty: g.qty, revenue: g.revenue, cost: g.cost, gp, gpPct }
      })
      .sort((a, b) => b.gp - a.gp)

    return { data, error: null }
  } catch (err) {
    return { data: [], error: err instanceof Error ? err.message : "Failed to fetch gross profit items" }
  }
}

export async function getInventoryCategories(): Promise<{ data: string[]; error: string | null }> {
  const currentUser = await getSessionOrRedirect()

  try {
    const rows = await sql<{ name: string }[]>`
      SELECT name FROM categories
      WHERE user_id = ${currentUser.effectiveUserId}
      ORDER BY name ASC
    `
    return { data: rows.map((r) => r.name).filter(Boolean), error: null }
  } catch (err) {
    return { data: [], error: err instanceof Error ? err.message : "Failed to fetch categories" }
  }
}

// ─── Gate Pass ────────────────────────────────────────────────────────────────

export interface GatePassItem {
  item_id: string
  barcode: string | null
  name: string
  pack_size: number | null
  unit_price: number
  category_name: string
  total_qty: number
  total_revenue: number
}

export async function getGatePassItems(
  from?: string,
  to?: string,
  categoryFilter?: string,
): Promise<{ data: GatePassItem[]; error: string | null }> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  try {
    const invoices = await sql<{ id: string; subtotal: string; discount: string }[]>`
      SELECT id, subtotal, discount FROM sales_invoices
      WHERE user_id = ${userId}
        AND status = ANY(ARRAY['Paid','Credit','Partial','Pending','Partially Returned'])
        ${from ? sql`AND created_at >= ${from}` : sql``}
        ${to ? sql`AND created_at <= ${to}` : sql``}
    `

    if (!invoices.length) return { data: [], error: null }

    const invoiceIds = invoices.map((i) => i.id)

    const invoiceRatioMap = new Map<string, number>()
    for (const inv of invoices) {
      const subtotal = Number(inv.subtotal ?? 0)
      const billDiscount = Number(inv.discount ?? 0)
      invoiceRatioMap.set(inv.id, subtotal > 0 ? (subtotal - billDiscount) / subtotal : 1)
    }

    const lines = await sql<{
      invoice_id: string
      item_id: string
      quantity: string
      line_total: string
      barcode: string | null
      item_name: string
      pack_size: string | null
      category_name: string | null
    }[]>`
      SELECT
        sil.invoice_id,
        sil.item_id,
        sil.quantity,
        sil.line_total,
        ii.barcode,
        ii.name AS item_name,
        ii.pack_size,
        cat.name AS category_name
      FROM sales_invoice_lines sil
      LEFT JOIN inventory_items ii ON ii.id = sil.item_id
      LEFT JOIN categories cat ON cat.id = ii.category_id
      WHERE sil.invoice_id = ANY(${invoiceIds})
    `

    type Bucket = {
      item_id: string; barcode: string | null; name: string; pack_size: number | null
      category_name: string; total_qty: number; total_revenue: number
    }
    const grouped = new Map<string, Bucket>()

    for (const line of lines) {
      const itemId = line.item_id
      const qty = Number(line.quantity ?? 0)
      const ratio = invoiceRatioMap.get(line.invoice_id) ?? 1
      const revenue = Number(line.line_total ?? 0) * ratio
      const categoryName = line.category_name ?? "Uncategorized"

      if (categoryFilter && categoryFilter !== "all" && categoryName !== categoryFilter) continue

      const existing = grouped.get(itemId)
      if (existing) {
        existing.total_qty += qty
        existing.total_revenue += revenue
      } else {
        grouped.set(itemId, {
          item_id: itemId,
          barcode: line.barcode,
          name: line.item_name ?? "Unknown",
          pack_size: line.pack_size != null ? Number(line.pack_size) : null,
          category_name: categoryName,
          total_qty: qty,
          total_revenue: revenue,
        })
      }
    }

    const data: GatePassItem[] = Array.from(grouped.values())
      .filter((g) => g.total_qty > 0)
      .map((g) => ({ ...g, unit_price: g.total_qty > 0 ? g.total_revenue / g.total_qty : 0 }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return { data, error: null }
  } catch (err) {
    return { data: [], error: err instanceof Error ? err.message : "Failed to fetch gate pass items" }
  }
}

// ─── Payroll Total ────────────────────────────────────────────────────────────

export async function getPayrollTotal(from?: string, to?: string): Promise<number> {
  const currentUser = await getSessionOrRedirect()

  try {
    const employees = await sql<{ id: string }[]>`
      SELECT id FROM employees WHERE user_id = ${currentUser.effectiveUserId}
    `
    if (!employees.length) return 0

    const employeeIds = employees.map((e) => e.id)

    const runs = await sql<{ id: string }[]>`
      SELECT id FROM payroll_runs
      WHERE status = 'paid'
        ${from ? sql`AND month >= ${from.substring(0, 10)}` : sql``}
        ${to ? sql`AND month <= ${to.substring(0, 10)}` : sql``}
    `
    if (!runs.length) return 0

    const runIds = runs.map((r) => r.id)

    const payLines = await sql<{ net: string }[]>`
      SELECT net FROM payroll_lines
      WHERE payroll_id = ANY(${runIds})
        AND employee_id = ANY(${employeeIds})
        AND payment_status = 'paid'
    `

    return payLines.reduce((sum, row) => sum + Number(row.net ?? 0), 0)
  } catch {
    return 0
  }
}

export async function importExpenses(
  rows: Array<{ description: string; amount: number }>
): Promise<{ error: string | null }> {
  const currentUser = await getSessionOrRedirect()

  if (!rows.length) return { error: null }

  const inserts = rows.map((r) => ({
    user_id: currentUser.effectiveUserId,
    description: r.description.trim(),
    amount: r.amount,
  }))

  try {
    await sql`INSERT INTO expenses ${sql(inserts)}`
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to import expenses" }
  }

  revalidatePath("/bi-report/expense-sheet")
  return { error: null }
}
