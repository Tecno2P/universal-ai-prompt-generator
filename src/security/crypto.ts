import { AES_KEY_LENGTH, IV_LENGTH } from './securityTypes'

// AES-256-GCM authenticated encryption using the Web Crypto API.
// This module performs raw cryptographic operations — it does NOT
// handle key derivation or persistent storage.

const SUBTLE = typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null

function assertCryptoAvailable() {
  if (!SUBTLE) {
    throw new Error('Web Crypto API (crypto.subtle) is not available in this environment')
  }
}

/** Generate a cryptographically random IV (12 bytes for GCM). */
export function generateIV(): Uint8Array {
  const iv = new Uint8Array(IV_LENGTH)
  crypto.getRandomValues(iv)
  return iv
}

/** Import a raw 256-bit key into a Web Crypto CryptoKey for AES-GCM. */
export async function importKey(rawKey: Uint8Array): Promise<CryptoKey> {
  assertCryptoAvailable()
  if (rawKey.byteLength !== AES_KEY_LENGTH / 8) {
    throw new Error(`Invalid key length: expected ${AES_KEY_LENGTH / 8} bytes, got ${rawKey.byteLength}`)
  }
  return SUBTLE!.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** Encrypt plaintext using AES-256-GCM. Returns base64 ciphertext + base64 IV. */
export async function encrypt(
  plaintext: string,
  key: CryptoKey,
): Promise<{ ciphertext: string; iv: string }> {
  assertCryptoAvailable()
  const iv = generateIV()
  const encoded = new TextEncoder().encode(plaintext)

  const encrypted = await SUBTLE!.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  )

  return {
    ciphertext: toBase64(new Uint8Array(encrypted)),
    iv: toBase64(iv),
  }
}

/** Decrypt AES-256-GCM ciphertext. Throws if the authentication tag is invalid. */
export async function decrypt(
  ciphertextB64: string,
  ivB64: string,
  key: CryptoKey,
): Promise<string> {
  assertCryptoAvailable()
  const ciphertext = fromBase64(ciphertextB64)
  const iv = fromBase64(ivB64)

  if (iv.byteLength !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH} bytes, got ${iv.byteLength}`)
  }

  const decrypted = await SUBTLE!.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  )

  return new TextDecoder().decode(decrypted)
}

/** Generate a random device key (256-bit) for "Remember This Device" mode. */
export async function generateDeviceKey(): Promise<CryptoKey> {
  const raw = new Uint8Array(AES_KEY_LENGTH / 8)
  crypto.getRandomValues(raw)
  return importKey(raw)
}

// ── Base64 helpers ──────────────────────────────────────────────

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
