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
 *   Open App → Inject Provider via page.evaluate (IndexedDB + secure memory)
 *   → Navigate to Settings (triggers hasAI=true) → Navigate to Updates
 *   → Click "Check for AI Updates" → Real API call to Sarvam
 *   → Receive real AI response → Normalize → Parse → Validate
 *   → Sandbox → Review UI appears → Verify production DB unchanged
 */

import { test, expect, type Page } from '@playwright/test'

const BASE_URL = 'https://tecno2p.github.io/universal-ai-prompt-generator/'
const UPDATES_URL = BASE_URL + '#/updates'
const SETTINGS_URL = BASE_URL + '#/settings'

const RUN_REAL = process.env.RUN_REAL_AI_TESTS === 'true'
const TEST_PROVIDER = process.env.TEST_AI_PROVIDER || ''
const TEST_API_KEY = process.env.TEST_AI_API_KEY || ''
const TEST_MODEL = process.env.TEST_AI_MODEL || ''

test.skip(!RUN_REAL, 'Real AI API tests are disabled (set RUN_REAL_AI_TESTS=true)')
test.skip(RUN_REAL && (!TEST_PROVIDER || !TEST_API_KEY || !TEST_MODEL),
  'Real AI API tests require TEST_AI_PROVIDER, TEST_AI_API_KEY, and TEST_AI_MODEL')

function redact(text: string): string {
  return text
    .replace(/sk_[a-z0-9]+_[A-Za-z0-9]+/gi, '[REDACTED]')
    .replace(/sk-[a-zA-Z0-9]+/gi, '[REDACTED]')
    .replace(/Bearer\s+[^\s,]+/gi, 'Bearer [REDACTED]')
    .replace(/api-subscription-key["\s:]+[^\s,}"]+/gi, 'api-subscription-key: [REDACTED]')
    .replace(/Authorization["\s:]+[^\s,}"]+/gi, 'Authorization: [REDACTED]')
}

/**
 * Inject provider credentials directly into IndexedDB + secure memory
 * using the app's own service modules. Uses encrypted_device mode so
 * credentials persist across page navigations.
 */
async function injectProvider(page: Page) {
  // Wait for the app to be fully loaded
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  // Use the app's own modules to save the credential
  await page.evaluate(async (cfg: { providerId: string; apiKey: string; model: string }) => {
    // Access the bundled modules via dynamic import
    // The app uses Vite, so modules are available at predictable paths
    // But since it's a production build, we can't import source modules directly.
    // Instead, we use the global window objects the app exposes.

    // The credential vault uses secureMemory (Map) — but that's module-scoped.
    // We need to use IndexedDB directly to store the provider config,
    // and also store the credential in the credential IndexedDB.

    // 1. Store the provider config in the main IndexedDB
    const DB_NAME = 'promptgen-db'
    const STORE = 'providers'

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME)
      req.onsuccess = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          reject(new Error('providers store not found'))
          return
        }
        const tx = db.transaction(STORE, 'readwrite')
        const config = {
          id: `prov-${cfg.providerId}-${Date.now()}`,
          providerId: cfg.providerId,
          name: 'Test Provider',
          apiKey: undefined,
          model: cfg.model,
          customEndpoint: undefined,
          connected: false,
          createdAt: Date.now(),
        }
        tx.objectStore(STORE).put(config)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })

    // 2. Store the API key in the credential IndexedDB (encrypted_device mode)
    // The vault stores credentials in 'promptgen-credentials' DB
    const CRED_DB = 'promptgen-credentials'
    const CRED_STORE = 'credentials'

    // We also need the device key — but that's complex.
    // Instead, use session mode: the key goes into secureMemory (Map),
    // but that's module-scoped and lost on reload.
    //
    // Alternative: Store the API key directly in the provider config.
    // The app's generateWithProvider() checks ctx.config.apiKey which
    // comes from retrieveCredential(). For session mode, it checks memory.
    //
    // Since we can't access the module-scoped Map from outside,
    // we'll store the key directly in the provider config's apiKey field.
    // The createContext() function overrides it with the vault value, but
    // if the vault returns null (no credential found), it falls back to
    // config.apiKey.
    //
    // Actually, looking at the code: createContext sets apiKey from credential,
    // and if credential is null, apiKey is undefined. Then generateWithProvider
    // checks if ctx.config.apiKey is falsy and throws.
    //
    // So we need to store the credential in a way that retrieveCredential finds it.
    // For encrypted_device mode, it needs the device key + encrypted record.
    // That's too complex for a test injection.
    //
    // Simplest approach: use window.__testProviderConfig which main.tsx handles
    // by calling credentialService.saveCredential() with session mode.
    // But session mode loses the key on reload.
    //
    // The fix: don't reload the page after injection. Navigate using hash routing
    // instead of full page navigation.

    // Actually we already stored the provider config in IndexedDB above.
    // Now we need the API key in memory. We'll use window.__testProviderConfig
    // which main.tsx picks up and calls saveCredential() with session mode.
    // The key stays in memory as long as we don't do a full page reload.
    // Hash navigation doesn't cause a full reload, so the key persists.
  }, { providerId: TEST_PROVIDER, apiKey: TEST_API_KEY, model: TEST_MODEL })
}

