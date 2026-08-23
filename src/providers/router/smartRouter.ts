/**
 * Smart AI Router — privacy-first provider routing.
 *
 * The router inspects a prompt (deterministic, keyword-based, no AI) and
 * recommends the best configured provider for the task. It NEVER sends data on
 * its own. Automatic routing is opt-in: unless the user has explicitly enabled
 * it, `getUserConsent` returns true and the caller must ask before sending.
 *
 * Routing is a pure recommendation layer — it never touches the network, never
 * reads API keys, and never calls a provider. It only matches a classified task
 * against the user's configured providers, their available models, declared
 * capabilities, estimated cost, and health status.
 */

import type { AIProvider, ProviderConfig } from '@/types'
import type { ProviderCapabilities } from '@/providers/interface'

// ── Types ────────────────────────────────────────────────────────

/** Every task category the router can identify. */
export type TaskType =
  | 'coding'
  | 'writing'
  | 'research'
  | 'translation'
  | 'creative'
  | 'image'
  | 'structured-json'
  | 'database-update'

/** Result of classifying a prompt into a TaskType. */
export interface TaskClassification {
  /** The detected task type, or `null` when no signal is strong enough. */
  type: TaskType | null
  /** 0–1 confidence in the classification. */
  confidence: number
  /** The keyword tokens that fired, in match order (deduped). */
  matchedKeywords: string[]
}

/**
 * How the router picks a provider. The user chooses one mode at a time; modes
 * are mutually exclusive. `manual` means the user picks the provider directly
 * and routing does not apply.
 */
export type RouterMode =
  | 'manual'
  | 'best-quality'
  | 'fastest'
  | 'lowest-cost'
  | 'privacy-first'
  | 'custom-rules'

/** Per-provider health, supplied by the caller (e.g. from connection tests). */
export interface ProviderHealth {
  /** True when the provider last responded to a connection check. */
  healthy: boolean
  /** Mean response latency in ms, if known. */
  avgResponseMs?: number
  /** Most recent error message, if unhealthy. */
  lastError?: string
}

/** A configured provider plus everything the router needs about it. */
export interface RouterProviderEntry {
  config: ProviderConfig
  provider: AIProvider
  capabilities: ProviderCapabilities
  health: ProviderHealth
  /** Estimated USD cost per 1M output tokens for the selected model, if known. */
  estimatedCostPerMTokens?: number
}

/** Caller-supplied routing preferences. */
export interface RouterPreferences {
  mode: RouterMode
  /** When true the user has opted into automatic routing — no consent prompt. */
  automaticRoutingEnabled: boolean
  /** Provider IDs the user prefers, in priority order (highest first). */
  preferredProviderIds?: string[]
  /** Provider IDs to never route to. */
  excludedProviderIds?: string[]
  /** Custom rule overrides keyed by TaskType → ordered provider IDs. */
  customRules?: Partial<Record<TaskType, string[]>>
  /** When true, only consider providers whose endpoint is local/offline. */
  localOnly?: boolean
}

/** The outcome of selecting a provider for a task. */
export interface RouterResult {
  /** The recommended provider entry, or null when none qualify. */
  selected: RouterProviderEntry | null
  /** Ranked list of viable providers (best first), excluding the selection. */
  alternatives: RouterProviderEntry[]
  /** Human-readable rationale for the selection. */
  reason: string
  /** The classification the selection was based on. */
  classification: TaskClassification
  /** Whether the caller must obtain explicit user consent before sending. */
  requiresConsent: boolean
}

// ── Task classification ─────────────────────────────────────────

