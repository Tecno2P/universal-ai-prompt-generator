import { test, expect, type Page } from '@playwright/test'

const BASE_URL = 'https://tecno2p.github.io/universal-ai-prompt-generator/'

test.describe('Smoke Tests', () => {
  test('page loads without blank screen', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(2000)

    // Check page is not blank
    const bodyText = await page.locator('body').innerText()
    expect(bodyText.length).toBeGreaterThan(0)

    // Check root element has content
    const rootHTML = await page.locator('#root').innerHTML()
    expect(rootHTML.length).toBeGreaterThan(100)
  })

  test('no critical console errors on load', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        errors.push(msg.text())
      }
    })
    page.on('pageerror', (e) => errors.push(`PAGE ERROR: ${e.message}`))

    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)

    // Filter out known non-critical errors
    const criticalErrors = errors.filter(e =>
      !e.includes('Failed to load resource') &&
      !e.includes('manifest') &&
      !e.includes('favicon') &&
      !e.includes('icon-192') &&
      !e.includes('icon-512')
    )
    expect(criticalErrors).toHaveLength(0)
  })

  test('main heading is visible', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
    // Look for any heading text
    const heading = page.locator('h1, h2, [class*="title"], [class*="heading"]').first()
    await expect(heading).toBeVisible({ timeout: 10000 })
  })

  test('navigation works', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)
    // Look for nav elements
    const navLinks = page.locator('nav a, nav button, [class*="nav"] a, [class*="nav"] button')
    const count = await navLinks.count()
    expect(count).toBeGreaterThan(0)
  })
})