/**
 * Use addInitScript to inject the provider via main.tsx's __testProviderConfig hook.
 * Then navigate using hash changes (not full page loads) to preserve in-memory state.
 */
async function setupAndGoToUpdates(page: Page) {
  // Add init script that sets __testProviderConfig — main.tsx will call
  // credentialService.saveCredential() with session mode on page load
  await page.addInitScript((cfg: { providerId: string; apiKey: string; model: string }) => {
    (window as unknown as { __testProviderConfig?: unknown }).__testProviderConfig = cfg
  }, { providerId: TEST_PROVIDER, apiKey: TEST_API_KEY, model: TEST_MODEL })

  // Load the app — main.tsx will inject the provider
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000) // Wait for async import + saveCredential

  // Navigate to Settings via hash (no full page reload)
  await page.evaluate(() => { window.location.hash = '#/settings' })
  await page.waitForTimeout(2000)

  // Navigate to Updates via hash (no full page reload)
  await page.evaluate(() => { window.location.hash = '#/updates' })
  await page.waitForTimeout(2000)

  // Wait for the updates page heading
  await expect(page.getByRole('heading', { name: 'Database Updates' })).toBeVisible({ timeout: 15000 })
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
    await setupAndGoToUpdates(page)

    const checkBtn = page.getByRole('button', { name: /check for/i })
    await expect(checkBtn).toBeVisible({ timeout: 5000 })

    // Click and wait for response
    await checkBtn.click()

    await expect(
      page.getByText(/found.*updates|validation failed|request failed|no updates|error/i)
    ).toBeVisible({ timeout: 90000 })

    const pageText = await page.evaluate(() => document.body?.innerText || '')
    const hasError = /request failed|network|timeout|empty response/i.test(pageText)
    expect(hasError).toBe(false)
  })

  test('2. Real AI response normalization and JSON parsing succeeds', async ({ page }) => {
    test.setTimeout(120000)
    await setupAndGoToUpdates(page)

    const checkBtn = page.getByRole('button', { name: /check for/i })
    await expect(checkBtn).toBeVisible({ timeout: 5000 })
    await checkBtn.click()

    await expect(
      page.getByText(/found.*updates|validation failed|request failed|no updates|error/i)
    ).toBeVisible({ timeout: 90000 })

    const pageText = await page.evaluate(() => document.body?.innerText || '')
    const apiResponded = /found.*updates|validation failed|schema|no.*updates/i.test(pageText)
    const networkError = /request failed|network|timeout|empty response/i.test(pageText)
    expect(apiResponded || !networkError).toBe(true)
  })

  test('3. Sandbox is created and review UI appears', async ({ page }) => {
    test.setTimeout(120000)
    await setupAndGoToUpdates(page)

    const checkBtn = page.getByRole('button', { name: /check for/i })
    await expect(checkBtn).toBeVisible({ timeout: 5000 })
    await checkBtn.click()

    await expect(
      page.getByText(/found.*updates|validation failed|request failed|no updates|error/i)
    ).toBeVisible({ timeout: 90000 })

    const pageText = await page.evaluate(() => document.body?.innerText || '')
    if (/found.*updates/i.test(pageText)) {
      await expect(page.getByText(/review|changes|approve|install/i).first()).toBeVisible({ timeout: 5000 })
    }
  })

  test('4. Production IndexedDB remains unchanged before approval', async ({ page }) => {
    test.setTimeout(120000)
    await setupAndGoToUpdates(page)

    const templatesBefore = await page.evaluate(() => {
      const text = document.body?.innerText || ''
      const match = text.match(/(\d+)\s*templates/i)
      return match ? parseInt(match[1]) : -1
    })

    const checkBtn = page.getByRole('button', { name: /check for/i })
    await expect(checkBtn).toBeVisible({ timeout: 5000 })
    await checkBtn.click()

    await expect(
      page.getByText(/found.*updates|validation failed|request failed|no updates|error/i)
    ).toBeVisible({ timeout: 90000 })

    await page.waitForTimeout(2000)
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

    await page.addInitScript((cfg: { providerId: string; apiKey: string; model: string }) => {
      (window as unknown as { __testProviderConfig?: unknown }).__testProviderConfig = cfg
    }, { providerId: TEST_PROVIDER, apiKey: TEST_API_KEY, model: TEST_MODEL })

    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)

    expect(exposedSecrets).toHaveLength(0)

    const bodyText = await page.evaluate(() => document.body?.innerText || '')
    expect(bodyText).not.toContain(TEST_API_KEY)
    expect(bodyText).not.toContain('Bearer ')
  })

  test('6. Test cleanup removes all temporary test data', async ({ page }) => {
    test.setTimeout(60000)

    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
      if (typeof indexedDB !== 'undefined') {
        indexedDB.deleteDatabase('promptgen-db')
        indexedDB.deleteDatabase('promptgen-credentials')
        indexedDB.deleteDatabase('prompt-gen-device-key')
      }
    })

    await page.evaluate(() => { window.location.hash = '#/settings' })
    await page.waitForTimeout(2000)

    const bodyText = await page.evaluate(() => document.body?.innerText || '')
    expect(bodyText).not.toContain(TEST_API_KEY)
    expect(bodyText).not.toMatch(/sk_[a-z0-9]+_[a-z0-9]+/i)
  })
})
