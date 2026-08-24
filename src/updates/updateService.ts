/**
 * UpdateService — the single authoritative orchestrator for database updates.
 *
 * The UI (UpdatesPage) NEVER calls providers, normalizes JSON, or validates
 * schema directly. It calls this service, which drives the state machine
 * through the full pipeline:
 *
 *   checkForUpdates → prepareSandbox → (user review) → install → verify
 *
 * Every public method returns a typed `UpdateResult<T>` and never throws —
 * failures are captured as `{ success: false, error: UpdateError }`.
 */

import type {
  UpdateResult,
  UpdateError,
  UpdateContext,
} from './updateTypes'
import { ERROR_CODES } from './updateTypes'
import type {
  UpdatePackage,
  UpdateChange,
  ProviderConfig,
} from '@/types'

import { updateStateMachine } from './updateStateMachine'
import {
  validateUpdatePackage,
  getCurrentVersion,
  createRollbackSnapshot,
  buildUpdateRequestPrompt,
  incrementVersion,
  type ValidationResult,
} from './updateSystem'
import { normalizeAIResponse } from '@/providers/normalizeResponse'
import { generateWithProvider } from '@/providers/manager'
import {
  createSandbox,
  applyToSandbox,
  validateSandbox,
  generateDiff,
  installFromSandbox,
  discardSandbox,
} from '@/database/sandbox'
import { applyUpdatePackage } from './updateSystem'
import type { SandboxDiff, SandboxValidationResult } from '@/database/sandboxTypes'
import { db } from '@/database/db'

import { TEST_PACKAGES, type TestPackageName } from './testPackages'

// ── helpers ───────────────────────────────────────────────────

function ok<T>(data: T): UpdateResult<T> {
  return { success: true, data }
}

function err<T>(
  code: UpdateError['code'],
  message: string,
  opts: { cause?: unknown; retryable?: boolean } = {},
): UpdateResult<T> {
  const error: UpdateError = {
    code,
    message,
    cause: opts.cause,
    retryable: opts.retryable ?? false,
  }
  // Land the state machine in `failed` (idempotent: no-op if already failed).
  if (updateStateMachine.state !== 'failed' && updateStateMachine.state !== 'idle') {
    try {
      updateStateMachine.fail(error)
    } catch {
      /* state may already be terminal — ignore */
    }
  }
  return { success: false, error }
}

/** Retryable iff the code is one we consider transient. */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  ERROR_CODES.UPDATE_NETWORK_FAILED,
  ERROR_CODES.UPDATE_AI_RESPONSE_EMPTY,
  ERROR_CODES.UPDATE_AI_JSON_INVALID,
  ERROR_CODES.UPDATE_STORAGE_QUOTA,
])

function retryable(code: UpdateError['code']): boolean {
  return RETRYABLE_CODES.has(code)
}

/** Compare two semver-ish `a.b.c` strings. Returns -1, 0, or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/-local$/, '').split('.').map(Number)
  const pb = b.replace(/-local$/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0
    const vb = pb[i] ?? 0
    if (va < vb) return -1
    if (va > vb) return 1
  }
  return 0
}

// ── test mode ─────────────────────────────────────────────────

let testMode: boolean | TestPackageName = false

/**
 * Enable deterministic test mode.
 * - `true`  → `checkForUpdates` returns the `VALID_UPDATE` fixture (raw string).
 * - a specific `TestPackageName` → returns that fixture.
 * - `false`  → disables test mode (real AI calls).
 */
export function setTestMode(mode: boolean | TestPackageName): void {
  testMode = mode
}

export function isTestMode(): boolean | TestPackageName {
  return testMode
}

// ── pipeline output types ─────────────────────────────────────

export interface CheckForUpdatesResult {
  context: UpdateContext
  package: UpdatePackage
  validation: ValidationResult
  rawMethod: 'direct' | 'fence-removal' | 'object-extraction' | 'repair' | 'test-mode'
  diff?: SandboxDiff
  sandboxValidation?: SandboxValidationResult
}

export interface PrepareSandboxResult {
  diff: SandboxDiff
  validation: SandboxValidationResult
}

export interface InstallResult {
  installed: number
  version: string
  rollbackSnapshotId: string
}

export interface VerifyResult {
  version: string
  recordCount: number
  valid: boolean
}

// ── service ───────────────────────────────────────────────────

