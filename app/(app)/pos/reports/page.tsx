import { requirePrivilege } from "@/lib/auth/privileges"
import Link from "next/link"
import { BarChart2, ArrowRight } from "lucide-react"

export default async function GrossProfitReportPage() {
  await requirePrivilege("pos")

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Gross Profit Report</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">Item-wise profitability analysis</p>
      </div>

      <div className="flex flex-col items-center justify-center gap-6 py-16 text-center">
        <div className="p-4 rounded-full bg-blue-50 dark:bg-blue-950/40">
          <BarChart2 className="w-10 h-10 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">
            Gross Profit has moved to BI Report
          </h2>
          <p className="text-sm text-muted-foreground max-w-md">
            The Gross Profit report — including item-wise breakdown, expense deductions, and Net
            Profit calculation — is now available in the BI Report module.
          </p>
        </div>
        <Link
          href="/bi-report/gross-profit"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Go to Gross Profit (BI Report)
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  )
}
