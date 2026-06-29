"use client"

import { LogOut, Moon, Sun, Settings } from "lucide-react"
import { signOut } from "@/app/(auth)/actions"
import { updateAppearance } from "@/app/(app)/settings/actions"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Image from "next/image"
import Link from "next/link"
import { useTheme } from "next-themes"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

interface HeaderProps {
  businessName: string
  userEmail?: string
}

export function Header({ businessName, userEmail }: HeaderProps) {
  // resolvedTheme reflects what's actually rendered (handles "system" → light/dark resolution)
  // theme is the user's preference (might be "system"); we toggle off resolvedTheme so the
  // sun/moon icon always swaps to the OPPOSITE of what's currently visible.
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [, startTransition] = useTransition()

  // Avoid hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  const toggleTheme = () => {
    const current = resolvedTheme ?? theme ?? "light"
    const next = current === "dark" ? "light" : "dark"
    const previous = (theme ?? "light") as string
    // 1) Update next-themes immediately so the UI flips without waiting on the server.
    setTheme(next)
    // 2) Persist to the user's settings. updateAppearance revalidates the layout root, so
    //    subsequent navigations re-fetch with the new theme — which combined with ThemeSync's
    //    once-per-mount behaviour means the toggle no longer reverts on navigation.
    startTransition(async () => {
      try {
        const res = await updateAppearance(next)
        if (res?.error) {
          toast.error("Couldn't save theme preference")
          setTheme(previous)
        }
      } catch {
        toast.error("Couldn't save theme preference")
        setTheme(previous)
      }
    })
  }
  return (
    <header className="bg-card/80 backdrop-blur border-b border-border h-16 flex items-center justify-between px-4 sm:px-6 lg:px-8 shadow-sm">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center overflow-hidden shadow-sm bg-white flex-shrink-0">
          <Image src="/placeholder-logo.png" alt="Logo" width={44} height={44} className="object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm sm:text-lg font-semibold text-foreground leading-snug truncate">{businessName}</h1>
          <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">Invoice & Billing System</p>
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 lg:gap-3 flex-shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="hidden sm:flex h-9 w-9"
        >
          {mounted ? (
            (resolvedTheme ?? theme) === "dark" ? (
              <Sun className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
            ) : (
              <Moon className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
            )
          ) : (
            <Sun className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
          )}
        </Button>
        <Badge variant="secondary" className="hidden lg:inline-flex text-xs">
          {userEmail || "Secure session"}
        </Badge>
        <Link href="/settings/store">
          <Button variant="ghost" size="icon" aria-label="Settings" className="h-9 w-9 sm:h-10 sm:w-10">
            <Settings className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
          </Button>
        </Link>
        <form action={signOut}>
          <Button variant="ghost" size="icon" type="submit" aria-label="Sign out" className="h-9 w-9 sm:h-10 sm:w-10">
            <LogOut className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
          </Button>
        </form>
      </div>
    </header>
  )
}
