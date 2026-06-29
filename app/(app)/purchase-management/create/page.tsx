import { PurchaseForm } from "@/components/purchase-form"
import { createAdminClient } from "@/lib/supabase/admin"
import { isSupabaseReady } from "@/lib/supabase/config"
import { mockInventory, mockParties } from "@/lib/supabase/mock"
import { requirePrivilege } from "@/lib/auth/privileges"
import { getSessionOrRedirect } from "@/lib/auth"

export default async function PurchaseCreatePage() {
  await requirePrivilege("purchases")

  if (!isSupabaseReady()) {
    return (
      <PurchaseForm
        parties={mockParties.filter((p) => p.type === "Vendor").map((p) => ({ id: p.id, name: p.name }))}
        inventory={mockInventory.map((i) => ({ id: i.id, name: i.name, stock: i.stock, unitPrice: (i as { cost_price?: number }).cost_price ?? i.unit_price }))}
      />
    )
  }

  const currentUser = await getSessionOrRedirect()
  const supabase = createAdminClient()
  const [{ data: parties = [] }, { data: inventory = [] }] = await Promise.all([
    supabase.from("parties").select("id, name, type").eq("type", "Vendor").eq("user_id", currentUser.effectiveUserId),
    // IV-L4: only active items — archived items shouldn't appear in the purchase dropdown.
    supabase.from("inventory_items").select("id, name, stock, cost_price, cash_price, credit_price, supplier_price").eq("user_id", currentUser.effectiveUserId).eq("is_archived", false),
  ])

  const normalizedInventory = (inventory || []).map((item) => ({
    id: item.id,
    name: item.name || "",
    stock: item.stock || 0,
    unitPrice: (item as { cost_price?: number }).cost_price ?? (item as { unit_price?: number }).unit_price ?? 0,
    cashPrice: Number((item as { cash_price?: number }).cash_price ?? 0) || undefined,
    creditPrice: Number((item as { credit_price?: number }).credit_price ?? 0) || undefined,
    supplierPrice: Number((item as { supplier_price?: number }).supplier_price ?? 0) || undefined,
  }))

  return (
    <PurchaseForm
      parties={(parties || []).map((p) => ({ id: p.id, name: p.name || "" }))}
      inventory={normalizedInventory}
    />
  )
}
