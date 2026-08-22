import type {
  PromptTemplate, HinglishPattern, Category,
} from '@/types'
import {
  db,
} from './db'
import { BUILTIN_TEMPLATES } from '@/data/templates'
import { BUILTIN_HINGLISH_PATTERNS } from '@/data/hinglish'
import { BUILTIN_CATEGORIES } from '@/data/categories'

let initialized = false

export async function seedDatabase(force = false): Promise<void> {
  if (initialized && !force) return
  const cats = await db.getAllCategories()
  if (force || cats.length === 0) {
    await db.bulkPutCategories(BUILTIN_CATEGORIES as Category[])
    await db.bulkPutTemplates(BUILTIN_TEMPLATES as PromptTemplate[])
    await db.bulkPutHinglishPatterns(BUILTIN_HINGLISH_PATTERNS as HinglishPattern[])
    await db.putVersion({
      version: '1.0.0',
      installedAt: Date.now(),
      changeCount: BUILTIN_TEMPLATES.length,
      source: 'builtin',
    })
  }
  initialized = true
}

export async function getCurrentVersion(): Promise<string> {
  const versions = await db.getAllVersions()
  if (versions.length === 0) return '1.0.0'
  return versions.sort((a, b) => b.installedAt - a.installedAt)[0].version
}

export async function getAllVersions() {
  return (await db.getAllVersions()).sort((a, b) => b.installedAt - a.installedAt)
}
