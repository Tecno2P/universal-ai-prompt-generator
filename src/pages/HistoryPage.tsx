import { useState, useEffect } from 'react'
import { useApp } from '@/context/AppContext'
import { t } from '@/i18n'
import { db, type GenerateHistoryEntry } from '@/database/db'

export function HistoryPage() {
  const { settings } = useApp()
  const lang = settings.uiLanguage
  const [history, setHistory] = useState<GenerateHistoryEntry[]>([])

  useEffect(() => {
    db.getAllHistory().then(h => setHistory(h.sort((a, b) => b.createdAt - a.createdAt)))
  }, [])

  const handleClear = async () => {
    const { clearStore, STORES } = await import('@/database/db')
    await clearStore(STORES.history)
    setHistory([])
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl md:text-3xl font-bold">{t(lang, 'nav.history')}</h1>
        {history.length > 0 && <button onClick={handleClear} className="btn-ghost text-sm text-red-500">{t(lang, 'common.clear')}</button>
        }
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{history.length} generations</p>

      {history.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-lg">{t(lang, 'common.noResults')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((h, i) => (
            <div key={h.id} className="glass-card p-4 animate-slide-up" style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
              <div className="flex items-start justify-between mb-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 line-clamp-1">{h.input}</p>
                <div className="flex gap-1 shrink-0 ml-2">
                  <span className={`badge ${h.source === 'ai' ? 'badge-green' : 'badge-gray'} text-[10px]`}>{h.source}</span>
                  <span className="badge-gray text-[10px]">{h.language}</span>
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{h.output.slice(0, 200)}...</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-slate-400">{new Date(h.createdAt).toLocaleString()}</span>
                <button onClick={() => navigator.clipboard.writeText(h.output)} className="btn-ghost text-xs">{t(lang, 'common.copy')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
