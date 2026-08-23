/**
 * Prompt Quality Score analyzer — offline, deterministic, no AI.
 *
 * `analyzePrompt(prompt)` scores a prompt 0–100 overall across 10 categories
 * (Clarity, Context, Objective, Requirements, Constraints, Output Format,
 * Specificity, Completeness, Language Consistency, Actionability) using pure
 * heuristic rules: keyword presence, regex patterns, word-count thresholds, and
 * script-consistency checks. The same prompt always yields the same report.
 *
 * This is a **heuristic quality estimate**, not objective science. The numbers
 * reflect how well a prompt matches common structural best-practices — they do
 * not guarantee the prompt will produce a good model response.
 */

import type {
  PromptStats,
  PromptQualityReport,
  QualityCategory,
  QualityCategoryScore,
  QualityIssue,
  QualityScoringConfig,
  QualitySuggestion,
  QualityGrade,
} from './types'

// ── Category metadata ────────────────────────────────────────────

/** Canonical display labels for the 10 quality categories (UI order). */
export const SCORE_CATEGORY_LABELS: Readonly<Record<QualityCategory, string>> = {
  clarity: 'Clarity',
  context: 'Context',
  objective: 'Objective',
  requirements: 'Requirements',
  constraints: 'Constraints',
  outputFormat: 'Output Format',
  specificity: 'Specificity',
  completeness: 'Completeness',
  languageConsistency: 'Language Consistency',
  actionability: 'Actionability',
}

/** Stable, ordered list of all 10 categories. */
export const QUALITY_CATEGORIES: readonly QualityCategory[] = [
  'clarity', 'context', 'objective', 'requirements', 'constraints',
  'outputFormat', 'specificity', 'completeness', 'languageConsistency',
  'actionability',
]

/**
 * Default weights for the 10 categories. Weights are normalised at compute
 * time, so only the ratios matter. Objective, Context, and Actionability are
 * weighted highest because they most predict prompt effectiveness.
 */
export const DEFAULT_SCORING_WEIGHTS: Readonly<Record<QualityCategory, number>> = {
  clarity: 1.2,
  context: 1.2,
  objective: 1.5,
  requirements: 1.1,
  constraints: 0.9,
  outputFormat: 1.0,
  specificity: 1.1,
  completeness: 1.0,
  languageConsistency: 0.8,
  actionability: 1.3,
}

// ── Keyword / pattern lexicons ───────────────────────────────────

/** Imperative action verbs at the start of a clause indicate actionability. */
const IMPERATIVE_VERBS: readonly string[] = [
  'create', 'write', 'build', 'generate', 'design', 'analyze', 'analyse',
  'summarize', 'summarise', 'explain', 'describe', 'list', 'compare',
  'convert', 'translate', 'transform', 'implement', 'develop', 'draft',
  'produce', 'outline', 'review', 'evaluate', 'optimize', 'optimise',
  'fix', 'refactor', 'plan', 'structure', 'format', 'extract', 'classify',
  'banao', 'likho', 'karo', 'samjhao', 'likhna', 'bana', 'dikhao',
]

/** Tokens that indicate a role/persona has been assigned. */
const ROLE_TOKENS: readonly string[] = [
  'you are', 'act as', 'pretend you are', 'take the role of',
  'as an expert', 'as a', 'as an', 'behave as', 'assume the role',
  'aap ek', 'tum ek', 'aap ek', 'you are an expert',
]

/** Tokens that signal context/background is provided. */
const CONTEXT_TOKENS: readonly string[] = [
  'context', 'background', 'given that', 'currently', 'situation',
  'we have', 'i have', 'the user', 'audience', 'for someone', 'for a',
  'working on', 'using', 'based on the', 'previously', 'existing',
  'project', 'team', 'company', 'customer',
]

/** Tokens that signal an objective/goal has been stated. */
const OBJECTIVE_TOKENS: readonly string[] = [
  'objective', 'goal', 'aim', 'purpose', 'i want', 'i need', 'help me',
  'task is', 'the goal', 'so that', 'in order to', 'please',
  'generate', 'create', 'write', 'build', 'produce',
]

/** Tokens that signal explicit requirements. */
const REQUIREMENT_TOKENS: readonly string[] = [
  'requirement', 'must', 'should', 'need to', 'needs to', 'ensure',
  'include', 'must include', 'must be', 'has to', 'required',
  'make sure', 'do not', "don't", 'avoid', 'never', 'always',
]

