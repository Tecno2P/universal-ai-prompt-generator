/**
 * Prompt Debugger — offline, deterministic, no AI.
 *
 * `debugPrompt(prompt)` scans a prompt for 11 well-known prompt-writing
 * defects (vague objective, missing context, contradictory instructions, …)
 * and returns a structured report where each issue carries a severity, a
 * stable `type`, a human description, and a suggested fix.
 *
 * `applyOfflineFix(prompt, issue)` deterministically applies the fix for a
 * single *fixable* issue (missing constraints, undefined output format, …).
 * `applyAllOfflineFixes(prompt)` runs every safe fix in one pass. Fixes that
 * need human judgement (e.g. resolving a real contradiction) are marked
 * `fixable: false` and are skipped by the batch helper.
 *
 * Same prompt → same report. Same prompt + same issue → same fixed prompt.
 */

import type {
  DebugIssue,
  DebugIssueType,
  IssueSeverity,
  OfflineFixResult,
  PromptDebugReport,
  PromptStats,
} from './types'
import { computePromptStats } from './score'

// ── Lexicons (shared with the scorer where sensible) ────────────

const VAGUE_OBJECTIVE_TOKENS: readonly string[] = [
  'help', 'do something', 'make it better', 'improve it', 'fix it',
  'stuff', 'things', 'etc', 'anything', 'whatever', 'good', 'nice',
]

const CONTEXT_TOKENS: readonly string[] = [
  'context', 'background', 'currently', 'situation', 'we have', 'i have',
  'audience', 'project', 'team', 'company', 'working on', 'based on',
  'using', 'existing', 'previously', 'customer', 'user',
]

const CONSTRAINT_TOKENS: readonly string[] = [
  'constraint', 'limit', 'maximum', 'minimum', 'no more than', 'at least',
  'at most', 'within', 'budget', 'deadline', 'cannot', 'must not',
  'only use', 'restrict', 'length', 'words', 'characters', 'tone', 'style',
]

const OUTPUT_FORMAT_TOKENS: readonly string[] = [
  'format', 'output format', 'respond in', 'return as', 'use markdown',
  'json', 'yaml', 'xml', 'csv', 'table', 'bullet', 'numbered list',
  'paragraph', 'code block', 'markdown', 'plain text', 'step by step',
  'in the form of', 'as a list',
]

const OBJECTIVE_TOKENS: readonly string[] = [
  'objective', 'goal', 'aim', 'purpose', 'i want', 'i need', 'help me',
  'generate', 'create', 'write', 'build', 'produce', 'summarize', 'summarise',
  'explain', 'describe', 'list', 'compare', 'translate', 'convert',
]

/** Contradiction pairs — (presence of both in a prompt signals conflict). */
const CONTRADICTION_PAIRS: readonly [string, string][] = [
  ['be concise', 'be detailed'],
  ['be brief', 'be detailed'],
  ['short', 'long'],
  ['simple', 'comprehensive'],
  ['in english', 'in hindi'],
  ['no code', 'include code'],
  ['no markdown', 'use markdown'],
  ['plain text', 'markdown'],
  ['formal', 'casual'],
  ['formal', 'informal'],
  ['professional', 'casual'],
  ['bullet points', 'paragraphs'],
]

/** Pronouns that are ambiguous when their referent is not obviously nearby. */
const AMBIGUOUS_PRONOUNS: readonly string[] = [
  'it', 'this', 'that', 'these', 'those', 'they', 'them', 'its', 'their',
]

// ── Regexes ──────────────────────────────────────────────────────

const DEVANAGARI_RE = /[\u0900-\u097F]/
const LATIN_RE = /[A-Za-z]/

const WORD_SPLIT_RE = /\s+/

// ── Small helpers ───────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wordRe(keyword: string): RegExp {
  return new RegExp(`(^|\\W)${escapeRegExp(keyword)}(\\W|$)`, 'i')
}

function contains(text: string, keyword: string): boolean {
  return wordRe(keyword).test(text)
}

function containsAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some(k => contains(text, k))
}

