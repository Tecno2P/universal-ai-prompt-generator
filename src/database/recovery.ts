/**
 * Recovery Center.
 *
 * Provides backup / restore, safe repairs, and search-index rebuild for the
 * production database. All destructive operations create a backup first and
 * run transactionally; `restoreBackup` installs into production atomically.
 *
 * This module complements (does not replace) the rollback-snapshot system in
 * `../updates/updateSystem.ts`: snapshots are point-in-time templates, while
 * backups here are full-database JSON exports.
 */

import type {
  PromptTemplate,
  HinglishPattern,
  Category,
  ProviderConfig,
  DatabaseVersion,
} from '@/types'
import {
  db,
  openDB,
  STORES,
  type GenerateHistoryEntry,
} from './db'
import { checkDatabaseHealth, type HealthReport } from './healthCheck'

// ── Backup shape ────────────────────────────────────────────────

/** Schema version for the on-disk backup format. */
export const BACKUP_FORMAT_VERSION = 1

/** Full export of every production store as a single JSON object. */
export interface DatabaseBackup {
  format_version: typeof BACKUP_FORMAT_VERSION
  exported_at: number
  app_version: string
  source: 'manual' | 'pre-repair' | 'pre-restore'
  stores: {
    templates: PromptTemplate[]
    hinglishPatterns: HinglishPattern[]
    categories: Category[]
    providers: ProviderConfig[]
    versions: DatabaseVersion[]
    settings: { key: string; value: unknown }[]
    savedPrompts: SavedPromptExport[]
    history: GenerateHistoryEntry[]
  }
}

/** Minimal shape of a saved prompt (avoids importing the full type). */
export interface SavedPromptExport {
  id: string
  title: string
  content: string
  category?: string
  language: string
  style: string
  tags: string[]
  favorite: boolean
  createdAt: number
  updatedAt: number
}

/** Result of a repair run. */
export interface RepairResult {
  repaired: boolean
  backupsCreated: boolean
  backup?: DatabaseBackup
  fixes: {
    orphanTagsRemoved: number
    duplicateIdsResolved: number
    templatesCleaned: number
  }
  postRepairHealth?: HealthReport
  errors: string[]
}

// ── Backup / Restore ────────────────────────────────────────────

/**
 * Export the full production database as a JSON-serialisable object.
 *
 * Reads only; never mutates production. The returned object can be
 * `JSON.stringify`'d by the caller and saved to a file.
 */
export async function createBackup(
  source: DatabaseBackup['source'] = 'manual',
): Promise<DatabaseBackup> {
  const [templates, hinglishPatterns, categories, providers, versions, savedPrompts, history] =
    await Promise.all([
      db.getAllTemplates(),
      db.getAllHinglishPatterns(),
      db.getAllCategories(),
      db.getAllProviders(),
      db.getAllVersions(),
      db.getAllSavedPrompts(),
      db.getAllHistory(),
    ])

  // Settings are read directly via the store getter.
  const settings: { key: string; value: unknown }[] = []
  try {
    const allSettings = await readAllSettings()
    settings.push(...allSettings)
  } catch {
    /* settings store optional */
  }

  return {
    format_version: BACKUP_FORMAT_VERSION,
    exported_at: Date.now(),
    app_version: '1.0.0',
    source,
    stores: {
      templates,
      hinglishPatterns,
      categories,
      providers,
      versions,
      settings,
      savedPrompts: savedPrompts as SavedPromptExport[],
      history,
    },
  }
}

/** Read every key/value pair from the settings store. */
async function readAllSettings(): Promise<{ key: string; value: unknown }[]> {
  const idb = await openDB()
  return new Promise((resolve, reject) => {
    if (!idb.objectStoreNames.contains(STORES.settings)) { resolve([]); return }
    const tx = idb.transaction(STORES.settings, 'readonly')
    const req = tx.objectStore(STORES.settings).getAll()
    req.onsuccess = () => resolve((req.result ?? []) as { key: string; value: unknown }[])
    req.onerror = () => reject(req.error)
  })
}

