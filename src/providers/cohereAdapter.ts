import type {
  IAIAdapter, GenerateRequest, GenerateResponse, AdapterContext,
} from './interface'
import { ProviderError, buildHeaders, resolveEndpoint, mapHttpError } from './interface'

// Cohere adapter — uses the chat API
export class CohereAdapter implements IAIAdapter {
  async generate(req: GenerateRequest, ctx: AdapterContext): Promise<GenerateResponse> {
    const start = performance.now()
    const endpoint = resolveEndpoint(ctx)
    const headers = buildHeaders(ctx.provider, ctx.config.apiKey)

    const body: Record<string, unknown> = {
      model: req.model,
      message: req.userPrompt,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
    }
    if (req.systemInstruction) {
      body.preamble = req.systemInstruction
    }

    const res = await fetch(`${endpoint}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errBody = await res.text()
      throw mapHttpError(res.status, errBody)
    }

    const data = await res.json()
    const text = data?.text || ''
    const tokensUsed = data?.meta?.billed_units?.total_tokens

    return {
      text,
      tokensUsed,
      responseTimeMs: Math.round(performance.now() - start),
      raw: data,
    }
  }

  async *stream(req: GenerateRequest, ctx: AdapterContext): AsyncGenerator<string, void, unknown> {
    const endpoint = resolveEndpoint(ctx)
    const headers = buildHeaders(ctx.provider, ctx.config.apiKey)

    const body: Record<string, unknown> = {
      model: req.model,
      message: req.userPrompt,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
    }
    if (req.systemInstruction) {
      body.preamble = req.systemInstruction
    }

    const res = await fetch(`${endpoint}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errBody = await res.text()
      throw mapHttpError(res.status, errBody)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new ProviderError('No response body for streaming')
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed)
          if (parsed?.text) yield parsed.text as string
        } catch {
          // skip
        }
      }
    }
  }

  async testConnection(ctx: AdapterContext): Promise<boolean> {
    try {
      const res = await this.generate({
        model: ctx.config.model,
        userPrompt: 'Say "OK" in one word.',
        maxTokens: 5,
        temperature: 0,
      }, ctx)
      return !!res.text
    } catch {
      return false
    }
  }
}

export const cohereAdapter = new CohereAdapter()
