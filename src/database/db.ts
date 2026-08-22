import type {
  PromptTemplate, SavedPrompt, HinglishPattern, Category,
  ProviderConfig, DatabaseVersion,
} from '@/types'

const DB_NAME = 'prompt-generator-db'
const DB_VERSION = 1

export const STORES = {
  templates: 'templates',
  savedPrompts: 'savedPrompts',
  hinglishPatterns: 'hinglishPatterns',
  categories: 'categories',
  providers: 'providers',
  versions: 'versions',
  settings: 'settings',
  history: 'history',
} as const

export type StoreName = keyof typeof STORES

let dbInstance: IDBDatabase | null = null

export function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance)
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      dbInstance = req.result
      resolve(dbInstance)
    }
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORES.templates)) {
        const s = db.createObjectStore(STORES.templates, { keyPath: 'id' })
        s.createIndex('category', 'category', { unique: false })
        s.createIndex('language', 'language', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORES.savedPrompts)) {
        const s = db.createObjectStore(STORES.savedPrompts, { keyPath: 'id' })
        s.createIndex('favorite', 'favorite', { unique: false })
        s.createIndex('createdAt', 'createdAt', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORES.hinglishPatterns)) {
        db.createObjectStore(STORES.hinglishPatterns, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORES.categories)) {
        db.createObjectStore(STORES.categories, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORES.providers)) {
        db.createObjectStore(STORES.providers, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORES.versions)) {
        db.createObjectStore(STORES.versions, { keyPath: 'version' })
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(STORES.history)) {
        const s = db.createObjectStore(STORES.history, { keyPath: 'id' })
        s.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
  })
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
  }))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function put<T extends Record<string, any>>(store: string, value: T): Promise<T> {
  await tx(store, 'readwrite', s => s.put(value))
  return value
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function bulkPut<T extends Record<string, any>>(store: string, values: T[]): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite')
    const s = t.objectStore(store)
    values.forEach(v => s.put(v))
    t.onerror = () => reject(t.error)
    t.oncomplete = () => resolve()
  })
}

export async function get<T>(store: string, id: string): Promise<T | undefined> {
  return tx(store, 'readonly', s => s.get(id)) as Promise<T | undefined>
}

export async function getAll<T>(store: string): Promise<T[]> {
  return tx(store, 'readonly', s => s.getAll()) as Promise<T[]>
}

export async function del(store: string, id: string): Promise<void> {
  await tx(store, 'readwrite', s => s.delete(id))
}

export async function clearStore(store: string): Promise<void> {
  await tx(store, 'readwrite', s => s.clear())
}

export async function count(store: string): Promise<number> {
  return tx(store, 'readonly', s => s.count()) as Promise<number>
}

// Convenience typed wrappers
export const db = {
  // Templates
  getTemplate: (id: string) => get<PromptTemplate>(STORES.templates, id),
  getAllTemplates: () => getAll<PromptTemplate>(STORES.templates),
  putTemplate: (t: PromptTemplate) => put(STORES.templates, t),
  bulkPutTemplates: (ts: PromptTemplate[]) => bulkPut(STORES.templates, ts),
  deleteTemplate: (id: string) => del(STORES.templates, id),
  // Saved prompts
  getSavedPrompt: (id: string) => get<SavedPrompt>(STORES.savedPrompts, id),
  getAllSavedPrompts: () => getAll<SavedPrompt>(STORES.savedPrompts),
  putSavedPrompt: (p: SavedPrompt) => put(STORES.savedPrompts, p),
  deleteSavedPrompt: (id: string) => del(STORES.savedPrompts, id),
  // Hinglish
  getAllHinglishPatterns: () => getAll<HinglishPattern>(STORES.hinglishPatterns),
  bulkPutHinglishPatterns: (ps: HinglishPattern[]) => bulkPut(STORES.hinglishPatterns, ps),
  // Categories
  getAllCategories: () => getAll<Category>(STORES.categories),
  bulkPutCategories: (cs: Category[]) => bulkPut(STORES.categories, cs),
  // Providers
  getAllProviders: () => getAll<ProviderConfig>(STORES.providers),
  putProvider: (p: ProviderConfig) => put(STORES.providers, p),
  deleteProvider: (id: string) => del(STORES.providers, id),
  // Versions
  getAllVersions: () => getAll<DatabaseVersion>(STORES.versions),
  putVersion: (v: DatabaseVersion) => put(STORES.versions, v),
  // Settings
  getSetting: (key: string) => get<{ key: string; value: unknown }>(STORES.settings, key),
  putSetting: (key: string, value: unknown) => put(STORES.settings, { key, value }),
  // History
  getAllHistory: () => getAll<GenerateHistoryEntry>(STORES.history),
  putHistory: (h: GenerateHistoryEntry) => put(STORES.history, h),
  clearAll: async () => {
    for (const s of Object.values(STORES)) await clearStore(s)
  },
  counts: async () => {
    const [templates, savedPrompts, hinglish, categories, providers] = await Promise.all([
      count(STORES.templates), count(STORES.savedPrompts), count(STORES.hinglishPatterns),
      count(STORES.categories), count(STORES.providers),
    ])
    return { templates, savedPrompts, hinglish, categories, providers }
  },
}

export interface GenerateHistoryEntry {
  id: string
  input: string
  output: string
  category?: string
  language: string
  style: string
  source: 'offline' | 'ai'
  createdAt: number
}
