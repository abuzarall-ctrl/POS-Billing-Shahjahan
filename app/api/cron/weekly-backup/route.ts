import { NextRequest, NextResponse } from "next/server"
import sql from "@/lib/db"

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization")
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 })
  }

  try {
    const users = await sql<{ id: string }[]>`
      SELECT id FROM pos_users WHERE is_active = true AND role = 'pos_user'
    `

    if (!users.length) {
      return NextResponse.json({ error: "No active users found" }, { status: 500 })
    }

    const upsertRows = users.map((u) => ({
      user_id: u.id,
      key: "backup_due",
      value: "true",
    }))

    await sql`
      INSERT INTO user_settings ${sql(upsertRows)}
      ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
    `

    return NextResponse.json({ ok: true, users_notified: users.length })
  } catch (err) {
    return NextResponse.json(
      { error: "Database error", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
