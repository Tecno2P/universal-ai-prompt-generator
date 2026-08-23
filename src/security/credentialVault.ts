import type {
  EncryptedCredentialRecord, DecryptedCredential, StorageMode, CredentialMetadata,
} from './securityTypes'
import { KDF_DEFAULTS } from './securityTypes'
import { encrypt, decrypt, generateDeviceKey, importKey } from './crypto'
import { deriveKeyFromPassword, generateSalt, buildKdfMetadata } from './keyDerivation'
import {
  setInMemory, getFromMemory, clearFromMemory, clearAllMemory, isInMemory,
} from './secureMemory'
import {
  putCredential, getCredential, getAllCredentials, deleteCredential,
  clearAllCredentials, ensureMainDB,
} from '@/database/credentialRepository'
import { validateRecord, needsMigration, upgradeRecordVersion } from './credentialMigration'

/**
 * Credential Vault — the single entry point for all credential operations.
 * UI components and services must go through this module.
 *
 * Architecture:
 *   UI → CredentialService → CredentialVault → Crypto + KeyDerivation + SecureMemory → CredentialRepository → IndexedDB
 *
 * The vault enforces:
 * - Session-only credentials are never persisted
 * - Persistent credentials are always AES-256-GCM encrypted
 * - Master password credentials use PBKDF2-derived keys
 * - Plaintext keys live only in secureMemory (RAM)
 */

// Device key — generated once per session for "Remember This Device" mode
let deviceKey: CryptoKey | null = null

async function getDeviceKey(): Promise<CryptoKey> {
  if (deviceKey) return deviceKey

  // Try loading from storage first
  const stored = await loadDeviceKey()
  if (stored) {
    deviceKey = stored
    return deviceKey
  }

  // Generate a new device key and persist it
  const raw = crypto.getRandomValues(new Uint8Array(32))
  deviceKey = await importKey(raw)
  await persistDeviceKey(raw)
  return deviceKey
}

// ── Device key persistence (separate from credential store) ─────

const DEVICE_KEY_DB = 'prompt-gen-device-key'
const DEVICE_KEY_STORE = 'device-key'

async function persistDeviceKey(raw: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DEVICE_KEY_DB, 1)
    req.onupgradeneeded = (e) => {
      const database = (e.target as IDBOpenDBRequest).result
      if (!database.objectStoreNames.contains(DEVICE_KEY_STORE)) {
        database.createObjectStore(DEVICE_KEY_STORE)
      }
    }
    req.onsuccess = () => {
      const database = req.result
      const tx = database.transaction(DEVICE_KEY_STORE, 'readwrite')
      tx.objectStore(DEVICE_KEY_STORE).put(toBase64Key(raw), 'device-key')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  })
}

async function loadDeviceKey(): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DEVICE_KEY_DB, 1)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(DEVICE_KEY_STORE)) {
        db.createObjectStore(DEVICE_KEY_STORE)
      }
    }
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DEVICE_KEY_STORE)) {
        resolve(null)
        return
      }
      const tx = db.transaction(DEVICE_KEY_STORE, 'readonly')
      const getReq = tx.objectStore(DEVICE_KEY_STORE).get('device-key')
      getReq.onsuccess = async () => {
        const rawB64 = getReq.result
        if (!rawB64) { resolve(null); return }
        const raw = fromBase64Key(rawB64)
        const key = await importKey(raw)
        resolve(key)
      }
      getReq.onerror = () => resolve(null)
    }
    req.onerror = () => resolve(null)
  })
}

