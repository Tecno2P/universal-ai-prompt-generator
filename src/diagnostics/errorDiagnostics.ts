// ── Advanced Error Diagnostics ──────────────────────────────────
//
// A purely local error-logging and diagnostics subsystem. It captures
// errors thrown across the app, normalises them, strips out anything
// sensitive (API keys, bearer tokens, passwords, master passwords,
// encryption material), fingerprints them for deduplication, and
// stores them in a local "error database" backed by localStorage.
//
// PRIVACY GUARANTEES:
//   - This module NEVER automatically sends error reports anywhere.
//     All storage is local. Reports are only exported when the user
//     explicitly requests a diagnostic report.
//   - Every error is sanitised before it is stored, so even the local
//     log never contains raw secrets.
//   - Encryption material (IVs, salts, ciphertext, keys) is redacted.

// ── Types ───────────────────────────────────────────────────────

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical'

/**
 * A normalised, pre-sanitisation representation of any thrown value.
 *
 * `normalizeError` produces this from arbitrary `unknown` inputs so
 * the rest of the pipeline can work against a stable shape.
 */
export interface NormalizedError {
  /** Error constructor name, e.g. `TypeError`, `DOMException`. */
  name: string
  /** The human-readable message (may still contain secrets at this stage). */
  message: string
  /** Structured stack trace if available, otherwise empty string. */
  stack: string
  /** Where in the app the error originated, if known. */
  feature: string
  /** Numeric timestamp (ms since epoch). */
  timestamp: number
  /** Arbitrary structured context attached by the caller. */
  context: Readonly<Record<string, unknown>>
  /** Optional cause chain (already normalised). */
  cause?: NormalizedError
}

/**
 * A fully sanitised error record safe to persist locally and to
 * include in an exported diagnostic report.
 */
export interface SanitizedError {
  error_id: string
  fingerprint: string
  timestamp: number
  feature: string
  severity: ErrorSeverity
  sanitized_message: string
  occurrence_count: number
  /** Sanitised structured context. */
  context: Readonly<Record<string, unknown>>
  /** Sanitised stack trace (secrets redacted). */
  stack?: string
}

/**
 * A complete, export-safe diagnostic report. Contains no secrets —
 * only aggregated counts and sanitised error records.
 */
export interface DiagnosticReport {
  generated_at: number
  app_version: string
  total_errors: number
  unique_errors: number
  by_severity: Readonly<Record<ErrorSeverity, number>>
  errors: SanitizedError[]
}

// ── Storage keys ────────────────────────────────────────────────

const STORAGE_KEY = 'uapg.diagnostics.errors'
const APP_VERSION = '1.0.0'

// ── Secret detection patterns ───────────────────────────────────
//
// These regexes are intentionally broad: the cost of a false positive
// (redacting something harmless) is low, while the cost of a false
// negative (leaking a real secret into the local log or an exported
// report) is high.

interface RedactionPattern {
  /** Human-readable label used as the replacement. */
  label: string
  /** Matches the secret-bearing substring. */
  regex: RegExp
}

