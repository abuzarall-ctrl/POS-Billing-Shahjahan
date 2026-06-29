"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { updateTaxSettings } from "@/app/(app)/settings/actions"
import type { AppSettings } from "@/app/(app)/settings/actions"
import { toast } from "sonner"

export function TaxSettingsForm({ settings }: { settings: AppSettings }) {
  const [gstRate, setGstRate] = useState(settings.gst_rate ?? "17")
  const [taxMode, setTaxMode] = useState(settings.tax_mode ?? "Exclusive")
  const [currency, setCurrency] = useState(settings.currency_symbol ?? "PKR")
  // SET-M6 + M7: presentation defaults. Date format affects every fmtDate in the print
  // templates; decimal_places affects every formatCurrency call across the app.
  const [dateFormat, setDateFormat] = useState(settings.date_format ?? "DD/MM/YYYY")
  const [decimalPlaces, setDecimalPlaces] = useState(settings.decimal_places ?? "2")
  const [pending, startTransition] = useTransition()

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateTaxSettings({
        gst_rate: gstRate,
        tax_mode: taxMode,
        currency_symbol: currency,
        date_format: dateFormat,
        decimal_places: decimalPlaces,
      })
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success("Tax settings saved")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax & Finance</CardTitle>
        <CardDescription>Configure GST and currency settings.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="gstRate">GST Rate (%)</Label>
            <Input
              id="gstRate"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={gstRate}
              onChange={(e) => setGstRate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Pakistan standard GST is 17%</p>
          </div>
          <div className="space-y-2">
            <Label>Tax Mode</Label>
            <Select value={taxMode} onValueChange={setTaxMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Exclusive">Exclusive (tax added on top)</SelectItem>
                <SelectItem value="Inclusive">Inclusive (tax included in price)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Currency Symbol</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PKR">PKR</SelectItem>
                <SelectItem value="Rs.">Rs.</SelectItem>
                <SelectItem value="₨">₨</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Date Format</Label>
            <Select value={dateFormat} onValueChange={setDateFormat}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DD/MM/YYYY">DD/MM/YYYY (Pakistani standard)</SelectItem>
                <SelectItem value="MM/DD/YYYY">MM/DD/YYYY (US)</SelectItem>
                <SelectItem value="YYYY-MM-DD">YYYY-MM-DD (ISO)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Used on invoices, receipts, and reports</p>
          </div>
          <div className="space-y-2">
            <Label>Decimal Places</Label>
            <Select value={decimalPlaces} onValueChange={setDecimalPlaces}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0 (integer rupees only)</SelectItem>
                <SelectItem value="1">1 (e.g. 1,234.5)</SelectItem>
                <SelectItem value="2">2 (e.g. 1,234.50)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Controls how all monetary amounts are displayed app-wide</p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={pending}>
          {pending ? "Saving..." : "Save Changes"}
        </Button>
      </CardContent>
    </Card>
  )
}
