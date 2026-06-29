import { requirePrivilege } from "@/lib/auth/privileges"
import { getGatePassItems, getInventoryCategories } from "../actions"
import { GatePassClient } from "./gate-pass-client"
import { getAllSettings } from "@/app/(app)/settings/actions"

// ─── PKT helpers (same as gross-profit/page.tsx) ──────────────────────────────

function getPKTNow(): Date {
  return new Date(Date.now() + 5 * 60 * 60 * 1000)
}

function computePeriodRange(period: string): { from: string; to: string } | null {
  const now = getPKTNow()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const day = now.getUTCDate()
  const dow = now.getUTCDay()

  function startOfDay(d: Date): string {
    const out = new Date(d)
    out.setUTCHours(0, 0, 0, 0)
    return out.toISOString()
  }
  function endOfDay(d: Date): string {
    const out = new Date(d)
    out.setUTCHours(23, 59, 59, 999)
    return out.toISOString()
  }

  switch (period) {
    case "today": {
      return { from: startOfDay(now), to: endOfDay(now) }
    }
    case "this-week": {
      const daysBack = dow === 0 ? 6 : dow - 1
      const monday = new Date(now)
      monday.setUTCDate(day - daysBack)
      return { from: startOfDay(monday), to: endOfDay(now) }
    }
    case "last-week": {
      const daysBack = dow === 0 ? 6 : dow - 1
      const thisMonday = new Date(now)
      thisMonday.setUTCDate(day - daysBack)
      const lastMonday = new Date(thisMonday)
      lastMonday.setUTCDate(thisMonday.getUTCDate() - 7)
      const lastSunday = new Date(thisMonday)
      lastSunday.setUTCDate(thisMonday.getUTCDate() - 1)
      return { from: startOfDay(lastMonday), to: endOfDay(lastSunday) }
    }
    case "this-month": {
      const first = new Date(Date.UTC(year, month, 1))
      return { from: startOfDay(first), to: endOfDay(now) }
    }
    case "last-month": {
      const firstOfLastMonth = new Date(Date.UTC(year, month - 1, 1))
      const lastOfLastMonth = new Date(Date.UTC(year, month, 0))
      return { from: startOfDay(firstOfLastMonth), to: endOfDay(lastOfLastMonth) }
    }
    case "this-year": {
      const jan1 = new Date(Date.UTC(year, 0, 1))
      return { from: startOfDay(jan1), to: endOfDay(now) }
    }
    case "last-year": {
      const jan1 = new Date(Date.UTC(year - 1, 0, 1))
      const dec31 = new Date(Date.UTC(year - 1, 11, 31))
      return { from: startOfDay(jan1), to: endOfDay(dec31) }
    }
    default:
      return null
  }
}

function formatPeriodLabel(period: string, dateFrom?: string, dateTo?: string): string {
  const labels: Record<string, string> = {
    today: "Today",
    "this-week": "This Week",
    "last-week": "Last Week",
    "this-month": "This Month",
    "last-month": "Last Month",
    "this-year": "This Year",
    "last-year": "Last Year",
  }
  if (period === "custom") {
    return `${dateFrom ?? ""} to ${dateTo ?? ""}`
  }
  return labels[period] ?? period
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<{
    period?: string
    dateFrom?: string
    dateTo?: string
    category?: string
  }>
}

export default async function GatePassPage({ searchParams }: PageProps) {
  await requirePrivilege("bi-report")
  const params = await searchParams

  const period = params.period ?? "today"
  const category = params.category ?? "all"

  // Resolve date range in PKT
  let from: string | undefined
  let to: string | undefined

  if (period === "custom") {
    from = params.dateFrom ? new Date(params.dateFrom + "T00:00:00+05:00").toISOString() : undefined
    to = params.dateTo ? new Date(params.dateTo + "T23:59:59+05:00").toISOString() : undefined
  } else {
    const range = computePeriodRange(period)
    if (range) {
      from = range.from
      to = range.to
    }
  }

  // Fetch data in parallel
  const [gpResult, categoriesResult, settings] = await Promise.all([
    getGatePassItems(from, to, category === "all" ? undefined : category),
    getInventoryCategories(),
    getAllSettings(),
  ])

  const periodLabel = formatPeriodLabel(period, params.dateFrom, params.dateTo)
  const generatedAt = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().replace("T", " ").substring(0, 19) + " PKT"

  return (
    <GatePassClient
      items={gpResult.data}
      error={gpResult.error}
      period={period}
      dateFrom={params.dateFrom ?? ""}
      dateTo={params.dateTo ?? ""}
      category={category}
      categories={categoriesResult.data}
      periodLabel={periodLabel}
      generatedAt={generatedAt}
      storeName={settings.store_name || "Store"}
      storeAddress={settings.store_address || undefined}
      storePhone={settings.store_phone || undefined}
    />
  )
}