/** Tokens that signal constraints are present. */
const CONSTRAINT_TOKENS: readonly string[] = [
  'constraint', 'limit', 'maximum', 'minimum', 'no more than', 'at least',
  'at most', 'within', 'budget', 'deadline', 'cannot', 'must not',
  'only use', 'restrict', 'length', 'words', 'characters', 'tokens',
  'tone', 'style', 'audience', 'level',
]

/** Tokens that signal an output format is specified. */
const OUTPUT_FORMAT_TOKENS: readonly string[] = [
  'format', 'output format', 'respond in', 'return as', 'use markdown',
  'json', 'yaml', 'xml', 'csv', 'table', 'bullet', 'numbered list',
  'paragraph', 'code block', 'markdown', 'plain text', 'structured',
  'step by step', 'steps', 'in the form of',
]

/** Specificity markers — quantifiers, named entities hints, examples. */
const SPECIFICITY_TOKENS: readonly string[] = [
  'example', 'for instance', 'such as', 'e.g.', 'i.e.', 'specifically',
  'exactly', 'precisely', 'named', 'called', 'version', 'number of',
  'at least', 'exactly', 'approximately', 'roughly',
]

/** Hinglish (Roman Hindi) tokens reused from the engine's language layer. */
const HINGLISH_TOKENS: readonly string[] = [
  'mujhe', 'mere', 'mera', 'meri', 'bana', 'banao', 'kar', 'karo', 'chahiye',
  'hai', 'ho', 'kya', 'lekin', 'nahi', 'nahin', 'aur', 'ya', 'mein', 'par',
  'sath', 'saath', 'kuch', 'sab', 'bhi', 'toh', 'hi',
]

/** Vague filler words that reduce clarity / specificity. */
const VAGUE_TOKENS: readonly string[] = [
  'stuff', 'things', 'etc', 'whatever', 'something', 'some', 'anything',
  'everything', 'good', 'nice', 'proper', 'basically', 'just',
  'kind of', 'sort of', 'maybe', 'perhaps', 'probably', 'a bit',
]

// ── Regexes (compiled once) ─────────────────────────────────────

/** Sentence-ish boundaries: . ! ? possibly followed by quotes, then whitespace. */
const SENTENCE_SPLIT_RE = /[^.!?]+[.!?]+["')\]]*\s*/g

/** Devanagari (Hindi) Unicode block. */
const DEVANAGARI_RE = /[\u0900-\u097F]/

/** CJK Unified Ideographs + Hiragana + Katakana + Hangul. */
const CJK_RE = /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/

/** Arabic + Arabic-Indic digits block. */
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F]/

/** Latin letters (covers accented latin too). */
const LATIN_RE = /[\u0041-\u005A\u0061-\u007A\u00C0-\u024F]/

/** Markdown section headers (`**Label**:` or `## Heading`). */
const MD_SECTION_RE = /\*\*[^*]{2,80}\*\*\s*:|^#{1,6}\s+\S/m

/** Markdown/numbered list lines. */
const LIST_RE = /^\s*(?:[-*•]|\d+[.)])\s+\S/m

