import { test, expect } from '@playwright/test'

const BASE_URL = 'https://tecno2p.github.io/universal-ai-prompt-generator/'

test.describe('Tools Page', () => {
  test('all three tabs are present', async ({ page }) => {
    await page.goto(`${BASE_URL}#/tools`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    await expect(page.getByText('Tools').first()).toBeVisible({ timeout: 15000 })

    // The three tab labels rendered by ToolsPage.tsx.
    await expect(page.getByRole('button', { name: 'Quality Score' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Debugger' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Test Lab' })).toBeVisible()
  })

  test('quality score analysis produces a 0-100 score', async ({ page }) => {
    await page.goto(`${BASE_URL}#/tools`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Default tab is 'score'. Find the prompt textarea by its placeholder.
    const prompt = page.getByPlaceholder(/paste the prompt you want to analyze/i).first()
    await expect(prompt).toBeVisible({ timeout: 15000 })

    await prompt.fill(
      'You are a helpful assistant. Write a detailed marketing copy for a new electric scooter aimed at college students.',
    )

    // Trigger the offline analyzer.
    const analyze = page.getByRole('button', { name: /analyze quality/i }).first()
    await expect(analyze).toBeVisible()
    await analyze.click()

    // A score is rendered as "NN / 100".
    const scoreEl = page.getByText(/\/\s*100/).first()
    await expect(scoreEl).toBeVisible({ timeout: 15000 })
    const scoreText = await scoreEl.innerText()
    const match = scoreText.match(/(\d+)/)
    expect(match).not.toBeNull()
    const score = parseInt(match![1], 10)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  test('debugger tab shows a debug report', async ({ page }) => {
    await page.goto(`${BASE_URL}#/tools`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Enter prompt first (shared input across tabs).
    const prompt = page.getByPlaceholder(/paste the prompt you want to analyze/i).first()
    await prompt.fill('do the thing now fast')

    // Switch to the Debugger tab.
    await page.getByRole('button', { name: 'Debugger' }).click()
    await page.waitForTimeout(500)

    // Run the debug scan.
    const debugBtn = page.getByRole('button', { name: /debug prompt/i }).first()
    await expect(debugBtn).toBeVisible()
    await debugBtn.click()

    // Debug Report card appears.
    await expect(page.getByText('Debug Report').first()).toBeVisible({ timeout: 15000 })
  })

  test('test lab tab exposes provider selection UI', async ({ page }) => {
    await page.goto(`${BASE_URL}#/tools`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Switch to the Test Lab tab.
    await page.getByRole('button', { name: 'Test Lab' }).click()
    await page.waitForTimeout(500)

    // The test lab surface always renders either the provider checklist
    // ("Providers to test") or the empty-state ("No AI providers configured").
    const providerSection = page
      .getByText(/providers to test|no ai providers configured/i)
      .first()
    await expect(providerSection).toBeVisible({ timeout: 15000 })

    // The privacy acknowledgement checkbox + Run button are part of the lab UI.
    await expect(page.getByText(/privacy|acknowledge/i).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /run test lab/i }).first()).toBeVisible()
  })

  test('tabs switch without console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}#/tools`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    // Cycle through every tab and back.
    await page.getByRole('button', { name: 'Debugger' }).click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Test Lab' }).click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Quality Score' }).click()
    await page.waitForTimeout(400)

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
})
