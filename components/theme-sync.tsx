"use client"

import { useEffect, useRef } from "react"
import { useTheme } from "next-themes"

/**
 * Hydrates next-themes with the user's persisted preference from the server.
 *
 * Important: this only fires once per mount, and only when the incoming server theme
 * actually differs from what next-themes already has locally. Without these guards,
 * the topbar theme toggle (or anything else that calls setTheme client-side) would
 * be silently overwritten the next time the layout re-rendered with a stale prop —
 * which is exactly the bug we hit on navigation before `updateAppearance` started
 * revalidating the layout root.
 */
export function ThemeSync({ theme }: { theme: string }) {
  const { theme: currentTheme, setTheme } = useTheme()
  const synced = useRef(false)

  useEffect(() => {
    if (synced.current) return
    synced.current = true
    if (currentTheme !== theme) {
      setTheme(theme)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
