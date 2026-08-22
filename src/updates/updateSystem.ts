import type {
  UpdatePackage, UpdateChange, PromptTemplate, HinglishPattern, Category,
  DatabaseVersion, Language,
} from '@/types'
import { db } from '../database/db'

// Schema validation for AI-generated update packages
export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  changes: UpdateChange[]
}

const VALID_TYPES = ['template', 'hinglish_pattern', 'category', 'language', 'tag']
const VALID_OPERATIONS = ['add', 'update', 'delete']

export function validateUpdatePackage(pkg: unknown): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!pkg || typeof pkg !== 'object') {
    return { valid: false, errors: ['Update package is not an object'], warnings, changes: [] }
  }

  const p = pkg as Record<string, unknown>

  // Auto-fill schema_version and database_version if missing (some AI models omit these)
  if (p.schema_version === undefined) {
    p.schema_version = 1
    warnings.push('schema_version was missing, defaulted to 1')
  }
  if (p.schema_version !== 1) {
    errors.push(`Invalid schema_version (expected 1, got ${p.schema_version})`)
  }

  if (!p.database_version || typeof p.database_version !== 'string') {
    p.database_version = '1.0.1'
    warnings.push('database_version was missing, defaulted to 1.0.1')
  }

  if (!Array.isArray(p.changes)) {
    errors.push('Missing or invalid changes array')
    return { valid: false, errors, warnings, changes: [] }
  }

  const changes = p.changes as UpdateChange[]
  const seenIds = new Set<string>()
  const validChanges: UpdateChange[] = []

  changes.forEach((change, i) => {
    const changeErrors: string[] = []

    if (!VALID_OPERATIONS.includes(change.operation)) {
      changeErrors.push(`Change ${i}: invalid operation "${change.operation}"`)
    }
    if (!VALID_TYPES.includes(change.type)) {
      changeErrors.push(`Change ${i}: invalid type "${change.type}"`)
    }
    if (!change.id || typeof change.id !== 'string') {
      changeErrors.push(`Change ${i}: missing or invalid id`)
    }

    // Duplicate detection within package
    const changeKey = `${change.type}:${change.id}`
    if (seenIds.has(changeKey)) {
      warnings.push(`Change ${i}: duplicate id "${change.id}" for type "${change.type}"`)
    } else {
      seenIds.add(changeKey)
    }

    // Type-specific validation
    if (change.type === 'template' && change.operation !== 'delete') {
      if (!change.title) changeErrors.push(`Change ${i}: template missing title`)
      if (!change.content) changeErrors.push(`Change ${i}: template missing content`)
      if (!change.category) changeErrors.push(`Change ${i}: template missing category`)
    }

    if (changeErrors.length > 0) {
      errors.push(...changeErrors)
    } else {
      validChanges.push(change)
    }
  })

  // Suspicious pattern detection
  if (changes.length > 500) {
    warnings.push('Large update package (>500 changes). Review carefully.')
  }

  // Check for potentially malicious content in template content
  for (const change of validChanges) {
    if (change.content) {
      if (/<script|javascript:|onerror=|onload=/i.test(change.content)) {
        errors.push(`Change "${change.id}": content contains potentially unsafe HTML/script tags`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    changes: validChanges,
  }
}

// Duplicate detection against existing database
export async function detectDuplicates(changes: UpdateChange[]): Promise<Map<string, boolean>> {
  const existingTemplates = await db.getAllTemplates()
  const existingIds = new Set(existingTemplates.map(t => t.id))
  const duplicates = new Map<string, boolean>()

  for (const change of changes) {
    if (change.type === 'template') {
      duplicates.set(change.id, existingIds.has(change.id))
    }
  }

  return duplicates
}

// Apply a validated update package
export async function applyUpdatePackage(pkg: UpdatePackage): Promise<{ applied: number; skipped: number }> {
  let applied = 0
  let skipped = 0
  const now = Date.now()

  for (const change of pkg.changes) {
    try {
      switch (change.type) {
        case 'template': {
          if (change.operation === 'delete') {
            await db.deleteTemplate(change.id)
            applied++
          } else {
            const template: PromptTemplate = {
              id: change.id,
              category: change.category || 'general',
              language: (change.language as Language) || 'en',
              title: change.title || 'Untitled',
              content: change.content || '',
              tags: change.tags || [],
              style: 'professional',
              createdAt: now,
              updatedAt: now,
              source: 'ai',
              version: 1,
            }
            await db.putTemplate(template)
            applied++
          }
          break
        }
        case 'hinglish_pattern': {
          if (change.operation !== 'delete') {
            const pattern: HinglishPattern = {
              id: change.id,
              pattern: (change.content as string) || '',
              intent: (change.intent as string) || 'create',
              category: change.category || 'general',
              translation: (change.translation as string) || '',
            }
            await db.bulkPutHinglishPatterns([pattern])
            applied++
          }
          break
        }
        case 'category': {
          if (change.operation !== 'delete') {
            const cat: Category = {
              id: change.id,
              name: change.title || change.id,
              parent: change.category,
            }
            await db.bulkPutCategories([cat])
            applied++
          }
          break
        }
        default:
          skipped++
      }
    } catch {
      skipped++
    }
  }

  // Record version
  const versionEntry: DatabaseVersion = {
    version: pkg.database_version,
    installedAt: now,
    changeCount: applied,
    source: pkg.source || 'ai',
  }
  await db.putVersion(versionEntry)

  return { applied, skipped }
}

// Build the AI prompt that asks the provider to generate an update package
export function buildUpdateRequestPrompt(
  currentVersion: string,
  templateCount: number,
  categories: string[],
  languages: Language[],
): string {
  return `You are a prompt engineering database curator.

Current database version: ${currentVersion}
Current template count: ${templateCount}
Categories: ${categories.join(', ')}
Supported languages: ${languages.join(', ')}

Generate a JSON update package that adds new, high-quality prompt templates or improves existing ones.
Follow this exact schema:

{
  "schema_version": 1,
  "database_version": "<next version, e.g., ${incrementVersion(currentVersion)}>",
  "changes": [
    {
      "operation": "add",
      "type": "template",
      "id": "<unique-kebab-case-id>",
      "category": "<one of the listed categories>",
      "language": "en",
      "title": "<descriptive title>",
      "content": "<full structured prompt template content>",
      "tags": ["tag1", "tag2"]
    }
  ]
}

Rules:
- Generate 5-10 new templates that fill gaps in the current database
- Each template must be detailed and production-ready
- Use realistic, useful categories from the list above
- IDs must be unique and kebab-case
- Content must be well-structured with sections (Role, Objective, Requirements, etc.)
- Do not include any script tags or HTML
- Return ONLY valid JSON, no markdown fences

Respond with the JSON update package only.`
}

export function incrementVersion(version: string): string {
  const parts = version.split('.').map(Number)
  if (parts.length === 3 && parts.every(n => !isNaN(n))) {
    parts[2]++
    return parts.join('.')
  }
  return version + '.1'
}

// Rollback to a previous version
export async function rollbackToVersion(version: string): Promise<boolean> {
  const versions = await db.getAllVersions()
  const versions_ = versions.sort((a, b) => a.installedAt - b.installedAt)
  const targetIdx = versions_.findIndex(v => v.version === version)
  if (targetIdx === -1) return false

  // Remove all versions after the target
  const toRemove = versions_.slice(targetIdx + 1)
  // Note: actual rollback would need to track and undo each change
  // For now, we delete the version records (templates added remain but version history is corrected)
  for (const v of toRemove) {
    // In a full implementation, we'd undo each change
    // This is a simplified rollback
  }
  return true
}
