import type { UpdateChange } from '@/types'
import type { SubmissionPackage, TrustLevel } from '@/updates/updateSystem'
import type { SanitizedError } from '@/diagnostics/errorDiagnostics'
import { redactString, redactUnknown } from '@/diagnostics/errorDiagnostics'

// ── GitHub Contribution flow ───────────────────────────────────
//
// Extends the existing submission system (updateSystem.ts) with a
// structured contribution lifecycle: draft → prepared → submitted →
// under_review → accepted/rejected → merged.
//
// PRIVACY GUARANTEES:
//   - This module NEVER writes directly to any repository. It only
//     prepares data for the user to submit (via a GitHub issue URL or
//     a downloadable JSON package). The user is always in the loop.
//   - Every contribution is sanitised to strip potential secrets:
//       API keys, saved private prompts, vault data, passwords, and
//       diagnostics containing private information.
//   - Contributions are stored locally (localStorage) so the user can
//     track their submissions; nothing is transmitted automatically.

// ── Types ───────────────────────────────────────────────────────

export type ContributionStatus =
  | 'draft'
  | 'prepared'
  | 'submitted'
  | 'under_review'
  | 'accepted'
  | 'rejected'
  | 'merged'

export interface ContributionState {
  /** Unique local id for this contribution. */
  id: string
  /** Current lifecycle status. */
  status: ContributionStatus
  /** The (sanitised) submission package being contributed. */
  package: SubmissionPackage
  /** ISO timestamp of creation. */
  createdAt: number
  /** ISO timestamp of last update. */
  updatedAt: number
  /** GitHub issue URL once submitted, otherwise null. */
  issueUrl: string | null
  /** Labels to attach to the GitHub issue. */
  labels: string[]
}

/**
 * A contribution package as prepared for export / issue creation.
 * This is a sanitised {@link SubmissionPackage} with private data
 * stripped, plus metadata that identifies it as a contribution.
 */
export interface PreparedContribution {
  submission_schema_version: 1
  contribution_id: string
  submission_id: string
  base_version: string
  local_version: string
  source: string
  trust_level: TrustLevel
  summary: SubmissionPackage['summary']
  /** Sanitised changes — secrets and private prompt content removed. */
  changes: SanitizedChange[]
  /** Diagnostics attached to the contribution (sanitised, opt-in). */
  diagnostics?: SanitizedError[]
}

export interface SanitizedChange extends UpdateChange {
  /** Indicates sanitisation was applied (private content stripped). */
  _sanitized?: true
}

export interface GitHubIssueData {
  title: string
  body: string
  labels: string[]
  url: string
}

// ── Storage ─────────────────────────────────────────────────────

const STORAGE_KEY = 'uapg.contributions'

function readStore(): ContributionState[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed as ContributionState[]
    }
    return []
  } catch {
    return []
  }
}

function writeStore(contributions: ContributionState[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contributions.slice(0, 50)))
  } catch {
    // Storage unavailable / full — best-effort, never throw.
  }
}

// ── Sanitisation ────────────────────────────────────────────────
//
// Reuses the redaction engine from errorDiagnostics so that the exact
// same secret-detection rules cover both subsystems. In addition to
// regex redaction, contribution data explicitly drops known-private
// fields (saved private prompts, vault data, passwords).

/** Fields that must never leave the device in a contribution. */
const PRIVATE_FIELD_DENYLIST: ReadonlySet<string> = new Set([
  'apiKey',
  'api_key',
  'token',
  'bearer',
  'authorization',
  'password',
  'passwd',
  'pwd',
  'passphrase',
  'masterPassword',
  'master_password',
  'privateKey',
  'private_key',
  'secret',
  'vault',
  'vaultData',
  'vault_data',
  'savedPrompts',
  'saved_prompts',
  'privatePrompts',
  'private_prompts',
  'credential',
  'credentials',
  'iv',
  'salt',
  'ciphertext',
  'nonce',
])

/** Change `type`s that carry user-private content and must be dropped. */
const PRIVATE_CHANGE_TYPES: ReadonlySet<string> = new Set([
  // Only database content types are allowed in contributions at all;
  // anything that could reference private prompts/vaults is excluded.
  'saved_prompt',
  'vault',
  'credential',
  'private_prompt',
])

function isPrivateField(key: string): boolean {
  return PRIVATE_FIELD_DENYLIST.has(key) || /secret|password|token|key|credential/i.test(key)
}

/**
 * Sanitise a single {@link UpdateChange} for inclusion in a contribution.
 *
 * - Drops the change entirely if its type is a known-private type.
 * - Runs every string field through the shared redaction engine.
 * - Strips any extra fields whose names look private.
 */
