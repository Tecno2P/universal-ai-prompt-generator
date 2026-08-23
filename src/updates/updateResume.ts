/**
 * Interrupted Update Resume
 *
 * Tracks resumable database-update state in localStorage (NOT IndexedDB).
 * IndexedDB writes happen *inside* an update; storing the update's own
 * progress there would mean a corrupted update could corrupt the very record
 * we need to recover from. localStorage is a simple, atomic, synchronous-ish
 * key/value store that survives a restart independently of DB integrity.
 *
 * Lifecycle:
 *   startUpdate()  → pending/downloading/validating/sandboxing/awaiting_review/installing
 *   ↓ (app crash / tab close mid-install)
 *   interrupted
 *   ↓ (app restart → verifyDatabaseIntegrity → prompt user)
 *   resumeUpdate() → resumes from last known chunk/state
 *   ↓
 *   completeUpdate() | failUpdate() | discardUpdate()
 */

import type { UpdatePackage } from '@/types'
import { openDB, STORES } from '../database/db'
import { getCurrentVersion } from './updateSystem'

// ── State ───────────────────────────────────────────────────────

export type UpdateStatus =
  | 'pending'
  | 'downloading'
  | 'validating'
  | 'sandboxing'
  | 'awaiting_review'
  | 'installing'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'rolled_back'

/** States that represent an update still in flight (not terminal). */
export const ACTIVE_STATES: ReadonlySet<UpdateStatus> = new Set<UpdateStatus>([
  'pending',
  'downloading',
  'validating',
  'sandboxing',
  'awaiting_review',
  'installing',
])

/** States that mark the update as finished (no resume needed). */
export const TERMINAL_STATES: ReadonlySet<UpdateStatus> = new Set<UpdateStatus>([
  'completed',
  'failed',
  'rolled_back',
])

export interface UpdateState {
  /** Stable id derived from the package version + source + generatedAt. */
  update_id: string
  status: UpdateStatus
  /** Index of the change chunk currently being applied (0-based). */
  current_chunk: number
  /** Total number of change chunks the update was split into. */
  total_chunks: number
  /** Epoch ms when the update was first started. */
  started_at: number
  /** Epoch ms of the last progress write. */
  updated_at: number
  /** DB version present before the update began. */
  base_version: string
  /** DB version this update targets. */
  target_version: string
  /** Serialized source of the package (for re-validation on resume). */
  source: string
  /** Full package snapshot, so a resume can re-validate without a refetch. */
  package: UpdatePackage
  /** Last error message, when status === 'failed'. */
  error?: string
  /** Number of resume attempts so far (guards against retry storms). */
  resume_attempts: number
}

// ── localStorage persistence ─────────────────────────────────────

const STORAGE_KEY = 'uapg:update-resume:v1'

function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function readStore(): Record<string, UpdateState> {
  if (!hasLocalStorage()) return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, UpdateState>
  } catch {
    // Corrupted entry — wipe so we never get stuck. The update itself lives
    // in IndexedDB and is unaffected; only the resume *index* is lost.
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch { /* ignore */ }
    return {}
  }
}

function writeStore(states: Record<string, UpdateState>): void {
  if (!hasLocalStorage()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(states))
  } catch {
    // QuotaExceeded / private mode — best effort. In-memory copy below keeps
    // the current session functional even if persistence fails.
  }
}

/** In-memory mirror so the API works even when localStorage is unavailable. */
let memoryStore: Record<string, UpdateState> = hasLocalStorage() ? readStore() : {}

function persist(state: UpdateState): UpdateState {
  memoryStore[state.update_id] = state
  writeStore(memoryStore)
  return state
}

function removeState(updateId: string): void {
  delete memoryStore[updateId]
  writeStore(memoryStore)
}

// ── Helpers ────────────────────────────────────────────────────

