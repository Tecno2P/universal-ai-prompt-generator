import { useState, useEffect, useMemo } from 'react'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { t } from '@/i18n'
import { db } from '@/database/db'
import { seedDatabase } from '@/database/repository'
import type { PromptTemplate, Category } from '@/types'

export function TemplatesPage() {
  const { settings } = useApp()
  const { showToast } = useToast()
  const lang = settings.uiLanguage
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [filterLang, setFilterLang] = useState('')

  useEffect(() => {
    seedDatabase().then(async () => {
      setTemplates(await db.getAllTemplates())
      setCategories(await db.getAllCategories())
    })
  }, [])

  const filtered = useMemo(() => {
    let result = templates
    if (search) {
      const lower = search.toLowerCase()
      result = result.filter(t =>
        t.title.toLowerCase().includes(lower) ||
        t.content.toLowerCase().includes(lower) ||
        t.tags.some(tag => tag.toLowerCase().includes(lower))
      )
    }
    if (filterCat) result = result.filter(t => t.category === filterCat)
    if (filterLang) result = result.filter(t => t.language === filterLang)
    return result
  }, [templates, search, filterCat, filterLang])

  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      showToast('Template copied', 'success')
    } catch {
      showToast('Failed to copy', 'error')
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl md:text-3xl font-bold mb-1">{t(lang, 'nav.templates')}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{templates.length} templates available offline</p>

      {/* Search & filters */}
      <div className="flex flex-col md:flex-row gap-3 mb-6">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t(lang, 'common.search')}
          className="input-field flex-1"
        />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="select-field md:w-48">
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterLang} onChange={e => setFilterLang(e.target.value)} className="select-field md:w-40">
          <option value="">All Languages</option>
          <option value="en">English</option>
          <option value="hinglish">Hinglish</option>
          <option value="hi">Hindi</option>
        </select>
      </div>

      {/* Template grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-lg">{t(lang, 'common.noResults')}</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((tmpl, i) => (
            <div key={tmpl.id} className="glass-card p-5 animate-slide-up" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-slate-800 dark:text-slate-200 line-clamp-1">{tmpl.title}</h3>
                <span className="badge-gray shrink-0 ml-2">{tmpl.style}</span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-3 mb-3">{tmpl.content.slice(0, 120)}...</p>
              <div className="flex flex-wrap gap-1 mb-3">
                {tmpl.tags.slice(0, 3).map(tag => <span key={tag} className="badge-blue text-[10px]">{tag}</span>)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{tmpl.category}</span>
                <button onClick={() => handleCopy(tmpl.content)} className="btn-ghost text-xs px-2 py-1">{t(lang, 'common.copy')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