function countKeywordHits(text: string, keywords: readonly string[]): number {
  let hits = 0
  for (const kw of keywords) {
    if (contains(text, kw)) hits++
  }
  return hits
}

/** Severity rank for stable ordering: high < medium < low. */
function severityRank(s: IssueSeverity): number {
  return s === 'high' ? 0 : s === 'medium' ? 1 : 2
}

interface PromptContext {
  prompt: string
  lower: string
  stats: PromptStats
  words: string[]
}

function buildContext(prompt: string): PromptContext {
  const trimmed = typeof prompt === 'string' ? prompt.trim() : ''
  const lower = trimmed.toLowerCase()
  const stats = computePromptStats(trimmed)
  const words = trimmed.length ? trimmed.split(WORD_SPLIT_RE).filter(Boolean) : []
  return { prompt: trimmed, lower, stats, words }
}

// ── Individual detectors ────────────────────────────────────────
//
// Each detector returns a DebugIssue | null. Returning null means "no problem
// detected for this issue type".

function detectVagueObjective(ctx: PromptContext): DebugIssue | null {
  if (ctx.stats.wordCount === 0) return null
  const objHits = countKeywordHits(ctx.prompt, OBJECTIVE_TOKENS)
  const vagueHits = countKeywordHits(ctx.prompt, VAGUE_OBJECTIVE_TOKENS)

  // "help me" / "do something" with no concrete task verb.
  const hasOnlyVague = vagueHits > 0 && objHits <= vagueHits
  if (hasOnlyVague || (objHits === 0 && ctx.stats.wordCount < 30)) {
    return {
      severity: 'high',
      type: 'vague-objective',
      label: 'Vague Objective',
      description:
        'The prompt does not state a concrete task. Words like "help", "improve", or "do something" ' +
        'leave the model guessing what output is actually expected.',
      suggestedFix:
        'Replace the vague request with a specific action + object, e.g. "Write a 100-word product description for a wireless mouse."',
      fixable: false,
      evidence: VAGUE_OBJECTIVE_TOKENS.find(t => contains(ctx.lower, t)),
    }
  }
  return null
}

function detectMissingContext(ctx: PromptContext): DebugIssue | null {
  if (ctx.stats.wordCount === 0) return null
  const ctxHits = countKeywordHits(ctx.prompt, CONTEXT_TOKENS)
  if (ctxHits > 0) return null

  // A very short prompt with no context words is likely missing context.
  if (ctx.stats.wordCount < 40) {
    return {
      severity: 'medium',
      type: 'missing-context',
      label: 'Missing Context',
      description:
        'No background, audience, or situation is provided. Without context the model cannot tailor ' +
        'depth, tone, or assumptions to your use case.',
      suggestedFix:
        'Add 1–2 sentences of background and name the intended audience, e.g. "Context: I am building a SaaS landing page for non-technical founders."',
      fixable: true,
    }
  }
  return null
}

function detectContradictoryInstructions(ctx: PromptContext): DebugIssue | null {
  if (ctx.stats.wordCount === 0) return null
  for (const [a, b] of CONTRADICTION_PAIRS) {
    if (contains(ctx.lower, a) && contains(ctx.lower, b)) {
      return {
        severity: 'high',
        type: 'contradictory-instructions',
        label: 'Contradictory Instructions',
        description:
          `The prompt asks for both "${a}" and "${b}", which conflict. The model cannot satisfy both at once.`,
        suggestedFix:
          `Decide which directive you want and remove the other. If you want a balance, state it explicitly ` +
          `(e.g. "concise but with enough detail to be actionable").`,
        fixable: false,
        evidence: `"${a}" ↔ "${b}"`,
      }
    }
  }
  return null
}

