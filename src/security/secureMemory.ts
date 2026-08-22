import type { DecryptedCredential } from './securityTypes'

/**
 * In-memory credential cache. Plaintext API keys live here only for
 * the duration of the session and are never written to persistent storage.
 *
 * The cache holds decrypted keys so that repeated AI requests don't need
 * to re-decrypt on every call. Keys can be cleared at any time via `clearAll()`.
 */

interface MemoryEntry {
  credential: DecryptedCredential
  createdAt: number
}

const cache = new Map<string, MemoryEntry>()

// Auto-clear after 30 minutes of inactivity
const TTL_MS = 30 * 60 * 1000
let cleanupTimer: ReturnType<typeof setTimeout> | null = null

function scheduleCleanup() {
  if (cleanupTimer) clearTimeout(cleanupTimer)
  cleanupTimer = setTimeout(() => {
    const now = Date.now()
    for (const [key, entry] of cache) {
      if (now - entry.createdAt > TTL_MS) {
        cache.delete(key)
      }
    }
    if (cache.size > 0) scheduleCleanup()
  }, TTL_MS)
}

/** Store a decrypted credential in memory. */
export function setInMemory(credential: DecryptedCredential): void {
  cache.set(credential.provider, {
    credential,
    createdAt: Date.now(),
  })
  scheduleCleanup()
}

/** Retrieve a decrypted credential from memory. Returns undefined if not present. */
export function getFromMemory(provider: string): DecryptedCredential | undefined {
  const entry = cache.get(provider)
  if (!entry) return undefined
  // Refresh TTL on access
  entry.createdAt = Date.now()
  return entry.credential
}

/** Check if a credential is currently in memory (unlocked). */
export function isInMemory(provider: string): boolean {
  return cache.has(provider)
}

/** Remove a single credential from memory. */
export function clearFromMemory(provider: string): void {
  cache.delete(provider)
}

/** Clear all decrypted credentials from memory. Called on lock, logout, or session end. */
export function clearAllMemory(): void {
  cache.clear()
  if (cleanupTimer) {
    clearTimeout(cleanupTimer)
    cleanupTimer = null
  }
}

/** Get the list of providers currently unlocked in memory. */
export function getUnlockedProviders(): string[] {
  return Array.from(cache.keys())
}

/**
 * Mask an API key for display: show first 3 and last 4 characters.
 * "sk-abc1234567890wxyz" → "sk-••••••••••wxyz"
 * Returns null if the key is too short to mask safely.
 */
export function maskApiKey(key: string): string | null {
  if (!key || key.length < 8) return null
  const prefix = key.slice(0, 3)
  const suffix = key.slice(-4)
  const masked = '•'.repeat(Math.min(12, key.length - 7))
  return `${prefix}${masked}${suffix}`
}

/** Check whether the memory cache has any entries. */
export function hasAnyInMemory(): boolean {
  return cache.size > 0
}
