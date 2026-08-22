import type { IAIAdapter, AdapterContext } from './interface'
import type { AIProvider, ProviderConfig } from '@/types'
import { getProviderById } from './registry'
import { openaiAdapter } from './openaiAdapter'
import { geminiAdapter } from './geminiAdapter'
import { anthropicAdapter } from './anthropicAdapter'
import { cohereAdapter } from './cohereAdapter'
import { getCredential } from '@/services/credentialService'

// Map adapter type → adapter instance
const ADAPTERS: Record<string, IAIAdapter> = {
  openai: openaiAdapter,
  gemini: geminiAdapter,
  anthropic: anthropicAdapter,
  cohere: cohereAdapter,
}

export function getAdapter(providerId: string): IAIAdapter | undefined {
  const provider = getProviderById(providerId)
  if (!provider) return undefined
  return ADAPTERS[provider.adapter]
}

/** Build an adapter context, pulling the API key from the credential vault
 *  (never from the ProviderConfig which no longer stores plaintext keys). */
export async function createContext(config: ProviderConfig): Promise<AdapterContext | null> {
  const provider = getProviderById(config.providerId)
  if (!provider) return null

  // Pull the decrypted API key from the credential service
  const credential = await getCredential(config.providerId)
  const apiKey = credential?.apiKey || undefined

  return {
    config: { ...config, apiKey },
    provider,
  }
}

export async function generateWithProvider(
  config: ProviderConfig,
  req: Parameters<IAIAdapter['generate']>[0],
) {
  const adapter = getAdapter(config.providerId)
  const ctx = await createContext(config)
  if (!adapter || !ctx) throw new Error(`No adapter found for provider: ${config.providerId}`)
  return adapter.generate(req, ctx)
}

export async function streamWithProvider(
  config: ProviderConfig,
  req: Parameters<IAIAdapter['generate']>[0],
) {
  const adapter = getAdapter(config.providerId)
  const ctx = await createContext(config)
  if (!adapter || !ctx) throw new Error(`No adapter found for provider: ${config.providerId}`)
  return adapter.stream(req, ctx)
}

export async function testProviderConnection(config: ProviderConfig): Promise<boolean> {
  const adapter = getAdapter(config.providerId)
  const ctx = await createContext(config)
  if (!adapter || !ctx) return false
  return adapter.testConnection(ctx)
}

export type { AIProvider }
