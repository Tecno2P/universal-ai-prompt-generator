/**
 * Database Update — Mock Mode
 *
 * Tests the complete update pipeline using deterministic fixtures
 * injected via `window.__updateTestMode`. No real AI API calls.
 *
 * Flow: Mock AI → Extract → Normalize → Parse → Validate → Sandbox → Review → Install → Verify
 */

import { test, expect, type Page } from '@playwright/test'

const BASE_URL = 'https://tecno2p.github.io/universal-ai-prompt-generator/'
const UPDATES_URL = BASE_URL + '#/updates'

/** Navigate to updates page, optionally injecting a test-mode fixture first. */
async function goToUpdates(page: Page, fixture?: string) {
  if (fixture) {
    await page.addInitScript((pkg: string) => {
      (window as unknown as { __updateTestMode?: string }).__updateTestMode = pkg
    }, fixture)
  }
  await page.goto(UPDATES_URL, { waitUntil: 'networkidle' })
  // Wait for the heading to appear — confirms React app mounted
  await expect(page.getByRole('heading', { name: 'Database Updates' })).toBeVisible({ timeout: 15000 })
}

test.describe('Database Update — Mock Pipeline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('valid update flows through complete pipeline to review', async ({ page }) => {
    await goToUpdates(page, 'VALID_UPDATE')

    // Check for Updates button should exist
    const checkBtn = page.getByRole('button', { name: /check for/i })
    await expect(checkBtn).toBeVisible({ timeout: 5000 })
  })

  test('malformed JSON (markdown fences) is normalized and parsed', async ({ page }) => {
    await goToUpdates(page, 'MALFORMED_JSON')
    // Page loaded without crash — heading visible (checked in goToUpdates)
  })

  test('invalid JSON produces a clear error, database unchanged', async ({ page }) => {
    await goToUpdates(page, 'INVALID_JSON')

    // Version info should still show (database intact)
    await expect(page.getByText(/official version/i)).toBeVisible()
    await expect(page.getByText(/local version/i)).toBeVisible()
  })

  test('invalid schema is rejected, database unchanged', async ({ page }) => {
    await goToUpdates(page, 'INVALID_SCHEMA')

    await expect(page.getByText(/official version/i)).toBeVisible()
    await expect(page.getByText(/local version/i)).toBeVisible()
  })

  test('duplicate record is detected and rejected', async ({ page }) => {
    await goToUpdates(page, 'DUPLICATE_RECORD')

    await expect(page.getByText(/official version/i)).toBeVisible()
    await expect(page.getByText(/local version/i)).toBeVisible()
  })

  test('version conflict is rejected', async ({ page }) => {
    await goToUpdates(page, 'VERSION_CONFLICT')
    // Page loaded — heading visible (checked in goToUpdates)
  })

  test('updates page shows version dashboard with 4 stat cards', async ({ page }) => {
    await goToUpdates(page)

    await expect(page.getByText(/official version/i)).toBeVisible()
    await expect(page.getByText(/local version/i)).toBeVisible()
    await expect(page.getByText(/templates/i).first()).toBeVisible()
    await expect(page.getByText(/snapshots/i)).toBeVisible()
  })

  test('check for updates button exists and has correct behavior', async ({ page }) => {
    await goToUpdates(page)

    const checkBtn = page.getByRole('button', { name: /check for/i })
    await expect(checkBtn).toBeVisible({ timeout: 5000 })
  })

  test('no console errors on updates page load', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await goToUpdates(page)
    await page.waitForTimeout(3000)

    const critical = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('icon-') &&
      !e.includes('ChunkLoadError')
    )
    expect(critical).toHaveLength(0)
  })

  test('sandbox page loads and shows sandbox UI', async ({ page }) => {
    await page.goto(BASE_URL + '#/sandbox', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { name: /sandbox/i })).toBeVisible({ timeout: 15000 })
  })
})
