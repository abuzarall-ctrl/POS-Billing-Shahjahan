import { createAdminClient } from "@/lib/supabase/admin"
import { isSupabaseReady } from "@/lib/supabase/config"
import { requirePrivilege } from "@/lib/auth/privileges"
import { getReturns } from "../actions"
import { SalesReturnDialog } from "@/components/sales-return-dialog"
import { SalesReturnsClient } from "./sales-returns-client"

interface SalesReturnsPageProps {
  searchParams: Promise<{ dateFrom?: string; dateTo?: string; partyId?: string }>
}

export default async function SalesReturnsPage({ searchParams }: SalesReturnsPageProps) {
  const currentUser = await requirePrivilege("returns_refunds")

  const params = await searchParams
  const salesReturns = await (async () => {
    if (!isSupabaseReady()) return []
    return await getReturns("sale", params.dateFrom, params.dateTo, params.partyId)
  })()

  // Get sales invoices for the dialog. Only finalised, non-cancelled invoices are eligible
  // for return — Drafts (post R2-C1) never decremented stock, so returning items from a
  // Draft would silently inflate stock; Cancelled invoices have already been zeroed.
  const salesInvoices = await (async () => {
    if (!isSupabaseReady()) return []
    const supabase = createAdminClient()
    const { data } = await supabase
      .from("sales_invoices")
      .select(
        `
        id,
        total,
        created_at,
        parties:party_id (
          id,
          name,
          phone
        )
      `,
      )
      .eq("user_id", currentUser.effectiveUserId)
      .in("status", ["Paid", "Pending", "Credit", "Partially Returned"])
      .order("created_at", { ascending: false })
      .limit(100)
    return data || []
  })()

  // Get customers for the dialog — scoped to current user. Without the user_id filter the
  // dropdown leaked every store's full customer list (PII).
  const customers = await (async () => {
    if (!isSupabaseReady()) return []
    const supabase = createAdminClient()
    const { data } = await supabase
      .from("parties")
      .select("id, name, phone")
      .eq("type", "Customer")
      .eq("user_id", currentUser.effectiveUserId)
    return data || []
  })()

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Sales Returns</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Manage customer return requests and process refunds.</p>
        </div>
        <SalesReturnDialog salesInvoices={salesInvoices} customers={customers} userId={currentUser.effectiveUserId} />
      </div>

      <SalesReturnsClient returns={salesReturns as any} />
    </div>
  )
}
