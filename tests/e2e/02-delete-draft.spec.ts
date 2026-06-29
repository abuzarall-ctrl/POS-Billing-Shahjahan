import { test, expect } from "@playwright/test"
import { login, searchAndReadStock, addCurrentItem, selectWalkIn } from "./helpers"

/**
 * R2-C2 verification — `deletePOSDraft` removes the Draft and (for legacy Drafts that
 * decremented stock) restores stock. For *new* Drafts (post R2-C1) there's nothing to
 * restore — stock should already match before AND after delete.
 *
 * Flow:
 *   1. Login → /pos.
 *   2. Note stock of an item.
 *   3. Create a Draft with qty 2 of that item.
 *   4. Stock should still be unchanged (R2-C1).
 *   5. Go to /pos/sales, find that Draft (newest), click the Trash icon.
 *   6. Confirm the delete dialog.
 *   7. Draft row should disappear.
 *   8. Stock should still be unchanged (no over-restore by R2-C2 for new drafts).
 */
test("R2-C2: deletePOSDraft removes draft + preserves stock", async ({ page }) => {
  await login(page)

  // --- Step 1: read initial stock ---
  await page.goto("/pos")
  await page.waitForLoadState("networkidle").catch(() => {})
  const before = await searchAndReadStock(page, "a")
  console.log(`[R2-C2] BEFORE — ${before.fullLabel}, stock=${before.stock}`)
  await page.screenshot({ path: "tests/e2e/_screenshots/r2c2-01-before.png", fullPage: true })

  // --- Step 2: create the Draft ---
  await addCurrentItem(page, 2)
  await selectWalkIn(page)
  await page.locator('button:has-text("Draft")').first().click()
  await page.waitForSelector('text=/Draft saved/i, text=/Invoice:/i', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await page.screenshot({ path: "tests/e2e/_screenshots/r2c2-02-draft-saved.png", fullPage: true })

  // --- Step 3: go to Sales list, find the new Draft ---
  await page.goto("/pos/sales")
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.screenshot({ path: "tests/e2e/_screenshots/r2c2-03-sales-list.png", fullPage: true })

  // The newest Draft will be the top row whose status badge says "Draft". Find that row's
  // Trash button. The sales-list component renders the trash icon only for Draft rows
  // (gated on `sale.status === "Draft"`).
  const draftRow = page.locator('tr', { has: page.locator('text=/^Draft$/') }).first()
  await expect(draftRow, "At least one Draft row must exist after saving").toBeVisible({ timeout: 10000 })

  // Capture the invoice short-ID from the row so we can verify it disappears.
  const invoiceShort = (await draftRow.locator("td").first().textContent())?.trim() ?? ""
  console.log(`[R2-C2] Targeting Draft ${invoiceShort} for delete`)

  // Set up a dialog handler before clicking — the delete UI uses window.confirm/alert.
  page.on("dialog", (d) => d.accept())

  // The Trash button is in the last cell. We match by title attribute to be unambiguous.
  const trashBtn = draftRow.locator('button[title*="Delete"], button[title*="delete"]').first()
  // Fallback: last button in the row
  const fallbackBtn = draftRow.locator("button").last()
  if (await trashBtn.count() > 0 && await trashBtn.isVisible().catch(() => false)) {
    await trashBtn.click()
  } else {
    // Hover the action cell to reveal Trash if it's hidden, then click the last button (Trash)
    // — by component order the Trash sits last (after Edit/View/Reprint).
    await fallbackBtn.click()
  }

  // Wait for the row to disappear (revalidation reruns the server query).
  await page.waitForTimeout(3000)
  await page.screenshot({ path: "tests/e2e/_screenshots/r2c2-04-after-delete.png", fullPage: true })

  // Verify the row with that invoiceShort is gone — search the table for the text.
  const stillPresent = await page.locator(`tr:has-text("${invoiceShort}")`).count()
  console.log(`[R2-C2] Rows with invoice ${invoiceShort} after delete: ${stillPresent}`)

  // --- Step 4: re-check stock ---
  await page.goto("/pos")
  await page.waitForLoadState("networkidle").catch(() => {})
  const namePart = before.fullLabel.split("(Stock:")[0].trim().slice(0, 8)
  const after = await searchAndReadStock(page, namePart)
  console.log(`[R2-C2] AFTER  — ${after.fullLabel}, stock=${after.stock}`)

  // --- Assertions ---
  expect(stillPresent, "Draft row should be gone from the sales list after delete").toBe(0)
  expect(after.stock, "Stock must be unchanged (Draft never decremented, delete didn't over-restore)").toBe(before.stock)
})
