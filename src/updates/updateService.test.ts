import { describe, it, expect, beforeEach, vi } from 'vitest'
import { normalizeAIResponse, parseAIJsonResponse } from '@/providers/normalizeResponse'
import { validateUpdatePackage, getCurrentVersion } from '@/updates/updateSystem'
import { UpdateService, setTestMode, isTestMode, compareVersions } from './updateService'
import { updateStateMachine } from './updateStateMachine'
import {
  VALID_UPDATE,
  INVALID_JSON,
  INVALID_SCHEMA,
  DUPLICATE_RECORD,
  VERSION_CONFLICT,
  MALFORMED_JSON,
  TEST_PACKAGES,
} from './testPackages'
import type { ProviderConfig } from '@/types'

// ── Mock the IndexedDB-backed + provider modules so the service pipeline
//    can run in jsdom without a real database or network. ────────────────

vi.mock('@/database/db', () => ({
  db: {
    getAllTemplates: vi.fn(async () => []),
    getAllVersions: vi.fn(async () => []),
    putVersion: vi.fn(async () => undefined),
  },
}))

vi.mock('@/database/sandbox', () => ({
  createSandbox: vi.fn(async () => ({
    state: {
      id: 'sandbox-test',
      status: 'ready',
      baseVersion: '1.0.0',
      proposedVersion: '1.0.1',
      createdAt: Date.now(),
    },
    contents: { templates: [], hinglishPatterns: [], categories: [], versions: [] },
  })),
  applyToSandbox: vi.fn(async () => ({
    state: { id: 'sandbox-test', status: 'applied', baseVersion: '1.0.0', proposedVersion: '1.0.1', createdAt: 0 },
    contents: { templates: [], hinglishPatterns: [], categories: [], versions: [] },
  })),
  validateSandbox: vi.fn(async () => ({
    valid: true,
    score: 100,
    checks: [],
    errors: [],
    warnings: [],
  })),
  generateDiff: vi.fn(async () => ({
    baseVersion: '1.0.0',
    proposedVersion: '1.0.1',
    generatedAt: Date.now(),
    entries: [],
    summary: {
      added: 1, modified: 0, deleted: 0,
      byCollection: {
        templates: { added: 1, modified: 0, deleted: 0 },
        hinglishPatterns: { added: 0, modified: 0, deleted: 0 },
        categories: { added: 0, modified: 0, deleted: 0 },
      },
    },
  })),
  installFromSandbox: vi.fn(async () => ({ installed: 3, version: '1.0.1' })),
  discardSandbox: vi.fn(async () => undefined),
}))

vi.mock('@/providers/manager', () => ({
  generateWithProvider: vi.fn(async () => ({
    text: TEST_PACKAGES.VALID_UPDATE,
    tokensUsed: 100,
    responseTimeMs: 50,
  })),
}))

vi.mock('@/updates/updateSystem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/updates/updateSystem')>()
  return {
    ...actual,
    // getCurrentVersion hits IndexedDB in reality; stub it for tests.
    getCurrentVersion: vi.fn(async () => '1.0.0'),
    createRollbackSnapshot: vi.fn(async () => 'snapshot-test'),
    buildUpdateRequestPrompt: actual.buildUpdateRequestPrompt,
    incrementVersion: actual.incrementVersion,
    validateUpdatePackage: actual.validateUpdatePackage,
  }
})

const fakeProvider: ProviderConfig = {
  id: 'p1',
  providerId: 'openai',
  name: 'Test',
  model: 'gpt-4',
  connected: true,
  createdAt: 0,
}

function resetMachine() {
  if (updateStateMachine.isRunning) updateStateMachine.interrupt()
  try {
    updateStateMachine.reset()
  } catch {
    /* idle */
  }
}

// ── normalizeAIResponse on various inputs ─────────────────────

describe('normalizeAIResponse', () => {
  it('parses clean JSON directly', () => {
    const r = normalizeAIResponse('{"a":1}')
    expect(r.method).toBe('direct')
    expect(JSON.parse(r.cleaned)).toEqual({ a: 1 })
  })

  it('strips markdown fences (MALFORMED_JSON fixture)', () => {
    const r = normalizeAIResponse(MALFORMED_JSON)
    const parsed = JSON.parse(r.cleaned)
    expect(parsed.schema_version).toBe(1)
    expect(parsed.changes).toHaveLength(1)
  })

  it('throws on non-JSON prose (INVALID_JSON fixture)', () => {
    expect(() => normalizeAIResponse(INVALID_JSON)).toThrow()
  })

  it('extracts JSON embedded in prose', () => {
    const r = normalizeAIResponse('Here you go: {"x":2} thanks!')
    expect(JSON.parse(r.cleaned)).toEqual({ x: 2 })
  })

  it('parseAIJsonResponse returns the typed object', () => {
    const obj = parseAIJsonResponse<{ schema_version: number }>('{"schema_version":1}')
    expect(obj.schema_version).toBe(1)
  })
})

