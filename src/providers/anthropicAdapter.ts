import type {
  IAIAdapter, GenerateRequest, GenerateResponse, AdapterContext, ProviderCapabilities,
} from './interface'
import { ProviderError, buildHeaders, resolveEndpoint, mapHttpError, STRICT_JSON_INSTRUCTION } from './interface'

// Anthropic Claude adapter — uses the Messages API
export class AnthropicAdapter implements IAIAdapter {
  getCapabilities(_ctx: AdapterContext): ProviderCapabilities {
    return {
      streaming: true,
      // Anthropic doesn't have a native JSON mode toggle, but follows
      // system instructions well. We use strict prompt instruction fallback.
      jsonMode: false,
      jsonSchema: false,
      systemInstruction: true,
    }
  }

  async generate(req: GenerateRequest, ctx: AdapterContext): Promise<GenerateResponse> {
    const start = performance.now()
    const endpoint = resolveEndpoint(ctx)
    const headers = buildHeaders(ctx.provider, ctx.config.apiKey)
    headers['anthropic-version'] = '2023-06-01'

    let systemInstruction = req.systemInstruction
    if (req.jsonMode) {
      systemInstruction = (systemInstruction ? systemInstruction + '\n\n' : '') + STRICT_JSON_INSTRUCTION
    }

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      messages: [{ role: 'user', content: req.userPrompt }],
      temperature: req.temperature ?? 0.7,
    }
    if (systemInstruction) {
      body.system = systemInstruction
    }

    const res = await fetch(`${endpoint}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errBody = await res.text()
      throw mapHttpError(res.status, errBody)
    }

    const data = await res.json()
    const text = data?.content?.map((block: { type: string; text?: string }) =>
      block.type === 'text' ? block.text : ''
    ).join('') || ''
    const tokensUsed = data?.usage?.input_tokens ? data.usage.input_tokens + (data.usage.output_tokens || 0) : undefined

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
    headers['anthropic-version'] = '2023-06-01'
    headers['Accept'] = 'text/event-stream'

    let systemInstruction = req.systemInstruction
    if (req.jsonMode) {
      systemInstruction = (systemInstruction ? systemInstruction + '\n\n' : '') + STRICT_JSON_INSTRUCTION
    }

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      messages: [{ role: 'user', content: req.userPrompt }],
      temperature: req.temperature ?? 0.7,
      stream: true,
    }
    if (systemInstruction) {
      body.system = systemInstruction
    }

    const res = await fetch(`${endpoint}/messages`, {
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
        if (!trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        try {
          const parsed = JSON.parse(data)
          if (parsed?.type === 'content_block_delta' && parsed?.delta?.text) {
            yield parsed.delta.text as string
          }
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
        maxTokens: 10,
        temperature: 0,
      }, ctx)
      return !!res.text
    } catch {
      return false
    }
  }
}

export const anthropicAdapter = new AnthropicAdapter()
