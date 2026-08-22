// Test framework shims — provided by the test runner
// (describe, it, expect are injected by the test runner at runtime)

import { transformPrompt } from '@/engine'

describe('transformPrompt', () => {
  const basePrompt = `**Role**: You are a developer.

**Objective**: Build a website.

**Requirements**:
- Clean code
- Responsive`

  it('expands prompt', () => {
    const result = transformPrompt(basePrompt, 'expand')
    expect(result).toContain('Expanded Guidance')
    expect(result.length).toBeGreaterThan(basePrompt.length)
  })

  it('shortens prompt', () => {
    const result = transformPrompt(basePrompt, 'shorten')
    // Shorten removes optional sections; with only Role/Objective/Requirements, result should not be longer
    expect(result.length).toBeLessThanOrEqual(basePrompt.length)
  })

  it('adds professional tone', () => {
    const result = transformPrompt(basePrompt, 'professional')
    expect(result).toContain('Professional')
  })

  it('adds technical tone', () => {
    const result = transformPrompt(basePrompt, 'technical')
    expect(result).toContain('Technical')
  })

  it('adds creative tone', () => {
    const result = transformPrompt(basePrompt, 'creative')
    expect(result).toContain('Creative')
  })

  it('adds constraints', () => {
    const result = transformPrompt(basePrompt, 'addConstraints')
    expect(result).toContain('Constraints')
  })

  it('converts to JSON format', () => {
    const result = transformPrompt(basePrompt, 'toJSON')
    expect(result.startsWith('{')).toBe(true)
    expect(result.endsWith('}')).toBe(true)
  })

  it('adds optimization notes', () => {
    const result = transformPrompt(basePrompt, 'optimize')
    expect(result).toContain('AI Optimization')
  })

  it('returns unchanged for unknown action', () => {
    const result = transformPrompt(basePrompt, 'unknown')
    expect(result).toBe(basePrompt)
  })
})
