"use client"

import { useActionState, useEffect, useState } from "react"
import { Plus, Pencil } from "lucide-react"
import { createParty, updateParty } from "./actions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"

const initialState = { error: "" }

interface Party {
  id: string
  name: string
  phone: string
  type: string
  address?: string | null
  advance_payment?: number | null
  advance_payment_ref?: string | null
  pre_balance?: number | null
  pre_balance_ref?: string | null
}

interface PartyDialogProps {
  party?: Party | null
  trigger?: React.ReactNode
}

export default function PartyDialog({ party, trigger }: PartyDialogProps) {
  const [open, setOpen] = useState(false)
  const isEdit = !!party

  const [state, formAction, pending] = useActionState(
    async (_prev: typeof initialState, formData: FormData) => {
      const result = isEdit ? await updateParty(formData) : await createParty(formData)
      return { error: result?.error || "" }
    },
    initialState,
  )

  useEffect(() => {
    if (!state.error && !pending) {
      if (open) {
        toast.success(isEdit ? "Party updated successfully!" : "Party created successfully!")
        setOpen(false)
      }
    }
  }, [pending, state.error])

  const defaultTrigger = (
    <Button>
      <Plus className="w-4 h-4 mr-2" />
      New Party
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger || defaultTrigger}</DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit party" : "Add new party"}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          {isEdit && <input type="hidden" name="id" value={party.id} />}
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" placeholder="Acme Corp" defaultValue={party?.name || ""} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" placeholder="9876543210" defaultValue={party?.phone || ""} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input id="address" name="address" placeholder="123 Main Street, City" defaultValue={party?.address || ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="type">Type</Label>
            <Select name="type" defaultValue={party?.type || "Customer"}>
              <SelectTrigger id="type">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Customer">Customer</SelectItem>
                <SelectItem value="Vendor">Vendor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Opening Balance <span className="font-normal">(Optional)</span></p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="advance_payment">Advance Payment</Label>
                <Input id="advance_payment" name="advance_payment" type="number" min="0" step="0.01" placeholder="0.00" defaultValue={party?.advance_payment || ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="advance_payment_ref">Reference</Label>
                <Input id="advance_payment_ref" name="advance_payment_ref" placeholder="e.g. Opening Deposit" defaultValue={party?.advance_payment_ref || ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pre_balance">Opening Pre-Balance</Label>
                <Input id="pre_balance" name="pre_balance" type="number" min="0" step="0.01" placeholder="0.00" defaultValue={party?.pre_balance || ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pre_balance_ref">Reference</Label>
                <Input id="pre_balance_ref" name="pre_balance_ref" placeholder="e.g. Old Debt" defaultValue={party?.pre_balance_ref || ""} />
              </div>
            </div>
          </div>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Saving..." : isEdit ? "Update party" : "Save party"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

