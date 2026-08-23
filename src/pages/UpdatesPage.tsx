import { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { t } from '@/i18n'
import { db } from '@/database/db'
import {
  getAllVersions, getOfficialVersion, getRollbackSnapshots,
  generateSubmissionPackage, generateGitHubIssueUrl, downloadSubmissionPackage, rollbackToVersion,
  type TrustLevel, TRUST_LABELS, TRUST_COLORS,
} from '@/updates/updateSystem'
import { UpdateService } from '@/updates/updateService'
import type { ProviderConfig, DatabaseVersion, PromptTemplate, UpdatePackage } from '@/types'
import type { ValidationResult } from '@/updates/updateSystem'

export function UpdatesPage() {
  const { settings, hasAI } = useApp()
  const { showToast } = useToast()
  const lang = settings.uiLanguage
  const [version, setVersion] = useState('1.0.0')
  const [officialVersion, setOfficialVersion] = useState('1.0.0')
  const [versions, setVersions] = useState<DatabaseVersion[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [pendingPackage, setPendingPackage] = useState<UpdatePackage | null>(null)
  const [validationResult, setValidationResult] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null)
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)
  const [snapshotCount, setSnapshotCount] = useState(0)

  const reload = useCallback(async () => {
    setVersion(await UpdateService.verify().then(r => r.success ? r.data.version : '1.0.0'))
    setOfficialVersion(await getOfficialVersion())
    setVersions(await getAllVersions())
    setProviders(await db.getAllProviders())
    setTemplates(await db.getAllTemplates())
    const snapshots = await getRollbackSnapshots()
    setSnapshotCount(snapshots.length)
  }, [])

  useEffect(() => { reload() }, [reload])

  const handleCheckUpdates = useCallback(async () => {
    if (!hasAI || providers.length === 0) {
      showToast(t(lang, 'updates.requireAI'), 'warning')
      return
    }
    setLoading(true)
    try {
      // The page never calls providers, normalizes JSON, or validates schema
      // directly — it delegates the entire pipeline to UpdateService.
      const provider = providers[0]
      const result = await UpdateService.checkForUpdates(provider)

      if (!result.success) {
        showToast(result.error.message, 'error')
        return
      }

      const { package: pkg, validation } = result.data
      setValidationResult({ valid: validation.valid, errors: validation.errors, warnings: validation.warnings })

      if (validation.valid && pkg.changes.length > 0) {
        setPendingPackage(pkg)
        showToast(`Found ${pkg.changes.length} new updates to review`, 'success')
      } else if (validation.errors.length > 0) {
        showToast(`Validation failed: ${validation.errors[0]}`, 'error')
      } else {
        showToast(t(lang, 'updates.noUpdates'), 'info')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update check failed'
      showToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }, [hasAI, providers, lang, showToast])

  const handleApprove = useCallback(async () => {
    if (!pendingPackage) return
    setLoading(true)
    try {
      const result = await UpdateService.install(pendingPackage)
      if (!result.success) {
        showToast(result.error.message, 'error')
        return
      }
      showToast(`Applied ${result.data.installed} updates (version ${result.data.version}). Rollback snapshot created.`, 'success')
      setPendingPackage(null)
      setValidationResult(null)
      await reload()
    } catch {
      showToast('Failed to apply updates', 'error')
    } finally {
      setLoading(false)
    }
  }, [pendingPackage, reload, showToast])

  const handleReject = () => {
    setPendingPackage(null)
    setValidationResult(null)
    showToast('Update rejected', 'info')
  }

  const handleRollback = async (v: string) => {
    setLoading(true)
    try {
      const ok = await rollbackToVersion(v)
      if (ok) {
        showToast(`Restored to ${v}`, 'success')
        await reload()
      } else {
        showToast('Rollback failed — no snapshot found for this version', 'error')
      }
    } catch {
      showToast('Rollback failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitToGitHub = () => {
    if (!pendingPackage) return
    const submission = generateSubmissionPackage(pendingPackage, officialVersion)
    const issueUrl = generateGitHubIssueUrl(submission)
    window.open(issueUrl, '_blank')
    setShowSubmitDialog(false)
    showToast('Opened GitHub Issue page — paste the pre-filled content and submit', 'info')
  }

  const handleExportSubmission = () => {
    if (!pendingPackage) return
    const submission = generateSubmissionPackage(pendingPackage, officialVersion)
    downloadSubmissionPackage(submission)
    showToast('Submission package downloaded', 'success')
  }

  const isLocalAhead = version !== officialVersion
  const pendingTrustLevel: TrustLevel = 'ai-generated'

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold mb-1">{t(lang, 'updates.title')}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">AI-powered database updates with review and rollback</p>

      {/* Version Dashboard */}
      <div className="glass-card p-5 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Official Version</p>
            <p className="text-lg font-bold text-green-600 dark:text-green-400">{officialVersion}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Local Version</p>
            <p className="text-lg font-bold text-accent-600 dark:text-accent-400">{version}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Templates</p>
            <p className="text-lg font-bold">{templates.length}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Snapshots</p>
            <p className="text-lg font-bold">{snapshotCount}</p>
          </div>
        </div>

        {isLocalAhead && (
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            Local changes not yet submitted to official database
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button onClick={handleCheckUpdates} disabled={loading || !hasAI} className="btn-primary text-sm">
            {loading ? '...' : t(lang, 'updates.checkUpdates')}
          </button>
          {isLocalAhead && (
            <button onClick={() => setShowSubmitDialog(true)} className="btn-secondary text-sm">
              Submit to GitHub
            </button>
          )}
          {snapshotCount > 0 && (
            <button onClick={handleExportSubmission} className="btn-ghost text-sm">
              Export Contribution
            </button>
          )}
        </div>
        {!hasAI && <p className="text-xs text-amber-500 mt-3">{t(lang, 'updates.requireAI')}</p>}
      </div>

      {/* Pending Review */}
      {pendingPackage && validationResult && (
        <div className="glass-card p-5 mb-6 animate-scale-in">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-lg">{t(lang, 'updates.pendingReview')}</h2>
            <span className={`badge text-xs ${TRUST_COLORS[pendingTrustLevel]}`}>
              {TRUST_LABELS[pendingTrustLevel]}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
            <div>
              <p className="text-xs text-slate-400">Current Version</p>
              <p className="font-medium">{version}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Proposed Version</p>
              <p className="font-medium text-accent-600 dark:text-accent-400">{pendingPackage.database_version}-local</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Changes</p>
              <p className="font-medium">{pendingPackage.changes.length}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Source</p>
              <p className="font-medium">{pendingPackage.source}</p>
            </div>
          </div>

          {validationResult.warnings.length > 0 && (
            <div className="mb-3 text-xs text-amber-500">
              {validationResult.warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
            </div>
          )}

          <div className="max-h-64 overflow-y-auto space-y-2 mb-4">
            {pendingPackage.changes.map((c, i) => (
              <div key={i} className="flex items-start gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-sm">
                <span className={`badge ${c.operation === 'add' ? 'badge-green' : c.operation === 'update' ? 'badge-blue' : 'badge-gray'} shrink-0`}>{c.operation}</span>
                <div className="min-w-0">
                  <span className="font-medium">{c.type}:</span> <span className="text-slate-600 dark:text-slate-400">{c.title || c.id}</span>
                  {c.category && <span className="text-xs text-slate-400 ml-2">({c.category})</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={handleApprove} disabled={loading} className="btn-primary text-sm">{t(lang, 'updates.approve')}</button>
            <button onClick={handleReject} className="btn-secondary text-sm">{t(lang, 'updates.reject')}</button>
            <button onClick={handleExportSubmission} className="btn-ghost text-sm">Export Package</button>
          </div>
        </div>
      )}

      {/* GitHub Submission Dialog */}
      {showSubmitDialog && pendingPackage && (
        <div className="glass-card p-5 mb-6 animate-scale-in border-amber-300 dark:border-amber-700">
          <h2 className="font-bold text-lg mb-2">Submit to Official Database</h2>
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-400 mb-4">
            ⚠ This update was generated locally and is not yet part of the official database. Submission does not guarantee acceptance. A maintainer will review your contribution before it is merged.
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
            <div>
              <p className="text-xs text-slate-400">Source</p>
              <p className="font-medium">AI Generated</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Templates Added</p>
              <p className="font-medium">{pendingPackage.changes.filter(c => c.type === 'template' && c.operation === 'add').length}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Base Version</p>
              <p className="font-medium">{officialVersion}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Local Version</p>
              <p className="font-medium">{version}</p>
            </div>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            Your API keys, master passwords, saved private prompts, and browser data will never be included. Only the selected database templates will be submitted.
          </p>

          <div className="flex flex-wrap gap-2">
            <button onClick={handleSubmitToGitHub} className="btn-primary text-sm">Submit to GitHub</button>
            <button onClick={handleExportSubmission} className="btn-secondary text-sm">Export Submission Package</button>
            <button onClick={() => setShowSubmitDialog(false)} className="btn-ghost text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Update History */}
      <div className="glass-card p-5">
        <h2 className="font-bold text-lg mb-3">{t(lang, 'updates.updateHistory')}</h2>
        {versions.length === 0 ? (
          <p className="text-sm text-slate-400">No updates installed yet</p>
        ) : (
          <div className="space-y-2">
            {versions.map((v, i) => {
              const isOfficial = !v.version.includes('-local')
              const trust: TrustLevel = isOfficial ? 'official' : 'ai-generated'
              return (
                <div key={i} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-sm">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-medium text-accent-600 dark:text-accent-400">v{v.version}</span>
                    <span className={`badge text-xs ${TRUST_COLORS[trust]}`}>{TRUST_LABELS[trust]}</span>
                    <span className="text-slate-400">{new Date(v.installedAt).toLocaleString()}</span>
                    <span className="text-slate-400">{v.changeCount} changes</span>
                    <span className="text-xs text-slate-400">[{v.source}]</span>
                  </div>
                  {i < versions.length - 1 && (
                    <button onClick={() => handleRollback(v.version)} disabled={loading} className="btn-ghost text-xs">
                      {t(lang, 'updates.rollback')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
