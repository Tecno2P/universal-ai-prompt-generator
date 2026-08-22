// Test framework shims — provided by the test runner
// (describe, it, expect are injected by the test runner at runtime)

import { detectIntent } from '@/engine/intentDetection'

describe('detectIntent', () => {
  it('detects website creation intent', () => {
    const result = detectIntent('I want to build a modern website')
    expect(result.category).toBe('web-development')
    expect(result.intent).toBe('create')
  })

  it('detects debugging intent', () => {
    const result = detectIntent('Help me fix this bug in my code')
    expect(result.category).toBe('debugging')
    expect(result.intent).toBe('transform')
  })

  it('detects summarization intent', () => {
    const result = detectIntent('Please summarize this article for me')
    expect(result.category).toBe('summarization')
    expect(result.intent).toBe('transform')
  })

  it('detects blog writing intent', () => {
    const result = detectIntent('Write a blog post about AI')
    expect(result.category).toBe('blog')
  })

  it('returns general for unrecognized input', () => {
    const result = detectIntent('xyz abc qwerty')
    expect(result.category).toBe('general')
  })

  it('detects SEO intent', () => {
    const result = detectIntent('How to improve my Google ranking and SEO')
    expect(result.category).toBe('seo')
  })

  it('detects quiz creation intent', () => {
    const result = detectIntent('Create a quiz with 10 multiple choice questions')
    expect(result.category).toBe('quiz')
  })
})
