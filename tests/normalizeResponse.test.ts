import { describe, it, expect } from 'vitest'
import { normalizeAIResponse, parseAIJsonResponse } from '@/providers/normalizeResponse'

describe('normalizeAIResponse', () => {
  it('parses clean JSON directly', () => {
    const input = '{"schema_version": 1, "changes": []}'
    const result = normalizeAIResponse(input)
    expect(result.method).toBe('direct')
    expect(JSON.parse(result.cleaned)).toEqual({ schema_version: 1, changes: [] })
  })

  it('strips UTF-8 BOM', () => {
    const input = '\uFEFF{"schema_version": 1}'
    const result = normalizeAIResponse(input)
    expect(JSON.parse(result.cleaned)).toEqual({ schema_version: 1 })
  })

  it('removes markdown code fences', () => {
    const input = '```json\n{"schema_version": 1, "changes": []}\n```'
    const result = normalizeAIResponse(input)
    expect(result.method).toBe('fence-removal')
    expect(JSON.parse(result.cleaned)).toEqual({ schema_version: 1, changes: [] })
  })

  it('removes plain code fences', () => {
    const input = '```\n{"schema_version": 1}\n```'
    const result = normalizeAIResponse(input)
    expect(JSON.parse(result.cleaned)).toEqual({ schema_version: 1 })
  })

  it('extracts JSON from surrounding text', () => {
    const input = 'Here is the JSON you requested:\n\n{"schema_version": 1, "changes": [{"operation": "add", "type": "template", "id": "test-1", "title": "Test", "content": "Hello", "category": "general"}]}\n\nLet me know if you need anything else.'
    const result = normalizeAIResponse(input)
    expect(result.method).toBe('object-extraction')
    expect(JSON.parse(result.cleaned).schema_version).toBe(1)
  })

  it('handles trailing commas', () => {
    const input = '{"schema_version": 1, "changes": [{"id": "test", "operation": "add", "type": "template", "title": "T", "content": "C", "category": "g"},],}'
    const result = normalizeAIResponse(input)
    expect(result.method).toBe('repair')
    const parsed = JSON.parse(result.cleaned)
    expect(parsed.changes).toHaveLength(1)
  })

  it('handles single-quoted JSON', () => {
    const input = "{'schema_version': 1, 'changes': []}"
    const result = normalizeAIResponse(input)
    expect(JSON.parse(result.cleaned).schema_version).toBe(1)
  })

  it('handles nested objects with braces in strings', () => {
    const input = '{"content": "Use {placeholder} in your prompt", "schema_version": 1}'
    const result = normalizeAIResponse(input)
    expect(JSON.parse(result.cleaned).content).toBe('Use {placeholder} in your prompt')
  })

  it('throws on empty response', () => {
    expect(() => normalizeAIResponse('')).toThrow()
  })

  it('throws on whitespace-only response', () => {
    expect(() => normalizeAIResponse('   \n\t  ')).toThrow()
  })

  it('throws on non-string input', () => {
    expect(() => normalizeAIResponse(null as unknown as string)).toThrow()
  })

  it('throws when no JSON object found', () => {
    expect(() => normalizeAIResponse('Sorry, I cannot help with that.')).toThrow()
  })

  it('parseAIJsonResponse returns parsed object', () => {
    const input = '```json\n{"version": "1.0.1"}\n```'
    const result = parseAIJsonResponse(input)
    expect(result).toEqual({ version: '1.0.1' })
  })

  it('handles large response with many changes', () => {
    const changes = Array.from({ length: 50 }, (_, i) => ({
      operation: 'add',
      type: 'template',
      id: `template-${i}`,
      title: `Template ${i}`,
      content: `Content for template ${i}`,
      category: 'general',
    }))
    const input = JSON.stringify({ schema_version: 1, database_version: '1.0.1', changes })
    const result = parseAIJsonResponse<{ changes: typeof changes }>(input)
    expect(result.changes).toHaveLength(50)
  })
})
