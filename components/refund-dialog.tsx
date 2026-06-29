"use client"

import { useState, useTransition, useEffect } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createRefund, getRefunds } from "@/app/(app)/returns/actions"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { CurrencyDisplay } from "@/components/currency-display"
import type { Return, RefundMethod } from "@/lib/types/return"

interface RefundDialogProps {
  returns: Return[]
}

export function RefundDialog({ returns }: RefundDialogProps) {
  const [open, setOpen] = useState(false)
  const [returnId, setReturnId] = useState("")
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState<RefundMethod>("Cash")
  const [reference, setReference] = useState("")
  const [pending, startTransition] = useTransition()
  const [existingRefunds, setExistingRefunds] = useState<Array<{ amount: number }>>([])
  const [loadingRefunds, setLoadingRefunds] = useState(false)
  // Sum of payments collected/sent on the parent invoice (sale invoice for sale returns,
  // purchase invoice for purchase returns). Bounds the refund cap so we can never refund
  // more cash than was ever exchanged on the original transaction. Loaded async via the
  // browser Supabase client.
  const [invoicePaid, setInvoicePaid] = useState(0)
  const router = useRouter()
  const supabase = createClient()

  const selectedReturn = returns.find((r) => r.id === returnId)

  // Fetch existing refunds when return is selected
  useEffect(() => {
    if (returnId && open) {
      setLoadingRefunds(true)
      getRefunds(returnId).then((result) => {
        if (result) {
          setExistingRefunds(result.map((r) => ({ amount: r.amount })))
        }
        setLoadingRefunds(false)
      })
    } else {
      setExistingRefunds([])
    }
  }, [returnId, open])

  // Fetch "paid so far" on the parent invoice. For a sale return this is the sum of
  // `payments` rows on `sales_invoices`. For a purchase return, the sum of `purchase_payments`
  // on `purchase_invoices`.
  useEffect(() => {
    if (!selectedReturn || !open) {
      setInvoicePaid(0)
      return
    }
    let cancelled = false
    ;(async () => {
      if (selectedReturn.type === "sale" && selectedReturn.sales_invoice_id) {
        const { data } = await supabase
          .from("payments")
          .select("amount")
          .eq("invoice_id", selectedReturn.sales_invoice_id)
        if (cancelled) return
        const total = (data ?? []).reduce((s, p: any) => s + Number(p.amount || 0), 0)
        setInvoicePaid(total)
      } else if (selectedReturn.type === "purchase" && selectedReturn.purchase_invoice_id) {
        const { data } = await supabase
          .from("purchase_payments")
          .select("amount")
          .eq("purchase_invoice_id", selectedReturn.purchase_invoice_id)
        if (cancelled) return
        const total = (data ?? []).reduce((s, p: any) => s + Number(p.amount || 0), 0)
        setInvoicePaid(total)
      } else {
        setInvoicePaid(0)
      }
    })()
    return () => { cancelled = true }
  }, [selectedReturn, open, supabase])

  // Calculate refund cap. Bounded by BOTH (a) the return total minus already-refunded AND
  // (b) the amount actually collected on the parent invoice minus already-refunded. Without
  // (b), a credit sale with 0 cash paid could be refunded in cash — the store would lose
  // money. The remaining return value (above (b)) should reduce the customer's outstanding
  // balance, not be paid out as cash.
  const returnTotal = selectedReturn ? Number(selectedReturn.total || 0) : 0
  const refundedAmount = existingRefunds.reduce((sum, r) => sum + Number(r.amount || 0), 0)
  const remainingReturn = Math.max(0, returnTotal - refundedAmount)
  const remainingPaid = Math.max(0, invoicePaid - refundedAmount)
  const maxRefundAmount = Math.min(remainingReturn, remainingPaid)
  const outstandingAmount = remainingReturn

  const handleSubmit = () => {
    if (!returnId || !amount || Number(amount) <= 0) {
      toast.error("Please select a return and enter a valid amount")
      return
    }

    const refundAmount = Number(amount)
    if (refundAmount > maxRefundAmount) {
      toast.error(`Refund amount cannot exceed outstanding amount of ${maxRefundAmount.toLocaleString()}`)
      return
    }

    if (!method) {
      toast.error("Please select a payment method")
      return
    }

    // RF-M6: Card refunds also require a reference (transaction ID from the terminal slip).
    // Card transactions always produce one — bad audit trail without it. JazzCash/EasyPaisa
    // require it as before. "Other" stays optional as a generic fallback.
    if ((method === "Card" || method === "JazzCash" || method === "EasyPaisa") && !reference.trim()) {
      toast.error(`Transaction ID is required for ${method}`)
      return
    }

    startTransition(async () => {
      const result = await createRefund({
        return_id: returnId,
        amount: refundAmount,
        method,
        reference: reference || undefined,
      })

      if (result?.error) {
        toast.error(result.error)
      } else {
        toast.success("Refund processed successfully")
        setOpen(false)
        setReturnId("")
        setAmount("")
        setMethod("Cash")
        setReference("")
        setExistingRefunds([])
        router.refresh()
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Process Refund
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Process Refund</DialogTitle>
          <DialogDescription>Record a refund payment for a return.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="return">Return</Label>
            <Select value={returnId} onValueChange={setReturnId}>
              <SelectTrigger id="return">
                <SelectValue placeholder="Select return" />
              </SelectTrigger>
              <SelectContent>
                {returns.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">No returns available</div>
                ) : (
                  returns.map((ret) => (
                    <SelectItem key={ret.id} value={ret.id}>
                      {ret.return_number} - {ret.party?.name || "Unknown"} ({ret.type === "sale" ? "Sale" : "Purchase"})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {selectedReturn && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Total: <CurrencyDisplay amount={selectedReturn.total} /> | Type: {selectedReturn.type === "sale" ? "Sale" : "Purchase"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Paid on original: <CurrencyDisplay amount={invoicePaid} /> | Refunded: <CurrencyDisplay amount={refundedAmount} /> | Refundable: <CurrencyDisplay amount={maxRefundAmount} />
                </p>
                {remainingReturn > remainingPaid && (
                  <p className="text-xs text-amber-600">
                    Note: return amount exceeds what was paid on the original invoice. The
                    difference reduces the customer's outstanding balance — only the paid
                    portion can be refunded as cash.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              type="number"
              min="0.01"
              max={maxRefundAmount > 0 ? maxRefundAmount : undefined}
              step="0.01"
              value={amount}
              onChange={(e) => {
                const value = e.target.value
                const numValue = Number(value)
                if (value === "" || (numValue > 0 && numValue <= maxRefundAmount)) {
                  setAmount(value)
                } else if (numValue > maxRefundAmount) {
                  toast.error(`Amount cannot exceed outstanding amount of ${maxRefundAmount.toLocaleString()}`)
                }
              }}
              placeholder={`Max: ${maxRefundAmount > 0 ? maxRefundAmount.toLocaleString() : "0"}`}
            />
            {selectedReturn && maxRefundAmount > 0 && (
              <p className="text-xs text-muted-foreground">
                Maximum refund amount: <CurrencyDisplay amount={maxRefundAmount} />
              </p>
            )}
            {selectedReturn && maxRefundAmount <= 0 && (
              <p className="text-xs text-amber-600">This return is already fully refunded</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="method">Payment Method</Label>
            <Select value={method} onValueChange={(v) => { setMethod(v as RefundMethod); setReference("") }}>
              <SelectTrigger id="method">
                <SelectValue placeholder="Select payment method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="Card">Card</SelectItem>
                <SelectItem value="JazzCash">JazzCash</SelectItem>
                <SelectItem value="EasyPaisa">EasyPaisa</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reference">
              {method === "Card" || method === "JazzCash" || method === "EasyPaisa" ? "Transaction ID *" : "Reference (Optional)"}
            </Label>
            <Input
              id="reference"
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={method === "Card" ? "Card Transaction ID" : method === "JazzCash" || method === "EasyPaisa" ? `${method} Transaction ID` : "Refund reference number"}
              className={method === "Card" || method === "JazzCash" || method === "EasyPaisa" ? "border-orange-300 focus:border-orange-500" : ""}
            />
            {(method === "Card" || method === "JazzCash" || method === "EasyPaisa") && (
              <p className="text-xs text-orange-600">Enter the Transaction ID from the {method} {method === "Card" ? "terminal" : "transfer"} receipt</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={pending || !returnId || !amount || !method || returns.length === 0 || ((method === "Card" || method === "JazzCash" || method === "EasyPaisa") && !reference.trim())}
          >
            {pending ? "Processing..." : "Process Refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
