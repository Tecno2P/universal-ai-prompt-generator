import type {
  GenerateParams, GenerateResult, PromptTemplate, HinglishPattern,
} from '@/types'
import { detectLanguage } from './languageDetection'
import { detectIntent } from './intentDetection'
import { buildStructuredPrompt } from './promptBuilder'

export interface EngineDeps {
  templates?: PromptTemplate[]
  hinglishPatterns?: HinglishPattern[]
}

// Fuzzy keyword matching to find the best template for the user's input
function findBestTemplate(input: string, category: string, templates: PromptTemplate[]): PromptTemplate | undefined {
  if (!templates || templates.length === 0) return undefined
  const lower = input.toLowerCase()

  // First try: exact category match + keyword match
  const catMatches = templates.filter(t => t.category === category)
  if (catMatches.length > 0) {
    let best: PromptTemplate | undefined
    let bestScore = 0
    for (const t of catMatches) {
      let score = 0
      for (const kw of t.keywords || []) {
        if (lower.includes(kw.toLowerCase())) score++
      }
      if (score > bestScore) {
        bestScore = score
        best = t
      }
    }
    if (best) return best
    // Random category match if no keyword match
    return catMatches[0]
  }

  // Fallback: search all templates for keyword matches
  let best: PromptTemplate | undefined
  let bestScore = 0
  for (const t of templates) {
    let score = 0
    for (const kw of t.keywords || []) {
      if (lower.includes(kw.toLowerCase())) score++
    }
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  return bestScore > 0 ? best : undefined
}

export function generateOffline(params: GenerateParams, deps: EngineDeps): GenerateResult {
  const { input, style, outputLanguage, sections, category } = params

  // 1. Language detection
  const langResult = detectLanguage(input)

  // 2. Intent / category detection
  const intentResult = detectIntent(input, deps.hinglishPatterns)

  // Use detected category if user didn't specify one
  const effectiveCategory = category || intentResult.category

  // 3. Template matching
  const template = findBestTemplate(input, effectiveCategory, deps.templates || [])

  // 4. Build structured prompt
  const prompt = buildStructuredPrompt({
    style,
    sections,
    outputLanguage,
    userIdea: input,
    detectedCategory: effectiveCategory,
    detectedIntent: intentResult.intent,
    templateContent: template?.content,
  })

  return {
    prompt,
    detectedLanguage: langResult.language,
    detectedCategory: effectiveCategory,
    detectedIntent: intentResult.intent,
    source: 'offline',
    templateId: template?.id,
  }
}

// Prompt transformation actions (work offline)
export function transformPrompt(
  current: string,
  action: string,
  targetLanguage?: string,
): string {
  const actions: Record<string, (s: string) => string> = {
    improve: (s) => enhancePromptText(s),
    enhance: (s) => enhancePromptText(s),
    expand: (s) => expandPromptText(s),
    shorten: (s) => shortenPromptText(s),
    simplify: (s) => simplifyPromptText(s),
    professional: (s) => addTone(s, 'professional'),
    technical: (s) => addTone(s, 'technical'),
    creative: (s) => addTone(s, 'creative'),
    addConstraints: (s) => addConstraints(s),
    addExamples: (s) => addExamples(s),
    toJSON: (s) => toJSONFormat(s),
    toMarkdown: (s) => toMarkdownFormat(s),
    optimize: (s) => optimizeForAI(s),
  }

  const fn = actions[action]
  if (!fn) return current

  let result = fn(current)

  if (action === 'translate' && targetLanguage) {
    // For offline translate, we add a translation directive since we can't actually translate
    result = `[Translate the following prompt to ${targetLanguage}]\n\n${current}`
  }

  return result
}

function enhancePromptText(s: string): string {
  // Add specificity and structure
  const enhanced = s
    .replace(/\*\*Objective\*\*:/, '**Objective**: Precisely and carefully')
    .replace(/\*\*Requirements\*\*:/, '**Requirements** (refined):')
  return enhanced + '\n\n**Additional Quality Notes**: Ensure the response is thorough, well-tested, and addresses the core need. Provide clear reasoning for design decisions.'
}

function expandPromptText(s: string): string {
  return s + '\n\n**Expanded Guidance**:\n- Consider multiple approaches and select the best one\n- Provide rationale for key decisions\n- Include error handling and logging where relevant\n- Document assumptions and constraints\n- Suggest follow-up improvements'
}

function shortenPromptText(s: string): string {
  // Remove optional sections
  return s
    .split('\n\n')
    .filter(section =>
      !section.includes('Edge Cases') &&
      !section.includes('Additional Instructions') &&
      !section.includes('Examples') &&
      !section.includes('Quality Criteria')
    )
    .join('\n\n')
}

function simplifyPromptText(s: string): string {
  return s.split('\n\n')
    .filter(section =>
      section.includes('Role') ||
      section.includes('Objective') ||
      section.includes('Requirements') ||
      !section.startsWith('**')
    )
    .join('\n\n')
}

function addTone(s: string, tone: string): string {
  const tones: Record<string, string> = {
    professional: '\n\n**Tone**: Professional, clear, and business-appropriate. Use industry-standard terminology.',
    technical: '\n\n**Tone**: Technical and precise. Include implementation details, specifications, and engineering considerations.',
    creative: '\n\n**Tone**: Creative and engaging. Use vivid language, metaphors, and imaginative approaches.',
  }
  return s + (tones[tone] || '')
}

function addConstraints(s: string): string {
  return s + '\n\n**Constraints**:\n- Must be compatible with modern standards\n- Performance-optimized\n- Accessible (WCAG 2.1 AA where applicable)\n- Well-documented with inline comments'
}

function addExamples(s: string): string {
  return s + '\n\n**Examples**: Include 2-3 concrete examples demonstrating the expected output format and quality.'
}

function toJSONFormat(s: string): string {
  // Simple conversion: wrap in a JSON-like structure
  const lines = s.split('\n\n').map((section, i) => {
    const match = section.match(/^\*\*(.+?)\*\*:?\s*(.*)$/s)
    if (match) {
      return `  "${match[1].toLowerCase().replace(/\s+/g, '_')}": "${match[2].replace(/"/g, '\\"').replace(/\n/g, '\\n').trim()}"`
    }
    return `  "section_${i}": "${section.replace(/"/g, '\\"').replace(/\n/g, '\\n').trim()}"`
  })
  return `{\n${lines.join(',\n')}\n}`
}

function toMarkdownFormat(s: string): string {
  // Ensure proper markdown formatting
  let md = s.replace(/\*\*(.+?)\*\*:/g, '## $1\n')
  if (!md.startsWith('#')) md = '# Generated Prompt\n\n' + md
  return md
}

function optimizeForAI(s: string): string {
  return s + '\n\n---\n**AI Optimization Notes**:\n- Use chain-of-thought reasoning where complex logic is involved\n- Break down multi-step tasks into clear sub-steps\n- Verify intermediate results before proceeding\n- Self-check the final output for completeness and correctness'
}