function detectMissingConstraints(ctx: PromptContext): DebugIssue | null {
  if (ctx.stats.wordCount === 0) return null
  const conHits = countKeywordHits(ctx.prompt, CONSTRAINT_TOKENS)
  const hasLengthHint = /\b\d+\s*(words?|sentences?|paragraphs?|lines?|tokens?|characters?)\b/i.test(ctx.prompt)
  if (conHits > 0 || hasLengthHint) return null

  return {
    severity: 'medium',
    type: 'missing-constraints',
    label: 'Missing Constraints',
    description:
      'No constraints (length, tone, scope, or things to avoid) are specified. The model may over- or under-produce.',
    suggestedFix:
      'Add explicit limits such as word count, tone, and scope, e.g. "Under 200 words, professional tone, avoid jargon."',
    fixable: true,
  }
}

function detectUndefinedOutputFormat(ctx: PromptContext): DebugIssue | null {
  if (ctx.stats.wordCount === 0) return null
  const fmtHits = countKeywordHits(ctx.prompt, OUTPUT_FORMAT_TOKENS)
  if (fmtHits > 0) return null
  // Code fence or explicit "JSON"/"markdown" also counts.
  if (/```|\bjson\b|\bmarkdown\b|\byaml\b|\bcsv\b/i.test(ctx.prompt)) return null

  return {
    severity: 'medium',
    type: 'undefined-output-format',
    label: 'Undefined Output Format',
    description:
      'No output format is specified. The model will choose its own structure, which may not match your needs.',
    suggestedFix:
      'State the desired format, e.g. "Respond in Markdown with headings and a code block."',
    fixable: true,
  }
}

function detectAmbiguousPronouns(ctx: PromptContext): DebugIssue | null {
  if (ctx.stats.wordCount === 0) return null
  // Look for an ambiguous pronoun starting a sentence/clause with no clear noun nearby.
  // Heuristic: a pronoun is the first token of a sentence (after . ! ? or line start).
  // Split after sentence-ending punctuation (lookbehind), which keeps the sentences
  // intact rather than consuming them like a content-matching split would.
  const sentences = ctx.prompt
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
  let evidence: string | undefined
  let ambiguousCount = 0
  for (const sentence of sentences) {
    const firstWord = sentence.split(WORD_SPLIT_RE)[0]?.toLowerCase().replace(/[^a-z]/g, '')
    if (firstWord && AMBIGUOUS_PRONOUNS.includes(firstWord)) {
      // Check whether a concrete noun appears in the previous sentence context —
      // if the prompt is very short, treat as ambiguous.
      ambiguousCount++
      if (!evidence) evidence = firstWord
    }
  }
  if (ambiguousCount === 0) return null

  return {
    severity: 'low',
    type: 'ambiguous-pronouns',
    label: 'Ambiguous Pronouns',
    description:
      `The prompt starts ${ambiguousCount} sentence(s) with a pronoun ("${evidence}") whose referent is not clearly defined, ` +
      'which can cause the model to attach the instruction to the wrong entity.',
    suggestedFix:
      'Replace the opening pronoun with the concrete noun it refers to, e.g. change "It should be short" to "The description should be short".',
    fixable: false,
    evidence,
  }
}

function detectExcessiveRepetition(ctx: PromptContext): DebugIssue | null {
  if (ctx.stats.wordCount === 0) return null
  // Count word-frequency for content words (len >= 4), case-insensitive.
  const freq = new Map<string, number>()
  for (const w of ctx.words) {
    const norm = w.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (norm.length < 4) continue
    freq.set(norm, (freq.get(norm) ?? 0) + 1)
  }
  let worst: { word: string; count: number } | undefined
  for (const [word, count] of freq) {
    // Ignore common stopword-ish tokens.
    if (count < 4) continue
    if (!worst || count > worst.count) worst = { word, count }
  }
  if (!worst) return null

  // Only flag if repetition is disproportionate (> 8% of content words).
  const ratio = worst.count / ctx.stats.wordCount
  if (ratio < 0.08) return null

  return {
    severity: 'low',
    type: 'excessive-repetition',
    label: 'Excessive Repetition',
    description:
      `The word "${worst.word}" appears ${worst.count} times (${Math.round(ratio * 100)}% of the prompt). ` +
      'Heavy repetition can make the prompt harder to parse and may signal redundancy.',
    suggestedFix:
      'Remove duplicate mentions of the same idea, or use a pronoun/abbreviation after the first occurrence.',
    fixable: false,
    evidence: `"${worst.word}" ×${worst.count}`,
  }
}

function detectConflictingLanguageInstructions(ctx: PromptContext): DebugIssue | null {
  if (ctx.stats.wordCount === 0) return null
  const wantsEnglish = /\bin english\b|\brespond in english\b|\benglish only\b|\benglish language\b/i.test(ctx.prompt)
  const wantsHindi = /\bin hindi\b|\bhindi mein\b|\bdevanagari\b|\brespond in hindi\b/i.test(ctx.prompt)
  const hasDevanagari = DEVANAGARI_RE.test(ctx.prompt)
  const hasLatin = LATIN_RE.test(ctx.prompt)

  // Conflict 1: asks for English but written partly in Devanagari.
  if (wantsEnglish && hasDevanagari) {
    return {
      severity: 'medium',
      type: 'conflicting-language-instructions',
      label: 'Conflicting Language Instructions',
      description:
        'The prompt asks for an English response but contains Devanagari script. The model may be unsure which language to use.',
      suggestedFix:
        'Either write the entire prompt in English, or change the instruction to "respond in Hinglish / Hindi" to match the script used.',
      fixable: false,
      evidence: '"in English" + Devanagari text',
    }
  }
  // Conflict 2: asks for Hindi but contains no Hindi/Hinglish at all.
  if (wantsHindi && !hasDevanagari && !containsAny(ctx.lower, ['hinglish', 'mujhe', 'banao', 'karo', 'hai'])) {
    return {
      severity: 'medium',
      type: 'conflicting-language-instructions',
      label: 'Conflicting Language Instructions',
      description:
        'The prompt asks for a Hindi response but is written entirely in English/Latin script with no Hinglish tokens.',
      suggestedFix:
        'Either write the prompt in Hindi (Devanagari) or Hinglish, or change the instruction to "respond in English".',
      fixable: false,
      evidence: '"in Hindi" + Latin-only text',
    }
  }
  // Conflict 3: asks for both English and Hindi simultaneously.
  if (wantsEnglish && wantsHindi) {
    return {
      severity: 'medium',
      type: 'conflicting-language-instructions',
      label: 'Conflicting Language Instructions',
      description:
        'The prompt requests both English and Hindi, which is contradictory unless bilingual output is explicitly intended.',
      suggestedFix:
        'Pick one language, or state explicitly "provide the output bilingually in English and Hindi".',
      fixable: false,
      evidence: '"in English" + "in Hindi"',
    }
  }
  void hasLatin // (used only to narrow; no further branch needed)
  return null
}

function detectIncompleteInput(ctx: PromptContext): DebugIssue | null {
  if (ctx.stats.wordCount === 0) {
    return {
      severity: 'high',
      type: 'incomplete-input',
      label: 'Incomplete Input',
      description: 'The prompt is empty. Nothing for the model to act on.',
      suggestedFix: 'Write out the task, context, and desired output before sending.',
      fixable: false,
    }
  }
  // Unfilled placeholders like {{this}} or <this>.
  const placeholders = ctx.prompt.match(/\{\{[^}]+\}\}|<([a-z_][a-z0-9_]*)>/gi)
  if (placeholders && placeholders.length > 0) {
    return {
      severity: 'high',
      type: 'incomplete-input',
      label: 'Incomplete Input',
      description:
        `The prompt contains ${placeholders.length} unfilled placeholder(s) (e.g. "${placeholders[0]}"). ` +
        'These will be sent literally unless replaced.',
      suggestedFix:
        `Replace every placeholder ({{...}} or <...>) with the actual value before using the prompt.`,
      fixable: true,
      evidence: placeholders[0],
    }
  }
  // Trailing connector suggesting the sentence was cut off.
  const trailingConnector = /\b(?:so that|because|while|when|if|then|and|or|but)\s*$/i.test(ctx.prompt.trim())
  if (trailingConnector && ctx.stats.wordCount < 25) {
    return {
      severity: 'medium',
      type: 'incomplete-input',
      label: 'Incomplete Input',
      description: 'The prompt appears to end mid-thought (trailing connector word), suggesting it was cut off.',
      suggestedFix: 'Finish the sentence and state the expected output explicitly.',
      fixable: false,
      evidence: 'ends with a connector word',
    }
  }
  return null
}

function detectImpossibleRequirements(ctx: PromptContext): DebugIssue | null {
  if (ctx.stats.wordCount === 0) return null
  // "must be 100% accurate" / "no hallucinations ever" / "guaranteed correct" — impossible guarantees.
  const impossiblePatterns: ReadonlyArray<readonly [RegExp, string]> = [
    [/\b100\s*%\s*accurate\b/i, '"100% accurate"'],
    [/\bnever\s+hallucinate\b/i, '"never hallucinate"'],
    [/\bguaranteed\s+(?:correct|accurate|error[- ]?free)\b/i, '"guaranteed correct"'],
    [/\bzero\s+(?:errors?|mistakes?|hallucinations?)\b/i, '"zero errors"'],
    [/\balways\s+(?:correct|right|perfect)\b/i, '"always correct"'],
  ]
  for (const [re, label] of impossiblePatterns) {
    if (re.test(ctx.prompt)) {
      return {
        severity: 'medium',
        type: 'impossible-requirements',
        label: 'Impossible Requirements',
        description:
          `The prompt demands ${label}, which no language model can guarantee. Such guarantees are ignored ` +
          'or lead to sycophantic compliance rather than honest output.',
        suggestedFix:
          'Replace the absolute guarantee with a realistic expectation, e.g. "strive for accuracy and flag uncertainty".',
        fixable: false,
        evidence: label,
      }
    }
  }
  return null
}

function detectOverlyBroadRequest(ctx: PromptContext): DebugIssue | null {
  if (ctx.stats.wordCount === 0) return null
  // Very short prompt with a hyper-generic verb and no scope/object.
  if (ctx.stats.wordCount <= 6) {
    const generic = /\b(?:everything|anything|all about|the whole|complete guide|explain everything)\b/i.test(ctx.prompt)
    if (generic) {
      return {
        severity: 'medium',
        type: 'overly-broad-request',
        label: 'Overly Broad Request',
        description:
          'The prompt asks for "everything" or a "complete guide" with no scope. The model will produce a shallow overview.',
        suggestedFix:
          'Narrow the request to a specific sub-topic, depth, and length, e.g. "Explain JWT authentication for a junior backend developer, ~300 words."',
        fixable: false,
        evidence: 'generic "everything/all" phrasing',
      }
    }
  }
  // Long prompt that still has no constraints and no audience is broadly scoped.
  if (ctx.stats.wordCount > 60 && ctx.stats.wordCount < 200) {
    const hasAudience = /\baudience\b|\bfor (?:a|an|beginners?|experts?|developers?|students?)\b/i.test(ctx.prompt)
    const hasConstraint = countKeywordHits(ctx.prompt, CONSTRAINT_TOKENS) > 0
    if (!hasAudience && !hasConstraint && contains(ctx.lower, 'everything')) {
      return {
        severity: 'low',
        type: 'overly-broad-request',
        label: 'Overly Broad Request',
        description: 'The request is broad ("everything") with no audience or scope to bound it.',
        suggestedFix: 'Add a target audience and a specific scope to focus the output.',
        fixable: false,
      }
    }
  }
  return null
}

// ── Public: debugPrompt ─────────────────────────────────────────

const DETECTORS: ReadonlyArray<(ctx: PromptContext) => DebugIssue | null> = [
  detectVagueObjective,
  detectMissingContext,
  detectContradictoryInstructions,
  detectMissingConstraints,
  detectUndefinedOutputFormat,
  detectAmbiguousPronouns,
  detectExcessiveRepetition,
  detectConflictingLanguageInstructions,
  detectIncompleteInput,
  detectImpossibleRequirements,
  detectOverlyBroadRequest,
]

/**
 * Debug a prompt and return a structured report of every issue found.
 *
 * Runs all 11 detectors in order, then sorts findings by severity (high → low)
 * while preserving detection order within the same severity. The same prompt
 * always yields the same report.
 */
export function debugPrompt(prompt: string): PromptDebugReport {
  const ctx = buildContext(prompt)
  const issues: DebugIssue[] = []
  for (const detect of DETECTORS) {
    const issue = detect(ctx)
    if (issue) issues.push(issue)
  }

  // Sort by severity, stable within equal severity (preserve insertion order).
  issues.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))

  const highSeverityCount = issues.filter(i => i.severity === 'high').length
  const mediumSeverityCount = issues.filter(i => i.severity === 'medium').length
  const lowSeverityCount = issues.filter(i => i.severity === 'low').length
  const fixableCount = issues.filter(i => i.fixable).length

  const parts: string[] = []
  parts.push(`${issues.length} issue${issues.length === 1 ? '' : 's'}`)
  if (highSeverityCount > 0) parts.push(`${highSeverityCount} critical`)
  if (mediumSeverityCount > 0) parts.push(`${mediumSeverityCount} warning${mediumSeverityCount === 1 ? '' : 's'}`)
  if (lowSeverityCount > 0) parts.push(`${lowSeverityCount} minor`)
  const summary = issues.length === 0 ? 'No issues detected' : parts.join(', ')

  return {
    prompt: ctx.prompt,
    analyzedAt: Date.now(),
    issues,
    highSeverityCount,
    mediumSeverityCount,
    lowSeverityCount,
    fixableCount,
    summary,
  }
}

// ── Deterministic offline fixes ─────────────────────────────────

/**
 * The default constraints block appended by `missing-constraints` fix.
 * Kept as a const so tests can assert on it.
 */
export const DEFAULT_CONSTRAINTS_BLOCK = [
  '',
  '**Constraints**:',
  '- Keep the response concise and focused on the task',
  '- Use a clear, professional tone',
  '- Avoid unnecessary jargon or filler',
].join('\n')

/**
 * The default output-format block appended by `undefined-output-format` fix.
 */
export const DEFAULT_OUTPUT_FORMAT_BLOCK = [
  '',
  '**Output Format**:',
  '- Respond in Markdown with clear section headings',
  '- Use code blocks for any code or structured data',
].join('\n')

/** A neutral context hint appended by the `missing-context` fix. */
export const DEFAULT_CONTEXT_BLOCK =
  '\n\n**Context**: Please consider the intended audience and use case when tailoring the response.'

/** Remove `<placeholder>` and `{{placeholder}}` tokens from the prompt. */
function stripPlaceholders(prompt: string): { text: string; count: number } {
  let count = 0
  const text = prompt.replace(/\{\{[^}]+\}\}|<([a-z_][a-z0-9_]*)>/gi, () => {
    count++
    return ''
  })
  // Collapse any double spaces / leading-trailing whitespace introduced.
  return { text: text.replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').trim(), count }
}

/** Normalize excessive line breaks (>2 consecutive) into a single blank line. */
function normalizeBreaks(prompt: string): string {
  return prompt.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Apply one offline fix to a prompt, deterministically.
 *
 * - If the issue is `fixable`, the corresponding transformation is applied and
 *   the result returned (changed or not).
 * - If the issue is NOT fixable, the prompt is returned unchanged with
 *   `applied: []` and `skipped: [type]`.
 * - Passing an issue type whose fix does not match the current prompt (e.g.
 *   asking to fix a `missing-constraints` issue on a prompt that already has
 *   constraints) counts as `skipped`, not `applied`.
 *
 * Only the `type` and `fixable` fields of the issue are read, so callers can
 * pass a partial issue shape.
 */
export function applyOfflineFix(prompt: string, issue: Pick<DebugIssue, 'type' | 'fixable'>): OfflineFixResult {
  const trimmed = typeof prompt === 'string' ? prompt : ''
  const skipped: DebugIssueType[] = []

  if (!issue.fixable) {
    return { prompt: trimmed, applied: [], skipped: [issue.type], changed: false }
  }

  let result = trimmed
  const applied: DebugIssueType[] = []
  const ctx = buildContext(trimmed)

  switch (issue.type) {
    case 'missing-context': {
      // Only append if no context tokens already present (avoid duplicate).
      if (countKeywordHits(ctx.prompt, CONTEXT_TOKENS) === 0) {
        result = trimmed + DEFAULT_CONTEXT_BLOCK
        applied.push(issue.type)
      } else {
        skipped.push(issue.type)
      }
      break
    }

    case 'missing-constraints': {
      const hasLengthHint = /\b\d+\s*(words?|sentences?|paragraphs?|lines?|tokens?|characters?)\b/i.test(ctx.prompt)
      if (countKeywordHits(ctx.prompt, CONSTRAINT_TOKENS) === 0 && !hasLengthHint) {
        result = trimmed + DEFAULT_CONSTRAINTS_BLOCK
        applied.push(issue.type)
      } else {
        skipped.push(issue.type)
      }
      break
    }

    case 'undefined-output-format': {
      const fmtHits = countKeywordHits(ctx.prompt, OUTPUT_FORMAT_TOKENS)
      if (fmtHits === 0 && !/```|\bjson\b|\bmarkdown\b|\byaml\b|\bcsv\b/i.test(ctx.prompt)) {
        result = trimmed + DEFAULT_OUTPUT_FORMAT_BLOCK
        applied.push(issue.type)
      } else {
        skipped.push(issue.type)
      }
      break
    }

    case 'incomplete-input': {
      // Fixable branch: strip unfilled placeholders.
      const placeholders = ctx.prompt.match(/\{\{[^}]+\}\}|<([a-z_][a-z0-9_]*)>/gi)
      if (placeholders && placeholders.length > 0) {
        const { text, count } = stripPlaceholders(ctx.prompt)
        if (count > 0) {
          result = normalizeBreaks(text)
          applied.push(issue.type)
        } else {
          skipped.push(issue.type)
        }
      } else {
        skipped.push(issue.type)
      }
      break
    }

    default:
      // Unknown or non-fixable type.
      skipped.push(issue.type)
  }

  const changed = result !== trimmed
  return { prompt: result, applied, skipped, changed }
}

