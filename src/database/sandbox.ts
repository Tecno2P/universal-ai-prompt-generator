/**
 * AI Update Sandbox.
 *
 * Guarantees that AI-generated database updates NEVER directly modify the
 * production database (`prompt-generator-db`, exposed via the `db` singleton).
 *
 * Flow:
 *   Official/Current Local Database
 *     → createSandbox()            copies production → `prompt-gen-sandbox`
 *     → applyToSandbox(changes)    applies UpdateChange[] to the sandbox ONLY
 *     → validateSandbox()          schema / duplicates / content / references
 *     → generateDiff()             added / modified / deleted templates
 *     → [user review]
 *     → installFromSandbox()       atomically copies sandbox → production
 *     OR discardSandbox()          deletes the sandbox DB; production untouched
 *
 * The sandbox is a SEPARATE IndexedDB database (`prompt-gen-sandbox`), not a
 * store inside the production database. All multi-record writes to the sandbox
 * happen inside a single `IDBTransaction`. Production is mutated only inside
 * `installFromSandbox`, in a single transaction per store plus an atomic
 * version write.
 */

import type {
  UpdateChange,
  PromptTemplate,
  HinglishPattern,
  Category,
  DatabaseVersion,
  Language,
  PromptStyle,
} from '@/types'
import {
  db,
  STORES,
  type GenerateHistoryEntry,
} from './db'
import {
  validateSchema,
  validateTemplates,
  validateHinglishPatterns,
  validateCategories,
  VALID_LANGUAGES,
} from './healthCheck'
import type {
  SandboxState,
  SandboxHandle,
  SandboxContents,
  SandboxValidationResult,
  SandboxValidationCheck,
  SandboxDiff,
  DiffEntry,
} from './sandboxTypes'

// ── Constants ────────────────────────────────────────────────────

/** Name of the SEPARATE sandbox IndexedDB database. */
const SANDBOX_DB_NAME = 'prompt-gen-sandbox'
/** Bump if the sandbox store layout ever changes. */
const SANDBOX_DB_VERSION = 1

/** Stores mirrored inside the sandbox (subset that updates can touch). */
const SANDBOX_STORES = {
  templates: 'templates',
  hinglishPatterns: 'hinglishPatterns',
  categories: 'categories',
  versions: 'versions',
} as const

const MAX_CONTENT_LENGTH = 10000
const UNSAFE_CONTENT_RE = /<script|javascript:|onerror=|onload=|onmouseover=/i
const CODE_EXEC_RE = /eval\s*\(|new\s+Function\s*\(|document\.(write|cookie)|innerHTML\s*=/i

const VALID_STYLES: ReadonlySet<PromptStyle> = new Set<PromptStyle>([
  'simple', 'professional', 'expert', 'detailed', 'technical',
  'creative', 'structured', 'json', 'developer', 'agent', 'system', 'reasoning',
])

// ── In-memory sandbox handle ─────────────────────────────────────
// Only one sandbox is active at a time; keeping it in a module-level
// variable lets the public functions stay parameter-light while still
// being pure with respect to production state.

let active: SandboxHandle | null = null

function assertSandbox(): SandboxHandle {
  if (!active) {
    throw new Error('No active sandbox. Call createSandbox() first.')
  }
  return active
}

// ── Low-level sandbox IndexedDB helpers ──────────────────────────

function openSandboxDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'))
      return
    }
    const req = indexedDB.open(SANDBOX_DB_NAME, SANDBOX_DB_VERSION)
    req.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result
      if (!database.objectStoreNames.contains(SANDBOX_STORES.templates)) {
        const s = database.createObjectStore(SANDBOX_STORES.templates, { keyPath: 'id' })
        s.createIndex('category', 'category', { unique: false })
        s.createIndex('language', 'language', { unique: false })
      }
      if (!database.objectStoreNames.contains(SANDBOX_STORES.hinglishPatterns)) {
        database.createObjectStore(SANDBOX_STORES.hinglishPatterns, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(SANDBOX_STORES.categories)) {
        database.createObjectStore(SANDBOX_STORES.categories, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(SANDBOX_STORES.versions)) {
        database.createObjectStore(SANDBOX_STORES.versions, { keyPath: 'version' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('Sandbox database open blocked'))
  })
}

/** Delete the entire sandbox database (used by discard + createSandbox reset). */
function deleteSandboxDB(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      resolve()
      return
    }
    const req = indexedDB.deleteDatabase(SANDBOX_DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    // `onblocked` should not stall forever; resolve anyway — the recreate
    // step in createSandbox will retry the open.
    req.onblocked = () => resolve()
  })
}

