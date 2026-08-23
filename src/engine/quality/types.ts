/**
 * Shared type definitions for the offline Prompt Quality and Debugger modules.
 *
 * Everything in this folder runs fully offline: no AI calls, no network, no
 * external dependencies. All detection is based on deterministic heuristic
 * rules (regex, keyword sets, counters) so the same prompt always yields the
 * same report. Treat the scores as a *heuristic quality estimate*, not as an
 * objective or scientific measurement of prompt effectiveness.
 *
 * `score.ts` answers "how well-structured is this prompt?" while `debugger.ts`
 * answers "what is concretely wrong with it, and can I fix it offline?".
 */

// ── Common primitives ───────────────────────────────────────────

/** Severity of a debugger finding. Maps roughly to score impact. */
export type IssueSeverity = 'low' | 'medium' | 'high'

/**
 * The 10 quality categories a prompt is scored against.
 *
 * These are the canonical, stable category identifiers — they appear in
 * `QualityCategoryScore.id` and in the `subScores` map. UI labels live in
 * `SCORE_CATEGORY_LABELS` (in `./score.ts`).
 */
export type QualityCategory =
  | 'clarity'
  | 'context'
  | 'objective'
  | 'requirements'
  | 'constraints'
  | 'outputFormat'
  | 'specificity'
  | 'completeness'
  | 'languageConsistency'
  | 'actionability'

/** A human-readable label for each quality category. */
export type QualityCategoryLabel = string

/**
 * A single, actionable suggestion for improving a prompt's quality.
 *
 * Suggestions are *improvements* (things to add or refine), distinct from
 * `QualityIssue` which describes a concrete problem.
 */
export interface QualitySuggestion {
  /** Which category this suggestion relates to. */
  category: QualityCategory
  /** Short title, e.g. "Add a target audience". */
  title: string
  /** One or two sentences explaining what to do and why. */
  description: string
}

/**
 * A concrete problem detected by the quality analyzer.
 *
 * Issues are *warnings* about something missing or weak, distinct from
 * `DebugIssue` which is a debugger finding with an optional automatic fix.
 */
export interface QualityIssue {
  /** Which category this issue relates to. */
  category: QualityCategory
  /** Short title, e.g. "No objective or role stated". */
  title: string
  /** What is wrong, and why it matters. */
  description: string
}

/** Result of scoring one of the 10 categories. */
export interface QualityCategoryScore {
  /** The category identifier. */
  id: QualityCategory
  /** Human-readable label, e.g. "Clarity". */
  label: QualityCategoryLabel
  /** 0–100 sub-score for this category. */
  score: number
  /** Brief explanation of how the sub-score was derived. */
  detail: string
}

/**
 * The full quality report returned by `analyzePrompt()`.
 *
 * The overall score is a weighted average of the 10 category sub-scores; the
 * weights are configurable via `QualityScoringConfig`. Remember: this is a
 * heuristic quality estimate, not an objective metric.
 */
export interface PromptQualityReport {
  /** The prompt that was analyzed (unmodified). */
  prompt: string
  /** Epoch ms when the analysis ran. */
  analyzedAt: number
  /** 0–100 overall score (weighted average of sub-scores). */
  overallScore: number
  /** A short textual grade derived from `overallScore`, e.g. "Good". */
  grade: QualityGrade
  /** Explicit reminder that this is a heuristic estimate. */
  method: 'heuristic quality estimate'
  /** Per-category sub-scores (length always 10, in canonical order). */
  subScores: QualityCategoryScore[]
  /** Concrete problems found (warnings). */
  issues: QualityIssue[]
  /** Actionable improvements (distinct from issues). */
  suggestions: QualitySuggestion[]
  /** Basic stats about the prompt. */
  stats: PromptStats
  /** The effective weights actually used (defaults merged with caller config). */
  weights: Readonly<Record<QualityCategory, number>>
}

/** Letter-style grade bucketing the overall score. */
export type QualityGrade = 'excellent' | 'good' | 'fair' | 'poor' | 'empty'