const REDACTION_PATTERNS: readonly RedactionPattern[] = [
  // API keys with well-known prefixes:
  //   - OpenAI: sk-...
  //   - Anthropic: sk-ant-...
  //   - GitHub PATs: ghp_..., gho_..., ghs_..., ghu_..., github_pat_...
  //   - Google AI: AIza...
  //   - Stripe: sk_live_..., sk_test_..., rk_live_...
  //   - Slack: xoxb-..., xoxp-...
  //   - Generic "key=" assignments.
  {
    label: '[REDACTED:api-key]',
    regex: /\b(sk-ant-|sk-|ghp_|gho_|ghs_|ghu_|github_pat_|AIza|sk_live_|sk_test_|rk_live_|xox[bpas]-)[A-Za-z0-9_\-]{8,}/g,
  },
  // Generic "key" / "token" query or fragment params.
  {
    label: '[REDACTED:key-param]',
    regex: /([?&#;\s])(?:api[_-]?key|access[_-]?token|secret|client[_-]?secret|private[_-]?key)=([^\s&;#'\"]+)/gi,
  },
  // Authorization headers (Bearer / Basic / token), value included.
  {
    label: '[REDACTED:authorization]',
    regex: /(Authorization|X-Api-Key|X-Auth-Token|Proxy-Authorization)\s*[:=]\s*"?[Bb]earer\s+[A-Za-z0-9_\-\.=]+/g,
  },
  // Bare bearer tokens (e.g. logged separately from a header).
  {
    label: '[REDACTED:bearer-token]',
    regex: /\b[Bb]earer\s+[A-Za-z0-9_\-\.=]{8,}/g,
  },
  // Basic-auth credentials in URLs: https://user:pass@host
  {
    label: '[REDACTED:basic-auth]',
    regex: /:\/\/([^:/\s]+):([^@/\s]+)@/g,
  },
  // Password / master-password assignments in JSON-ish or form-ish text.
  {
    label: '[REDACTED:password]',
    regex: /(["']?)(master[_-]?password|password|passwd|pwd|passphrase|secret|otp|pin)\1\s*[:=]\s*["']?[^\s"',;}\]]+/gi,
  },
  // Encryption material: IVs, salts, ciphertext, keys, nonces.
  // Catches labels like iv=, salt=, ciphertext=, key=, nonce=, tag=
  // followed by base64/hex-ish blobs.
  {
    label: '[REDACTED:crypto-material]',
    regex: /(["']?)(iv|salt|ciphertext|cipher|encryption[_-]?key|public[_-]?key|private[_-]?key|symmetric[_-]?key|nonce|auth[_-]?tag|key)\1\s*[:=]\s*["']?[A-Za-z0-9+/=]{8,}/gi,
  },
  // Long base64/hex blobs that look like encoded secrets (>=32 chars).
  {
    label: '[REDACTED:opaque-blob]',
    regex: /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
  },
]

/**
 * Apply all redaction patterns to a string.
 *
 * Patterns are applied in order; each pass replaces matches with the
 * pattern's label. The function is idempotent for already-redacted
 * text because the labels themselves do not match any pattern.
 *
 * Exported so other privacy-sensitive subsystems (e.g. the GitHub
 * contribution flow) can share the exact same redaction rules.
 */
export function redactString(input: string): string {
  let out = input
  for (const { label, regex } of REDACTION_PATTERNS) {
    // Reset lastIndex because the regex objects are reused.
    regex.lastIndex = 0
    out = out.replace(regex, label)
  }
  return out
}

/**
 * Recursively redact secrets from an arbitrary JSON-serialisable value.
 *
 * Returns a deep copy with every string scanned by {@link redactString}
 * and every object key whose name looks like a secret field replaced by
 * `'[REDACTED]'` regardless of its value.
 *
 * Exported for reuse by other privacy-sensitive subsystems.
 */
export function redactUnknown(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    // Guard against deeply nested / cyclic structures.
    return '[REDACTED:too-deep]'
  }
  if (typeof value === 'string') {
    return redactString(value)
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(item => redactUnknown(item, depth + 1))
  }

  const record = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(record)) {
    if (looksLikeSecretKey(key)) {
      out[key] = '[REDACTED]'
      continue
    }
    out[key] = redactUnknown(record[key], depth + 1)
  }
  return out
}

const SECRET_KEY_REGEX =
  /^(api[_-]?key|access[_-]?token|secret|client[_-]?secret|private[_-]?key|password|passwd|pwd|passphrase|master[_-]?password|token|bearer|authorization|auth|otp|pin|iv|salt|ciphertext|cipher|encryption[_-]?key|nonce|auth[_-]?tag|key|credential)$/i

function looksLikeSecretKey(key: string): boolean {
  return SECRET_KEY_REGEX.test(key)
}

// ── Fingerprinting ───────────────────────────────────────────────
//
// A lightweight, dependency-free 32-bit FNV-1a hash. The fingerprint is
// derived from the error type + normalised message, so repeated
// occurrences of the same logical error collapse to one record.

function fnv1a(data: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i)
    // FNV prime multiplication (imul keeps it 32-bit).
    hash = Math.imul(hash, 0x01000193)
  }
  // Render as 8-char hex, unsigned.
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Normalise an error message for stable fingerprinting.
 *
 * Collapses variable-looking substrings (numbers, hex blobs, quoted
 * strings) so that the same logical error yields the same fingerprint
 * regardless of the specific values involved.
 */
