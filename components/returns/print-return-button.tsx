"use client"

import { useState } from "react"
import { Printer, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import type { ReturnWithDetails } from "@/lib/types/return"

interface PrintReturnButtonProps {
  returnData: ReturnWithDetails
  parentInvoiceShortId: string
  store?: { name?: string; address?: string; phone?: string }
  cashier?: string
}

/** Triggers the A4 return-receipt print template. Dynamic import keeps the popup-window
 *  code out of the initial server bundle. */
export function PrintReturnButton({ returnData, parentInvoiceShortId, store, cashier }: PrintReturnButtonProps) {
  const [pending, setPending] = useState(false)

  const handlePrint = async () => {
    setPending(true)
    try {
      const { printReturnReceipt } = await import("@/components/returns/print-return-receipt")
      await printReturnReceipt({ returnData, parentInvoiceShortId, store, cashier })
    } catch (e) {
      console.error(e)
      toast.error("Print failed")
    } finally {
      setPending(false)
    }
  }

  return (
    <Button variant="outline" onClick={handlePrint} disabled={pending}>
      {pending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />}
      Print Receipt
    </Button>
  )
}
