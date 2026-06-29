"use server"

import sql from "@/lib/db"
import { getSessionOrRedirect } from "@/lib/auth"

export async function getUnitsForSelect() {
  const currentUser = await getSessionOrRedirect()
  try {
    const rows = await sql`
      SELECT id, name, symbol
      FROM units
      WHERE user_id = ${currentUser.effectiveUserId}
      ORDER BY name ASC
    `
    return rows as unknown as Array<{ id: string; name: string; symbol: string | null }>
  } catch (error) {
    console.error("Error fetching units:", error)
    return []
  }
}
