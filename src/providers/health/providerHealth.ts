/**
 * Provider Health Monitor
 *
 * Tracks the health/availability status of configured AI providers. This is a
 * *monitor only*: it never automatically fails over to another provider unless
 * the caller explicitly opts in. API keys are never exposed — health checks
 * delegate to the adapter layer, and persisted results store only status +
 * latency, never credentials.
 *
 * Results live in an in-memory Map. They may optionally be mirrored to
 * localStorage so a restart shows the last-known status without re-pinging
 * every provider, but the Map is always the source of truth at runtime.
 */

import type { ProviderConfig, AIProvider } from '@/types'
import type { AdapterContext } from '../interface'
import { getProviderById } from '../registry'
import { getAdapter } from '../manager'
import { getCredential } from '@/services/credentialService'

// ── Status model ────────────────────────────────────────────────

export type ProviderHealthStatus =
  | 'Unknown'
  | 'Available'
  | 'Slow'
  | 'Rate Limited'
  | 'Authentication Error'
  | 'Unavailable'
  | 'Disabled'

/** Latency threshold (ms) above which a successful response is flagged "Slow". */
export const SLOW_THRESHOLD_MS = 4000
/** Health-check request timeout (ms). */
export const HEALTH_CHECK_TIMEOUT_MS = 10000
/** Min interval between manual checks for the same provider (ms). */
export const MIN_CHECK_INTERVAL_MS = 5000

export interface ProviderHealthRecord {
  providerId: string
  configId: string
  status: ProviderHealthStatus
  /** Round-trip latency of the last probe, in ms (undefined if never probed). */
  latencyMs?: number
  /** Epoch ms of the last probe. */
  checkedAt?: number
  /** Epoch ms of the last successful probe. */
  lastSuccessAt?: number
  /** Consecutive failure count (resets on success). */
  consecutiveFailures: number
  /** Human-readable detail from the last probe (no secrets ever). */
  message?: string
  /** Whether periodic checks are currently covering this provider. */
  periodic: boolean
}

// ── Internal storage ────────────────────────────────────────────

const STORAGE_KEY = 'uapg:provider-health:v1'
const MAX_HISTORY = 200

function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function readPersisted(): Record<string, ProviderHealthRecord> {
  if (!hasLocalStorage()) return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, ProviderHealthRecord>
  } catch {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    return {}
  }
}

function writePersisted(map: Map<string, ProviderHealthRecord>): void {
  if (!hasLocalStorage()) return
  try {
    const obj: Record<string, ProviderHealthRecord> = {}
    for (const [k, v] of map) obj[k] = v
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
  } catch { /* quota / private mode — best effort */ }
}

// Keyed by providerId (the registry id, e.g. "openai"). A single provider
// type can back several ProviderConfig rows; we track the most recent probe
// per providerId so the UI shows one health bar per provider family.
const healthMap = new Map<string, ProviderHealthRecord>()

// Hydrate the in-memory map from localStorage on module load (best-effort).
// We keep the persisted record's `periodic` flag false on load — periodic
// checks are a runtime decision and are never silently restored.
void (() => {
  const persisted = readPersisted()
  for (const [id, rec] of Object.entries(persisted)) {
    healthMap.set(id, { ...rec, periodic: false })
  }
})()

// ── Periodic-check scheduling ───────────────────────────────────

let periodicTimer: ReturnType<typeof setInterval> | null = null
let periodicIntervalMs = 60000
/** Configs to probe on each periodic tick. Set via enablePeriodicChecks. */
let periodicConfigs: ProviderConfig[] = []

/** When true, an available-but-slow provider triggers no failover action. */
let autoFailoverEnabled = false

/**
 * Failover hook. When auto-failover is enabled and a provider becomes
 * Unavailable / Rate Limited, this callback is invoked with the failing
 * providerId and the next candidate providerId to try. The caller wires the
 * actual provider switch; the monitor only *signals*.
 */
type FailoverHandler = (
  failingProviderId: string,
  candidates: string[],
) => void

let failoverHandler: FailoverHandler | null = null

