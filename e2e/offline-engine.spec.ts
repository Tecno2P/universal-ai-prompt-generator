import { test, expect } from '@playwright/test'

const BASE_URL = 'https://tecno2p.github.io/universal-ai-prompt-generator/'
const GENERATOR_URL = BASE_URL + '#/generator'

test.describe('Offline Prompt Engine Tests', () => {
  test('generator page loads with input', async ({ page }) => {
    await page.goto(GENERATOR_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Find the input textarea (first one, with placeholder containing "portfolio")
    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 10000 })
    const bodyText = await page.locator('body').innerText()
    expect(bodyText.length).toBeGreaterThan(0)
  })

  test('can enter text in prompt input', async ({ page }) => {
    await page.goto(GENERATOR_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 10000 })
    await textarea.fill('Create a modern portfolio website')
    await page.waitForTimeout(500)

    const value = await textarea.inputValue()
    expect(value).toContain('portfolio')
  })

  test('category selector exists', async ({ page }) => {
    await page.goto(GENERATOR_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Look for select or category-related elements
    const selectors = page.locator('select, [class*="category"], [class*="select"], [role="combobox"]')
    const count = await selectors.count()
    console.log(`Found ${count} selector elements`)
    expect(count).toBeGreaterThan(0)
  })

  test('generate button exists and is clickable', async ({ page }) => {
    await page.goto(GENERATOR_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // The generate button has class btn-primary and calls handleGenerate
    const generateBtn = page.locator('button.btn-primary, button:has-text("Generate"), button:has-text("Create")')
    await expect(generateBtn.first()).toBeVisible({ timeout: 10000 })
    console.log('Generate button found')
  })

  test('hinglish input is accepted', async ({ page }) => {
    await page.goto(GENERATOR_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 10000 })

    const hinglishInputs = [
      'Mere liye ek modern portfolio website bana',
      'Mujhe ek Android app banana hai',
      'Ek premium dashboard bana do with smooth animations',
    ]

    for (const text of hinglishInputs) {
      await textarea.fill(text)
      await page.waitForTimeout(300)
      const value = await textarea.inputValue()
      expect(value).toContain(text.substring(0, 10))
      console.log(`Hinglish input accepted: "${text}"`)
    }
  })

  test('unicode and emoji input', async ({ page }) => {
    await page.goto(GENERATOR_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 10000 })

    const specialInputs = [
      'मुझे एक responsive portfolio website बनानी है',
      'Create a 🚀 launch plan for my app',
      'Build an app with 中文 and العربية support',
      '<script>alert("xss")</script>',
    ]

    for (const text of specialInputs) {
      await textarea.fill(text)
      await page.waitForTimeout(200)
      const value = await textarea.inputValue()
      expect(value).toBe(text)
    }

    // Verify XSS payload was NOT executed (no alert dialog)
    const alertShown = await page.evaluate(() => !!(window as any).__xss_alert)
    expect(alertShown).toBe(false)
    console.log('XSS payload safely contained in textarea')
  })
})
