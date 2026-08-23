import { test, expect, type Browser } from '@playwright/test'

const BASE_URL = 'https://tecno2p.github.io/universal-ai-prompt-generator/'

const VIEWPORTS = [
  { name: '360px', width: 360, height: 640 },
  { name: '390px', width: 390, height: 844 },
  { name: '430px', width: 430, height: 932 },
  { name: '768px', width: 768, height: 1024 },
  { name: '1024px', width: 1024, height: 768 },
  { name: '1366px', width: 1366, height: 768 },
  { name: '1920px', width: 1920, height: 1080 },
]

test.describe('Responsive Tests', () => {
  for (const viewport of VIEWPORTS) {
    test(`renders correctly at ${viewport.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport })
      const page = await context.newPage()

      await page.goto(BASE_URL, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1500)

      const bodyText = await page.locator('body').innerText()
      expect(bodyText.length).toBeGreaterThan(0)

      // Check no horizontal overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 10)

      console.log(`${viewport.name}: ${clientWidth}px wide, scroll=${scrollWidth}px`)
      await context.close()
    })
  }
})
