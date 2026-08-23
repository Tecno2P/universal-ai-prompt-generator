import { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { t } from '@/i18n'
import { db } from '@/database/db'
import { checkProviderHealth, getHealthStatus } from '@/providers/health/providerHealth'
import type { ProviderHealthRecord, ProviderHealthStatus } from '@/providers/health/providerHealth'
import { PROVIDER_REGISTRY, getProviderById } from '@/providers/registry'
import type { ProviderConfig, AIProvider } from '@/types'

interface ProviderRow {
  config: ProviderConfig
  provider: AIProvider | undefined
  record: ProviderHealthRecord
}

const STATUS_BADGE: Readonly<Record<ProviderHealthStatus, string>> = {
  Available: 'badge badge-green text-[10px]',
  Slow: 'badge bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 text-[10px]',
  'Rate Limited': 'badge bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 text-[10px]',
  'Authentication Error': 'badge bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-[10px]',
  Unavailable: 'badge bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-[10px]',
  Unknown: 'badge badge-gray text-[10px]',
  Disabled: 'badge badge-gray text-[10px]',
}

export function ProviderHealthPage() {
  const { settings } = useApp()
  const { showToast } = useToast()
  const lang = settings.uiLanguage

  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [rows, setRows] = useState<ProviderRow[]>([])
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [checkingAll, setCheckingAll] = useState(false)

  const reload = useCallback(async () => {
    const list = await db.getAllProviders()
    setProviders(list)
    setRows(list.map(config => ({
      config,
      provider: getProviderById(config.providerId),
      record: getHealthStatus(config.providerId),
    })))
  }, [])

  useEffect(() => { reload() }, [reload])

  const refreshRow = useCallback((config: ProviderConfig) => {
    setRows(prev => prev.map(r =>
      r.config.id === config.id
        ? { ...r, record: getHealthStatus(config.providerId) }
        : r,
    ))
  }, [])

  const handleCheck = useCallback(async (config: ProviderConfig) => {
    setCheckingId(config.id)
    try {
      await checkProviderHealth(config)
      refreshRow(config)
      const rec = getHealthStatus(config.providerId)
      showToast(`${config.name}: ${rec.status}`, rec.status === 'Available' ? 'success' : 'info')
    } catch (err) {
      showToast('Check failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    } finally {
      setCheckingId(null)
    }
  }, [refreshRow, showToast])

  const handleCheckAll = useCallback(async () => {
    if (providers.length === 0) { showToast('No providers configured', 'warning'); return }
    setCheckingAll(true)
    try {
      // Probe sequentially so one provider's failure can't mask another's result,
      // mirroring the periodic-check behaviour in providerHealth.
      for (const config of providers) {
        try {
          await checkProviderHealth(config)
          refreshRow(config)
        } catch {
          // continue to the next provider
        }
      }
      showToast('Health check complete', 'success')
    } finally {
      setCheckingAll(false)
    }
  }, [providers, refreshRow, showToast])

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold mb-1 text-slate-800 dark:text-slate-200">Provider Health</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Monitor the availability and latency of your AI providers</p>

      <div className="glass-card p-5 mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="font-bold text-lg text-slate-800 dark:text-slate-200">Configured Providers</h2>
          <button onClick={handleCheckAll} disabled={checkingAll || providers.length === 0} className="btn-primary text-sm">
            {checkingAll ? '...' : 'Check All'}
          </button>
        </div>

        {providers.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">No providers configured. Add one in Settings.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2 pr-3">Provider</th>
                  <th className="py-2 pr-3">Model</th>
                  <th className="py-2 pr-3">Last Checked</th>
                  <th className="py-2 pr-3">Latency</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ config, provider, record }) => {
                  const regName = provider?.name ?? config.providerId
                  return (
                    <tr key={config.id} className="border-b border-slate-100 dark:border-slate-800/50">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-slate-800 dark:text-slate-200">{config.name}</div>
                        <div className="text-[11px] text-slate-400">{regName}</div>
                      </td>
                      <td className="py-2 pr-3 text-slate-500 dark:text-slate-400">{config.model}</td>
                      <td className="py-2 pr-3 text-slate-500 dark:text-slate-400">
                        {record.checkedAt ? new Date(record.checkedAt).toLocaleTimeString() : '—'}
                      </td>
                      <td className="py-2 pr-3 text-slate-500 dark:text-slate-400">
                        {record.latencyMs != null ? `${record.latencyMs} ms` : '—'}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={STATUS_BADGE[record.status]}>{record.status}</span>
                        {record.message && (
                          <p className="text-[11px] text-slate-400 mt-0.5 max-w-[200px] truncate">{record.message}</p>
                        )}
                      </td>
                      <td className="py-2">
                        <button
                          onClick={() => handleCheck(config)}
                          disabled={checkingId === config.id || checkingAll}
                          className="btn-ghost text-xs"
                        >
                          {checkingId === config.id ? '...' : 'Check'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Registry reference */}
      <div className="glass-card p-5">
        <h2 className="font-bold text-lg mb-3 text-slate-800 dark:text-slate-200">Supported Providers</h2>
        <div className="flex flex-wrap gap-2">
          {PROVIDER_REGISTRY.map(p => (
            <span key={p.id} className="badge badge-gray text-xs">{p.name}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
