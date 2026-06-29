import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

/**
 * Generic fallback loading skeleton for any (app) route that doesn't define its own.
 * Renders a neutral page-shaped layout: title block, four KPI-card stubs, and a table-ish
 * card. Most app pages match one of these shapes; modules with richer layouts override
 * with their own loading.tsx.
 */
export default function Loading() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-3">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-7 w-36" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="p-4 sm:p-6">
          <Skeleton className="h-5 w-44" />
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3 py-2 border-b last:border-b-0">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20 ml-auto" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