/** Derive a stable update id from a package so restarts find the same entry. */
export function deriveUpdateId(pkg: UpdatePackage): string {
  const fingerprint = `${pkg.database_version}|${pkg.source}|${pkg.generatedAt}|${pkg.changes.length}`
  let hash = 0
  for (let i = 0; i < fingerprint.length; i++) {
    hash = ((hash << 5) - hash + fingerprint.charCodeAt(i)) | 0
  }
  return `upd-${Math.abs(hash).toString(36)}`
}

/** Split a package's changes into evenly sized chunks for resumable apply. */
export function chunkPackage(pkg: UpdatePackage, chunkSize = 25): UpdatePackage[] {
  if (chunkSize <= 0) chunkSize = 25
  const chunks: UpdatePackage[] = []
  for (let i = 0; i < pkg.changes.length; i += chunkSize) {
    chunks.push({
      ...pkg,
      changes: pkg.changes.slice(i, i + chunkSize),
    })
  }
  return chunks.length > 0 ? chunks : [{ ...pkg, changes: [] }]
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Begin tracking a new update. Captures the current DB version as the base so
 * a later rollback knows where to return. Returns the freshly created state.
 */
export async function startUpdate(pkg: UpdatePackage): Promise<UpdateState> {
  const updateId = deriveUpdateId(pkg)
  const chunks = chunkPackage(pkg)
  const now = Date.now()
  const baseVersion = await getCurrentVersion().catch(() => '1.0.0')

  const state: UpdateState = {
    update_id: updateId,
    status: 'pending',
    current_chunk: 0,
    total_chunks: chunks.length,
    started_at: now,
    updated_at: now,
    base_version: baseVersion,
    target_version: pkg.database_version,
    source: pkg.source,
    package: pkg,
    resume_attempts: 0,
  }
  return persist(state)
}

/**
 * Record progress: which chunk just completed and the update's new status.
 * Writing on every chunk is what makes a crash lose at most one chunk.
 */
export function updateProgress(
  updateId: string,
  chunk: number,
  status: UpdateStatus,
): UpdateState | undefined {
  const existing = memoryStore[updateId]
  if (!existing) return undefined
  const next: UpdateState = {
    ...existing,
    current_chunk: Math.max(existing.current_chunk, chunk),
    status,
    updated_at: Date.now(),
  }
  return persist(next)
}

/**
 * On app restart, return any update that was left mid-flight (active state
 * without a terminal marker). Callers should run {@link verifyDatabaseIntegrity}
 * before offering the user a resume.
 */
export function getInterruptedUpdate(): UpdateState | undefined {
  const states = Object.values(memoryStore)
  // Prefer the most recently touched interrupted update if several exist.
  return states
    .filter((s) => ACTIVE_STATES.has(s.status))
    .sort((a, b) => b.updated_at - a.updated_at)[0]
}

/** Return all non-terminal updates (useful for a "pending updates" UI list). */
export function getPendingUpdates(): UpdateState[] {
  return Object.values(memoryStore)
    .filter((s) => ACTIVE_STATES.has(s.status))
    .sort((a, b) => b.updated_at - a.updated_at)
}

/** Look up a single update's tracked state. */
export function getUpdateState(updateId: string): UpdateState | undefined {
  return memoryStore[updateId]
}

/**
 * Resume an interrupted update from its last known chunk/state. Bumps the
 * resume counter and flips status back to `installing` (or the active state
 * it was in). Returns the refreshed state, or undefined if not found / already
 * terminal.
 */
export function resumeUpdate(updateId: string): UpdateState | undefined {
  const existing = memoryStore[updateId]
  if (!existing) return undefined
  if (TERMINAL_STATES.has(existing.status)) return undefined

  const next: UpdateState = {
    ...existing,
    status: existing.status === 'interrupted' ? 'installing' : existing.status,
    resume_attempts: existing.resume_attempts + 1,
    updated_at: Date.now(),
  }
  return persist(next)
}

/** Mark an update as failed and record the cause. */
export function failUpdate(updateId: string, error: string): UpdateState | undefined {
  const existing = memoryStore[updateId]
  if (!existing) return undefined
  const next: UpdateState = {
    ...existing,
    status: 'failed',
    error,
    updated_at: Date.now(),
  }
  return persist(next)
}

/** Mark an update as rolled back (e.g. user rejected after sandbox review). */
export function markRolledBack(updateId: string): UpdateState | undefined {
  const existing = memoryStore[updateId]
  if (!existing) return undefined
  const next: UpdateState = {
    ...existing,
    status: 'rolled_back',
    updated_at: Date.now(),
  }
  return persist(next)
}

/**
 * Mark an update as fully completed and clear its tracked state. Completed
 * updates are terminal; keeping them around only clutters the resume index.
 */
export function completeUpdate(updateId: string): void {
  const existing = memoryStore[updateId]
  if (!existing) return
  persist({ ...existing, status: 'completed', updated_at: Date.now() })
  // Completed updates are done — remove the tracking entry so a future
  // restart does not mistake it for an interrupted update.
  removeState(updateId)
}

/** Discard an update entirely: clears its tracked state regardless of status. */
export function discardUpdate(updateId: string): void {
  removeState(updateId)
}

/**
 * Mark every still-active update as `interrupted`. Intended to be called once
 * during app startup, before the UI asks about resumable updates. Returns the
 * list of updates that were flipped (so the caller can surface them).
 */
export function markInterruptedOnStartup(): UpdateState[] {
  const flipped: UpdateState[] = []
  for (const state of Object.values(memoryStore)) {
    if (ACTIVE_STATES.has(state.status)) {
      const next: UpdateState = {
        ...state,
        status: 'interrupted',
        updated_at: Date.now(),
      }
      persist(next)
      flipped.push(next)
    }
  }
  return flipped.sort((a, b) => b.updated_at - a.updated_at)
}

// ── Database integrity check (run before offering a resume) ────

export interface IntegrityReport {
  ok: boolean
  openable: boolean
  stores: Partial<Record<keyof typeof STORES, boolean>>
  errors: string[]
}

/**
 * Lightweight integrity check used before offering to resume an interrupted
 * update. We only verify that the DB opens and that every expected object
 * store exists — a deeper row-level audit would be too expensive on startup.
 *
 * This does NOT trust IndexedDB to hold the resume record itself (that lives
 * in localStorage); it only checks whether the DB the update was writing to
 * is still structurally sound.
 */
export async function verifyDatabaseIntegrity(): Promise<IntegrityReport> {
  const errors: string[] = []
  const stores: Partial<Record<keyof typeof STORES, boolean>> = {}
  let openable = false

  try {
    const database = await openDB()
    openable = true
    const expected = Object.keys(STORES) as (keyof typeof STORES)[]
    for (const key of expected) {
      const name = STORES[key]
      const exists = database.objectStoreNames.contains(name)
      stores[key] = exists
      if (!exists) {
        errors.push(`Missing object store: ${name}`)
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`Database could not be opened: ${msg}`)
  }

  return {
    ok: errors.length === 0,
    openable,
    stores,
    errors,
  }
}

/**
 * High-level startup helper: flips active updates to `interrupted`, verifies
 * DB integrity, and returns a single descriptor the UI can act on.
 */
export interface StartupCheckResult {
  interrupted: UpdateState[]
  integrity: IntegrityReport
  /** True only when an interrupted update exists AND the DB is sound. */
  canResume: boolean
}

export async function checkForInterruptedUpdatesOnStartup(): Promise<StartupCheckResult> {
  const interrupted = markInterruptedOnStartup()
  const integrity = await verifyDatabaseIntegrity()
  return {
    interrupted,
    integrity,
    canResume: interrupted.length > 0 && integrity.ok,
  }
}

// ── Maintenance ─────────────────────────────────────────────────

/** Remove terminal updates older than `maxAgeMs` (default: 7 days). */
export function pruneTerminalUpdates(maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAgeMs
  let removed = 0
  for (const [id, state] of Object.entries(memoryStore)) {
    if (TERMINAL_STATES.has(state.status) && state.updated_at < cutoff) {
      removeState(id)
      removed++
    }
  }
  return removed
}