function sanitizeChange(change: UpdateChange): SanitizedChange | null {
  if (PRIVATE_CHANGE_TYPES.has(change.type)) {
    return null
  }

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(change)) {
    if (isPrivateField(key)) {
      continue
    }
    out[key] = redactUnknown(value)
  }

  // Ensure required structural fields survive with sane defaults.
  if (typeof out.operation !== 'string') out.operation = change.operation
  if (typeof out.type !== 'string') out.type = change.type
  if (typeof out.id !== 'string') out.id = change.id
  out._sanitized = true
  return out as unknown as SanitizedChange
}

/**
 * Strip potential secrets and private data from a {@link SubmissionPackage},
 * returning a contribution-safe copy.
 *
 * Removes:
 *   - API keys, bearer tokens, Authorization headers, passwords,
 *     master passwords, encryption material (IVs, salts, ciphertext)
 *     — via the shared regex redaction engine.
 *   - Saved private prompts, vault data, and credentials — by field
 *     denylist and change-type exclusion.
 *   - Diagnostics containing private information — diagnostics are
 *     only included when explicitly passed in by the caller and are
 *     themselves already-sanitised {@link SanitizedError}s.
 */
export function sanitizeContribution(pkg: SubmissionPackage): SubmissionPackage {
  const sanitizedChanges: UpdateChange[] = []
  for (const change of pkg.changes) {
    const sanitized = sanitizeChange(change)
    if (sanitized !== null) {
      // Return as a plain UpdateChange so the output stays assignable
      // to SubmissionPackage (which declares `changes: UpdateChange[]`).
      const { _sanitized, ...rest } = sanitized
      void _sanitized
      sanitizedChanges.push(rest as UpdateChange)
    }
  }

  const sanitizedSummary = redactUnknown(pkg.summary) as SubmissionPackage['summary']
  const sanitizedSource = redactString(pkg.source)

  return {
    submission_schema_version: 1,
    submission_id: pkg.submission_id,
    base_version: redactString(pkg.base_version),
    local_version: redactString(pkg.local_version),
    source: sanitizedSource,
    trust_level: pkg.trust_level,
    summary: sanitizedSummary,
    changes: sanitizedChanges,
  }
}

// ── Lifecycle ───────────────────────────────────────────────────

