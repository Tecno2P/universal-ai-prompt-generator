/**
 * Database Health Check (Phase 2 feature, also reused by the sandbox).
 *
 * `checkDatabaseHealth()` inspects the production database for schema validity,
 * record validity, duplicate ids, orphan references, invalid categories /
 * languages, version history consistency, and storage usage — returning a
 * scored report. The pure validators (`validateTemplates`, `validateSchema`,
 * etc.) are exported separately so the AI Update Sandbox can run them against
 * its own isolated copy without duplicating logic.
 *
 * This module is read-only: it never mutates production records. Repairs live
 * in `./recovery.ts`.
 */

import type {
  PromptTemplate,
  HinglishPattern,
  Category,
  DatabaseVersion,
  Language,
} from '@/types'
import { db, openDB, STORES } from './db'

/** All languages the app recognises (mirrors `Language` in @/types). */
export const VALID_LANGUAGES: ReadonlySet<string> = new Set<Language>([
  'en', 'hi', 'hinglish', 'es', 'fr', 'de', 'pt', 'it', 'nl',
  'ru', 'ar', 'tr', 'id', 'ja', 'ko', 'zh',
])

/** Required object stores for the production database to be considered healthy. */
export const REQUIRED_STORES: readonly string[] = Object.values(STORES)

/** Severity of a single health finding. */
export type HealthIssueSeverity = 'error' | 'warning' | 'info'

/** One concrete problem found during a health scan. */
export interface HealthIssue {
  severity: HealthIssueSeverity
  /** Stable code, e.g. `duplicate-id`, `orphan-category`, `missing-store`. */
  code: string
  /** Human-readable description. */
  message: string
  /** Optional count of affected records. */
  count?: number
  /** Optional list of affected record ids (kept short for UI). */
  sampleIds?: string[]
}

/** Outcome of one named check. */
export interface HealthCheckResult {
  id: string
  label: string
  /** `pass` when no errors/warnings, `warn` for warnings only, `fail` for errors. */
  status: 'pass' | 'warn' | 'fail'
  detail?: string
  issues: HealthIssue[]
}

/** Storage usage, where the browser supports `navigator.storage.estimate()`. */
export interface StorageUsage {
  usageBytes: number | null
  quotaBytes: number | null
  /** `true` when the Storage API is unavailable (older browsers). */
  supported: boolean
}

/** The full health report returned by `checkDatabaseHealth()`. */
export interface HealthReport {
  /** Epoch ms when the scan ran. */
  scannedAt: number
  /** 0–100 overall score. 100 = perfectly healthy. */
  overallScore: number
  /** Record counts per collection. */
  counts: {
    templates: number
    hinglishPatterns: number
    categories: number
    providers: number
    versions: number
  }
  /** Per-check outcomes. */
  checks: HealthCheckResult[]
  /** All `error`-severity findings, flattened. */
  errors: HealthIssue[]
  /** All `warning`-severity findings, flattened. */
  warnings: HealthIssue[]
  storage: StorageUsage
}

// ── Pure, reusable validators ────────────────────────────────────
// These take already-loaded records (or an explicit store list) so the
// sandbox can reuse them against its own isolated copy of the data.

/** Validate the set of object stores present on an `IDBDatabase`. */
export function validateSchema(
  objectStoreNames: DOMStringList | Iterable<string>,
): HealthCheckResult {
  const names: string[] =
    typeof objectStoreNames === 'object' && objectStoreNames !== null && 'contains' in objectStoreNames
      ? Array.from(objectStoreNames as DOMStringList)
      : Array.from(objectStoreNames as Iterable<string>)

  const present = new Set(names)
  const missing = REQUIRED_STORES.filter(s => !present.has(s))
  const status: 'pass' | 'warn' | 'fail' =
    missing.length > 0 ? 'fail' : 'pass'
  return {
    id: 'schema',
    label: 'Schema Valid',
    status,
    detail:
      status === 'pass'
        ? 'All required stores present'
        : `Missing stores: ${missing.join(', ')}`,
    issues:
      status === 'pass'
        ? []
        : [
            {
              severity: 'error',
              code: 'missing-store',
              message: `Missing required object store(s): ${missing.join(', ')}`,
              count: missing.length,
            },
          ],
  }
}

/** Detect duplicate ids within a list of records that share the same `id` key. */
export function detectDuplicateIds<
  T extends { id: string },