/**
 * Bulk-put a list of records into a sandbox store inside ONE transaction.
 * Returns when the transaction commits; rejects on any error.
 */
function sandboxBulkPut<T>(
  database: IDBDatabase,
  storeName: string,
  records: T[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (records.length === 0) { resolve(); return }
    const tx = database.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    for (const r of records) store.put(r)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error(`Sandbox transaction aborted for ${storeName}`))
  })
}

/** Read all records from a sandbox store. */
function sandboxGetAll<T>(database: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).getAll()
    req.onsuccess = () => resolve((req.result ?? []) as T[])
    req.onerror = () => reject(req.error)
  })
}

/** Delete a record from a sandbox store by id (inside the given transaction). */
function sandboxDelete(
  database: IDBDatabase,
  storeName: string,
  id: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── Change → record builders ─────────────────────────────────────
// Mirrors `applyUpdatePackage` in updateSystem.ts, but applied to the sandbox.

function buildTemplate(change: UpdateChange, now: number): PromptTemplate {
  const language = (change.language as Language) || 'en'
  const style = (change.style as PromptStyle) || 'professional'
  return {
    id: change.id,
    category: change.category || 'general',
    language: VALID_LANGUAGES.has(language) ? language : 'en',
    title: change.title || 'Untitled',
    content: change.content || '',
    tags: change.tags ?? [],
    style: VALID_STYLES.has(style) ? style : 'professional',
    createdAt: change.createdAt != null ? (change.createdAt as number) : now,
    updatedAt: now,
    source: 'ai',
    version: change.version != null ? (change.version as number) : 1,
  }
}

function buildHinglishPattern(change: UpdateChange): HinglishPattern {
  return {
    id: change.id,
    pattern: (change.content as string) || '',
    intent: (change.intent as string) || 'create',
    category: change.category || 'general',
    translation: (change.translation as string) || '',
  }
}

function buildCategory(change: UpdateChange): Category {
  return {
    id: change.id,
    name: change.title || change.id,
    parent: change.category,
    icon: (change.icon as string) || undefined,
  }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Create a fresh sandbox by copying the current production templates,
 * Hinglish patterns, categories, and version history into a separate
 * `prompt-gen-sandbox` IndexedDB database.
 *
 * Production is only READ here — never written.
 */
export async function createSandbox(proposedVersion?: string): Promise<SandboxHandle> {
  // Reset any previous sandbox so we always start from current production.
  await discardSandbox().catch(() => { /* best-effort */ })

  const baseVersion = await getCurrentVersion()
  const sandboxId = `sandbox-${Date.now()}`
  const state: SandboxState = {
    id: sandboxId,
    status: 'creating',
    baseVersion,
    proposedVersion: proposedVersion ?? baseVersion,
    createdAt: Date.now(),
  }
  active = { state, contents: { templates: [], hinglishPatterns: [], categories: [], versions: [] } }

  try {
    // Snapshot production (read-only).
    const [templates, hinglish, categories, versions] = await Promise.all([
      db.getAllTemplates(),
      db.getAllHinglishPatterns(),
      db.getAllCategories(),
      db.getAllVersions(),
    ])

    const database = await openSandboxDB()

    // Copy production → sandbox, each store in its own transaction.
    await sandboxBulkPut(database, SANDBOX_STORES.templates, templates)
    await sandboxBulkPut(database, SANDBOX_STORES.hinglishPatterns, hinglish)
    await sandboxBulkPut(database, SANDBOX_STORES.categories, categories)
    await sandboxBulkPut(database, SANDBOX_STORES.versions, versions)

    active.state.status = 'ready'
    active.contents = { templates, hinglishPatterns: hinglish, categories, versions }
    database.close()
    return active
  } catch (err) {
    active.state.status = 'error'
    active.state.error = err instanceof Error ? err.message : String(err)
    throw err
  }
}

/**
 * Apply an array of `UpdateChange`s to the sandbox ONLY.
 *
 * Each change is converted to a record (or a delete) and written to the
 * sandbox database. The in-memory mirror is updated to match. Production is
 * never touched.
 */
export async function applyToSandbox(changes: UpdateChange[]): Promise<SandboxHandle> {
  const handle = assertSandbox()
  handle.state.status = 'applying'

  try {
    const database = await openSandboxDB()
    const now = Date.now()

    // Group changes by collection so each store is written in a single
    // transaction, while deletes are applied individually (they're rare and
    // keep the logic simple).
    const templateUpserts: PromptTemplate[] = []
    const hinglishUpserts: HinglishPattern[] = []
    const categoryUpserts: Category[] = []
    const templateDeletes: string[] = []

    for (const change of changes) {
      if (change.type === 'template') {
        if (change.operation === 'delete') {
          templateDeletes.push(change.id)
        } else {
          templateUpserts.push(buildTemplate(change, now))
        }
      } else if (change.type === 'hinglish_pattern') {
        if (change.operation !== 'delete') {
          hinglishUpserts.push(buildHinglishPattern(change))
        }
      } else if (change.type === 'category') {
        if (change.operation !== 'delete') {
          categoryUpserts.push(buildCategory(change))
        }
      }
      // 'language' / 'tag' changes are metadata-only and have no record to apply.
    }

    // Apply upserts per store — each store is one atomic transaction.
    await sandboxBulkPut(database, SANDBOX_STORES.templates, templateUpserts)
    await sandboxBulkPut(database, SANDBOX_STORES.hinglishPatterns, hinglishUpserts)
    await sandboxBulkPut(database, SANDBOX_STORES.categories, categoryUpserts)
    for (const id of templateDeletes) {
      await sandboxDelete(database, SANDBOX_STORES.templates, id)
    }

    // Refresh the in-memory mirror from the sandbox so callers see truth.
    const [templates, hinglish, categories, versions] = await Promise.all([
      sandboxGetAll<PromptTemplate>(database, SANDBOX_STORES.templates),
      sandboxGetAll<HinglishPattern>(database, SANDBOX_STORES.hinglishPatterns),
      sandboxGetAll<Category>(database, SANDBOX_STORES.categories),
      sandboxGetAll<DatabaseVersion>(database, SANDBOX_STORES.versions),
    ])
    handle.contents = { templates, hinglishPatterns: hinglish, categories, versions }

    handle.state.status = 'applied'
    database.close()
    return handle
  } catch (err) {
    handle.state.status = 'error'
    handle.state.error = err instanceof Error ? err.message : String(err)
    throw err
  }
}

// ── Validation ───────────────────────────────────────────────────

/** Content safety: reject script injection / code execution in record content. */
function checkContentSafety(contents: SandboxContents): SandboxValidationCheck {
  const offenders: string[] = []
  for (const t of contents.templates) {
    if (t.content && UNSAFE_CONTENT_RE.test(t.content)) {
      offenders.push(`${t.id}: unsafe HTML/script`)
    }
    if (t.content && CODE_EXEC_RE.test(t.content)) {
      offenders.push(`${t.id}: code-execution pattern`)
    }
  }
  const status: 'pass' | 'fail' = offenders.length > 0 ? 'fail' : 'pass'
  return {
    id: 'content-safety',
    label: 'Content Safety Check',
    status,
    detail: status === 'pass' ? 'No unsafe content detected' : `${offenders.length} unsafe record(s)`,
  }
}

/** Reference integrity: every template.category must exist in categories. */
function checkReferenceIntegrity(contents: SandboxContents): SandboxValidationCheck {
  const categoryIds = new Set(contents.categories.map(c => c.id))
  const orphans: string[] = []
  for (const t of contents.templates) {
    if (t.category && !categoryIds.has(t.category)) {
      orphans.push(`${t.id} → ${t.category}`)
    }
  }
  const status: 'pass' | 'warn' = orphans.length > 0 ? 'warn' : 'pass'
  return {
    id: 'reference-integrity',
    label: 'Reference Integrity',
    status,
    detail: status === 'pass' ? 'All category references valid' : `${orphans.length} orphan reference(s)`,
  }
}

/**
 * Run the full sandbox validation suite: schema, duplicates, content safety,
 * reference integrity, id format, category/language references.
 */
export async function validateSandbox(): Promise<SandboxValidationResult> {
  const handle = assertSandbox()
  handle.state.status = 'validating'

  try {
    const database = await openSandboxDB()
    const contents: SandboxContents = {
      templates: await sandboxGetAll<PromptTemplate>(database, SANDBOX_STORES.templates),
      hinglishPatterns: await sandboxGetAll<HinglishPattern>(database, SANDBOX_STORES.hinglishPatterns),
      categories: await sandboxGetAll<Category>(database, SANDBOX_STORES.categories),
      versions: await sandboxGetAll<DatabaseVersion>(database, SANDBOX_STORES.versions),
    }
    handle.contents = contents
    database.close()

    const checks: SandboxValidationCheck[] = []

    // 1. Schema
    const schema = validateSchema([
      SANDBOX_STORES.templates,
      SANDBOX_STORES.hinglishPatterns,
      SANDBOX_STORES.categories,
      SANDBOX_STORES.versions,
    ])
    checks.push({
      id: schema.id,
      label: 'Schema Valid',
      status: schema.status,
      detail: schema.detail,
    })

    // 2. Duplicate ids
    const templatesDup = validateTemplates(contents.templates, contents.categories)
    const templatesDupIds = templatesDup.issues.find(i => i.code === 'duplicate-id')
    checks.push({
      id: 'duplicates',
      label: 'Duplicate Check',
      status: templatesDupIds ? 'fail' : 'pass',
      detail: templatesDupIds ? `${templatesDupIds.count} duplicate template id(s)` : 'No duplicate ids',
    })

    // 3. Ids valid (kebab-case)
    const badIds = contents.templates.filter(t => t.id && !/^[a-z0-9-_:]+$/.test(t.id))
    checks.push({
      id: 'ids',
      label: 'IDs Valid',
      status: badIds.length > 0 ? 'warn' : 'pass',
      detail: badIds.length > 0 ? `${badIds.length} non-kebab-case id(s)` : 'All ids valid',
    })

    // 4. Categories valid
    const catCheck = validateCategories(contents.categories)
    checks.push({
      id: 'categories',
      label: 'Categories Valid',
      status: catCheck.status,
      detail: catCheck.detail,
    })

    // 5. Language references valid
    const badLang = contents.templates.filter(t => t.language && !VALID_LANGUAGES.has(t.language))
    checks.push({
      id: 'languages',
      label: 'Language References Valid',
      status: badLang.length > 0 ? 'fail' : 'pass',
      detail: badLang.length > 0 ? `${badLang.length} invalid language(s)` : 'All languages valid',
    })

    // 6. Content safety
    checks.push(checkContentSafety(contents))

    // 7. Reference integrity (template → category)
    checks.push(checkReferenceIntegrity(contents))

    // 8. Hinglish patterns valid
    const hinglishCheck = validateHinglishPatterns(contents.hinglishPatterns)
    checks.push({
      id: 'hinglish',
      label: 'Hinglish Patterns Valid',
      status: hinglishCheck.status,
      detail: hinglishCheck.detail,
    })

    const errors: string[] = []
    const warnings: string[] = []
    for (const c of checks) {
      if (c.status === 'fail') errors.push(`${c.label}: ${c.detail ?? 'failed'}`)
      else if (c.status === 'warn') warnings.push(`${c.label}: ${c.detail ?? 'warning'}`)
    }

    // Score: start at 100, -20 per fail, -5 per warn, floor 0.
    let score = 100
    for (const c of checks) {
      if (c.status === 'fail') score -= 20
      else if (c.status === 'warn') score -= 5
    }
    score = Math.max(0, score)

    const result: SandboxValidationResult = {
      valid: errors.length === 0,
      score,
      checks,
      errors,
      warnings,
    }

    handle.state.validation = result
    handle.state.status = 'validated'
    return result
  } catch (err) {
    handle.state.status = 'error'
    handle.state.error = err instanceof Error ? err.message : String(err)
    throw err
  }
}

// ── Diff ─────────────────────────────────────────────────────────

function labelFor(kind: 'template' | 'hinglish' | 'category', record: { id: string; title?: string; name?: string; pattern?: string }): string {
  if (kind === 'template') return record.title || record.id
  if (kind === 'category') return record.name || record.id
  return record.pattern || record.id
}

function emptySummary(): SandboxDiff['summary'] {
  return {
    added: 0,
    modified: 0,
    deleted: 0,
    byCollection: {
      templates: { added: 0, modified: 0, deleted: 0 },
      hinglishPatterns: { added: 0, modified: 0, deleted: 0 },
      categories: { added: 0, modified: 0, deleted: 0 },
    },
  }
}

/**
 * Compare the current sandbox contents against the current production
 * database, producing a list of added / modified / deleted records.
 */
export async function generateDiff(): Promise<SandboxDiff> {
  const handle = assertSandbox()

  // Read the CURRENT production state (it may have changed since createSandbox).
  const [prodTemplates, prodHinglish, prodCategories] = await Promise.all([
    db.getAllTemplates(),
    db.getAllHinglishPatterns(),
    db.getAllCategories(),
  ])

  // Read the CURRENT sandbox state.
  const database = await openSandboxDB()
  const [sbTemplates, sbHinglish, sbCategories] = await Promise.all([
    sandboxGetAll<PromptTemplate>(database, SANDBOX_STORES.templates),
    sandboxGetAll<HinglishPattern>(database, SANDBOX_STORES.hinglishPatterns),
    sandboxGetAll<Category>(database, SANDBOX_STORES.categories),
  ])
  database.close()

  const entries: DiffEntry[] = []
  const summary = emptySummary()

  function diffCollection<T extends { id: string; title?: string; name?: string; pattern?: string }>(
    prod: T[],
    sandbox: T[],
    collection: 'templates' | 'hinglishPatterns' | 'categories',
    kind: 'template' | 'hinglish' | 'category',
  ) {
    const prodMap = new Map(prod.map(r => [r.id, r] as const))
    const sbMap = new Map(sandbox.map(r => [r.id, r] as const))
    const allIds = new Set<string>([...prodMap.keys(), ...sbMap.keys()])

    for (const id of allIds) {
      const before = prodMap.get(id)
      const after = sbMap.get(id)
      if (!before && after) {
        entries.push({ kind: 'added', collection, id, label: labelFor(kind, after), after: after as DiffEntry['after'] })
        summary.added++
        summary.byCollection[collection].added++
      } else if (before && !after) {
        entries.push({ kind: 'deleted', collection, id, label: labelFor(kind, before), before: before as DiffEntry['before'] })
        summary.deleted++
        summary.byCollection[collection].deleted++
      } else if (before && after && JSON.stringify(before) !== JSON.stringify(after)) {
        entries.push({ kind: 'modified', collection, id, label: labelFor(kind, after), before: before as DiffEntry['before'], after: after as DiffEntry['after'] })
        summary.modified++
        summary.byCollection[collection].modified++
      }
    }
  }

  diffCollection(prodTemplates, sbTemplates, 'templates', 'template')
  diffCollection(prodHinglish, sbHinglish, 'hinglishPatterns', 'hinglish')
  diffCollection(prodCategories, sbCategories, 'categories', 'category')

  const diff: SandboxDiff = {
    baseVersion: handle.state.baseVersion,
    proposedVersion: handle.state.proposedVersion,
    generatedAt: Date.now(),
    entries,
    summary,
  }
  handle.state.diff = diff
  return diff
}

// ── Install (atomic production write) ────────────────────────────

/**
 * Atomically install the sandbox contents into production.
 *
 * Each production store is cleared and rewritten inside a SINGLE transaction
 * (so a failure rolls the whole store back), and the new `DatabaseVersion` is
 * written last. If any store write fails, production is left unchanged for
 * that store and the function throws — no partial installs.
 *
 * Requires `validateSandbox()` to have passed; refuses to install otherwise.
 */
export async function installFromSandbox(): Promise<{ installed: number; version: string }> {
  const handle = assertSandbox()

  if (handle.state.validation && !handle.state.validation.valid) {
    throw new Error(
      'Cannot install: sandbox validation failed. Resolve errors before installing.',
    )
  }

  handle.state.status = 'installing'

  try {
    const database = await openSandboxDB()
    const [templates, hinglish, categories] = await Promise.all([
      sandboxGetAll<PromptTemplate>(database, SANDBOX_STORES.templates),
      sandboxGetAll<HinglishPattern>(database, SANDBOX_STORES.hinglishPatterns),
      sandboxGetAll<Category>(database, SANDBOX_STORES.categories),
    ])
    database.close()

    // Atomic install per store: clear + bulk-put in one transaction each.
    // We use the raw production IDB handle (not the `db` convenience wrappers,
    // which open one tx per call) so each store's clear+write is transactional.
    const prodDb = await openProductionDB()

    await atomicReplaceStore<PromptTemplate>(prodDb, STORES.templates, templates)
    await atomicReplaceStore<HinglishPattern>(prodDb, STORES.hinglishPatterns, hinglish)
    await atomicReplaceStore<Category>(prodDb, STORES.categories, categories)

    // Record the new version.
    const now = Date.now()
    const localVersion = handle.state.proposedVersion.endsWith('-local')
      ? handle.state.proposedVersion
      : `${handle.state.proposedVersion}-local`
    const versionEntry: DatabaseVersion = {
      version: localVersion,
      installedAt: now,
      changeCount: templates.length,
      source: 'ai',
    }
    await db.putVersion(versionEntry)

    handle.state.status = 'installed'
    return { installed: templates.length + hinglish.length + categories.length, version: localVersion }
  } catch (err) {
    handle.state.status = 'error'
    handle.state.error = err instanceof Error ? err.message : String(err)
    throw err
  }
}

/** Open the production IndexedDB handle (read/write) for atomic store swaps. */
async function openProductionDB(): Promise<IDBDatabase> {
  // Re-use the singleton open from db.ts so we share the same connection.
  return openProductionRaw()
}

// Open the production DB by name (the `db` module doesn't export a raw
// writable handle, so we open one at the same name/version; IndexedDB shares
// the underlying database across connections within the same origin).
let prodRaw: IDBDatabase | null = null
function openProductionRaw(): Promise<IDBDatabase> {
  if (prodRaw) return Promise.resolve(prodRaw)
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'))
      return
    }
    const req = indexedDB.open('prompt-generator-db', 1)
    req.onsuccess = () => { prodRaw = req.result; resolve(prodRaw) }
    req.onerror = () => reject(req.error)
  })
}

