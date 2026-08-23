import type { EncryptedCredentialRecord } from '@/security/securityTypes'
import { openDB } from '@/database/db'

const CRED_DB_NAME = 'prompt-gen-credentials'
const CRED_DB_VERSION = 1
const STORE_NAME = 'credentials'

let credDbInstance: IDBDatabase | null = null

/** Open a SEPARATE IndexedDB database for credentials.
 * This keeps encrypted API keys isolated from the main prompt database,
 * so that exporting the main database never accidentally includes credentials. */
export function openCredentialDB(): Promise<IDBDatabase> {
  if (credDbInstance) return Promise.resolve(credDbInstance)
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'))
      return
    }
    const req = indexedDB.open(CRED_DB_NAME, CRED_DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      credDbInstance = req.result
      resolve(credDbInstance)
    }
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('provider', 'provider', { unique: false })
        store.createIndex('storage_mode', 'storage_mode', { unique: false })
      }
    }
  })
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openCredentialDB().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE_NAME, mode)
    const req = fn(t.objectStore(STORE_NAME))
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
  }))
}

export async function putCredential(record: EncryptedCredentialRecord): Promise<void> {
  await tx('readwrite', s => s.put(record))
}

export async function getCredential(id: string): Promise<EncryptedCredentialRecord | undefined> {
  return tx('readonly', s => s.get(id)) as Promise<EncryptedCredentialRecord | undefined>
}

export async function getAllCredentials(): Promise<EncryptedCredentialRecord[]> {
  return tx('readonly', s => s.getAll()) as Promise<EncryptedCredentialRecord[]>
}

export async function deleteCredential(id: string): Promise<void> {
  await tx('readwrite', s => s.delete(id))
}

export async function clearAllCredentials(): Promise<void> {
  await tx('readwrite', s => s.clear())
}

export async function getCredentialCount(): Promise<number> {
  return tx('readonly', s => s.count()) as Promise<number>
}

/** Ensure the main DB is also opened so it can be used alongside credentials.
 * The `openDB` import is a no-op if already opened. */
export async function ensureMainDB(): Promise<void> {
  await openDB()
}
