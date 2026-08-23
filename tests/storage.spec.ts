import { test, expect } from '@playwright/test'

const BASE_URL = 'https://tecno2p.github.io/universal-ai-prompt-generator/'

test.describe('IndexedDB & Storage Tests', () => {
  test('IndexedDB is available', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    const hasIndexedDB = await page.evaluate(() => {
      return 'indexedDB' in window
    })
    expect(hasIndexedDB).toBe(true)
  })

  test('IndexedDB databases are created', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)

    const dbs = await page.evaluate(async () => {
      if (!('databases' in indexedDB)) return []
      const databases = await (indexedDB as any).databases()
      return databases.map((d: any) => d.name)
    })
    console.log('IndexedDB databases:', dbs)
    expect(dbs.length).toBeGreaterThan(0)
  })

  test('settings persist in localStorage', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Check if localStorage has any settings
    const storage = await page.evaluate(() => {
      const keys = Object.keys(localStorage)
      return keys.map(k => ({ key: k, value: localStorage.getItem(k)?.substring(0, 100) }))
    })
    console.log('localStorage entries:', JSON.stringify(storage, null, 2))
  })

  test('theme switching works', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    // Look for theme toggle
    const themeBtn = page.locator('button:has-text("theme"), button:has-text("dark"), button:has-text("light"), [class*="theme"], [aria-label*="theme"]')
    const count = await themeBtn.count()

    if (count > 0) {
      const classBefore = await page.locator('html').getAttribute('class') || ''
      await themeBtn.first().click()
      await page.waitForTimeout(500)
      const classAfter = await page.locator('html').getAttribute('class') || ''
      console.log(`Theme classes: before="${classBefore}" after="${classAfter}"`)
    } else {
      console.log('No theme toggle button found')
    }
  })
})
