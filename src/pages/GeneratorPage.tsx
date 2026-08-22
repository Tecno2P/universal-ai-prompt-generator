import { useState, useEffect, useMemo, useCallback } from 'react'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { t } from '@/i18n'
import {
  generateOffline, transformPrompt,
} from '@/engine'
import { DEFAULT_SECTIONS, ALL_SECTIONS, SECTION_LABELS } from '@/engine/promptBuilder'
import { db, type GenerateHistoryEntry } from '@/database/db'
import { db as dbRepo } from '@/database/db'
import { seedDatabase } from '@/database/repository'
import type {
  GenerateParams, GenerateResult, PromptSectionKey, PromptStyle,
  Language, PromptTemplate, HinglishPattern, Category, SavedPrompt, ProviderConfig,
} from '@/types'
import { generateWithProvider } from '@/providers/manager'
import { SUPPORTED_LANGUAGES } from '@/i18n'

const STYLES: { value: PromptStyle; label: string }[] = [
  { value: 'simple', label: 'Simple' },
  { value: 'professional', label: 'Professional' },
  { value: 'expert', label: 'Expert' },
  { value: 'detailed', label: 'Detailed' },
  { value: 'technical', label: 'Technical' },
  { value: 'creative', label: 'Creative' },
  { value: 'structured', label: 'Structured' },
  { value: 'json', label: 'JSON-oriented' },
  { value: 'developer', label: 'Developer-oriented' },
  { value: 'agent', label: 'AI Agent' },
  { value: 'system', label: 'System Prompt' },
  { value: 'reasoning', label: 'Multi-step Reasoning' },
]

const ACTIONS = [
  { id: 'improve', label: 'Improve' },
  { id: 'expand', label: 'Expand' },
  { id: 'shorten', label: 'Shorten' },
  { id: 'simplify', label: 'Simplify' },
  { id: 'professional', label: 'Professional' },
  { id: 'technical', label: 'Technical' },
  { id: 'creative', label: 'Creative' },
  { id: 'addConstraints', label: 'Add Constraints' },
  { id: 'addExamples', label: 'Add Examples' },
  { id: 'toJSON', label: '→ JSON' },
  { id: 'toMarkdown', label: '→ Markdown' },
  { id: 'optimize', label: 'Optimize' },
]

