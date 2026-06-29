import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { requirePrivilege } from "@/lib/auth/privileges"
import { getStockLevels, getStockMovements, getInventoryValueAnalysis } from "./actions"
import { CurrencyDisplay } from "@/components/currency-display"
import { AlertCircle, TrendingUp, Package, ArrowUp, XCircle } from "lucide-react"
import { InventoryReportClient } from "@/components/inventory-report-client"
import { InventoryStockClient } from "./inventory-stock-client"
import { getAllSettings } from "@/app/(app)/settings/actions"

export default async function InventoryReportsPage() {
  // Check if user has inventory_report privilege
  await requirePrivilege("inventory_report")

  const [stockLevels, movements, valueAnalysis, settings] = await Promise.all([
    getStockLevels(),
    getStockMovements(),
    getInventoryValueAnalysis(),
    getAllSettings(),
  ])

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Inventory Reports</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">Comprehensive inventory analysis and stock tracking.</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Inventory Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
              <p className="text-2xl font-semibold">
                <CurrencyDisplay amount={valueAnalysis.totalValue} />
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-600" />
              <p className="text-2xl font-semibold">{valueAnalysis.totalItems}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Out of Stock</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-600" />
              <p className="text-2xl font-semibold">{valueAnalysis.outOfStockCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Low Stock Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600" />
              <p className="text-2xl font-semibold">{valueAnalysis.lowStockCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Recent Movements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <ArrowUp className="w-5 h-5 text-purple-600" />
              <p className="text-2xl font-semibold">{movements.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Stock Levels with filters — replaces old static table + Value Analysis by Category */}
      <InventoryStockClient items={stockLevels} totalValue={valueAnalysis.totalValue} />

      {/* Stock Movement History */}
      <InventoryReportClient initialMovements={movements} storeName={settings.store_name || "Store"} />
    </div>
  )
}
