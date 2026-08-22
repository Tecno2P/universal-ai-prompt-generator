import type { HinglishPattern } from '@/types'

// Hinglish intent patterns — used by the offline engine to detect intent
// from mixed Hindi-English Roman-script input.
export const BUILTIN_HINGLISH_PATTERNS: HinglishPattern[] = [
  { id: 'hing-banana', pattern: '\\b(bana|banani?|banana|banao|bana do)\\b', intent: 'create', category: 'general', translation: 'create / build' },
  { id: 'hing-mujhe', pattern: '\\b(mujhe|mere liye|mera)\\b', intent: 'create', category: 'general', translation: 'for me / my' },
  { id: 'hing-website', pattern: '\\b(website|web|site|webapp|web app)\\b', intent: 'create', category: 'web-development', translation: 'website' },
  { id: 'hing-app', pattern: '\\b(app|application|android|ios|mobile)\\b', intent: 'create', category: 'android', translation: 'mobile application' },
  { id: 'hing-dashboard', pattern: '\\b(dashboard|admin|panel|portal)\\b', intent: 'create', category: 'web-development', translation: 'dashboard / admin panel' },
  { id: 'hing-modern', pattern: '\\b(modern|premium|sleek|beautiful|stylish|latest)\\b', intent: 'style', category: 'design', translation: 'modern / premium design' },
  { id: 'hing-smooth', pattern: '\\b(smooth|fast|responsive|optimized|lag-free)\\b', intent: 'style', category: 'design', translation: 'smooth / performant' },
  { id: 'hing-professional', pattern: '\\b(professional|pro|corporate|business)\\b', intent: 'style', category: 'business', translation: 'professional' },
  { id: 'hing-portfolio', pattern: '\\b(portfolio|resume|cv|biodata)\\b', intent: 'create', category: 'resume', translation: 'portfolio / resume' },
  { id: 'hing-api', pattern: '\\b(api|backend|server|endpoint|rest)\\b', intent: 'create', category: 'api', translation: 'API / backend' },
  { id: 'hing-blog', pattern: '\\b(blog|article|post|content)\\b', intent: 'create', category: 'blog', translation: 'blog / article' },
  { id: 'hing-quiz', pattern: '\\b(quiz|test|exam|question)\\b', intent: 'create', category: 'quiz', translation: 'quiz / test' },
  { id: 'hing-study', pattern: '\\b(padhai|study|learn|sikh|sikho|padho)\\b', intent: 'create', category: 'study-plan', translation: 'study / learn' },
  { id: 'hing-story', pattern: '\\b(story|kahani|kahaani|novel|fiction)\\b', intent: 'create', category: 'story', translation: 'story / narrative' },
  { id: 'hing-image', pattern: '\\b(image|photo|picture|tasveer|chitra)\\b', intent: 'create', category: 'image-gen', translation: 'image / picture' },
  { id: 'hing-business', pattern: '\\b(business|startup|vyapar|company)\\b', intent: 'create', category: 'startup', translation: 'business / startup' },
  { id: 'hing-seo', pattern: '\\b(seo|ranking|google|search|optimize)\\b', intent: 'create', category: 'seo', translation: 'SEO / search ranking' },
  { id: 'hing-summarize', pattern: '\\b(summarize|summary|samjha|samjho|short|chota)\\b', intent: 'transform', category: 'summarization', translation: 'summarize / shorten' },
  { id: 'hing-translate', pattern: '\\b(translate|anuvad|anuwad|convert|badlo)\\b', intent: 'transform', category: 'general', translation: 'translate / convert' },
  { id: 'hing-improve', pattern: '\\b(improve|behtar|achha|enhance|upgrade)\\b', intent: 'transform', category: 'general', translation: 'improve / enhance' },
  { id: 'hing-debug', pattern: '\\b(debug|fix|error|bug|thik|theek)\\b', intent: 'transform', category: 'debugging', translation: 'debug / fix' },
  { id: 'hing-email', pattern: '\\b(email|mail|message)\\b', intent: 'create', category: 'email', translation: 'email / message' },
  { id: 'hing-data', pattern: '\\b(data|database|db|store|storage)\\b', intent: 'create', category: 'database', translation: 'data / database' },
  { id: 'hing-animation', pattern: '\\b(animation|animate|motion|transition|effect)\\b', intent: 'style', category: 'design', translation: 'animation / motion' },
]