export function setFailoverHandler(handler: FailoverHandler | null): void {
  failoverHandler = handler
}

export function setAutoFailover(enabled: boolean): void {
  autoFailoverEnabled = enabled
}

export function isAutoFailoverEnabled(): boolean {
  return autoFailoverEnabled
}

// ── Adapter context construction ────────────────────────────────

/**
 * Build an adapter context for a provider config WITHOUT exposing the key to
 * this module's callers. Mirrors manager.createContext but stays local so the
 * health monitor has no hard dependency on the manager's export surface.
 */
async function buildContext(config: ProviderConfig): Promise<AdapterContext | null> {
  const provider: AIProvider | undefined = getProviderById(config.providerId)
  if (!provider) return null

  const credential = await getCredential(config.providerId)
  const apiKey = credential?.apiKey || undefined

  return {
    config: { ...config, apiKey },
    provider,
  }
}

// ── HTTP-status → health-status mapping ──────────────────────────

function classifyStatus(
  ok: boolean,
  latencyMs: number,
  httpStatus?: number,
  errorMessage?: string,
): { status: ProviderHealthStatus; message: string } {
  if (!ok) {
    if (httpStatus === 401 || httpStatus === 403) {
      return { status: 'Authentication Error', message: 'API key rejected by provider' }
    }
    if (httpStatus === 429) {
      return { status: 'Rate Limited', message: 'Provider rate limit hit' }
    }
    if (httpStatus === 404) {
      return { status: 'Unavailable', message: 'Endpoint or model not found' }
    }
    if (httpStatus !== undefined && httpStatus >= 500) {
      return { status: 'Unavailable', message: `Provider server error (${httpStatus})` }
    }
    const msg = errorMessage || 'Provider did not respond'
    if (/timeout|timed?\s*out/i.test(msg)) {
      return { status: 'Slow', message: 'Request timed out' }
    }
    if (/network|fetch|failed to fetch|cors/i.test(msg)) {
      return { status: 'Unavailable', message: 'Network error reaching provider' }
    }
    return { status: 'Unavailable', message: msg }
  }
  if (latencyMs > SLOW_THRESHOLD_MS) {
    return { status: 'Slow', message: `High latency (${Math.round(latencyMs)} ms)` }
  }
  return { status: 'Available', message: 'Healthy' }
}

/** Extract an HTTP status from a thrown adapter error, if present. */
function extractHttpStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'status' in err) {
    const s = (err as { status?: unknown }).status
    if (typeof s === 'number') return s
  }
  return undefined
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

// ── Core health probe ───────────────────────────────────────────

/**
 * Run a minimal test request against a provider and record the result.
 * The probe delegates to the provider's adapter `testConnection`, which sends
 * a tiny "Say OK" request — cheap and provider-agnostic. Latency is measured
 * around the call.
 *
 * Resolves to the updated record. Never throws: a failed probe is itself a
 * valid health result.
 */
