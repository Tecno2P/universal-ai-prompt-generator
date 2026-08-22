// Test framework shims — provided by the test runner
// (describe, it, expect are injected by the test runner at runtime)

import { BUILTIN_TEMPLATES } from '@/data/templates'
import { BUILTIN_CATEGORIES } from '@/data/categories'
import { BUILTIN_HINGLISH_PATTERNS } from '@/data/hinglish'

describe('BUILTIN_TEMPLATES', () => {
  it('has at least 30 templates', () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(30)
  })

  it('all templates have required fields', () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.id).toBeTruthy()
      expect(t.title).toBeTruthy()
      expect(t.content).toBeTruthy()
      expect(t.category).toBeTruthy()
      expect(t.tags).toBeInstanceOf(Array)
      expect(t.keywords).toBeInstanceOf(Array)
    }
  })

  it('all template ids are unique', () => {
    const ids = BUILTIN_TEMPLATES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('includes Hinglish templates', () => {
    const hinglish = BUILTIN_TEMPLATES.filter(t => t.language === 'hinglish')
    expect(hinglish.length).toBeGreaterThan(0)
  })

  it('covers multiple categories', () => {
    const categories = new Set(BUILTIN_TEMPLATES.map(t => t.category))
    expect(categories.size).toBeGreaterThanOrEqual(15)
  })
})

describe('BUILTIN_CATEGORIES', () => {
  it('has coding categories', () => {
    const cats = BUILTIN_CATEGORIES.map(c => c.id)
    expect(cats).toContain('coding')
    expect(cats).toContain('web-development')
    expect(cats).toContain('react')
    expect(cats).toContain('python')
  })

  it('has creative categories', () => {
    const cats = BUILTIN_CATEGORIES.map(c => c.id)
    expect(cats).toContain('creative')
    expect(cats).toContain('image-gen')
  })
})

describe('BUILTIN_HINGLISH_PATTERNS', () => {
  it('has patterns', () => {
    expect(BUILTIN_HINGLISH_PATTERNS.length).toBeGreaterThan(10)
  })

  it('all patterns have regex strings', () => {
    for (const p of BUILTIN_HINGLISH_PATTERNS) {
      expect(p.pattern).toBeTruthy()
      expect(p.intent).toBeTruthy()
    }
  })

  it('patterns are valid regex', () => {
    for (const p of BUILTIN_HINGLISH_PATTERNS) {
      expect(() => new RegExp(p.pattern)).not.toThrow()
    }
  })
})
