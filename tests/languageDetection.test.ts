// Test framework shims — provided by the test runner
// (describe, it, expect are injected by the test runner at runtime)

import { detectLanguage } from '@/engine/languageDetection'

describe('detectLanguage', () => {
  it('detects English text', () => {
    const result = detectLanguage('Build a modern website with React')
    expect(result.language).toBe('en')
    expect(result.isHinglish).toBe(false)
  })

  it('detects Hinglish (Roman Hindi + English)', () => {
    const result = detectLanguage('Mujhe ek modern website banani hai')
    expect(result.language).toBe('hinglish')
    expect(result.isHinglish).toBe(true)
  })

  it('detects Hindi (Devanagari script)', () => {
    const result = detectLanguage('मुझे एक वेबसाइट बनानी है')
    expect(result.language).toBe('hi')
  })

  it('detects Hinglish with Devanagari + English mix', () => {
    const result = detectLanguage('मुझे modern website बनानी है with React')
    expect(result.scores.hinglish).toBeDefined
  })

  it('handles empty input', () => {
    const result = detectLanguage('')
    expect(result.language).toBe('en')
    expect(result.confidence).toBe(1)
  })

  it('detects mixed Hinglish technical vocabulary', () => {
    const result = detectLanguage('Mere project ko aur professional aur fast bana')
    expect(result.isHinglish).toBe(true)
  })
})
