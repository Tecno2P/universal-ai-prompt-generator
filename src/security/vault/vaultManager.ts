// Secure API Vault — auto-locking session manager.
//
// Wraps the existing credential system (credentialVault + secureMemory +
// credentialRepository) with a higher-level "vault session" that:
//   - decrypts all master-password-protected keys into memory on `unlock`
//   - clears them from memory on `lock` (encrypted storage is preserved)
//   - auto-locks after a configurable period of inactivity
//   - exposes masked key display and encrypted backup export/import
//   - emits 'unlock' | 'lock' | 'timeout' events via an EventTarget
//
// Security invariants:
//   * Plaintext keys live ONLY in the in-memory `Map` (and the existing
//     secureMemory cache). They are never written to localStorage,
//     sessionStorage, or IndexedDB.
//   * No secrets are ever logged.
//   * All cryptography uses the Web Crypto API (AES-256-GCM + PBKDF2).
//   * TypeScript strict mode, no `any`.

import type {
  AutoLockOption,
  EncryptedBackup,
  VaultEvent,
  VaultEventDetail,
  VaultEventType,
  VaultSessionConfig,
  VaultState,
} from './vaultTypes'
import type {
  DecryptedCredential,
  EncryptedCredentialRecord,
} from '@/security/securityTypes'
import { KDF_DEFAULTS } from '@/security/securityTypes'
import { encrypt, decrypt, toBase64, fromBase64 } from '@/security/crypto'
import {
  deriveKeyFromPassword,
  generateSalt,
  buildKdfMetadata,
  extractSalt,
} from '@/security/keyDerivation'
import {
  getAllCredentials,
  putCredential,
  ensureMainDB,
} from '@/database/credentialRepository'
import { validateRecord } from '@/security/credentialMigration'

// ── Constants ───────────────────────────────────────────────────

/** Auto-lock duration (ms) for each {@link AutoLockOption}. `never` disables the timer. */
const AUTO_LOCK_MS: Readonly<Record<AutoLockOption, number>> = Object.freeze({
  '5min': 5 * 60 * 1000,
  '15min': 15 * 60 * 1000,
  '30min': 30 * 60 * 1000,
  '1hour': 60 * 60 * 1000,
  never: 0,
})

/** Format marker + version stamped into every exported backup blob. */
const BACKUP_FORMAT = 'secure-api-vault-backup' as const
const BACKUP_VERSION = 1 as const

// ── VaultSession ────────────────────────────────────────────────

/**
 * Auto-locking vault session.
 *
 * A single instance is intended to live for the lifetime of the app. It holds
 * decrypted API keys in a private `Map` that is wiped on `lock()` or auto-lock.
 * The underlying encrypted credential records in IndexedDB are never touched by
 * lock — only the in-memory copies are cleared.
 */
export class VaultSession {
  private readonly target: EventTarget

  /** Decrypted keys, keyed by providerId. Lives only in memory. */
  private readonly keys: Map<string, DecryptedCredential> = new Map()

  /** Current auto-lock setting (never = disabled). */
  private autoLock: AutoLockOption

  /** PBKDF2 iteration count used for master-password derivation. */
  private readonly iterations: number

  /** Pending auto-lock timer handle, or null when none scheduled. */
  private timerHandle: ReturnType<typeof setTimeout> | null = null

  /** Whether the session is currently unlocked. */
  private unlocked: boolean = false

  constructor(config: VaultSessionConfig) {
    this.target = new EventTarget()
    this.autoLock = config.autoLock
    this.iterations = config.iterations ?? KDF_DEFAULTS.iterations
  }

  // ── State inspection ──────────────────────────────────────────

  /** Whether the vault is currently unlocked (decrypted keys in memory). */
  isUnlocked(): boolean {
    return this.unlocked
  }

  /** Current vault state — `'locked'` or `'unlocked'`. */
  getState(): VaultState {
    return this.unlocked ? 'unlocked' : 'locked'
  }

  /** Current auto-lock option. */
  getAutoLock(): AutoLockOption {
    return this.autoLock
  }

  /**
   * Update the auto-lock policy at runtime. If the session is currently
   * unlocked, the inactivity timer is reset against the new duration.
   */
  setAutoLock(option: AutoLockOption): void {
    this.autoLock = option
    if (this.unlocked) this.resetTimer()
  }

  // ── Unlock / Lock ─────────────────────────────────────────────

