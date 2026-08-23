import { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { t } from '@/i18n'
import {
  getErrorLog,
  generateDiagnosticReport,
  clearErrorLog,
  copyDiagnosticReport,
} from '@/diagnostics/errorDiagnostics'
import type { SanitizedError, ErrorSeverity } from '@/diagnostics/errorDiagnostics'
import {
  getChannel,
  setChannel,
  channelLabel,
  CHANNEL_VERSIONS,
} from '@/updates/updateChannels'
import type { UpdateChannel } from '@/updates/updateChannels'

const SEVERITY_BADGE: Readonly<Record<ErrorSeverity, string>> = {
  info: 'badge badge-gray text-[10px]',
  warning: 'badge bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 text-[10px]',
  error: 'badge bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-[10px]',
  critical: 'badge bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-200 text-[10px]',
}

interface ChannelMeta {
  channel: UpdateChannel
  label: string
  version: string
  description: string
}

const CHANNELS: ReadonlyArray<ChannelMeta> = [
  {
    channel: 'stable',
    label: 'Stable',
    version: CHANNEL_VERSIONS.stable,
    description: 'Fully tested releases. Safe for daily use. Auto-install allowed.',
  },
  {
    channel: 'beta',
    label: 'Beta',
    version: CHANNEL_VERSIONS.beta,
    description: 'Pre-release builds with upcoming features. Auto-install allowed, but expect rough edges.',
  },
  {
    channel: 'experimental',
    label: 'Experimental',
    version: CHANNEL_VERSIONS.experimental,
    description: 'Bleeding-edge, untested changes. NEVER auto-installs — every update requires explicit review.',
  },
]

export function DiagnosticsPage() {
  const { settings } = useApp()
  const { showToast } = useToast()
  const lang = settings.uiLanguage

  const [errors, setErrors] = useState<SanitizedError[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [channel, setChannelState] = useState<UpdateChannel>('stable')

  const reload = useCallback(() => {
    setErrors(getErrorLog())
    setChannelState(getChannel())
  }, [])

  useEffect(() => { reload() }, [reload])

  const handleViewSafe = useCallback((id: string) => {
    setSelectedId(prev => prev === id ? null : id)
  }, [])

  const handleCopyReport = useCallback(() => {
    const report = generateDiagnosticReport()
    const text = copyDiagnosticReport(report)
    navigator.clipboard.writeText(text)
      .then(() => showToast('Diagnostic report copied to clipboard', 'success'))
      .catch(() => showToast('Copy failed — your browser blocked clipboard access', 'error'))
  }, [showToast])

  const handleExportReport = useCallback(() => {
    const report = generateDiagnosticReport()
    const json = JSON.stringify(report, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `uapg-diagnostics-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    showToast('Diagnostic report exported', 'success')
  }, [showToast])

  const handleClear = useCallback(() => {
    if (!confirm('Clear the entire local error log? This cannot be undone.')) return
    clearErrorLog()
    setErrors([])
    setSelectedId(null)
    showToast('Error log cleared', 'info')
  }, [showToast])

  const handleChannelChange = useCallback((c: UpdateChannel) => {
    setChannel(c)
    setChannelState(c)
    showToast(`Update channel set to ${channelLabel(c)}`, 'success')
  }, [showToast])

  const selected = errors.find(e => e.error_id === selectedId) ?? null

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold mb-1 text-slate-800 dark:text-slate-200">Diagnostics</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Local error log and update channel preferences</p>

      {/* Error log */}
      <div className="glass-card p-5 mb-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-bold text-lg text-slate-800 dark:text-slate-200">Error Log</h2>
          <span className="text-sm text-slate-400">{errors.length} record(s)</span>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={handleCopyReport} disabled={errors.length === 0} className="btn-secondary text-sm">
            Copy Report
          </button>
          <button onClick={handleExportReport} disabled={errors.length === 0} className="btn-secondary text-sm">
            Export Report
          </button>
          <button onClick={handleClear} disabled={errors.length === 0} className="btn-ghost text-sm text-red-500">
            Clear Log
          </button>
        </div>

        {errors.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">No errors logged. All clear.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2 pr-3">Timestamp</th>
                  <th className="py-2 pr-3">Feature</th>
                  <th className="py-2 pr-3">Severity</th>
                  <th className="py-2 pr-3">Message</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {errors.map(e => (
                  <tr key={e.error_id} className="border-b border-slate-100 dark:border-slate-800/50 align-top">
                    <td className="py-2 pr-3 text-xs text-slate-400 whitespace-nowrap">
                      {new Date(e.timestamp).toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">{e.feature}</td>
                    <td className="py-2 pr-3">
                      <span className={SEVERITY_BADGE[e.severity]}>{e.severity}</span>
                    </td>
                    <td className="py-2 pr-3 text-slate-600 dark:text-slate-400 max-w-[320px]">
                      <span className="line-clamp-2">{e.sanitized_message}</span>
                      {e.occurrence_count > 1 && (
                        <span className="text-[11px] text-slate-400"> ×{e.occurrence_count}</span>
                      )}
                    </td>
                    <td className="py-2">
                      <button onClick={() => handleViewSafe(e.error_id)} className="btn-ghost text-xs">
                        {selectedId === e.error_id ? 'Hide' : 'View Safe Details'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Safe detail panel */}
        {selected && (
          <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg animate-scale-in">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="font-medium text-sm text-slate-800 dark:text-slate-200">{selected.feature}</span>
              <span className={SEVERITY_BADGE[selected.severity]}>{selected.severity}</span>
              <code className="text-[10px] text-slate-400 font-mono">{selected.error_id}</code>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{selected.sanitized_message}</p>
            {selected.stack && (
              <pre className="text-[11px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 p-2 rounded overflow-x-auto max-h-40 mb-2 whitespace-pre-wrap">{selected.stack}</pre>
            )}
            {Object.keys(selected.context).length > 0 && (
              <div className="text-xs">
                <p className="font-medium text-slate-600 dark:text-slate-300 mb-1">Context:</p>
                <pre className="text-[11px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 p-2 rounded overflow-x-auto max-h-40 whitespace-pre-wrap">{JSON.stringify(selected.context, null, 2)}</pre>
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-2">
              All secrets have been redacted. This detail is safe to share.
            </p>
          </div>
        )}
      </div>

      {/* Update Channels */}
      <div className="glass-card p-5">
        <h2 className="font-bold text-lg mb-3 text-slate-800 dark:text-slate-200">Update Channel</h2>
        <div className="space-y-2">
          {CHANNELS.map(meta => (
            <label
              key={meta.channel}
              className="flex items-start gap-2 text-sm cursor-pointer p-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800"
            >
              <input
                type="radio"
                name="updateChannel"
                value={meta.channel}
                checked={channel === meta.channel}
                onChange={() => handleChannelChange(meta.channel)}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-slate-800 dark:text-slate-200">{meta.label}</span>
                  <span className="badge badge-gray text-[10px]">v{meta.version}</span>
                  {meta.channel === 'experimental' && <span className="badge bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 text-[10px]">review required</span>}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{meta.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
