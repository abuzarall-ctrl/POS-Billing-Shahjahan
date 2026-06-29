"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { updatePOSPreferences } from "@/app/(app)/settings/actions"
import type { AppSettings } from "@/app/(app)/settings/actions"
import { toast } from "sonner"

interface Category { id: string; name: string }
interface Unit { id: string; name: string; symbol?: string | null }

export function POSPreferencesForm({
  settings,
  categories = [],
  units = [],
}: {
  settings: AppSettings
  categories?: Category[]
  units?: Unit[]
}) {
  const [defaultPayment, setDefaultPayment] = useState(
    settings.default_payment_method ?? "Cash"
  )
  const [requireCustomer, setRequireCustomer] = useState(
    settings.require_customer === "true"
  )
  const [allowBelowCost, setAllowBelowCost] = useState(
    settings.allow_below_cost === "true"
  )
  const [autoPrint, setAutoPrint] = useState(settings.pos_auto_print === "true")
  const [showSummary, setShowSummary] = useState(settings.pos_show_summary !== "false")
  // SET-M4: how many copies the NCR thermal template prints per receipt. A4 ignores this
  // (each tab open = one document). Clamped 1-3 on save.
  const [copyCount, setCopyCount] = useState(settings.receipt_copy_count ?? "1")
  // SET-M3: defaults for new inventory items. "__none__" means "no default — user picks
  // each time", matching the same sentinel used in the inventory dialog itself.
  const [defaultCategory, setDefaultCategory] = useState(
    settings.default_category_id ?? "__none__"
  )
  const [defaultUnit, setDefaultUnit] = useState(
    settings.default_unit_id ?? "__none__"
  )
  const [pending, startTransition] = useTransition()

  const handleSave = () => {
    startTransition(async () => {
      const result = await updatePOSPreferences({
        default_payment_method: defaultPayment,
        require_customer: requireCustomer,
        allow_below_cost: allowBelowCost,
        pos_auto_print: autoPrint,
        pos_show_summary: showSummary,
        receipt_copy_count: copyCount,
        // "__none__" sentinel collapses to empty so the server-side upsert clears the row.
        default_category_id: defaultCategory === "__none__" ? "" : defaultCategory,
        default_unit_id: defaultUnit === "__none__" ? "" : defaultUnit,
      })
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success("POS preferences saved")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>POS Preferences</CardTitle>
        <CardDescription>Control POS sale behavior.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Default Payment Method</Label>
          <Select value={defaultPayment} onValueChange={setDefaultPayment}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Cash">Cash</SelectItem>
              <SelectItem value="JazzCash">JazzCash</SelectItem>
              <SelectItem value="EasyPaisa">EasyPaisa</SelectItem>
              <SelectItem value="Card">Card</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-medium">Require Customer Selection</Label>
              <p className="text-xs text-muted-foreground">
                If off, walk-in customer is allowed without selecting a party
              </p>
            </div>
            <Switch checked={requireCustomer} onCheckedChange={setRequireCustomer} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-medium">Allow Selling Below Cost Price</Label>
              <p className="text-xs text-muted-foreground">
                If off, a warning toast is shown when item is sold at a loss
              </p>
            </div>
            <Switch checked={allowBelowCost} onCheckedChange={setAllowBelowCost} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-medium">Auto-Print Receipt After Sale</Label>
              <p className="text-xs text-muted-foreground">
                Automatically trigger print dialog after each completed sale
              </p>
            </div>
            <Switch checked={autoPrint} onCheckedChange={setAutoPrint} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-medium">Show Order Summary Before Confirm</Label>
              <p className="text-xs text-muted-foreground">
                Show a summary screen before finalizing each sale
              </p>
            </div>
            <Switch checked={showSummary} onCheckedChange={setShowSummary} />
          </div>
        </div>

        {/* SET-M3: default category + default unit for new inventory items. "No default"
            keeps the form's "Select category…" / "Select unit…" placeholder behaviour. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t pt-4">
          <div className="space-y-2">
            <Label>Default Category for New Items</Label>
            <Select value={defaultCategory} onValueChange={setDefaultCategory}>
              <SelectTrigger>
                <SelectValue placeholder="No default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No default</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Pre-selected when creating a new inventory item
            </p>
          </div>
          <div className="space-y-2">
            <Label>Default Unit for New Items</Label>
            <Select value={defaultUnit} onValueChange={setDefaultUnit}>
              <SelectTrigger>
                <SelectValue placeholder="No default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No default</SelectItem>
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}{u.symbol ? ` (${u.symbol})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Pre-selected when creating a new inventory item
            </p>
          </div>
        </div>

        <div className="space-y-2 border-t pt-4">
          <Label>Receipt Copies (Thermal Printer)</Label>
          <Select value={copyCount} onValueChange={setCopyCount}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 copy (Customer only)</SelectItem>
              <SelectItem value="2">2 copies (Customer + Merchant)</SelectItem>
              <SelectItem value="3">3 copies (Customer + Merchant + File)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Number of receipt copies printed per sale on NCR/thermal printer. A4 print ignores this.
          </p>
        </div>

        <Button onClick={handleSave} disabled={pending}>
          {pending ? "Saving..." : "Save Changes"}
        </Button>
      </CardContent>
    </Card>
  )
}
