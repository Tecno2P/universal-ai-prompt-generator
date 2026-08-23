import type { AIProvider, ProviderConfig } from '@/types'

export interface GenerateRequest {
  model: string
  systemInstruction?: string
  userPrompt: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  /** Request structured JSON output. When true, adapters use native JSON
   * mode/schema where available, falling back to strict prompt instructions. */
  jsonMode?: boolean
}

export interface GenerateResponse {
  text: string
  tokensUsed?: number
  responseTimeMs: number
  raw?: unknown
}

export interface AdapterContext {
  config: ProviderConfig
  provider: AIProvider
}

/**
 * Provider structured-output capabilities.
 * Adapters declare what native structured-output features their provider supports.
 * The manager chooses the strongest available method.
 */
export interface ProviderCapabilities {
  streaming: boolean
  /** Provider supports a `response_format: { type: 'json_object' }` mode */
  jsonMode: boolean
  /** Provider supports JSON Schema enforcement (e.g. response_schema) */
  jsonSchema: boolean
  /** Provider supports system instructions/prompts */
  systemInstruction: boolean
}

// Common adapter interface that all providers implement
export interface IAIAdapter {
  generate(req: GenerateRequest, ctx: AdapterContext): Promise<GenerateResponse>
  stream(req: GenerateRequest, ctx: AdapterContext): AsyncGenerator<string, void, unknown>
  testConnection(ctx: AdapterContext): Promise<boolean>
  /** Return this adapter's provider capabilities for structured output. */
  getCapabilities(ctx: AdapterContext): ProviderCapabilities
}

// Error class for provider errors
export class ProviderError extends Error {
  status?: number
  code?: string
  constructor(message: string, status?: number, code?: string) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
    this.code = code
  }
}

// Helper: build headers based on auth type
export function buildHeaders(provider: AIProvider, apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (provider.authType === 'bearer' && apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  } else if (provider.authType === 'x-api-key' && apiKey) {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01' // Claude specific
  } else if (provider.authType === 'api-subscription-key' && apiKey) {
    headers['api-subscription-key'] = apiKey
  }
  return headers
}

// Helper: resolve endpoint (custom or default)
export function resolveEndpoint(ctx: AdapterContext): string {
  return ctx.config.customEndpoint || ctx.provider.defaultEndpoint
}

// Helper: map common HTTP errors to friendly messages, including the API's own error text
export function mapHttpError(status: number, body: string): ProviderError {
  // Try to extract the provider's own error message from the response body
  let apiMessage = ''
  let apiCode = ''
  try {
    const parsed = JSON.parse(body)
    apiMessage = parsed?.error?.message || parsed?.message || parsed?.detail || ''
    apiCode = parsed?.error?.code || ''
  } catch {
    // body wasn't JSON — use it raw if short enough
    if (body && body.length < 200) apiMessage = body
  }

  const messages: Record<number, string> = {
    400: 'The request was invalid. Check your parameters and try again.',
    401: 'Invalid or missing API key. Please verify your key is correct.',
    403: 'Invalid or missing API key. Please check your API key is correct and has not expired.',
    404: 'The requested model or endpoint was not found.',
    429: 'Rate limit exceeded. Please wait and try again.',
    500: 'The AI provider is experiencing issues. Try again later.',
    502: 'Bad gateway from the AI provider. Try again later.',
    503: 'The AI provider is temporarily unavailable. Try again later.',
    504: 'The request timed out. Try again or use a shorter prompt.',
  }
  const baseMsg = messages[status] || `Request failed with status ${status}`
  const suffix = apiMessage ? ` (Provider: ${apiMessage})` : ''
  return new ProviderError(baseMsg + suffix, status, apiCode)
}

/**
 * Strict JSON system instruction appended to provider requests when jsonMode is requested.
 * This is the fallback when a provider does not support native JSON mode/schema.
 */
export const STRICT_JSON_INSTRUCTION =
  'You must return exactly one valid JSON object matching the required schema. ' +
  'Do not include Markdown. ' +
  'Do not wrap the JSON in code fences. ' +
  'Do not add explanations before or after the JSON. ' +
  'Do not include comments. ' +
  'Your first character must be { and your final character must be }.'
