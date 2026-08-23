import { test, expect } from '@playwright/test'

const BASE_URL = 'https://tecno2p.github.io/universal-ai-prompt-generator/'
const TOOLS_URL = BASE_URL + '#/tools'

test.describe('Tools Page', () => {
  test('all three tabs are present', async ({ page }) => {
    await page.goto(TOOLS_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    const tabs = ['Quality Score', 'Debugger', 'Test Lab']
    for (const tabName of tabs) {
      const tab = page.getByRole('button', { name: tabName }).or(page.getByText(tabName, { exact: false }))
      await expect(tab.first()).toBeVisible({ timeout: 5000 })
    }
  })

  test('quality score analysis produces a 0-100 score', async ({ page }) => {
    await page.goto(TOOLS_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 10000 })
    await textarea.fill('Create a modern portfolio website with React and Tailwind CSS that showcases my projects and skills with smooth animations and a contact form.')

    const analyzeBtn = page.getByRole('button', { name: /analyze quality/i })
    await expect(analyzeBtn).toBeVisible()
    await analyzeBtn.click()
    await page.waitForTimeout(2000)

    const scoreText = page.getByText(/\/\s*100/)
    await expect(scoreText.first()).toBeVisible({ timeout: 10000 })
    console.log('Quality score displayed')
  })

  test('debugger tab shows a debug report', async ({ page }) => {
    await page.goto(TOOLS_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Switch to Debugger tab
    const debugTab = page.getByRole('button', { name: 'Debugger' }).or(page.getByText('Debugger', { exact: false }))
    await debugTab.first().click()
    await page.waitForTimeout(1000)

    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 5000 })
    await textarea.fill('Make it good please')

    const debugBtn = page.getByRole('button', { name: /debug prompt/i })
    await expect(debugBtn).toBeVisible()
    await debugBtn.click()
    await page.waitForTimeout(2000)

    // Check for debug report content
    const report = page.getByText(/debug report|issue|severity|vague|missing/i)
    await expect(report.first()).toBeVisible({ timeout: 10000 })
    console.log('Debug report displayed')
  })

  test('test lab tab shows provider selection or empty state', async ({ page }) => {
    await page.goto(TOOLS_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Switch to Test Lab tab
    const labTab = page.getByRole('button', { name: 'Test Lab' }).or(page.getByText('Test Lab', { exact: false }))
    await labTab.first().click()
    await page.waitForTimeout(1000)

    // The tab should show either provider selection UI OR an empty state message
    // Look for any of: "provider", "test lab", "privacy", "no provider", "run test"
    const labContent = page.getByText(/provider|test lab|privacy|acknowledge|no.*provider|run test/i)
    await expect(labContent.first()).toBeVisible({ timeout: 10000 })
    console.log('Test Lab tab content loaded')
  })

  test('tabs switch without console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(TOOLS_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Cycle through all tabs
    const tabs = ['Quality Score', 'Debugger', 'Test Lab']
    for (const tabName of tabs) {
      const tab = page.getByRole('button', { name: tabName }).or(page.getByText(tabName, { exact: false }))
      await tab.first().click()
      await page.waitForTimeout(500)
    }

    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') && !e.includes('icon-')
    )
    expect(criticalErrors).toHaveLength(0)
    console.log('Tab switching completed without errors')
  })
})