// ── schema validation ─────────────────────────────────────────

describe('validateUpdatePackage', () => {
  it('accepts VALID_UPDATE', () => {
    const r = validateUpdatePackage(VALID_UPDATE)
    expect(r.valid).toBe(true)
    expect(r.errors).toHaveLength(0)
    expect(r.changes).toHaveLength(3)
  })

  it('rejects INVALID_SCHEMA (missing required template fields)', () => {
    const r = validateUpdatePackage(INVALID_SCHEMA)
    expect(r.valid).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
  })

  it('flags duplicate ids as a warning in DUPLICATE_RECORD', () => {
    const r = validateUpdatePackage(DUPLICATE_RECORD)
    // duplicates are warnings, not errors — package still structurally valid
    expect(r.warnings.some((w) => /duplicate/i.test(w))).toBe(true)
  })

  it('rejects non-object input', () => {
    const r = validateUpdatePackage(null)
    expect(r.valid).toBe(false)
  })
})

// ── version comparison ───────────────────────────────────────

describe('compareVersions', () => {
  it('orders ascending versions', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('ignores -local suffix', () => {
    expect(compareVersions('1.0.0-local', '1.0.0')).toBe(0)
  })

  it('compares major bumps', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
  })
})

// ── test mode ──────────────────────────────────────────────────

describe('setTestMode', () => {
  beforeEach(() => {
    setTestMode(false)
    resetMachine()
  })

  it('toggles and reports the mode', () => {
    setTestMode(true)
    expect(isTestMode()).toBe(true)
    setTestMode(false)
    expect(isTestMode()).toBe(false)
  })

  it('accepts a specific fixture name', () => {
    setTestMode('MALFORMED_JSON')
    expect(isTestMode()).toBe('MALFORMED_JSON')
  })

  it('checkForUpdates in test mode produces a valid package', async () => {
    setTestMode(true)
    const result = await UpdateService.checkForUpdates(fakeProvider)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.package.changes.length).toBe(3)
      expect(result.data.validation.valid).toBe(true)
      expect(result.data.rawMethod).toBe('test-mode')
    }
  })

  it('checkForUpdates with MALFORMED_JSON fixture still parses via normalizer', async () => {
    setTestMode('MALFORMED_JSON')
    const result = await UpdateService.checkForUpdates(fakeProvider)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.package.changes).toHaveLength(1)
    }
  })

  it('checkForUpdates with INVALID_JSON fixture returns a parse error', async () => {
    setTestMode('INVALID_JSON')
    const result = await UpdateService.checkForUpdates(fakeProvider)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('UPDATE_AI_JSON_INVALID')
      expect(result.error.retryable).toBe(true)
    }
  })

  it('checkForUpdates with INVALID_SCHEMA fixture returns a schema error', async () => {
    setTestMode('INVALID_SCHEMA')
    const result = await UpdateService.checkForUpdates(fakeProvider)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('UPDATE_SCHEMA_INVALID')
    }
  })
})

// ── sandbox creation + validation ────────────────────────────

describe('UpdateService.prepareSandbox', () => {
  beforeEach(() => {
    setTestMode(false)
    resetMachine()
  })

  it('creates a sandbox and returns a valid diff', async () => {
    const result = await UpdateService.prepareSandbox(VALID_UPDATE)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.validation.valid).toBe(true)
      expect(result.data.diff.summary.added).toBe(1)
    }
    expect(updateStateMachine.state).toBe('awaiting_review')
  })

  it('fails the operation-in-progress guard when already running', async () => {
    updateStateMachine.start() // blocks the pipeline
    const result = await UpdateService.prepareSandbox(VALID_UPDATE)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('UPDATE_OPERATION_IN_PROGRESS')
    }
  })
})

// ── retry logic on invalid JSON ───────────────────────────────

