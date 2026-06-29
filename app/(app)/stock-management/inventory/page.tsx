import { createAdminClient } from "@/lib/supabase/admin"
import { isSupabaseReady } from "@/lib/supabase/config"
import { mockInventory } from "@/lib/supabase/mock"
import InventoryDialog from "./inventory-dialog"
import { requirePrivilege } from "@/lib/auth/privileges"
import { getSessionOrRedirect } from "@/lib/auth"
import { InventoryPageClient } from "./inventory-page-client"
import { getAllSettings } from "@/app/(app)/settings/actions"
import Link from "next/link"
import { cn } from "@/lib/utils"

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  // Check if user has inventory privilege
  await requirePrivilege("inventory")

  const { tab: tabParam } = await searchParams
  const tab = tabParam === "archived" ? "archived" : "active"

  const items = await (async () => {
    if (!isSupabaseReady()) return mockInventory
    const currentUser = await getSessionOrRedirect()
    const supabase = createAdminClient()
    const { data = [] } = await supabase
      .from("inventory_items")
      .select("id, name, stock, cost_price, selling_price, cash_price, credit_price, supplier_price, profit_percentage, profit_value, category_id, unit_id, barcode, minimum_stock, maximum_stock, pack_unit_id, pack_size, created_at, categories:category_id(name), units:unit_id(name, symbol), pack_unit:pack_unit_id(name, symbol)")
      .eq("user_id", currentUser.effectiveUserId)
      .eq("is_archived", tab === "archived")
      .order("created_at", { ascending: false })
    return data
  })()

  // SET-M3: read default_category_id / default_unit_id once on the server so the dialog can
  // apply them synchronously in its reset effect. Previously the dialog fetched settings via
  // a client-side useEffect, which raced with the reset-to-"__none__" effect — the reset
  // sometimes won, leaving the new-item form blank even when defaults were configured.
  const settings = isSupabaseReady() ? await getAllSettings() : {}
  const defaultCategoryId = settings.default_category_id || undefined
  const defaultUnitId = settings.default_unit_id || undefined

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Inventory</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Track stock and pricing for every SKU/service.</p>
        </div>
        {tab === "active" && (
          <InventoryDialog
            defaultCategoryId={defaultCategoryId}
            defaultUnitId={defaultUnitId}
          />
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <Link
          href="/stock-management/inventory"
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "active"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Active
        </Link>
        <Link
          href="/stock-management/inventory?tab=archived"
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "archived"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Archived
        </Link>
      </div>

      <InventoryPageClient items={items as any} tab={tab} />
    </div>
  )
}
