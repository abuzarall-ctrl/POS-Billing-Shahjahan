import { test, expect } from "@playwright/test"
import { login, searchAndReadStock, addCurrentItem, selectWalkIn } from "./helpers"

/**
 * R2-C1 verification — Drafts must NOT decrement stock.
 *
 * Flow:
 *   1. Login.
 *   2. Open /pos, pick any item, note its stock from the dropdown.
 *   3. Add it with qty 1, select Walk-in customer, click Draft.
 *   4. Open /pos again, search the same item — stock should be UNCHANGED.
 *   5. Capture screenshots at each step.
 *
 * Pass criterion: stock_after == stock_before. Anything else = R2-C1 broken.
 */
test("R2-C1: Draft does not decrement stock", async ({ page }) => {
  await login(page)

  // --- Step 1: Record initial stock ---
  await page.goto("/pos")
  await page.waitForLoadState("networkidle").catch(() => {})

  // Pick any item that has stock — search with empty query won't open dropdown, so use a
  // common single letter. The screenshots showed an item starting with one of the common
  // Pakistani SKUs; we'll just take whatever comes first.
  const before = await searchAndReadStock(page, "a")
  console.log(`[R2-C1] BEFORE — ${before.fullLabel}, parsed stock=${before.stock}`)
  await page.screenshot({ path: "tests/e2e/_screenshots/r2c1-01-item-selected.png", fullPage: true })

  // --- Step 2: Add the item, save as Draft ---
  await addCurrentItem(page, 1)
  await selectWalkIn(page)
  await page.screenshot({ path: "tests/e2e/_screenshots/r2c1-02-cart-with-item.png", fullPage: true })

  // The "Draft" button is the secondary action next to Complete Sale.
  const draftBtn = page.locator('button:has-text("Draft")').first()
  await draftBtn.click()

  // Wait for save: the "Draft saved" toast OR the lastInvoiceId banner appears.
  await page.waitForSelector('text=/Draft saved/i, text=/Invoice:/i', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500) // let revalidate complete
  await page.screenshot({ path: "tests/e2e/_screenshots/r2c1-03-after-draft-save.png", fullPage: true })

  // --- Step 3: Re-search same item, read stock again ---
  // Navigate fresh to bust any client-side cached prop. The page is a server component so
  // a fresh visit re-fetches inventory from Supabase.
  await page.goto("/pos")
  await page.waitForLoadState("networkidle").catch(() => {})

  // We need to find THE SAME item we picked before — match on the prefix of the name.
  // `before.fullLabel` starts with "ItemName (Stock: …)". Pull out the item name.
  const namePart = before.fullLabel.split("(Stock:")[0].trim().slice(0, 8)
  const after = await searchAndReadStock(page, namePart)
  console.log(`[R2-C1] AFTER — ${after.fullLabel}, parsed stock=${after.stock}`)
  await page.screenshot({ path: "tests/e2e/_screenshots/r2c1-04-after-recheck.png", fullPage: true })

  // --- Assertion ---
  console.log(`[R2-C1] Result: before=${before.stock} after=${after.stock} delta=${after.stock - before.stock}`)
  expect(after.stock, "Stock must be unchanged after saving a Draft (R2-C1)").toBe(before.stock)
})
