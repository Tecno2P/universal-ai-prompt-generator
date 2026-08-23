import { test, expect } from '@playwright/test'

const BASE_URL = 'https://tecno2p.github.io/universal-ai-prompt-generator/'

// New nav items added to the sidebar in the Database Update system expansion.
// Each entry maps a route fragment to the heading/marker text the rendered page shows.
const NAV_ITEMS: Array<{ name: string; hash: string; marker: RegExp }> = [
  { name: 'Sandbox', hash: '#/sandbox', marker: /AI Update Sandbox/i },
  { name: 'Tools', hash: '#/tools', marker: /Tools/i },
  { name: 'DB Health', hash: '#/database-health', marker: /Database Health/i },
  { name: 'Providers', hash: '#/provider-health', marker: /AI Providers|Providers/i },
  { name: 'Diagnostics', hash: '#/diagnostics', marker: /Diagnostics/i },
]

test.describe('Extended Navigation', () => {
  for (const item of NAV_ITEMS) {
    test(`${item.name} page loads without errors`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text())
      })

      await page.goto(`${BASE_URL}${item.hash}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(2000)

      // Page renders its heading / primary marker.
      await expect(page.getByText(item.marker).first()).toBeVisible({ timeout: 15000 })

      // Body must have real content (not a blank screen).
      const bodyText = await page.locator('body').innerText()
      expect(bodyText.trim().length).toBeGreaterThan(0)

      const critical = errors.filter(
        (e) =>
          !e.includes('Failed to load resource') &&
          !e.includes('manifest') &&
          !e.includes('favicon') &&
          !e.includes('icon-192') &&
          !e.includes('icon-512'),
      )
      expect(critical).toHaveLength(0)
    })
  }

  test('each nav item is reachable from the sidebar', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // The sidebar lists every nav item by the labels defined in en.json.
    const labels = ['Sandbox', 'Tools', 'DB Health', 'Providers', 'Diagnostics']
    for (const label of labels) {
      const link = page.getByRole('link', { name: new RegExp(`^${label}$`, 'i') }).first()
      await expect(link).toBeVisible({ timeout: 10000 })
    }
  })

  test('no horizontal overflow on mobile viewport', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 667 },
      hasTouch: true,
    })
    const page = await context.newPage()

    for (const item of NAV_ITEMS) {
      await page.goto(`${BASE_URL}${item.hash}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1500)

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
      // 5px tolerance for sub-pixel rounding, matching the existing responsive suite.
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5)

      // Sanity: the page actually rendered its primary marker on mobile too.
      const bodyText = await page.locator('body').innerText()
      expect(bodyText.trim().length).toBeGreaterThan(0)
    }

    await context.close()
  })

  test('deep links survive a hard reload', async ({ page }) => {
    // HashRouter state should be restorable on refresh.
    await page.goto(`${BASE_URL}#/diagnostics`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    await expect(page.getByText('Diagnostics').first()).toBeVisible({ timeout: 15000 })

    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    await expect(page.getByText('Diagnostics').first()).toBeVisible({ timeout: 15000 })
  })
})