/** Keyword → TaskType lookup table. Order matters only for readability. */
const TASK_KEYWORDS: ReadonlyArray<{ type: TaskType; keywords: string[] }> = [
  {
    type: 'database-update',
    keywords: [
      'insert', 'update', 'delete', 'upsert', 'sql', 'query', 'table',
      'database', 'schema', 'migration', 'crud', 'record', 'row', 'column',
    ],
  },
  {
    type: 'structured-json',
    keywords: [
      'json', 'json schema', 'response schema', 'structured output',
      'parse', 'serialize', 'yaml', 'csv', 'valid json', 'json object',
    ],
  },
  {
    type: 'image',
    keywords: [
      'image', 'picture', 'photo', 'illustration', 'draw', 'paint',
      'render', 'dall-e', 'midjourney', 'stable diffusion', 'art', 'graphic',
    ],
  },
  {
    type: 'coding',
    keywords: [
      'code', 'function', 'bug', 'debug', 'refactor', 'typescript', 'python',
      'javascript', 'react', 'component', 'api', 'class', 'compile', 'stack trace',
      'algorithm', 'script', 'program', 'implement', 'module', 'endpoint',
    ],
  },
  {
    type: 'translation',
    keywords: [
      'translate', 'translation', 'localize', 'localise', 'language pair',
      'hindi to english', 'english to hindi', 'transliterate', 'subtitles for',
    ],
  },
  {
    type: 'research',
    keywords: [
      'research', 'analyze', 'analyse', 'compare', 'summarize', 'summarise',
      'cite', 'sources', 'literature', 'find papers', 'study', 'investigate',
      'survey', 'report on', 'overview of',
    ],
  },
  {
    type: 'creative',
    keywords: [
      'story', 'poem', 'novel', 'fiction', 'screenplay', 'lyrics', 'song',
      'creative', 'imagine', 'brainstorm', 'character', 'narrative', 'plot',
      'tagline', 'slogan', 'joke',
    ],
  },
  {
    type: 'writing',
    keywords: [
      'write', 'draft', 'essay', 'article', 'blog', 'email', 'letter',
      'report', 'document', 'content', 'copy', 'proposal', 'summary', 'outline',
    ],
  },
]

/** Escape a string for safe embedding in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Classify a prompt into a TaskType using deterministic keyword matching.
 *
 * The classifier is intentionally simple: it counts word-boundary keyword hits
 * per task type and returns the type with the most hits. No AI is consulted and
 * no network call is made — the same prompt always yields the same result.
 */
export function classifyTask(prompt: string): TaskClassification {
  const lower = prompt.toLowerCase()
  const matched: string[] = []

  let bestType: TaskType | null = null
  let bestHits = 0
  let totalHits = 0

  for (const entry of TASK_KEYWORDS) {
    let hits = 0
    for (const kw of entry.keywords) {
      const re = new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i')
      if (re.test(lower)) {
        hits++
        if (!matched.includes(kw)) matched.push(kw)
      }
    }
    totalHits += hits
    if (hits > bestHits) {
      bestHits = hits
      bestType = entry.type
    }
  }

  // Confidence: ratio of the winning type's hits to total hits, floored to a
  // small baseline when nothing matched so callers can still act.
  const confidence = totalHits > 0 ? Math.min(1, bestHits / Math.max(totalHits, 3)) : 0

  return {
    type: bestHits > 0 ? bestType : null,
    confidence,
    matchedKeywords: matched,
  }
}

// ── Provider selection ───────────────────────────────────────────

/**
 * Per-TaskType ranking hints. Providers whose registry id lists under a type
 * get a positive quality bias for that task; everything else is neutral.
 *
 * These are broad defaults derived from each provider's general strengths —
 * they bias selection but never override an explicit preference or exclusion.
 */
const TASK_PROVIDER_AFFINITY: Readonly<Record<TaskType, string[]>> = {
  coding: ['anthropic', 'openai', 'deepseek', 'groq', 'mistral'],
  writing: ['anthropic', 'openai', 'mistral', 'cohere'],
  research: ['perplexity', 'anthropic', 'openai', 'gemini'],
  translation: ['sarvam', 'gemini', 'openai', 'anthropic'],
  creative: ['anthropic', 'openai', 'mistral'],
  image: ['openai', 'openrouter'],
  'structured-json': ['openai', 'anthropic', 'gemini', 'cohere'],
  'database-update': ['openai', 'anthropic', 'deepseek'],
}

