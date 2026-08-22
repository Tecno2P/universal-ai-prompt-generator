import { Link } from 'react-router-dom'
import { useApp } from '@/context/AppContext'
import { t } from '@/i18n'
import { useEffect, useState } from 'react'
import { db } from '@/database/db'
import { getCurrentVersion } from '@/database/repository'

export function HomePage() {
  const { settings } = useApp()
  const [stats, setStats] = useState({ templates: 0, savedPrompts: 0, categories: 0, hinglish: 0 })
  const [version, setVersion] = useState('1.0.0')

  useEffect(() => {
    db.counts().then(setStats)
    getCurrentVersion().then(setVersion)
  }, [])

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      {/* Hero */}
      <section className="text-center py-12 md:py-20 animate-fade-in">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-50 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400 text-xs font-medium mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse-soft" />
          {t(settings.uiLanguage, 'tagline')}
        </div>
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-4">
          <span className="bg-gradient-to-r from-accent-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
            {t(settings.uiLanguage, 'appName')}
          </span>
        </h1>
        <p className="text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto mb-8">
          {t(settings.uiLanguage, 'tagline')}. Generate high-quality prompts offline or enhance them
          with your own AI API keys. Hinglish-ready, multilingual, privacy-first.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link to="/generator" className="btn-primary text-base px-6 py-3">
            {t(settings.uiLanguage, 'common.generate')} →
          </Link>
          <Link to="/templates" className="btn-secondary text-base px-6 py-3">
            {t(settings.uiLanguage, 'nav.templates')}
          </Link>
          <Link to="/playground" className="btn-ghost text-base px-6 py-3">
            {t(settings.uiLanguage, 'nav.playground')}
          </Link>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
        {[
          { label: t(settings.uiLanguage, 'updates.offlineDatabase'), value: stats.templates, suffix: ' Templates' },
          { label: t(settings.uiLanguage, 'settings.offlineDatabase').replace('Offline ', ''), value: stats.categories, suffix: ' Categories' },
          { label: t(settings.uiLanguage, 'nav.library'), value: stats.savedPrompts, suffix: ' Saved' },
          { label: t(settings.uiLanguage, 'updates.currentVersion'), value: version, suffix: '' },
        ].map((s, i) => (
          <div key={i} className="glass-card p-5 text-center animate-slide-up" style={{ animationDelay: `${i * 80}ms` }}>
            <div className="text-2xl font-bold text-accent-600 dark:text-accent-400">{s.value}</div>
            <div className="text-xs text-slate-500 dark:text-slate-500 mt-1">{s.label}{s.suffix}</div>
          </div>
        ))}
      </section>

      {/* Features */}
      <section className="grid md:grid-cols-3 gap-6">
        {[
          { icon: '🔒', title: t(settings.uiLanguage, 'about.privacyFirst'), desc: 'No accounts, no tracking. API keys stay in your browser.' },
          { icon: '⚡', title: t(settings.uiLanguage, 'about.offlineCapable'), desc: 'Full prompt generation works without internet or API keys.' },
          { icon: '🤖', title: t(settings.uiLanguage, 'about.multiProvider'), desc: '13+ AI providers: OpenAI, Gemini, Claude, Groq, Mistral, DeepSeek, and more.' },
          { icon: '🌐', title: t(settings.uiLanguage, 'about.hinglish'), desc: 'First-class Hinglish detection. Roman Hindi, Devanagari, mixed text — all understood.' },
          { icon: '💾', title: 'Local Database', desc: 'IndexedDB-powered prompt library with AI update system and rollback.' },
          { icon: '📱', title: t(settings.uiLanguage, 'about.pwa'), desc: 'Installable PWA with offline support and service worker caching.' },
        ].map((f, i) => (
          <div key={i} className="glass-card p-6 animate-slide-up" style={{ animationDelay: `${i * 80}ms` }}>
            <div className="text-3xl mb-3">{f.icon}</div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-1">{f.title}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{f.desc}</p>
          </div>
        ))}
      </section>
    </div>
  )
}
