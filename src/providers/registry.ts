import type { AIProvider } from '@/types'

// Registry of all supported AI providers with their metadata
export const PROVIDER_REGISTRY: AIProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    adapter: 'openai',
    defaultEndpoint: 'https://api.openai.com/v1',
    authType: 'bearer',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 128000 },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000 },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', contextWindow: 16385 },
    ],
    supportsStream: true,
    supportsCustomEndpoint: false,
    docsUrl: 'https://platform.openai.com/docs/api-reference',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    adapter: 'gemini',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    authType: 'none', // uses query param
    models: [
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', contextWindow: 2000000 },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', contextWindow: 1000000 },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextWindow: 1000000 },
    ],
    supportsStream: true,
    supportsCustomEndpoint: false,
    docsUrl: 'https://ai.google.dev/docs/api-reference',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    adapter: 'anthropic',
    defaultEndpoint: 'https://api.anthropic.com/v1',
    authType: 'x-api-key',
    models: [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', contextWindow: 200000 },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', contextWindow: 200000 },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', contextWindow: 200000 },
    ],
    supportsStream: true,
    supportsCustomEndpoint: false,
    docsUrl: 'https://docs.anthropic.com/en/api/reference',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    adapter: 'openai', // OpenAI-compatible
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    authType: 'bearer',
    models: [
      { id: 'openai/gpt-4o', name: 'GPT-4o (via OpenRouter)' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (via OpenRouter)' },
      { id: 'google/gemini-flash-1.5', name: 'Gemini Flash (via OpenRouter)' },
      { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B (via OpenRouter)' },
    ],
    supportsStream: true,
    supportsCustomEndpoint: false,
    docsUrl: 'https://openrouter.ai/docs',
  },
  {
    id: 'groq',
    name: 'Groq',
    adapter: 'openai', // OpenAI-compatible
    defaultEndpoint: 'https://api.groq.com/openai/v1',
    authType: 'bearer',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', contextWindow: 128000 },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', contextWindow: 128000 },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', contextWindow: 32768 },
    ],
    supportsStream: true,
    supportsCustomEndpoint: false,
    docsUrl: 'https://console.groq.com/docs',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    adapter: 'openai', // OpenAI-compatible
    defaultEndpoint: 'https://api.mistral.ai/v1',
    authType: 'bearer',
    models: [
      { id: 'mistral-large-latest', name: 'Mistral Large', contextWindow: 128000 },
      { id: 'mistral-small-latest', name: 'Mistral Small', contextWindow: 32000 },
      { id: 'open-mixtral-8x7b', name: 'Mixtral 8x7B', contextWindow: 32000 },
    ],
    supportsStream: true,
    supportsCustomEndpoint: false,
    docsUrl: 'https://docs.mistral.ai/api/',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    adapter: 'openai', // OpenAI-compatible
    defaultEndpoint: 'https://api.deepseek.com/v1',
    authType: 'bearer',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', contextWindow: 64000 },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', contextWindow: 64000 },
    ],
    supportsStream: true,
    supportsCustomEndpoint: false,
    docsUrl: 'https://platform.deepseek.com/api-docs',
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    adapter: 'openai', // OpenAI-compatible
    defaultEndpoint: 'https://api.x.ai/v1',
    authType: 'bearer',
    models: [
      { id: 'grok-beta', name: 'Grok Beta', contextWindow: 131072 },
      { id: 'grok-vision-beta', name: 'Grok Vision Beta', contextWindow: 8192 },
    ],
    supportsStream: true,
    supportsCustomEndpoint: false,
    docsUrl: 'https://docs.x.ai/docs',
  },
  {
    id: 'cohere',
    name: 'Cohere',
    adapter: 'cohere',
    defaultEndpoint: 'https://api.cohere.com/v1',
    authType: 'bearer',
    models: [
      { id: 'command-r-plus', name: 'Command R+', contextWindow: 128000 },
      { id: 'command-r', name: 'Command R', contextWindow: 128000 },
      { id: 'command', name: 'Command', contextWindow: 4000 },
    ],
    supportsStream: true,
    supportsCustomEndpoint: false,
    docsUrl: 'https://docs.cohere.com/reference/about',
  },
  {
    id: 'together',
    name: 'Together AI',
    adapter: 'openai', // OpenAI-compatible
    defaultEndpoint: 'https://api.together.xyz/v1',
    authType: 'bearer',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo' },
      { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', name: 'Llama 3.1 8B Turbo' },
      { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', name: 'Qwen 2.5 72B Turbo' },
    ],
    supportsStream: true,
    supportsCustomEndpoint: false,
    docsUrl: 'https://docs.together.ai/reference',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    adapter: 'openai', // OpenAI-compatible
    defaultEndpoint: 'https://api.perplexity.ai',
    authType: 'bearer',
    models: [
      { id: 'llama-3.1-sonar-large-128k-online', name: 'Sonar Large (Online)', contextWindow: 127072 },
      { id: 'llama-3.1-sonar-small-128k-online', name: 'Sonar Small (Online)', contextWindow: 127072 },
    ],
    supportsStream: true,
    supportsCustomEndpoint: false,
    docsUrl: 'https://docs.perplexity.ai',
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    adapter: 'openai', // OpenAI-compatible
    defaultEndpoint: 'http://localhost:11434/v1',
    authType: 'none',
    models: [
      { id: 'llama3.2', name: 'Llama 3.2' },
      { id: 'qwen2.5', name: 'Qwen 2.5' },
      { id: 'mistral', name: 'Mistral' },
      { id: 'phi3', name: 'Phi 3' },
    ],
    supportsStream: true,
    supportsCustomEndpoint: true,
    docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
  },
  {
    id: 'generic',
    name: 'Generic OpenAI-compatible',
    adapter: 'openai',
    defaultEndpoint: '',
    authType: 'bearer',
    models: [
      { id: 'custom-model', name: 'Custom Model' },
    ],
    supportsStream: true,
    supportsCustomEndpoint: true,
    docsUrl: '',
  },
]

export function getProviderById(id: string): AIProvider | undefined {
  return PROVIDER_REGISTRY.find(p => p.id === id)
}

export function getProviderByName(name: string): AIProvider | undefined {
  return PROVIDER_REGISTRY.find(p => p.name.toLowerCase() === name.toLowerCase())
}