function toBase64Key(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}
function fromBase64Key(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ── Public vault API ───────────────────────────────────────────

export interface StoreCredentialParams {
  provider: string
  apiKey: string
  model: string
  customEndpoint?: string
  storageMode: StorageMode
  masterPassword?: string
}

/**
 * Store a credential with the appropriate encryption.
 * - session: plaintext only in memory, never persisted
 * - encrypted_device: AES-256-GCM with device key, stored in IndexedDB
 * - master_password: AES-256-GCM with PBKDF2-derived key, stored in IndexedDB
 */
export async function storeCredential(params: StoreCredentialParams): Promise<void> {
  const { provider, apiKey, model, storageMode, masterPassword } = params
  await ensureMainDB()

  const credential: DecryptedCredential = {
    provider,
    apiKey,
    model,
    customEndpoint: params.customEndpoint,
    storageMode,
  }

  // Always set in memory so the key is immediately usable
  setInMemory(credential)

  if (storageMode === 'session') {
    // Session-only: do NOT persist
    return
  }

  if (storageMode === 'encrypted_device') {
    const key = await getDeviceKey()
    const { ciphertext, iv } = await encrypt(JSON.stringify(credential), key)
    const record: EncryptedCredentialRecord = {
      id: `provider-${provider}`,
      provider,
      storage_mode: 'encrypted_device',
      ciphertext,
      iv,
      salt: null,
      kdf: null,
      cipher: 'AES-256-GCM',
      encryption_version: KDF_DEFAULTS.encryption_version,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    await putCredential(record)
    return
  }

  if (storageMode === 'master_password') {
    if (!masterPassword) {
      throw new Error('Master password is required for master_password storage mode')
    }
    const salt = generateSalt()
    const derivedKey = await deriveKeyFromPassword(masterPassword, salt)
    const { ciphertext, iv } = await encrypt(JSON.stringify(credential), derivedKey)
    const record: EncryptedCredentialRecord = {
      id: `provider-${provider}`,
      provider,
      storage_mode: 'master_password',
      ciphertext,
      iv,
      salt: null, // salt is in kdf metadata
      kdf: buildKdfMetadata(salt),
      cipher: 'AES-256-GCM',
      encryption_version: KDF_DEFAULTS.encryption_version,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    await putCredential(record)
    return
  }
}

/**
 * Retrieve a decrypted credential.
 * - session: from memory
 * - encrypted_device: decrypt with device key (auto-unlock)
 * - master_password: must be unlocked first (see unlockWithMasterPassword)
 */
export async function retrieveCredential(provider: string): Promise<DecryptedCredential | null> {
  // Check memory first
  const cached = getFromMemory(provider)
  if (cached) return cached

  // Check persistent storage
  const record = await getCredential(`provider-${provider}`)
  if (!record || !validateRecord(record)) return null

  if (record.storage_mode === 'encrypted_device') {
    // Auto-unlock device-encrypted credentials
    let key = deviceKey
    if (!key) {
      key = await loadDeviceKey()
      if (key) deviceKey = key
    }
    if (!key) return null // device key not available

    try {
      const plaintext = await decrypt(record.ciphertext, record.iv, key)
      const credential = JSON.parse(plaintext) as DecryptedCredential
      setInMemory(credential)
      return credential
    } catch {
      return null // decryption failed — corrupted or wrong key
    }
  }

  if (record.storage_mode === 'master_password') {
    // Cannot auto-unlock — requires master password
    return null
  }

  return null
}

/**
 * Unlock a master-password-protected credential.
 * Returns true if the password is correct and the credential is now in memory.
 */
export async function unlockWithMasterPassword(
  provider: string,
  masterPassword: string,
): Promise<boolean> {
  const record = await getCredential(`provider-${provider}`)
  if (!record || !validateRecord(record)) return false
  if (record.storage_mode !== 'master_password' || !record.kdf) return false

  try {
    const saltBase64 = record.kdf.salt
    const saltBytes = Uint8Array.from(atob(saltBase64), c => c.charCodeAt(0))
    const derivedKey = await deriveKeyFromPassword(masterPassword, saltBytes, record.kdf.iterations)
    const plaintext = await decrypt(record.ciphertext, record.iv, derivedKey)
    const credential = JSON.parse(plaintext) as DecryptedCredential
    setInMemory(credential)
    return true
  } catch {
    return false // wrong password or corrupted data
  }
}

/** Check if a credential is locked (encrypted but not yet in memory). */
export async function isLocked(provider: string): Promise<boolean> {
  if (isInMemory(provider)) return false
  const record = await getCredential(`provider-${provider}`)
  if (!record) return false
  return record.storage_mode === 'master_password'
}

/** Remove a credential from memory (lock it). */
export function lockCredential(provider: string): void {
  clearFromMemory(provider)
}

/** Lock all credentials (clear memory). */
export function lockAll(): void {
  clearAllMemory()
}

/** Delete a credential permanently from IndexedDB + memory. */
export async function removeCredential(provider: string): Promise<void> {
  clearFromMemory(provider)
  await deleteCredential(`provider-${provider}`)
}

/** Delete all credentials from IndexedDB + memory. */
export async function removeAllCredentials(): Promise<void> {
  clearAllMemory()
  await clearAllCredentials()
}

/** Get metadata for all stored credentials (no plaintext keys). */
export async function listCredentialMetadata(): Promise<CredentialMetadata[]> {
  const records = await getAllCredentials()
  return records
    .filter(validateRecord)
    .map(r => ({
      id: r.id,
      provider: r.provider,
      storage_mode: r.storage_mode,
      encryption_version: r.encryption_version,
      has_master_password: r.storage_mode === 'master_password',
      created_at: r.created_at,
      updated_at: r.updated_at,
    }))
}

/** Check if any persistent credentials exist. */
export async function hasStoredCredentials(): Promise<boolean> {
  const records = await getAllCredentials()
  return records.length > 0
}

/**
 * Migrate credentials that need encryption version upgrades.
 * Only works when credentials are unlocked (plaintext available in memory).
 */
export async function migrateCredentials(): Promise<number> {
  const records = await getAllCredentials()
  let migrated = 0
  for (const record of records) {
    if (!validateRecord(record)) continue
    if (!needsMigration(record)) continue
    // Only migrate if the credential is currently unlocked in memory
    const cred = getFromMemory(record.provider)
    if (!cred) continue
    // Re-store with current encryption
    const params: StoreCredentialParams = {
      provider: cred.provider,
      apiKey: cred.apiKey,
      model: cred.model,
      customEndpoint: cred.customEndpoint,
      storageMode: record.storage_mode,
    }
    await storeCredential(params)
    migrated++
  }
  return migrated
}

/** Validate all stored records and return count of valid ones. */
export async function validateAllRecords(): Promise<{ valid: number; invalid: number }> {
  const records = await getAllCredentials()
  let valid = 0, invalid = 0
  for (const record of records) {
    if (validateRecord(record)) valid++
    else invalid++
  }
  return { valid, invalid }
}
