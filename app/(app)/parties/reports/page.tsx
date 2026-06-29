import { createAdminClient } from "@/lib/supabase/admin"
import { requirePrivilege } from "@/lib/auth/privileges"
import { getSessionOrRedirect } from "@/lib/auth"
import { isSupabaseReady } from "@/lib/supabase/config"
import { mockParties } from "@/lib/supabase/mock"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { getStoreSettings } from "@/app/(app)/pos/actions"
import { PartyReportsClient } from "./party-reports-client"
import type { PartyReportRow } from "./party-reports-client"

export default async function PartyReportsPage() {
  await requirePrivilege("parties")

  const currentUser = await getSessionOrRedirect()
  const storeSettings = await getStoreSettings()
  const storeName = storeSettings?.name || "Store"
  const userName = currentUser.name || currentUser.email || "ADMIN"

  const parties = await (async () => {
    if (!isSupabaseReady()) return mockParties
    const supabase = createAdminClient()
    const { data } = await supabase
      .from("parties")
      .select("id, name, type, created_at")
      .eq("user_id", currentUser.effectiveUserId)
      .order("name", { ascending: true })
    return data ?? []
  })()

  // Build party-level summary: total sales, total payments, balance
  const partyRows: PartyReportRow[] = await (async () => {
    if (!isSupabaseReady()) {
      return parties.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        totalSales: 0,
        totalPurchases: 0,
        totalPayments: 0,
        totalPurchasePayments: 0,
        balance: 0,
      }))
    }

    const supabase = createAdminClient()
    const uid = currentUser.effectiveUserId

    // Fetch all invoices / payments in parallel
    const [
      { data: salesInvoices },
      { data: payments },
      { data: purchaseInvoices },
      { data: purchasePayments },
      { data: saleReturns },
      { data: purchaseReturns },
      { data: refunds },
    ] = await Promise.all([
      supabase
        .from("sales_invoices")
        .select("id, party_id, total, status")
        .eq("user_id", uid),
      supabase
        .from("payments")
        .select("invoice_id, amount")
        .eq("user_id", uid),
      supabase
        .from("purchase_invoices")
        .select("id, party_id, total, status")
        .eq("user_id", uid),
      supabase
        .from("purchase_payments")
        .select("purchase_invoice_id, amount")
        .eq("user_id", uid),
      supabase
        .from("returns")
        .select("id, party_id, total, status")
        .eq("type", "sale")
        .eq("user_id", uid),
      supabase
        .from("returns")
        .select("id, party_id, total, status")
        .eq("type", "purchase")
        .eq("user_id", uid),
      supabase
        .from("refunds")
        .select("id, return_id, amount, returns!inner(type, party_id)")
        .eq("user_id", uid),
    ])

    return parties.map((party) => {
      let totalSales = 0
      let totalPayments = 0
      let totalPurchases = 0
      let totalPurchasePayments = 0
      let balance = 0

      if (party.type === "Customer" || party.type === "Both") {
        const partyInvoices =
          salesInvoices?.filter((inv) => inv.party_id === party.id && inv.status !== "Cancelled") || []
        totalSales = partyInvoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0)

        const invoiceIds = partyInvoices.map((inv) => inv.id)
        const partyPayments = payments?.filter((p) => invoiceIds.includes(p.invoice_id)) || []
        totalPayments = partyPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)

        const partySaleReturns =
          saleReturns?.filter((ret) => ret.party_id === party.id && ret.status === "Completed") || []
        const totalSaleReturns = partySaleReturns.reduce((sum, ret) => sum + Number(ret.total || 0), 0)

        const saleReturnIds = partySaleReturns.map((ret) => ret.id)
        const partyRefunds =
          refunds?.filter(
            (ref) => saleReturnIds.includes(ref.return_id) && (ref.returns as any)?.type === "sale",
          ) || []
        const totalRefunds = partyRefunds.reduce((sum, ref) => sum + Number(ref.amount || 0), 0)

        balance = totalSales - totalPayments - totalSaleReturns + totalRefunds
      }

      if (party.type === "Vendor" || party.type === "Both") {
        const partyPurchases =
          purchaseInvoices?.filter((purch) => purch.party_id === party.id && purch.status !== "Cancelled") || []
        totalPurchases = partyPurchases.reduce((sum, purch) => sum + Number(purch.total || 0), 0)

        const purchaseIds = partyPurchases.map((purch) => purch.id)
        const partyPurchPayments =
          purchasePayments?.filter((p) => purchaseIds.includes(p.purchase_invoice_id)) || []
        totalPurchasePayments = partyPurchPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)

        const partyPurchaseReturns =
          purchaseReturns?.filter((ret) => ret.party_id === party.id && ret.status === "Completed") || []
        const totalPurchaseReturns = partyPurchaseReturns.reduce(
          (sum, ret) => sum + Number(ret.total || 0),
          0,
        )

        const purchaseReturnIds = partyPurchaseReturns.map((ret) => ret.id)
        const partyRefunds =
          refunds?.filter(
            (ref) =>
              purchaseReturnIds.includes(ref.return_id) && (ref.returns as any)?.type === "purchase",
          ) || []
        const totalRefunds = partyRefunds.reduce((sum, ref) => sum + Number(ref.amount || 0), 0)

        if (party.type === "Both") {
          balance += totalPurchases - totalPurchasePayments - totalPurchaseReturns - totalRefunds
        } else {
          balance = totalPurchases - totalPurchasePayments - totalPurchaseReturns - totalRefunds
        }
      }

      return {
        id: party.id,
        name: party.name,
        type: party.type,
        totalSales,
        totalPurchases,
        totalPayments,
        totalPurchasePayments,
        balance,
      }
    })
  })()

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/parties">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Party Summary Report</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            All-party overview: total sales, payments, and current balances.
          </p>
        </div>
      </div>

      <PartyReportsClient parties={partyRows} storeName={storeName} userName={userName} />
    </div>
  )
}
