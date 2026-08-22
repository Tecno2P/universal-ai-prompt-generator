import type { EncryptedCredentialRecord, EncryptionVersion } from '@/security/securityTypes'
import { KDF_DEFAULTS } from '@/security/securityTypes'
import { needsKdfMigration } from './keyDerivation'

/**
 * Credential migration — handles upgrading encrypted records to newer
 * encryption versions or stronger KDF parameters.
 */

export interface MigrationResult {
  migrated: boolean
  oldVersion: EncryptionVersion
  newVersion: EncryptionVersion
  record: EncryptedCredentialRecord
}

/**
 * Check if a credential record needs migration.
 * Returns true if:
 * - encryption_version is older than the current version
 * - KDF iterations are below the recommended minimum
 */
export function needsMigration(record: EncryptedCredentialRecord): boolean {
  if (record.encryption_version < KDF_DEFAULTS.encryption_version) return true
  if (record.kdf && needsKdfMigration(record.kdf)) return true
  return false
}

/**
 * Mark a record as migrated to the current encryption version.
 * This updates metadata only — the actual re-encryption must be performed
 * by the credential vault when the plaintext key is available (unlocked).
 */
export function upgradeRecordVersion(
  record: EncryptedCredentialRecord,
): EncryptedCredentialRecord {
  return {
    ...record,
    encryption_version: KDF_DEFAULTS.encryption_version,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Get all records that need migration.
 */
export async function findRecordsNeedingMigration(
  records: EncryptedCredentialRecord[],
): Promise<EncryptedCredentialRecord[]> {
  return records.filter(needsMigration)
}

/**
 * Validate that an encrypted record is well-formed.
 * Malformed records should be rejected (not used) to prevent
 * crashes or undefined behavior.
 */
export function validateRecord(record: unknown): record is EncryptedCredentialRecord {
  if (!record || typeof record !== 'object') return false
  const r = record as Record<string, unknown>
  if (typeof r.id !== 'string') return false
  if (typeof r.provider !== 'string') return false
  if (typeof r.storage_mode !== 'string') return false
  if (typeof r.ciphertext !== 'string') return false
  if (typeof r.iv !== 'string') return false
  if (r.cipher !== 'AES-256-GCM') return false
  if (typeof r.encryption_version !== 'number') return false
  if (typeof r.created_at !== 'string') return false
  if (typeof r.updated_at !== 'string') return false

  // Master password records must have KDF metadata
  if (r.storage_mode === 'master_password') {
    if (!r.kdf || typeof r.kdf !== 'object') return false
    const kdf = r.kdf as Record<string, unknown>
    if (typeof kdf.kdf !== 'string') return false
    if (typeof kdf.iterations !== 'number') return false
    if (typeof kdf.salt !== 'string') return false
    if (r.salt !== null && typeof r.salt !== 'string') return false
  }

  // Device-encrypted records must NOT have KDF metadata (no password)
  if (r.storage_mode === 'encrypted_device') {
    if (r.kdf !== null && r.kdf !== undefined) return false
  }

  return true
}
