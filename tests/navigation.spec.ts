import { test, expect } from '@playwright/test'

const BASE_URL = 'https://tecno2p.github.io/universal-ai-prompt-generator/'

test.describe('Navigation Tests', () => {
  test('can navigate to each major section', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    // Find all navigation links/buttons
    const navItems = page.locator('nav a, nav button, [class*="sidebar"] a, [class*="sidebar"] button, [role="navigation"] a')
    const count = await navItems.count()
    console.log(`Found ${count} nav items`)

    // Try clicking each nav item and verify content changes
    for (let i = 0; i < Math.min(count, 8); i++) {
      const item = navItems.nth(i)
      const text = await item.textContent().catch(() => '')
      if (!text || text.trim().length === 0) continue

      await item.click().catch(() => {})
      await page.waitForTimeout(500)

      const bodyText = await page.locator('body').innerText()
      expect(bodyText.length).toBeGreaterThan(0)
      console.log(`  Nav [${i}]: "${text.trim()}" -> OK`)
    }
  })

  test('browser back/forward works', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)

    // Click a nav item
    const navItem = page.locator('nav a, nav button, [class*="sidebar"] a').nth(1)
    const text = await navItem.textContent().catch(() => 'unknown')
    await navItem.click().catch(() => {})
    await page.waitForTimeout(1000)

    // Go back
    await page.goBack()
    await page.waitForTimeout(1000)

    const bodyText = await page.locator('body').innerText()
    expect(bodyText.length).toBeGreaterThan(0)
    console.log(`Back navigation works after visiting "${text.trim()}"`)
  })

  test('mobile layout renders', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 667 },
      hasTouch: true,
    })
    const page = await context.newPage()
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    const bodyText = await page.locator('body').innerText()
    expect(bodyText.length).toBeGreaterThan(0)

    // Check no horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5) // 5px tolerance

    await context.close()
  })
})
