import type { PromptSectionKey, PromptStyle, Language } from '@/types'

export const SECTION_LABELS: Record<PromptSectionKey, string> = {
  role: 'Role',
  context: 'Context',
  objective: 'Objective',
  requirements: 'Requirements',
  constraints: 'Constraints',
  inputs: 'Inputs',
  steps: 'Steps',
  expectedOutput: 'Expected Output',
  outputFormat: 'Output Format',
  qualityCriteria: 'Quality Criteria',
  examples: 'Examples',
  edgeCases: 'Edge Cases',
  additionalInstructions: 'Additional Instructions',
}

export const ALL_SECTIONS: PromptSectionKey[] = Object.keys(SECTION_LABELS) as PromptSectionKey[]

export const DEFAULT_SECTIONS: Record<PromptSectionKey, boolean> = {
  role: true, context: true, objective: true, requirements: true,
  constraints: false, inputs: true, steps: false, expectedOutput: true,
  outputFormat: false, qualityCriteria: false, examples: false,
  edgeCases: false, additionalInstructions: false,
}

interface BuildOptions {
  style: PromptStyle
  sections: Record<PromptSectionKey, boolean>
  outputLanguage: Language
  userIdea: string
  detectedCategory: string
  detectedIntent: string
  templateContent?: string
}

// Role inference based on category
function inferRole(category: string, language: Language): string {
  const roles: Record<string, string> = {
    'web-development': 'expert full-stack web developer',
    'react': 'React expert specializing in accessible, reusable components',
    'api': 'backend architect',
    'database': 'database architect',
    'python': 'Python expert',
    'nodejs': 'Node.js backend expert',
    'typescript': 'TypeScript expert',
    'javascript': 'JavaScript expert',
    'android': 'experienced Android developer',
    'ios': 'senior iOS developer',
    'devops': 'DevOps engineer',
    'debugging': 'debugging expert',
    'image-gen': 'prompt engineer for AI image generation',
    'video-gen': 'prompt engineer for AI video generation',
    'story': 'creative writer',
    'design': 'UI/UX design systems expert',
    'blog': 'expert content writer and SEO specialist',
    'email': 'professional communication expert',
    'resume': 'professional resume writer',
    'marketing': 'marketing strategist',
    'social-media': 'social media content creator',
    'summarization': 'summarization expert',
    'analysis': 'data analyst',
    'academic': 'academic writing assistant',
    'startup': 'startup advisor',
    'business-plan': 'business consultant',
    'seo': 'SEO expert',
    'product-strategy': 'senior product manager',
    'teacher': 'experienced educator',
    'study-plan': 'academic coach',
    'quiz': 'assessment designer',
  }
  const role = roles[category] || 'expert assistant'
  if (language === 'hinglish') {
    return `Aap ek ${role} hain.`
  }
  return `You are an ${role}.`
}