export function GeneratorPage() {
  const { settings, hasAI, isOnline } = useApp()
  const { showToast } = useToast()

  const [input, setInput] = useState('')
  const [category, setCategory] = useState('')
  const [style, setStyle] = useState<PromptStyle>(settings.defaultStyle as PromptStyle || 'professional')
  const [outputLang, setOutputLang] = useState<Language>(settings.language)
  const [sections, setSections] = useState<Record<PromptSectionKey, boolean>>(DEFAULT_SECTIONS)
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [patterns, setPatterns] = useState<HinglishPattern[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [showSections, setShowSections] = useState(false)

  useEffect(() => {
    seedDatabase().then(async () => {
      setTemplates(await db.getAllTemplates())
      setPatterns(await db.getAllHinglishPatterns())
      setCategories(await db.getAllCategories())
      setProviders(await db.getAllProviders())
    })
  }, [])

  const lang = settings.uiLanguage

  const handleGenerate = useCallback(async () => {
    if (!input.trim()) {
      showToast('Please enter your idea first', 'warning')
      return
    }
    setLoading(true)
    try {
      const params: GenerateParams = {
        input, category, style, outputLanguage: outputLang, sections,
      }

      const offlineResult = generateOffline(params, { templates, hinglishPatterns: patterns })

      // Check if AI mode should be used
      const useAI = (settings.mode === 'ai' || settings.mode === 'hybrid' || settings.mode === 'auto') &&
        hasAI && isOnline && providers.length > 0

      if (useAI) {
        const provider = providers[0] // Use first configured provider
        try {
          const aiResult = await generateWithProvider(provider, {
            model: provider.model,
            systemInstruction: `You are an expert prompt engineer. Generate a high-quality, structured prompt based on the user's request. Output language: ${outputLang}.`,
            userPrompt: `User idea: ${input}\n\nCategory: ${offlineResult.detectedCategory}\nIntent: ${offlineResult.detectedIntent}\nStyle: ${style}\n\nGenerate a complete, detailed prompt. Return only the prompt text.`,
            temperature: 0.7,
            maxTokens: 3000,
          })
          setResult({
            ...offlineResult,
            prompt: aiResult.text,
            source: 'ai',
            tokensUsed: aiResult.tokensUsed,
            responseTimeMs: aiResult.responseTimeMs,
          })
          setOutput(aiResult.text)
        } catch (err) {
          // Fallback to offline on AI failure
          const msg = err instanceof Error ? err.message : 'AI request failed'
          showToast(`AI failed (${msg}), using offline result`, 'warning')
          setResult(offlineResult)
          setOutput(offlineResult.prompt)
        }
      } else {
        setResult(offlineResult)
        setOutput(offlineResult.prompt)
      }

      // Save to history
      const historyEntry: GenerateHistoryEntry = {
        id: `hist-${Date.now()}`,
        input,
        output: offlineResult.prompt,
        category: offlineResult.detectedCategory,
        language: offlineResult.detectedLanguage,
        style,
        source: offlineResult.source,
        createdAt: Date.now(),
      }
      await dbRepo.putHistory(historyEntry)
    } finally {
      setLoading(false)
    }
  }, [input, category, style, outputLang, sections, templates, patterns, settings.mode, hasAI, isOnline, providers, showToast])

  const handleAction = useCallback((action: string) => {
    if (!output) return
    const transformed = transformPrompt(output, action, outputLang)
    setOutput(transformed)
    showToast(`Action "${action}" applied`, 'success')
  }, [output, outputLang, showToast])

  const handleSave = useCallback(async () => {
    if (!output) return
    const prompt: SavedPrompt = {
      id: `saved-${Date.now()}`,
      title: input.slice(0, 50) || 'Untitled Prompt',
      content: output,
      category: result?.detectedCategory,
      language: outputLang,
      style,
      tags: [],
      favorite: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await db.putSavedPrompt(prompt)
    showToast('Prompt saved to library', 'success')
  }, [output, input, result, outputLang, style, showToast])

  const handleCopy = useCallback(async () => {
    if (!output) return
    try {
      await navigator.clipboard.writeText(output)
      showToast('Copied to clipboard', 'success')
    } catch {
      showToast('Failed to copy', 'error')
    }
  }, [output, showToast])

  const handleDownload = useCallback(() => {
    if (!output) return
    const blob = new Blob([output], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `prompt-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [output])

  const wordCount = useMemo(() => output.split(/\s+/).filter(Boolean).length, [output])
  const charCount = output.length
  const tokenEstimate = useMemo(() => Math.ceil(output.length / 4), [output])

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold mb-1">{t(lang, 'nav.generator')}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Transform your ideas into structured professional prompts</p>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Input panel */}
        <div className="space-y-4">
          <div>
            <label className="label-text">{t(lang, 'generator.enterIdea')}</label>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              rows={5}
              className="input-field resize-y"
              placeholder="e.g., Mere liye ek modern portfolio website bana jo phone pe bhi smooth chale"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-text">{t(lang, 'generator.category')}</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className="select-field">
                <option value="">Auto-detect</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-text">{t(lang, 'generator.style')}</label>
              <select value={style} onChange={e => setStyle(e.target.value as PromptStyle)} className="select-field">
                {STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label-text">{t(lang, 'generator.outputLanguage')}</label>
            <select value={outputLang} onChange={e => setOutputLang(e.target.value as Language)} className="select-field">
              {SUPPORTED_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name} ({l.nativeName})</option>)}
            </select>
          </div>

          {/* Sections toggle */}
          <div>
            <button onClick={() => setShowSections(!showSections)} className="flex items-center justify-between w-full label-text cursor-pointer">
              <span>{t(lang, 'generator.sections')}</span>
              <span className="text-xs">{showSections ? '▲' : '▼'}</span>
            </button>
            {showSections && (
              <div className="grid grid-cols-2 gap-2 mt-2 p-3 glass rounded-lg animate-slide-down">
                {ALL_SECTIONS.map(s => (
                  <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sections[s]}
                      onChange={() => setSections(prev => ({ ...prev, [s]: !prev[s] }))}
                      className="rounded"
                    />
                    {SECTION_LABELS[s]}
                  </label>
                ))}
              </div>
            )}
          </div>

          <button onClick={handleGenerate} disabled={loading} className="btn-primary w-full text-base py-3">
            {loading ? (
              <><span className="animate-spin">⟳</span> {t(lang, 'common.loading')}</>
            ) : (
              <>{t(lang, 'common.generate')} ✨</>
            )}
          </button>
        </div>

        {/* Output panel */}
        <div className="space-y-4">
          {result && (
            <div className="flex flex-wrap gap-2 text-xs animate-fade-in">
              <span className="badge-blue">{t(lang, 'generator.detectedLanguage')}: {result.detectedLanguage}</span>
              <span className="badge-purple">{t(lang, 'generator.detectedCategory')}: {result.detectedCategory}</span>
              <span className="badge-gray">{t(lang, 'generator.detectedIntent')}: {result.detectedIntent}</span>
              <span className={result.source === 'ai' ? 'badge-green' : 'badge-gray'}>
                {t(lang, 'generator.source')}: {result.source === 'ai' ? t(lang, 'generator.ai') : t(lang, 'generator.offline')}
              </span>
              {result.tokensUsed && <span className="badge-gray">Tokens: {result.tokensUsed}</span>}
              {result.responseTimeMs && <span className="badge-gray">{result.responseTimeMs}ms</span>}
            </div>
          )}

          <div className="relative">
            <textarea
              value={output}
              onChange={e => setOutput(e.target.value)}
              rows={16}
              className="input-field font-mono text-sm resize-y prompt-output"
              placeholder="Generated prompt will appear here..."
            />
            {output && (
              <div className="flex flex-wrap gap-2 mt-2 text-xs text-slate-500">
                <span>{t(lang, 'generator.wordCount')}: {wordCount}</span>
                <span>·</span>
                <span>{t(lang, 'generator.charCount')}: {charCount}</span>
                <span>·</span>
                <span>{t(lang, 'generator.tokenEstimate')}: ~{tokenEstimate}</span>
              </div>
            )}
          </div>

          {/* Action buttons */}
          {output && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <button onClick={handleCopy} className="btn-secondary text-sm">{t(lang, 'common.copy')}</button>
                <button onClick={handleSave} className="btn-primary text-sm">{t(lang, 'common.save')}</button>
                <button onClick={handleDownload} className="btn-ghost text-sm">{t(lang, 'common.download')}</button>
              </div>
              <div>
                <p className="label-text">{t(lang, 'generator.promptActions')}</p>
                <div className="flex flex-wrap gap-2">
                  {ACTIONS.map(a => (
                    <button key={a.id} onClick={() => handleAction(a.id)} className="btn-ghost text-xs px-2.5 py-1.5 border border-slate-200 dark:border-slate-700">
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
