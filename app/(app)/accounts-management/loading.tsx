import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

export default function AccountsManagementLoading() {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Sub-nav (Receivables / Payables / Cash Book / Ledger) */}
      <div className="flex gap-2 flex-wrap">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-28" />
        ))}
      </div>

      {/* Title */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-3">
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-7 w-36 mb-2" />
              <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Two side-by-side tables (Top receivables / Top payables) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, t) => (
          <Card key={t}>
            <CardHeader className="p-4 sm:p-6">
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="p-0 sm:p-6 pt-0">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-2 px-4 py-3 border-b last:border-b-0 items-center">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-24 ml-auto" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
