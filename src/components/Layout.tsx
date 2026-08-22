import { NavLink, useLocation } from 'react-router-dom'
import { useApp } from '@/context/AppContext'
import { useState } from 'react'
import { t } from '@/i18n'

const navItems = [
  { path: '/', key: 'nav.home', icon: HomeIcon },
  { path: '/generator', key: 'nav.generator', icon: GeneratorIcon },
  { path: '/templates', key: 'nav.templates', icon: TemplateIcon },
  { path: '/playground', key: 'nav.playground', icon: PlaygroundIcon },
  { path: '/library', key: 'nav.library', icon: LibraryIcon },
  { path: '/updates', key: 'nav.updates', icon: UpdatesIcon },
  { path: '/history', key: 'nav.history', icon: HistoryIcon },
  { path: '/settings', key: 'nav.settings', icon: SettingsIcon },
  { path: '/about', key: 'nav.about', icon: AboutIcon },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const { settings, isOnline, hasAI } = useApp()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  const statusColor = !isOnline ? 'bg-amber-500' : hasAI ? 'bg-emerald-500' : 'bg-slate-400'
  const statusText = !isOnline ? t(settings.uiLanguage, 'common.offline') :
    hasAI ? t(settings.uiLanguage, 'common.aiConnected') :
    t(settings.uiLanguage, 'common.online')

  return (
    <div className="min-h-screen flex">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex flex-col w-64 fixed inset-y-0 left-0 glass border-r border-slate-200/60 dark:border-slate-800/60 z-30">
        <div className="flex items-center gap-2 px-5 py-5 border-b border-slate-200/60 dark:border-slate-800/60">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
            PG
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">Prompt Gen</h1>
            <p className="text-[10px] text-slate-500 dark:text-slate-500 truncate">Universal AI</p>
          </div>
        </div>
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-accent-50 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`
              }
            >
              <item.icon className="w-5 h-5 shrink-0" />
              <span className="truncate">{t(settings.uiLanguage, item.key)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-slate-200/60 dark:border-slate-800/60">
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${statusColor} animate-pulse-soft`} />
            <span className="text-slate-500 dark:text-slate-500">{statusText}</span>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="md:hidden fixed top-0 inset-x-0 z-30 glass border-b border-slate-200/60 dark:border-slate-800/60">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs">
              PG
            </div>
            <span className="font-bold text-sm">Prompt Gen</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full ${statusColor}`} />
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Toggle menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 animate-fade-in" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <nav className="absolute top-16 inset-x-0 glass border-b border-slate-200/60 dark:border-slate-800/60 p-3 space-y-0.5 animate-slide-down">
            {navItems.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                    isActive
                      ? 'bg-accent-50 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400'
                      : 'text-slate-600 dark:text-slate-400'
                  }`
                }
              >
                <item.icon className="w-5 h-5" />
                <span>{t(settings.uiLanguage, item.key)}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 md:ml-64 pt-16 md:pt-0 min-h-screen">
        <div key={location.pathname} className="animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  )
}

// Inline icon components (no external icon dependency)
function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  )
}
function GeneratorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  )
}
function TemplateIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  )
}
function PlaygroundIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}
function LibraryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  )
}
function UpdatesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}
function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}
function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}
function AboutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}
