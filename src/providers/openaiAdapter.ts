import type {
  IAIAdapter, GenerateRequest, GenerateResponse, AdapterContext,
} from './interface'
import { ProviderError, buildHeaders, resolveEndpoint, mapHttpError } from './interface'

// OpenAI-compatible adapter — works for OpenAI, OpenRouter, Groq, Mistral,
// DeepSeek, xAI, Together, Perplexity, Ollama, and generic OpenAI-compatible endpoints.
export class OpenAIAdapter implements IAIAdapter {
  async generate(req: GenerateRequest, ctx: AdapterContext): Promise<GenerateResponse> {
    const start = performance.now()
    const endpoint = resolveEndpoint(ctx)
    const headers = buildHeaders(ctx.provider, ctx.config.apiKey)

    // OpenRouter needs extra headers
    if (ctx.provider.id === 'openrouter') {
      headers['HTTP-Referer'] = window.location.origin
      headers['X-Title'] = 'Universal AI Prompt Generator'
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages: [
        ...(req.systemInstruction ? [{ role: 'system', content: req.systemInstruction }] : []),
        { role: 'user', content: req.userPrompt },
      ],
      temperature: req.temperature ?? 0.7,
      stream: false,
    }
    if (req.maxTokens) body.max_tokens = req.maxTokens

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
    // Some models (e.g. Sarvam-105B) may put text in reasoning_content when content is null
    const choice = data?.choices?.[0]?.message
    const text = choice?.content || choice?.reasoning_content || ''
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

    const body: Record<string, unknown> = {
      model: req.model,
      messages: [
        ...(req.systemInstruction ? [{ role: 'system', content: req.systemInstruction }] : []),
        { role: 'user', content: req.userPrompt },
      ],
      temperature: req.temperature ?? 0.7,
      stream: true,
    }
    if (req.maxTokens) body.max_tokens = req.maxTokens

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