/** Lightweight statistics computed from the raw prompt text. */
export interface PromptStats {
  /** Total character count (trimmed). */
  charCount: number
  /** Whitespace-separated token count (trimmed). */
  wordCount: number
  /** Number of sentences (approximate — split on . ! ? followed by space/end). */
  sentenceCount: number
  /** Number of lines. */
  lineCount: number
  /** Average words per sentence (0 when no sentences). */
  avgWordsPerSentence: number
  /** Detected dominant script family used for language-consistency checks. */
  dominantScript: 'latin' | 'devanagari' | 'cjk' | 'arabic' | 'mixed' | 'empty'
  /** True if the prompt mixes two or more script families. */
  hasMixedScripts: boolean
}

/**
 * Configurable scoring weights for `analyzePrompt()`.
 *
 * Every weight must be a non-negative finite number. Weights are normalised
 * internally, so absolute magnitudes do not matter — only their ratios. Passing
 * a partial config merges with `DEFAULT_SCORING_WEIGHTS`.
 */
export type QualityScoringConfig = Partial<Record<QualityCategory, number>>

// ── Debugger types ──────────────────────────────────────────────

/**
 * Stable identifiers for every kind of debugger finding.
 *
 * The `type` field on a `DebugIssue` always uses one of these values, so
 * callers can switch on it or look up a fix safely.
 */
export type DebugIssueType =
  | 'vague-objective'
  | 'missing-context'
  | 'contradictory-instructions'
  | 'missing-constraints'
  | 'undefined-output-format'
  | 'ambiguous-pronouns'
  | 'excessive-repetition'
  | 'conflicting-language-instructions'
  | 'incomplete-input'
  | 'impossible-requirements'
  | 'overly-broad-request'

/**
 * A single concrete problem found by the prompt debugger.
 *
 * Unlike `QualityIssue` (a soft warning), a `DebugIssue` always carries a
 * severity and a *suggested fix*; issues whose `fixable` flag is `true` can be
 * resolved deterministically by `applyOfflineFix()`.
 */
export interface DebugIssue {
  /** Severity — drives both UI ordering and the quality-score penalty. */
  severity: IssueSeverity
  /** Stable identifier for the issue kind. */
  type: DebugIssueType
  /** Human-readable label, e.g. "Vague Objective". */
  label: string
  /** What is wrong, with enough detail for the user to understand it. */
  description: string
  /** Concrete, actionable instruction for how to fix it manually. */
  suggestedFix: string
  /**
   * `true` when `applyOfflineFix()` can apply this fix deterministically.
   * `false` means the fix needs human judgement (e.g. resolving a contradiction).
   */
  fixable: boolean
  /**
   * Optional evidence: a snippet or token from the prompt that triggered the
   * detection (kept short for UI display).
   */
  evidence?: string
}

/**
 * The full debug report returned by `debugPrompt()`.
 */
export interface PromptDebugReport {
  /** The prompt that was analyzed (unmodified). */
  prompt: string
  /** Epoch ms when the analysis ran. */
  analyzedAt: number
  /** All findings, ordered high → low severity then by detection order. */
  issues: DebugIssue[]
  /** Count of `high`-severity findings. */
  highSeverityCount: number
  /** Count of `medium`-severity findings. */
  mediumSeverityCount: number
  /** Count of `low`-severity findings. */
  lowSeverityCount: number
  /** How many of the findings are auto-fixable. */
  fixableCount: number
  /** A short, human-readable summary, e.g. "3 issues found (1 critical)". */
  summary: string
}

/**
 * The result of applying one (or all) offline fixes to a prompt.
 *
 * `applied` lists the issue types that were actually applied; `skipped` lists
 * the ones that were passed over (not fixable, or the fix did not match).
 */
export interface OfflineFixResult {
  /** The prompt as it stands after applying the fix(es). */
  prompt: string
  /** Issue types whose fix was applied. */
  applied: DebugIssueType[]
  /** Issue types whose fix was skipped (not fixable / no match). */
  skipped: DebugIssueType[]
  /** `true` when the prompt changed. */
  changed: boolean
}