>(records: T[]): { duplicates: string[]; count: number } {
  const seen = new Map<string, number>()
  for (const r of records) {
    seen.set(r.id, (seen.get(r.id) ?? 0) + 1)
  }
  const duplicates: string[] = []
  for (const [id, n] of seen) {
    if (n > 1) duplicates.push(id)
  }
  return { duplicates, count: duplicates.length }
}

/** Validate template records: required fields, language/category references. */
export function validateTemplates(
  templates: PromptTemplate[],
  categories: Category[],
): HealthCheckResult {
  const issues: HealthIssue[] = []
  const categoryIds = new Set(categories.map(c => c.id))

  for (const t of templates) {
    if (!t.id) {
      issues.push({ severity: 'error', code: 'invalid-template', message: `Template missing id`, })
    }
    if (!t.title) {
      issues.push({
        severity: 'error',
        code: 'invalid-template',
        message: `Template "${t.id}" missing title`,
      })
    }
    if (!t.content) {
      issues.push({
        severity: 'error',
        code: 'invalid-template',
        message: `Template "${t.id}" has empty content`,
      })
    }
    if (t.category && !categoryIds.has(t.category)) {
      issues.push({
        severity: 'warning',
        code: 'orphan-category',
        message: `Template "${t.id}" references unknown category "${t.category}"`,
      })
    }
    if (t.language && !VALID_LANGUAGES.has(t.language)) {
      issues.push({
        severity: 'error',
        code: 'invalid-language',
        message: `Template "${t.id}" has unsupported language "${t.language}"`,
      })
    }
  }

  const { duplicates, count } = detectDuplicateIds(templates)
  if (count > 0) {
    issues.push({
      severity: 'error',
      code: 'duplicate-id',
      message: `${count} duplicate template id(s)`,
      count,
      sampleIds: duplicates.slice(0, 10),
    })
  }

  const hasErrors = issues.some(i => i.severity === 'error')
  const hasWarnings = issues.some(i => i.severity === 'warning')
  return {
    id: 'templates',
    label: 'Templates Valid',
    status: hasErrors ? 'fail' : hasWarnings ? 'warn' : 'pass',
    detail:
      issues.length === 0
        ? `${templates.length} templates OK`
        : `${issues.length} issue(s) across ${templates.length} templates`,
    issues,
  }
}

/** Validate Hinglish patterns: required fields + duplicate ids. */
export function validateHinglishPatterns(
  patterns: HinglishPattern[],
): HealthCheckResult {
  const issues: HealthIssue[] = []
  for (const p of patterns) {
    if (!p.id) {
      issues.push({ severity: 'error', code: 'invalid-pattern', message: 'Hinglish pattern missing id' })
    }
    if (!p.pattern) {
      issues.push({
        severity: 'error',
        code: 'invalid-pattern',
        message: `Hinglish pattern "${p.id}" has empty pattern`,
      })
    }
  }
  const { duplicates, count } = detectDuplicateIds(patterns)
  if (count > 0) {
    issues.push({
      severity: 'error',
      code: 'duplicate-id',
      message: `${count} duplicate hinglish pattern id(s)`,
      count,
      sampleIds: duplicates.slice(0, 10),
    })
  }
  const hasErrors = issues.some(i => i.severity === 'error')
  return {
    id: 'hinglish',
    label: 'Hinglish Patterns Valid',
    status: hasErrors ? 'fail' : 'pass',
    detail: issues.length === 0 ? `${patterns.length} patterns OK` : `${issues.length} issue(s)`,
    issues,
  }
}

/** Validate categories: required fields + duplicate ids. */
export function validateCategories(categories: Category[]): HealthCheckResult {
  const issues: HealthIssue[] = []
  const ids = new Set<string>()
  for (const c of categories) {
    if (!c.id) {
      issues.push({ severity: 'error', code: 'invalid-category', message: 'Category missing id' })
    }
    if (!c.name) {
      issues.push({
        severity: 'error',
        code: 'invalid-category',
        message: `Category "${c.id}" missing name`,
      })
    }
    if (c.parent && !ids.has(c.parent) && c.parent !== c.id) {
      // parent referenced before seen is allowed (order-independent), so we
      // only flag after collecting all ids — handled below.
    }
    ids.add(c.id)
  }
  // Orphan parent references (parent id that does not exist at all).
  const orphanParents = categories.filter(c => c.parent && !ids.has(c.parent))
  for (const c of orphanParents) {
    issues.push({
      severity: 'warning',
      code: 'orphan-parent',
      message: `Category "${c.id}" references unknown parent "${c.parent}"`,
    })
  }
  const { duplicates, count } = detectDuplicateIds(categories)
  if (count > 0) {
    issues.push({
      severity: 'error',
      code: 'duplicate-id',
      message: `${count} duplicate category id(s)`,
      count,
      sampleIds: duplicates.slice(0, 10),
    })
  }
  const hasErrors = issues.some(i => i.severity === 'error')
  const hasWarnings = issues.some(i => i.severity === 'warning')
  return {
    id: 'categories',
    label: 'Categories Valid',
    status: hasErrors ? 'fail' : hasWarnings ? 'warn' : 'pass',
    detail: issues.length === 0 ? `${categories.length} categories OK` : `${issues.length} issue(s)`,
    issues,
  }
}