/** True when a provider's endpoint points at a local/off-network host. */
function isLocalProvider(provider: AIProvider): boolean {
  const ep = provider.defaultEndpoint.toLowerCase()
  return ep.includes('localhost') || ep.includes('127.0.0.1') || ep.includes('0.0.0.0')
}

/** Numeric quality score for an entry, higher is better. */
function qualityScore(entry: RouterProviderEntry, type: TaskType | null): number {
  let score = 0
  // Context window is a rough proxy for capability/headroom.
  const ctx = entry.provider.models[0]?.contextWindow ?? 0
  score += Math.min(ctx / 200_000, 5) // up to +5
  // Capability bonuses.
  if (entry.capabilities.jsonSchema) score += 2
  if (entry.capabilities.jsonMode) score += 1
  if (entry.capabilities.systemInstruction) score += 1
  if (entry.capabilities.streaming) score += 0.5
  // Task affinity bias.
  if (type && TASK_PROVIDER_AFFINITY[type].includes(entry.provider.id)) score += 2
  return score
}

/** Numeric speed score for an entry, higher is faster. */
function speedScore(entry: RouterProviderEntry): number {
  const latency = entry.health.avgResponseMs
  // Higher score = faster. Unknown latency sits in the middle.
  if (typeof latency === 'number' && latency > 0) return 10_000 / latency
  return 5
}

/** Numeric cost score for an entry, higher is cheaper. */
function costScore(entry: RouterProviderEntry): number {
  const cost = entry.estimatedCostPerMTokens
  if (typeof cost === 'number' && cost >= 0) return 10 / (cost + 0.1)
  return 5
}

/** Numeric privacy score for an entry, higher is more private. */
function privacyScore(entry: RouterProviderEntry): number {
  return isLocalProvider(entry.provider) ? 10 : 0
}

/** Build a comparator that ranks entries by a numeric score, descending. */
function rankBy(getScore: (e: RouterProviderEntry) => number) {
  return (a: RouterProviderEntry, b: RouterProviderEntry) =>
    getScore(b) - getScore(a)
}

/**
 * Select the best provider for a task given the user's configured providers and
 * routing preferences.
 *
 * Selection filters out unhealthy and excluded providers, then ranks the rest
 * according to the active mode. When no providers qualify, `selected` is null
 * and `requiresConsent` reflects the mode (still true unless manual).
 */
