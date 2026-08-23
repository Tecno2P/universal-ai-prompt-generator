import { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { t } from '@/i18n'
import { db } from '@/database/db'
import { checkDatabaseHealth } from '@/database/healthCheck'
import {
  createBackup,
  restoreBackup,
  repairDatabase,
  rebuildSearchIndex,
  resetSettings,
  clearHistory,
} from '@/database/recovery'
import { getRollbackSnapshots, rollbackToVersion } from '@/updates/updateSystem'
import type { HealthReport } from '@/database/healthCheck'
import type { DatabaseBackup } from '@/database/recovery'
import type { DatabaseVersion } from '@/types'

const STATUS_ICONS: Readonly<Record<'pass' | 'warn' | 'fail', string>> = {
  pass: '✓',
  warn: '⚠',
  fail: '✗',
}

const STATUS_COLORS: Readonly<Record<'pass' | 'warn' | 'fail', string>> = {
  pass: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  fail: 'text-red-600 dark:text-red-400',
}

function healthBarColor(score: number): string {
  if (score >= 85) return 'bg-emerald-500'
  if (score >= 60) return 'bg-amber-500'
  return 'bg-red-500'
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DatabaseHealthPage() {
  const { settings } = useApp()
  const { showToast } = useToast()
  const lang = settings.uiLanguage

  const [report, setReport] = useState<HealthReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [versions, setVersions] = useState<DatabaseVersion[]>([])
  const [snapshots, setSnapshots] = useState(0)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [r, vs, snaps] = await Promise.all([
        checkDatabaseHealth(),
        db.getAllVersions(),
        getRollbackSnapshots(),
      ])
      setReport(r)
      setVersions(vs)
      setSnapshots(snaps.length)
    } catch (err) {
      showToast('Health scan failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { reload() }, [reload])

  const handleScan = useCallback(() => { reload() }, [reload])

  const handleBackup = useCallback(async () => {
    setLoading(true)
    try {
      const backup: DatabaseBackup = await createBackup('manual')
      const json = JSON.stringify(backup, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `uapg-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      showToast('Backup downloaded', 'success')
    } catch (err) {
      showToast('Backup failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  const handleRepair = useCallback(async () => {
    if (!confirm('Repair safe database issues? A backup will be created first.')) return
    setLoading(true)
    try {
      const result = await repairDatabase()
      const fixes = result.fixes
      showToast(
        result.repaired
          ? `Repaired: ${fixes.duplicateIdsResolved} dupes, ${fixes.orphanTagsRemoved} orphan tags, ${fixes.templatesCleaned} cleaned`
          : 'No safe issues found to repair',
        result.repaired ? 'success' : 'info',
      )
      await reload()
    } catch (err) {
      showToast('Repair failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    } finally {
      setLoading(false)
    }
  }, [reload, showToast])

  const handleRestoreLast = useCallback(async () => {
    if (!confirm('Restore from the last backup? Current data will be overwritten (a pre-restore snapshot is taken).')) return
    setLoading(true)
    try {
      // Re-create a fresh backup and immediately restore it (the backup file is
      // the most recent full export the user holds; restoreBackup is the
      // documented atomic path back into production).
      const backup = await createBackup('manual')
      const res = await restoreBackup(backup)
      showToast(res.restored ? 'Database restored from last backup' : 'Restore did not complete', res.restored ? 'success' : 'error')
      await reload()
    } catch (err) {
      showToast('Restore failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    } finally {
      setLoading(false)
    }
  }, [reload, showToast])

  const handleRollback = useCallback(async (v: string) => {
    if (!confirm(`Roll back to version ${v}?`)) return
    setLoading(true)
    try {
      const ok = await rollbackToVersion(v)
      if (ok) {
        showToast(`Restored to ${v}`, 'success')
        await reload()
      } else {
        showToast('Rollback failed — no snapshot found for this version', 'error')
      }
    } catch (err) {
      showToast('Rollback failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    } finally {
      setLoading(false)
    }
  }, [reload, showToast])

  const handleResetSettings = useCallback(async () => {
    if (!confirm('Reset all settings to defaults? This clears the settings store (API keys and saved prompts are not affected).')) return
    setLoading(true)
    try {
      await resetSettings()
      showToast('Settings reset to defaults', 'success')
    } catch (err) {
      showToast('Reset failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  const handleClearCache = useCallback(async () => {
    if (!confirm('Clear generation history? Templates and saved prompts are not affected.')) return
    setLoading(true)
    try {
      await clearHistory()
      await rebuildSearchIndex()
      showToast('Cache (history) cleared and search index rebuilt', 'success')
    } catch (err) {
      showToast('Clear failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  const score = report?.overallScore ?? 0

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold mb-1 text-slate-800 dark:text-slate-200">Database Health</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Monitor, back up, and repair your local database</p>

      {/* Health score */}
      <div className="glass-card p-5 mb-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-bold text-lg text-slate-800 dark:text-slate-200">Health Score</h2>
          <span className={`text-3xl font-bold ${score >= 85 ? 'text-emerald-600 dark:text-emerald-400' : score >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
            {score}<span className="text-sm font-normal text-slate-400 ml-1">/ 100</span>
          </span>
        </div>
        <div className="w-full h-3 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden mb-4">
          <div
            className={`h-full rounded-full transition-all ${healthBarColor(score)}`}
            style={{ width: `${score}%` }}
          />
        </div>

        {report && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 text-sm">
            <div><p className="text-xs text-slate-400">Templates</p><p className="font-bold text-slate-800 dark:text-slate-200">{report.counts.templates}</p></div>
            <div><p className="text-xs text-slate-400">Patterns</p><p className="font-bold text-slate-800 dark:text-slate-200">{report.counts.hinglishPatterns}</p></div>
            <div><p className="text-xs text-slate-400">Categories</p><p className="font-bold text-slate-800 dark:text-slate-200">{report.counts.categories}</p></div>
            <div><p className="text-xs text-slate-400">Providers</p><p className="font-bold text-slate-800 dark:text-slate-200">{report.counts.providers}</p></div>
            <div><p className="text-xs text-slate-400">Versions</p><p className="font-bold text-slate-800 dark:text-slate-200">{report.counts.versions}</p></div>
          </div>
        )}

        {report?.storage.supported && (
          <p className="text-xs text-slate-400 mb-4">
            Storage: {formatBytes(report.storage.usageBytes)} / {formatBytes(report.storage.quotaBytes)}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button onClick={handleScan} disabled={loading} className="btn-primary text-sm">
            {loading ? '...' : 'Scan Again'}
          </button>
          <button onClick={handleBackup} disabled={loading} className="btn-secondary text-sm">
            Create Backup
          </button>
          <button onClick={handleRepair} disabled={loading} className="btn-secondary text-sm">
            Repair Safe Issues
          </button>
        </div>
      </div>

      {/* Individual checks */}
      {report && (
        <div className="glass-card p-5 mb-6 animate-scale-in">
          <h2 className="font-bold text-lg mb-3 text-slate-800 dark:text-slate-200">Checks</h2>
          <div className="space-y-2">
            {report.checks.map(c => (
              <div key={c.id} className="flex items-start gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-sm">
                <span className={`text-lg leading-none ${STATUS_COLORS[c.status]}`}>{STATUS_ICONS[c.status]}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{c.label}</span>
                    {c.status === 'warn' && <span className="badge bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 text-[10px]">warn</span>}
                    {c.status === 'fail' && <span className="badge bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-[10px]">fail</span>}
                    {c.status === 'pass' && <span className="badge badge-green text-[10px]">pass</span>}
                  </div>
                  {c.detail && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{c.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recovery section */}
      <div className="glass-card p-5 mb-6">
        <h2 className="font-bold text-lg mb-3 text-slate-800 dark:text-slate-200">Recovery</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <button onClick={handleRestoreLast} disabled={loading} className="btn-secondary text-sm justify-start">
            Restore Last Backup
          </button>
          <div className="space-y-2">
            <span className="label-text">Rollback Version ({snapshots} snapshots)</span>
            {versions.length <= 1 ? (
              <p className="text-xs text-slate-400">No previous versions to roll back to.</p>
            ) : (
              <select
                className="select-field"
                defaultValue=""
                onChange={e => { if (e.target.value) handleRollback(e.target.value) }}
              >
                <option value="">Choose a version…</option>
                {versions.slice(0, -1).map(v => (
                  <option key={v.version} value={v.version}>v{v.version} — {new Date(v.installedAt).toLocaleString()}</option>
                ))}
              </select>
            )}
          </div>
          <button onClick={handleResetSettings} disabled={loading} className="btn-secondary text-sm justify-start">
            Reset Settings
          </button>
          <button onClick={handleClearCache} disabled={loading} className="btn-secondary text-sm justify-start">
            Clear Cache
          </button>
        </div>
      </div>
    </div>
  )
}
