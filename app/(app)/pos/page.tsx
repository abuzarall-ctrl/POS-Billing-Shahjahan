import { createAdminClient } from "@/lib/supabase/admin"
import { isSupabaseReady } from "@/lib/supabase/config"
import { mockInventory, mockParties } from "@/lib/supabase/mock"
import { POSNewSaleForm } from "@/components/pos-new-sale-form"
import { requirePrivilege } from "@/lib/auth/privileges"
import { getSessionOrRedirect } from "@/lib/auth"
import { getPOSSaleForEdit, getOrCreateWalkInParty } from "@/app/(app)/pos/actions"
import { getAllSettings } from "@/app/(app)/settings/actions"

export default async function POSNewSalePage({
  searchParams,
}: {
  searchParams: Promise<{ itemId?: string; autoAdd?: string; editDraft?: string }>
}) {
  await requirePrivilege("pos")
  const params = await searchParams
  const initialItemId = params?.itemId ?? null
  const autoAdd = params?.autoAdd === "true"
  const editDraftId = params?.editDraft ?? null

  if (!isSupabaseReady()) {
    return (
      <POSNewSaleForm
        parties={mockParties.map((p) => ({ id: p.id, name: p.name }))}
        inventory={mockInventory.map((i) => ({
          id: i.id,
          name: i.name || "",
          stock: i.stock ?? 0,
          unitPrice: (i as { selling_price?: number }).selling_price ?? i.unit_price ?? 0,
        }))}
        initialItemId={initialItemId}
        autoAdd={autoAdd}
      />
    )
  }

  const currentUser = await getSessionOrRedirect()
  const supabase = createAdminClient()
  // SET-H1 / SET-H4: load behavior + tax settings so the POS form respects what the user
  // configured in /settings/{pos,tax}. Previously the form hardcoded "Cash" as default
  // payment, always allowed walk-in (ignoring `require_customer`), and always warned on
  // below-cost (ignoring `allow_below_cost`). Tax rate was hardcoded to 0 ignoring `gst_rate`.
  const [{ data: parties = [] }, { data: inventory = [] }, walkIn, settings] = await Promise.all([
    supabase.from("parties").select("id, name, address").eq("type", "Customer").eq("user_id", currentUser.effectiveUserId).order("name"),
    // IV-L4: filter archived items out of the POS dropdown — they shouldn't be sellable.
    supabase.from("inventory_items").select("id, name, stock, selling_price, cash_price, credit_price, supplier_price, cost_price, pack_unit_id, pack_size, pack_unit:pack_unit_id(name, symbol)").eq("user_id", currentUser.effectiveUserId).eq("is_archived", false).order("name"),
    getOrCreateWalkInParty(),
    getAllSettings(),
  ])

  const normalizedInventory = (inventory || []).map((item) => {
    const packUnitRaw = (item as { pack_unit?: { name?: string; symbol?: string | null } | { name?: string; symbol?: string | null }[] | null }).pack_unit
    const packUnit = Array.isArray(packUnitRaw) ? packUnitRaw[0] : packUnitRaw
    const packSizeNum = Number((item as { pack_size?: number | string | null }).pack_size ?? 0)
    return {
      id: item.id,
      name: (item as { name?: string }).name || "",
      stock: Number((item as { stock?: number }).stock ?? 0),
      unitPrice: Number((item as { cash_price?: number }).cash_price ?? (item as { selling_price?: number }).selling_price ?? 0),
      cashPrice: Number((item as { cash_price?: number }).cash_price ?? (item as { selling_price?: number }).selling_price ?? 0),
      creditPrice: Number((item as { credit_price?: number }).credit_price ?? (item as { selling_price?: number }).selling_price ?? 0),
      supplierPrice: Number((item as { supplier_price?: number }).supplier_price ?? (item as { selling_price?: number }).selling_price ?? 0),
      costPrice: Number((item as { cost_price?: number }).cost_price ?? 0),
      packSize: packSizeNum > 0 ? packSizeNum : null,
      packLabel: packUnit ? (packUnit.symbol || packUnit.name || null) : null,
    }
  })

  // Load draft for editing if editDraft param is set. The shape now carries the bill-level
  // discount and per-line discount info so the form can re-render the cart exactly as it
  // was saved — instead of silently zeroing every discount on every edit.
  let initialSale:
    | {
        invoiceId: string
        partyId: string
        taxRate: number
        discount: number
        items: Array<{
          itemId: string
          quantity: number
          unitPrice: number
          originalUnitPrice?: number | null
          discountAmount?: number
        }>
      }
    | undefined
  if (editDraftId) {
    const editResult = await getPOSSaleForEdit(editDraftId)
    if (editResult.data) initialSale = editResult.data
  }

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-semibold text-foreground">{initialSale ? "Edit Draft" : "New Sale"}</h1>
      <p className="text-xs sm:text-sm text-muted-foreground">{initialSale ? "Modify the draft sale and save." : "Add items, select customer, and complete payment."}</p>
      <POSNewSaleForm
        parties={(parties || []).map((p) => ({ id: (p as { id: string }).id, name: (p as { name?: string }).name || "", address: (p as { address?: string | null }).address ?? null }))}
        inventory={normalizedInventory}
        initialItemId={initialItemId}
        autoAdd={autoAdd}
        initialSale={initialSale}
        walkInPartyId={walkIn.id}
        isOwner={currentUser.role === "pos_user"}
        defaultTaxRate={Number(settings.gst_rate || 0)}
        defaultPaymentMethod={settings.default_payment_method || "Cash"}
        requireCustomer={settings.require_customer === "true"}
        allowBelowCost={settings.allow_below_cost === "true"}
      />
    </div>
  )
}
