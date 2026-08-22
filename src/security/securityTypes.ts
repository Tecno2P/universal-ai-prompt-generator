// Security type definitions for the credential vault system

export type StorageMode = 'session' | 'encrypted_device' | 'master_password'

export type EncryptionVersion = 1

export interface KdfMetadata {
  kdf: 'PBKDF2-SHA-256'
  iterations: number
  salt: string // base64
}

export interface CryptoMetadata {
  cipher: 'AES-256-GCM'
  iv: string // base64
  encryption_version: EncryptionVersion
}

export interface EncryptedCredentialRecord {
  id: string // e.g. "provider-openai"
  provider: string
  storage_mode: StorageMode
  ciphertext: string // base64
  iv: string // base64
  salt: string | null // base64 — null for device mode (no password), present for master password mode
  kdf: KdfMetadata | null // null for device mode, present for master password mode
  cipher: 'AES-256-GCM'
  encryption_version: EncryptionVersion
  created_at: string // ISO
  updated_at: string // ISO
}

export interface DecryptedCredential {
  provider: string
  apiKey: string
  model: string
  customEndpoint?: string
  storageMode: StorageMode
}

export interface CredentialMetadata {
  id: string
  provider: string
  storage_mode: StorageMode
  encryption_version: EncryptionVersion
  has_master_password: boolean
  created_at: string
  updated_at: string
}

// What the UI sees — never contains the plaintext key unless explicitly shown
export interface CredentialDisplayInfo {
  id: string
  provider: string
  providerId: string
  name: string
  model: string
  customEndpoint?: string
  storageMode: StorageMode
  encryptionStatus: 'session' | 'encrypted' | 'master_password'
  maskedKey: string | null // "sk-••••••••ABCD" or null if no key
  connected: boolean
  locked: boolean // true if encrypted and not yet unlocked
}

export const KDF_DEFAULTS = {
  iterations: 600000,
  kdf: 'PBKDF2-SHA-256' as const,
  cipher: 'AES-256-GCM' as const,
  encryption_version: 1 as EncryptionVersion,
}

export const AES_KEY_LENGTH = 256
export const IV_LENGTH = 12 // bytes — GCM standard
export const SALT_LENGTH = 16 // bytes
