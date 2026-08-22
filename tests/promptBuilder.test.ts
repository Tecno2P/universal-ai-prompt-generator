// Test framework shims — provided by the test runner
// (describe, it, expect are injected by the test runner at runtime)

import { buildStructuredPrompt, DEFAULT_SECTIONS } from '@/engine/promptBuilder'
import type { PromptSectionKey } from '@/types'

describe('buildStructuredPrompt', () => {
  const baseOpts = {
    style: 'professional' as const,
    sections: DEFAULT_SECTIONS,
    outputLanguage: 'en' as const,
    userIdea: 'Build a modern website',
    detectedCategory: 'web-development',
    detectedIntent: 'create',
  }

  it('generates a prompt with role section', () => {
    const result = buildStructuredPrompt(baseOpts)
    expect(result).toContain('**Role**')
    expect(result).toContain('web developer')
  })

  it('includes objective section', () => {
    const result = buildStructuredPrompt(baseOpts)
    expect(result).toContain('**Objective**')
  })

  it('includes the user idea in context', () => {
    const result = buildStructuredPrompt(baseOpts)
    expect(result).toContain('Build a modern website')
  })

  it('respects disabled sections', () => {
    const sections = { ...DEFAULT_SECTIONS, role: false, context: false }
    const result = buildStructuredPrompt({ ...baseOpts, sections })
    expect(result).not.toContain('**Role**')
    expect(result).not.toContain('**Context**')
  })

  it('generates Hinglish output when requested', () => {
    const result = buildStructuredPrompt({ ...baseOpts, outputLanguage: 'hinglish' })
    expect(result).toContain('Aap ek')
  })

  it('includes requirements section by default', () => {
    const result = buildStructuredPrompt(baseOpts)
    expect(result).toContain('**Requirements**')
  })
})

describe('DEFAULT_SECTIONS', () => {
  it('has all section keys', () => {
    const keys = Object.keys(DEFAULT_SECTIONS) as PromptSectionKey[]
    expect(keys.length).toBe(13)
    expect(keys).toContain('role')
    expect(keys).toContain('objective')
    expect(keys).toContain('requirements')
  })
})