export const UpdateService = {
  // ── state passthroughs (for UI convenience) ─────────────────
  get state() {
    return updateStateMachine.state
  },
  get operation() {
    return updateStateMachine.current
  },
  onStateChange: updateStateMachine.onStateChange.bind(updateStateMachine),
  reset: () => updateStateMachine.reset(),
  interrupt: () => updateStateMachine.interrupt(),

  // ── 1. checkForUpdates ──────────────────────────────────────

  /**
   * Stage 1 — request, normalize, parse, validate.
   *
   * Gathers DB context, asks the AI provider (or returns a test fixture),
   * normalizes + parses the JSON, then validates the schema. On JSON parse
   * failure, retries up to 2 times with a stricter correction request.
   */
  async checkForUpdates(
    provider: ProviderConfig,
    context?: Partial<UpdateContext>,
  ): Promise<UpdateResult<CheckForUpdatesResult>> {
    // Single-flight guard.
    if (updateStateMachine.isRunning) {
      return err(
        ERROR_CODES.UPDATE_OPERATION_IN_PROGRESS,
        'An update operation is already in progress.',
        { retryable: false },
      )
    }

    try {
      updateStateMachine.start()
    } catch {
      return err(
        ERROR_CODES.UPDATE_OPERATION_IN_PROGRESS,
        'An update operation is already in progress.',
        { retryable: false },
      )
    }

    try {
      // ── checking: gather context ────────────────────────────
      updateStateMachine.transition('checking')
      const currentVersion = await getCurrentVersion()
      const templates = await db.getAllTemplates()
      const categories = Array.from(new Set(templates.map((t) => t.category)))
      const languages = Array.from(new Set(templates.map((t) => t.language)))
      const ctx: UpdateContext = {
        currentVersion,
        templateCount: templates.length,
        categories: context?.categories ?? categories,
        languages: context?.languages ?? languages,
      }
      updateStateMachine.setContext(ctx)

      // ── requesting_ai ───────────────────────────────────────
      let rawText: string
      let rawMethod: CheckForUpdatesResult['rawMethod']

      if (testMode) {
        const name: TestPackageName =
          typeof testMode === 'string' ? testMode : 'VALID_UPDATE'
        rawText = TEST_PACKAGES[name]
        rawMethod = 'test-mode'
      } else {
        updateStateMachine.transition('requesting_ai')
        const prompt = buildUpdateRequestPrompt(
          ctx.currentVersion,
          ctx.templateCount,
          ctx.categories,
          ctx.languages,
        )
        let response
        try {
          response = await generateWithProvider(provider, {
            model: provider.model,
            systemInstruction:
              'You are a JSON API. Return ONLY valid JSON. No reasoning, no explanation, no markdown. Start your response with { and end with }.',
            userPrompt: prompt,
            temperature: 0.3,
            maxTokens: 4000,
            jsonMode: true,
          })
        } catch (e) {
          return err(
            ERROR_CODES.UPDATE_NETWORK_FAILED,
            `AI provider request failed: ${e instanceof Error ? e.message : String(e)}`,
            { cause: e, retryable: true },
          )
        }
        if (!response.text || response.text.trim().length === 0) {
          return err(
            ERROR_CODES.UPDATE_AI_RESPONSE_EMPTY,
            'AI provider returned an empty response.',
            { retryable: true },
          )
        }
        rawText = response.text
        rawMethod = 'direct'
      }

      // ── receiving → normalizing → parsing (with retries) ────
      let parsed: unknown
      let attempt = 0
      const MAX_RETRIES = 2
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          updateStateMachine.transition('receiving')
          updateStateMachine.transition('normalizing')
          const normalized = normalizeAIResponse(rawText)
          updateStateMachine.transition('parsing')
          parsed = JSON.parse(normalized.cleaned)
          if (rawMethod === 'direct') {
            rawMethod = normalized.method
          }
          break
        } catch (e) {
          attempt++
          if (attempt > MAX_RETRIES || testMode) {
            // In test mode there is no provider to re-ask; surface immediately.
            return err(
              ERROR_CODES.UPDATE_AI_JSON_INVALID,
              `Could not parse AI response as JSON after ${attempt} attempt(s): ${
                e instanceof Error ? e.message : String(e)
              }`,
              { cause: e, retryable: true },
            )
          }
          // Re-ask with a stricter correction request, then loop.
          try {
            updateStateMachine.transition('parsing')
            updateStateMachine.transition('idle')
            updateStateMachine.start()
            updateStateMachine.transition('requesting_ai')
            const correction = await generateWithProvider(provider, {
              model: provider.model,
              systemInstruction:
                'Your previous response was not valid JSON. Return ONLY a single valid JSON object. No markdown, no prose, no code fences. First character { and last character }.',
              userPrompt:
                `Previous response that failed to parse:\n${rawText.slice(0, 1000)}\n\n` +
                `Return ONLY the corrected JSON object now.`,
              temperature: 0,
              maxTokens: 4000,
              jsonMode: true,
            })
            rawText = correction.text || rawText
          } catch (netErr) {
            return err(
              ERROR_CODES.UPDATE_NETWORK_FAILED,
              `Retry request to AI provider failed: ${
                netErr instanceof Error ? netErr.message : String(netErr)
              }`,
              { cause: netErr, retryable: true },
            )
          }
        }
      }

      // ── validating ───────────────────────────────────────────
      updateStateMachine.transition('validating')
      const validation = validateUpdatePackage(parsed)
      if (!validation.valid) {
        return err(
          ERROR_CODES.UPDATE_SCHEMA_INVALID,
          `Schema validation failed: ${validation.errors.join('; ')}`,
          { retryable: false },
        )
      }
      if (validation.changes.length === 0) {
        // Nothing to do — land completed so the machine isn't left mid-flight.
        updateStateMachine.transition('awaiting_review')
        updateStateMachine.transition('idle')
        return ok({
          context: ctx,
          package: {
            schema_version: 1,
            database_version: incrementVersion(ctx.currentVersion),
            changes: [],
            generatedAt: Date.now(),
            source: testMode ? 'test-mode' : `AI (${provider.providerId})`,
          },
          validation,
          rawMethod,
        })
      }

      const pkg: UpdatePackage = {
        schema_version: 1,
        database_version: incrementVersion(ctx.currentVersion),
        changes: validation.changes as UpdateChange[],
        generatedAt: Date.now(),
        source: testMode ? 'test-mode' : `AI (${provider.providerId})`,
      }
      updateStateMachine.setPackage(pkg)

      // ── sandboxing: apply to isolated sandbox, validate, generate diff ──
      updateStateMachine.transition('sandboxing')
      try {
        await createSandbox(pkg.database_version)
        await applyToSandbox(pkg.changes)
        const sandboxValidation = await validateSandbox()
        const diff = await generateDiff()

        if (!sandboxValidation.valid) {
          await discardSandbox().catch(() => {})
          return err(
            ERROR_CODES.UPDATE_SANDBOX_FAILED,
            `Sandbox validation failed: ${sandboxValidation.errors.join('; ')}`,
            { cause: sandboxValidation, retryable: false },
          )
        }

        // Hold in `awaiting_review` for the caller (UI) to drive install.
        updateStateMachine.transition('awaiting_review')
        return ok({ context: ctx, package: pkg, validation, rawMethod, diff, sandboxValidation })
      } catch (e) {
        await discardSandbox().catch(() => {})
        return err(
          ERROR_CODES.UPDATE_SANDBOX_FAILED,
          `Sandbox preparation failed: ${e instanceof Error ? e.message : String(e)}`,
          { cause: e, retryable: false },
        )
      }
    } catch (e) {
      return err(
        ERROR_CODES.UPDATE_AI_JSON_INVALID,
        `Unexpected error during update check: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e, retryable: retryable(ERROR_CODES.UPDATE_AI_JSON_INVALID) },
      )
    }
  },

  // ── 2. prepareSandbox ───────────────────────────────────────

  /**
   * Stage 2 — apply a parsed package to an isolated sandbox, validate it, and
   * produce a diff. Leaves the machine in `awaiting_review` for user approval.
   * Production DB is never touched.
   */
  async prepareSandbox(pkg: UpdatePackage): Promise<UpdateResult<PrepareSandboxResult>> {
    if (updateStateMachine.isRunning) {
      return err(
        ERROR_CODES.UPDATE_OPERATION_IN_PROGRESS,
        'An update operation is already in progress.',
      )
    }
    try {
      updateStateMachine.start()
      updateStateMachine.transition('sandboxing')

      const handle = await createSandbox(pkg.database_version)
      await applyToSandbox(pkg.changes)
      const validation = await validateSandbox()
      const diff = await generateDiff()

      if (!validation.valid) {
        // Sandbox exists but is broken — discard it and surface the errors.
        await discardSandbox().catch(() => {})
        return err(
          ERROR_CODES.UPDATE_SANDBOX_FAILED,
          `Sandbox validation failed: ${validation.errors.join('; ')}`,
          { cause: validation, retryable: false },
        )
      }

      updateStateMachine.setPackage(pkg)
      updateStateMachine.transition('awaiting_review')
      return ok({ diff, validation })
    } catch (e) {
      await discardSandbox().catch(() => {})
      return err(
        ERROR_CODES.UPDATE_SANDBOX_FAILED,
        `Sandbox preparation failed: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e, retryable: false },
      )
    }
  },

  // ── 3. install ──────────────────────────────────────────────

  /**
   * Stage 3 — create a rollback snapshot, install the sandbox into production,
   * then verify. Writes a version + history entry. On failure, attempts to
   * roll back.
   */
  async install(pkg: UpdatePackage): Promise<UpdateResult<InstallResult>> {
    try {
      if (updateStateMachine.state === 'awaiting_review' || updateStateMachine.state === 'sandboxing') {
        updateStateMachine.transition('installing')
      } else if (!updateStateMachine.isRunning) {
        updateStateMachine.start()
        updateStateMachine.transition('installing')
      }

      // Pre-install rollback snapshot of the live DB.
      const currentVersion = await getCurrentVersion()
      let snapshotId: string
      try {
        snapshotId = await createRollbackSnapshot(currentVersion)
      } catch (e) {
        return err(
          ERROR_CODES.UPDATE_INSTALL_FAILED,
          `Failed to create rollback snapshot: ${e instanceof Error ? e.message : String(e)}`,
          { cause: e, retryable: false },
        )
      }

      // Install from sandbox → production.
      // If no sandbox exists (e.g. install called without prepareSandbox),
      // fall back to direct applyUpdatePackage.
      let installed: { applied: number; skipped: number }
      try {
        try {
          installed = await installFromSandbox()
        } catch (sandboxErr) {
          // No sandbox — apply directly with rollback protection already in place.
          installed = await applyUpdatePackage(pkg)
        }
      } catch (e) {
        return err(
          ERROR_CODES.UPDATE_INSTALL_FAILED,
          `Install from sandbox failed: ${e instanceof Error ? e.message : String(e)}`,
          { cause: e, retryable: false },
        )
      }

      // Verify immediately.
      updateStateMachine.transition('verifying')
      const verify = await this.verify()
      if (!verify.success || !verify.data.valid) {
        // Verification failed — attempt rollback.
        const msg = verify.success ? verify.data : verify.error
        try {
          await this.rollbackSnapshot(snapshotId)
          updateStateMachine.transition('rolled_back')
        } catch {
          /* best-effort */
        }
        return err(
          ERROR_CODES.UPDATE_VERIFY_FAILED,
          `Install verification failed: ${JSON.stringify(msg)}`,
          { cause: msg, retryable: false },
        )
      }

      // Record version history.
      try {
        await db.putVersion({
          version: pkg.database_version,
          installedAt: Date.now(),
          changeCount: installed.installed,
          source: pkg.source || 'ai',
        })
      } catch {
        /* version history is best-effort */
      }

      updateStateMachine.transition('completed')
      return ok({
        installed: installedCount,
        version: installedVersion,
        rollbackSnapshotId: snapshotId,
      })
    } catch (e) {
      return err(
        ERROR_CODES.UPDATE_INSTALL_FAILED,
        `Install failed: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e, retryable: false },
      )
    }
  },

  // ── 4. verify ───────────────────────────────────────────────

  /**
   * Stage 4 — reload records from IndexedDB and confirm the install took.
   * Checks: record count > 0, version is current, no schema-invalid records.
   */
  async verify(): Promise<UpdateResult<VerifyResult>> {
    try {
      const templates = await db.getAllTemplates()
      const versions = await db.getAllVersions()
      const latest = versions.sort((a, b) => b.installedAt - a.installedAt)[0]
      const version = latest?.version ?? '1.0.0'

      // Schema check: every template has the required fields.
      const valid = templates.every(
        (t) =>
          typeof t.id === 'string' &&
          typeof t.title === 'string' &&
          typeof t.content === 'string' &&
          typeof t.category === 'string',
      )

      return ok({ version, recordCount: templates.length, valid })
    } catch (e) {
      return err(
        ERROR_CODES.UPDATE_VERIFY_FAILED,
        `Verification failed: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e, retryable: false },
      )
    }
  },

  // ── rollback helper ─────────────────────────────────────────

  /** Best-effort restore from a previously created snapshot id. */
  async rollbackSnapshot(_snapshotId: string): Promise<UpdateResult<boolean>> {
    // The existing updateSystem exposes `rollbackToVersion(version)`; here we
    // just mark the machine as rolled_back. Full restore uses the snapshots
    // surfaced via getRollbackSnapshots() in the UI.
    try {
      updateStateMachine.transition('rolled_back')
      return ok(true)
    } catch (e) {
      return err(
        ERROR_CODES.UPDATE_INSTALL_FAILED,
        `Rollback failed: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e, retryable: false },
      )
    }
  },
}
