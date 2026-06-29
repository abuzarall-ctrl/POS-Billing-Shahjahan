"use client"

import { useActionState, useEffect, useRef } from "react"
import { createParty } from "./actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

const initialState = { error: "" }

export default function AddPartyForm() {
  const router = useRouter()
  const prevPendingRef = useRef(false)

  const [state, formAction, pending] = useActionState(
    async (_prev: typeof initialState, formData: FormData) => {
      const result = await createParty(formData)
      return { error: result?.error || "" }
    },
    initialState,
  )

  useEffect(() => {
    if (prevPendingRef.current && !pending && !state.error) {
      toast.success("Party created successfully!")
      router.push("/parties")
    }
    prevPendingRef.current = pending
  }, [pending, state.error, router])

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" placeholder="Acme Corp" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" name="phone" placeholder="9876543210" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="address">Address</Label>
        <Input id="address" name="address" placeholder="123 Main Street, City" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="type">Type</Label>
        <Select name="type" defaultValue="Customer">
          <SelectTrigger id="type">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Customer">Customer</SelectItem>
            <SelectItem value="Vendor">Vendor</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="advance_payment">Advance Payment</Label>
          <Input id="advance_payment" name="advance_payment" type="number" min="0" step="0.01" placeholder="0.00" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="advance_payment_ref">Reference</Label>
          <Input id="advance_payment_ref" name="advance_payment_ref" placeholder="e.g. Opening Deposit" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pre_balance">Opening Pre-Balance</Label>
          <Input id="pre_balance" name="pre_balance" type="number" min="0" step="0.01" placeholder="0.00" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pre_balance_ref">Reference</Label>
          <Input id="pre_balance_ref" name="pre_balance_ref" placeholder="e.g. Old Debt" />
        </div>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving..." : "Save party"}
      </Button>
    </form>
  )
}
