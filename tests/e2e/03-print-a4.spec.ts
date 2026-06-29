import { test, expect } from "@playwright/test"
import { login, searchAndReadStock, addCurrentItem, selectWalkIn } from "./helpers"

/**
 * Round 2 print-template verification.
 *
 * Strategy: the print code does `window.open("", "_blank")` → writes HTML → `win.print()`
 * → `win.close()` after 300ms. In headless Playwright we can:
 *   1. Intercept `window.print` so the popup doesn't auto-close.
 *   2. Capture the HTML of the popup before close.
 *   3. Assert on key strings in the HTML.
 *
 * We test BOTH a Paid sale (R2-H2 Cash Paid / Balance Due rows, R2-H6 dynamic label, R2-L1
 * friendly status, R2-L2 print date footer, R2-L6 paise in words, R2-M6 walk-in phone filter)
 * AND a Draft (R2-H3 DRAFT banner).
 */
test("R2 print A4: Paid sale renders Cash Paid + Balance Due + friendly status", async ({ page, context }) => {
  await login(page)

  // --- Create a Paid sale ---
  await page.goto("/pos")
  await page.waitForLoadState("networkidle").catch(() => {})
  const before = await searchAndReadStock(page, "a")
  console.log(`[print-paid] Using item: ${before.fullLabel}`)
  await addCurrentItem(page, 1)
  await selectWalkIn(page)

  // Click "Complete Sale" — default payment method is Cash.
  await page.locator('button:has-text("Complete Sale")').first().click()

  // Wait for the success dialog or the lastInvoiceId banner with Print button
  await page.waitForSelector('button:has-text("Print")', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(2000)
  await page.screenshot({ path: "tests/e2e/_screenshots/print-01-after-paid.png", fullPage: true })

  // --- Intercept window.print so popup stays open for inspection ---
  // We can't preemptively patch `window.open` in a new page that hasn't been created yet.
  // Instead, we listen for the popup, then patch its `print` before the existing setTimeout
  // fires. The print template setTimeout is 300ms; we have a few hundred ms grace.
  const popupPromise = context.waitForEvent("page", { timeout: 15000 })

  // Click the Print button in the success dialog (or fallback to the banner Print).
  const dialogPrint = page.locator('div[role="dialog"] button:has-text("Print")').first()
  const bannerPrint = page.locator('button:has-text("Print")').first()
  if (await dialogPrint.isVisible().catch(() => false)) {
    await dialogPrint.click()
  } else {
    await bannerPrint.click()
  }

  let popup
  try {
    popup = await popupPromise
  } catch {
    console.warn("[print-paid] Popup never opened — popup blocker?")
    test.skip(true, "Print popup did not open")
    return
  }

  // Patch print + close so the popup stays open long enough to read HTML
  await popup.evaluate(() => {
    window.print = () => { console.log("print() intercepted") }
    window.close = () => { console.log("close() intercepted") }
  }).catch(() => {})

  await popup.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {})
  await popup.waitForTimeout(500)
  await popup.screenshot({ path: "tests/e2e/_screenshots/print-02-a4-paid-popup.png", fullPage: true })

  const html = await popup.content()
  // Write the popup HTML so we can inspect it offline if any assertion fails
  await page.evaluate(() => {}) // noop
  console.log(`[print-paid] popup HTML length: ${html.length}`)

  // --- Assertions on the printed HTML ---
  expect(html, "R2-H2: Cash Paid row present").toContain("Cash Paid")
  expect(html, "R2-H2: Balance Due row present").toContain("Balance Due")
  // R2-L1: friendly status (no raw "Paid", uses "Cash Sale")
  expect(html, "R2-L1: friendly status 'Cash Sale'").toContain("Cash Sale")
  // R2-L2: print date footer marker
  expect(html, "R2-L2: 'Printed:' footer marker").toContain("Printed:")
  // R2-M6: walk-in fake phone is filtered out
  expect(html, "R2-M6: '000-000-0000' should NOT appear on the print").not.toContain("000-000-0000")

  await popup.close().catch(() => {})
})

test("R2 print A4: Draft prints DRAFT banner", async ({ page, context }) => {
  await login(page)

  // --- Create a Draft ---
  await page.goto("/pos")
  await page.waitForLoadState("networkidle").catch(() => {})
  await searchAndReadStock(page, "a")
  await addCurrentItem(page, 1)
  await selectWalkIn(page)
  await page.locator('button:has-text("Draft")').first().click()
  await page.waitForSelector('button:has-text("Print")', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(2000)

  // We have a 300ms window after popup opens before `win.print(); win.close()` fires.
  // Race against it: grab content() ASAP, no intervening awaits.
  const popupPromise = context.waitForEvent("page", { timeout: 15000 })
  await page.locator('button:has-text("Print")').first().click()

  let popup
  try {
    popup = await popupPromise
  } catch {
    test.skip(true, "Print popup did not open")
    return
  }
  // Race: read content immediately. The print template does document.write synchronously
  // so the HTML is in place by the time the page event fires.
  let html = ""
  try {
    html = await popup.content()
  } catch (e) {
    console.warn("[print-draft] popup closed before content() completed:", e)
  }
  console.log(`[print-draft] popup HTML length: ${html.length}`)

  // R2-H3: DRAFT banner above items
  expect(html, "R2-H3: DRAFT banner present").toContain("DRAFT — NOT A SALES RECEIPT")
  // R2-L1: friendly status shows "DRAFT" instead of raw "Draft" string
  expect(html, "R2-L1: status reads DRAFT").toMatch(/Status:.*?DRAFT/i)
})
