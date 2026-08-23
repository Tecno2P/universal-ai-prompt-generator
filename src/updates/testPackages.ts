/**
 * Deterministic test update packages.
 *
 * Each fixture exercises a specific path in the update pipeline so the service
 * can be tested end-to-end without a real AI provider. `setTestMode(true)`
 * makes `UpdateService.checkForUpdates` return these instead of calling a
 * provider.
 *
 * The fixtures are raw strings (as an AI provider would return) where that
 * matters — `MALFORMED_JSON` and `INVALID_JSON` exist precisely to exercise the
 * normalizer / parser. `VALID_UPDATE`, `INVALID_SCHEMA`, `DUPLICATE_RECORD`
 * and `VERSION_CONFLICT` are pre-parsed objects too, but they are also exposed
 * as their JSON string form via the `*` aliases.
 */

import type { UpdatePackage } from '@/types'

const NOW = 1_700_000_000_000

const baseChange = (id: string, title: string, content: string) => ({
  operation: 'add' as const,
  type: 'template' as const,
  id,
  category: 'general',
  language: 'en' as const,
  title,
  content,
  tags: ['test'],
})

/** A properly formatted update package with 3 new templates. */
export const VALID_UPDATE: UpdatePackage = {
  schema_version: 1,
  database_version: '1.0.1',
  changes: [
    baseChange('tpl-test-alpha', 'Alpha Template', 'Role: You are an expert.\nObjective: Summarize.'),
    baseChange('tpl-test-beta', 'Beta Template', 'Role: You are a coder.\nObjective: Refactor code.'),
    baseChange('tpl-test-gamma', 'Gamma Template', 'Role: You are a writer.\nObjective: Draft an outline.'),
  ],
  generatedAt: NOW,
  source: 'test-mode',
}

/** JSON but missing required fields (changes with a template lacking title/content). */
export const INVALID_SCHEMA: UpdatePackage = {
  schema_version: 1,
  database_version: '1.0.1',
  changes: [
    // missing title + content + category
    { operation: 'add', type: 'template', id: 'tpl-broken', tags: [] },
  ],
  generatedAt: NOW,
  source: 'test-mode',
}

/** Valid JSON but two changes share the same template id. */
export const DUPLICATE_RECORD: UpdatePackage = {
  schema_version: 1,
  database_version: '1.0.1',
  changes: [
    baseChange('tpl-dup', 'Dup One', 'Content one.'),
    baseChange('tpl-dup', 'Dup Two', 'Content two.'),
  ],
  generatedAt: NOW,
  source: 'test-mode',
}

/** base version does not match the live DB version (purposely far off). */
export const VERSION_CONFLICT: UpdatePackage = {
  schema_version: 1,
  database_version: '99.99.99',
  changes: [baseChange('tpl-conflict', 'Conflict', 'Should be rejected by version check.')],
  generatedAt: NOW,
  source: 'test-mode',
}

/** Raw text that is not JSON at all. */
export const INVALID_JSON = 'This is not JSON. It is just a sentence with no braces.'

/**
 * JSON wrapped in markdown fences with trailing conversational text. The
 * normalizer must strip the fence + extract the object and parse it cleanly.
 */
export const MALFORMED_JSON = [
  '```json',
  JSON.stringify({
    schema_version: 1,
    database_version: '1.0.1',
    changes: [baseChange('tpl-malformed', 'Malformed', 'Recovered from markdown fences.')],
    generatedAt: NOW,
    source: 'test-mode',
  }, null, 2),
  '```',
  '',
  'Hope this helps! Let me know if you need anything else.',
].join('\n')

/**
 * Map of test-mode fixture name → raw string (as a provider would return).
 * `updateService` picks one based on `setTestMode(<name|true>)`.
 */
export const TEST_PACKAGES = {
  VALID_UPDATE: JSON.stringify(VALID_UPDATE),
  INVALID_JSON,
  INVALID_SCHEMA: JSON.stringify(INVALID_SCHEMA),
  DUPLICATE_RECORD: JSON.stringify(DUPLICATE_RECORD),
  VERSION_CONFLICT: JSON.stringify(VERSION_CONFLICT),
  MALFORMED_JSON,
} as const

export type TestPackageName = keyof typeof TEST_PACKAGES
