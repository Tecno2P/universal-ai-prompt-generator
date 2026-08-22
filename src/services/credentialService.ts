import type { DecryptedCredential, StorageMode, CredentialDisplayInfo } from '../security/securityTypes'
import * as vault from '../security/credentialVault'
import { maskApiKey, getUnlockedProviders } from '../security/secureMemory'
import { PROVIDER_REGISTRY } from '@/providers/registry'
import type { ProviderConfig } from '@/types'
import { db } from '@/database/db'

/**
 * Credential Service — the single interface the UI uses.
 * UI components must NOT import the vault or crypto modules directly.
 *
 * This service also manages the ProviderConfig records (name, model, etc.)
 * which are NOT secrets and can be stored in the main database.
 */

export interface SaveCredentialParams {
  providerId: string
  name: string
  apiKey: string
  model: string
  customEndpoint?: string
  storageMode: StorageMode
  masterPassword?: string
}

/** Save a credential + provider config. */
export async function saveCredential(params: SaveCredentialParams): Promise<void> {
  // Store the encrypted credential
  await vault.storeCredential({
    provider: params.providerId,
    apiKey: params.apiKey,
    model: params.model,
    customEndpoint: params.customEndpoint,
    storageMode: params.storageMode,
    masterPassword: params.masterPassword,
  })

  // Store the non-secret provider config in the main DB
  const config: ProviderConfig = {
    id: `prov-${params.providerId}-${Date.now()}`,
    providerId: params.providerId,
    name: params.name,
    apiKey: undefined, // Never store plaintext key in the main DB
    model: params.model,
    customEndpoint: params.customEndpoint,
    connected: false,
    createdAt: Date.now(),
  }
  await db.putProvider(config)
}

/** Get the decrypted API key for a provider (from memory or auto-unlock). */
export async function getApiKey(providerId: string): Promise<string | null> {
  const cred = await vault.retrieveCredential(providerId)
  return cred?.apiKey || null
}

/** Get the full decrypted credential for a provider. */
export async function getCredential(providerId: string): Promise<DecryptedCredential | null> {
  return vault.retrieveCredential(providerId)
}

/** Unlock a master-password-protected provider. */
export async function unlockProvider(providerId: string, masterPassword: string): Promise<boolean> {
  return vault.unlockWithMasterPassword(providerId, masterPassword)
}

/** Lock a single provider (remove its key from memory). */
export function lockProvider(providerId: string): void {
  vault.lockCredential(providerId)
}

/** Lock all providers. */
export function lockAll(): void {
  vault.lockAll()
}

/** Remove a provider's credential + config. */
export async function removeProvider(providerId: string): Promise<void> {
  await vault.removeCredential(providerId)
  // Also remove the provider config from the main DB
  const providers = await db.getAllProviders()
  for (const p of providers) {
    if (p.providerId === providerId) {
      await db.deleteProvider(p.id)
    }
  }
}

/** Remove all provider credentials + configs. */
export async function removeAllProviders(): Promise<void> {
  await vault.removeAllCredentials()
  const providers = await db.getAllProviders()
  for (const p of providers) {
    await db.deleteProvider(p.id)
  }
}

/** Get display info for all providers (for the Settings UI). */
export async function listProviders(): Promise<CredentialDisplayInfo[]> {
  const configs = await db.getAllProviders()
  const metaList = await vault.listCredentialMetadata()
  const unlockedProviders = getUnlockedProviders()
  const results: CredentialDisplayInfo[] = []

  for (const config of configs) {
    const providerMeta = metaList.find(m => m.provider === config.providerId)
    const isUnlocked = unlockedProviders.includes(config.providerId)
    const isLocked = providerMeta?.has_master_password === true && !isUnlocked

    const apiKey = isUnlocked ? await getApiKey(config.providerId) : null

    const reg = PROVIDER_REGISTRY.find(p => p.id === config.providerId)
    const storageMode = providerMeta?.storage_mode || 'session'
    const encryptionStatus: CredentialDisplayInfo['encryptionStatus'] =
      storageMode === 'session' ? 'session' :
      storageMode === 'master_password' ? 'master_password' : 'encrypted'

    results.push({
      id: config.id,
      provider: config.providerId,
      providerId: config.providerId,
      name: config.name,
      model: config.model,
      customEndpoint: config.customEndpoint,
      storageMode,
      encryptionStatus,
      maskedKey: apiKey ? maskApiKey(apiKey) : (providerMeta ? '••••••••' : null),
      connected: config.connected,
      locked: isLocked,
    })
  }

  return results
}

/** Check if any provider is configured and unlocked. */
export async function hasUnlockedProvider(): Promise<boolean> {
  return getUnlockedProviders().length > 0
}

/** Get the first unlocked provider's config (for auto mode). */
export async function getFirstUnlockedProvider(): Promise<ProviderConfig | null> {
  const unlocked = getUnlockedProviders()
  if (unlocked.length === 0) return null
  const providers = await db.getAllProviders()
  return providers.find(p => unlocked.includes(p.providerId)) || null
}

/** Check if any credentials are stored (persistent). */
export async function hasStoredCredentials(): Promise<boolean> {
  return vault.hasStoredCredentials()
}
