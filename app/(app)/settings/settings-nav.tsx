"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const NAV_ITEMS = [
  { href: "/settings/store", label: "Store Profile" },
  { href: "/settings/invoice", label: "Invoice & Receipt" },
  { href: "/settings/tax", label: "Tax & Finance" },
  { href: "/settings/pos", label: "POS Preferences" },
  { href: "/settings/hardware", label: "Hardware" },
  { href: "/settings/appearance", label: "Appearance" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/security", label: "Security" },
  { href: "/backup", label: "Backup" },
]

export function SettingsNav() {
  const pathname = usePathname()
  return (
    <aside className="w-full sm:w-52 sm:flex-shrink-0">
      <nav className="flex sm:flex-col gap-0.5 overflow-x-auto sm:overflow-visible pb-2 sm:pb-0">
        {NAV_ITEMS.map((item) => {
          // SET-L7: startsWith for sub-route + trailing-slash safety.
          const isActive = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
