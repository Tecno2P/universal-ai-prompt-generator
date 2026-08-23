import type {
  UpdatePackage, UpdateChange, PromptTemplate, HinglishPattern, Category,
  DatabaseVersion, Language,
} from '@/types'
import { db } from '../database/db'

// ── Trust Levels ────────────────────────────────────────────────

export type TrustLevel = 'official' | 'maintainer-approved' | 'community-submitted' | 'ai-generated' | 'user-local' | 'untrusted'

export const TRUST_LABELS: Record<TrustLevel, string> = {
  'official': 'Official',
  'maintainer-approved': 'Maintainer Approved',
  'community-submitted': 'Community Submitted',
  'ai-generated': 'AI Generated',
  'user-local': 'User Local',
  'untrusted': 'Untrusted',
}

export const TRUST_COLORS: Record<TrustLevel, string> = {
  'official': 'badge-green',
  'maintainer-approved': 'badge-blue',
  'community-submitted': 'badge-purple',
  'ai-generated': 'badge-gray',
  'user-local': 'badge-gray',
  'untrusted': 'badge-gray',
}

// ── Validation ──────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  changes: UpdateChange[]
}

const VALID_TYPES = ['template', 'hinglish_pattern', 'category', 'language', 'tag']
const VALID_OPERATIONS = ['add', 'update', 'delete']
const MAX_CONTENT_LENGTH = 10000
const MAX_CHANGES = 500

