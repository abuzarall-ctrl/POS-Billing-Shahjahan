"use server"

import sql from "@/lib/db"

export async function verifyPartyExists(partyId: string, userId: string): Promise<{ id: string } | null> {
  const rows = await sql`
    SELECT id FROM parties WHERE id = ${partyId} AND user_id = ${userId} LIMIT 1
  `
  return (rows[0] as { id: string }) ?? null
}

export async function verifyMultiplePartiesExist(
  partyIds: string[],
  userId: string
): Promise<{ valid: boolean; partyIds?: string[]; error?: string }> {
  if (!partyIds || partyIds.length === 0) return { valid: false, error: "No party IDs provided" }

  const rows = await sql`
    SELECT id FROM parties WHERE id IN ${sql(partyIds)} AND user_id = ${userId}
  `
  const foundIds = rows.map((r) => r.id as string)
  if (foundIds.length !== partyIds.length) {
    return { valid: false, error: `One or more parties not found. Expected ${partyIds.length}, found ${foundIds.length}` }
  }
  return { valid: true, partyIds: foundIds }
}

export async function getPartyDetails(partyId: string, userId: string) {
  const rows = await sql`
    SELECT id, name, phone, address FROM parties
    WHERE id = ${partyId} AND user_id = ${userId} LIMIT 1
  `
  return rows[0] ?? null
}

export async function partyWithEmailExists(email: string, userId: string, excludeId?: string) {
  const rows = excludeId
    ? await sql`SELECT id FROM parties WHERE email = ${email} AND user_id = ${userId} AND id != ${excludeId} LIMIT 1`
    : await sql`SELECT id FROM parties WHERE email = ${email} AND user_id = ${userId} LIMIT 1`
  return rows.length > 0
}

export async function verifyInvoicePartyOwnership(invoiceId: string, userId: string): Promise<string | null> {
  const rows = await sql`
    SELECT party_id FROM sales_invoices WHERE id = ${invoiceId} AND user_id = ${userId} LIMIT 1
  `
  return (rows[0]?.party_id as string) ?? null
}

export async function verifyPurchasePartyOwnership(purchaseId: string, userId: string): Promise<string | null> {
  const rows = await sql`
    SELECT party_id FROM purchase_invoices WHERE id = ${purchaseId} AND user_id = ${userId} LIMIT 1
  `
  return (rows[0]?.party_id as string) ?? null
}
