import { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { t } from '@/i18n'
import { db } from '@/database/db'
import {
  createSandbox,
  applyToSandbox,
  validateSandbox,
  generateDiff,
  installFromSandbox,
  discardSandbox,
  getSandbox,
} from '@/database/sandbox'
import type { SandboxHandle, SandboxValidationResult, SandboxDiff } from '@/database/sandboxTypes'
import { buildUpdateRequestPrompt, incrementVersion, validateUpdatePackage } from '@/updates/updateSystem'
import { generateWithProvider } from '@/providers/manager'
import { normalizeAIResponse } from '@/providers/normalizeResponse'
import { ProviderError } from '@/providers/interface'
import type { ProviderConfig, PromptTemplate, UpdateChange } from '@/types'

const CHECK_ICONS: Readonly<Record<'pass' | 'fail' | 'warn', string>> = {
  pass: '✓',
  fail: '✗',
  warn: '⚠',
}

const CHECK_COLORS: Readonly<Record<'pass' | 'fail' | 'warn', string>> = {
  pass: 'text-emerald-600 dark:text-emerald-400',
  fail: 'text-red-600 dark:text-red-400',
  warn: 'text-amber-600 dark:text-amber-400',
}

export function SandboxPage() {
  const { settings, hasAI } = useApp()
  const { showToast } = useToast()
  const lang = settings.uiLanguage

  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [version, setVersion] = useState('1.0.0')
  const [handle, setHandle] = useState<SandboxHandle | null>(null)
  const [validation, setValidation] = useState<SandboxValidationResult | null>(null)
  const [diff, setDiff] = useState<SandboxDiff | null>(null)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)

  const reload = useCallback(async () => {
    const [p, tpls, versions] = await Promise.all([
      db.getAllProviders(),
      db.getAllTemplates(),
      db.getAllVersions(),
    ])
    setProviders(p)
    setTemplates(tpls)
    if (versions.length > 0) {
      setVersion(versions.sort((a, b) => b.installedAt - a.installedAt)[0].version)
    }
    setHandle(getSandbox())
  }, [])

  useEffect(() => { reload() }, [reload])

  const handleFetchUpdate = useCallback(async () => {
    if (!hasAI || providers.length === 0) {
      showToast(t(lang, 'updates.requireAI'), 'warning')
      return
    }
    setChecking(true)
    try {
      const provider = providers[0]
      const categories = Array.from(new Set(templates.map(tpl => tpl.category)))
      const languages = Array.from(new Set(templates.map(tpl => tpl.language)))
      const prompt = buildUpdateRequestPrompt(version, templates.length, categories, languages)

      const result = await generateWithProvider(provider, {
        model: provider.model,
        systemInstruction: 'You are a JSON API. Return ONLY valid JSON. No reasoning, no explanation, no markdown. Start your response with { and end with }.',
        userPrompt: prompt,
        temperature: 0.3,
        maxTokens: 4000,
        jsonMode: true,
      })

      let parsed: unknown
      try {
        const normalized = normalizeAIResponse(result.text)
        parsed = JSON.parse(normalized.cleaned)
      } catch (parseErr) {
        const errMsg = parseErr instanceof Error ? parseErr.message : 'Unknown parsing error'
        showToast(`Could not parse AI response: ${errMsg}`, 'error')
        return
      }

      const validation = validateUpdatePackage(parsed)
      if (!validation.valid || validation.changes.length === 0) {
        showToast(validation.errors[0] || t(lang, 'updates.noUpdates'), validation.valid ? 'info' : 'error')
        return
      }

      const proposedVersion = incrementVersion(version)
      await createSandbox(proposedVersion)
      const changes = validation.changes as UpdateChange[]
      await applyToSandbox(changes)
      const result2 = await validateSandbox()
      const diffResult = await generateDiff()
      setHandle(getSandbox())
      setValidation(result2)
      setDiff(diffResult)
      showToast(`Sandbox ready: ${changes.length} change(s) to review`, 'success')
    } catch (err) {
      const msg = err instanceof ProviderError ? err.message :
        err instanceof Error ? err.message : 'Sandbox update failed'
      showToast(msg, 'error')
    } finally {
      setChecking(false)
    }
  }, [hasAI, providers, templates, version, lang, showToast])

  const handleCreateBlank = useCallback(async () => {
    setLoading(true)
    try {
      const h = await createSandbox(version)
      setHandle(h)
      const v = await validateSandbox()
      const d = await generateDiff()
      setValidation(v)
      setDiff(d)
      showToast('Sandbox created from current database', 'success')
    } catch (err) {
      showToast('Create failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    } finally {
      setLoading(false)
    }
  }, [version, showToast])

  const handleInstall = useCallback(async () => {
    setLoading(true)
    try {
      const result = await installFromSandbox()
      showToast(`Installed ${result.installed} records (v${result.version})`, 'success')
      setHandle(null)
      setValidation(null)
      setDiff(null)
      await reload()
    } catch (err) {
      showToast('Install failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    } finally {
      setLoading(false)
    }
  }, [reload, showToast])

  const handleDiscard = useCallback(async () => {
    setLoading(true)
    try {
      await discardSandbox()
      setHandle(null)
      setValidation(null)
      setDiff(null)
      showToast('Sandbox discarded — production untouched', 'info')
    } catch (err) {
      showToast('Discard failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  const isActive = handle !== null

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold mb-1 text-slate-800 dark:text-slate-200">AI Update Sandbox</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Test AI-generated database updates in isolation before touching production</p>

      {/* Sandbox state */}
      <div className="glass-card p-5 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Sandbox State</p>
            <p className="text-lg font-bold flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              <span className={isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}>
                {isActive ? (handle.state.status) : 'Inactive'}
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Base Version</p>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-200">{handle?.state.baseVersion ?? version}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Proposed Version</p>
            <p className="text-lg font-bold text-accent-600 dark:text-accent-400">{handle?.state.proposedVersion ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Templates</p>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-200">{templates.length}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={handleFetchUpdate} disabled={checking || !hasAI} className="btn-primary text-sm">
            {checking ? '...' : 'Fetch AI Update'}
          </button>
          <button onClick={handleCreateBlank} disabled={loading} className="btn-secondary text-sm">
            Create Sandbox
          </button>
          {!hasAI && <p className="text-xs text-amber-500 self-center">{t(lang, 'updates.requireAI')}</p>}
        </div>
      </div>

      {/* Validation results */}
      {validation && (
        <div className="glass-card p-5 mb-6 animate-scale-in">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="font-bold text-lg text-slate-800 dark:text-slate-200">Validation</h2>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">Score: {validation.score}/100</span>
              {validation.valid ? (
                <span className="badge badge-green text-xs">valid</span>
              ) : (
                <span className="badge bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-xs">errors</span>
              )}
            </div>
          </div>

          <div className="space-y-2 mb-4">
            {validation.checks.map(c => (
              <div key={c.id} className="flex items-start gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-sm">
                <span className={`text-lg leading-none ${CHECK_COLORS[c.status]}`}>{CHECK_ICONS[c.status]}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{c.label}</span>
                    {c.status === 'warn' && <span className="badge badge-gray text-[10px]">warn</span>}
                    {c.status === 'fail' && <span className="badge bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-[10px]">fail</span>}
                  </div>
                  {c.detail && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{c.detail}</p>}
                </div>
              </div>
            ))}
          </div>

          {validation.errors.length > 0 && (
            <div className="mb-3 text-xs text-red-600 dark:text-red-400 space-y-1">
              {validation.errors.map((e, i) => <p key={i}>✗ {e}</p>)}
            </div>
          )}
          {validation.warnings.length > 0 && (
            <div className="mb-3 text-xs text-amber-600 dark:text-amber-400 space-y-1">
              {validation.warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
            </div>
          )}
        </div>
      )}

      {/* Diff summary */}
      {diff && (
        <div className="glass-card p-5 mb-6 animate-scale-in">
          <h2 className="font-bold text-lg mb-4 text-slate-800 dark:text-slate-200">Diff Summary</h2>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg text-center">
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">+{diff.summary.added}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">added</p>
            </div>
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center">
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">~{diff.summary.modified}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">modified</p>
            </div>
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-center">
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">−{diff.summary.deleted}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">deleted</p>
            </div>
          </div>

          {diff.entries.length > 0 && (
            <div className="max-h-64 overflow-y-auto space-y-2 mb-4">
              {diff.entries.map((e, i) => (
                <div key={i} className="flex items-start gap-2 p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-sm">
                  <span className={`badge shrink-0 text-[10px] ${
                    e.kind === 'added' ? 'badge-green' :
                    e.kind === 'modified' ? 'badge-blue' : 'badge bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                  }`}>{e.kind}</span>
                  <div className="min-w-0">
                    <span className="text-slate-800 dark:text-slate-200">{e.label}</span>
                    <span className="text-xs text-slate-400 ml-2">({e.collection})</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleInstall}
              disabled={loading || (validation != null && !validation.valid)}
              className="btn-primary text-sm"
            >
              Install
            </button>
            <button onClick={handleDiscard} disabled={loading} className="btn-secondary text-sm">
              Discard
            </button>
          </div>
          {validation != null && !validation.valid && (
            <p className="text-xs text-amber-500 mt-2">Resolve validation errors before installing.</p>
          )}
        </div>
      )}
    </div>
  )
}