export async function checkProviderHealth(
  config: ProviderConfig,
): Promise<ProviderHealthRecord> {
  // Throttle: ignore manual checks fired too close together.
  const existing = healthMap.get(config.providerId)
  const now = Date.now()
  if (
    existing?.checkedAt &&
    now - existing.checkedAt < MIN_CHECK_INTERVAL_MS &&
    !existing.periodic
  ) {
    return existing
  }

  if (!config.connected) {
    return upsert(config, {
      status: 'Disabled',
      message: 'Provider is not connected',
    })
  }

  const provider = getProviderById(config.providerId)
  if (!provider) {
    return upsert(config, {
      status: 'Unavailable',
      message: `Unknown provider id: ${config.providerId}`,
    })
  }

  const ctx = await buildContext(config)
  if (!ctx) {
    return upsert(config, {
      status: 'Unavailable',
      message: 'No adapter available for provider',
    })
  }
  if (!ctx.config.apiKey && provider.authType !== 'none') {
    return upsert(config, {
      status: 'Authentication Error',
      message: 'No API key available — provider may be locked',
    })
  }

  const adapter = getAdapter(config.providerId)
  if (!adapter) {
    return upsert(config, {
      status: 'Unavailable',
      message: 'No adapter registered for provider',
    })
  }

  const start = performance.now()
  let ok = false
  let httpStatus: number | undefined
  let message: string | undefined

  // Race the probe against a timeout so a hung request can't block periodic
  // checks indefinitely.
  const probe = new Promise<boolean>((resolve) => {
    adapter
      .testConnection(ctx)
      .then((res: boolean) => resolve(res))
      .catch((err: unknown) => {
        httpStatus = extractHttpStatus(err)
        message = errorMessage(err)
        resolve(false)
      })
  })

  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => {
      message = 'Health check timed out'
      resolve(false)
    }, HEALTH_CHECK_TIMEOUT_MS)
  })

  ok = await Promise.race([probe, timeout])
  const latencyMs = performance.now() - start

  const { status, message: clsMessage } = classifyStatus(ok, latencyMs, httpStatus, message)

  const record = upsert(config, {
    status,
    latencyMs: Math.round(latencyMs),
    checkedAt: Date.now(),
    message: ok ? clsMessage : (message || clsMessage),
    onSuccess: ok,
  })

  maybeTriggerFailover(config.providerId, status)
  return record
}

// ── Record upsert ───────────────────────────────────────────────

interface UpsertFields {
  status: ProviderHealthStatus
  latencyMs?: number
  checkedAt?: number
  message?: string
  onSuccess?: boolean
}

function upsert(config: ProviderConfig, fields: UpsertFields): ProviderHealthRecord {
  const now = Date.now()
  const prev = healthMap.get(config.providerId)
  const periodic = prev?.periodic ?? false

  const record: ProviderHealthRecord = {
    providerId: config.providerId,
    configId: config.id,
    status: fields.status,
    latencyMs: fields.latencyMs ?? prev?.latencyMs,
    checkedAt: fields.checkedAt ?? now,
    lastSuccessAt: fields.onSuccess ? now : prev?.lastSuccessAt,
    consecutiveFailures: fields.onSuccess ? 0 : (prev?.consecutiveFailures ?? 0) + 1,
    message: fields.message,
    periodic,
  }

  healthMap.set(config.providerId, record)
  writePersisted(healthMap)
  return record
}

// ── Read API ────────────────────────────────────────────────────

/** Return the last known health record for a provider (Unknown if never probed). */
export function getHealthStatus(providerId: string): ProviderHealthRecord {
  return (
    healthMap.get(providerId) ?? {
      providerId,
      configId: '',
      status: 'Unknown',
      consecutiveFailures: 0,
      periodic: false,
    }
  )
}

/** Return all currently-tracked provider health records. */
export function getAllHealthStatuses(): ProviderHealthRecord[] {
  return Array.from(healthMap.values())
}

/** Convenience: is the provider currently in a usable state? */
export function isProviderAvailable(providerId: string): boolean {
  const rec = healthMap.get(providerId)
  return rec?.status === 'Available' || rec?.status === 'Slow'
}

// ── Manual override ─────────────────────────────────────────────

/** Allow the UI to mark a provider Disabled without a probe. */
export function markDisabled(providerId: string): ProviderHealthRecord {
  const prev = healthMap.get(providerId)
  const record: ProviderHealthRecord = {
    providerId,
    configId: prev?.configId ?? '',
    status: 'Disabled',
    checkedAt: Date.now(),
    consecutiveFailures: prev?.consecutiveFailures ?? 0,
    periodic: prev?.periodic ?? false,
    message: 'Manually disabled',
  }
  healthMap.set(providerId, record)
  writePersisted(healthMap)
  return record
}

/** Clear a provider's health record (e.g. after it is removed from settings). */
export function clearHealthStatus(providerId: string): void {
  healthMap.delete(providerId)
  writePersisted(healthMap)
}

// ── Periodic monitoring ─────────────────────────────────────────

