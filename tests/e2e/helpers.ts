import { Page, expect } from "@playwright/test"

export const EMAIL = process.env.E2E_EMAIL || "shahjahan.pos@store.com"
export const PASSWORD = process.env.E2E_PASSWORD || "shahjahan@786"

/**
 * Log in via the form on /login. After auth, waits until the URL is no longer /login.
 * Throws if login fails.
 */
export async function login(page: Page) {
  await page.goto("/login")
  await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL)
  await page.locator('input[type="password"], input[name="password"]').first().fill(PASSWORD)
  await page.locator(
    'button[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("Log in")',
  ).first().click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000 })
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {})
  // Dismiss the cookie banner if it appears so it doesn't block clicks later.
  const acceptBtn = page.locator('button:has-text("Accept"), button:has-text("Accept All")').first()
  if (await acceptBtn.isVisible().catch(() => false)) {
    await acceptBtn.click().catch(() => {})
  }
}

/**
 * Search for an inventory item by name on the POS page, click the first match, and return
 * its current stock as parsed from the dropdown label (format: "ItemName (Stock: N)" or
 * "ItemName (Stock: N / X CTN)").
 *
 * Pre-condition: must be on /pos with the form visible.
 */
export async function searchAndReadStock(page: Page, itemQuery: string): Promise<{
  fullLabel: string
  stock: number
}> {
  const itemInput = page.locator('input[placeholder*="Search item"]').first()
  await itemInput.waitFor({ state: "visible", timeout: 10000 })
  await itemInput.click()
  await itemInput.fill("")
  await itemInput.fill(itemQuery)
  // Wait for dropdown
  await page.waitForTimeout(500)
  const firstResult = page.locator('button:has-text("Stock:")').first()
  await firstResult.waitFor({ state: "visible", timeout: 5000 })
  const fullLabel = (await firstResult.textContent()) || ""
  // Parse "Stock: 1234" out of the label
  const match = fullLabel.match(/Stock:\s*([0-9.,]+)/)
  if (!match) throw new Error(`Cannot parse stock from: ${fullLabel}`)
  const stock = Number(match[1].replace(/,/g, ""))
  await firstResult.click()
  return { fullLabel, stock }
}

/**
 * Set the quantity field on the POS form, click Add.
 */
export async function addCurrentItem(page: Page, quantity: number) {
  const qtyInput = page.locator('input[aria-label="Unit quantity"]').first()
  await qtyInput.fill(String(quantity))
  await page.locator('button:has-text("Add")').first().click()
}

/**
 * Read the cart's current line count.
 */
export async function cartLineCount(page: Page): Promise<number> {
  // The cart appears only after the first item is added. Each row sits in tbody > tr.
  const rows = page.locator("table tbody tr")
  return await rows.count().catch(() => 0)
}

/**
 * Select Walk-in customer if no customer is selected. Idempotent.
 */
export async function selectWalkIn(page: Page) {
  const walkInBtn = page.locator('button:has-text("+ Walk-in"), button:has-text("Walk-in Customer")').first()
  if (await walkInBtn.isVisible().catch(() => false)) {
    await walkInBtn.click().catch(() => {})
  }
}
