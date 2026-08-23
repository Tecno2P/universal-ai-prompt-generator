/**
 * Prompt Version Compare — immutable version history for prompts.
 *
 * Every time a prompt is created or modified, `createVersion` snapshots the
 * full content into a version history stored in localStorage (not IndexedDB,
 * to keep this module decoupled from the main prompt storage layer). AI edits
 * never overwrite or delete existing versions — they only append — so the
 * original prompt history is preserved.
 *
 * The diff algorithm is a self-contained LCS (longest common subsequence)
 * implementation producing a unified diff. No external libraries are used.
 */

// ── Types ────────────────────────────────────────────────────────

/** A single immutable snapshot of a prompt's content. */
export interface PromptVersion {
  /** Unique id for this version (ulid-ish timestamp + random suffix). */
  id: string
  /** Id of the prompt this version belongs to. */
  promptId: string
  /** Monotonically increasing version number, starting at 1. */
  version: number
  /** The prompt text captured at this version. */
  content: string
  /** Epoch ms when the version was created. */
  createdAt: number
  /** Short human-readable label, e.g. "Initial", "Refined by AI". */
  label: string
}

/** Lightweight content statistics for a version's text. */
export interface VersionStats {
  wordCount: number
  charCount: number
  lineCount: number
}

/** A single line in a side-by-side comparison. */
export interface DiffLine {
  /** 1-based line number in the respective side, or null if absent. */
  leftNumber: number | null
  rightNumber: number | null
  /** The text content of the line. */
  text: string
  /** Whether the line is unchanged, added, removed, or context-only. */
  type: 'unchanged' | 'added' | 'removed'
}

/** Result of comparing two versions side by side. */
export interface VersionDiff {
  /** The left (older) version. */
  left: PromptVersion
  /** The right (newer) version. */
  right: PromptVersion
  /** Merged line-by-line diff, oldest-first. */
  lines: DiffLine[]
  /** Aggregate stats. */
  stats: {
    added: number
    removed: number
    unchanged: number
  }
}

// ── Storage layer (localStorage) ─────────────────────────────────

const STORAGE_KEY = 'uapg:prompt-versions'

/** All versions keyed by promptId, then stored as an array. */
type VersionStore = Record<string, PromptVersion[]>

/** Safe localStorage access; returns an empty store when unavailable. */
function readStore(): VersionStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as VersionStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Persist the store; silently ignores quota / serialization errors. */
function writeStore(store: VersionStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Quota exceeded or storage disabled — caller keeps the in-memory copy.
  }
}