/** A code fence opening. */
const CODE_FENCE_RE = /```/

/** Mentions of an audience explicitly. */
const AUDIENCE_RE = /\b(for|target(?:ing)?|aimed at|audience is|reader[s]? are|user[s]? are)\s+(?:an?\s+|the\s+)?([a-z][a-z\s-]{3,60})/i

// ── Small text helpers ───────────────────────────────────────────

/** Escape a keyword for safe insertion into a regex. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whole-word, case-insensitive regex for a keyword phrase. */
function wordRe(keyword: string): RegExp {
  return new RegExp(`(^|\\W)${escapeRegExp(keyword)}(\\W|$)`, 'i')
}

/** Count how many of `keywords` appear in `text` (case-insensitive). */
function countKeywordHits(text: string, keywords: readonly string[]): number {
  let hits = 0
  for (const kw of keywords) {
    if (wordRe(kw).test(text)) hits++
  }
  return hits
}

/** Count how many of `keywords` appear anywhere as substrings (case-insensitive). */
function countSubstringHits(lowerText: string, keywords: readonly string[]): number {
  let hits = 0
  for (const kw of keywords) {
    if (lowerText.includes(kw)) hits++
  }
  return hits
}

/** Clamp a number to [min, max]. */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

// ── Stats computation ───────────────────────────────────────────

/** Compute the lightweight statistics used by several checks. */
export function computePromptStats(prompt: string): PromptStats {
  const trimmed = prompt.trim()
  if (!trimmed) {
    return {
      charCount: 0,
      wordCount: 0,
      sentenceCount: 0,
      lineCount: 0,
      avgWordsPerSentence: 0,
      dominantScript: 'empty',
      hasMixedScripts: false,
    }
  }

  const charCount = trimmed.length
  const words = trimmed.split(/\s+/).filter(Boolean)
  const wordCount = words.length
  const lineCount = trimmed.split(/\n/).length

  const sentences = trimmed.match(SENTENCE_SPLIT_RE)
  const sentenceCount = sentences ? sentences.length : (wordCount > 0 ? 1 : 0)
  const avgWordsPerSentence = sentenceCount > 0 ? wordCount / sentenceCount : 0

  // Script detection.
  const hasLatin = LATIN_RE.test(trimmed)
  const hasDevanagari = DEVANAGARI_RE.test(trimmed)
  const hasCjk = CJK_RE.test(trimmed)
  const hasArabic = ARABIC_RE.test(trimmed)

  const presentScripts: string[] = []
  if (hasLatin) presentScripts.push('latin')
  if (hasDevanagari) presentScripts.push('devanagari')
  if (hasCjk) presentScripts.push('cjk')
  if (hasArabic) presentScripts.push('arabic')

  const hasMixedScripts = presentScripts.length >= 2
  let dominantScript: PromptStats['dominantScript']
  if (presentScripts.length === 0) dominantScript = 'empty'
  else if (presentScripts.length === 1) dominantScript = presentScripts[0] as PromptStats['dominantScript']
  else dominantScript = 'mixed'

  return {
    charCount,
    wordCount,
    sentenceCount,
    lineCount,
    avgWordsPerSentence,
    dominantScript,
    hasMixedScripts,
  }
}

// ── Per-category scorers ─────────────────────────────────────────
//
// Each scorer returns { score: 0-100, detail }. They read from a shared
// `PromptContext` so we only compute stats once.

interface PromptContext {
  prompt: string
  lower: string
  stats: PromptStats
}

/** CLARITY: readable, not too short, not riddled with vague filler. */
function scoreClarity(ctx: PromptContext): { score: number; detail: string } {
  const { stats, lower } = ctx
  if (stats.wordCount === 0) return { score: 0, detail: 'Empty prompt' }

  let score = 70
  // Too short → hard to be clear.
  if (stats.wordCount < 5) score -= 30
  else if (stats.wordCount < 12) score -= 15
  // Reasonable length rewards clarity.
  if (stats.wordCount >= 20 && stats.wordCount <= 400) score += 15
  // Very long prompts lose clarity.
  if (stats.wordCount > 800) score -= 10

  // Vague fillers reduce clarity.
  const vagueHits = countSubstringHits(lower, VAGUE_TOKENS)
  score -= vagueHits * 8

  // Markdown structure aids clarity.
  if (MD_SECTION_RE.test(ctx.prompt)) score += 10
  if (LIST_RE.test(ctx.prompt)) score += 5

  return { score: clamp(score, 0, 100), detail: vagueHits > 0 ? `${vagueHits} vague filler term(s)` : 'Reasonable wording' }
}

/** CONTEXT: background, audience, or situational info present. */
function scoreContext(ctx: PromptContext): { score: number; detail: string } {
  const { lower } = ctx
  if (ctx.stats.wordCount === 0) return { score: 0, detail: 'Empty prompt' }

  const contextHits = countKeywordHits(ctx.prompt, CONTEXT_TOKENS)
  const hasAudience = AUDIENCE_RE.test(lower) || /\baudience\b|\breader[s]?\b|\buser[s]?\b/i.test(lower)

  let score = 40
  score += contextHits * 10
  if (hasAudience) score += 20
  if (MD_SECTION_RE.test(ctx.prompt) && /\bcontext\b/i.test(lower)) score += 15

  return { score: clamp(score, 0, 100), detail: `${contextHits} context signal(s)${hasAudience ? ', audience named' : ''}` }
}

/** OBJECTIVE: a clear goal or task is stated. */
function scoreObjective(ctx: PromptContext): { score: number; detail: string } {
  const { lower } = ctx
  if (ctx.stats.wordCount === 0) return { score: 0, detail: 'Empty prompt' }

  const objHits = countKeywordHits(ctx.prompt, OBJECTIVE_TOKENS)
  const roleHits = countSubstringHits(lower, ROLE_TOKENS)
  let score = 30
  score += objHits * 15
  if (roleHits > 0) score += 25
  if (/\bobjective\b|\bgoal\b/i.test(lower) || MD_SECTION_RE.test(ctx.prompt) && /objective/i.test(lower)) score += 10

  return { score: clamp(score, 0, 100), detail: `${objHits} objective signal(s), ${roleHits} role signal(s)` }
}

/** REQUIREMENTS: explicit must/should/include directives. */
function scoreRequirements(ctx: PromptContext): { score: number; detail: string } {
  if (ctx.stats.wordCount === 0) return { score: 0, detail: 'Empty prompt' }

  const reqHits = countKeywordHits(ctx.prompt, REQUIREMENT_TOKENS)
  const listLines = (ctx.prompt.match(/^\s*(?:[-*•]|\d+[.)])\s+\S/gm) ?? []).length

  let score = 35
  score += reqHits * 12
  score += Math.min(listLines, 6) * 6

  return { score: clamp(score, 0, 100), detail: `${reqHits} requirement signal(s), ${listLines} list item(s)` }
}

/** CONSTRAINTS: limits, scope, tone, length, etc. */
function scoreConstraints(ctx: PromptContext): { score: number; detail: string } {
  if (ctx.stats.wordCount === 0) return { score: 0, detail: 'Empty prompt' }

  const conHits = countKeywordHits(ctx.prompt, CONSTRAINT_TOKENS)
  let score = 30
  score += conHits * 12
  if (/\bconstraint[s]?\b/i.test(ctx.prompt)) score += 15
  // A length hint counts as a soft constraint.
  if (/\b\d+\s*(words?|sentences?|paragraphs?|lines?|tokens?|characters?)\b/i.test(ctx.prompt)) score += 10

  return { score: clamp(score, 0, 100), detail: `${conHits} constraint signal(s)` }
}

/** OUTPUT FORMAT: a format or response shape is specified. */
function scoreOutputFormat(ctx: PromptContext): { score: number; detail: string } {
  if (ctx.stats.wordCount === 0) return { score: 0, detail: 'Empty prompt' }

  const fmtHits = countKeywordHits(ctx.prompt, OUTPUT_FORMAT_TOKENS)
  let score = 25
  score += fmtHits * 12
  if (CODE_FENCE_RE.test(ctx.prompt)) score += 15
  if (/\bjson\b|\bmarkdown\b|\byaml\b|\bcsv\b/i.test(ctx.prompt)) score += 15
  if (/\boutput\s*format\b/i.test(ctx.prompt)) score += 15

  return { score: clamp(score, 0, 100), detail: `${fmtHits} format signal(s)` }
}

/** SPECIFICITY: examples, quantifiers, named references. */
function scoreSpecificity(ctx: PromptContext): { score: number; detail: string } {
  if (ctx.stats.wordCount === 0) return { score: 0, detail: 'Empty prompt' }

  const specHits = countKeywordHits(ctx.prompt, SPECIFICITY_TOKENS)
  const numberHits = (ctx.prompt.match(/\b\d+(\.\d+)?\b/g) ?? []).length
  const vagueHits = countSubstringHits(ctx.lower, VAGUE_TOKENS)

  let score = 40
  score += specHits * 10
  score += Math.min(numberHits, 5) * 6
  score -= vagueHits * 6

  return { score: clamp(score, 0, 100), detail: `${specHits} specificity marker(s), ${numberHits} number(s)` }
}

/** COMPLETENESS: covers role + objective + context + format (structural coverage). */
function scoreCompleteness(ctx: PromptContext): { score: number; detail: string } {
  if (ctx.stats.wordCount === 0) return { score: 0, detail: 'Empty prompt' }

  const hasRole = countSubstringHits(ctx.lower, ROLE_TOKENS) > 0
  const hasObjective = countKeywordHits(ctx.prompt, OBJECTIVE_TOKENS) > 0
  const hasContext = countKeywordHits(ctx.prompt, CONTEXT_TOKENS) > 0
  const hasFormat = countKeywordHits(ctx.prompt, OUTPUT_FORMAT_TOKENS) > 0
  const hasConstraints = countKeywordHits(ctx.prompt, CONSTRAINT_TOKENS) > 0

  const pillars = [hasRole, hasObjective, hasContext, hasFormat, hasConstraints]
  const present = pillars.filter(Boolean).length
  const score = Math.round((present / pillars.length) * 100)

  return { score, detail: `${present}/${pillars.length} structural pillars present` }
}

/** LANGUAGE CONSISTENCY: one script/language family throughout. */
function scoreLanguageConsistency(ctx: PromptContext): { score: number; detail: string } {
  if (ctx.stats.wordCount === 0) return { score: 0, detail: 'Empty prompt' }

  // Mixed scripts are the main consistency penalty.
  let score = 90
  if (ctx.stats.hasMixedScripts) {
    // Latin + Devanagari is common for Hinglish — penalise lightly; other mixes more.
    const isHinglishMix =
      ctx.stats.dominantScript === 'mixed' &&
      LATIN_RE.test(ctx.prompt) && DEVANAGARI_RE.test(ctx.prompt) &&
      !CJK_RE.test(ctx.prompt) && !ARABIC_RE.test(ctx.prompt)
    score -= isHinglishMix ? 15 : 35
  }

  // Hinglish tokens mixed into an otherwise English prompt are fine, but flag
  // if the prompt also requests a specific language that conflicts.
  const hinglishHits = countSubstringHits(ctx.lower, HINGLISH_TOKENS)
  if (hinglishHits > 0 && ctx.stats.dominantScript === 'latin') {
    // Slight credit for deliberate Hinglish usage, but cap to avoid rewarding noise.
    score += 0
  }

  // Explicit language instructions that conflict (e.g. "in English" while in Hindi).
  const wantsEnglish = /\bin english\b|\brespond in english\b|\benglish only\b/i.test(ctx.prompt)
  const wantsHindi = /\bin hindi\b|\bdevanagari\b/i.test(ctx.prompt)
  if (wantsEnglish && DEVANAGARI_RE.test(ctx.prompt)) score -= 30
  if (wantsHindi && !DEVANAGARI_RE.test(ctx.prompt) && !HINGLISH_TOKENS.some(t => ctx.lower.includes(t))) {
    score -= 10
  }

  return { score: clamp(score, 0, 100), detail: ctx.stats.hasMixedScripts ? 'Mixed scripts detected' : 'Consistent script' }
}

/** ACTIONABILITY: imperative verbs, clear next steps. */
function scoreActionability(ctx: PromptContext): { score: number; detail: string } {
  if (ctx.stats.wordCount === 0) return { score: 0, detail: 'Empty prompt' }

  const verbHits = countKeywordHits(ctx.prompt, IMPERATIVE_VERBS)
  let score = 40
  score += Math.min(verbHits, 5) * 12

  // Numbered steps strongly indicate an actionable plan.
  const numberedSteps = (ctx.prompt.match(/^\s*\d+[.)]\s+\S/gm) ?? []).length
  score += Math.min(numberedSteps, 5) * 6

  // A question-only prompt is less actionable.
  if (ctx.prompt.trim().endsWith('?') && verbHits === 0) score -= 15

  return { score: clamp(score, 0, 100), detail: `${verbHits} imperative verb(s), ${numberedSteps} numbered step(s)` }
}

// ── Grade & issues/suggestions ──────────────────────────────────

/** Map an overall score to a letter-style grade. */
export function gradeForScore(score: number): QualityGrade {
  if (score <= 0) return 'empty'
  if (score >= 85) return 'excellent'
  if (score >= 70) return 'good'
  if (score >= 50) return 'fair'
  return 'poor'
}

/** Build the issues + suggestions lists from the per-category results. */
function buildIssuesAndSuggestions(
  ctx: PromptContext,
  subscores: Map<QualityCategory, { score: number; detail: string }>,
): { issues: QualityIssue[]; suggestions: QualitySuggestion[] } {
  const issues: QualityIssue[] = []
  const suggestions: QualitySuggestion[] = []

  const addIssue = (category: QualityCategory, title: string, description: string): void => {
    issues.push({ category, title, description })
  }
  const addSuggestion = (category: QualityCategory, title: string, description: string): void => {
    suggestions.push({ category, title, description })
  }

  // Objective.
  if (subscores.get('objective')!.score < 50) {
    addIssue('objective', 'No clear objective or role stated',
      'The prompt does not clearly state what the model should produce or what role it should adopt. ' +
      'Without a stated goal the model will guess at intent.')
    addSuggestion('objective', 'State the objective and assign a role',
      'Add an explicit goal (e.g. "Generate a ...") and a role (e.g. "You are an expert ..."). ' +
      'Place the goal near the top of the prompt.')
  }

  // Context.
  if (subscores.get('context')!.score < 50) {
    addIssue('context', 'Missing context or target audience',
      'There is little background or audience information, so the model cannot tailor tone, depth, or assumptions.')
    addSuggestion('context', 'Provide context and name the audience',
      'Add 1–2 sentences of background and state who the output is for (e.g. "for a beginner", "for a technical team").')
  }

  // Requirements.
  if (subscores.get('requirements')!.score < 50) {
    addIssue('requirements', 'No explicit requirements',
      'The prompt lacks "must / should / include" directives, so the model does not know what is mandatory.')
    addSuggestion('requirements', 'List explicit requirements',
      'Add a bulleted list of must-haves and should-haves. Use imperative phrasing like "Must include ...".')
  }

  // Constraints.
  if (subscores.get('constraints')!.score < 50) {
    addIssue('constraints', 'No constraints specified',
      'Without constraints (length, tone, scope, things to avoid) the model may over- or under-produce.')
    addSuggestion('constraints', 'Add concrete constraints',
      'State limits such as word count, tone, scope, or things to avoid (e.g. "Under 200 words", "Avoid jargon").')
  }

  // Output format.
  if (subscores.get('outputFormat')!.score < 50) {
    addIssue('outputFormat', 'Undefined output format',
      'No response format is specified, so the model will choose its own structure unpredictably.')
    addSuggestion('outputFormat', 'Specify the output format',
      'State the desired format: Markdown, JSON, a numbered list, a code block, or "step by step".')
  }

  // Specificity.
  if (subscores.get('specificity')!.score < 50) {
    addIssue('specificity', 'Low specificity',
      'The prompt uses few examples, numbers, or precise terms, increasing the chance of a generic response.')
    addSuggestion('specificity', 'Add examples and precise terms',
      'Include 1–2 concrete examples (e.g. "such as ...") and specific names, versions, or quantities.')
  }

  // Clarity.
  if (subscores.get('clarity')!.score < 50) {
    addIssue('clarity', 'Low clarity',
      'The prompt is very short or relies on vague filler words, making intent hard to pin down.')
    addSuggestion('clarity', 'Tighten wording and remove filler',
      'Replace vague terms ("stuff", "things", "proper") with concrete nouns, and expand any one-liners.')
  }

  // Completeness.
  if (subscores.get('completeness')!.score < 60) {
    const missing: string[] = []
    if (countSubstringHits(ctx.lower, ROLE_TOKENS) === 0) missing.push('role')
    if (countKeywordHits(ctx.prompt, OBJECTIVE_TOKENS) === 0) missing.push('objective')
    if (countKeywordHits(ctx.prompt, CONTEXT_TOKENS) === 0) missing.push('context')
    if (countKeywordHits(ctx.prompt, OUTPUT_FORMAT_TOKENS) === 0) missing.push('output format')
    if (countKeywordHits(ctx.prompt, CONSTRAINT_TOKENS) === 0) missing.push('constraints')
    addIssue('completeness', 'Incomplete prompt structure',
      `Key structural pillars are missing: ${missing.join(', ') || 'several sections'}.`)
    addSuggestion('completeness', 'Fill in the missing sections',
      'Use labelled sections (Role, Context, Objective, Requirements, Output Format) so nothing is implied.')
  }

  // Language consistency.
  if (subscores.get('languageConsistency')!.score < 60) {
    addIssue('languageConsistency', 'Inconsistent language or script',
      'The prompt mixes scripts (e.g. Latin and Devanagari) or requests a language that conflicts with its content.')
    addSuggestion('languageConsistency', 'Pick one language and script',
      'Write the whole prompt in one language/script, or use Hinglish deliberately and consistently throughout.')
  }

  // Actionability.
  if (subscores.get('actionability')!.score < 50) {
    addIssue('actionability', 'Weak actionability',
      'The prompt contains few imperative verbs or numbered steps, so the model may not know what action to take.')
    addSuggestion('actionability', 'Use imperative verbs and steps',
      'Lead with action verbs (Create, Write, Summarise) and add a numbered step list for multi-part tasks.')
  }

  // Length-based suggestions (not tied to one category).
  if (ctx.stats.wordCount > 0 && ctx.stats.wordCount < 8) {
    addSuggestion('completeness', 'Expand the prompt',
      `The prompt is only ${ctx.stats.wordCount} word(s). Add detail so the model has enough to act on.`)
  }
  if (ctx.stats.wordCount > 1000) {
    addSuggestion('clarity', 'Consider trimming the prompt',
      `The prompt is ${ctx.stats.wordCount} words long. Long prompts can dilute focus — consider splitting or trimming.`)
  }

  return { issues, suggestions }
}

// ── Weighted score aggregation ──────────────────────────────────

/** Merge a partial caller config with the default weights, validating values. */
function resolveWeights(config?: QualityScoringConfig): Record<QualityCategory, number> {
  const out: Record<QualityCategory, number> = { ...DEFAULT_SCORING_WEIGHTS }
  if (!config) return out
  for (const cat of QUALITY_CATEGORIES) {
    const v = config[cat]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      out[cat] = v
    }
  }
  return out
}

/** Compute the weighted average of the category sub-scores. */
function computeOverall(
  subscores: Map<QualityCategory, number>,
  weights: Record<QualityCategory, number>,
): number {
  let totalWeight = 0
  let weighted = 0
  for (const cat of QUALITY_CATEGORIES) {
    const w = weights[cat]
    const s = subscores.get(cat) ?? 0
    weighted += s * w
    totalWeight += w
  }
  if (totalWeight === 0) return 0
  return Math.round(weighted / totalWeight)
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Analyze a prompt and return a heuristic quality report.
 *
 * The prompt is scored 0–100 overall across 10 categories. The same prompt
 * always yields the same report (no randomness, no AI, no network). Pass an
 * optional {@link QualityScoringConfig} to override category weights.
 *
 * @example
 * ```ts
 * const report = analyzePrompt('You are an expert copywriter. Write a 50-word product description for a wireless mouse. Respond in Markdown.')
 * console.log(report.overallScore, report.grade)
 * ```
 */
export function analyzePrompt(prompt: string, config?: QualityScoringConfig): PromptQualityReport {
  const trimmed = typeof prompt === 'string' ? prompt : ''
  const stats = computePromptStats(trimmed)
  const ctx: PromptContext = { prompt: trimmed, lower: trimmed.toLowerCase(), stats }
  const weights = resolveWeights(config)

  // Run all 10 scorers.
  const scorers: ReadonlyArray<readonly [QualityCategory, (c: PromptContext) => { score: number; detail: string }]> = [
    ['clarity', scoreClarity],
    ['context', scoreContext],
    ['objective', scoreObjective],
    ['requirements', scoreRequirements],
    ['constraints', scoreConstraints],
    ['outputFormat', scoreOutputFormat],
    ['specificity', scoreSpecificity],
    ['completeness', scoreCompleteness],
    ['languageConsistency', scoreLanguageConsistency],
    ['actionability', scoreActionability],
  ]

  const subscores = new Map<QualityCategory, { score: number; detail: string }>()
  const subScoresList: QualityCategoryScore[] = []
  for (const [cat, fn] of scorers) {
    const res = fn(ctx)
    subscores.set(cat, res)
    subScoresList.push({ id: cat, label: SCORE_CATEGORY_LABELS[cat], score: res.score, detail: res.detail })
  }

  const overallScore = computeOverall(
    new Map(Array.from(subscores.entries()).map(([k, v]) => [k, v.score])),
    weights,
  )
  const grade = gradeForScore(overallScore)

  const { issues, suggestions } = buildIssuesAndSuggestions(ctx, subscores)

  return {
    prompt: trimmed,
    analyzedAt: Date.now(),
    overallScore,
    grade,
    method: 'heuristic quality estimate',
    subScores: subScoresList,
    issues,
    suggestions,
    stats,
    weights,
  }
}
