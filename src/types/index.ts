// Core type definitions for the Universal AI Prompt Generator

export type Language = 'en' | 'hi' | 'hinglish' | 'es' | 'fr' | 'de' | 'pt' | 'it' | 'nl' | 'ru' | 'ar' | 'tr' | 'id' | 'ja' | 'ko' | 'zh'

export type PromptStyle =
  | 'simple' | 'professional' | 'expert' | 'detailed' | 'technical'
  | 'creative' | 'structured' | 'json' | 'developer' | 'agent' | 'system' | 'reasoning'

export type PromptSectionKey =
  | 'role' | 'context' | 'objective' | 'requirements' | 'constraints'
  | 'inputs' | 'steps' | 'expectedOutput' | 'outputFormat' | 'qualityCriteria'
  | 'examples' | 'edgeCases' | 'additionalInstructions'

export type OperationMode = 'offline' | 'ai' | 'hybrid' | 'auto'

export interface Category {
  id: string
  name: string
  parent?: string
  icon?: string
}

export interface PromptTemplate {
  id: string
  category: string
  language: Language
  title: string
  content: string
  tags: string[]
  style: PromptStyle
  keywords?: string[]
  createdAt: number
  updatedAt: number
  source: 'builtin' | 'user' | 'ai'
  version: number
}

export interface SavedPrompt {
  id: string
  title: string
  content: string
  category?: string
  language: Language
  style: PromptStyle
  tags: string[]
  favorite: boolean
  createdAt: number
  updatedAt: number
  versions?: { content: string; createdAt: number }[]
}

export interface HinglishPattern {
  id: string
  pattern: string
  intent: string
  category: string
  translation: string
}

export interface ProviderConfig {
  id: string
  providerId: string
  name: string
  apiKey?: string
  model: string
  customEndpoint?: string
  connected: boolean
  createdAt: number
}

export interface GenerateParams {
  input: string
  category?: string
  style: PromptStyle
  outputLanguage: Language
  sections: Record<PromptSectionKey, boolean>
  temperature?: number
  maxTokens?: number
  systemInstruction?: string
}

export interface GenerateResult {
  prompt: string
  detectedLanguage: Language
  detectedCategory: string
  detectedIntent: string
  source: 'offline' | 'ai'
  templateId?: string
  tokensUsed?: number
  responseTimeMs?: number
}

export interface UpdatePackage {
  schema_version: 1
  database_version: string
  changes: UpdateChange[]
  generatedAt: number
  source: string
}

export type UpdateOperation = 'add' | 'update' | 'delete'

export interface UpdateChange {
  operation: UpdateOperation
  type: 'template' | 'hinglish_pattern' | 'category' | 'language' | 'tag'
  id: string
  category?: string
  language?: Language
  title?: string
  content?: string
  tags?: string[]
  [key: string]: unknown
}

export interface DatabaseVersion {
  version: string
  installedAt: number
  changeCount: number
  source: string
}

export interface AIProviderModel {
  id: string
  name: string
  contextWindow?: number
}

export interface AIProvider {
  id: string
  name: string
  adapter: string
  defaultEndpoint: string
  authType: 'bearer' | 'x-api-key' | 'none'
  models: AIProviderModel[]
  supportsStream: boolean
  supportsCustomEndpoint: boolean
  docsUrl?: string
}
