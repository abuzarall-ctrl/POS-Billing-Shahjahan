// POS models mapping to DB (sales_invoices, sales_invoice_lines, payments)

export type SaleSource = "manual" | "pos"
export type PaymentMethod = "Cash" | "Card" | "JazzCash" | "EasyPaisa" | "Mixed" | "Other" | "Credit"

export interface Sale {
  id: string
  party_id: string
  subtotal: number
  tax: number
  total: number
  status: string
  source: SaleSource
  created_at: string
  updated_at?: string
  party?: { name: string; phone?: string }
  items?: SaleItem[]
  payments?: Payment[]
}

export interface SaleItem {
  id: string
  invoice_id: string
  item_id: string
  quantity: number
  unit_price: number
  line_total: number
  created_at?: string
  item_name?: string
}

export interface Payment {
  id: string
  invoice_id: string
  amount: number
  method: PaymentMethod
  reference?: string | null
  created_at: string
}

export interface InvoiceForPrint {
  id: string
  invoiceNumber: string
  date: string
  party: { name: string; phone?: string; address?: string } | null
  subtotal: number
  discount: number
  tax: number
  total: number
  status: string
  items: Array<{
    name: string
    quantity: number
    unitPrice: number
    lineTotal: number
    // Pack/CTN info — drives the CTN column on the printed invoice. Null when the item
    // wasn't configured with a pack unit.
    packSize?: number | null
    packLabel?: string | null
    // Per-line discount info — drives the Disc% / Disc Amt columns. Old invoices saved
    // before the discount migration land with originalUnitPrice null + discountAmount 0,
    // which the template treats as "no discount applied".
    originalUnitPrice?: number | null
    discountAmount?: number
  }>
  payments?: Payment[]
  currency?: string
  // Extended fields for standard NCR receipt
  cashier?: string
  store?: {
    name: string
    address?: string
    /** Optional second address line — city. Settings/store carries it as `store_city`. */
    city?: string
    phone?: string
    email?: string
    /** WhatsApp number (without +) — printed when set. */
    whatsapp?: string
    /** NTN (National Tax Number) — printed if showNtnStrn is true. */
    ntn?: string
    /** STRN (Sales Tax Reg. Number) — printed if showNtnStrn is true. */
    strn?: string
    /** Public URL of the store logo — rendered at top of the A4 invoice when present. */
    logoUrl?: string
  }
  transactionId?: string // Same as invoiceNumber or formatted differently
  /** SET-H2: invoice-template visibility + content settings, threaded from /settings/invoice
   *  through getInvoiceForPrint into the print template. Every flag controls whether a
   *  column/row/section renders. Centralised here so templates don't reach into the
   *  user_settings table directly. */
  printOptions?: {
    /** Show the per-line Disc % and Disc Amt columns. Default true. */
    showDiscountCol?: boolean
    /** Show the Tax row in the totals box. Default true (also gated on tax > 0). */
    showTaxCol?: boolean
    /** Show the Unit Qty column. Default true. */
    showUnitCol?: boolean
    /** Show NTN + STRN in the header bill-info box. Default false (legal requirement
     *  for registered Pakistani businesses; opt-in to avoid clutter for retail shops). */
    showNtnStrn?: boolean
    /** Custom footer terms text, replaces the hardcoded "1. Damage and expiry...
     *  2. Plz Count Cash Before Leave Counter." default. Newlines preserved. */
    footerText?: string
    /** Invoice number display prefix (e.g. "INV-"). Prepended to the UUID short-id so
     *  receipts show "INV-B804DCB7" instead of bare "B804DCB7". */
    invoicePrefix?: string
    /** SET-M6: how to format every date on the print. "DD/MM/YYYY" (Pakistani default),
     *  "MM/DD/YYYY", or "YYYY-MM-DD". Falls back to DD/MM/YYYY when unset. */
    dateFormat?: string
    /** SET-M4: number of NCR thermal receipt copies printed per sale. Clamped 1-3 server-side.
     *  A4 ignores this (each tab = one document). */
    receiptCopyCount?: number
    /** SET-M14: when "Inclusive", the print template shows "Includes tax: X" instead of a
     *  separate "+ Tax" row, matching how the price label was displayed in-store. */
    taxMode?: "Exclusive" | "Inclusive"
    /** When true, the print template renders a "Previous Balance" + "Grand Total Payable"
     *  section below the Balance Due row. Driven by the "Show Balance" checkbox in New Sale. */
    showPreBalance?: boolean
  }
  /** Customer's outstanding balance BEFORE this sale — snapshotted at sale time. */
  preBalance?: number
}

// DTOs for creating a POS sale
export interface POSSaleItemInput {
  itemId: string
  quantity: number
  // The effective per-unit price actually charged (after any per-line discount).
  unitPrice: number
  // Optional discount tracking — both fields are stored on sales_invoice_lines so the
  // printed invoice can show the original list price, the discount % and the discount
  // amount as separate columns instead of having the discount silently baked into
  // unitPrice. Leave both undefined when there is no line-level discount.
  originalUnitPrice?: number
  discountAmount?: number
}

export interface POSPaymentInput {
  amount: number
  method: PaymentMethod
  reference?: string
}

export interface CreatePOSSaleInput {
  partyId: string
  items: POSSaleItemInput[]
  taxRate?: number
  discount?: number
  payments?: POSPaymentInput[]
  status?: "Draft" | "Credit" | "Paid" | "Pending"
  /** Snapshotted pre-sale outstanding balance — stored on the invoice for bill printing. */
  preBalance?: number
  /** Whether to print the pre-balance section on the bill. */
  showPreBalance?: boolean
  /** Optional bill reference number entered by cashier — shown in party ledger. */
  referenceNo?: string
}
