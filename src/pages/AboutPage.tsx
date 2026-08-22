import { useApp } from '@/context/AppContext'
import { t } from '@/i18n'
import { PROVIDER_REGISTRY } from '@/providers/registry'

export function AboutPage() {
  const { settings } = useApp()
  const lang = settings.uiLanguage

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">{t(lang, 'about.title')}</h1>
      <p className="text-slate-600 dark:text-slate-400 mb-8">{t(lang, 'about.description')}</p>

      <div className="space-y-6">
        <section className="glass-card p-6">
          <h2 className="font-bold text-lg mb-4">{t(lang, 'about.features')}</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { icon: '🔒', title: t(lang, 'about.privacyFirst'), desc: 'No accounts, no backend, no tracking. All data stays in your browser.' },
              { icon: '⚡', title: t(lang, 'about.offlineCapable'), desc: 'Full prompt generation without internet. AI is optional.' },
              { icon: '🤖', title: t(lang, 'about.multiProvider'), desc: `${PROVIDER_REGISTRY.length} AI providers supported via common adapter interface.` },
              { icon: '🌐', title: t(lang, 'about.hinglish'), desc: 'Detects Roman Hindi, Devanagari, and mixed Hinglish text.' },
              { icon: '💾', title: 'Local Database', desc: 'IndexedDB-powered prompt library with AI-driven updates and rollback.' },
              { icon: '📱', title: t(lang, 'about.pwa'), desc: 'Installable PWA with offline caching and service worker.' },
            ].map((f, i) => (
              <div key={i} className="flex gap-3">
                <span className="text-2xl shrink-0">{f.icon}</span>
                <div>
                  <h3 className="font-medium text-slate-800 dark:text-slate-200">{f.title}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="glass-card p-6">
          <h2 className="font-bold text-lg mb-3">Supported AI Providers</h2>
          <div className="flex flex-wrap gap-2">
            {PROVIDER_REGISTRY.map(p => (
              <span key={p.id} className="badge-gray">{p.name}</span>
            ))}
          </div>
        </section>

        <section className="glass-card p-6">
          <h2 className="font-bold text-lg mb-3">Architecture</h2>
          <pre className="text-xs font-mono text-slate-500 dark:text-slate-400 overflow-x-auto bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg">
{`UI (React + TypeScript + Tailwind)
    ↓
Application Services (Context + Hooks)
    ↓
Prompt Engine (Detection + Builder + Actions)
    ↓
AI Provider Layer (Adapters + Manager)
    ↓
Database Layer (IndexedDB Repository)
    ↓
IndexedDB`}
          </pre>
        </section>

        <section className="glass-card p-6">
          <h2 className="font-bold text-lg mb-3">Privacy Policy</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
            This application is a static site hosted on GitHub Pages. It does not use any backend server.
          </p>
          <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1 list-disc pl-4">
            <li>No accounts or login required.</li>
            <li>API keys are stored locally in your browser only when you choose to save them.</li>
            <li>Prompt data and history are stored in your browser's IndexedDB.</li>
            <li>AI requests go directly from your browser to the selected provider's API.</li>
            <li>The application does not send your data to any server it controls.</li>
            <li>Browser-side API usage may expose keys to extensions or network inspection — use at your own discretion.</li>
          </ul>
        </section>

        <section className="glass-card p-6">
          <h2 className="font-bold text-lg mb-3">Terms</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            This is a general-purpose prompt-generation tool. Users are responsible for their own API keys,
            API usage costs, and compliance with the terms of service of their chosen AI providers.
            The application respects provider safety policies and does not attempt to bypass them.
          </p>
        </section>
      </div>
    </div>
  )
}
