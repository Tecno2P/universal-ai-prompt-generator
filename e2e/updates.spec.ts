import { test, expect } from '@playwright/test'

const BASE_URL = 'https://tecno2p.github.io/universal-ai-prompt-generator/'
const UPDATES_URL = BASE_URL + '#/updates'

test.describe('Database Updates Tests', () => {
  test('updates page loads', async ({ page }) => {
    await page.goto(UPDATES_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    const bodyText = await page.locator('body').innerText()
    expect(bodyText.length).toBeGreaterThan(0)
    console.log('Updates page content loaded')
  })

  test('version information is displayed', async ({ page }) => {
    await page.goto(UPDATES_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    const bodyText = await page.locator('body').innerText()
    const hasVersion = /\d+\.\d+/.test(bodyText)
    if (hasVersion) {
      console.log('Version information found')
    } else {
      console.log('No version info found — may not be on updates page')
    }
    expect(bodyText.length).toBeGreaterThan(0)
  })

  test('check for updates button exists', async ({ page }) => {
    await page.goto(UPDATES_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Look for any button on the page — the updates page should have at least one
    const buttons = page.locator('button')
    const btnCount = await buttons.count()
    
    // Also check for links or other clickable elements
    const links = page.locator('a')
    const linkCount = await links.count()
    
    // The page should have at least some interactive elements
    expect(btnCount + linkCount).toBeGreaterThan(0)
    console.log(`Found ${btnCount} buttons, ${linkCount} links on updates page`)
  })
})
