import type { HinglishPattern } from '@/types'

// Keyword → category mapping for intent detection
const KEYWORD_MAP: { keywords: string[]; category: string; intent: string }[] = [
  { keywords: ['website', 'web', 'webapp', 'landing page', 'web page', 'site'], category: 'web-development', intent: 'create' },
  { keywords: ['dashboard', 'admin panel', 'admin dashboard'], category: 'web-development', intent: 'create' },
  { keywords: ['react', 'component', 'jsx', 'tsx'], category: 'react', intent: 'create' },
  { keywords: ['api', 'rest', 'graphql', 'endpoint', 'backend service'], category: 'api', intent: 'create' },
  { keywords: ['database', 'schema', 'sql', 'table', 'query', 'db'], category: 'database', intent: 'create' },
  { keywords: ['python', 'script', 'automation'], category: 'python', intent: 'create' },
  { keywords: ['node', 'nodejs', 'express', 'fastify'], category: 'nodejs', intent: 'create' },
  { keywords: ['typescript', 'types', 'interface'], category: 'typescript', intent: 'create' },
  { keywords: ['javascript', 'js', 'vanilla js'], category: 'javascript', intent: 'create' },
  { keywords: ['android', 'kotlin', 'jetpack'], category: 'android', intent: 'create' },
  { keywords: ['ios', 'swift', 'swiftui', 'iphone'], category: 'ios', intent: 'create' },
  { keywords: ['devops', 'ci', 'cd', 'pipeline', 'github actions', 'docker', 'kubernetes'], category: 'devops', intent: 'create' },
  { keywords: ['debug', 'fix', 'bug', 'error', 'crash', 'stack trace'], category: 'debugging', intent: 'transform' },
  { keywords: ['image', 'picture', 'photo', 'art', 'illustration'], category: 'image-gen', intent: 'create' },
  { keywords: ['video', 'animation', 'motion', 'clip'], category: 'video-gen', intent: 'create' },
  { keywords: ['story', 'novel', 'fiction', 'narrative', 'kahani'], category: 'story', intent: 'create' },
  { keywords: ['design', 'ui', 'ux', 'design system', 'figma'], category: 'design', intent: 'create' },
  { keywords: ['blog', 'article', 'post', 'content writing'], category: 'blog', intent: 'create' },
  { keywords: ['email', 'mail', 'message'], category: 'email', intent: 'create' },
  { keywords: ['resume', 'cv', 'biodata', 'portfolio'], category: 'resume', intent: 'create' },
  { keywords: ['marketing', 'campaign', 'advertisement', 'ad copy'], category: 'marketing', intent: 'create' },
  { keywords: ['social media', 'instagram', 'twitter', 'linkedin', 'facebook post'], category: 'social-media', intent: 'create' },
  { keywords: ['summarize', 'summary', 'shorten', 'tldr', 'key points', 'short'], category: 'summarization', intent: 'transform' },
  { keywords: ['analyze', 'analysis', 'insights', 'data analysis'], category: 'analysis', intent: 'create' },
  { keywords: ['academic', 'paper', 'thesis', 'research paper', 'citation'], category: 'academic', intent: 'create' },
  { keywords: ['startup', 'pitch deck', 'investor', 'funding'], category: 'startup', intent: 'create' },
  { keywords: ['business plan', 'business model', 'company strategy'], category: 'business-plan', intent: 'create' },
  { keywords: ['seo', 'search engine', 'ranking', 'google ranking'], category: 'seo', intent: 'create' },
  { keywords: ['product strategy', 'roadmap', 'product vision'], category: 'product-strategy', intent: 'create' },
  { keywords: ['lesson plan', 'teach', 'curriculum'], category: 'teacher', intent: 'create' },
  { keywords: ['study plan', 'study schedule', 'exam prep'], category: 'study-plan', intent: 'create' },
  { keywords: ['quiz', 'test questions', 'mcq', 'assessment'], category: 'quiz', intent: 'create' },
  { keywords: ['flashcards', 'flash cards', 'memorize'], category: 'education', intent: 'create' },
  { keywords: ['explain', 'understand', 'concept', 'how does'], category: 'education', intent: 'explain' },
]

export interface IntentResult {
  category: string
  intent: string
  matchedKeywords: string[]
  confidence: number
}

export function detectIntent(text: string, hinglishPatterns?: HinglishPattern[]): IntentResult {
  const lower = text.toLowerCase()
  const matched: string[] = []
  let bestCat = 'general'
  let bestIntent = 'create'
  let bestScore = 0

  for (const entry of KEYWORD_MAP) {
    let hits = 0
    for (const kw of entry.keywords) {
      // Use word-boundary matching to avoid false positives (e.g. "art" in "start")
      const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      if (re.test(lower)) {
        hits++
        matched.push(kw)
      }
    }
    // Transform intents (summarize, debug) get priority boost
    const score = hits + (entry.intent === 'transform' ? 0.5 : 0)
    if (score > bestScore) {
      bestScore = score
      bestCat = entry.category
      bestIntent = entry.intent
    }
  }

  // Also check Hinglish patterns
  if (hinglishPatterns) {
    for (const p of hinglishPatterns) {
      try {
        const re = new RegExp(p.pattern, 'i')
        if (re.test(text)) {
          matched.push(p.id)
          if (p.category !== 'general' && bestScore === 0) {
            bestCat = p.category
            bestIntent = p.intent
          }
        }
      } catch {
        // skip invalid regex
      }
    }
  }

  return {
    category: bestCat,
    intent: bestIntent,
    matchedKeywords: matched,
    confidence: bestScore > 0 ? Math.min(1, bestScore / 3) : 0.2,
  }
}
