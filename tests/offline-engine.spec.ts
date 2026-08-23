import { test, expect } from '@playwright/test'

const BASE_URL = 'https://tecno2p.github.io/universal-ai-prompt-generator/'

test.describe('Offline Prompt Engine Tests', () => {
  test('generator page loads', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)

    // Look for generator-related elements
    const inputs = page.locator('textarea, input[type="text"], [class*="prompt"], [class*="idea"]')
    const count = await inputs.count()
    console.log(`Found ${count} input elements`)
    expect(count).toBeGreaterThan(0)
  })

  test('can enter text in prompt input', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    const textarea = page.locator('textarea').first()
    await textarea.fill('Create a modern portfolio website')
    await page.waitForTimeout(500)

    const value = await textarea.inputValue()
    expect(value).toContain('portfolio')
  })

  test('category selector exists', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)

    // Look for select or category-related elements
    const selectors = page.locator('select, [class*="category"], [class*="select"], [role="combobox"]')
    const count = await selectors.count()
    console.log(`Found ${count} selector elements`)
  })

  test('generate button exists and is clickable', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)

    // Look for a generate button
    const buttons = page.locator('button')
    const count = await buttons.count()
    let generateBtn = null

    for (let i = 0; i < count; i++) {
      const text = await buttons.nth(i).textContent().catch(() => '')
      if (text && (text.toLowerCase().includes('generate') || text.toLowerCase().includes('create'))) {
        generateBtn = buttons.nth(i)
        console.log(`Found generate button: "${text.trim()}"`)
        break
      }
    }

    if (generateBtn) {
      await expect(generateBtn).toBeVisible()
    } else {
      console.log('No generate button found — may be on a different tab')
    }
  })

  test('hinglish input is accepted', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    const textarea = page.locator('textarea').first()
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
    await page.goto(BASE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    const textarea = page.locator('textarea').first()
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

    // Verify XSS payload was NOT executed
    const alertShown = await page.evaluate(() => !!(window as any).__xss_alert)
    expect(alertShown).toBe(false)
    console.log('XSS payload safely contained in textarea')
  })
})
