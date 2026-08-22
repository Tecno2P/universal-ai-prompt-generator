import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { t } from '@/i18n'
import { db } from '@/database/db'
import { seedDatabase } from '@/database/repository'
import type { ProviderConfig } from '@/types'
import { PROVIDER_REGISTRY } from '@/providers/registry'
import { testProviderConnection, generateWithProvider, streamWithProvider } from '@/providers/manager'
import { ProviderError } from '@/providers/interface'

export function PlaygroundPage() {
  const { settings } = useApp()
  const { showToast } = useToast()
  const lang = settings.uiLanguage
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [model, setModel] = useState('')
  const [systemInstruction, setSystemInstruction] = useState('')
  const [userPrompt, setUserPrompt] = useState('')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2000)
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [responseInfo, setResponseInfo] = useState<{ time?: number; tokens?: number }>({})
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    seedDatabase().then(async () => {
      const ps = await db.getAllProviders()
      setProviders(ps)
      if (ps.length > 0) {
        setSelectedId(ps[0].id)
        setModel(ps[0].model)
      }
    })
  }, [])

  const selectedProvider = providers.find(p => p.id === selectedId)

  const handleTest = useCallback(async () => {
    if (!selectedProvider) return
    setLoading(true)
    try {
      const ok = await testProviderConnection(selectedProvider)
      showToast(ok ? 'Connection successful!' : 'Connection failed', ok ? 'success' : 'error')
    } finally {
      setLoading(false)
    }
  }, [selectedProvider, showToast])

  const handleGenerate = useCallback(async () => {
    if (!selectedProvider) {
      showToast('Add a provider in Settings first', 'warning')
      return
    }
    if (!userPrompt.trim()) {
      showToast('Enter a prompt', 'warning')
      return
    }
    setLoading(true)
    setOutput('')
    setResponseInfo({})
    try {
      const result = await generateWithProvider(selectedProvider, {
        model: model || selectedProvider.model,
        systemInstruction: systemInstruction || undefined,
        userPrompt,
        temperature,
        maxTokens,
      })
      setOutput(result.text)
      setResponseInfo({ time: result.responseTimeMs, tokens: result.tokensUsed })
    } catch (err) {
      const msg = err instanceof ProviderError ? err.message :
        err instanceof Error ? err.message : 'Generation failed'
      showToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }, [selectedProvider, model, systemInstruction, userPrompt, temperature, maxTokens, showToast])

  const handleStream = useCallback(async () => {
    if (!selectedProvider) {
      showToast('Add a provider in Settings first', 'warning')
      return
    }
    if (!userPrompt.trim()) {
      showToast('Enter a prompt', 'warning')
      return
    }
    setStreaming(true)
    setOutput('')
    setResponseInfo({})
    try {
      const stream = await streamWithProvider(selectedProvider, {
        model: model || selectedProvider.model,
        systemInstruction: systemInstruction || undefined,
        userPrompt,
        temperature,
        maxTokens,
        stream: true,
      })
      for await (const chunk of stream) {
        setOutput(prev => prev + chunk)
      }
    } catch (err) {
      const msg = err instanceof ProviderError ? err.message :
        err instanceof Error ? err.message : 'Streaming failed'
      showToast(msg, 'error')
    } finally {
      setStreaming(false)
    }
  }, [selectedProvider, model, systemInstruction, userPrompt, temperature, maxTokens, showToast])

  const handleClear = () => {
    setOutput('')
    setUserPrompt('')
    setResponseInfo({})
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold mb-1">{t(lang, 'nav.playground')}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Test AI providers directly with custom parameters</p>

      {providers.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="text-slate-500 mb-4">No providers configured yet.</p>
          <a href="#/settings" className="btn-primary">Go to Settings to add a provider</a>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Input */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-text">{t(lang, 'providers.provider')}</label>
                <select value={selectedId} onChange={e => {
                  setSelectedId(e.target.value)
                  const p = providers.find(p => p.id === e.target.value)
                  if (p) setModel(p.model)
                }} className="select-field">
                  {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label-text">{t(lang, 'providers.model')}</label>
                <select value={model} onChange={e => setModel(e.target.value)} className="select-field">
                  {selectedProvider && (() => {
                    const reg = PROVIDER_REGISTRY.find(r => r.id === selectedProvider.providerId)
                    return reg?.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>) || null
                  })()}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-text">Temperature: {temperature.toFixed(1)}</label>
                <input type="range" min={0} max={2} step={0.1} value={temperature} onChange={e => setTemperature(Number(e.target.value))} className="w-full" />
              </div>
              <div>
                <label className="label-text">Max Tokens</label>
                <input type="number" value={maxTokens} onChange={e => setMaxTokens(Number(e.target.value))} className="input-field" />
              </div>
            </div>

            <div>
              <label className="label-text">System Instruction</label>
              <textarea value={systemInstruction} onChange={e => setSystemInstruction(e.target.value)} rows={3} className="input-field resize-y" placeholder="You are a helpful assistant..." />
            </div>

            <div>
              <label className="label-text">User Prompt</label>
              <textarea value={userPrompt} onChange={e => setUserPrompt(e.target.value)} rows={6} className="input-field resize-y" placeholder="Enter your prompt..." />
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={handleTest} disabled={loading} className="btn-secondary text-sm">{t(lang, 'common.testConnection')}</button>
              <button onClick={handleGenerate} disabled={loading || streaming} className="btn-primary text-sm">{loading ? '...' : t(lang, 'common.generate')}</button>
              <button onClick={handleStream} disabled={loading || streaming} className="btn-secondary text-sm">{streaming ? 'Streaming...' : 'Stream'}</button>
              <button onClick={handleClear} className="btn-ghost text-sm">{t(lang, 'common.clear')}</button>
            </div>
          </div>

          {/* Output */}
          <div className="space-y-4">
            {Object.keys(responseInfo).length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs">
                {responseInfo.time && <span className="badge-gray">{responseInfo.time}ms</span>}
                {responseInfo.tokens && <span className="badge-blue">{responseInfo.tokens} tokens</span>}
              </div>
            )}
            <textarea
              value={output}
              onChange={e => setOutput(e.target.value)}
              rows={18}
              className="input-field font-mono text-sm resize-y"
              placeholder="AI response will appear here..."
            />
            {output && (
              <button onClick={() => navigator.clipboard.writeText(output)} className="btn-ghost text-sm">{t(lang, 'common.copy')}</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