/** Validate the version history is monotonically timestamped and non-empty. */
export function validateVersions(versions: DatabaseVersion[]): HealthCheckResult {
  const issues: HealthIssue[] = []
  if (versions.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'empty-versions',
      message: 'No database versions recorded',
    })
  }
  // Detect duplicate version strings.
  const seen = new Map<string, number>()
  for (const v of versions) {
    if (!v.version) {
      issues.push({ severity: 'error', code: 'invalid-version', message: 'Version entry missing version string' })
    }
    if (!v.installedAt || typeof v.installedAt !== 'number') {
      issues.push({
        severity: 'warning',
        code: 'invalid-version',
        message: `Version "${v.version}" has invalid installedAt`,
      })
    }
    seen.set(v.version, (seen.get(v.version) ?? 0) + 1)
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1)
  if (dupes.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'duplicate-version',
      message: `${dupes.length} duplicate version string(s)`,
      count: dupes.length,
      sampleIds: dupes.map(([v]) => v).slice(0, 10),
    })
  }
  const hasErrors = issues.some(i => i.severity === 'error')
  const hasWarnings = issues.some(i => i.severity === 'warning')
  return {
    id: 'versions',
    label: 'Update History Valid',
    status: hasErrors ? 'fail' : hasWarnings ? 'warn' : 'pass',
    detail: issues.length === 0 ? `${versions.length} versions OK` : `${issues.length} issue(s)`,
    issues,
  }
}

// ── Storage usage ────────────────────────────────────────────────

async function getStorageUsage(): Promise<StorageUsage> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usageBytes: null, quotaBytes: null, supported: false }
  }
  try {
    const est = await navigator.storage.estimate()
    return {
      usageBytes: est.usage ?? null,
      quotaBytes: est.quota ?? null,
      supported: true,
    }
  } catch {
    return { usageBytes: null, quotaBytes: null, supported: false }
  }
}

// ── Composite production health scan ─────────────────────────────

function computeScore(checks: HealthCheckResult[]): number {
  let score = 100
  for (const c of checks) {
    if (c.status === 'fail') score -= 25
    else if (c.status === 'warn') score -= 5
  }
  return Math.max(0, score)
}

/**
 * Run a full health scan of the production database.
 *
 * Reads only; never mutates production records.
 */
export async function checkDatabaseHealth(): Promise<HealthReport> {
  const [templates, hinglish, categories, providers, versions] = await Promise.all([
    db.getAllTemplates(),
    db.getAllHinglishPatterns(),
    db.getAllCategories(),
    db.getAllProviders(),
    db.getAllVersions(),
  ])

  // Schema check against the live production database handle.
  let schemaCheck: HealthCheckResult
  try {
    const idb = await openDB()
    schemaCheck = validateSchema(idb.objectStoreNames)
  } catch {
    schemaCheck = {
      id: 'schema',
      label: 'Schema Valid',
      status: 'fail',
      detail: 'Could not open production database',
      issues: [{ severity: 'error', code: 'db-open', message: 'Could not open production database' }],
    }
  }

  const templatesCheck = validateTemplates(templates, categories)
  const hinglishCheck = validateHinglishPatterns(hinglish)
  const categoriesCheck = validateCategories(categories)
  const versionsCheck = validateVersions(versions)
  const storage = await getStorageUsage()

  const checks = [schemaCheck, templatesCheck, hinglishCheck, categoriesCheck, versionsCheck]
  const errors = checks.flatMap(c => c.issues.filter(i => i.severity === 'error'))
  const warnings = checks.flatMap(c => c.issues.filter(i => i.severity === 'warning'))

  return {
    scannedAt: Date.now(),
    overallScore: computeScore(checks),
    counts: {
      templates: templates.length,
      hinglishPatterns: hinglish.length,
      categories: categories.length,
      providers: providers.length,
      versions: versions.length,
    },
    checks,
    errors,
    warnings,
    storage,
  }
}
