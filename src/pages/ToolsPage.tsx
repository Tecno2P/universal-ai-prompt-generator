import { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { t } from '@/i18n'
import { db } from '@/database/db'
import { analyzePrompt } from '@/engine/quality/score'
import { debugPrompt, applyAllOfflineFixes } from '@/engine/quality/debugger'
import { runTestLab, PRIVACY_WARNING } from '@/engine/quality/testLab'
import type { ProviderConfig } from '@/types'
import type { PromptQualityReport, PromptDebugReport, QualityGrade } from '@/engine/quality/types'
import type { TestLabResult } from '@/engine/quality/testLab'

type Tab = 'score' | 'debugger' | 'testlab'

const GRADE_COLORS: Readonly<Record<QualityGrade, string>> = {
  excellent: 'text-emerald-600 dark:text-emerald-400',
  good: 'text-green-600 dark:text-green-400',
  fair: 'text-amber-600 dark:text-amber-400',
  poor: 'text-red-600 dark:text-red-400',
  empty: 'text-slate-400',
}

const SEVERITY_BADGE: Readonly<Record<'high' | 'medium' | 'low', string>> = {
  high: 'badge bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  medium: 'badge bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  low: 'badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}

function scoreBarColor(score: number): string {
  if (score >= 85) return 'bg-emerald-500'
  if (score >= 70) return 'bg-green-500'
  if (score >= 50) return 'bg-amber-500'
  return 'bg-red-500'
}

export function ToolsPage() {
  const { settings, hasAI } = useApp()
  const { showToast } = useToast()
  const lang = settings.uiLanguage

  const [tab, setTab] = useState<Tab>('score')
  const [prompt, setPrompt] = useState('')
  const [scoreReport, setScoreReport] = useState<PromptQualityReport | null>(null)
  const [debugReport, setDebugReport] = useState<PromptDebugReport | null>(null)
  const [testResults, setTestResults] = useState<TestLabResult[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([])
  const [privacyAck, setPrivacyAck] = useState(false)
  const [loading, setLoading] = useState(false)

  const reloadProviders = useCallback(async () => {
    const list = await db.getAllProviders()
    setProviders(list)
  }, [])

  useEffect(() => { reloadProviders() }, [reloadProviders])

  const handleAnalyze = useCallback(() => {
    if (!prompt.trim()) { showToast('Enter a prompt to analyze', 'warning'); return }
    setLoading(true)
    try {
      setScoreReport(analyzePrompt(prompt))
      showToast('Quality analysis complete', 'success')
    } catch (err) {
      showToast('Analysis failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    } finally {
      setLoading(false)
    }
  }, [prompt, showToast])

  const handleDebug = useCallback(() => {
    if (!prompt.trim()) { showToast('Enter a prompt to debug', 'warning'); return }
    setLoading(true)
    try {
      setDebugReport(debugPrompt(prompt))
      showToast('Debug scan complete', 'success')
    } catch (err) {
      showToast('Debug failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    } finally {
      setLoading(false)
    }
  }, [prompt, showToast])

  const handleApplyFixes = useCallback(() => {
    if (!prompt.trim()) { showToast('Enter a prompt to fix', 'warning'); return }
    setLoading(true)
    try {
      const result = applyAllOfflineFixes(prompt)
      if (result.changed) {
        setPrompt(result.prompt)
        setDebugReport(debugPrompt(result.prompt))
        showToast(`Applied ${result.applied.length} fix(es)`, 'success')
      } else {
        showToast('No auto-fixable issues found', 'info')
      }
    } catch (err) {
      showToast('Fix failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    } finally {
      setLoading(false)
    }
  }, [prompt, showToast])

  const handleTestLab = useCallback(async () => {
    if (!prompt.trim()) { showToast('Enter a prompt to test', 'warning'); return }
    if (!privacyAck) { showToast('Acknowledge the privacy warning first', 'warning'); return }
    if (selectedProviderIds.length === 0) { showToast('Select at least one provider', 'warning'); return }
    setLoading(true)
    try {
      const results = await runTestLab(prompt, providers, {
        selectedProviderIds,
        privacyAcknowledged: privacyAck,
      })
      setTestResults(results)
      showToast(`Tested ${results.length} provider(s)`, 'success')
    } catch (err) {
      showToast('Test lab failed: ' + (err instanceof Error ? err.message : 'unknown'), 'error')
    } finally {
      setLoading(false)
    }
  }, [prompt, providers, selectedProviderIds, privacyAck, showToast])

  const toggleProvider = (id: string) => {
    setSelectedProviderIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id],
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold mb-1 text-slate-800 dark:text-slate-200">Tools</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Quality scoring, prompt debugging, and provider comparison</p>

      {/* Tabs */}
      <div className="glass-card p-5 mb-6">
        <div className="flex flex-wrap gap-2 mb-4">
          {([
            { id: 'score', label: 'Quality Score' },
            { id: 'debugger', label: 'Debugger' },
            { id: 'testlab', label: 'Test Lab' },
          ] as ReadonlyArray<{ id: Tab; label: string }>).map(tb => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === tb.id
                  ? 'bg-accent-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>

        {/* Shared input */}
        <label className="label-text">Prompt</label>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          className="input-field min-h-[120px] resize-y font-mono text-sm"
          placeholder="Paste the prompt you want to analyze, debug, or test…"
        />

        {tab === 'score' && (
          <div className="flex flex-wrap gap-2 mt-3">
            <button onClick={handleAnalyze} disabled={loading} className="btn-primary text-sm">
              {loading ? '...' : 'Analyze Quality'}
            </button>
          </div>
        )}

        {tab === 'debugger' && (
          <div className="flex flex-wrap gap-2 mt-3">
            <button onClick={handleDebug} disabled={loading} className="btn-primary text-sm">
              {loading ? '...' : 'Debug Prompt'}
            </button>
            <button onClick={handleApplyFixes} disabled={loading} className="btn-secondary text-sm">
              Apply All Fixes
            </button>
          </div>
        )}

        {tab === 'testlab' && (
          <div className="mt-3 space-y-3">
            {providers.length === 0 ? (
              <p className="text-sm text-amber-500">No AI providers configured. Add one in Settings first.</p>
            ) : (
              <div>
                <label className="label-text">Providers to test</label>
                <div className="flex flex-wrap gap-2">
                  {providers.map(p => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 text-sm cursor-pointer px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedProviderIds.includes(p.id)}
                        onChange={() => toggleProvider(p.id)}
                      />
                      <span className="text-slate-800 dark:text-slate-200">{p.name}</span>
                      <span className="text-xs text-slate-400">{p.model}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <label className="flex items-start gap-2 text-sm cursor-pointer p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
              <input
                type="checkbox"
                checked={privacyAck}
                onChange={e => setPrivacyAck(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-amber-600 dark:text-amber-400">{PRIVACY_WARNING}</span>
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleTestLab}
                disabled={loading || !hasAI}
                className="btn-primary text-sm"
              >
                {loading ? '...' : 'Run Test Lab'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quality Score results */}
      {tab === 'score' && scoreReport && (
        <div className="glass-card p-5 mb-6 animate-scale-in">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="font-bold text-lg text-slate-800 dark:text-slate-200">Quality Report</h2>
            <span className={`text-3xl font-bold ${GRADE_COLORS[scoreReport.grade]}`}>
              {scoreReport.overallScore}
              <span className="text-sm font-normal text-slate-400 ml-1">/ 100</span>
            </span>
          </div>
          <p className="text-xs text-slate-400 mb-4 capitalize">{scoreReport.grade} · {scoreReport.method}</p>

          {/* Category breakdown bars */}
          <div className="space-y-3 mb-6">
            {scoreReport.subScores.map(sub => (
              <div key={sub.id}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">{sub.label}</span>
                  <span className="text-slate-400">{sub.score}</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${scoreBarColor(sub.score)}`}
                    style={{ width: `${sub.score}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">{sub.detail}</p>
              </div>
            ))}
          </div>

          {scoreReport.issues.length > 0 && (
            <div className="mb-5">
              <h3 className="font-semibold text-sm mb-2 text-slate-800 dark:text-slate-200">Issues</h3>
              <div className="space-y-2">
                {scoreReport.issues.map((issue, i) => (
                  <div key={i} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-sm">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="badge badge-gray text-[10px]">{issue.category}</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">{issue.title}</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{issue.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {scoreReport.suggestions.length > 0 && (
            <div>
              <h3 className="font-semibold text-sm mb-2 text-slate-800 dark:text-slate-200">Suggestions</h3>
              <div className="space-y-2">
                {scoreReport.suggestions.map((sug, i) => (
                  <div key={i} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-sm">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="badge badge-blue text-[10px]">{sug.category}</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">{sug.title}</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{sug.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Debugger results */}
      {tab === 'debugger' && debugReport && (
        <div className="glass-card p-5 mb-6 animate-scale-in">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="font-bold text-lg text-slate-800 dark:text-slate-200">Debug Report</h2>
            <span className="text-sm text-slate-400">{debugReport.summary}</span>
          </div>

          {debugReport.issues.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">No issues detected. Your prompt looks clean.</p>
          ) : (
            <div className="space-y-2">
              {debugReport.issues.map((issue, i) => (
                <div key={i} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-sm">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-[10px] ${SEVERITY_BADGE[issue.severity]}`}>{issue.severity}</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">{issue.label}</span>
                    {issue.fixable && <span className="badge badge-green text-[10px]">fixable</span>}
                    {issue.evidence && (
                      <code className="text-[10px] text-slate-400 font-mono">{issue.evidence}</code>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{issue.description}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-medium">Fix:</span> {issue.suggestedFix}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Test Lab results */}
      {tab === 'testlab' && testResults.length > 0 && (
        <div className="glass-card p-5 mb-6 animate-scale-in">
          <h2 className="font-bold text-lg mb-4 text-slate-800 dark:text-slate-200">Comparison</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2 pr-3">Provider</th>
                  <th className="py-2 pr-3">Model</th>
                  <th className="py-2 pr-3">Response Time</th>
                  <th className="py-2 pr-3">Tokens</th>
                  <th className="py-2 pr-3">Quality</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {testResults.map(r => (
                  <tr key={r.providerConfigId} className="border-b border-slate-100 dark:border-slate-800/50">
                    <td className="py-2 pr-3 font-medium text-slate-800 dark:text-slate-200">{r.providerName}</td>
                    <td className="py-2 pr-3 text-slate-500 dark:text-slate-400">{r.model}</td>
                    <td className="py-2 pr-3 text-slate-500 dark:text-slate-400">{r.responseTimeMs} ms</td>
                    <td className="py-2 pr-3 text-slate-500 dark:text-slate-400">{r.tokensUsed ?? '—'}</td>
                    <td className="py-2 pr-3">
                      {r.qualityEstimate ? (
                        <span className="font-medium text-slate-800 dark:text-slate-200">{r.qualityEstimate.overallScore}/100</span>
                      ) : '—'}
                    </td>
                    <td className="py-2">
                      {r.error ? (
                        <span className="badge bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 text-[10px]">error</span>
                      ) : (
                        <span className="badge badge-green text-[10px]">ok</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 space-y-2">
            {testResults.map(r => (
              r.error ? (
                <div key={`detail-${r.providerConfigId}`} className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-xs text-red-600 dark:text-red-400">
                  <span className="font-medium">{r.providerName}:</span> {r.error}
                </div>
              ) : r.responseText && (
                <div key={`detail-${r.providerConfigId}`} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                  <p className="text-xs font-medium mb-1 text-slate-700 dark:text-slate-300">{r.providerName} · {r.model}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-4 whitespace-pre-wrap">{r.responseText.slice(0, 400)}{r.responseText.length > 400 ? '…' : ''}</p>
                </div>
              )
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