/**
 * Apply every safe (fixable) fix to a prompt in one pass.
 *
 * Runs `debugPrompt` first, then applies each `fixable` issue in order using
 * `applyOfflineFix`, re-checking after each application so a later fix can see
 * the effect of an earlier one. Non-fixable issues are collected into
 * `skipped`. This is idempotent: running it twice on the same prompt yields the
 * same output (the second run finds nothing left to fix).
 */
export function applyAllOfflineFixes(prompt: string): OfflineFixResult {
  let current = typeof prompt === 'string' ? prompt : ''
  const applied: DebugIssueType[] = []
  const skipped: DebugIssueType[] = []

  // Re-run detection after each successful fix, so e.g. adding constraints does
  // not get re-added. Cap iterations to avoid pathological loops.
  const MAX_PASSES = 6
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const report = debugPrompt(current)
    const fixable = report.issues.find(i => i.fixable && !applied.includes(i.type) && !skipped.includes(i.type))
    if (!fixable) break

    const res = applyOfflineFix(current, fixable)
    if (res.changed && res.applied.length > 0) {
      current = res.prompt
      applied.push(...res.applied)
    } else {
      // Nothing changed — record as skipped so we don't loop on it.
      skipped.push(...(res.applied.length ? res.applied : [fixable.type]))
    }
  }

  // Collect remaining non-fixable issue types for transparency.
  const finalReport = debugPrompt(current)
  for (const issue of finalReport.issues) {
    if (!issue.fixable && !skipped.includes(issue.type)) {
      skipped.push(issue.type)
    }
  }

  return {
    prompt: current,
    applied,
    skipped,
    changed: current !== prompt,
  }
}
