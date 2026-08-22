// Test framework shims — provided by the test runner
// (describe, it, expect are injected by the test runner at runtime)

import { validateUpdatePackage, incrementVersion } from '@/updates/updateSystem'

describe('validateUpdatePackage', () => {
  const validPackage = {
    schema_version: 1,
    database_version: '1.1.0',
    changes: [
      {
        operation: 'add',
        type: 'template',
        id: 'test-001',
        category: 'web-development',
        language: 'en',
        title: 'Test Template',
        content: 'Test content',
        tags: ['test'],
      },
    ],
  }

  it('validates a correct package', () => {
    const result = validateUpdatePackage(validPackage)
    expect(result.valid).toBe(true)
    expect(result.changes.length).toBe(1)
    expect(result.errors.length).toBe(0)
  })

  it('rejects invalid schema_version', () => {
    const result = validateUpdatePackage({ ...validPackage, schema_version: 2 })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('schema_version'))).toBe(true)
  })

  it('rejects missing database_version', () => {
    const result = validateUpdatePackage({ ...validPackage, database_version: undefined })
    expect(result.valid).toBe(false)
  })

  it('rejects invalid operation', () => {
    const result = validateUpdatePackage({
      ...validPackage,
      changes: [{ ...validPackage.changes[0], operation: 'invalid' }],
    })
    expect(result.valid).toBe(false)
  })

  it('rejects template missing title', () => {
    const result = validateUpdatePackage({
      ...validPackage,
      changes: [{ ...validPackage.changes[0], title: undefined }],
    })
    expect(result.valid).toBe(false)
  })

  it('rejects content with script tags', () => {
    const result = validateUpdatePackage({
      ...validPackage,
      changes: [{ ...validPackage.changes[0], content: '<script>alert(1)</script>' }],
    })
    expect(result.valid).toBe(false)
  })

  it('handles non-object input', () => {
    const result = validateUpdatePackage(null)
    expect(result.valid).toBe(false)
  })
})

describe('incrementVersion', () => {
  it('increments patch version', () => {
    expect(incrementVersion('1.0.0')).toBe('1.0.1')
  })
  it('increments 2.5.3', () => {
    expect(incrementVersion('2.5.3')).toBe('2.5.4')
  })
})