// Convert template content placeholders + user idea into a structured prompt
export function buildStructuredPrompt(opts: BuildOptions): string {
  const { style, sections, outputLanguage, userIdea, detectedCategory, detectedIntent, templateContent } = opts
  const parts: string[] = []

  const roleText = inferRole(detectedCategory, outputLanguage)

  // If we have a template, use it as a base and inject user idea
  if (templateContent && !templateContent.includes('{{')) {
    // Template has no placeholders — prepend role + user idea
    if (sections.role) parts.push(`**${SECTION_LABELS.role}**: ${roleText}`)
    if (sections.context) parts.push(`**${SECTION_LABELS.context}**: ${userIdea}`)
    parts.push(templateContent)
    return parts.join('\n\n')
  }

  // Build from scratch / template with placeholders
  let content = templateContent || ''

  // Replace placeholders with user idea
  if (content) {
    content = content.replace(/\{\{[^}]+\}\}/g, userIdea)
  }

  // Role
  if (sections.role) {
    parts.push(`**${SECTION_LABELS.role}**: ${roleText}`)
  }

  // Context
  if (sections.context) {
    const ctxLabel = outputLanguage === 'hinglish' ? 'Context' : SECTION_LABELS.context
    parts.push(`**${ctxLabel}**: ${userIdea}`)
  }

  // Objective
  if (sections.objective) {
    let obj: string
    if (detectedIntent === 'transform') {
      obj = outputLanguage === 'hinglish'
        ? `Is content ko improve/transform karo`
        : `Improve and transform the given content based on the requirements`
    } else if (detectedIntent === 'explain') {
      obj = outputLanguage === 'hinglish'
        ? `Is concept ko clearly explain karo`
        : `Explain the concept clearly and comprehensively`
    } else {
      obj = outputLanguage === 'hinglish'
        ? `Upar diye gaye idea ke basis pe ek complete solution banao`
        : `Create a complete solution based on the given idea`
    }
    parts.push(`**${SECTION_LABELS.objective}**: ${obj}`)
  }

  // Requirements
  if (sections.requirements) {
    const reqs = outputLanguage === 'hinglish'
      ? `- Clean, production-ready output\n- Best practices follow karo\n- Clear structure with proper formatting`
      : `- Clean, production-ready output\n- Follow best practices and conventions\n- Clear structure with proper formatting\n- Handle edge cases appropriately`
    parts.push(`**${SECTION_LABELS.requirements}**:\n${reqs}`)
  }

  // Constraints
  if (sections.constraints) {
    const cons = outputLanguage === 'hinglish'
      ? `- Unnecessary complexity avoid karo\n- Minimal dependencies use karo`
      : `- Avoid unnecessary complexity\n- Use minimal dependencies\n- Ensure compatibility and maintainability`
    parts.push(`**${SECTION_LABELS.constraints}**:\n${cons}`)
  }

  // Inputs
  if (sections.inputs) {
    parts.push(`**${SECTION_LABELS.inputs}**:\n\`\`\`\n${userIdea}\n\`\`\``)
  }

  // Steps
  if (sections.steps) {
    const steps = outputLanguage === 'hinglish'
      ? `1. Idea ko analyze karo\n2. Solution plan banao\n3. Implementation karo\n4. Test aur verify karo`
      : `1. Analyze the idea\n2. Plan the solution approach\n3. Implement the solution\n4. Test and verify the output`
    parts.push(`**${SECTION_LABELS.steps}**:\n${steps}`)
  }

  // Expected Output
  if (sections.expectedOutput) {
    const exp = outputLanguage === 'hinglish'
      ? `Complete, usable output with explanation`
      : `Complete, usable output with clear explanation and documentation`
    parts.push(`**${SECTION_LABELS.expectedOutput}**: ${exp}`)
  }

  // Output Format
  if (sections.outputFormat) {
    const formats: Record<PromptStyle, string> = {
      simple: 'Plain text response',
      professional: 'Markdown with clear sections',
      expert: 'Markdown with detailed sections and code blocks',
      detailed: 'Comprehensive Markdown document with all sections',
      technical: 'Technical Markdown with code blocks and diagrams',
      creative: 'Creative narrative format with formatting',
      structured: 'Structured Markdown with numbered sections',
      json: 'Valid JSON output',
      developer: 'Code-focused with comments and explanations',
      agent: 'Agent-optimized format with clear instructions',
      system: 'System prompt format with clear directives',
      reasoning: 'Step-by-step reasoning with final answer',
    }
    parts.push(`**${SECTION_LABELS.outputFormat}**: ${formats[style] || 'Markdown'}`)
  }

  // Quality Criteria
  if (sections.qualityCriteria) {
    const qc = outputLanguage === 'hinglish'
      ? `- Accurate aur relevant\n- Well-structured\n- Easy to understand`
      : `- Accurate and relevant\n- Well-structured and organized\n- Easy to understand and implement\n- Free of errors`
    parts.push(`**${SECTION_LABELS.qualityCriteria}**:\n${qc}`)
  }

  // Examples
  if (sections.examples) {
    parts.push(`**${SECTION_LABELS.examples}**: Provide relevant examples where applicable.`)
  }

  // Edge Cases
  if (sections.edgeCases) {
    parts.push(`**${SECTION_LABELS.edgeCases}**: Handle and document edge cases.`)
  }

  // Additional Instructions
  if (sections.additionalInstructions) {
    const ai = outputLanguage === 'hinglish'
      ? `Agar koi clarification chahiye toh assume karke proceed karo, assumptions mention karo.`
      : `If any clarification is needed, make reasonable assumptions and proceed. State your assumptions clearly.`
    parts.push(`**${SECTION_LABELS.additionalInstructions}**: ${ai}`)
  }

  // If we had template content with placeholders, append it
  if (content && templateContent) {
    parts.push(content)
  }

  return parts.join('\n\n')
}