/**
 * Enable periodic health checks. On each interval, every config in `configs`
 * is probed. Does NOT auto-failover unless {@link setAutoFailover} is also on.
 *
 * @param intervalMs  Interval between check cycles (clamped to >= 10s).
 * @param configs     Provider configs to monitor. If omitted, the previously
 *                    registered configs are reused.
 */
export function enablePeriodicChecks(
  intervalMs: number,
  configs?: ProviderConfig[],
): void {
  const clamped = Math.max(10_000, intervalMs)
  if (configs) periodicConfigs = configs
  // Mark tracked providers as periodic so throttling doesn't suppress ticks.
  for (const c of periodicConfigs) {
    const prev = healthMap.get(c.providerId)
    if (prev) healthMap.set(c.providerId, { ...prev, periodic: true })
  }

  if (periodicTimer) clearInterval(periodicTimer)
  periodicIntervalMs = clamped
  periodicTimer = setInterval(() => {
    void runPeriodicCycle()
  }, periodicIntervalMs)
}

/** Stop periodic monitoring. Per-provider `periodic` flags are cleared. */
export function disablePeriodicChecks(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer)
    periodicTimer = null
  }
  for (const [id, rec] of healthMap) {
    if (rec.periodic) healthMap.set(id, { ...rec, periodic: false })
  }
  writePersisted(healthMap)
}

/** Whether periodic checks are currently running. */
export function isPeriodicChecksEnabled(): boolean {
  return periodicTimer !== null
}

/** Replace the set of configs monitored by the periodic cycle. */
export function setPeriodicConfigs(configs: ProviderConfig[]): void {
  periodicConfigs = configs
}

/** Current periodic-check interval (ms), or 0 if disabled. */
export function getPeriodicIntervalMs(): number {
  return periodicTimer ? periodicIntervalMs : 0
}

async function runPeriodicCycle(): Promise<void> {
  // Probe sequentially to avoid stampeding all providers at once and to keep
  // the failure mode of one provider from hiding another's result.
  for (const config of periodicConfigs) {
    try {
      await checkProviderHealth(config)
    } catch {
      // checkProviderHealth is designed not to throw, but guard anyway.
    }
  }
}

// ── Failover signaling (opt-in only) ─────────────────────────────

const FAILABLE_STATUSES: ReadonlySet<ProviderHealthStatus> = new Set<ProviderHealthStatus>([
  'Unavailable',
  'Rate Limited',
  'Authentication Error',
])

/**
 * If auto-failover is enabled and a provider just entered a failable state,
 * compute candidate providers (other tracked providers that are Available/Slow)
 * and invoke the registered failover handler. The monitor itself never switches
 * the active provider — it only signals.
 */
function maybeTriggerFailover(
  failingProviderId: string,
  status: ProviderHealthStatus,
): void {
  if (!autoFailoverEnabled || !failoverHandler) return
  if (!FAILABLE_STATUSES.has(status)) return

  const candidates: string[] = []
  for (const [id, rec] of healthMap) {
    if (id === failingProviderId) continue
    if (rec.status === 'Available' || rec.status === 'Slow') {
      candidates.push(id)
    }
  }
  failoverHandler(failingProviderId, candidates)
}

// ── Maintenance ─────────────────────────────────────────────────

/** Drop records for providerIds no longer present in `activeIds`. */
export function pruneStaleRecords(activeIds: ReadonlySet<string>): number {
  let removed = 0
  for (const id of [...healthMap.keys()]) {
    if (!activeIds.has(id)) {
      healthMap.delete(id)
      removed++
    }
  }
  if (removed > 0) writePersisted(healthMap)
  return removed
}

/** Truncate persisted history to the last MAX_HISTORY records. */
export function compactHistory(): void {
  if (healthMap.size <= MAX_HISTORY) return
  const sorted = [...healthMap.entries()].sort(
    ([, a], [, b]) => (b.checkedAt ?? 0) - (a.checkedAt ?? 0),
  )
  const keep = sorted.slice(0, MAX_HISTORY)
  healthMap.clear()
  for (const [id, rec] of keep) healthMap.set(id, rec)
  writePersisted(healthMap)
}
