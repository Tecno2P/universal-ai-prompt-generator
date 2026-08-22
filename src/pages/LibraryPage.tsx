import { useState, useEffect, useMemo } from 'react'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { t } from '@/i18n'
import { db } from '@/database/db'
import type { SavedPrompt } from '@/types'

export function LibraryPage() {
  const { settings } = useApp()
  const { showToast } = useToast()
  const lang = settings.uiLanguage
  const [prompts, setPrompts] = useState<SavedPrompt[]>([])
  const [search, setSearch] = useState('')
  const [filterFav, setFilterFav] = useState(false)

  const reload = async () => setPrompts(await db.getAllSavedPrompts())
  useEffect(() => { reload() }, [])

  const filtered = useMemo(() => {
    let result = prompts
    if (filterFav) result = result.filter(p => p.favorite)
    if (search) {
      const lower = search.toLowerCase()
      result = result.filter(p =>
        p.title.toLowerCase().includes(lower) ||
        p.content.toLowerCase().includes(lower) ||
        p.tags.some(tag => tag.toLowerCase().includes(lower))
      )
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt)
  }, [prompts, search, filterFav])

  const handleToggleFav = async (p: SavedPrompt) => {
    await db.putSavedPrompt({ ...p, favorite: !p.favorite })
    await reload()
  }

  const handleDelete = async (id: string) => {
    await db.deleteSavedPrompt(id)
    await reload()
    showToast('Prompt deleted', 'success')
  }

  const handleExport = () => {
    const json = JSON.stringify(filtered, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `prompts-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!Array.isArray(data)) throw new Error('Invalid format')
      for (const p of data) {
        if (p.id && p.content) {
          await db.putSavedPrompt({ ...p, id: `imported-${p.id}-${Date.now()}` })
        }
      }
      await reload()
      showToast(`Imported ${data.length} prompts`, 'success')
    } catch {
      showToast('Import failed — invalid file', 'error')
    }
    e.target.value = ''
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl md:text-3xl font-bold">{t(lang, 'nav.library')}</h1>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-ghost text-sm">{t(lang, 'common.export')}</button>
          <label className="btn-ghost text-sm cursor-pointer">
            {t(lang, 'common.import')}
            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
          </label>
        </div>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{prompts.length} saved prompts</p>

      <div className="flex flex-col md:flex-row gap-3 mb-6">
        <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t(lang, 'common.search')} className="input-field flex-1" />
        <button onClick={() => setFilterFav(!filterFav)} className={filterFav ? 'btn-primary text-sm' : 'btn-secondary text-sm'}>
          ★ {t(lang, 'common.favorite')}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-lg">{t(lang, 'common.noResults')}</p>
          <p className="text-sm mt-2">Generate and save prompts from the Generator</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {filtered.map((p, i) => (
            <div key={p.id} className="glass-card p-5 animate-slide-up" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-slate-800 dark:text-slate-200 line-clamp-1">{p.title}</h3>
                <button onClick={() => handleToggleFav(p)} className="text-lg shrink-0 ml-2" aria-label="Favorite">
                  {p.favorite ? '★' : '☆'}
                </button>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-3 mb-3">{p.content.slice(0, 150)}...</p>
              <div className="flex flex-wrap gap-1 mb-3">
                {p.tags.slice(0, 3).map(tag => <span key={tag} className="badge-gray text-[10px]">{tag}</span>)}
                <span className="badge-blue text-[10px]">{p.language}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{new Date(p.updatedAt).toLocaleDateString()}</span>
                <div className="flex gap-2">
                  <button onClick={() => navigator.clipboard.writeText(p.content)} className="btn-ghost text-xs">{t(lang, 'common.copy')}</button>
                  <button onClick={() => handleDelete(p.id)} className="btn-ghost text-xs text-red-500">{t(lang, 'common.delete')}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
