export const dynamic = "force-dynamic"

import type { ReactNode } from "react"
import { Header } from "@/components/header"
import { Sidebar } from "@/components/sidebar"
import { getSessionOrRedirect } from "@/lib/auth"
import { BarcodeScanToPOS } from "@/components/barcode-scan-to-pos"
import { Toaster } from "@/components/ui/sonner"
import { BackupReminder } from "@/components/backup-reminder"
import { getBackupStatus } from "@/app/(app)/backup/actions"
import { getAllSettings } from "@/app/(app)/settings/actions"
import { ThemeSync } from "@/components/theme-sync"
import { CurrencyProvider } from "@/contexts/currency-context"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getSessionOrRedirect("/login")

  const [{ backup_due }, settings] = await Promise.all([getBackupStatus(), getAllSettings()])

  // SET-C2: prefer the configured store name over user's personal name. The header used to
  // show `user.name || "InvoSync"`, so a store called "Al-Madina Traders" run by user
  // "Shahjahan" would display "Shahjahan" in the topbar. Now the configured store_name wins
  // and the user's name is only a fallback for accounts that haven't set it up yet.
  const businessName = settings.store_name || user.name || "InvoSync"

  return (
    // SET-H3: nested CurrencyProvider with the configured currency_symbol. The root layout's
    // outer provider stays "PKR" for pre-auth pages (login); this inner one overrides for
    // every authenticated route. React context resolves to the nearest provider.
    <CurrencyProvider
      symbol={settings.currency_symbol || "PKR"}
      decimalPlaces={Number(settings.decimal_places ?? 2)}
    >
      <div className="min-h-screen bg-gradient-to-br from-background via-muted/40 to-background">
        <ThemeSync theme={settings.theme ?? "system"} />
        <div className="print:hidden"><Sidebar user={user} /></div>
        <div className="flex flex-col min-h-screen lg:ml-72 print:ml-0">
          <div className="print:hidden"><Header businessName={businessName} userEmail={user.email} /></div>
          <div className="print:hidden"><BackupReminder show={backup_due} /></div>
          <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 lg:p-8">
            <div className="max-w-6xl mx-auto w-full space-y-4 sm:space-y-6">{children}</div>
          </main>
        </div>
        <div className="print:hidden"><BarcodeScanToPOS /></div>
        <Toaster />
      </div>
    </CurrencyProvider>
  )
}

