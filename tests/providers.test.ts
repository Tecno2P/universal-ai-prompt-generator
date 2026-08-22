// Test framework shims — provided by the test runner
// (describe, it, expect are injected by the test runner at runtime)

import { PROVIDER_REGISTRY, getProviderById } from '@/providers/registry'

describe('PROVIDER_REGISTRY', () => {
  it('contains all required providers', () => {
    const ids = PROVIDER_REGISTRY.map(p => p.id)
    expect(ids).toContain('openai')
    expect(ids).toContain('gemini')
    expect(ids).toContain('anthropic')
    expect(ids).toContain('openrouter')
    expect(ids).toContain('groq')
    expect(ids).toContain('mistral')
    expect(ids).toContain('deepseek')
    expect(ids).toContain('xai')
    expect(ids).toContain('cohere')
    expect(ids).toContain('together')
    expect(ids).toContain('perplexity')
    expect(ids).toContain('ollama')
    expect(ids).toContain('generic')
  })

  it('has at least 13 providers', () => {
    expect(PROVIDER_REGISTRY.length).toBeGreaterThanOrEqual(13)
  })

  it('all providers have models', () => {
    for (const p of PROVIDER_REGISTRY) {
      expect(p.models.length).toBeGreaterThan(0)
    }
  })

  it('all providers have adapters', () => {
    for (const p of PROVIDER_REGISTRY) {
      expect(p.adapter).toBeTruthy()
    }
  })
})

describe('getProviderById', () => {
  it('returns provider by id', () => {
    const p = getProviderById('openai')
    expect(p).toBeDefined()
    expect(p?.name).toBe('OpenAI')
  })

  it('returns undefined for unknown id', () => {
    expect(getProviderById('unknown')).toBeUndefined()
  })
})
