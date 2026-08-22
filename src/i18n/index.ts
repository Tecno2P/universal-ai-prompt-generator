import type { Language } from '@/types'
import en from '../../locales/en.json'
import hi from '../../locales/hi.json'
import hinglish from '../../locales/hinglish.json'
import es from '../../locales/es.json'
import fr from '../../locales/fr.json'
import de from '../../locales/de.json'

// Additional languages fall back to English structure (architectural support).
// Add the corresponding JSON file to locales/ and import here to activate.
const fallback = en

export const LOCALES: Record<Language, typeof en> = {
  en, hi, hinglish, es, fr, de,
  pt: fallback, it: fallback, nl: fallback, ru: fallback,
  ar: fallback, tr: fallback, id: fallback, ja: fallback,
  ko: fallback, zh: fallback,
}

export const SUPPORTED_LANGUAGES: { code: Language; name: string; nativeName: string }[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'hinglish', name: 'Hinglish', nativeName: 'Hinglish' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'id', name: 'Indonesian', nativeName: 'Indonesia' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'zh', name: 'Chinese', nativeName: '中文' },
]

export function t(lang: Language, key: string): string {
  const locale = LOCALES[lang] || en
  const parts = key.split('.')
  let value: unknown = locale
  for (const p of parts) {
    if (typeof value !== 'object' || value === null) return key
    value = (value as Record<string, unknown>)[p]
  }
  return typeof value === 'string' ? value : key
}
