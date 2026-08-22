import { KDF_DEFAULTS, type KdfMetadata } from './securityTypes'
import { fromBase64, toBase64 } from './crypto'

const SUBTLE = typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null

/** Generate a cryptographically random salt (16 bytes by default). */
export function generateSalt(length = 16): Uint8Array {
  const salt = new Uint8Array(length)
  crypto.getRandomValues(salt)
  return salt
}

/**
 * Derive an AES-256-GCM key from a master password using PBKDF2-SHA-256.
 * The derived key is non-extractable (cannot be exported back to raw bytes).
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
  iterations = KDF_DEFAULTS.iterations,
): Promise<CryptoKey> {
  if (!SUBTLE) {
    throw new Error('Web Crypto API (crypto.subtle) is not available in this environment')
  }

  // Import the password as a raw key material
  const passwordKey = await SUBTLE.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  )

  // Derive a 256-bit AES-GCM key
  return SUBTLE.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable — the derived key cannot be read back
    ['encrypt', 'decrypt'],
  )
}

/** Build the KDF metadata record for a newly derived key. */
export function buildKdfMetadata(
  salt: Uint8Array,
  iterations = KDF_DEFAULTS.iterations,
): KdfMetadata {
  return {
    kdf: 'PBKDF2-SHA-256',
    iterations,
    salt: toBase64(salt),
  }
}

/** Reconstruct salt from stored KDF metadata. */
export function extractSalt(kdf: KdfMetadata): Uint8Array {
  return fromBase64(kdf.salt)
}

/**
 * Verify a master password against an existing credential record.
 * Does NOT decrypt — just checks whether the password can derive
 * the same key by attempting a decrypt of the ciphertext.
 * Returns true if the password is correct.
 */
export async function verifyPassword(
  password: string,
  kdf: KdfMetadata,
  ciphertext: string,
  iv: string,
): Promise<boolean> {
  try {
    const salt = extractSalt(kdf)
    const key = await deriveKeyFromPassword(password, salt, kdf.iterations)
    const { decrypt } = await import('./crypto')
    await decrypt(ciphertext, iv, key)
    return true
  } catch {
    return false
  }
}

/**
 * Check whether the current KDF parameters need migration to a newer version.
 * In the future, this could check for increased iteration counts, algorithm changes, etc.
 */
export function needsKdfMigration(kdf: KdfMetadata): boolean {
  if (kdf.kdf !== KDF_DEFAULTS.kdf) return true
  if (kdf.iterations < KDF_DEFAULTS.iterations) return true
  return false
}
