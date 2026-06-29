"use server"

import sql from "@/lib/db"
import { getSessionOrRedirect } from "@/lib/auth"

// Keys used in user_settings
const BACKUP_DUE_KEY = "backup_due"
const LAST_BACKUP_AT_KEY = "last_backup_at"

// Category → table mapping
const CATEGORY_TABLES: Record<string, string[]> = {
  "sales-invoices": ["sales_invoices", "sales_invoice_lines", "payments"],
  "inventory-stock": ["inventory_items", "categories", "units", "stock_movements"],
  "purchases": ["purchase_invoices", "purchase_invoice_lines", "purchase_payments"],
  "parties": ["parties"],
  "employees-payroll": ["employees", "employee_salaries", "payroll_runs", "payroll_lines", "employee_ledger_entries"],
  "returns-refunds": ["returns", "return_lines", "refunds"],
}

export async function fetchBackupData(
  categories: string[]
): Promise<Record<string, Record<string, unknown>[]>> {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId

  const tablesToFetch = new Set<string>()
  for (const cat of categories) {
    if (cat === "all") {
      Object.values(CATEGORY_TABLES).flat().forEach((t) => tablesToFetch.add(t))
    } else {
      CATEGORY_TABLES[cat]?.forEach((t) => tablesToFetch.add(t))
    }
  }

  const result: Record<string, Record<string, unknown>[]> = {}

  await Promise.all(
    Array.from(tablesToFetch).map(async (table) => {
      try {
        const rows = await sql`SELECT * FROM ${sql(table)} WHERE user_id = ${userId}`
        result[table] = rows as Record<string, unknown>[]
      } catch {
        result[table] = []
      }
    })
  )

  return result
}

export async function markBackupDone() {
  const currentUser = await getSessionOrRedirect()
  const userId = currentUser.effectiveUserId
  const now = new Date().toISOString()

  await sql`
    INSERT INTO user_settings (user_id, key, value)
    VALUES
      (${userId}, ${BACKUP_DUE_KEY}, 'false'),
      (${userId}, ${LAST_BACKUP_AT_KEY}, ${now})
    ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
  `
}

export async function getBackupStatus(): Promise<{
  backup_due: boolean
  last_backup_at: string | null
}> {
  const currentUser = await getSessionOrRedirect()

  const rows = await sql<{ key: string; value: string }[]>`
    SELECT key, value FROM user_settings
    WHERE user_id = ${currentUser.effectiveUserId}
      AND key = ANY(${[BACKUP_DUE_KEY, LAST_BACKUP_AT_KEY]})
  `

  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))

  return {
    backup_due: map[BACKUP_DUE_KEY] === "true",
    last_backup_at: map[LAST_BACKUP_AT_KEY] ?? null,
  }
}