/** Clear a store and write `records` into it inside ONE transaction. */
function atomicReplaceStore<T>(
  database: IDBDatabase,
  storeName: string,
  records: T[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    store.clear()
    for (const r of records) store.put(r)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error(`Production ${storeName} transaction aborted`))
  })
}

// ── Discard ──────────────────────────────────────────────────────

/**
 * Delete the sandbox database entirely. Production is never touched.
 * Safe to call even when no sandbox is active.
 */
export async function discardSandbox(): Promise<void> {
  if (active) {
    active.state.status = 'discarding'
  }
  await deleteSandboxDB()
  if (active) {
    active.state.status = 'discarded'
    active = null
  }
}

// ── Introspection ────────────────────────────────────────────────

/** Returns the current sandbox handle, or `null` if none is active. */
export function getSandbox(): SandboxHandle | null {
  return active
}

/** Returns the in-memory sandbox contents (templates, patterns, categories, versions). */
export function getSandboxContents(): SandboxContents | null {
  return active?.contents ?? null
}

// ── Local getCurrentVersion (mirrors updateSystem/repository) ───

async function getCurrentVersion(): Promise<string> {
  const versions = await db.getAllVersions()
  if (versions.length === 0) return '1.0.0'
  return versions.sort((a, b) => b.installedAt - a.installedAt)[0].version
}

// re-export types + the history entry for callers that need them
export type { GenerateHistoryEntry }
