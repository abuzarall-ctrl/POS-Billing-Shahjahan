import sql from "@/lib/db"

type InvoiceKind = "sales" | "purchase"

interface RecalcParams {
  invoiceId: string
  invoiceTotal: number
  userId: string
  allowDraftWhenZero: boolean
}

const TABLE_FOR_KIND: Record<
  InvoiceKind,
  { invoiceTable: string; paymentsTable: string; fkColumn: string; partialStatus: string }
> = {
  sales: {
    invoiceTable: "sales_invoices",
    paymentsTable: "payments",
    fkColumn: "invoice_id",
    partialStatus: "Pending",
  },
  purchase: {
    invoiceTable: "purchase_invoices",
    paymentsTable: "purchase_payments",
    fkColumn: "purchase_invoice_id",
    partialStatus: "Partially Paid",
  },
}

export async function recalcInvoicePaymentStatus(
  kind: InvoiceKind,
  params: RecalcParams,
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const { invoiceTable, paymentsTable, fkColumn, partialStatus } = TABLE_FOR_KIND[kind]

  const payments = await sql`
    SELECT amount FROM ${sql(paymentsTable)}
    WHERE ${sql(fkColumn)} = ${params.invoiceId} AND user_id = ${params.userId}
  `

  const totalPaidCents = Math.round(
    payments.reduce((sum, p) => sum + Number(p.amount || 0), 0) * 100,
  )
  const invoiceTotalCents = Math.round(Number(params.invoiceTotal || 0) * 100)

  let status: string
  if (params.allowDraftWhenZero && totalPaidCents <= 0) {
    status = "Draft"
  } else if (totalPaidCents >= invoiceTotalCents) {
    status = "Paid"
  } else {
    status = partialStatus
  }

  await sql`
    UPDATE ${sql(invoiceTable)}
    SET status = ${status}
    WHERE id = ${params.invoiceId} AND user_id = ${params.userId}
  `
  return { ok: true, status }
}
