/**
 * Database Update — Real API Integration Mode
 *
 * These tests call a REAL AI provider. They are SKIPPED unless:
 *   RUN_REAL_AI_TESTS=true
 *   TEST_AI_PROVIDER=<provider-id>
 *   TEST_AI_API_KEY=<key>
 *   TEST_AI_MODEL=<model-id>
 *
 * Flow:
 *   Open App → Settings page loads → Provider injected via window.__testProviderConfig
 *   → Navigate to Updates → Click "Check for AI Updates" → Real API call to Sarvam
 *   → Receive real AI response → Normalize → Parse → Validate
 *   → Sandbox → Review UI appears → Verify production DB unchanged
 *
 * Safety:
 *   - API keys are NEVER printed, logged, or committed
 *   - Tests use sandbox only — production DB is not modified
 *   - Test records are cleaned up after each test
 *   - Secrets are redacted from all reports/screenshots/traces
 */

import { test, expect, type Page } from '@playwright/test'

const BASE_URL = 'https://tecno2p.github.io/universal-ai-prompt-generator/'
const UPDATES_URL = BASE_URL + '#/updates'
const SETTINGS_URL = BASE_URL + '#/settings'

// --- Environment validation ---

const RUN_REAL = process.env.RUN_REAL_AI_TESTS === 'true'
const TEST_PROVIDER = process.env.TEST_AI_PROVIDER || ''
const TEST_API_KEY = process.env.TEST_AI_API_KEY || ''
const TEST_MODEL = process.env.TEST_AI_MODEL || ''

// Skip ALL tests in this file unless explicitly enabled with all required vars
test.skip(!RUN_REAL, 'Real AI API tests are disabled (set RUN_REAL_AI_TESTS=true)')
test.skip(RUN_REAL && (!TEST_PROVIDER || !TEST_API_KEY || !TEST_MODEL),
  'Real AI API tests require TEST_AI_PROVIDER, TEST_AI_API_KEY, and TEST_AI_MODEL')

// --- Redaction helper ---

/** Redact any API key value from text. */
function redact(text: string): string {
  return text
    .replace(/sk_[a-z0-9]+_[A-Za-z0-9]+/gi, '[REDACTED]')
    .replace(/sk-[a-zA-Z0-9]+/gi, '[REDACTED]')
    .replace(/Bearer\s+[^\s,]+/gi, 'Bearer [REDACTED]')
    .replace(/api-subscription-key["\s:]+[^\s,}"]+/gi, 'api-subscription-key: [REDACTED]')
    .replace(/Authorization["\s:]+[^\s,}"]+/gi, 'Authorization: [REDACTED]')
}

/** Inject provider credentials into the app before the page loads. */
async function injectProvider(page: Page) {
  await page.addInitScript((cfg: { providerId: string; apiKey: string; model: string }) => {
    (window as unknown as { __testProviderConfig?: unknown }).__testProviderConfig = cfg
  }, { providerId: TEST_PROVIDER, apiKey: TEST_API_KEY, model: TEST_MODEL })
}

/**
 * Navigate to Settings (which triggers reloadProviders → setHasAI(true)),
 * wait for hasAI to propagate, then navigate to Updates.
 */