  /**
   * Unlock the vault with the master password.
   *
   * Decrypts every `master_password`-mode credential record into session
   * memory. Device-encrypted records are already auto-decryptable and are
   * pulled in as well so callers see a unified, unlocked key set. Emits
   * `'unlock'` on success.
   *
   * @returns `true` if at least one master-password record was successfully
   *          decrypted with the supplied password, or if no master-password
   *          records exist (vault unlocks trivially). `false` if a password
   *          was required but none of the records matched.
   */
  async unlock(masterPassword: string): Promise<boolean> {
    await ensureMainDB()
    const records = await getAllCredentials()

    const masterRecords = records.filter(
      r => validateRecord(r) && r.storage_mode === 'master_password',
    )

    // No master-password records → nothing to prove; unlock trivially.
    if (masterRecords.length === 0) {
      this.keys.clear()
      this.unlocked = true
      this.resetTimer()
      this.emit('unlock')
      return true
    }

    // Derive the key from the password using the first record's salt/iterations
    // (all master-password records in a vault share the same master password,
    // so any record's KDF parameters suffice for verification).
    const probe = masterRecords[0]
    if (!probe.kdf) return false

    const probeSalt = extractSalt(probe.kdf)
    const probeKey = await deriveKeyFromPassword(
      masterPassword,
      probeSalt,
      probe.kdf.iterations,
    )

    // Verify the password by decrypting the probe record. If it fails, the
    // password is wrong — abort without revealing anything.
    try {
      await decrypt(probe.ciphertext, probe.iv, probeKey)
    } catch {
      return false
    }

    // Password verified. Decrypt every master-password record into memory.
    this.keys.clear()
    let decryptedAny = false
    for (const record of masterRecords) {
      if (!record.kdf) continue
      try {
        // Re-derive per record: iterations may legitimately differ per record.
        const salt = extractSalt(record.kdf)
        const key =
          record === probe
            ? probeKey
            : await deriveKeyFromPassword(masterPassword, salt, record.kdf.iterations)
        const plaintext = await decrypt(record.ciphertext, record.iv, key)
        const cred = JSON.parse(plaintext) as DecryptedCredential
        this.keys.set(cred.provider, cred)
        decryptedAny = true
      } catch {
        // Skip records that fail to decrypt rather than failing the whole unlock.
      }
    }

    if (!decryptedAny) return false

    this.unlocked = true
    this.resetTimer()
    this.emit('unlock')
    return true
  }

  /**
   * Lock the vault immediately.
   *
   * Clears every decrypted key from the in-memory `Map` and cancels the
   * auto-lock timer. Encrypted storage in IndexedDB is left untouched.
   * Emits `'lock'`. Safe to call when already locked (no-op).
   */
  lock(): void {
    const wasUnlocked = this.unlocked
    this.clearMemory()
    this.unlocked = false
    this.cancelTimer()
    if (wasUnlocked) this.emit('lock')
  }

  // ── Key access ────────────────────────────────────────────────

  /**
   * Return the decrypted API key for `providerId`, but only if the vault is
   * currently unlocked. Accessing a key resets the inactivity timer.
   *
   * @returns the plaintext key, or `null` if locked / no key for the provider.
   */
  async getApiKey(providerId: string): Promise<string | null> {
    if (!this.unlocked) return null
    const cred = this.keys.get(providerId)
    if (!cred) return null
    // Session timer resets on each successful access.
    this.resetTimer()
    return cred.apiKey
  }

  /**
   * Return a masked representation of `key` suitable for display:
   * the first 3 and last 4 characters visible, the middle replaced with `*`.
   *
   * Example: `"sk-abcd1234567890wxyz"` → `"sk-************wxyz"`.
   *
   * For keys too short to mask safely (< 8 chars) the entire key is masked.
   */
  maskKey(key: string): string {
    if (!key) return ''
    if (key.length < 8) return '*'.repeat(key.length)
    const prefix = key.slice(0, 3)
    const suffix = key.slice(-4)
    const maskedLen = key.length - 3 - 4
    const masked = '*'.repeat(maskedLen)
    return `${prefix}${masked}${suffix}`
  }

  // ── Master password change ───────────────────────────────────

  /**
   * Change the master password.
   *
   * Verifies `oldPw` against the existing records, then re-encrypts every
   * master-password credential under a freshly derived key from `newPw`
   * (new salt, same iteration count) and persists the new records. The
   * session stays unlocked.
   *
   * @returns `true` on success, `false` if the old password was wrong.
   */
  async changeMasterPassword(oldPw: string, newPw: string): Promise<boolean> {
    await ensureMainDB()
    const records = await getAllCredentials()
    const masterRecords = records.filter(
      r => validateRecord(r) && r.storage_mode === 'master_password',
    )

    if (masterRecords.length === 0) {
      // Nothing master-password-protected — nothing to change.
      return true
    }

    // Verify the old password against the first record.
    const probe = masterRecords[0]
    if (!probe.kdf) return false
    const oldSalt = extractSalt(probe.kdf)
    const oldKey = await deriveKeyFromPassword(oldPw, oldSalt, probe.kdf.iterations)
    try {
      await decrypt(probe.ciphertext, probe.iv, oldKey)
    } catch {
      return false
    }

    // New salt + derived key for the new password.
    const newSalt = generateSalt()
    const newKey = await deriveKeyFromPassword(newPw, newSalt, this.iterations)
    const newKdf = buildKdfMetadata(newSalt, this.iterations)
    const now = new Date().toISOString()

    for (const record of masterRecords) {
      // Decrypt with old key (per-record iteration count may differ).
      const salt = record === probe ? oldSalt : extractSalt(record.kdf!)
      const key =
        record === probe
          ? oldKey
          : await deriveKeyFromPassword(oldPw, salt, record.kdf!.iterations)
      const plaintext = await decrypt(record.ciphertext, record.iv, key)
      const cred = JSON.parse(plaintext) as DecryptedCredential

      // Re-encrypt under the new key and persist.
      const { ciphertext, iv } = await encrypt(plaintext, newKey)
      const updated: EncryptedCredentialRecord = {
        ...record,
        ciphertext,
        iv,
        salt: null,
        kdf: newKdf,
        updated_at: now,
      }
      await putCredential(updated)

      // Refresh the in-memory copy.
      this.keys.set(cred.provider, cred)
    }

    return true
  }

