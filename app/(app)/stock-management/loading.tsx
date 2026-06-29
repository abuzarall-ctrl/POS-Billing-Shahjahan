import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

export default function StockManagementLoading() {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Sub-nav (Inventory / Categories / Units / Barcode / Reports) */}
      <div className="flex gap-2 flex-wrap">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>

      {/* Title + add button */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      {/* Filters row */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
        </CardContent>
      </Card>

      {/* Table card */}
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="p-0 sm:p-6 pt-0">
          {/* Header row */}
          <div className="flex gap-2 px-4 py-2 border-b">
            {[40, 180, 90, 80, 80, 90, 100, 80].map((w, i) => (
              <Skeleton key={i} className="h-4" style={{ width: w }} />
            ))}
          </div>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex gap-2 px-4 py-3 border-b last:border-b-0">
              {[40, 180, 90, 80, 80, 90, 100, 80].map((w, j) => (
                <Skeleton key={j} className="h-4" style={{ width: w }} />
              ))}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
