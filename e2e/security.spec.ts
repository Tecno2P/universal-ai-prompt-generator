import { test, expect } from '@playwright/test'

const BASE_URL = 'https://tecno2p.github.io/universal-ai-prompt-generator/'

test.describe('Security Tests', () => {
  test('no API keys in page source', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    const pageSource = await page.content()
    // Check that no real API keys are exposed
    expect(pageSource).not.toContain('sk_4gkfavgn')
    expect(pageSource).not.toContain('ghp_ZXzxNt')
    expect(pageSource).not.toContain('sk-')
    console.log('No API keys found in page source')
  })

  test('no eval or dangerouslySetInnerHTML', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Navigate around to trigger rendering
    const navLinks = page.locator('nav a, nav button')
    const count = await navLinks.count()
    for (let i = 0; i < Math.min(count, 5); i++) {
      await navLinks.nth(i).click().catch(() => {})
      await page.waitForTimeout(500)
    }

    // Check for eval-related errors
    const evalErrors = errors.filter(e => e.includes('eval') || e.includes('Function'))
    expect(evalErrors).toHaveLength(0)
  })

  test('XSS input does not execute', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    let alertTriggered = false
    page.on('dialog', async (dialog) => {
      alertTriggered = true
      await dialog.dismiss()
    })

    const textarea = page.locator('textarea').first()
    await textarea.fill('<img src=x onerror="alert(1)">')
    await page.waitForTimeout(500)

    // Try to trigger it
    const buttons = page.locator('button')
    const btnCount = await buttons.count()
    for (let i = 0; i < Math.min(btnCount, 3); i++) {
      await buttons.nth(i).click().catch(() => {})
      await page.waitForTimeout(300)
    }

    expect(alertTriggered).toBe(false)
    console.log('XSS payload did not trigger alert')
  })

  test('no secrets in network requests', async ({ page }) => {
    const secretPatterns = ['sk_4gkfavgn', 'ghp_ZXzxNt', 'sk-', 'Bearer sk']
    const foundSecrets: string[] = []

    page.on('request', (request) => {
      const url = request.url()
      for (const pattern of secretPatterns) {
        if (url.includes(pattern)) {
          foundSecrets.push(`URL: ${url}`)
        }
      }
    })

    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    expect(foundSecrets).toHaveLength(0)
    console.log('No secrets found in network requests')
  })

  test('no dangerouslySetInnerHTML warnings', async ({ page }) => {
    const consoleMessages: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        consoleMessages.push(msg.text())
      }
    })

    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    const dsihWarnings = consoleMessages.filter(m =>
      m.includes('dangerouslySetInnerHTML') || m.includes('innerHTML')
    )
    expect(dsihWarnings).toHaveLength(0)
  })
})
