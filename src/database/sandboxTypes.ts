/**
 * Type definitions for the AI Update Sandbox.
 *
 * The sandbox lets an AI-generated `UpdatePackage` be applied to an isolated
 * copy of the production database, validated, diffed, and reviewed — all
 * without ever touching production records until the user explicitly approves.
 *
 * The production database (`prompt-generator-db`, exposed via the `db`
 * singleton in `./db`) is NEVER mutated by any sandbox operation. The sandbox
 * lives in a completely separate IndexedDB database (`prompt-gen-sandbox`).
 */

import type {
  UpdatePackage,
  UpdateChange,
  PromptTemplate,
  HinglishPattern,
  Category,
  DatabaseVersion,
} from '@/types'

/** Single entry in a sandbox diff — one record that was added/modified/removed. */
export interface DiffEntry<T = PromptTemplate | HinglishPattern | Category> {
  /** Operation kind that produced this entry. */
  kind: 'added' | 'modified' | 'deleted'
  /** Which collection the record belongs to. */
  collection: 'templates' | 'hinglishPatterns' | 'categories'
  /** Stable record id (matches the production keyPath). */
  id: string
  /** Human-readable label (template title, category name, etc.). */
  label: string
  /** State of the record BEFORE the change. Absent for `added`. */
  before?: T
  /** State of the record AFTER the change. Absent for `deleted`. */
  after?: T
  /** The source change that produced this diff entry, when applicable. */
  change?: UpdateChange
}

/** Aggregated diff between the sandbox and the production database. */
export interface SandboxDiff {
  /** Base production version the sandbox was forked from. */
  baseVersion: string
  /** Proposed version carried by the update package. */
  proposedVersion: string
  /** When the diff was generated (epoch ms). */
  generatedAt: number
  /** All individual record-level differences. */
  entries: DiffEntry[]
  /** Convenience counts grouped by operation. */
  summary: {
    added: number
    modified: number
    deleted: number
    /** Counts split by collection, for UI badges like "+10 templates". */
    byCollection: {
      templates: { added: number; modified: number; deleted: number }
      hinglishPatterns: { added: number; modified: number; deleted: number }
      categories: { added: number; modified: number; deleted: number }
    }
  }
}

/**
 * Result of validating a sandbox after an update has been applied to it.
 * Mirrors the check list from the master spec (Part 3 / Part 8): JSON,
 * schema, duplicates, ids, categories, language references, content safety.
 */
export interface SandboxValidationResult {
  /** True only when every check passed (no errors). */
  valid: boolean
  /** 0–100 score; 100 when no issues, lowered by errors/warnings. */
  score: number
  /** Per-check outcomes, in the order shown in the sandbox UI. */
  checks: SandboxValidationCheck[]
  /** Blocking problems — these MUST be resolved before install. */
  errors: string[]
  /** Non-blocking problems worth surfacing to the reviewer. */
  warnings: string[]
}

/** Outcome of a single validation check. */
export interface SandboxValidationCheck {
  /** Stable id, e.g. `schema`, `duplicates`, `content-safety`. */
  id: string
  /** Human-readable label, e.g. "Schema Valid". */
  label: string
  /** `pass` (check succeeded), `fail` (blocking), or `warn` (non-blocking). */
  status: 'pass' | 'fail' | 'warn'
  /** Optional detail message, e.g. "2 duplicate template ids". */
  detail?: string
}

/** Lifecycle of a sandbox, from creation through install/discard. */
export type SandboxStatus =
  | 'idle'
  | 'creating'
  | 'ready'
  | 'applying'
  | 'applied'
  | 'validating'
  | 'validated'
  | 'installing'
  | 'installed'
  | 'discarding'
  | 'discarded'
  | 'error'

/**
 * Snapshot of the sandbox held in memory between operations.
 *
 * The actual records live in the separate `prompt-gen-sandbox` IndexedDB
 * database; this object is a lightweight handle describing that database and
 * the most recent validation/diff produced for it.
 */
export interface SandboxState {
  /** Unique id for this sandbox session (`sandbox-<timestamp>`). */
  id: string
  /** Current lifecycle status. */
  status: SandboxStatus
  /** Production version the sandbox was forked from. */
  baseVersion: string
  /** Version proposed by the update package being tested. */
  proposedVersion: string
  /** When the sandbox was created (epoch ms). */
  createdAt: number
  /** Most recent validation result, once `validateSandbox` has run. */
  validation?: SandboxValidationResult
  /** Most recent diff, once `generateDiff` has run. */
  diff?: SandboxDiff
  /** Last error message, when `status === 'error'`. */
  error?: string
}

/**
 * In-memory mirror of the sandbox database contents, used to compute diffs
 * and run validations without re-reading from IndexedDB on every call.
 */
export interface SandboxContents {
  templates: PromptTemplate[]
  hinglishPatterns: HinglishPattern[]
  categories: Category[]
  versions: DatabaseVersion[]
}

/** What `createSandbox` returns so callers can drive the rest of the flow. */
export interface SandboxHandle {
  state: SandboxState
  contents: SandboxContents
}

/** Type guard narrowing to a `PromptTemplate` (used by diff internals). */
export function isTemplate(value: unknown): value is PromptTemplate {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'category' in value &&
    'content' in value &&
    'title' in value
  )
}

/** Type guard narrowing to a `HinglishPattern`. */
export function isHinglishPattern(value: unknown): value is HinglishPattern {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'pattern' in value &&
    'intent' in value &&
    'translation' in value
  )
}

/** Type guard narrowing to a `Category`. */
export function isCategory(value: unknown): value is Category {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value
  )
}

/** The shape of an `UpdatePackage` accepted by the sandbox. */
export type SandboxUpdatePackage = UpdatePackage
