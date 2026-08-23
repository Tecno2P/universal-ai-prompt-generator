import { test, expect } from '@playwright/test'

const BASE_URL = 'https://tecno2p.github.io/universal-ai-prompt-generator/'

test.describe('Update System Flow', () => {
  test('updates page loads with version info', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE_URL}#/updates`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Page title renders
    await expect(page.getByText('Database Updates').first()).toBeVisible({ timeout: 15000 })

    // Version dashboard renders with the official + local version labels
    await expect(page.getByText('Official Version').first()).toBeVisible()
    await expect(page.getByText('Local Version').first()).toBeVisible()

    // No critical console errors (filter known icon/manifest noise)
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

  test('Check for Updates button is present', async ({ page }) => {
    await page.goto(`${BASE_URL}#/updates`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // The check button is rendered (label is "Check for AI Updates" in English locale).
    // Use a role/text search that tolerates the loading state showing "...".
    const checkButton = page.getByRole('button', { name: /check for/i }).first()
    await expect(checkButton).toBeVisible({ timeout: 15000 })
  })

  test('Check for Updates button is disabled when no AI provider configured', async ({ page }) => {
    await page.goto(`${BASE_URL}#/updates`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)

    // The button is only enabled when hasAI && providers.length > 0. On a fresh
    // browser context (no saved provider) the button should be disabled OR, if
    // it is clickable, it surfaces the "requires a configured provider" notice.
    const checkButton = page.getByRole('button', { name: /check for/i }).first()

    // Capture the body text to detect the "require AI" hint regardless of state.
    const bodyText = await page.locator('body').innerText()

    // Either the button is disabled, or the requireAI hint is shown somewhere on the page.
    // (The hint is rendered inline when !hasAI and also fires as a toast on click.)
    const buttonDisabled = await checkButton.isDisabled().catch(() => false)
    const hintPresent = /require.*provider|configured provider/i.test(bodyText)

    expect(buttonDisabled || hintPresent).toBeTruthy()
  })

  test('sandbox page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE_URL}#/sandbox`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    await expect(page.getByText('AI Update Sandbox').first()).toBeVisible({ timeout: 15000 })
    // Sandbox exposes a version display + template count.
    await expect(page.getByText('Base Version').first()).toBeVisible()

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

  test('database health page loads and shows a score', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE_URL}#/database-health`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)

    await expect(page.getByText('Database Health').first()).toBeVisible({ timeout: 15000 })

    // The health score is rendered as "NN / 100" (0-100).
    const scoreText = await page.getByText(/\/\s*100/).first().innerText().catch(() => '')
    const match = scoreText.match(/(\d+)/)
    expect(match).not.toBeNull()
    const score = parseInt(match![1], 10)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)

    // Scan Again control is present.
    await expect(page.getByRole('button', { name: /scan again/i }).first()).toBeVisible()

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

  test('diagnostics page loads', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${BASE_URL}#/diagnostics`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    await expect(page.getByText('Diagnostics').first()).toBeVisible({ timeout: 15000 })
    // Error log + update channel sections render.
    await expect(page.getByText('Error Log').first()).toBeVisible()
    await expect(page.getByText('Update Channel').first()).toBeVisible()

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

  test('complete update-system navigation flow', async ({ page }) => {
    // Walk the full toolchain in order: updates -> sandbox -> database-health -> diagnostics
    await page.goto(`${BASE_URL}#/updates`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await expect(page.getByText('Database Updates').first()).toBeVisible({ timeout: 15000 })

    await page.goto(`${BASE_URL}#/sandbox`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await expect(page.getByText('AI Update Sandbox').first()).toBeVisible({ timeout: 15000 })

    await page.goto(`${BASE_URL}#/database-health`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await expect(page.getByText('Database Health').first()).toBeVisible({ timeout: 15000 })

    await page.goto(`${BASE_URL}#/diagnostics`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    await expect(page.getByText('Diagnostics').first()).toBeVisible({ timeout: 15000 })

    // Browser back returns to database-health
    await page.goBack()
    await page.waitForTimeout(1500)
    await expect(page.getByText('Database Health').first()).toBeVisible({ timeout: 15000 })
  })
})
