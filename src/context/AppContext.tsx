import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { Language, OperationMode } from '@/types'

export type ThemeMode = 'dark' | 'light' | 'system'

export interface AppSettings {
  theme: ThemeMode
  language: Language
  uiLanguage: Language
  mode: OperationMode
  defaultStyle: string
  defaultProvider: string
  defaultModel: string
  autoUpdateCheck: boolean
  askBeforeInstall: boolean
  reducedMotion: boolean
  animations: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  language: 'en',
  uiLanguage: 'en',
  mode: 'auto',
  defaultStyle: 'professional',
  defaultProvider: '',
  defaultModel: '',
  autoUpdateCheck: false,
  askBeforeInstall: true,
  reducedMotion: false,
  animations: true,
}

interface AppContextValue {
  settings: AppSettings
  updateSettings: (partial: Partial<AppSettings>) => void
  isOnline: boolean
  hasAI: boolean
  setHasAI: (v: boolean) => void
  effectiveTheme: 'dark' | 'light'
}

const AppContext = createContext<AppContextValue | null>(null)

const STORAGE_KEY = 'app-settings'

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [hasAI, setHasAI] = useState(false)
  const [effectiveTheme, setEffectiveTheme] = useState<'dark' | 'light'>('dark')

  // Load settings from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) })
      }
    } catch {
      // ignore
    }
  }, [])

  // Apply theme
  useEffect(() => {
    const applyTheme = () => {
      let theme: 'dark' | 'light'
      if (settings.theme === 'system') {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      } else {
        theme = settings.theme
      }
      setEffectiveTheme(theme)
      if (theme === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    }
    applyTheme()
    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', applyTheme)
      return () => mq.removeEventListener('change', applyTheme)
    }
  }, [settings.theme])

  // Reduced motion class
  useEffect(() => {
    if (settings.reducedMotion) {
      document.documentElement.classList.add('reduce-motion')
    } else {
      document.documentElement.classList.remove('reduce-motion')
    }
  }, [settings.reducedMotion])

  // Online/offline
  useEffect(() => {
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...partial }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  return (
    <AppContext.Provider value={{ settings, updateSettings, isOnline, hasAI, setHasAI, effectiveTheme }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