/** Generate a reasonably unique id without crypto dependencies. */
function makeId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${ts}-${rand}`
}

// ── Version lifecycle ───────────────────────────────────────────

/**
 * Create a new version snapshot for a prompt.
 *
 * The version number auto-increments from the highest existing version for
 * that prompt. The original content is never mutated — this only appends.
 */
export function createVersion(
  promptId: string,
  content: string,
  label: string,
): PromptVersion {
  const store = readStore()
  const existing = store[promptId] ?? []
  const nextVersion = existing.length > 0
    ? Math.max(...existing.map((v) => v.version)) + 1
    : 1

  const version: PromptVersion = {
    id: makeId(),
    promptId,
    version: nextVersion,
    content,
    createdAt: Date.now(),
    label,
  }

  store[promptId] = [...existing, version]
  writeStore(store)
  return version
}

/**
 * Return all versions for a prompt, oldest first.
 *
 * Versions are returned as defensive copies so callers cannot mutate the
 * stored history by reference.
 */
export function getVersions(promptId: string): PromptVersion[] {
  const store = readStore()
  const versions = store[promptId] ?? []
  return [...versions].sort((a, b) => a.version - b.version)
}

/**
 * Restore a previous version by returning its content.
 *
 * This does not delete later versions — it simply hands back the stored
 * content so the caller can re-apply it (and typically snapshot a new version
 * via `createVersion`). Original history is preserved.
 */
export function restoreVersion(promptId: string, versionId: string): string | null {
  const versions = getVersions(promptId)
  const found = versions.find((v) => v.id === versionId)
  return found ? found.content : null
}

/**
 * Duplicate an existing version as a brand-new version.
 *
 * Useful when you want to branch from a historical version without losing the
 * timeline. The copy gets the next version number and a suffixed label.
 */
export function duplicateVersion(
  promptId: string,
  versionId: string,
): PromptVersion | null {
  const versions = getVersions(promptId)
  const source = versions.find((v) => v.id === versionId)
  if (!source) return null
  return createVersion(promptId, source.content, `${source.label} (copy)`)
}

// ── Stats ────────────────────────────────────────────────────────

/**
 * Compute basic statistics for a prompt's content.
 *
 * Word count uses whitespace splitting; char count is the raw length; line
 * count splits on newlines (an empty string counts as 0 lines).
 */
export function getVersionStats(content: string): VersionStats {
  const trimmed = content.trim()
  const wordCount = trimmed.length > 0 ? trimmed.split(/\s+/).length : 0
  const charCount = content.length
  const lineCount = content.length > 0 ? content.split('\n').length : 0
  return { wordCount, charCount, lineCount }
}

// ── Diff algorithm (manual LCS implementation) ─────────────────

/**
 * Compute the longest common subsequence table for two line arrays.
 *
 * Returns a (m+1) × (n+1) matrix where cell [i][j] holds the LCS length of
 * the first i lines of `a` and first j lines of `b`.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  return dp
}

/** A typed diff operation emitted while walking the LCS table. */
type DiffOp =
  | { kind: 'unchanged'; text: string }
  | { kind: 'removed'; text: string }
  | { kind: 'added'; text: string }

/** Walk the LCS table backwards, emitting ordered diff operations. */
function diffLines(a: string[], b: string[]): DiffOp[] {
  const dp = lcsTable(a, b)
  const ops: DiffOp[] = []
  let i = a.length
  let j = b.length

  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ kind: 'unchanged', text: a[i - 1] })
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ kind: 'removed', text: a[i - 1] })
      i--
    } else {
      ops.push({ kind: 'added', text: b[j - 1] })
      j--
    }
  }
  while (i > 0) {
    ops.push({ kind: 'removed', text: a[i - 1] })
    i--
  }
  while (j > 0) {
    ops.push({ kind: 'added', text: b[j - 1] })
    j--
  }

  ops.reverse()
  return ops
}

/**
 * Produce a side-by-side comparison of two versions.
 *
 * Lines are aligned so unchanged lines line up between left and right; added
 * lines appear only on the right, removed lines only on the left.
 */
export function compareVersions(v1: PromptVersion, v2: PromptVersion): VersionDiff {
  const leftLines = v1.content.split('\n')
  const rightLines = v2.content.split('\n')
  const ops = diffLines(leftLines, rightLines)

  const lines: DiffLine[] = []
  let leftNum = 0
  let rightNum = 0
  let added = 0
  let removed = 0
  let unchanged = 0

  for (const op of ops) {
    if (op.kind === 'unchanged') {
      leftNum++
      rightNum++
      unchanged++
      lines.push({
        leftNumber: leftNum,
        rightNumber: rightNum,
        text: op.text,
        type: 'unchanged',
      })
    } else if (op.kind === 'removed') {
      leftNum++
      removed++
      lines.push({
        leftNumber: leftNum,
        rightNumber: null,
        text: op.text,
        type: 'removed',
      })
    } else {
      rightNum++
      added++
      lines.push({
        leftNumber: null,
        rightNumber: rightNum,
        text: op.text,
        type: 'added',
      })
    }
  }

  return {
    left: v1,
    right: v2,
    lines,
    stats: { added, removed, unchanged },
  }
}

/**
 * Generate a unified diff string (the `--- /+++ /@@ ...` format) for two
 * versions, line by line.
 *
 * Implemented manually from the LCS table — no external diff library. Hunk
 * headers show the line ranges in the standard `@@ -start,count +start,count @@`
 * form. Context lines are prefixed with a space, removals with `-`, and
 * additions with `+`.
 */
export function generateUnifiedDiff(v1: PromptVersion, v2: PromptVersion): string {
  const leftLines = v1.content.split('\n')
  const rightLines = v2.content.split('\n')
  const ops = diffLines(leftLines, rightLines)

  // Group consecutive ops into hunks of changed lines plus surrounding context.
  const CONTEXT = 3
  const header =
    `--- version ${v1.version}: ${v1.label}\n` +
    `+++ version ${v2.version}: ${v2.label}\n`

  const out: string[] = [header]
  let idx = 0
  let leftLine = 0
  let rightLine = 0

  // Pre-compute line numbers for each op by walking once.
  const opLineNumbers = ops.map((op) => {
    let ln: { left: number | null; right: number | null }
    if (op.kind === 'unchanged') {
      leftLine++
      rightLine++
      ln = { left: leftLine, right: rightLine }
    } else if (op.kind === 'removed') {
      leftLine++
      ln = { left: leftLine, right: null }
    } else {
      rightLine++
      ln = { left: null, right: rightLine }
    }
    return ln
  })

  while (idx < ops.length) {
    // Skip a run of unchanged lines, but remember where the next change is.
    if (ops[idx].kind === 'unchanged') {
      idx++
      continue
    }

    // Find the hunk window: CONTEXT lines before, the change block, CONTEXT after.
    const changeStart = Math.max(0, idx - CONTEXT)
    let changeEnd = idx
    while (changeEnd < ops.length && ops[changeEnd].kind !== 'unchanged') {
      changeEnd++
    }
    // Extend by trailing context, but not past the next change cluster.
    changeEnd = Math.min(ops.length, changeEnd + CONTEXT)

    // Hunk header line ranges.
    const startLeft = opLineNumbers[changeStart].left ?? 0
    const startRight = opLineNumbers[changeStart].right ?? 0
    // Count left/right lines actually within the hunk window.
    let leftCount = 0
    let rightCount = 0
    for (let k = changeStart; k < changeEnd; k++) {
      if (ops[k].kind !== 'added') leftCount++
      if (ops[k].kind !== 'removed') rightCount++
    }
    // Unified diff uses 1-based starts; 0 only when count is 0.
    const lStart = leftCount > 0 ? startLeft : 0
    const rStart = rightCount > 0 ? startRight : 0
    out.push(`@@ -${lStart},${leftCount} +${rStart},${rightCount} @@`)

    for (let k = changeStart; k < changeEnd; k++) {
      const op = ops[k]
      const prefix = op.kind === 'unchanged' ? ' ' : op.kind === 'removed' ? '-' : '+'
      out.push(`${prefix}${op.text}`)
    }

    idx = changeEnd
  }

  return out.join('\n')
}

// ── Utility exports ─────────────────────────────────────────────

/** Clear all stored versions for a single prompt. Returns true if anything was removed. */
export function clearVersions(promptId: string): boolean {
  const store = readStore()
  if (!(promptId in store)) return false
  delete store[promptId]
  writeStore(store)
  return true
}

/** Delete a single version by id. Returns true if it existed. */
export function deleteVersion(promptId: string, versionId: string): boolean {
  const store = readStore()
  const versions = store[promptId]
  if (!versions) return false
  const next = versions.filter((v) => v.id !== versionId)
  if (next.length === versions.length) return false
  store[promptId] = next
  writeStore(store)
  return true
}

// All public types are exported inline at their declarations above.