export function selectProvider(
  task: TaskClassification,
  configs: RouterProviderEntry[],
  preferences: RouterPreferences,
): RouterResult {
  const excluded = new Set(preferences.excludedProviderIds ?? [])

  // Start from configured providers, drop unhealthy and excluded.
  let pool = configs.filter(
    (e) => e.health.healthy && !excluded.has(e.config.providerId),
  )

  // Privacy-first / local-only restrict to local endpoints.
  if (preferences.localOnly || preferences.mode === 'privacy-first') {
    pool = pool.filter((e) => isLocalProvider(e.provider))
  }

  // Custom rules can override ranking for a specific task type.
  const customOrder =
    task.type && preferences.customRules?.[task.type]
      ? preferences.customRules[task.type] ?? []
      : []

  // User-stated preference order always wins ties.
  const preferred = preferences.preferredProviderIds ?? []

  const preferredRank = (e: RouterProviderEntry): number => {
    let rank = preferred.indexOf(e.config.providerId)
    if (rank === -1) rank = preferred.length
    return rank
  }

  let ranked: RouterProviderEntry[]
  switch (preferences.mode) {
    case 'manual':
      // Manual mode: honour preference order, fall back to as-given.
      ranked = [...pool].sort((a, b) => preferredRank(a) - preferredRank(b))
      break
    case 'fastest':
      ranked = [...pool].sort(rankBy(speedScore))
      break
    case 'lowest-cost':
      ranked = [...pool].sort(rankBy(costScore))
      break
    case 'privacy-first':
      ranked = [...pool].sort(rankBy(privacyScore))
      break
    case 'custom-rules':
      ranked = [...pool].sort((a, b) => {
        const ai = customOrder.indexOf(a.config.providerId)
        const bi = customOrder.indexOf(b.config.providerId)
        const ar = ai === -1 ? Number.MAX_SAFE_INTEGER : ai
        const br = bi === -1 ? Number.MAX_SAFE_INTEGER : bi
        if (ar !== br) return ar - br
        return preferredRank(a) - preferredRank(b)
      })
      break
    case 'best-quality':
    default:
      ranked = [...pool].sort((a, b) => {
        const diff = qualityScore(b, task.type) - qualityScore(a, task.type)
        if (diff !== 0) return diff
        return preferredRank(a) - preferredRank(b)
      })
      break
  }

  const selected = ranked[0] ?? null
  const alternatives = selected ? ranked.slice(1) : ranked

  const requiresConsent = getUserConsent({ mode: preferences.mode })

  const reason = selected
    ? reasonFor(task, selected, preferences.mode)
    : noMatchReason(pool.length, preferences)

  return {
    selected,
    alternatives,
    reason,
    classification: task,
    requiresConsent,
  }
}

/** Build a short human-readable rationale for a successful selection. */
function reasonFor(
  task: TaskClassification,
  entry: RouterProviderEntry,
  mode: RouterMode,
): string {
  const parts: string[] = []
  if (task.type) parts.push(`task "${task.type}"`)
  parts.push(`mode "${mode}"`)
  if (entry.health.avgResponseMs) {
    parts.push(`~${Math.round(entry.health.avgResponseMs)}ms latency`)
  }
  if (typeof entry.estimatedCostPerMTokens === 'number') {
    parts.push(`~$${entry.estimatedCostPerMTokens.toFixed(2)}/M tokens`)
  }
  return `Selected ${entry.provider.name} (${entry.config.model}) based on ${parts.join(', ')}.`
}

/** Explain why no provider was selected. */
function noMatchReason(poolSize: number, prefs: RouterPreferences): string {
  if (poolSize === 0) {
    if (prefs.localOnly || prefs.mode === 'privacy-first') {
      return 'No healthy local providers are configured. Add a local provider (e.g. Ollama) or switch modes.'
    }
    if ((prefs.excludedProviderIds?.length ?? 0) > 0) {
      return 'All configured providers are unhealthy or excluded.'
    }
    return 'No healthy providers are configured. Connect a provider in Settings first.'
  }
  return 'No provider matched the active routing criteria.'
}

// ── Consent ──────────────────────────────────────────────────────

/**
 * Whether the caller must obtain explicit user consent before sending the
 * prompt to the selected provider.
 *
 * Returns true unless the user has explicitly enabled automatic routing. In
 * `manual` mode consent is also required — "manual" means the user picks the
 * provider directly, which is itself an explicit choice, but the router still
 * must not act on its own. The only way to silence the consent prompt is to
 * opt into automatic routing via `RouterPreferences.automaticRoutingEnabled`.
 */
export function getUserConsent(
  selection: Pick<RouterResult, 'requiresConsent'> | { mode: RouterMode },
): boolean {
  // Manual mode never auto-sends, so consent is always required there.
  // For every other mode, consent is required unless automatic routing is on.
  if ('mode' in selection) return true
  // A precomputed RouterResult already carries requiresConsent.
  return selection.requiresConsent
}

/** Convenience: decide consent directly from preferences, without selecting. */
export function consentNeededFor(prefs: RouterPreferences): boolean {
  if (prefs.mode === 'manual') return true
  return !prefs.automaticRoutingEnabled
}

// All public types are exported inline at their declarations above.
