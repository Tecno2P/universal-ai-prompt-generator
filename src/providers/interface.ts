import type { AIProvider, ProviderConfig } from '@/types'

export interface GenerateRequest {
  model: string
  systemInstruction?: string
  userPrompt: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
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

// Common adapter interface that all providers implement
export interface IAIAdapter {
  generate(req: GenerateRequest, ctx: AdapterContext): Promise<GenerateResponse>
  stream(req: GenerateRequest, ctx: AdapterContext): AsyncGenerator<string, void, unknown>
  testConnection(ctx: AdapterContext): Promise<boolean>
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
