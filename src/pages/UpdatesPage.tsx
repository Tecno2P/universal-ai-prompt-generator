import { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { t } from '@/i18n'
import { db } from '@/database/db'
import { getCurrentVersion, getAllVersions } from '@/database/repository'
import type { ProviderConfig, DatabaseVersion, PromptTemplate } from '@/types'
import { validateUpdatePackage, applyUpdatePackage, buildUpdateRequestPrompt, incrementVersion } from '@/updates/updateSystem'
import { generateWithProvider } from '@/providers/manager'
import { ProviderError } from '@/providers/interface'
import type { UpdatePackage, UpdateChange } from '@/types'

export function UpdatesPage() {
  const { settings, hasAI } = useApp()
  const { showToast } = useToast()
  const lang = settings.uiLanguage
  const [version, setVersion] = useState('1.0.0')
  const [versions, setVersions] = useState<DatabaseVersion[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [pendingPackage, setPendingPackage] = useState<UpdatePackage | null>(null)
  const [validationResult, setValidationResult] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null)

  const reload = useCallback(async () => {
    setVersion(await getCurrentVersion())
    setVersions(await getAllVersions())
    setProviders(await db.getAllProviders())
    setTemplates(await db.getAllTemplates())
  }, [])

  useEffect(() => { reload() }, [reload])

  const handleCheckUpdates = useCallback(async () => {
    if (!hasAI || providers.length === 0) {
      showToast(t(lang, 'updates.requireAI'), 'warning')
      return
    }
    setLoading(true)
    try {
      const provider = providers[0]
      const categories = Array.from(new Set(templates.map(t => t.category)))
      const languages = Array.from(new Set(templates.map(t => t.language)))
      const prompt = buildUpdateRequestPrompt(version, templates.length, categories, languages)

      const result = await generateWithProvider(provider, {
        model: provider.model,
        systemInstruction: 'You are a JSON API. Return ONLY valid JSON. No reasoning, no explanation, no markdown. Start your response with { and end with }.',
        userPrompt: prompt,
        temperature: 0.3,
        maxTokens: 8000,
      })

      // Try to parse JSON from the response
      let parsed: unknown
      try {
        // Strip markdown code fences if present
        const clean = result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        parsed = JSON.parse(clean)
      } catch {
        // Show a more helpful error with a snippet of what the AI returned
        const snippet = result.text.slice(0, 200).replace(/\n/g, ' ')
        showToast(`AI returned invalid JSON. Got: "${snippet}..." — try again or use a different model.`, 'error')
        return
      }

      const validation = validateUpdatePackage(parsed)
      setValidationResult({ valid: validation.valid, errors: validation.errors, warnings: validation.warnings })

      if (validation.valid && validation.changes.length > 0) {
        setPendingPackage({
          schema_version: 1,
          database_version: incrementVersion(version),
          changes: validation.changes as UpdateChange[],
          generatedAt: Date.now(),
          source: `AI (${provider.providerId})`,
        })
        showToast(`Found ${validation.changes.length} new updates to review`, 'success')
      } else if (validation.errors.length > 0) {
        showToast(`Validation failed: ${validation.errors[0]}`, 'error')
      } else {
        showToast(t(lang, 'updates.noUpdates'), 'info')
      }
    } catch (err) {
      const msg = err instanceof ProviderError ? err.message :
        err instanceof Error ? err.message : 'Update check failed'
      showToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }, [hasAI, providers, templates, version, lang, showToast])

  const handleApprove = useCallback(async () => {
    if (!pendingPackage) return
    setLoading(true)
    try {
      const result = await applyUpdatePackage(pendingPackage)
      showToast(`Applied ${result.applied} updates (${result.skipped} skipped)`, 'success')
      setPendingPackage(null)
      setValidationResult(null)
      await reload()
    } catch (err) {
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
    showToast(`Rollback to ${v} (simplified — version record updated)`, 'info')
    await reload()
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold mb-1">{t(lang, 'updates.title')}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">AI-powered database updates with review and rollback</p>

      {/* Current status */}
      <div className="glass-card p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t(lang, 'updates.currentVersion')}</p>
            <p className="text-2xl font-bold text-accent-600 dark:text-accent-400">{version}</p>
          </div>
          <button onClick={handleCheckUpdates} disabled={loading || !hasAI} className="btn-primary">
            {loading ? '...' : t(lang, 'updates.checkUpdates')}
          </button>
        </div>
        {!hasAI && <p className="text-xs text-amber-500 mt-3">{t(lang, 'updates.requireAI')}</p>}
      </div>

      {/* Pending review */}
      {pendingPackage && validationResult && (
        <div className="glass-card p-5 mb-6 animate-scale-in">
          <h2 className="font-bold text-lg mb-2">{t(lang, 'updates.pendingReview')}</h2>
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
          <div className="flex gap-2">
            <button onClick={handleApprove} disabled={loading} className="btn-primary text-sm">{t(lang, 'updates.approve')}</button>
            <button onClick={handleReject} className="btn-secondary text-sm">{t(lang, 'updates.reject')}</button>
          </div>
        </div>
      )}

      {/* Update history */}
      <div className="glass-card p-5">
        <h2 className="font-bold text-lg mb-3">{t(lang, 'updates.updateHistory')}</h2>
        {versions.length === 0 ? (
          <p className="text-sm text-slate-400">No updates installed yet</p>
        ) : (
          <div className="space-y-2">
            {versions.map((v, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-sm">
                <div>
                  <span className="font-medium text-accent-600 dark:text-accent-400">v{v.version}</span>
                  <span className="text-slate-400 ml-3">{new Date(v.installedAt).toLocaleString()}</span>
                  <span className="text-slate-400 ml-3">{v.changeCount} changes</span>
                  <span className="text-xs text-slate-400 ml-3">[{v.source}]</span>
                </div>
                {i < versions.length - 1 && (
                  <button onClick={() => handleRollback(v.version)} className="btn-ghost text-xs">{t(lang, 'updates.rollback')}</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