function generateId(): string {
  return `contrib-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Create a new contribution in `draft` status from a submission package.
 *
 * The package is sanitised immediately so that no private data ever
 * enters the local contribution store.
 */
export function createContribution(pkg: SubmissionPackage): ContributionState {
  const sanitized = sanitizeContribution(pkg)
  const now = Date.now()
  const contribution: ContributionState = {
    id: generateId(),
    status: 'draft',
    package: sanitized,
    createdAt: now,
    updatedAt: now,
    issueUrl: null,
    labels: deriveLabels(sanitized),
  }

  const contributions = readStore()
  contributions.unshift(contribution)
  writeStore(contributions)
  return contribution
}

/**
 * Update the status of an existing contribution.
 *
 * If transitioning to `submitted`, `issueUrl` should be set separately
 * via {@link setIssueUrl}. Transitioning to `merged` clears the active
 * contribution flag implicitly (there can be at most one active
 * contribution at a time — see {@link getActiveContribution}).
 */
export function updateContributionStatus(id: string, status: ContributionStatus): void {
  const contributions = readStore()
  const target = contributions.find(c => c.id === id)
  if (!target) return

  target.status = status
  target.updatedAt = Date.now()

  // Only one contribution may be "active" (draft/prepared/submitted/
  // under_review) at a time. Marking one as accepted/rejected/merged
  // is terminal and does not affect other active ones, but we enforce
  // that starting a new draft supersedes a previous draft.
  if (status === 'draft') {
    for (const other of contributions) {
      if (other.id !== id && other.status === 'draft') {
        other.status = 'rejected'
        other.updatedAt = Date.now()
      }
    }
  }

  writeStore(contributions)
}

/**
 * Attach a GitHub issue URL to a contribution (set when it moves to
 * `submitted`).
 */
export function setIssueUrl(id: string, issueUrl: string): void {
  const contributions = readStore()
  const target = contributions.find(c => c.id === id)
  if (!target) return
  target.issueUrl = issueUrl
  target.updatedAt = Date.now()
  writeStore(contributions)
}

/**
 * Retrieve all contributions, most-recent first.
 */
export function getContributions(): ContributionState[] {
  return readStore()
}

/**
 * Return the single "active" contribution (one whose status is
 * `draft`, `prepared`, `submitted`, or `under_review`), or `null`
 * if none is active.
 */
export function getActiveContribution(): ContributionState | null {
  const activeStatuses: ReadonlySet<ContributionStatus> = new Set([
    'draft',
    'prepared',
    'submitted',
    'under_review',
  ])
  for (const c of readStore()) {
    if (activeStatuses.has(c.status)) {
      return c
    }
  }
  return null
}

// ── Labels ─────────────────────────────────────────────────────

function deriveLabels(pkg: SubmissionPackage): string[] {
  const labels = new Set<string>(['database-update', 'community-contribution', 'needs-review'])
  labels.add(pkg.trust_level)
  if (pkg.summary.templates_added > 0) labels.add('templates')
  if (pkg.summary.hinglish_patterns_added > 0) labels.add('hinglish')
  if (pkg.summary.categories_added > 0) labels.add('categories')
  return Array.from(labels)
}

// ── GitHub issue preparation ───────────────────────────────────

/**
 * Prepare GitHub issue data (title, body, labels, URL) for a
 * contribution.
 *
 * The body contains the sanitised contribution package as JSON. The
 * URL is a pre-filled `issues/new` link for the project repository;
 * the user must click it and submit the issue manually — this module
 * does NOT open the URL or write to the repository directly.
 */
export function prepareGitHubIssue(contribution: ContributionState): GitHubIssueData {
  const pkg = contribution.package
  const title = `[Database Update] ${pkg.source} proposal — ${pkg.summary.templates_added} templates`

  const body = [
    '## Database Update Submission',
    '',
    `**Contribution ID:** ${contribution.id}`,
    `**Submission ID:** ${pkg.submission_id}`,
    `**Base Version:** ${pkg.base_version}`,
    `**Local Version:** ${pkg.local_version}`,
    `**Source:** ${pkg.source}`,
    `**Trust Level:** ${pkg.trust_level}`,
    '',
    '### Summary',
    `- Templates Added: ${pkg.summary.templates_added}`,
    `- Templates Modified: ${pkg.summary.templates_modified}`,
    `- Templates Deleted: ${pkg.summary.templates_deleted}`,
    `- Hinglish Patterns Added: ${pkg.summary.hinglish_patterns_added}`,
    `- Categories Added: ${pkg.summary.categories_added}`,
    '',
    '### Changes JSON',
    '',
    '```json',
    JSON.stringify(pkg.changes, null, 2),
    '```',
    '',
    '---',
    '*This submission was generated by the Universal AI Prompt Generator PWA and reviewed by the user before submission. No secrets, private prompts, or vault data are included.*',
  ].join('\n')

  const labels = contribution.labels.length > 0 ? contribution.labels : deriveLabels(pkg)
  const labelParam = labels.join(',')
  const url = `https://github.com/Tecno2P/universal-ai-prompt-generator/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${encodeURIComponent(labelParam)}`

  return { title, body, labels, url }
}

// ── Export ─────────────────────────────────────────────────────

/**
 * Serialise a contribution (sanitised) as a JSON string suitable for
 * download. The returned string contains no secrets, saved private
 * prompts, vault data, passwords, or private diagnostics.
 */
export function exportContributionPackage(contribution: ContributionState): string {
  const pkg = contribution.package
  const prepared: PreparedContribution = {
    submission_schema_version: 1,
    contribution_id: contribution.id,
    submission_id: pkg.submission_id,
    base_version: pkg.base_version,
    local_version: pkg.local_version,
    source: pkg.source,
    trust_level: pkg.trust_level,
    summary: pkg.summary,
    changes: pkg.changes as SanitizedChange[],
    // Diagnostics are only attached if the caller explicitly added them
    // to the contribution's package context; we never auto-include raw
    // error logs. They are omitted here unless already present.
  }
  return JSON.stringify(prepared, null, 2)
}

/**
 * Optionally attach already-sanitised diagnostics to a contribution.
 *
 * Diagnostics are never auto-collected; the caller must explicitly
 * pass sanitised {@link SanitizedError} records. This keeps the user
 * in control of what diagnostic information leaves the device.
 */
export function attachDiagnostics(
  id: string,
  diagnostics: SanitizedError[],
): void {
  const contributions = readStore()
  const target = contributions.find(c => c.id === id)
  if (!target) return
  // Store diagnostics as an extra metadata field on the package's
  // context — re-sanitised defensively in case the caller passed in
  // records that were not yet redacted.
  const sanitized = diagnostics.map(d => redactUnknown(d) as SanitizedError)
  ;(target.package as SubmissionPackage & { diagnostics?: SanitizedError[] }).diagnostics = sanitized
  target.updatedAt = Date.now()
  writeStore(contributions)
}
