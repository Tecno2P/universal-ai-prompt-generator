import type {
  IAIAdapter, GenerateRequest, GenerateResponse, AdapterContext, ProviderCapabilities,
} from './interface'
import { ProviderError, resolveEndpoint, mapHttpError, STRICT_JSON_INSTRUCTION } from './interface'

// Google Gemini adapter — uses the generateContent endpoint
export class GeminiAdapter implements IAIAdapter {
  getCapabilities(_ctx: AdapterContext): ProviderCapabilities {
    return {
      streaming: true,
      // Gemini supports responseMimeType: 'application/json' in generationConfig
      jsonMode: true,
      // Gemini also supports responseSchema for JSON schema enforcement
      jsonSchema: true,
      systemInstruction: true,
    }
  }

  async generate(req: GenerateRequest, ctx: AdapterContext): Promise<GenerateResponse> {
    const start = performance.now()
    const endpoint = resolveEndpoint(ctx)
    const apiKey = ctx.config.apiKey
    if (!apiKey) throw new ProviderError('API key is required for Gemini', 401)

    const contents = [{ role: 'user', parts: [{ text: req.userPrompt }] }]
    const generationConfig: Record<string, unknown> = {
      temperature: req.temperature ?? 0.7,
      maxOutputTokens: req.maxTokens ?? 4096,
    }

    // Gemini supports native JSON mode via responseMimeType
    if (req.jsonMode) {
      generationConfig.responseMimeType = 'application/json'
    }

    const body: Record<string, unknown> = { contents, generationConfig }

    let systemInstruction = req.systemInstruction
    if (req.jsonMode) {
      systemInstruction = (systemInstruction ? systemInstruction + '\n\n' : '') + STRICT_JSON_INSTRUCTION
    }
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] }
    }

    const url = `${endpoint}/models/${req.model}:generateContent`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errBody = await res.text()
      throw mapHttpError(res.status, errBody)
    }

    const data = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const tokensUsed = data?.usageMetadata?.totalTokenCount

    return {
      text,
      tokensUsed,
      responseTimeMs: Math.round(performance.now() - start),
      raw: data,
    }
  }

  async *stream(req: GenerateRequest, ctx: AdapterContext): AsyncGenerator<string, void, unknown> {
    const endpoint = resolveEndpoint(ctx)
    const apiKey = ctx.config.apiKey
    if (!apiKey) throw new ProviderError('API key is required for Gemini', 401)

    const contents = [{ role: 'user', parts: [{ text: req.userPrompt }] }]
    const generationConfig: Record<string, unknown> = {
      temperature: req.temperature ?? 0.7,
      maxOutputTokens: req.maxTokens ?? 4096,
    }

    if (req.jsonMode) {
      generationConfig.responseMimeType = 'application/json'
    }

    const body: Record<string, unknown> = { contents, generationConfig }

    let systemInstruction = req.systemInstruction
    if (req.jsonMode) {
      systemInstruction = (systemInstruction ? systemInstruction + '\n\n' : '') + STRICT_JSON_INSTRUCTION
    }
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] }
    }

    const url = `${endpoint}/models/${req.model}:streamGenerateContent?alt=sse`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
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
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text
          if (text) yield text as string
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

export const geminiAdapter = new GeminiAdapter()