export function validateUpdatePackage(pkg: unknown): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!pkg || typeof pkg !== 'object') {
    return { valid: false, errors: ['Update package is not an object'], warnings, changes: [] }
  }

  const p = pkg as Record<string, unknown>

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

  if (changes.length > MAX_CHANGES) {
    warnings.push(`Large update package (>${MAX_CHANGES} changes). Review carefully.`)
  }

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

    const changeKey = `${change.type}:${change.id}`
    if (seenIds.has(changeKey)) {
      warnings.push(`Change ${i}: duplicate id "${change.id}" for type "${change.type}"`)
    } else {
      seenIds.add(changeKey)
    }

    if (change.type === 'template' && change.operation !== 'delete') {
      if (!change.title) changeErrors.push(`Change ${i}: template missing title`)
      if (!change.content) changeErrors.push(`Change ${i}: template missing content`)
      if (!change.category) changeErrors.push(`Change ${i}: template missing category`)
      if (change.content && change.content.length > MAX_CONTENT_LENGTH) {
        changeErrors.push(`Change ${i}: content exceeds max length (${MAX_CONTENT_LENGTH})`)
      }
    }

    if (change.language && typeof change.language !== 'string') {
      changeErrors.push(`Change ${i}: invalid language`)
    }

    if (change.id && !/^[a-z0-9-_:]+$/.test(change.id)) {
      warnings.push(`Change ${i}: id "${change.id}" is not kebab-case`)
    }

    if (changeErrors.length > 0) {
      errors.push(...changeErrors)
    } else {
      validChanges.push(change)
    }
  })

  for (const change of validChanges) {
    if (change.content) {
      if (/<script|javascript:|onerror=|onload=/i.test(change.content)) {
        errors.push(`Change "${change.id}": content contains potentially unsafe HTML/script tags`)
      }
      if (/eval\s*\(|new\s+Function\s*\(/i.test(change.content)) {
        errors.push(`Change "${change.id}": content contains potentially unsafe code execution`)
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

// ── Duplicate Detection ────────────────────────────────────────

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

// ── Rollback Snapshots ──────────────────────────────────────────

const ROLLBACK_STORE = 'rollback_snapshots'

export interface RollbackSnapshot {
  id: string
  version: string
  createdAt: number
  templates: PromptTemplate[]
  changeCount: number
}

export async function createRollbackSnapshot(version: string): Promise<string> {
  const templates = await db.getAllTemplates()
  const snapshotId = `snapshot-${Date.now()}`
  const snapshot: RollbackSnapshot = {
    id: snapshotId,
    version,
    createdAt: Date.now(),
    templates,
    changeCount: templates.length,
  }

  return new Promise((resolve, reject) => {
    const req = indexedDB.open('prompt-gen-rollback', 1)
    req.onupgradeneeded = (e) => {
      const database = (e.target as IDBOpenDBRequest).result
      if (!database.objectStoreNames.contains(ROLLBACK_STORE)) {
        database.createObjectStore(ROLLBACK_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => {
      const idb = req.result
      const tx = idb.transaction(ROLLBACK_STORE, 'readwrite')
      tx.objectStore(ROLLBACK_STORE).put(snapshot)
      tx.oncomplete = () => resolve(snapshotId)
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function getRollbackSnapshots(): Promise<RollbackSnapshot[]> {
  return new Promise((resolve) => {
    const req = indexedDB.open('prompt-gen-rollback', 1)
    req.onupgradeneeded = (e) => {
      const database = (e.target as IDBOpenDBRequest).result
      if (!database.objectStoreNames.contains(ROLLBACK_STORE)) {
        database.createObjectStore(ROLLBACK_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => {
      const idb = req.result
      if (!idb.objectStoreNames.contains(ROLLBACK_STORE)) { resolve([]); return }
      const tx = idb.transaction(ROLLBACK_STORE, 'readonly')
      const getReq = tx.objectStore(ROLLBACK_STORE).getAll()
      getReq.onsuccess = () => resolve((getReq.result || []) as RollbackSnapshot[])
      getReq.onerror = () => resolve([])
    }
    req.onerror = () => resolve([])
  })
}

export async function restoreFromSnapshot(snapshotId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = indexedDB.open('prompt-gen-rollback', 1)
    req.onupgradeneeded = (e) => {
      const database = (e.target as IDBOpenDBRequest).result
      if (!database.objectStoreNames.contains(ROLLBACK_STORE)) {
        database.createObjectStore(ROLLBACK_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = async () => {
      const idb = req.result
      if (!idb.objectStoreNames.contains(ROLLBACK_STORE)) { resolve(false); return }
      const tx = idb.transaction(ROLLBACK_STORE, 'readonly')
      const getReq = tx.objectStore(ROLLBACK_STORE).get(snapshotId)
      getReq.onsuccess = async () => {
        const snapshot = getReq.result as RollbackSnapshot | undefined
        if (!snapshot) { resolve(false); return }
        for (const template of snapshot.templates) {
          await db.putTemplate(template)
        }
        resolve(true)
      }
      getReq.onerror = () => resolve(false)
    }
    req.onerror = () => resolve(false)
  })
}

// ── Apply Update Package ────────────────────────────────────────

export async function applyUpdatePackage(pkg: UpdatePackage): Promise<{ applied: number; skipped: number }> {
  let applied = 0
  let skipped = 0
  const now = Date.now()

  const currentVersion = await getCurrentVersion()
  await createRollbackSnapshot(currentVersion)

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

  const localVersion = pkg.database_version.endsWith('-local')
    ? pkg.database_version
    : `${pkg.database_version}-local`
  const versionEntry: DatabaseVersion = {
    version: localVersion,
    installedAt: now,
    changeCount: applied,
    source: pkg.source || 'ai',
  }
  await db.putVersion(versionEntry)

  return { applied, skipped }
}

// ── GitHub Submission Package ──────────────────────────────────

export interface SubmissionPackage {
  submission_schema_version: 1
  submission_id: string
  base_version: string
  local_version: string
  source: string
  trust_level: TrustLevel
  summary: {
    templates_added: number
    templates_modified: number
    templates_deleted: number
    hinglish_patterns_added: number
    categories_added: number
  }
  changes: UpdateChange[]
}

export function generateSubmissionPackage(
  pkg: UpdatePackage,
  baseVersion: string,
  trustLevel: TrustLevel = 'ai-generated',
): SubmissionPackage {
  const changes = pkg.changes
  const summary = {
    templates_added: changes.filter(c => c.type === 'template' && c.operation === 'add').length,
    templates_modified: changes.filter(c => c.type === 'template' && c.operation === 'update').length,
    templates_deleted: changes.filter(c => c.type === 'template' && c.operation === 'delete').length,
    hinglish_patterns_added: changes.filter(c => c.type === 'hinglish_pattern' && c.operation === 'add').length,
    categories_added: changes.filter(c => c.type === 'category' && c.operation === 'add').length,
  }

  return {
    submission_schema_version: 1,
    submission_id: `sub-${Date.now()}`,
    base_version: baseVersion,
    local_version: pkg.database_version,
    source: pkg.source || 'ai-generated',
    trust_level: trustLevel,
    summary,
    changes,
  }
}

export function generateGitHubIssueUrl(pkg: SubmissionPackage): string {
  const title = `[Database Update] AI-generated proposal — ${pkg.summary.templates_added} templates`
  const body = `## Database Update Submission

**Submission ID:** ${pkg.submission_id}
**Base Version:** ${pkg.base_version}
**Local Version:** ${pkg.local_version}
**Source:** ${pkg.source}
**Trust Level:** ${pkg.trust_level}

### Summary
- Templates Added: ${pkg.summary.templates_added}
- Templates Modified: ${pkg.summary.templates_modified}
- Templates Deleted: ${pkg.summary.templates_deleted}
- Hinglish Patterns Added: ${pkg.summary.hinglish_patterns_added}
- Categories Added: ${pkg.summary.categories_added}

### Changes JSON

\`\`\`json
${JSON.stringify(pkg.changes, null, 2)}
\`\`\`

---
*This submission was generated by the Universal AI Prompt Generator PWA and reviewed by the user before submission.*
`
  return `https://github.com/Tecno2P/universal-ai-prompt-generator/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=database-update,community-contribution,needs-review,ai-generated`
}

export function downloadSubmissionPackage(pkg: SubmissionPackage): void {
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `submission-${pkg.submission_id}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Build Update Request Prompt ─────────────────────────────────

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

// ── Version Management ──────────────────────────────────────────

export async function getCurrentVersion(): Promise<string> {
  const versions = await db.getAllVersions()
  if (versions.length === 0) return '1.0.0'
  return versions.sort((a, b) => b.installedAt - a.installedAt)[0].version
}

export async function getAllVersions(): Promise<DatabaseVersion[]> {
  const versions = await db.getAllVersions()
  return versions.sort((a, b) => b.installedAt - a.installedAt)
}

export async function getOfficialVersion(): Promise<string> {
  const versions = await db.getAllVersions()
  const official = versions
    .filter(v => !v.version.includes('-local'))
    .sort((a, b) => b.installedAt - a.installedAt)[0]
  return official?.version || '1.0.0'
}

export async function getLocalVersion(): Promise<string> {
  return getCurrentVersion()
}

// ── Rollback ────────────────────────────────────────────────────

export async function rollbackToVersion(version: string): Promise<boolean> {
  const snapshots = await getRollbackSnapshots()
  const target = snapshots.find(s => s.version === version)
  if (!target) return false
  return restoreFromSnapshot(target.id)
}
