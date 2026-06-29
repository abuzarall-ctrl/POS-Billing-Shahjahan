import { requirePrivilege } from "@/lib/auth/privileges"
import { getAllSettings } from "@/app/(app)/settings/actions"
import { POSPreferencesForm } from "@/components/settings/pos-preferences-form"
import { getCategoriesForSelect } from "@/app/(app)/stock-management/inventory/fetch-categories"
import { getUnitsForSelect } from "@/app/(app)/stock-management/inventory/fetch-units"

export default async function POSPreferencesPage() {
  await requirePrivilege("pos")
  // SET-M3: load categories + units alongside settings so the form can present the default-
  // category / default-unit pickers without an extra client-side round-trip on first render.
  const [settings, categories, units] = await Promise.all([
    getAllSettings(),
    getCategoriesForSelect(),
    getUnitsForSelect(),
  ])
  return <POSPreferencesForm settings={settings} categories={categories} units={units} />
}
