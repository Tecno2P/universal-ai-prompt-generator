import type { Language } from '@/types'

// Devanagari Unicode range: U+0900–U+097F
const DEVANAGARI_RE = /[\u0900-\u097F]/

// Common Hinglish (Roman Hindi) words that strongly indicate Hinglish
const HINGLISH_WORDS = new Set([
  'mujhe', 'mere', 'mera', 'meri', 'bana', 'banao', 'banana', 'banani', 'kar', 'karo',
  'hai', 'ho', 'hoga', 'chahiye', 'ek', 'do', 'teen', 'bahut', 'thoda', 'acha', 'achha',
  'kya', 'kaun', 'kahan', 'kab', 'kyun', 'kyunki', 'lekin', 'aur', 'ya', 'nahi', 'nahin',
  'jo', 'wo', 'yeh', 'woh', 'ham', 'hum', 'tum', 'aap', 'us', 'is', 'mei', 'mein', 'par',
  'se', 'ke', 'ki', 'ka', 'ko', 'ne', 'de', 'do', 'lena', 'lenge', 'dena', 'denge',
  'padhai', 'padho', 'sikh', 'sikho', 'samajh', 'samjho', 'chalo', 'aa', 'jaa',
  'kuch', 'sab', 'kul', 'jaise', 'jaisa', 'aisa', 'aisi', 'waisa', 'kaisa',
  'ab', 'phir', 'pehle', 'baad', 'mein', 'yahan', 'wahan', 'idhar', 'udhar',
  'khud', 'sath', 'saath', 'bina', 'sirf', 'bhi', 'toh', 'hi', 'na',
])

const LANGUAGE_SCORE: Record<Language, number> = {} as never

export interface DetectionResult {
  language: Language
  isHinglish: boolean
  scores: Partial<Record<Language, number>>
  confidence: number
}

export function detectLanguage(text: string): DetectionResult {
  const trimmed = text.trim()
  if (!trimmed) return { language: 'en', isHinglish: false, scores: { en: 1 }, confidence: 1 }

  const scores: Partial<Record<Language, number>> = {}
  const lower = trimmed.toLowerCase()
  const words = lower.split(/[\s,.!?;:'"()]+/).filter(Boolean)

  // Devanagari → Hindi
  if (DEVANAGARI_RE.test(trimmed)) {
    scores.hi = 3
  }

  // Hinglish detection: count Roman Hindi words
  let hinglishHits = 0
  for (const w of words) {
    if (HINGLISH_WORDS.has(w)) hinglishHits++
  }
  // Also check bigram-ish patterns
  const hinglishPatternRe = /\b(mujhe|mere?|mera|bana|karo|chahiye|banani|hai|ho gaya|kya hai)\b/i
  if (hinglishPatternRe.test(lower)) hinglishHits++

  if (hinglishHits >= 1) {
    scores.hinglish = hinglishHits + (words.some(w => /^[a-z]+$/i.test(w)) ? 1 : 0)
  }

  // If Hindi (Devanagari) AND some roman English words present → also Hinglish
  if (scores.hi && words.some(w => /^[a-z]{2,}$/i.test(w) && !HINGLISH_WORDS.has(w))) {
    scores.hinglish = (scores.hinglish || 0) + 2
  }

  // Default English
  if (Object.keys(scores).length === 0) {
    scores.en = 1
  }

  // Pick best
  let best: Language = 'en'
  let bestScore = -1
  for (const [lang, sc] of Object.entries(scores)) {
    if ((sc ?? 0) > bestScore) {
      best = lang as Language
      bestScore = sc ?? 0
    }
  }

  const total = Object.values(scores).reduce((a, b) => (a ?? 0) + (b ?? 0), 0) || 1
  const confidence = Math.min(1, bestScore / total)

  return {
    language: best,
    isHinglish: (scores.hinglish ?? 0) > 0 && best === 'hinglish',
    scores,
    confidence,
  }
}

// Simple token-based language name lookup for output labels
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English', hi: 'Hindi', hinglish: 'Hinglish', es: 'Spanish', fr: 'French',
  de: 'German', pt: 'Portuguese', it: 'Italian', nl: 'Dutch', ru: 'Russian',
  ar: 'Arabic', tr: 'Turkish', id: 'Indonesian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
}

export function languageName(code: Language): string {
  return LANGUAGE_NAMES[code] || code
}

// Avoid unused export lint
void LANGUAGE_SCORE