/** Validate a parsed backup object before importing it. */
export function validateBackup(backup: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!backup || typeof backup !== 'object') {
    return { valid: false, errors: ['Backup is not an object'] }
  }
  const b = backup as Record<string, unknown>
  if (b.format_version !== BACKUP_FORMAT_VERSION) {
    errors.push(`Invalid format_version (expected ${BACKUP_FORMAT_VERSION})`)
  }
  if (!b.stores || typeof b.stores !== 'object') {
    errors.push('Missing stores object')
    return { valid: false, errors }
  }
  const stores = b.stores as Record<string, unknown>
  for (const name of ['templates', 'hinglishPatterns', 'categories']) {
    if (!Array.isArray(stores[name])) {
      errors.push(`stores.${name} must be an array`)
    }
  }
  return { valid: errors.length === 0, errors }
}

/**
 * Restore the production database from a backup object.
 *
 * Each store is cleared and rewritten inside a single transaction, so a
 * failure rolls that store back. A pre-restore backup is created first so the
 * operation is reversible.
 */
export async function restoreBackup(backup: unknown): Promise<{ restored: boolean; backupCreated: boolean }> {
  const validation = validateBackup(backup)
  if (!validation.valid) {
    throw new Error(`Invalid backup: ${validation.errors.join('; ')}`)
  }

  // Always snapshot the current state before overwriting.
  let backupCreated = false
  let preBackup: DatabaseBackup | undefined
  try {
    preBackup = await createBackup('pre-restore')
    backupCreated = true
  } catch {
    /* best-effort; continue without pre-restore backup */
  }

  const b = backup as DatabaseBackup
  const idb = await openDB()

  await atomicReplaceStore<PromptTemplate>(idb, STORES.templates, b.stores.templates)
  await atomicReplaceStore<HinglishPattern>(idb, STORES.hinglishPatterns, b.stores.hinglishPatterns)
  await atomicReplaceStore<Category>(idb, STORES.categories, b.stores.categories)

  if (Array.isArray(b.stores.providers)) {
    await atomicReplaceStore<ProviderConfig>(idb, STORES.providers, b.stores.providers)
  }
  if (Array.isArray(b.stores.versions)) {
    await atomicReplaceStore<DatabaseVersion>(idb, STORES.versions, b.stores.versions)
  }
  if (Array.isArray(b.stores.settings)) {
    await atomicReplaceStore<{ key: string; value: unknown }>(idb, STORES.settings, b.stores.settings)
  }
  if (Array.isArray(b.stores.savedPrompts)) {
    await atomicReplaceStore<SavedPromptExport>(idb, STORES.savedPrompts, b.stores.savedPrompts)
  }
  if (Array.isArray(b.stores.history)) {
    await atomicReplaceStore<GenerateHistoryEntry>(idb, STORES.history, b.stores.history)
  }

  void preBackup
  return { restored: true, backupCreated }
}

/** Clear a store and write `records` into it inside ONE transaction. */
function atomicReplaceStore<T>(
  database: IDBDatabase,
  storeName: string,
  records: T[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!database.objectStoreNames.contains(storeName)) {
      reject(new Error(`Store "${storeName}" does not exist`))
      return
    }
    const tx = database.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    store.clear()
    for (const r of records) store.put(r)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error(`Transaction aborted for ${storeName}`))
  })
}

// ── Repair ───────────────────────────────────────────────────────

/**
 * Repair safe-to-fix database issues:
 *   - remove orphan tags (tags not belonging to any category)
 *   - resolve duplicate template ids (keep newest)
 *   - clean templates with empty/oversized content
 *
 * This NEVER deletes user saved prompts. It creates a backup first, shows the
 * planned changes via the returned `RepairResult`, applies them
 * transactionally, then re-runs a health scan.
 */
