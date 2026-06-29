import type React from "react"
import type { Metadata } from "next"
import { Analytics } from "@vercel/analytics/next"
import NextTopLoader from "nextjs-toploader"

const isVercel = process.env.VERCEL === "1"
import { Plus_Jakarta_Sans, IBM_Plex_Mono, Lora } from "next/font/google"
import { ThemeProvider } from "@/components/theme-provider"
import { CurrencyProvider } from "@/contexts/currency-context"
import { CookieConsent } from "@/components/cookie-consent"
import "./globals.css"

const plusJakartaSans = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"] })
const ibmPlexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"] })
const lora = Lora({ subsets: ["latin"], weight: ["400", "500", "600", "700"] })

export const metadata: Metadata = {
  title: "Invoice & Billing SaaS",
  description: "Professional invoice and billing management system for SMEs",
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/favicon.png",
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${plusJakartaSans.className} antialiased`}
        style={{
          ["--font-sans" as string]: plusJakartaSans.style.fontFamily,
          ["--font-mono" as string]: ibmPlexMono.style.fontFamily,
          ["--font-serif" as string]: lora.style.fontFamily,
        }}
        suppressHydrationWarning
      >
        {/* Top-of-page progress bar during route transitions. Gives a continuous activity
            signal between the click and when the next route's loading.tsx skeleton paints,
            so cold navigations don't feel stuck. The skeleton then takes over once the new
            route mounts. Uses brand orange via the primary CSS variable. */}
        <NextTopLoader
          color="hsl(var(--primary))"
          height={2.5}
          showSpinner={false}
          shadow="0 0 10px hsl(var(--primary)),0 0 5px hsl(var(--primary))"
          easing="ease"
          speed={300}
        />
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <CurrencyProvider>
            {children}
            <CookieConsent />
            {isVercel && <Analytics />}
          </CurrencyProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