function normaliseForFingerprint(message: string): string {
  return message
    .replace(/0x[0-9a-fA-F]+/g, '0xHEX')
    .replace(/\b\d+\b/g, 'N')
    .replace(/["'`][^"'`]{0,80}["'`]/g, '"STR"')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Severity inference ──────────────────────────────────────────

function inferSeverity(name: string, message: string): ErrorSeverity {
  const text = `${name} ${message}`.toLowerCase()
  if (text.includes('fatal') || text.includes('crash') || text.includes('corrupt') || text.includes('catastroph')) {
    return 'critical'
  }
  if (
    text.includes('quota') ||
    text.includes('rate') ||
    text.includes('timeout') ||
    text.includes('deprecated') ||
    text.includes('unavailable')
  ) {
    return 'warning'
  }
  if (text.includes('info') || text.includes('notice')) {
    return 'info'
  }
  return 'error'
}

// ── Normalisation ──────────────────────────────────────────────

const DEFAULT_FEATURE = 'unknown'

function safeString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return ''
}

function coerceContext(context: unknown): Readonly<Record<string, unknown>> {
  if (context && typeof context === 'object' && !Array.isArray(context)) {
    return context as Record<string, unknown>
  }
  return {}
}

/**
 * Convert any thrown value into a stable {@link NormalizedError}.
 *
 * Handles:
 *   - `Error` instances (including subclasses with `cause`)
 *   - Objects that look like errors (duck-typed `message`)
 *   - Strings (treated as the message)
 *   - Anything else (stringified, never thrown raw)
 */
export function normalizeError(
  err: unknown,
  feature: string = DEFAULT_FEATURE,
  context: Readonly<Record<string, unknown>> = {},
): NormalizedError {
  const timestamp = Date.now()

  if (err instanceof Error) {
    const cause = typeof err.cause !== 'undefined'
      ? normalizeError(err.cause, feature)
      : undefined
    return {
      name: err.name || 'Error',
      message: err.message || '',
      stack: err.stack ?? '',
      feature: feature || DEFAULT_FEATURE,
      timestamp,
      context: coerceContext(context),
      cause,
    }
  }

  if (typeof err === 'string') {
    return {
      name: 'Error',
      message: err,
      stack: '',
      feature: feature || DEFAULT_FEATURE,
      timestamp,
      context: coerceContext(context),
    }
  }

  if (err && typeof err === 'object' && typeof (err as Record<string, unknown>).message === 'string') {
    const e = err as Record<string, unknown>
    const cause = typeof e.cause !== 'undefined'
      ? normalizeError(e.cause, feature)
      : undefined
    return {
      name: safeString(e.name) || 'Error',
      message: safeString(e.message),
      stack: safeString(e.stack),
      feature: feature || DEFAULT_FEATURE,
      timestamp,
      context: coerceContext(context),
      cause,
    }
  }

  // Fallback: stringify as best we can without leaking structure.
  let message: string
  try {
    message = JSON.stringify(err)
  } catch {
    message = String(err)
  }
  return {
    name: 'UnknownError',
    message: message || '[unserialisable error]',
    stack: '',
    feature: feature || DEFAULT_FEATURE,
    timestamp,
    context: coerceContext(context),
  }
}

// ── Sanitisation ───────────────────────────────────────────────

/**
 * Produce a {@link SanitizedError} from a {@link NormalizedError}.
 *
 * All secret-bearing surfaces (message, stack, context, nested cause)
 * are run through the redaction pipeline. The resulting record is safe
 * to persist locally and to include in an exported report.
 */
export function sanitizeError(err: NormalizedError): SanitizedError {
  const fingerprint = fingerprintError(err)
  const severity = inferSeverity(err.name, err.message)

  const sanitizedContext = redactUnknown(err.context) as Record<string, unknown>
  const sanitizedStack = err.stack ? redactString(err.stack) : undefined

  return {
    error_id: `err-${fingerprint}-${err.timestamp.toString(36)}`,
    fingerprint,
    timestamp: err.timestamp,
    feature: err.feature,
    severity,
    sanitized_message: redactString(err.message),
    occurrence_count: 1,
    context: sanitizedContext,
    stack: sanitizedStack,
  }
}

/**
 * Create a stable fingerprint for an error from its type + normalised
 * message. The same logical error (same name and structurally-similar
 * message) yields the same fingerprint across occurrences.
 */
export function fingerprintError(err: NormalizedError): string {
  const basis = `${err.name}\u{0000}${normaliseForFingerprint(err.message)}`
  return fnv1a(basis)
}

// ── Local error database (localStorage) ─────────────────────────

interface StoredRecord {
  error_id: string
  fingerprint: string
  timestamp: number
  feature: string
  severity: ErrorSeverity
  sanitized_message: string
  occurrence_count: number
  context: Readonly<Record<string, unknown>>
  stack?: string
  first_seen: number
  last_seen: number
}

function readStore(): StoredRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed as StoredRecord[]
    }
    return []
  } catch {
    return []
  }
}

function writeStore(records: StoredRecord[]): void {
  try {
    // Cap the log to keep localStorage bounded.
    const capped = records.slice(0, MAX_RECORDS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capped))
  } catch {
    // Storage full or unavailable — silently drop; diagnostics must
    // never crash the host application.
  }
}

const MAX_RECORDS = 200

function storedToSanitized(record: StoredRecord): SanitizedError {
  return {
    error_id: record.error_id,
    fingerprint: record.fingerprint,
    timestamp: record.timestamp,
    feature: record.feature,
    severity: record.severity,
    sanitized_message: record.sanitized_message,
    occurrence_count: record.occurrence_count,
    context: record.context,
    stack: record.stack,
  }
}

// ── Public logging API ──────────────────────────────────────────

/**
 * Log a sanitised error to the local error database.
 *
 * If an error with the same fingerprint already exists, its occurrence
 * count and last-seen timestamp are incremented instead of creating a
 * duplicate record. The returned `error_id` is the id of the record
 * (existing or new).
 *
 * This function NEVER transmits data off-device.
 */
export function logError(err: SanitizedError): string {
  const records = readStore()
  const existing = records.find(r => r.fingerprint === err.fingerprint)

  if (existing) {
    existing.occurrence_count += err.occurrence_count
    existing.last_seen = err.timestamp
    // Keep the most recent stack/context for debuggability.
    if (err.stack) existing.stack = err.stack
    existing.context = err.context
    writeStore(records)
    return existing.error_id
  }

  const record: StoredRecord = {
    error_id: err.error_id,
    fingerprint: err.fingerprint,
    timestamp: err.timestamp,
    feature: err.feature,
    severity: err.severity,
    sanitized_message: err.sanitized_message,
    occurrence_count: err.occurrence_count,
    context: err.context,
    stack: err.stack,
    first_seen: err.timestamp,
    last_seen: err.timestamp,
  }
  records.unshift(record)
  writeStore(records)
  return record.error_id
}

/**
 * Retrieve all logged errors, most-recent first.
 */
export function getErrorLog(): SanitizedError[] {
  return readStore().map(storedToSanitized)
}

/**
 * Retrieve a single error by its id, or `null` if not found.
 */
export function getErrorById(id: string): SanitizedError | null {
  const record = readStore().find(r => r.error_id === id)
  return record ? storedToSanitized(record) : null
}

/**
 * Clear the entire local error database.
 */
export function clearErrorLog(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // No-op if storage unavailable.
  }
}

// ── Diagnostic report ───────────────────────────────────────────

/**
 * Generate a complete, export-safe diagnostic report.
 *
 * The report contains only aggregated counts and already-sanitised
 * error records — no additional secret surface is introduced. It is
 * safe to hand to {@link copyDiagnosticReport} or to serialise for
 * download.
 */
export function generateDiagnosticReport(): DiagnosticReport {
  const records = readStore()
  const errors = records.map(storedToSanitized)

  const by_severity: Record<ErrorSeverity, number> = {
    info: 0,
    warning: 0,
    error: 0,
    critical: 0,
  }
  let totalErrors = 0
  for (const r of records) {
    by_severity[r.severity] += 1
    totalErrors += r.occurrence_count
  }

  return {
    generated_at: Date.now(),
    app_version: APP_VERSION,
    total_errors: totalErrors,
    unique_errors: records.length,
    by_severity,
    errors,
  }
}

/**
 * Format a {@link DiagnosticReport} as a plain-text string suitable
 * for copying to the clipboard.
 *
 * The string contains no secrets (only the sanitised records already
 * present in the report).
 */
export function copyDiagnosticReport(report: DiagnosticReport): string {
  const lines: string[] = []
  lines.push('Universal AI Prompt Generator — Diagnostic Report')
  lines.push('=================================================')
  lines.push(`Generated:   ${new Date(report.generated_at).toISOString()}`)
  lines.push(`App version: ${report.app_version}`)
  lines.push('')
  lines.push('Summary')
  lines.push('-------')
  lines.push(`Total errors (with repeats): ${report.total_errors}`)
  lines.push(`Unique errors:               ${report.unique_errors}`)
  lines.push(`  critical: ${report.by_severity.critical}`)
  lines.push(`  error:    ${report.by_severity.error}`)
  lines.push(`  warning:  ${report.by_severity.warning}`)
  lines.push(`  info:     ${report.by_severity.info}`)
  lines.push('')
  lines.push('Errors (most recent first)')
  lines.push('--------------------------')

  for (const e of report.errors) {
    lines.push('')
    lines.push(`[${e.severity.toUpperCase()}] ${e.feature} — ${e.error_id}`)
    lines.push(`  fingerprint:     ${e.fingerprint}`)
    lines.push(`  first/last seen: ${new Date(e.timestamp).toISOString()}`)
    lines.push(`  occurrences:     ${e.occurrence_count}`)
    lines.push(`  message:         ${e.sanitized_message}`)
    if (e.stack) {
      lines.push('  stack:')
      for (const stackLine of e.stack.split('\n').slice(0, 10)) {
        lines.push(`    ${stackLine}`)
      }
    }
    const ctxKeys = Object.keys(e.context)
    if (ctxKeys.length > 0) {
      lines.push('  context:')
      for (const k of ctxKeys) {
        let val: string
        try {
          val = JSON.stringify(e.context[k])
        } catch {
          val = '[unserialisable]'
        }
        lines.push(`    ${k}: ${val}`)
      }
    }
  }

  lines.push('')
  lines.push('— End of report —')
  return lines.join('\n')
}
