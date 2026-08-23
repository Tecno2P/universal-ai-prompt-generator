/**
 * Prompt Test Lab — compare the same prompt across selected providers.
 *
 * The Test Lab sends a single prompt to every provider/model the user has
 * explicitly selected and collects the responses for side-by-side comparison.
 *
 * Privacy is paramount: this module NEVER automatically sends a prompt to
 * multiple providers. The caller must supply a `TestLabConfig` whose
 * `selectedProviderIds` were chosen by the user and whose
 * `privacyAcknowledged` flag is true. `runTestLab` throws before any network
 * call if either condition is unmet.
 */

import type { ProviderConfig, AIProvider } from '@/types'
import type { GenerateRequest, GenerateResponse } from '@/providers/interface'
import type { PromptQualityReport } from '@/engine/quality/types'
import { generateWithProvider } from '@/providers/manager'
import { getProviderById } from '@/providers/registry'
import { analyzePrompt } from '@/engine/quality/score'

// ── Types ────────────────────────────────────────────────────────

/** Configuration for a Test Lab run. */
export interface TestLabConfig {
  /** Provider config IDs the user explicitly selected to test against. */
  selectedProviderIds: string[]
  /**
   * The user must acknowledge that the prompt will be sent to each selected
   * provider. When false, `runTestLab` refuses to run.
   */
  privacyAcknowledged: boolean
  /** Optional per-provider model override (providerConfigId → model id). */
  modelOverrides?: Record<string, string>
  /** Optional generation parameters forwarded to each provider. */
  generation?: {
    temperature?: number
    maxTokens?: number
    systemInstruction?: string
    jsonMode?: boolean
  }
}

/** The result of testing one provider/model against the prompt. */
export interface TestLabResult {
  /** The provider config id that was tested. */
  providerConfigId: string
  /** Display name of the provider (e.g. "OpenAI"). */
  providerName: string
  /** The model id that was used. */
  model: string
  /** The response text, or empty string on error. */
  responseText: string
  /** Wall-clock response time in milliseconds. */
  responseTimeMs: number
  /** Token usage reported by the provider, if any. */
  tokensUsed?: number
  /** Error message if the call failed, otherwise undefined. */
  error?: string
  /**
   * Placeholder for a user-supplied rating (1–5). Null until the user rates
   * the response in the UI; the Test Lab never auto-assigns ratings.
   */
  userRating: number | null
  /** Heuristic quality estimate of the response text (0–100). */
  qualityEstimate: PromptQualityReport | null
}

/** A resolved provider config plus its registry metadata, ready to test. */
export interface TestLabTarget {
  config: ProviderConfig
  provider: AIProvider
  model: string
}

// ── Privacy guard ────────────────────────────────────────────────

/**
 * Privacy warning surfaced to the user before any test runs.
 *
 * The UI should display this verbatim and require an explicit acknowledgment
 * before calling `runTestLab`.
 */
export const PRIVACY_WARNING =
  'This test sends your prompt to each selected AI provider. ' +
  'Only select providers you are comfortable sharing this prompt with.'

/**
 * Validate that a Test Lab config is safe to execute.
 *
 * Returns an error message string when the run must be blocked, or null when
 * the config is acceptable. This is the single gate that prevents accidental
 * multi-provider sends.
 */
export function validateTestLabConfig(
  prompt: string,
  configs: ProviderConfig[],
  options: TestLabConfig,
): string | null {
  if (!options.privacyAcknowledged) {
    return 'Privacy acknowledgment is required. ' + PRIVACY_WARNING
  }
  if (!options.selectedProviderIds || options.selectedProviderIds.length === 0) {
    return 'No providers selected. Choose at least one provider to test.'
  }
  if (!prompt || prompt.trim().length === 0) {
    return 'Prompt is empty. Nothing to test.'
  }
  // Confirm every selected id actually corresponds to a configured provider.
  const available = new Set(configs.map((c) => c.id))
  const missing = options.selectedProviderIds.filter((id) => !available.has(id))
  if (missing.length > 0) {
    return `Unknown provider config id(s): ${missing.join(', ')}.`
  }
  return null
}

/** Static guard: whether this module would ever auto-send. It never does. */
export const SUPPORTS_AUTOMATIC_MULTI_SEND = false as const

// ── Target resolution ────────────────────────────────────────────

/**
 * Resolve the selected provider configs into concrete test targets, applying
 * any per-provider model overrides.
 */
export function resolveTargets(
  configs: ProviderConfig[],
  options: TestLabConfig,
): TestLabTarget[] {
  const selected = new Set(options.selectedProviderIds)
  const targets: TestLabTarget[] = []

  for (const config of configs) {
    if (!selected.has(config.id)) continue
    const provider = getProviderById(config.providerId)
    if (!provider) continue
    const model = options.modelOverrides?.[config.id] ?? config.model
    targets.push({ config, provider, model })
  }

  return targets
}

// ── Single-provider execution ────────────────────────────────────

/** Run the prompt against one target and collect a normalized result. */
async function runOneTarget(
  prompt: string,
  target: TestLabTarget,
  options: TestLabConfig,
): Promise<TestLabResult> {
  const req: GenerateRequest = {
    model: target.model,
    userPrompt: prompt,
    temperature: options.generation?.temperature,
    maxTokens: options.generation?.maxTokens,
    systemInstruction: options.generation?.systemInstruction,
    jsonMode: options.generation?.jsonMode,
  }

  const start = performance.now()
  try {
    const res: GenerateResponse = await generateWithProvider(target.config, req)
    const elapsed = Math.round(performance.now() - start)

    // Heuristic quality estimate of the *response* (not the prompt). The same
    // deterministic analyzer is reused — it just scores whatever text it gets.
    const quality = res.text.trim().length > 0 ? analyzePrompt(res.text) : null

    return {
      providerConfigId: target.config.id,
      providerName: target.provider.name,
      model: target.model,
      responseText: res.text,
      responseTimeMs: elapsed,
      tokensUsed: res.tokensUsed,
      userRating: null,
      qualityEstimate: quality,
    }
  } catch (err) {
    const elapsed = Math.round(performance.now() - start)
    const message = err instanceof Error ? err.message : String(err)
    return {
      providerConfigId: target.config.id,
      providerName: target.provider.name,
      model: target.model,
      responseText: '',
      responseTimeMs: elapsed,
      error: message,
      userRating: null,
      qualityEstimate: null,
    }
  }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Run the Test Lab: send the same prompt to every selected provider/model and
 * return a comparison-ready result per target.
 *
 * This function will ALWAYS refuse to run unless the user has explicitly
 * selected providers and acknowledged the privacy warning. It never sends to
 * providers the user did not select, and it never auto-expands the selection.
 *
 * Requests run concurrently for speed; each result is independent, so one
 * provider failing does not affect the others.
 */
export async function runTestLab(
  prompt: string,
  configs: ProviderConfig[],
  options: TestLabConfig,
): Promise<TestLabResult[]> {
  const validationError = validateTestLabConfig(prompt, configs, options)
  if (validationError) {
    throw new Error(validationError)
  }

  const targets = resolveTargets(configs, options)
  if (targets.length === 0) {
    throw new Error('No resolvable provider targets for the selected ids.')
  }

  // Run all selected providers concurrently. Each target is isolated; a failure
  // in one produces an error result rather than aborting the batch.
  const results = await Promise.all(
    targets.map((target) => runOneTarget(prompt, target, options)),
  )

  return results
}

// All public types are exported inline at their declarations above.
