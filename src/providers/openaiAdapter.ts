import type {
  IAIAdapter, GenerateRequest, GenerateResponse, AdapterContext, ProviderCapabilities,
} from './interface'
import { ProviderError, buildHeaders, resolveEndpoint, mapHttpError, STRICT_JSON_INSTRUCTION } from './interface'

// OpenAI-compatible adapter — works for OpenAI, OpenRouter, Groq, Mistral,
// DeepSeek, xAI, Together, Perplexity, Ollama, and generic OpenAI-compatible endpoints.
export class OpenAIAdapter implements IAIAdapter {
  getCapabilities(_ctx: AdapterContext): ProviderCapabilities {
    return {
      streaming: true,
      // OpenAI-compatible APIs support response_format: { type: 'json_object' }
      // Most providers in this family (OpenAI, Groq, Together, etc.) support it.
      jsonMode: true,
      // JSON Schema (response_format: { type: 'json_schema', json_schema: {...} })
      // is OpenAI-specific and not universally supported by all OpenAI-compatible providers.
      jsonSchema: false,
      systemInstruction: true,
    }
  }

  async generate(req: GenerateRequest, ctx: AdapterContext): Promise<GenerateResponse> {
    const start = performance.now()
    const endpoint = resolveEndpoint(ctx)
    const headers = buildHeaders(ctx.provider, ctx.config.apiKey)

    // OpenRouter needs extra headers
    if (ctx.provider.id === 'openrouter') {
      headers['HTTP-Referer'] = window.location.origin
      headers['X-Title'] = 'Universal AI Prompt Generator'
    }

    // Build system instruction: append strict JSON instruction if jsonMode requested
    let systemInstruction = req.systemInstruction
    if (req.jsonMode) {
      systemInstruction = (systemInstruction ? systemInstruction + '\n\n' : '') + STRICT_JSON_INSTRUCTION
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages: [
        ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
        { role: 'user', content: req.userPrompt },
      ],
      temperature: req.temperature ?? 0.7,
      stream: false,
    }
    if (req.maxTokens) body.max_tokens = req.maxTokens

    // Use native JSON mode if supported and requested
    if (req.jsonMode) {
      body.response_format = { type: 'json_object' }
    }

    const res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errBody = await res.text()
      throw mapHttpError(res.status, errBody)
    }

    const data = await res.json()
    // Use content only — reasoning_content is the model's internal thinking, NOT the answer
    const choice = data?.choices?.[0]?.message
    const text = choice?.content || ''
    const tokensUsed = data?.usage?.total_tokens

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
    headers['Accept'] = 'text/event-stream'

    if (ctx.provider.id === 'openrouter') {
      headers['HTTP-Referer'] = window.location.origin
      headers['X-Title'] = 'Universal AI Prompt Generator'
    }

    let systemInstruction = req.systemInstruction
    if (req.jsonMode) {
      systemInstruction = (systemInstruction ? systemInstruction + '\n\n' : '') + STRICT_JSON_INSTRUCTION
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages: [
        ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
        { role: 'user', content: req.userPrompt },
      ],
      temperature: req.temperature ?? 0.7,
      stream: true,
    }
    if (req.maxTokens) body.max_tokens = req.maxTokens

    if (req.jsonMode) {
      body.response_format = { type: 'json_object' }
    }

    const res = await fetch(`${endpoint}/chat/completions`, {
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
        if (data === '[DONE]') return
        try {
          const parsed = JSON.parse(data)
          const delta = parsed?.choices?.[0]?.delta?.content
          if (delta) yield delta as string
        } catch {
          // skip malformed chunks
        }
      }
    }
  }

  async testConnection(ctx: AdapterContext): Promise<boolean> {
    try {
      const res = await this.generate({
        model: ctx.config.model,
        userPrompt: 'Say OK',
        maxTokens: 100,
        temperature: 0,
      }, ctx)
      return !!res.text
    } catch {
      return false
    }
  }
}

// Singleton
export const openaiAdapter = new OpenAIAdapter()
