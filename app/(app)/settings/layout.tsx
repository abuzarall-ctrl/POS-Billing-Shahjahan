import { ReactNode } from "react"
import { SettingsNav } from "./settings-nav"

// SET-C4: previously this layout was an empty <div>{children}</div>, so settings pages
// rendered with no tab navigation — users had to navigate via direct URLs. The SettingsNav
// component was defined but never imported. Now it's a proper two-column layout: nav on
// the left (or top on mobile), active page content on the right.
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Configure store, invoice, POS, hardware, and account preferences.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
        <SettingsNav />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  )
}
