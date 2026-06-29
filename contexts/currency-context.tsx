"use client"

import { createContext, useContext, ReactNode } from "react"

interface CurrencyContextType {
  formatCurrency: (amount: number) => string
  symbol: string
  /** Alias for `symbol` — exists for backward compat with components that destructured
   *  `{ currency }` from useCurrency() before this provider had any prop. New code should
   *  prefer `symbol`. */
  currency: string
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined)

// SET-H3 + SET-M7: provider now accepts `symbol` (currency_symbol setting) and `decimalPlaces`
// (decimal_places setting). The (app) layout passes both; the root layout's outer provider
// stays at PKR + 2 decimals for pre-auth pages (login). Nested providers override outer ones.
export function CurrencyProvider({
  children,
  symbol = "PKR",
  decimalPlaces = 2,
}: {
  children: ReactNode
  symbol?: string
  decimalPlaces?: number
}) {
  // Clamp to a sensible range — 0 (integer rupees) to 4 (fine-grained inventory cost basis).
  const dp = Math.max(0, Math.min(4, Math.floor(decimalPlaces)))

  const formatCurrency = (amount: number): string => {
    const formatted = amount.toLocaleString("en-US", {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    })
    return `${symbol} ${formatted}`
  }

  return (
    <CurrencyContext.Provider value={{ formatCurrency, symbol, currency: symbol }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  const context = useContext(CurrencyContext)
  if (context === undefined) {
    throw new Error("useCurrency must be used within a CurrencyProvider")
  }
  return context
}

