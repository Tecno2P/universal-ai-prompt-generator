// Type definitions for the Secure API Vault upgrade.
//
// The vault layer wraps the existing credential system with:
//   - auto-lock (timed session expiry)
//   - masked key display
//   - encrypted backup export / import
//
// These types are pure type declarations — they carry no runtime values,
// so they can be imported with `import type` everywhere.

import type { KdfMetadata } from '@/security/securityTypes'

/**
 * Selectable auto-lock durations for a {@link VaultSession}.
 *
 * - `'5min'`    — lock after 5 minutes of inactivity
 * - `'15min'`   — lock after 15 minutes of inactivity
 * - `'30min'`   — lock after 30 minutes of inactivity
 * - `'1hour'`   — lock after 1 hour of inactivity
 * - `'never'`   — never auto-lock (timer disabled; explicit `lock()` only)
 */
export type AutoLockOption = '5min' | '15min' | '30min' | '1hour' | 'never'

/**
 * High-level state of a vault session.
 *
 * - `'locked'`   — no decrypted keys in memory; master password required to use the vault
 * - `'unlocked'` — decrypted keys are held in session memory and retrievable via `getApiKey`
 */
export type VaultState = 'locked' | 'unlocked'

/**
 * Configuration applied when constructing or reconfiguring a {@link VaultSession}.
 */
export interface VaultSessionConfig {
  /** Inactivity window after which the session auto-locks. */
  autoLock: AutoLockOption
  /**
   * PBKDF2 iteration count used when deriving keys from the master password.
   * Defaults to the project standard (600 000) when omitted.
   */
  iterations?: number
}

/**
 * Discriminator for the kind of event a {@link VaultSession} emits.
 */
export type VaultEventType = 'unlock' | 'lock' | 'timeout'

/**
 * Payload carried by every vault event (a `CustomEvent<VaultEventDetail>`).
 */
export interface VaultEventDetail {
  /** Which lifecycle event fired. */
  type: VaultEventType
  /** Epoch milliseconds at which the event was emitted. */
  timestamp: number
}

/**
 * A vault event as dispatched through the underlying `EventTarget`.
 *
 * Consumers should listen via {@link VaultSession.on} rather than calling
 * `addEventListener` directly, so the detail type is resolved for them.
 */
export type VaultEvent = CustomEvent<VaultEventDetail>

/**
 * Portable, self-contained backup of every encrypted credential in the vault.
 *
 * The backup is produced by re-encrypting all stored credential records under
 * a single password (PBKDF2-derived AES-256-GCM key). The plaintext payload
 * (never stored in this object) is the JSON-serialised list of
 * `EncryptedCredentialRecord` entries. A backup can be moved between devices
 * and restored with {@link VaultSession.importEncryptedBackup} using only the
 * backup password.
 */
export interface EncryptedBackup {
  /** Structural marker so importers can sanity-check the blob. */
  format: 'secure-api-vault-backup'
  /** Backup format version — bumped only on incompatible changes. */
  version: 1
  /** Symmetric cipher used for the ciphertext. */
  cipher: 'AES-256-GCM'
  /** Key-derivation parameters used to turn the backup password into the AES key. */
  kdf: KdfMetadata
  /** Initialization vector for the AES-GCM ciphertext (base64). */
  iv: string
  /** Encrypted credential records (base64). */
  ciphertext: string
  /** ISO timestamp marking when the backup was created. */
  createdAt: string
  /** Number of credential records sealed inside the ciphertext. */
  recordCount: number
}