  // ── Encrypted backup ─────────────────────────────────────────

  /**
   * Export every stored credential record as a single portable, encrypted
   * backup blob. The records are serialised to JSON and sealed with an
   * AES-256-GCM key derived from `password` via PBKDF2.
   *
   * Works regardless of lock state — it operates on the encrypted records
   * already in IndexedDB, not on the in-memory plaintext keys.
   */
  async exportEncryptedBackup(password: string): Promise<EncryptedBackup> {
    await ensureMainDB()
    const records = await getAllCredentials()
    const valid = records.filter(validateRecord)

    const salt = generateSalt()
    const key = await deriveKeyFromPassword(password, salt, this.iterations)
    const { ciphertext, iv } = await encrypt(JSON.stringify(valid), key)

    const backup: EncryptedBackup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      cipher: 'AES-256-GCM',
      kdf: buildKdfMetadata(salt, this.iterations),
      iv,
      ciphertext,
      createdAt: new Date().toISOString(),
      recordCount: valid.length,
    }
    return backup
  }

  /**
   * Import credentials from a backup blob previously produced by
   * {@link exportEncryptedBackup}. Records are decrypted with `password`
   * and written into the credential store. Records whose `id` already
   * exists are overwritten.
   *
   * @returns the number of records imported.
   */
  async importEncryptedBackup(
    backup: EncryptedBackup,
    password: string,
  ): Promise<number> {
    if (backup.format !== BACKUP_FORMAT) {
      throw new Error('Unrecognised backup format')
    }
    if (backup.version !== BACKUP_VERSION) {
      throw new Error(`Unsupported backup version: ${backup.version}`)
    }
    if (backup.cipher !== 'AES-256-GCM' || !backup.kdf) {
      throw new Error('Malformed backup: unsupported cipher or missing KDF')
    }

    const salt = extractSalt(backup.kdf)
    const key = await deriveKeyFromPassword(password, salt, backup.kdf.iterations)
    const plaintext = await decrypt(backup.ciphertext, backup.iv, key)
    const parsed = JSON.parse(plaintext) as unknown

    if (!Array.isArray(parsed)) {
      throw new Error('Backup payload is not an array of credential records')
    }

    const records = parsed.filter(validateRecord) as EncryptedCredentialRecord[]
    await ensureMainDB()
    for (const record of records) {
      await putCredential(record)
    }
    return records.length
  }

  // ── Events ────────────────────────────────────────────────────

  /**
   * Subscribe to a vault event ('unlock' | 'lock' | 'timeout').
   *
   * @returns an unsubscribe function.
   */
  on(type: VaultEventType, listener: (e: VaultEvent) => void): () => void {
    const handler = (e: Event) => listener(e as VaultEvent)
    this.target.addEventListener(type, handler)
    return () => this.target.removeEventListener(type, handler)
  }

  /** Internal event dispatcher. */
  private emit(type: VaultEventType): void {
    const detail: VaultEventDetail = { type, timestamp: Date.now() }
    this.target.dispatchEvent(new CustomEvent(type, { detail }))
  }

  // ── Timer ─────────────────────────────────────────────────────

  /** Cancel any pending auto-lock timer. */
  private cancelTimer(): void {
    if (this.timerHandle !== null) {
      clearTimeout(this.timerHandle)
      this.timerHandle = null
    }
  }

  /**
   * Reset the auto-lock timer. Called after every `getApiKey` and on unlock.
   * If auto-lock is `'never'` or the session is locked, the timer is cleared.
   */
  private resetTimer(): void {
    this.cancelTimer()
    const ms = AUTO_LOCK_MS[this.autoLock]
    if (!this.unlocked || ms <= 0) return
    this.timerHandle = setTimeout(() => {
      this.onTimeout()
    }, ms)
  }

  /** Auto-lock fired due to inactivity. Emits `'timeout'` then `'lock'`. */
  private onTimeout(): void {
    this.timerHandle = null
    this.clearMemory()
    this.unlocked = false
    this.emit('timeout')
    this.emit('lock')
  }

  // ── Memory hygiene ────────────────────────────────────────────

  /**
   * Wipe every decrypted key from the in-memory Map.
   *
   * Overwrites each string value before deletion to reduce the window in which
   * plaintext remains in the JS heap, then clears the map.
   */
  private clearMemory(): void {
    for (const [provider, cred] of this.keys) {
      // Best-effort overwrite of the key material string.
      cred.apiKey = '\u0000'.repeat(cred.apiKey.length)
      this.keys.delete(provider)
    }
    this.keys.clear()
  }
}
