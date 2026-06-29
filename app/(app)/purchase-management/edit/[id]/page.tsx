import { PurchaseForm } from "@/components/purchase-form"
import { createAdminClient } from "@/lib/supabase/admin"
import { isSupabaseReady } from "@/lib/supabase/config"
import { mockInventory, mockParties } from "@/lib/supabase/mock"
import { getPurchaseForEdit } from "@/app/(app)/purchases/actions"
import { notFound } from "next/navigation"
import { requirePrivilege } from "@/lib/auth/privileges"
import { getSessionOrRedirect } from "@/lib/auth"

export default async function PurchaseEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePrivilege("purchases")
  const { id } = await params
  const purchaseId = id

  // Fetch purchase data for editing
  const purchaseData = await (async () => {
    if (!isSupabaseReady()) {
      return {
        id: purchaseId,
        partyId: mockParties.filter((p) => p.type === "Vendor")[0]?.id || "",
        status: "Draft",
        taxRate: 18,
        items: [
          {
            itemId: mockInventory[0]?.id || "",
            quantity: 1,
            unitPrice: (mockInventory[0] as { cost_price?: number })?.cost_price ?? mockInventory[0]?.unit_price ?? 0,
          },
        ],
      }
    }
    const result = await getPurchaseForEdit(purchaseId)
    if (result.error || !result.data) return null
    return result.data
  })()

  if (!purchaseData) {
    notFound()
  }

  // Fetch vendors and inventory
  const parties = await (async () => {
    if (!isSupabaseReady())
      return mockParties.filter((p) => p.type === "Vendor").map((p) => ({ id: p.id, name: p.name }))
    const currentUser = await getSessionOrRedirect()
    const supabase = createAdminClient()
    const { data = [] } = await supabase
      .from("parties")
      .select("id, name, type")
      .eq("type", "Vendor")
      .eq("user_id", currentUser.effectiveUserId)
    return (data || []).map((p) => ({ id: p.id, name: p.name || "" }))
  })()

  const inventory = await (async () => {
    if (!isSupabaseReady())
      return mockInventory.map((i) => ({ id: i.id, name: i.name, stock: i.stock, unitPrice: (i as { cost_price?: number }).cost_price ?? i.unit_price }))
    const currentUser = await getSessionOrRedirect()
    const supabase = createAdminClient()
    // IV-L4: archived items shouldn't appear in the edit dropdown — but if the existing
    // purchase line references an archived item, the form pre-fills will still show the
    // name (the line item's snapshot has it). New rows can't pick an archived item.
    const { data = [] } = await supabase
      .from("inventory_items")
      .select("id, name, stock, cost_price, cash_price, credit_price, supplier_price")
      .eq("user_id", currentUser.effectiveUserId)
      .eq("is_archived", false)
    return (data || []).map((item) => ({
      id: item.id,
      name: item.name || "",
      stock: item.stock || 0,
      unitPrice: (item as { cost_price?: number }).cost_price ?? (item as { unit_price?: number }).unit_price ?? 0,
      cashPrice: Number((item as { cash_price?: number }).cash_price ?? 0) || undefined,
      creditPrice: Number((item as { credit_price?: number }).credit_price ?? 0) || undefined,
      supplierPrice: Number((item as { supplier_price?: number }).supplier_price ?? 0) || undefined,
    }))
  })()

  return (
    <PurchaseForm
      parties={parties}
      inventory={inventory}
      purchaseId={purchaseId}
      initialPartyId={purchaseData.partyId}
      initialItems={purchaseData.items}
      initialStatus={purchaseData.status}
      initialTaxRate={purchaseData.taxRate}
    />
  )
}
