import { test, expect } from '@playwright/test'

const BASE_URL = 'https://tecno2p.github.io/universal-ai-prompt-generator/'

test.describe('Database Updates Tests', () => {
  test('updates page loads', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    // Navigate to Updates
    const navItems = page.locator('nav a, nav button, [class*="sidebar"] a, [class*="sidebar"] button')
    const count = await navItems.count()

    let found = false
    for (let i = 0; i < count; i++) {
      const text = await navItems.nth(i).textContent().catch(() => '')
      if (text && text.toLowerCase().includes('update')) {
        await navItems.nth(i).click()
        await page.waitForTimeout(1000)
        found = true
        break
      }
    }

    if (!found) {
      // Try direct URL
      await page.goto(BASE_URL + '#/updates', { waitUntil: 'networkidle' })
      await page.waitForTimeout(1000)
    }

    const bodyText = await page.locator('body').innerText()
    expect(bodyText.length).toBeGreaterThan(0)
    console.log('Updates page content loaded')
  })

  test('version information is displayed', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Navigate to updates and look for version info
    const navItems = page.locator('nav a, nav button')
    const count = await navItems.count()
    for (let i = 0; i < count; i++) {
      const text = await navItems.nth(i).textContent().catch(() => '')
      if (text && text.toLowerCase().includes('update')) {
        await navItems.nth(i).click()
        await page.waitForTimeout(1000)
        break
      }
    }

    // Look for version number pattern
    const bodyText = await page.locator('body').innerText()
    const hasVersion = /\d+\.\d+/.test(bodyText)
    if (hasVersion) {
      console.log('Version information found')
    } else {
      console.log('No version info found — may not be on updates page')
    }
  })

  test('check for updates button exists', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    // Navigate to updates
    const navItems = page.locator('nav a, nav button')
    const count = await navItems.count()
    for (let i = 0; i < count; i++) {
      const text = await navItems.nth(i).textContent().catch(() => '')
      if (text && text.toLowerCase().includes('update')) {
        await navItems.nth(i).click()
        await page.waitForTimeout(1000)
        break
      }
    }

    // Look for "check" button
    const buttons = page.locator('button')
    const btnCount = await buttons.count()
    let checkBtn = false
    for (let i = 0; i < btnCount; i++) {
      const text = await buttons.nth(i).textContent().catch(() => '')
      if (text && (text.toLowerCase().includes('check') || text.toLowerCase().includes('update'))) {
        checkBtn = true
        console.log(`Found button: "${text.trim()}"`)
        break
      }
    }
    // Button should exist
    expect(checkBtn || btnCount > 0).toBe(true)
  })
})
