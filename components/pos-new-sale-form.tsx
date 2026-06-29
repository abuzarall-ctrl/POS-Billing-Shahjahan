"use client"

import { useMemo, useState, useTransition, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Plus,
  Trash2,
  Loader2,
  Printer,
  X,
  FileText,
  CheckCircle2,
  UserPlus,
  Search,
  Banknote,
  CreditCard,
  Smartphone,
  Building2,
  Wallet,
  Percent,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { createPOSSale, updatePOSSale, getUserPrintFormat, getInvoiceForPrint, quickCreateCustomer, getPartyOutstandingBalance } from "@/app/(app)/pos/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { toast } from "sonner"
import { useCurrency } from "@/contexts/currency-context"
import type { PaymentMethod } from "@/lib/types/pos"
type PartyOption = { id: string; name: string; address?: string | null }
type InventoryOption = {
  id: string
  name: string
  stock: number
  unitPrice: number
  cashPrice?: number
  creditPrice?: number
  supplierPrice?: number
  costPrice?: number
  // Pack support — when both fields are present the item can be entered/sold by carton (CTN)
  // alongside the base unit. pack_size is how many base units make one pack (e.g. 100).
  packSize?: number | null
  packLabel?: string | null
}
type CartItem = { itemId: string; quantity: number; unitPrice: number; priceType?: "cash" | "credit" | "supplier"; discount: number }

/**
 * Dual quantity inputs for a single cart line: base-unit (Qty) on top, pack (CTN) below.
 * The two are kept in sync — typing in either updates the other via the item's pack_size.
 *
 * The pack input is a *local* string state so the user can type fractional values smoothly
 * (e.g. "1.5"); without that, rounding back through `quantity` would strip the trailing dot
 * on every keystroke. When the parent quantity changes for another reason (e.g. the user
 * typed in Qty, or the line was just added), we re-sync the local string from it.
 */
/**
 * Bill-level discount % input. Mirrors the cart-line version: stores PKR as the source of
 * truth (`discountAmount` state in the parent), shows the equivalent percentage, and writes
 * back PKR when edited.
 */
function BillDiscountPercent({
  discountPkr,
  baseAmount,
  onChange,
}: {
  discountPkr: number
  baseAmount: number
  onChange: (pkr: number) => void
}) {
  const formatPct = (n: number) =>
    Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
  const [pctStr, setPctStr] = useState<string>(() =>
    discountPkr > 0 && baseAmount > 0 ? formatPct((discountPkr / baseAmount) * 100) : "",
  )
  useEffect(() => {
    if (baseAmount <= 0) return
    const pct = (discountPkr / baseAmount) * 100
    if (discountPkr === 0 && pctStr !== "") {
      setPctStr("")
      return
    }
    if (Number(pctStr || "0") !== pct) {
      setPctStr(formatPct(pct))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discountPkr, baseAmount])
  return (
    <Input
      type="number"
      min={0}
      max={100}
      step={0.01}
      value={pctStr}
      onChange={(e) => {
        setPctStr(e.target.value)
        const pct = Number(e.target.value)
        if (Number.isFinite(pct) && pct >= 0 && baseAmount > 0) {
          const pkr = Math.max(0, Math.min(baseAmount, baseAmount * (pct / 100)))
          onChange(Math.round(pkr * 100) / 100)
        } else if (e.target.value === "") {
          onChange(0)
        }
      }}
      placeholder="0"
      className="h-7 w-20 text-sm text-right"
    />
  )
}

/**
 * Cart discount % input. The canonical discount value is stored on `line.discount` in PKR;
 * this component shows the equivalent percentage and writes back the PKR amount when the
 * user types. Sibling `CartDiscountPkr` cell handles the PKR side directly.
 *
 * Like `CartPackInput`, we keep a local string state so the user can type fractional values
 * like "2.5" without rounding-flicker each keystroke.
 */
function CartDiscountPercent({
  discount,
  grossAmt,
  belowCost,
  costPrice,
  onChange,
}: {
  discount: number
  grossAmt: number
  belowCost: boolean
  costPrice: number
  onChange: (pkr: number) => void
}) {
  const formatPct = (n: number) =>
    Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)

  const initialPct = grossAmt > 0 ? (discount / grossAmt) * 100 : 0
  const [pctStr, setPctStr] = useState<string>(() => (discount > 0 ? formatPct(initialPct) : ""))

  useEffect(() => {
    if (grossAmt <= 0) return
    const pct = (discount / grossAmt) * 100
    if (discount === 0 && pctStr !== "") {
      setPctStr("")
      return
    }
    if (Number(pctStr || "0") !== pct) {
      setPctStr(formatPct(pct))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discount, grossAmt])

  return (
    <div className="relative w-24">
      <Input
        type="number"
        min={0}
        max={100}
        step={0.01}
        value={pctStr}
        placeholder="0"
        onChange={(e) => {
          setPctStr(e.target.value)
          const pct = Number(e.target.value)
          if (Number.isFinite(pct) && pct >= 0) {
            const pkr = Math.max(0, Math.min(grossAmt, grossAmt * (pct / 100)))
            onChange(Math.round(pkr * 100) / 100)
          } else if (e.target.value === "") {
            onChange(0)
          }
        }}
        className={`w-24 h-8 text-sm pr-6 ${belowCost ? "border-red-500 focus-visible:ring-red-500" : ""}`}
      />
      {belowCost && (
        <span
          title={`Below cost price! (Cost: Rs. ${costPrice})`}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-red-500 text-xs cursor-help"
        >⚠</span>
      )}
    </div>
  )
}

/**
 * Cart pack-quantity (CTN) cell. Renders an editable input two-way-bound to the line's
 * base quantity, or an em-dash placeholder if this particular line doesn't have a pack
 * configured (so the column stays aligned across all rows in a mixed cart).
 *
 * Kept as a separate cell (not a sub-element inside the Qty cell) so the column header
 * "CTN" sits directly above the input — matching how Qty / Price / Disc work.
 */
function CartPackInput({
  quantity,
  packSize,
  packLabel,
  onChange,
}: {
  quantity: number
  packSize: number | null
  packLabel: string | null
  onChange: (qty: number) => void
}) {
  const showPack = !!(packSize && packSize > 0 && packLabel)
  const formatCtn = (n: number) =>
    Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000)

  const [packStr, setPackStr] = useState<string>(() =>
    showPack ? formatCtn(quantity / (packSize as number)) : "",
  )

  // External change (e.g. user typed in Qty field) — refresh the pack string only if it no
  // longer matches numerically. The numeric comparison lets the user keep typing "10." or
  // similar without us overwriting the field on every render.
  useEffect(() => {
    if (!showPack || !packSize) return
    const ctn = quantity / packSize
    if (Number(packStr) !== ctn) {
      setPackStr(formatCtn(ctn))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantity, packSize])

  if (!showPack) {
    return <span className="text-muted-foreground text-sm">—</span>
  }

  return (
    <Input
      type="number"
      min={0}
      step="0.01"
      value={packStr}
      onChange={(e) => {
        setPackStr(e.target.value)
        const ctnNum = Number(e.target.value)
        if (Number.isFinite(ctnNum) && ctnNum > 0 && packSize) {
          onChange(Math.max(1, Math.round(ctnNum * packSize)))
        }
      }}
      className="w-20 h-8 text-sm"
      aria-label={`Pack quantity (${packLabel})`}
    />
  )
}

interface POSNewSaleFormProps {
  parties: PartyOption[]
  inventory: InventoryOption[]
  initialItemId?: string | null
  autoAdd?: boolean
  walkInPartyId?: string
  isOwner?: boolean
  // SET-H4: GST rate from /settings/tax. Used as the initial taxRate when starting a new
  // sale. Editing a draft keeps the draft's saved taxRate (overrides this default).
  defaultTaxRate?: number
  // SET-H1: behavior settings from /settings/pos. Default payment method seeds the
  // dropdown. Require-customer forces the cashier to pick a party (no walk-in). Allow-
  // below-cost toggles the warning toast when items are sold at a loss.
  defaultPaymentMethod?: string
  requireCustomer?: boolean
  allowBelowCost?: boolean
  initialSale?: {
    invoiceId: string
    partyId: string
    taxRate: number
    // Bill-level PKR discount that was saved on the draft. Drives the initial value of the
    // "Bill Discount" field so editing a draft doesn't silently zero out the rebate.
    discount: number
    items: Array<{
      itemId: string
      quantity: number
      // For drafts saved before the per-line discount migration, `unitPrice` here is the
      // effective price (no separate list price exists). For newer drafts, `unitPrice` is
      // the list price and `discountAmount` carries the per-line PKR discount.
      unitPrice: number
      originalUnitPrice?: number | null
      discountAmount?: number
    }>
  }
}

export function POSNewSaleForm({
  parties,
  inventory,
  initialItemId,
  autoAdd,
  initialSale,
  walkInPartyId,
  isOwner,
  defaultTaxRate = 0,
  defaultPaymentMethod = "Cash",
  requireCustomer = false,
  allowBelowCost = false,
}: POSNewSaleFormProps) {
  const [localParties, setLocalParties] = useState<PartyOption[]>(parties)
  const [newCustomerOpen, setNewCustomerOpen] = useState(false)
  const [newCustName, setNewCustName] = useState("")
  const [newCustPhone, setNewCustPhone] = useState("")
  const [newCustAddress, setNewCustAddress] = useState("")
  const [creatingCust, setCreatingCust] = useState(false)
  const [partyId, setPartyId] = useState(initialSale?.partyId ?? "")
  const [items, setItems] = useState<CartItem[]>(
    initialSale?.items.map((i) => ({
      itemId: i.itemId,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discount: Number(i.discountAmount ?? 0),
    })) ?? []
  )
  // SET-H4: editing a draft keeps the draft's tax. New sale uses the configured gst_rate.
  const [taxRate, setTaxRate] = useState(initialSale?.taxRate ?? defaultTaxRate)
  const editInvoiceId = initialSale?.invoiceId ?? null
  const [selectedItem, setSelectedItem] = useState("")
  const [quantity, setQuantity] = useState(1)
  // Pack/CTN input mirrored from `quantity` via the item's packSize. Stored as a string so the
  // user can type fractional values (1.5) and clear the field without it snapping back to 0.
  const [packQty, setPackQty] = useState<string>("")
  // Bill-level discount in PKR. Seeded from the draft when editing so a saved bill discount
  // round-trips correctly; previously this always started at 0 and the saved value was lost.
  const [discountAmount, setDiscountAmount] = useState(initialSale?.discount ?? 0)
  const [discountMode, setDiscountMode] = useState<"pkr" | "pct">("pkr")
  const [payingNow, setPayingNow] = useState(0)
  const [saleMode, setSaleMode] = useState<"sale" | "credit" | "draft">("sale")
  // billType (No.2 selector): determines whether this is a Cash/Credit/Draft bill.
  // Independent from paymentMethod (No.1) which only controls HOW cash is paid.
  const [billType, setBillType] = useState<"cash" | "credit" | "draft">("cash")
  // SET-H1: initial payment method comes from the user's POS Preferences setting (defaults
  // to "Cash" when unset). Falls back to "Cash" if the configured value isn't a recognised
  // PaymentMethod (Credit removed — use billType instead).
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    (["Cash", "Card", "JazzCash", "EasyPaisa"] as PaymentMethod[]).includes(defaultPaymentMethod as PaymentMethod)
      ? (defaultPaymentMethod as PaymentMethod)
      : "Cash"
  )
  const [transactionRef, setTransactionRef] = useState("")
  const [billRef, setBillRef] = useState("")
  const [priceType, setPriceType] = useState<"cash" | "credit" | "supplier">("cash")
  const [showMargin, setShowMargin] = useState(false)
  const [showPreBalance, setShowPreBalance] = useState(false)
  const [customerPreBalance, setCustomerPreBalance] = useState(0)
  const isFirstRender = useRef(true)
  const belowCostItems = useRef<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()
  const [printPending, setPrintPending] = useState(false)
  const [lastInvoiceId, setLastInvoiceId] = useState<string | null>(null)
  const [lastSaleMode, setLastSaleMode] = useState<"sale" | "credit" | "draft">("sale")
  const [showCompleteDialog, setShowCompleteDialog] = useState(false)
  const [completedTotal, setCompletedTotal] = useState(0)
  const [completedCustomer, setCompletedCustomer] = useState("")
  const [showCustomerResults, setShowCustomerResults] = useState(false)
  const [showItemResults, setShowItemResults] = useState(false)
  const [customerQuery, setCustomerQuery] = useState("")
  const [itemQuery, setItemQuery] = useState("")
  const [customerHighlightIndex, setCustomerHighlightIndex] = useState(0)
  const [itemHighlightIndex, setItemHighlightIndex] = useState(0)
  const customerInputRef = useRef<HTMLInputElement>(null)
  const itemInputRef = useRef<HTMLInputElement>(null)
  const quantityInputRef = useRef<HTMLInputElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const customerDropdownRef = useRef<HTMLDivElement>(null)
  const itemDropdownRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { formatCurrency } = useCurrency()

  const selectedPartyName = partyId ? localParties.find((p) => p.id === partyId)?.name ?? "" : ""

  // The currently-selected item drives whether the dual CTN/Unit inputs show up. Recomputing
  // these from `selectedItem` (rather than caching) means the UI always reads the latest pack
  // metadata from the prop, including newly-quick-created items.
  const selectedInventoryItem = selectedItem ? inventory.find((i) => i.id === selectedItem) ?? null : null
  const selectedPackSize = selectedInventoryItem?.packSize ?? null
  const selectedPackLabel = selectedInventoryItem?.packLabel ?? null
  const hasPack = !!(selectedPackSize && selectedPackSize > 0)

  const selectedItemName = selectedItem
    ? (() => {
        const inv = selectedInventoryItem
        if (!inv) return ""
        if (inv.packSize && inv.packSize > 0 && inv.packLabel) {
          const packCount = inv.stock / inv.packSize
          const packCountStr = Number.isInteger(packCount) ? String(packCount) : (Math.round(packCount * 100) / 100).toString()
          return `${inv.name} (Stock: ${inv.stock}${packCount > 0 ? ` / ${packCountStr} ${inv.packLabel}` : ""})`
        }
        return `${inv.name} (Stock: ${inv.stock})`
      })()
    : ""

  // Sync helpers: change one, the other updates automatically. Always keep `quantity`
  // as the source of truth in base units (everything downstream — line totals, stock check —
  // operates on base units).
  const updateQuantityFromUnit = (val: number) => {
    const safe = Math.max(1, val || 1)
    setQuantity(safe)
    if (hasPack && selectedPackSize) {
      const ctn = safe / selectedPackSize
      setPackQty(Number.isInteger(ctn) ? String(ctn) : (Math.round(ctn * 10000) / 10000).toString())
    }
  }
  const updateQuantityFromPack = (val: string) => {
    setPackQty(val)
    if (hasPack && selectedPackSize) {
      const ctnNum = Number(val)
      if (Number.isFinite(ctnNum) && ctnNum > 0) {
        const units = Math.max(1, Math.round(ctnNum * selectedPackSize))
        setQuantity(units)
      }
    }
  }

  const filteredCustomers = useMemo(
    () => localParties.filter((p) => p.name.toLowerCase().includes(customerQuery.toLowerCase())),
    [localParties, customerQuery]
  )

  const filteredItems = useMemo(
    () =>
      inventory.filter(
        (item) => item.stock > 0 && item.name.toLowerCase().includes(itemQuery.toLowerCase())
      ),
    [inventory, itemQuery]
  )

  useEffect(() => {
    setCustomerHighlightIndex(0)
  }, [customerQuery])

  useEffect(() => {
    setItemHighlightIndex(0)
  }, [itemQuery])

  useEffect(() => {
    if (customerDropdownRef.current && showCustomerResults) {
      const highlightedEl = customerDropdownRef.current.children[customerHighlightIndex] as HTMLElement
      if (highlightedEl) {
        highlightedEl.scrollIntoView({ block: "nearest" })
      }
    }
  }, [customerHighlightIndex, showCustomerResults])

  useEffect(() => {
    if (itemDropdownRef.current && showItemResults) {
      const highlightedEl = itemDropdownRef.current.children[itemHighlightIndex] as HTMLElement
      if (highlightedEl) {
        highlightedEl.scrollIntoView({ block: "nearest" })
      }
    }
  }, [itemHighlightIndex, showItemResults])

  // billType drives the sale mode. "credit" => udhaar. "draft" => saved as Draft. "cash" => paid.
  useEffect(() => {
    if (billType === "credit") {
      setSaleMode("credit")
    } else {
      setSaleMode("sale")
      setPayingNow(0)
    }
    if (billType !== "cash") setTransactionRef("")
  }, [billType])

  // Keep `payingNow` ≤ current total. If the cashier removes a line or changes prices and
  // the total drops below the previously-entered "Paying Now", clamp it back down. Without
  // this, an over-payment could be persisted as cash received (paid > total) and the status
  // would silently flip to "Paid" with ledger over-counting.

  // Whenever the selected item changes (or the user clears it), refresh the CTN input so it
  // matches the current `quantity` × packSize. Keeps the two fields visually consistent.
  useEffect(() => {
    if (!hasPack || !selectedPackSize) {
      setPackQty("")
      return
    }
    const ctn = quantity / selectedPackSize
    setPackQty(Number.isInteger(ctn) ? String(ctn) : (Math.round(ctn * 10000) / 10000).toString())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem])

  const handleCustomerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showCustomerResults) return

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setCustomerHighlightIndex((prev) =>
        prev < filteredCustomers.length - 1 ? prev + 1 : prev
      )
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setCustomerHighlightIndex((prev) => (prev > 0 ? prev - 1 : 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (filteredCustomers.length > 0 && filteredCustomers[customerHighlightIndex]) {
        const selected = filteredCustomers[customerHighlightIndex]
        setPartyId(selected.id)
        setCustomerQuery("")
        setShowCustomerResults(false)
      }
    } else if (e.key === "Escape") {
      setShowCustomerResults(false)
    }
  }

  const handleItemKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showItemResults) return

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setItemHighlightIndex((prev) =>
        prev < filteredItems.length - 1 ? prev + 1 : prev
      )
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setItemHighlightIndex((prev) => (prev > 0 ? prev - 1 : 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (filteredItems.length > 0 && filteredItems[itemHighlightIndex]) {
        const selected = filteredItems[itemHighlightIndex]
        setSelectedItem(selected.id)
        setItemQuery("")
        setShowItemResults(false)
      }
    } else if (e.key === "Escape") {
      setShowItemResults(false)
    }
  }

  // Helper to add an item by ID with quantity 1 (used by both barcode flows)
  const addItemById = useCallback(
    (itemId: string) => {
      const inv = inventory.find((i) => i.id === itemId)
      if (!inv) return
      if (inv.stock <= 0) {
        toast.error(`${inv.name} is out of stock`)
        return
      }

      // Get price based on selected priceType
      const selectedPrice = (() => {
        switch (priceType) {
          case "credit":
            return inv.creditPrice ?? inv.unitPrice
          case "supplier":
            return inv.supplierPrice ?? inv.unitPrice
          case "cash":
          default:
            return inv.cashPrice ?? inv.unitPrice
        }
      })()

      setItems((prev) => {
        const existingIdx = prev.findIndex((i) => i.itemId === itemId)
        const currentQty = existingIdx >= 0 ? prev[existingIdx].quantity : 0
        if (currentQty + 1 > inv.stock) {
          toast.error(`Insufficient stock for ${inv.name}. Available: ${inv.stock}`)
          return prev
        }
        if (existingIdx >= 0) {
          return prev.map((item, i) =>
            i === existingIdx ? { ...item, quantity: item.quantity + 1 } : item
          )
        }
        return [...prev, { itemId, quantity: 1, unitPrice: selectedPrice, priceType, discount: 0 }]
      })
      toast.success(`Added 1x ${inv.name}`)
    },
    [inventory, priceType]
  )

  // Listen for barcode scans from the global BarcodeScanToPOS component (same-page event)
  useEffect(() => {
    const handleBarcodeScan = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.itemId) {
        addItemById(detail.itemId)
      }
    }
    window.addEventListener("pos-barcode-scan", handleBarcodeScan)
    return () => window.removeEventListener("pos-barcode-scan", handleBarcodeScan)
  }, [addItemById])

  // Handle item from URL params (cross-page redirect from barcode scan on non-POS pages)
  const processedInitialRef = useRef(false)
  useEffect(() => {
    if (initialItemId && inventory.some((i) => i.id === initialItemId) && !processedInitialRef.current) {
      processedInitialRef.current = true
      if (autoAdd) {
        addItemById(initialItemId)
      } else {
        setSelectedItem(initialItemId)
      }
      router.replace("/pos", { scroll: false })
    }
  }, [initialItemId, inventory, router, autoAdd, addItemById])

  // When price tier changes → update ALL items in cart to new tier price
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    if (items.length === 0) return
    setItems((prev) =>
      prev.map((item) => {
        const inv = inventory.find((i) => i.id === item.itemId)
        if (!inv) return item
        const newPrice =
          priceType === "credit" ? (inv.creditPrice || inv.unitPrice)
          : priceType === "supplier" ? (inv.supplierPrice || inv.unitPrice)
          : (inv.cashPrice || inv.unitPrice)
        return { ...item, unitPrice: newPrice, priceType }
      })
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceType])

  // Handle F7 key to print invoice, F3 to focus item field, Shift+Arrows for navigation
  useEffect(() => {
    const inputRefs: React.RefObject<HTMLInputElement | HTMLButtonElement | null>[] = [
      customerInputRef,
      itemInputRef,
      quantityInputRef,
      addButtonRef,
    ]

    const handleKeyDown = (e: KeyboardEvent) => {
      // F7 - Print invoice
      if (e.key === "F7") {
        e.preventDefault()
        if (lastInvoiceId) {
          handlePrint()
        }
        return
      }

      // F3 - Focus on item search field
      if (e.key === "F3") {
        e.preventDefault()
        itemInputRef.current?.focus()
        itemInputRef.current?.select()
        return
      }

      // Shift + Arrow keys - Navigate between input fields
      if (e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "ArrowUp")) {
        const activeElement = document.activeElement
        const currentIndex = inputRefs.findIndex((ref) => ref.current === activeElement)

        if (currentIndex !== -1) {
          e.preventDefault()
          let nextIndex: number

          if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            nextIndex = (currentIndex + 1) % inputRefs.length
          } else {
            nextIndex = (currentIndex - 1 + inputRefs.length) % inputRefs.length
          }

          const nextRef = inputRefs[nextIndex]
          nextRef.current?.focus()
          if (nextRef.current && 'select' in nextRef.current) {
            (nextRef.current as HTMLInputElement).select()
          }
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [lastInvoiceId])

  const computed = useMemo(() => {
    const detailed = items.map((line) => {
      const inv = inventory.find((i) => i.id === line.itemId)
      const grossAmt = line.unitPrice * line.quantity
      // `line.discount` is always stored as the PKR discount amount — never a percentage.
      // The cart row shows both a % and a PKR input that read/write this single value.
      const discountAmt = Math.min(Math.max(0, line.discount ?? 0), grossAmt)
      const amount = Math.max(0, grossAmt - discountAmt)
      const costPrice = inv?.costPrice ?? 0
      const discPerUnit = line.quantity > 0 ? discountAmt / line.quantity : 0
      const belowCost = costPrice > 0 && (line.unitPrice - discPerUnit) < costPrice
      const margin = costPrice > 0 && amount > 0
        ? ((amount - costPrice * line.quantity) / amount) * 100
        : null
      return { ...line, name: inv?.name ?? "", stock: inv?.stock ?? 0, costPrice, discountAmt, amount, belowCost, margin }
    })
    const subtotal = detailed.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0)
    const totalItemDiscount = detailed.reduce((sum, l) => sum + l.discountAmt, 0)
    const afterItemDiscount = subtotal - totalItemDiscount
    const tax = taxRate > 0 ? afterItemDiscount * (taxRate / 100) : 0
    const globalDisc = discountAmount > 0 ? Math.min(discountAmount, afterItemDiscount + tax) : 0
    const total = afterItemDiscount + tax - globalDisc
    const balance = saleMode === "credit" ? Math.max(0, total - payingNow) : 0
    return { detailed, subtotal, totalItemDiscount, tax, discount: globalDisc, total, balance }
  }, [inventory, items, taxRate, discountAmount, saleMode, payingNow])

  // Clamp `payingNow` to the current total whenever the total decreases. The bare
  // `Math.min` in the onChange handler protected the value at the moment of typing, but a
  // subsequent line removal or discount increase could leave payingNow > total without the
  // input being touched again. That would persist as an over-payment on save.
  useEffect(() => {
    if (payingNow > computed.total) {
      setPayingNow(Math.max(0, computed.total))
    }
  }, [computed.total, payingNow])

  // Fetch customer's pre-balance when "Show Balance" is ON and a real customer is selected.
  // Walk-in customers always get 0 (they have no persistent ledger).
  useEffect(() => {
    if (!showPreBalance || !partyId || partyId === walkInPartyId) {
      setCustomerPreBalance(0)
      return
    }
    getPartyOutstandingBalance(partyId).then(setCustomerPreBalance).catch(() => setCustomerPreBalance(0))
  }, [showPreBalance, partyId, walkInPartyId])

  // Warn when any item transitions into below-cost territory. SET-H1: if the user has
  // explicitly allowed below-cost selling in /settings/pos (`allow_below_cost = true`),
  // skip the warning entirely. The red highlight in the cart row still shows so the
  // cashier sees what's happening, but the toast doesn't nag.
  useEffect(() => {
    if (allowBelowCost) return
    const prev = belowCostItems.current
    const next = new Set<string>()
    computed.detailed.forEach((line) => {
      if (line.belowCost) {
        next.add(line.itemId)
        if (!prev.has(line.itemId)) {
          const effectivePrice = line.quantity > 0 ? line.amount / line.quantity : 0
          const lossPerUnit = line.costPrice - effectivePrice
          toast.warning(`Nuqsan! Selling below cost — ${line.name}`, {
            description: `Effective price: Rs. ${effectivePrice.toFixed(0)} | Cost price: Rs. ${line.costPrice.toFixed(0)} | Loss per unit: Rs. ${lossPerUnit.toFixed(0)}`,
            duration: 6000,
          })
        }
      }
    })
    belowCostItems.current = next
  }, [computed.detailed, allowBelowCost])

  const addLine = () => {
    if (!selectedItem || quantity <= 0) {
      toast.error("Select an item and enter quantity")
      return
    }
    const inv = inventory.find((i) => i.id === selectedItem)
    if (!inv) return
    const existingIdx = items.findIndex((i) => i.itemId === selectedItem)
    const newQty = existingIdx >= 0 ? items[existingIdx].quantity + quantity : quantity
    if (newQty > inv.stock) {
      toast.error(`Insufficient stock. Available: ${inv.stock}`)
      return
    }

    // Get price based on selected priceType
    const selectedPrice = (() => {
      switch (priceType) {
        case "credit":
          return inv.creditPrice ?? inv.unitPrice
        case "supplier":
          return inv.supplierPrice ?? inv.unitPrice
        case "cash":
        default:
          return inv.cashPrice ?? inv.unitPrice
      }
    })()

    if (existingIdx >= 0) {
      setItems((prev) =>
        prev.map((item, i) => (i === existingIdx ? { ...item, quantity: newQty } : item)),
      )
    } else {
      setItems((prev) => [...prev, { itemId: selectedItem, quantity, unitPrice: selectedPrice, priceType, discount: 0 }])
    }
    setSelectedItem("")
    setQuantity(1)
    toast.success(`Item added (${priceType})`)
    setTimeout(() => { itemInputRef.current?.focus(); itemInputRef.current?.select() }, 0)
  }

  const updateLineQuantity = (index: number, newQty: number) => {
    const line = items[index]
    const inv = inventory.find((i) => i.id === line.itemId)
    if (newQty < 1) return
    if (inv && newQty > inv.stock) {
      toast.error(`Insufficient stock. Available: ${inv.stock}`)
      return
    }
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, quantity: newQty } : item))
    )
  }

  const updateLinePrice = (index: number, newPrice: number) => {
    if (newPrice < 0) return
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, unitPrice: newPrice } : item))
    )
  }

  const updateLineDiscount = (index: number, value: number) => {
    setItems((prev) => prev.map((item, i) => i === index ? { ...item, discount: Math.max(0, value) } : item))
  }

  const applyGlobalDiscount = (totalPKR: number) => {
    if (totalPKR <= 0 || items.length === 0) return
    const totalGross = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
    if (totalGross <= 0) return
    // Split the bill-level PKR discount proportionally across line items based on their
    // share of the gross total. Each per-line `discount` is stored in PKR. Rounding the
    // pro-rata share to 2 decimals can leave a few paise of drift (sum < totalPKR or > by
    // 0.01-0.02) — we assign the entire remainder to the line with the largest gross so the
    // sum of per-line discounts exactly equals what the cashier typed.
    const computed = items.map((item) => {
      const itemGross = item.unitPrice * item.quantity
      const proportionalPKR = totalPKR * (itemGross / totalGross)
      return { itemGross, share: Math.round(proportionalPKR * 100) / 100 }
    })
    const sumShares = computed.reduce((s, c) => s + c.share, 0)
    const drift = Math.round((totalPKR - sumShares) * 100) / 100
    if (drift !== 0 && computed.length > 0) {
      let largestIdx = 0
      for (let i = 1; i < computed.length; i++) {
        if (computed[i].itemGross > computed[largestIdx].itemGross) largestIdx = i
      }
      computed[largestIdx].share = Math.round((computed[largestIdx].share + drift) * 100) / 100
    }
    setItems((prev) =>
      prev.map((item, idx) => ({ ...item, discount: Math.max(0, computed[idx]?.share ?? 0) })),
    )
    setDiscountAmount(0)
  }

  const removeLine = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleCompleteSale = (modeOverride?: "sale" | "credit" | "draft") => {
    const effectiveSaleMode = modeOverride ?? (billType === "draft" ? "draft" : saleMode)
    if (computed.detailed.length === 0) {
      toast.error("Add at least one item")
      return
    }
    // SET-H1: if the user enabled "Require customer selection" in /settings/pos, the
    // walk-in fallback is disabled — every sale needs an explicitly-picked party. Defaults
    // to the previous behavior (walk-in auto-fills if no party picked).
    const effectivePartyId = requireCustomer
      ? partyId
      : (partyId || walkInPartyId || "")
    if (!effectivePartyId) {
      toast.error(
        requireCustomer
          ? "Please select a customer (walk-in disabled in POS Preferences)."
          : "Select a customer to continue"
      )
      return
    }
    if (!partyId && walkInPartyId && !requireCustomer) {
      setPartyId(walkInPartyId)
      setCustomerQuery("")
    }
    const needsRef = paymentMethod === "JazzCash" || paymentMethod === "EasyPaisa"
    if (effectiveSaleMode === "sale" && needsRef && !transactionRef.trim()) {
      toast.error(`Transaction ID is required for ${paymentMethod}`)
      return
    }
    startTransition(async () => {
      // `unitPrice` is the EFFECTIVE per-unit price (after any per-line discount), so DB
      // line_total stays correct. `originalUnitPrice` keeps the pre-discount list price and
      // `discountAmount` keeps the total per-line discount in PKR — both persisted so the
      // printed invoice can show the Disc% / Disc Amt columns honestly instead of always 0.
      const lineItems = computed.detailed.map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        unitPrice: line.quantity > 0 ? line.amount / line.quantity : line.unitPrice,
        originalUnitPrice: line.unitPrice,
        discountAmount: Math.round(line.discountAmt * 100) / 100,
      }))

      // Edit mode — update existing Draft (with optional status change). All three branches
      // now pass `discount: computed.discount` so the bill-level rebate survives the round
      // trip. createPOSSale already does this; updatePOSSale used to silently drop it.
      if (editInvoiceId) {
        const updatePayload =
          effectiveSaleMode === "sale"
            ? { partyId: effectivePartyId, items: lineItems, taxRate, discount: computed.discount, status: "Paid" as const, payment: { amount: computed.total, method: paymentMethod, reference: transactionRef || undefined } }
            : effectiveSaleMode === "credit"
            ? {
                partyId: effectivePartyId,
                items: lineItems,
                taxRate,
                discount: computed.discount,
                status: "Credit" as const,
                // Optional partial payment when completing a draft as Credit
                ...(payingNow > 0 ? { payment: { amount: payingNow, method: "Cash" } } : {}),
              }
            : { partyId: effectivePartyId, items: lineItems, taxRate, discount: computed.discount, status: "Draft" as const }

        const result = await updatePOSSale(editInvoiceId, updatePayload)
        if (result.error) {
          toast.error(result.error)
          return
        }

        if (effectiveSaleMode === "sale") {
          const customerName = localParties.find((p) => p.id === partyId)?.name ?? ""
          setLastInvoiceId(editInvoiceId)
          setLastSaleMode("sale")
          setCompletedTotal(computed.total)
          setCompletedCustomer(customerName)
          setItems([])
          setPartyId("")
          setCustomerQuery("")
          setShowCompleteDialog(true)
        } else {
          toast.success(effectiveSaleMode === "credit" ? "Saved as Credit (Udhaar)" : "Draft updated")
          router.push("/pos/sales")
        }
        return
      }

      const payload =
        effectiveSaleMode === "sale"
          ? { payments: [{ amount: computed.total, method: paymentMethod, reference: transactionRef || undefined }] }
          : effectiveSaleMode === "credit"
          ? {
              status: "Credit" as const,
              // Optional partial payment at credit-sale time. Recorded as "Cash" by default.
              ...(payingNow > 0
                ? { payments: [{ amount: payingNow, method: "Cash" as const }] }
                : {}),
            }
          : { status: "Draft" as const }

      const result = await createPOSSale({ partyId: effectivePartyId, items: lineItems, taxRate, discount: computed.discount, preBalance: customerPreBalance, showPreBalance, referenceNo: billRef || undefined, ...payload })
      if (result.error) {
        toast.error(result.error)
        return
      }
      setLastInvoiceId(result.data?.invoiceId ?? null)
      setLastSaleMode(effectiveSaleMode)
      const customerName = localParties.find((p) => p.id === partyId)?.name ?? ""
      setItems([])
      setPartyId("")
      setCustomerQuery("")
      setBillRef("")
      if (effectiveSaleMode === "sale") {
        setCompletedTotal(computed.total)
        setCompletedCustomer(customerName)
        setShowCompleteDialog(true)
      } else if (effectiveSaleMode === "credit") {
        toast.success("Credit (Udhaar) saved")
      } else {
        toast.success("Draft saved")
      }
    })
  }

  const handleCreateCustomer = async () => {
    if (!newCustName.trim() || !newCustPhone.trim()) { toast.error("Name and phone are required"); return }
    setCreatingCust(true)
    const result = await quickCreateCustomer(newCustName.trim(), newCustPhone.trim(), newCustAddress || undefined)
    setCreatingCust(false)
    if (result.error || !result.data) { toast.error(result.error || "Failed to create customer"); return }
    setLocalParties((prev) => [...prev, result.data!])
    setPartyId(result.data.id)
    setCustomerQuery("")
    setShowCustomerResults(false)
    setNewCustomerOpen(false)
    setNewCustName("")
    setNewCustPhone("")
    setNewCustAddress("")
    toast.success(`"${result.data.name}" added as customer`)
  }

  const handlePrint = async () => {
    if (!lastInvoiceId) return
    setPrintPending(true)
    try {
      const format = await getUserPrintFormat()
      const invoiceResult = await getInvoiceForPrint(lastInvoiceId)
      if (invoiceResult.error || !invoiceResult.data) {
        toast.error(invoiceResult.error ?? "Failed to load invoice")
        return
      }
      if (format === "a4") {
        const { printA4Invoice } = await import("@/components/pos/print-a4-invoice")
        await printA4Invoice(invoiceResult.data)
      } else {
        const { printStandardInvoice } = await import("@/components/pos/print-standard-invoice")
        await printStandardInvoice(invoiceResult.data)
      }
      toast.success("Print dialog opened")
    } catch (e) {
      console.error(e)
      toast.error("Print failed")
    } finally {
      setPrintPending(false)
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base sm:text-lg">Point of Sale</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {/* Rate selector — only changes the unit price tier (cash / credit / supplier).
                Independent from payment method and sale status. */}
            <Select
              value={priceType}
              onValueChange={(v: "cash" | "credit" | "supplier") => setPriceType(v)}
            >
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">
                  <span className="inline-flex items-center gap-2">
                    <Banknote className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.75} />
                    Cash Rate
                  </span>
                </SelectItem>
                <SelectItem value="credit">
                  <span className="inline-flex items-center gap-2">
                    <Wallet className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.75} />
                    Credit Rate
                  </span>
                </SelectItem>
                <SelectItem value="supplier">
                  <span className="inline-flex items-center gap-2">
                    <Building2 className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.75} />
                    Supplier Rate
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            {/* Show margin — owner only.
                (The % / PKR toggle that used to live here was removed: the cart row now
                shows both Disc % and Disc PKR as separate columns, two-way linked, so a
                mode switch is unnecessary.) */}
            {isOwner && (
              <button
                type="button"
                onClick={() => setShowMargin((v) => !v)}
                className={`flex items-center gap-1.5 px-3 h-8 rounded-md border text-xs font-medium transition-colors ${showMargin ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
              >
                <Percent className="w-3.5 h-3.5" strokeWidth={1.75} />
                Margin
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowPreBalance((v) => !v)}
              title="Show customer's previous outstanding balance on the bill"
              className={`flex items-center gap-1.5 px-3 h-8 rounded-md border text-xs font-medium transition-colors ${showPreBalance ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
            >
              <Wallet className="w-3.5 h-3.5" strokeWidth={1.75} />
              Show Balance
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Customer</Label>
              <div className="flex items-center gap-2">
                {walkInPartyId && !partyId && !requireCustomer && (
                  <button
                    type="button"
                    onClick={() => { setPartyId(walkInPartyId); setCustomerQuery(""); setShowCustomerResults(false) }}
                    className="text-xs text-primary hover:underline font-medium"
                  >
                    + Walk-in
                  </button>
                )}
                {!partyId && (
                  <button
                    type="button"
                    onClick={() => setNewCustomerOpen(true)}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <UserPlus className="w-3 h-3" />
                    New Customer
                  </button>
                )}
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                ref={customerInputRef}
                placeholder="Search customer by name..."
                value={customerQuery || selectedPartyName || ""}
                onChange={(e) => {
                  setCustomerQuery(e.target.value)
                  setShowCustomerResults(e.target.value.length > 0)
                  setPartyId("")
                }}
                onFocus={() => customerQuery && setShowCustomerResults(true)}
                className="pl-9"
                onKeyDown={handleCustomerKeyDown}
              />
              {partyId && (
                <button
                  onClick={() => {
                    setPartyId("")
                    setCustomerQuery("")
                    setShowCustomerResults(false)
                    customerInputRef.current?.focus()
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded"
                >
                  <X className="h-4 w-4" />
                </button>
              )}

              {showCustomerResults && (
                <div
                  ref={customerDropdownRef}
                  className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-lg shadow-lg z-50 max-h-[200px] overflow-y-auto"
                >
                  {filteredCustomers.length === 0 ? (
                    <div>
                      <div className="p-2 text-sm text-muted-foreground">No customer found</div>
                      {walkInPartyId && (
                        <button
                          className="w-full px-3 py-2 text-left text-sm text-primary font-medium hover:bg-primary/10 border-t"
                          onClick={() => {
                            setPartyId(walkInPartyId)
                            setCustomerQuery("")
                            setShowCustomerResults(false)
                          }}
                        >
                          + Use Walk-in Customer
                        </button>
                      )}
                    </div>
                  ) : (
                    filteredCustomers.map((p, index) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setPartyId(p.id)
                          setCustomerQuery("")
                          setShowCustomerResults(false)
                        }}
                        className={`w-full px-3 py-2 text-left text-sm border-b last:border-b-0 ${
                          index === customerHighlightIndex
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-muted"
                        }`}
                      >
                        {p.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            {walkInPartyId && partyId === walkInPartyId ? (
              <div className="h-10 px-3 flex items-center rounded-md border bg-muted/50 text-sm text-muted-foreground">
                Walk-in Customer — no address
              </div>
            ) : (
              <Input
                placeholder="Customer address..."
                value={partyId ? localParties.find((p) => p.id === partyId)?.address || "" : ""}
                readOnly
                className="bg-muted/50"
              />
            )}
          </div>
          <div className="space-y-2">
            <Label>Bill Reference <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              placeholder="e.g. PO-123, Ref#456..."
              value={billRef}
              onChange={(e) => setBillRef(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Add item</Label>
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                ref={itemInputRef}
                placeholder="Search item by name or barcode..."
                value={itemQuery || selectedItemName || ""}
                onChange={(e) => {
                  setItemQuery(e.target.value)
                  setShowItemResults(e.target.value.length > 0)
                  if (!e.target.value) setSelectedItem("")
                }}
                onFocus={() => itemQuery && setShowItemResults(true)}
                onKeyDown={handleItemKeyDown}
                className="pl-9"
              />

              {showItemResults && (
                <div
                  ref={itemDropdownRef}
                  className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-lg shadow-lg z-50 max-h-[200px] overflow-y-auto"
                >
                  {filteredItems.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground">No item found</div>
                  ) : (
                    filteredItems.map((item, index) => {
                      // Stock readout: show "Stock: 240 PCS (2.4 CTN)" when the item has a pack
                      // configured, otherwise just the base number. Helps the operator decide
                      // which input (CTN vs Unit) to use.
                      const showPack = item.packSize && item.packSize > 0 && item.packLabel
                      const packCount = showPack ? item.stock / (item.packSize as number) : 0
                      const packCountStr = Number.isInteger(packCount)
                        ? String(packCount)
                        : (Math.round(packCount * 100) / 100).toString()
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            setSelectedItem(item.id)
                            setItemQuery("")
                            setShowItemResults(false)
                          }}
                          className={`w-full px-3 py-2 text-left text-sm border-b last:border-b-0 ${
                            index === itemHighlightIndex
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-muted"
                          }`}
                        >
                          {item.name} (Stock: {item.stock}
                          {showPack ? ` / ${packCountStr} ${item.packLabel}` : ""}
                          )
                        </button>
                      )
                    })
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-col items-center">
              <Input
                ref={quantityInputRef}
                type="number"
                min={1}
                max={selectedItem ? selectedInventoryItem?.stock ?? 0 : undefined}
                value={quantity}
                onChange={(e) => updateQuantityFromUnit(Number(e.target.value))}
                className="w-24"
                aria-label="Unit quantity"
              />
              {hasPack && (
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">Unit</span>
              )}
            </div>
            {hasPack && (
              <div className="flex flex-col items-center">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder={selectedPackLabel ?? "CTN"}
                  value={packQty}
                  onChange={(e) => updateQuantityFromPack(e.target.value)}
                  className="w-24"
                  aria-label={`Pack quantity (${selectedPackLabel ?? "CTN"})`}
                />
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">{selectedPackLabel ?? "CTN"}</span>
              </div>
            )}
            <Button ref={addButtonRef} type="button" onClick={addLine} disabled={!selectedItem}>
              <Plus className="w-4 h-4 mr-2" />
              Add
            </Button>
          </div>
        </div>

        {computed.detailed.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted border-b">
                  <th className="px-4 py-2 text-left">Item</th>
                  <th className="px-4 py-2 text-left">Qty</th>
                  {(() => {
                    // Decide once: do any cart lines have a pack? If yes, show a CTN column
                    // (with the most common pack label among lines) — otherwise hide the
                    // column entirely to keep the table compact.
                    const anyPack = computed.detailed.some((l) => {
                      const inv = inventory.find((i) => i.id === l.itemId)
                      return !!(inv?.packSize && inv.packSize > 0 && inv.packLabel)
                    })
                    if (!anyPack) return null
                    const labelCounts: Record<string, number> = {}
                    computed.detailed.forEach((l) => {
                      const inv = inventory.find((i) => i.id === l.itemId)
                      if (inv?.packLabel) {
                        labelCounts[inv.packLabel] = (labelCounts[inv.packLabel] ?? 0) + 1
                      }
                    })
                    const uniqueLabels = Object.keys(labelCounts)
                    const label =
                      uniqueLabels.length === 1
                        ? uniqueLabels[0]
                        : uniqueLabels.length > 1
                          ? "Pack"
                          : "CTN"
                    return <th key="ctn-th" className="px-4 py-2 text-left">{label}</th>
                  })()}
                  <th className="px-4 py-2 text-left w-32">Price</th>
                  <th className="px-4 py-2 text-left w-24">Disc %</th>
                  <th className="px-4 py-2 text-left w-28">Disc PKR</th>
                  <th className="px-4 py-2 text-left">Amount</th>
                  {showMargin && <th className="px-4 py-2 text-left w-20">Margin</th>}
                  <th className="px-4 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Same calculation as above — keep CTN cell visibility per-row in sync with
                  // the header.
                  const anyPack = computed.detailed.some((l) => {
                    const inv = inventory.find((i) => i.id === l.itemId)
                    return !!(inv?.packSize && inv.packSize > 0 && inv.packLabel)
                  })
                  return computed.detailed.map((line, idx) => {
                  const linePackInfo = inventory.find((i) => i.id === line.itemId)
                  const linePackSize = linePackInfo?.packSize ?? null
                  const linePackLabel = linePackInfo?.packLabel ?? null
                  return (
                  <tr key={`${line.itemId}-${idx}`} className="border-b">
                    <td className="px-4 py-2">
                      <div className="font-medium">{line.name}</div>
                      {line.priceType && (
                        <Badge variant="outline" className="text-[10px] mt-1 capitalize">
                          {line.priceType} rate
                        </Badge>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        min={1}
                        max={line.stock}
                        value={line.quantity}
                        onChange={(e) => updateLineQuantity(idx, Math.max(1, Number(e.target.value) || 1))}
                        className="w-20 h-8 text-sm"
                      />
                    </td>
                    {anyPack && (
                      <td className="px-2 py-1">
                        <CartPackInput
                          quantity={line.quantity}
                          packSize={linePackSize}
                          packLabel={linePackLabel}
                          onChange={(q) => updateLineQuantity(idx, q)}
                        />
                      </td>
                    )}
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={line.unitPrice}
                        onChange={(e) => updateLinePrice(idx, Number(e.target.value) || 0)}
                        className="w-28 h-8 text-sm"
                      />
                    </td>
                    {/* Disc % cell — editable; writes back as PKR via two-way binding */}
                    <td className="px-2 py-1">
                      <CartDiscountPercent
                        discount={line.discount ?? 0}
                        grossAmt={line.unitPrice * line.quantity}
                        belowCost={line.belowCost}
                        costPrice={line.costPrice}
                        onChange={(pkr) => updateLineDiscount(idx, pkr)}
                      />
                    </td>
                    {/* Disc PKR cell — canonical value; the % cell mirrors this */}
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        max={line.unitPrice * line.quantity}
                        value={line.discount ? Math.round(line.discount * 100) / 100 : ""}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0
                          const grossAmt = line.unitPrice * line.quantity
                          updateLineDiscount(idx, Math.max(0, Math.min(grossAmt, val)))
                        }}
                        placeholder="0"
                        className={`w-28 h-8 text-sm ${line.belowCost ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                      />
                    </td>
                    <td className="px-4 py-2 font-medium">
                      <div>{formatCurrency(line.amount)}</div>
                      {line.discountAmt > 0 && (
                        <div className="text-[10px] text-green-600">-{formatCurrency(line.discountAmt)}</div>
                      )}
                    </td>
                    {showMargin && (
                      <td className={`px-4 py-2 text-xs font-semibold ${
                        line.margin === null ? "text-muted-foreground"
                        : line.margin >= 0 ? "text-green-600"
                        : "text-red-600"
                      }`}>
                        {line.margin === null ? "—" : `${line.margin > 0 ? "+" : ""}${line.margin.toFixed(0)}%`}
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <Button variant="ghost" size="icon" onClick={() => removeLine(idx)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                  )
                })
                })()}
              </tbody>
            </table>
          </div>
        )}

        {computed.detailed.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1 max-w-xs">
              <div className="flex justify-between text-sm">
                <span>Subtotal</span>
                <span className="font-medium">{formatCurrency(computed.subtotal)}</span>
              </div>
              {computed.totalItemDiscount > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Item Discounts</span>
                  <span>-{formatCurrency(computed.totalItemDiscount)}</span>
                </div>
              )}
              {taxRate > 0 && (
                <div className="flex justify-between text-sm">
                  <span>Tax ({taxRate}%)</span>
                  <span className="font-medium">{formatCurrency(computed.tax)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm items-center gap-2">
                <span className="shrink-0">Bill Discount</span>
                <div className="flex items-center gap-1">
                  {/* PKR / % toggle — switches between entering discount as a fixed amount or percentage */}
                  <button
                    type="button"
                    onClick={() => setDiscountMode((m) => m === "pkr" ? "pct" : "pkr")}
                    className="h-7 px-2 rounded border border-border text-[10px] font-semibold min-w-[36px] hover:bg-muted transition-colors"
                  >
                    {discountMode === "pkr" ? "PKR" : "%"}
                  </button>
                  {discountMode === "pkr" ? (
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={discountAmount || ""}
                      onChange={(e) => setDiscountAmount(Math.max(0, Number(e.target.value) || 0))}
                      onKeyDown={(e) => { if (e.key === "Enter" && discountAmount > 0) applyGlobalDiscount(discountAmount) }}
                      placeholder="0"
                      className="h-7 w-24 text-sm text-right"
                    />
                  ) : (
                    <BillDiscountPercent
                      discountPkr={discountAmount}
                      baseAmount={Math.max(0, computed.subtotal - computed.totalItemDiscount + computed.tax)}
                      onChange={(pkr) => setDiscountAmount(pkr)}
                    />
                  )}
                  {discountAmount > 0 && items.length > 0 && (
                    <button
                      type="button"
                      onClick={() => applyGlobalDiscount(discountAmount)}
                      className="h-7 px-2 rounded bg-primary text-primary-foreground text-xs font-medium whitespace-nowrap"
                    >
                      Split →
                    </button>
                  )}
                </div>
              </div>
              <div className="flex justify-between font-semibold text-base pt-2 border-t">
                <span>Total</span>
                <span>{formatCurrency(computed.total)}</span>
              </div>
              {saleMode === "credit" && (
                <>
                  <div className="flex justify-between text-sm items-center gap-2 pt-1">
                    <span className="shrink-0">Paying Now</span>
                    <Input
                      type="number"
                      min={0}
                      max={computed.total}
                      step={0.01}
                      value={payingNow || ""}
                      onChange={(e) => setPayingNow(Math.max(0, Math.min(computed.total, Number(e.target.value) || 0)))}
                      placeholder="0"
                      className="h-7 w-28 text-sm text-right"
                    />
                  </div>
                  <div className="flex justify-between text-sm font-semibold text-orange-600 dark:text-orange-400">
                    <span>Balance (Udhaar)</span>
                    <span>{formatCurrency(computed.balance)}</span>
                  </div>
                </>
              )}
              {showPreBalance && (
                <>
                  <div className="flex justify-between text-sm text-muted-foreground pt-1 border-t">
                    <span>Previous Balance</span>
                    <span>{formatCurrency(customerPreBalance)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-destructive">
                    <span>Grand Total Payable</span>
                    <span>{formatCurrency(computed.total + customerPreBalance)}</span>
                  </div>
                </>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {/* Bill Type (No.2) — determines Cash / Credit / Draft. Independent from rate selector. */}
              <div className="flex items-center gap-2">
                <Label className="text-sm shrink-0">Bill Type</Label>
                <Select value={billType} onValueChange={(v) => setBillType(v as "cash" | "credit" | "draft")}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">
                      <span className="inline-flex items-center gap-2">
                        <Banknote className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.75} />
                        Cash Bill
                      </span>
                    </SelectItem>
                    <SelectItem value="credit">
                      <span className="inline-flex items-center gap-2">
                        <Wallet className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.75} />
                        Credit Bill
                      </span>
                    </SelectItem>
                    <SelectItem value="draft">
                      <span className="inline-flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.75} />
                        Draft
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Payment method — only shown for Cash Bill */}
              {billType === "cash" && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">Payment</Label>
                    <Select value={paymentMethod} onValueChange={(v) => { setPaymentMethod(v as PaymentMethod); setTransactionRef("") }}>
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Cash">
                          <span className="inline-flex items-center gap-2">
                            <Banknote className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.75} />
                            Cash
                          </span>
                        </SelectItem>
                        <SelectItem value="Card">
                          <span className="inline-flex items-center gap-2">
                            <CreditCard className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.75} />
                            Card
                          </span>
                        </SelectItem>
                        <SelectItem value="JazzCash">
                          <span className="inline-flex items-center gap-2">
                            <Smartphone className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.75} />
                            JazzCash
                          </span>
                        </SelectItem>
                        <SelectItem value="EasyPaisa">
                          <span className="inline-flex items-center gap-2">
                            <Smartphone className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.75} />
                            EasyPaisa
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {(paymentMethod === "JazzCash" || paymentMethod === "EasyPaisa") && (
                    <div className="flex items-center gap-2">
                      <Label className="text-sm text-orange-600">Txn ID *</Label>
                      <Input
                        type="text"
                        placeholder={`${paymentMethod} Transaction ID`}
                        value={transactionRef}
                        onChange={(e) => setTransactionRef(e.target.value)}
                        className="w-48 h-8 text-sm border-orange-300 focus:border-orange-500"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Single adaptive action button */}
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => handleCompleteSale()}
                  disabled={pending || !partyId}
                  className="w-full sm:w-auto"
                >
                  {pending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {billType === "cash" ? "Completing..." : "Saving..."}
                    </>
                  ) : billType === "cash" ? (
                    editInvoiceId ? "Complete Sale" : "Complete Sale"
                  ) : billType === "credit" ? (
                    <>
                      <FileText className="w-4 h-4 mr-2" />
                      {editInvoiceId ? "Save as Credit (Udhaar)" : "Save Credit (Udhaar)"}
                    </>
                  ) : (
                    <>
                      <FileText className="w-4 h-4 mr-2" />
                      {editInvoiceId ? "Update Draft" : "Save Draft"}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {lastInvoiceId && (
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <span className="text-sm">{lastSaleMode === "draft" ? "Draft saved." : lastSaleMode === "credit" ? "Credit (Udhaar) saved." : "Sale completed."} Invoice: {lastInvoiceId.substring(0, 8).toUpperCase()} • Press <kbd className="px-2 py-1 bg-background border rounded text-xs font-semibold">F7</kbd> to print</span>
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={printPending}>
              {printPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Printer className="w-4 h-4 mr-2" />
                  Print
                </>
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setLastInvoiceId(null)}>
              New sale
            </Button>
          </div>
        )}
      </CardContent>

      {/* Sale Completed Dialog */}
      <Dialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-sm text-center">
          <DialogHeader>
            <DialogTitle className="flex flex-col items-center gap-3 text-xl">
              <CheckCircle2 className="w-14 h-14 text-green-500" />
              Sale is Completed!
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 text-sm text-muted-foreground py-2">
            {completedCustomer && <p>Customer: <span className="font-semibold text-foreground">{completedCustomer}</span></p>}
            <p>Total: <span className="font-semibold text-foreground">{formatCurrency(completedTotal)}</span></p>
          </div>
          <div className="flex gap-2 justify-center mt-2">
            <Button onClick={() => { setShowCompleteDialog(false); handlePrint() }} disabled={printPending} variant="outline">
              {printPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Printer className="w-4 h-4 mr-2" />Print</>}
            </Button>
            <Button onClick={() => { setShowCompleteDialog(false); setLastInvoiceId(null) }}>
              New Sale
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Customer Dialog */}
      <Dialog open={newCustomerOpen} onOpenChange={setNewCustomerOpen}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Add New Customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="cName">Name <span className="text-destructive">*</span></Label>
              <Input id="cName" placeholder="e.g. Ahmed Ali" value={newCustName} onChange={(e) => setNewCustName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cPhone">Phone <span className="text-destructive">*</span></Label>
              <Input id="cPhone" placeholder="e.g. 03001234567" value={newCustPhone} onChange={(e) => setNewCustPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cAddress">Address</Label>
              <Input id="cAddress" placeholder="Optional" value={newCustAddress} onChange={(e) => setNewCustAddress(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCustomerOpen(false)} disabled={creatingCust}>Cancel</Button>
            <Button onClick={handleCreateCustomer} disabled={creatingCust}>
              {creatingCust ? "Creating..." : "Create & Select"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