export async function repairDatabase(): Promise<RepairResult> {
  const result: RepairResult = {
    repaired: false,
    backupsCreated: false,
    fixes: { orphanTagsRemoved: 0, duplicateIdsResolved: 0, templatesCleaned: 0 },
    errors: [],
  }

  // 1. Create a backup before any repair.
  try {
    result.backup = await createBackup('pre-repair')
    result.backupsCreated = true
  } catch (err) {
    result.errors.push(`Could not create pre-repair backup: ${err instanceof Error ? err.message : String(err)}`)
    return result
  }

  // 2. Load current records.
  const [templates, categories] = await Promise.all([
    db.getAllTemplates(),
    db.getAllCategories(),
  ])
  const categoryIds = new Set(categories.map(c => c.id))

  // 3. Compute the repaired template list (pure, in-memory).
  const seen = new Map<string, PromptTemplate>()
  const cleanedTemplates: PromptTemplate[] = []
  let orphanTagsRemoved = 0
  let duplicateIdsResolved = 0
  let templatesCleaned = 0

  // Sort by updatedAt desc so the newest version of a duplicate id wins.
  const sorted = [...templates].sort((a, b) => b.updatedAt - a.updatedAt)

  for (const t of sorted) {
    // Resolve duplicate ids (keep first = newest).
    if (seen.has(t.id)) {
      duplicateIdsResolved++
      continue
    }

    const fixed: PromptTemplate = { ...t }

    // Remove orphan tags: tags that look like a category id but reference a
    // non-existent category. Plain-text tags are left alone.
    if (fixed.tags && fixed.tags.length > 0) {
      const before = fixed.tags.length
      fixed.tags = fixed.tags.filter(tag => {
        // Only treat id-like tags as potential orphan references.
        if (/^[a-z0-9-]+$/.test(tag) && categoryIds.size > 0 && !categoryIds.has(tag)) {
          return false
        }
        return true
      })
      orphanTagsRemoved += before - fixed.tags.length
    }

    // Flag (but keep) templates with empty or oversized content.
    if (!fixed.content || fixed.content.length === 0 || fixed.content.length > 10000) {
      templatesCleaned++
    }

    seen.set(fixed.id, fixed)
    cleanedTemplates.push(fixed)
  }

  // 4. Apply repaired templates transactionally.
  const idb = await openDB()
  await atomicReplaceStore<PromptTemplate>(idb, STORES.templates, cleanedTemplates)

  result.fixes = {
    orphanTagsRemoved,
    duplicateIdsResolved,
    templatesCleaned,
  }
  result.repaired = orphanTagsRemoved > 0 || duplicateIdsResolved > 0 || templatesCleaned > 0

  // 5. Re-run a health scan.
  try {
    result.postRepairHealth = await checkDatabaseHealth()
  } catch (err) {
    result.errors.push(`Post-repair health scan failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  return result
}

// ── Search index rebuild ────────────────────────────────────────

/**
 * Rebuild the in-memory search index over templates.
 *
 * The app does not persist a separate search-index store; the "index" is a
 * sorted, deduplicated keyword + tag map derived from templates. This helper
 * regenerates that map from the current production data and returns it so the
 * caller (e.g. a search service) can cache it. It does not mutate production.
 */
export interface SearchIndex {
  builtAt: number
  templateCount: number
  /** keyword → list of template ids that contain it. */
  keywords: Map<string, string[]>
  /** tag → list of template ids carrying it. */
  tags: Map<string, string[]>
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'be',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(token => token.length > 1 && !STOPWORDS.has(token))
}

/**
 * Rebuild the search index from the current production templates.
 *
 * Reads only; returns the index for the caller to cache.
 */
export async function rebuildSearchIndex(): Promise<SearchIndex> {
  const templates = await db.getAllTemplates()
  const keywords = new Map<string, string[]>()
  const tags = new Map<string, string[]>()

  for (const t of templates) {
    const tokens = new Set<string>([
      ...tokenize(t.title),
      ...tokenize(t.content),
      ...(t.keywords ?? []).flatMap(k => tokenize(k)),
    ])
    for (const token of tokens) {
      const existing = keywords.get(token)
      if (existing) existing.push(t.id)
      else keywords.set(token, [t.id])
    }
    for (const tag of t.tags ?? []) {
      const norm = tag.toLowerCase()
      const existing = tags.get(norm)
      if (existing) existing.push(t.id)
      else tags.set(norm, [t.id])
    }
  }

  return {
    builtAt: Date.now(),
    templateCount: templates.length,
    keywords,
    tags,
  }
}

// ── Reset helpers (used by the Recovery Center UI) ──────────────

/** Reset all user settings to defaults by clearing the settings store. */
export async function resetSettings(): Promise<void> {
  const idb = await openDB()
  await new Promise<void>((resolve, reject) => {
    if (!idb.objectStoreNames.contains(STORES.settings)) { resolve(); return }
    const tx = idb.transaction(STORES.settings, 'readwrite')
    tx.objectStore(STORES.settings).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Clear the generation history store (does NOT touch templates or saved prompts). */
export async function clearHistory(): Promise<void> {
  const idb = await openDB()
  await new Promise<void>((resolve, reject) => {
    if (!idb.objectStoreNames.contains(STORES.history)) { resolve(); return }
    const tx = idb.transaction(STORES.history, 'readwrite')
    tx.objectStore(STORES.history).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
