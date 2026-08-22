import { useState, useEffect, useCallback } from 'react'
import { useApp, type ThemeMode } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { t } from '@/i18n'
import { SUPPORTED_LANGUAGES } from '@/i18n'
import { db } from '@/database/db'
import type { Language, OperationMode } from '@/types'
import { PROVIDER_REGISTRY } from '@/providers/registry'
import { testProviderConnection } from '@/providers/manager'
import { ProviderError } from '@/providers/interface'
import * as credentialService from '@/services/credentialService'
import type { CredentialDisplayInfo } from '@/security/securityTypes'
import type { StorageMode } from '@/security/securityTypes'

export function SettingsPage() {
  const { settings, updateSettings, setHasAI } = useApp()
  const { showToast } = useToast()
  const lang = settings.uiLanguage
  const [providers, setProviders] = useState<CredentialDisplayInfo[]>([])
  const [showAddProvider, setShowAddProvider] = useState(false)
  const [newProvider, setNewProvider] = useState({
    providerId: 'openai',
    name: '',
    apiKey: '',
    model: '',
    customEndpoint: '',
  })
  const [storageMode, setStorageMode] = useState<StorageMode>('session')
  const [masterPassword, setMasterPassword] = useState('')
  const [testingId, setTestingId] = useState('')
  const [unlockProviderId, setUnlockProviderId] = useState<string | null>(null)
  const [unlockPassword, setUnlockPassword] = useState('')

  const reloadProviders = useCallback(async () => {
    const list = await credentialService.listProviders()
    setProviders(list)
    setHasAI(list.length > 0)
  }, [setHasAI])

  useEffect(() => { reloadProviders() }, [reloadProviders])

  const handleAddProvider = useCallback(async () => {
    const registry = PROVIDER_REGISTRY.find(p => p.id === newProvider.providerId)
    if (!registry) return
    if (!newProvider.apiKey) {
      showToast('API key is required', 'warning')
      return
    }
    if (storageMode === 'master_password' && !masterPassword) {
      showToast('Master password is required for master password mode', 'warning')
      return
    }

    try {
      await credentialService.saveCredential({
        providerId: newProvider.providerId,
        name: newProvider.name || registry.name,
        apiKey: newProvider.apiKey,
        model: newProvider.model || registry.models[0]?.id || '',
        customEndpoint: newProvider.customEndpoint || undefined,
        storageMode,
        masterPassword: storageMode === 'master_password' ? masterPassword : undefined,
      })
      await reloadProviders()
      setShowAddProvider(false)
      setNewProvider({ providerId: 'openai', name: '', apiKey: '', model: '', customEndpoint: '' })
      setMasterPassword('')
      showToast('Provider added securely', 'success')
    } catch (err) {
      showToast('Failed to save provider: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    }
  }, [newProvider, storageMode, masterPassword, reloadProviders, showToast])

  const handleTestProvider = useCallback(async (p: CredentialDisplayInfo) => {
    setTestingId(p.id)
    try {
      const config = await db.getAllProviders()
      const providerConfig = config.find(c => c.providerId === p.providerId)
      if (!providerConfig) { showToast('Provider config not found', 'error'); return }
      const ok = await testProviderConnection(providerConfig)
      if (ok) {
        const all = await db.getAllProviders()
        const updated = all.find(c => c.providerId === p.providerId)
        if (updated) { await db.putProvider({ ...updated, connected: true }); await reloadProviders() }
        showToast('Connection successful!', 'success')
      } else {
        showToast('Connection failed', 'error')
      }
    } catch (err) {
      const msg = err instanceof ProviderError ? err.message : 'Connection failed'
      showToast(msg, 'error')
    } finally {
      setTestingId('')
    }
  }, [reloadProviders, showToast])

  const handleRemoveProvider = useCallback(async (providerId: string) => {
    await credentialService.removeProvider(providerId)
    await reloadProviders()
    showToast('Provider removed', 'info')
  }, [reloadProviders, showToast])

  const handleUnlock = useCallback(async (providerId: string) => {
    if (!unlockPassword) { showToast('Enter master password', 'warning'); return }
    const ok = await credentialService.unlockProvider(providerId, unlockPassword)
    if (ok) {
      showToast('Provider unlocked', 'success')
      await reloadProviders()
      setUnlockProviderId(null)
      setUnlockPassword('')
    } else {
      showToast('Incorrect master password', 'error')
    }
  }, [unlockPassword, reloadProviders, showToast])

  const handleLock = useCallback(async (providerId: string) => {
    credentialService.lockProvider(providerId)
    await reloadProviders()
    showToast('Provider locked', 'info')
  }, [reloadProviders, showToast])

  const handleClearData = useCallback(async () => {
    if (!confirm(t(lang, 'settings.clearConfirm'))) return
    await credentialService.removeAllProviders()
    await db.clearAll()
    localStorage.removeItem('app-settings')
    showToast('All local data cleared', 'success')
    setTimeout(() => window.location.reload(), 500)
  }, [lang, showToast])

  const selectedRegistry = PROVIDER_REGISTRY.find(p => p.id === newProvider.providerId)

  const storageModeLabel = (mode: StorageMode): string => {
    switch (mode) {
      case 'session': return 'Session Only'
      case 'encrypted_device': return 'Remember Device'
      case 'master_password': return 'Master Password'
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold">{t(lang, 'nav.settings')}</h1>

      {/* Appearance */}
      <section className="glass-card p-5">
        <h2 className="font-bold text-lg mb-4">Appearance</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label-text">{t(lang, 'settings.theme')}</label>
            <div className="flex gap-2">
              {(['dark', 'light', 'system'] as ThemeMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => updateSettings({ theme: mode })}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    settings.theme === mode ? 'bg-accent-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {t(lang, `settings.${mode}`)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label-text">{t(lang, 'settings.language')} (UI)</label>
            <select
              value={settings.uiLanguage}
              onChange={e => updateSettings({ uiLanguage: e.target.value as Language })}
              className="select-field"
            >
              {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name} ({l.nativeName})</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={settings.reducedMotion} onChange={e => updateSettings({ reducedMotion: e.target.checked })} />
            {t(lang, 'settings.reducedMotion')}
          </label>
        </div>
      </section>

      {/* Generation defaults */}
      <section className="glass-card p-5">
        <h2 className="font-bold text-lg mb-4">Generation Defaults</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="label-text">{t(lang, 'settings.defaultStyle')}</label>
            <select value={settings.defaultStyle} onChange={e => updateSettings({ defaultStyle: e.target.value })} className="select-field">
              {['simple', 'professional', 'expert', 'detailed', 'technical', 'creative', 'structured', 'json', 'developer', 'agent', 'system', 'reasoning'].map(s =>
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              )}
            </select>
          </div>
          <div>
            <label className="label-text">Default Output Language</label>
            <select value={settings.language} onChange={e => updateSettings({ language: e.target.value as Language })} className="select-field">
              {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label-text">Operation Mode</label>
            <select value={settings.mode} onChange={e => updateSettings({ mode: e.target.value as OperationMode })} className="select-field">
              <option value="offline">{t(lang, 'modes.offline')}</option>
              <option value="ai">{t(lang, 'modes.ai')}</option>
              <option value="hybrid">{t(lang, 'modes.hybrid')}</option>
              <option value="auto">{t(lang, 'modes.auto')}</option>
            </select>
          </div>
        </div>
      </section>

      {/* AI Providers — Secure Key Management */}
      <section className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg">{t(lang, 'providers.title')}</h2>
          <button onClick={() => setShowAddProvider(!showAddProvider)} className="btn-primary text-sm">
            {t(lang, 'providers.addProvider')}
          </button>
        </div>

        {/* Security warning */}
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-400">
          ⚠ {t(lang, 'providers.securityWarning')}
        </div>

        {/* Existing providers */}
        {providers.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">No providers configured</p>
        ) : (
          <div className="space-y-2 mb-4">
            {providers.map(p => (
              <div key={p.id} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{p.name}</span>
                      <span className={`badge text-[10px] ${
                        p.encryptionStatus === 'master_password' ? 'badge-purple' :
                        p.encryptionStatus === 'encrypted' ? 'badge-blue' : 'badge-gray'
                      }`}>{storageModeLabel(p.storageMode)}</span>
                      {p.connected && <span className="badge-green text-[10px]">Connected</span>}
                      {p.locked && <span className="badge-gray text-[10px]">🔒 Locked</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-400">{p.model}</span>
                      {p.maskedKey && <code className="text-xs text-slate-500 dark:text-slate-500 font-mono">{p.maskedKey}</code>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0 ml-2">
                    {p.locked ? (
                      <button onClick={() => setUnlockProviderId(p.providerId)} className="btn-ghost text-xs">Unlock</button>
                    ) : (
                      <>
                        <button onClick={() => handleTestProvider(p)} disabled={testingId === p.id} className="btn-ghost text-xs">
                          {testingId === p.id ? '...' : t(lang, 'common.testConnection')}
                        </button>
                        {p.storageMode === 'master_password' && (
                          <button onClick={() => handleLock(p.providerId)} className="btn-ghost text-xs">Lock</button>
                        )}
                      </>
                    )}
                    <button onClick={() => handleRemoveProvider(p.providerId)} className="btn-ghost text-xs text-red-500">{t(lang, 'providers.removeKey')}</button>
                  </div>
                </div>
                {/* Unlock dialog */}
                {unlockProviderId === p.providerId && (
                  <div className="mt-3 p-3 bg-white dark:bg-slate-900 rounded-lg space-y-2 animate-slide-down">
                    <label className="label-text">Enter Master Password</label>
                    <input
                      type="password"
                      value={unlockPassword}
                      onChange={e => setUnlockPassword(e.target.value)}
                      className="input-field"
                      placeholder="Master password"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button onClick={() => handleUnlock(p.providerId)} className="btn-primary text-sm">Unlock</button>
                      <button onClick={() => { setUnlockProviderId(null); setUnlockPassword('') }} className="btn-secondary text-sm">{t(lang, 'common.cancel')}</button>
                    </div>
                    <p className="text-xs text-amber-500">If you forget your Master Password, your encrypted API keys cannot be recovered.</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add provider form */}
        {showAddProvider && (
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg space-y-3 animate-slide-down">
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="label-text">{t(lang, 'providers.provider')}</label>
                <select value={newProvider.providerId} onChange={e => setNewProvider({ ...newProvider, providerId: e.target.value, model: '' })} className="select-field">
                  {PROVIDER_REGISTRY.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label-text">Display Name</label>
                <input type="text" value={newProvider.name} onChange={e => setNewProvider({ ...newProvider, name: e.target.value })} placeholder={selectedRegistry?.name || ''} className="input-field" />
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="label-text">{t(lang, 'providers.apiKey')}</label>
                <input type="password" value={newProvider.apiKey} onChange={e => setNewProvider({ ...newProvider, apiKey: e.target.value })} placeholder="sk-..." className="input-field" />
              </div>
              <div>
                <label className="label-text">{t(lang, 'providers.model')}</label>
                <select value={newProvider.model} onChange={e => setNewProvider({ ...newProvider, model: e.target.value })} className="select-field">
                  <option value="">Default ({selectedRegistry?.models[0]?.name})</option>
                  {selectedRegistry?.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            </div>
            {selectedRegistry?.supportsCustomEndpoint && (
              <div>
                <label className="label-text">{t(lang, 'providers.customEndpoint')}</label>
                <input type="text" value={newProvider.customEndpoint} onChange={e => setNewProvider({ ...newProvider, customEndpoint: e.target.value })} placeholder={selectedRegistry?.defaultEndpoint} className="input-field" />
              </div>
            )}

            {/* Storage mode selection */}
            <div>
              <label className="label-text">Storage Mode</label>
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-sm cursor-pointer p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                  <input type="radio" name="storageMode" value="session" checked={storageMode === 'session'} onChange={() => setStorageMode('session')} className="mt-0.5" />
                  <div>
                    <span className="font-medium">Session Only</span>
                    <p className="text-xs text-slate-400">API key disappears when the session ends. Recommended.</p>
                  </div>
                </label>
                <label className="flex items-start gap-2 text-sm cursor-pointer p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                  <input type="radio" name="storageMode" value="encrypted_device" checked={storageMode === 'encrypted_device'} onChange={() => setStorageMode('encrypted_device')} className="mt-0.5" />
                  <div>
                    <span className="font-medium">Remember This Device</span>
                    <p className="text-xs text-slate-400">Store encrypted (AES-256-GCM) locally on this browser/device.</p>
                  </div>
                </label>
                <label className="flex items-start gap-2 text-sm cursor-pointer p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                  <input type="radio" name="storageMode" value="master_password" checked={storageMode === 'master_password'} onChange={() => setStorageMode('master_password')} className="mt-0.5" />
                  <div>
                    <span className="font-medium">Master Password Protected</span>
                    <p className="text-xs text-slate-400">Encrypt with a user-controlled master password (PBKDF2 + AES-256-GCM).</p>
                  </div>
                </label>
              </div>
            </div>

            {storageMode === 'master_password' && (
              <div className="animate-slide-down">
                <label className="label-text">Master Password</label>
                <input type="password" value={masterPassword} onChange={e => setMasterPassword(e.target.value)} className="input-field" placeholder="Create a strong master password" />
                <p className="text-xs text-amber-500 mt-1">⚠ If you forget your Master Password, your encrypted API keys cannot be recovered. You will need to remove them and enter new API keys.</p>
              </div>
            )}

            {storageMode !== 'session' && (
              <p className="text-xs text-slate-500 dark:text-slate-400">Your API key will be stored only in this browser on this device. The website does not upload or receive your API key.</p>
            )}

            <div className="flex gap-2">
              <button onClick={handleAddProvider} className="btn-primary text-sm">Add Provider</button>
              <button onClick={() => setShowAddProvider(false)} className="btn-secondary text-sm">{t(lang, 'common.cancel')}</button>
            </div>
          </div>
        )}
      </section>

      {/* Database updates */}
      <section className="glass-card p-5">
        <h2 className="font-bold text-lg mb-4">{t(lang, 'updates.title')}</h2>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={settings.autoUpdateCheck} onChange={e => updateSettings({ autoUpdateCheck: e.target.checked })} />
            {t(lang, 'settings.autoUpdate')}
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={settings.askBeforeInstall} onChange={e => updateSettings({ askBeforeInstall: e.target.checked })} />
            {t(lang, 'settings.updateApproval')}
          </label>
        </div>
      </section>

      {/* Privacy & Data */}
      <section className="glass-card p-5">
        <h2 className="font-bold text-lg mb-4">{t(lang, 'settings.privacy')}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          All data is stored locally in your browser. No accounts, no servers. API keys are encrypted with AES-256-GCM before storage. Plaintext keys live only in temporary memory.
        </p>
        <div className="flex flex-col gap-2">
          <button onClick={async () => { await credentialService.removeAllProviders(); await reloadProviders(); showToast('All API keys cleared', 'success') }} className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg text-sm transition-colors">
            Clear All API Keys
          </button>
          <button onClick={handleClearData} className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg text-sm transition-colors">
            {t(lang, 'common.clearAllData')}
          </button>
        </div>
      </section>
    </div>
  )
}