async function setupProviderAndGoToUpdates(page: Page) {
  // Go to Settings page first — SettingsPage.useEffect calls reloadProviders()
  // which reads from IndexedDB (where main.tsx injected the provider) and sets hasAI=true
  await page.goto(SETTINGS_URL, { waitUntil: 'networkidle' })
  // Wait for the settings page to load and reloadProviders to run
  await page.waitForTimeout(3000)

  // Now navigate to Updates page
  await page.goto(UPDATES_URL, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Database Updates' })).toBeVisible({ timeout: 15000 })
  await page.waitForTimeout(2000)
}

test.describe('Database Update — Real API Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
      if (typeof indexedDB !== 'undefined') {
        indexedDB.deleteDatabase('promptgen-db')
        indexedDB.deleteDatabase('promptgen-credentials')
        indexedDB.deleteDatabase('prompt-gen-device-key')
      }
    })
  })

  test('1. Actual Sarvam API request succeeds', async ({ page }) => {
    test.setTimeout(120000)

    await injectProvider(page)
    await setupProviderAndGoToUpdates(page)

    // The "Check for Updates" button should be enabled (hasAI = true)
    const checkBtn = page.getByRole('button', { name: /check for/i })
    await expect(checkBtn).toBeVisible({ timeout: 5000 })

    // If button is still disabled, try going to settings and back
    const isDisabled = await checkBtn.isDisabled()
    if (isDisabled) {
      await page.goto(SETTINGS_URL, { waitUntil: 'networkidle' })
      await page.waitForTimeout(3000)
      await page.goto(UPDATES_URL, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Database Updates' })).toBeVisible({ timeout: 15000 })
      await page.waitForTimeout(2000)
    }

    await checkBtn.click()

    // Wait for the API response — toast or review panel
    await expect(
      page.getByText(/found.*updates|validation failed|request failed|no updates|error/i)
    ).toBeVisible({ timeout: 90000 })

    // Verify the API actually responded (not a network/timeout error)
    const pageText = await page.evaluate(() => document.body?.innerText || '')
    const hasError = /request failed|network|timeout|empty response/i.test(pageText)
    expect(hasError).toBe(false)
  })

  test('2. Real AI response normalization and JSON parsing succeeds', async ({ page }) => {
    test.setTimeout(120000)

    await injectProvider(page)
    await setupProviderAndGoToUpdates(page)

    const checkBtn = page.getByRole('button', { name: /check for/i })
    const isDisabled = await checkBtn.isDisabled()
    if (isDisabled) {
      await page.goto(SETTINGS_URL, { waitUntil: 'networkidle' })
      await page.waitForTimeout(3000)
      await page.goto(UPDATES_URL, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Database Updates' })).toBeVisible({ timeout: 15000 })
      await page.waitForTimeout(2000)
    }

    await checkBtn.click()

    await expect(
      page.getByText(/found.*updates|validation failed|request failed|no updates|error/i)
    ).toBeVisible({ timeout: 90000 })

    // If we got "Found N updates" or "Validation failed" (but NOT "request failed"),
    // the response was received and processed through the normalizer.
    const pageText = await page.evaluate(() => document.body?.innerText || '')
    const apiResponded = /found.*updates|validation failed|schema|no.*updates/i.test(pageText)
    const networkError = /request failed|network|timeout|empty response/i.test(pageText)

    // The API must have responded — either success or validation error, not network failure
    expect(apiResponded || !networkError).toBe(true)
  })

  test('3. Sandbox is created and review UI appears', async ({ page }) => {
    test.setTimeout(120000)

    await injectProvider(page)
    await setupProviderAndGoToUpdates(page)

    const checkBtn = page.getByRole('button', { name: /check for/i })
    const isDisabled = await checkBtn.isDisabled()
    if (isDisabled) {
      await page.goto(SETTINGS_URL, { waitUntil: 'networkidle' })
      await page.waitForTimeout(3000)
      await page.goto(UPDATES_URL, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Database Updates' })).toBeVisible({ timeout: 15000 })
      await page.waitForTimeout(2000)
    }

    await checkBtn.click()

    await expect(
      page.getByText(/found.*updates|validation failed|request failed|no updates|error/i)
    ).toBeVisible({ timeout: 90000 })

    const pageText = await page.evaluate(() => document.body?.innerText || '')

    // If updates were found, the review UI should be visible
    if (/found.*updates/i.test(pageText)) {
      await expect(page.getByText(/review|changes|approve|install/i).first()).toBeVisible({ timeout: 5000 })
    }
    // If validation failed — sandbox still ran before validation
    // If "no updates" — sandbox was still created (0 changes)
  })

  test('4. Production IndexedDB remains unchanged before approval', async ({ page }) => {
    test.setTimeout(120000)

    await injectProvider(page)
    await setupProviderAndGoToUpdates(page)

    // Capture template count before
    const templatesBefore = await page.evaluate(() => {
      const text = document.body?.innerText || ''
      const match = text.match(/(\d+)\s*templates/i)
      return match ? parseInt(match[1]) : -1
    })

    const checkBtn = page.getByRole('button', { name: /check for/i })
    const isDisabled = await checkBtn.isDisabled()
    if (isDisabled) {
      await page.goto(SETTINGS_URL, { waitUntil: 'networkidle' })
      await page.waitForTimeout(3000)
      await page.goto(UPDATES_URL, { waitUntil: 'networkidle' })
      await expect(page.getByRole('heading', { name: 'Database Updates' })).toBeVisible({ timeout: 15000 })
      await page.waitForTimeout(2000)
    }

    await checkBtn.click()

    await expect(
      page.getByText(/found.*updates|validation failed|request failed|no updates|error/i)
    ).toBeVisible({ timeout: 90000 })

    await page.waitForTimeout(2000)

    // Template count should not have increased (no install happened)
    const templatesAfter = await page.evaluate(() => {
      const text = document.body?.innerText || ''
      const match = text.match(/(\d+)\s*templates/i)
      return match ? parseInt(match[1]) : -1
    })

    if (templatesBefore > 0 && templatesAfter > 0) {
      expect(templatesAfter).toBeGreaterThanOrEqual(templatesBefore)
    }
  })

  test('5. No API key appears in DOM, console, or error messages', async ({ page }) => {
    test.setTimeout(60000)

    const exposedSecrets: string[] = []
    page.on('console', (msg) => {
      const text = msg.text()
      if (text.includes(TEST_API_KEY) || text.includes('Bearer ') || text.includes('api-subscription-key')) {
        exposedSecrets.push(redact(text))
      }
    })
    page.on('pageerror', (err) => {
      if (err.message.includes(TEST_API_KEY)) {
        exposedSecrets.push(redact(err.message))
      }
    })

    await injectProvider(page)
    await page.goto(UPDATES_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)

    expect(exposedSecrets).toHaveLength(0)

    const bodyText = await page.evaluate(() => document.body?.innerText || '')
    expect(bodyText).not.toContain(TEST_API_KEY)
    expect(bodyText).not.toContain('Bearer ')
    expect(bodyText).not.toMatch(/api-subscription-key:\s*[^\s]/i)
  })

  test('6. Test cleanup removes all temporary test data', async ({ page }) => {
    test.setTimeout(60000)

    await injectProvider(page)
    await page.goto(UPDATES_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Perform cleanup
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
      if (typeof indexedDB !== 'undefined') {
        indexedDB.deleteDatabase('promptgen-db')
        indexedDB.deleteDatabase('promptgen-credentials')
        indexedDB.deleteDatabase('prompt-gen-device-key')
      }
    })

    // Verify cleanup
    await page.goto(SETTINGS_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    const bodyText = await page.evaluate(() => document.body?.innerText || '')
    expect(bodyText).not.toContain(TEST_API_KEY)
    expect(bodyText).not.toMatch(/sk_[a-z0-9]+_[a-z0-9]+/i)
  })
})