describe('retry logic on invalid JSON', () => {
  beforeEach(() => {
    setTestMode(false)
    resetMachine()
    vi.clearAllMocks()
  })

  it('retries the provider when JSON parsing fails, then succeeds', async () => {
    const { generateWithProvider } = await import('@/providers/manager')
    const mockGen = generateWithProvider as unknown as ReturnType<typeof vi.fn>
    // First call: garbage. Second call (retry): valid JSON.
    mockGen
      .mockResolvedValueOnce({ text: 'not json at all', tokensUsed: 1, responseTimeMs: 1 })
      .mockResolvedValueOnce({ text: TEST_PACKAGES.VALID_UPDATE, tokensUsed: 1, responseTimeMs: 1 })

    const result = await UpdateService.checkForUpdates(fakeProvider)
    expect(result.success).toBe(true)
    expect(mockGen).toHaveBeenCalledTimes(2)
  })

  it('gives up after 2 retries and returns UPDATE_AI_JSON_INVALID', async () => {
    const { generateWithProvider } = await import('@/providers/manager')
    const mockGen = generateWithProvider as unknown as ReturnType<typeof vi.fn>
    // Always return garbage.
    mockGen.mockResolvedValue({
      text: 'still not json',
      tokensUsed: 1,
      responseTimeMs: 1,
    })

    const result = await UpdateService.checkForUpdates(fakeProvider)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('UPDATE_AI_JSON_INVALID')
    }
    // initial + 2 retries = 3 calls
    expect(mockGen).toHaveBeenCalledTimes(3)
  })
})

// ── install + verify ──────────────────────────────────────────

describe('UpdateService.install + verify', () => {
  beforeEach(() => {
    setTestMode(false)
    resetMachine()
  })

  it('installs from sandbox, verifies, and reaches completed', async () => {
    // Set up the machine as if prepareSandbox already ran.
    updateStateMachine.start()
    updateStateMachine.transition('awaiting_review')

    const { db } = await import('@/database/db')
    const mockDb = db as unknown as {
      getAllTemplates: ReturnType<typeof vi.fn>
      getAllVersions: ReturnType<typeof vi.fn>
      putVersion: ReturnType<typeof vi.fn>
    }
    mockDb.getAllTemplates.mockResolvedValueOnce([
      { id: 't1', title: 'T', content: 'C', category: 'general' },
    ])
    mockDb.getAllVersions.mockResolvedValueOnce([
      { version: '1.0.1', installedAt: Date.now(), changeCount: 1, source: 'ai' },
    ])

    const result = await UpdateService.install(VALID_UPDATE)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.installed).toBe(3)
      expect(result.data.version).toBe('1.0.1')
    }
    expect(updateStateMachine.state).toBe('completed')
  })

  it('verify() reloads records and reports validity', async () => {
    const { db } = await import('@/database/db')
    const mockDb = db as unknown as {
      getAllTemplates: ReturnType<typeof vi.fn>
      getAllVersions: ReturnType<typeof vi.fn>
    }
    mockDb.getAllTemplates.mockResolvedValueOnce([
      { id: 't1', title: 'T', content: 'C', category: 'general' },
    ])
    mockDb.getAllVersions.mockResolvedValueOnce([
      { version: '1.0.1', installedAt: Date.now(), changeCount: 1, source: 'ai' },
    ])
    const result = await UpdateService.verify()
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.recordCount).toBe(1)
      expect(result.data.valid).toBe(true)
    }
  })
})

// ── result typing (never throws) ──────────────────────────────

describe('UpdateService result contract', () => {
  beforeEach(() => {
    setTestMode(false)
    resetMachine()
  })

  it('checkForUpdates returns a discriminated UpdateResult, never throws', async () => {
    setTestMode(true)
    const r = await UpdateService.checkForUpdates(fakeProvider)
    expect(r).toHaveProperty('success')
    if (r.success) {
      expect(r).toHaveProperty('data')
    } else {
      expect(r.error).toHaveProperty('code')
      expect(r.error).toHaveProperty('retryable')
    }
  })

  it('VERSION_CONFLICT fixture still parses (version check is downstream)', async () => {
    // The fixture parses fine; the service does not currently reject on
    // version mismatch during checkForUpdates (that is a prepare/install
    // concern). We assert it does not throw and yields a package.
    setTestMode('VERSION_CONFLICT')
    const r = await UpdateService.checkForUpdates(fakeProvider)
    expect(r.success).toBe(true)
  })
})
