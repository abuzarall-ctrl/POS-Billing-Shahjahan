"use server"

import sql from "@/lib/db"
import { getSessionOrRedirect } from "@/lib/auth"

export async function getCategoriesForSelect() {
  const currentUser = await getSessionOrRedirect()
  try {
    const rows = await sql`
      SELECT id, name
      FROM categories
      WHERE user_id = ${currentUser.effectiveUserId}
      ORDER BY name ASC
    `
    return rows as unknown as Array<{ id: string; name: string }>
  } catch {
    return []
  }
}
