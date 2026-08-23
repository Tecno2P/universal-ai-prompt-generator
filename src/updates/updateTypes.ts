/**
 * Shared types for the Database Update system.
 *
 * These types are the contract between the update state machine, the update
 * service, and the UI (UpdatesPage). Nothing in here imports runtime values —
 * it is types-only so it can be pulled in with `import type` everywhere.
 */

import type { UpdatePackage } from '@/types'
import type { Language } from '@/types'

// ── States ─────────────────────────────────────────────────────

/**
 * Lifecycle of a single update operation, driven by `updateStateMachine`.
 *
 *   idle              → nothing running
 *   checking          → gathering DB context (version, template count, …)
 *   requesting_ai     → calling the AI provider for new templates
 *   receiving         → raw AI response in hand
 *   normalizing       → cleaning/extracting JSON from the raw response
 *   parsing           → JSON.parse of the normalized string
 *   validating        → schema validation of the parsed package
 *   sandboxing        → applying the package to an isolated sandbox DB
 *   awaiting_review   → sandbox validated + diffed, waiting for user approval
 *   installing        → copying sandbox → production
 *   verifying         → re-reading production records to confirm the install
 *   completed         → terminal success
 *   failed            → terminal failure (error recorded)
 *   interrupted       → stopped externally (e.g. tab closed mid-install)
 *   rolled_back       → install was reverted to a pre-update snapshot
 */
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'requesting_ai'
  | 'receiving'
  | 'normalizing'
  | 'parsing'
  | 'validating'
  | 'sandboxing'
  | 'awaiting_review'
  | 'installing'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'rolled_back'

// ── Error codes ────────────────────────────────────────────────

export type ErrorCode =
  | 'UPDATE_NETWORK_FAILED'
  | 'UPDATE_AI_RESPONSE_EMPTY'
  | 'UPDATE_AI_JSON_INVALID'
  | 'UPDATE_SCHEMA_INVALID'
  | 'UPDATE_VERSION_CONFLICT'
  | 'UPDATE_DUPLICATE_RECORD'
  | 'UPDATE_SANDBOX_FAILED'
  | 'UPDATE_INSTALL_FAILED'
  | 'UPDATE_VERIFY_FAILED'
  | 'UPDATE_STORAGE_QUOTA'
  | 'UPDATE_OPERATION_IN_PROGRESS'

export const ERROR_CODES = {
  UPDATE_NETWORK_FAILED: 'UPDATE_NETWORK_FAILED',
  UPDATE_AI_RESPONSE_EMPTY: 'UPDATE_AI_RESPONSE_EMPTY',
  UPDATE_AI_JSON_INVALID: 'UPDATE_AI_JSON_INVALID',
  UPDATE_SCHEMA_INVALID: 'UPDATE_SCHEMA_INVALID',
  UPDATE_VERSION_CONFLICT: 'UPDATE_VERSION_CONFLICT',
  UPDATE_DUPLICATE_RECORD: 'UPDATE_DUPLICATE_RECORD',
  UPDATE_SANDBOX_FAILED: 'UPDATE_SANDBOX_FAILED',
  UPDATE_INSTALL_FAILED: 'UPDATE_INSTALL_FAILED',
  UPDATE_VERIFY_FAILED: 'UPDATE_VERIFY_FAILED',
  UPDATE_STORAGE_QUOTA: 'UPDATE_STORAGE_QUOTA',
  UPDATE_OPERATION_IN_PROGRESS: 'UPDATE_OPERATION_IN_PROGRESS',
} as const satisfies Record<string, ErrorCode>

// ── Typed result ───────────────────────────────────────────────

export interface UpdateError {
  code: ErrorCode
  message: string
  /** Original thrown value, if any — kept for diagnostics only. */
  cause?: unknown
  /** Whether re-running the same operation could plausibly succeed. */
  retryable: boolean
}

export type UpdateResult<T> =
  | { success: true; data: T }
  | { success: false; error: UpdateError }

// ── Operation / context ────────────────────────────────────────

/**
 * Snapshot of the DB context an update runs against. Built once during
 * `checkForUpdates` and reused by every downstream stage so the pipeline
 * never has to re-query the DB mid-flight.
 */
export interface UpdateContext {
  /** DB version at the moment the update was initiated. */
  currentVersion: string
  /** Number of templates currently in the DB. */
  templateCount: number
  /** Distinct template categories present. */
  categories: string[]
  /** Distinct template languages present. */
  languages: Language[]
}

/**
 * Full record of one update operation, held in memory by the state machine
 * while the operation is running and surfaced to the UI.
 */
export interface UpdateOperation {
  /** Unique id (crypto.randomUUID when available). */
  id: string
  state: UpdateState
  startedAt: number
  updatedAt: number
  context?: UpdateContext
  /** Parsed package once available (after `validating`). */
  package?: UpdatePackage
  /** Terminal error, when `state === 'failed'`. */
  error?: UpdateError
}

// ── Events ─────────────────────────────────────────────────────

/**
 * Event dispatched on the state machine's EventTarget whenever the state
 * changes. `detail` carries the full operation snapshot.
 */
export interface UpdateProgressEvent extends Event {
  readonly detail: {
    operationId: string
    from: UpdateState
    to: UpdateState
    operation: UpdateOperation
    timestamp: number
  }
}

export type UpdateStateListener = (event: UpdateProgressEvent) => void
