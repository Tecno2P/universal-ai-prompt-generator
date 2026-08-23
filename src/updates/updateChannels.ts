import type { UpdatePackage } from '@/types'

// ── Update Channels ─────────────────────────────────────────────
// Stable / Beta / Experimental update channels.
//
// Privacy guarantee: experimental updates NEVER silently install.
// They always require explicit user review before being applied, even
// when auto-install is enabled for the channel in principle.

export type UpdateChannel = 'stable' | 'beta' | 'experimental'

export interface ChannelConfig {
  /** The channel identifier. */
  channel: UpdateChannel
  /**
   * Whether updates on this channel may be auto-installed without an
   * explicit per-update review prompt.
   *
   * - stable:   true (subject to user opt-in)
   * - beta:     true (subject to user opt-in)
   * - experimental: ALWAYS false — these updates always require review.
   */
  autoInstall: boolean
}

const CHANNEL_STORAGE_KEY = 'uapg.update.channel'

/**
 * Per-channel version strings.
 *
 * These mirror the semantic version of the database update package
 * published on each channel. Stable tracks the latest released build,
 * beta carries pre-release tags, and experimental carries full
 * experimental suffixes.
 */
export const CHANNEL_VERSIONS: Readonly<Record<UpdateChannel, string>> = {
  stable: '1.2.0',
  beta: '1.3.0-beta.2',
  experimental: '1.4.0-experimental',
}

/**
 * Human-readable labels for each channel, suitable for UI display.
 */
export const CHANNEL_LABELS: Readonly<Record<UpdateChannel, string>> = {
  stable: 'Stable',
  beta: 'Beta',
  experimental: 'Experimental',
}

/**
 * Tailwind-friendly color tokens used for channel badges in the UI.
 * These are plain string class fragments (no CSS framework import
 * required) so they can be consumed directly by badge components.
 */
export const CHANNEL_COLORS: Readonly<Record<UpdateChannel, string>> = {
  stable: 'badge-green',
  beta: 'badge-blue',
  experimental: 'badge-purple',
}

/**
 * Full per-channel configuration, including the auto-install policy.
 *
 * `autoInstall` is derived from the channel: experimental is always
 * false, stable and beta are true *by policy* (the user may still opt
 * out of auto-install globally; that opt-in is tracked elsewhere).
 */
export const CHANNEL_CONFIGS: Readonly<Record<UpdateChannel, ChannelConfig>> = {
  stable: { channel: 'stable', autoInstall: true },
  beta: { channel: 'beta', autoInstall: true },
  experimental: { channel: 'experimental', autoInstall: false },
}

// ── Helpers ─────────────────────────────────────────────────────

function isValidChannel(value: unknown): value is UpdateChannel {
  return value === 'stable' || value === 'beta' || value === 'experimental'
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Read the user's preferred update channel from localStorage.
 *
 * Falls back to `'stable'` when no preference is stored, when
 * localStorage is unavailable (e.g. SSR / restricted environment),
 * or when the stored value is not a recognised channel.
 */
export function getChannel(): UpdateChannel {
  try {
    const stored = localStorage.getItem(CHANNEL_STORAGE_KEY)
    if (isValidChannel(stored)) {
      return stored
    }
  } catch {
    // localStorage may throw in private mode or when access is blocked.
  }
  return 'stable'
}

/**
 * Persist the user's channel preference to localStorage.
 *
 * Silently no-ops (without throwing) when storage is unavailable so
 * callers can invoke it unconditionally from UI handlers.
 */
export function setChannel(channel: UpdateChannel): void {
  try {
    localStorage.setItem(CHANNEL_STORAGE_KEY, channel)
  } catch {
    // Storage unavailable — preference is session-only.
  }
}

/**
 * Resolve the full {@link ChannelConfig} for a channel, always
 * honouring the experimental-always-requires-review invariant.
 */
export function getChannelConfig(channel: UpdateChannel): ChannelConfig {
  // Re-derive defensively so the autoInstall invariant can never be
  // violated even if CHANNEL_CONFIGS were to be tampered with.
  const autoInstall = channel === 'experimental' ? false : CHANNEL_CONFIGS[channel].autoInstall
  return { channel, autoInstall }
}

/**
 * Whether auto-install is permitted for a given channel.
 *
 * - stable:   true (policy allows silent install, user opt-in tracked elsewhere)
 * - beta:     true
 * - experimental: ALWAYS false — explicit review required every time.
 *
 * This is the single source of truth for the privacy invariant.
 */
export function isAutoInstallAllowed(channel: UpdateChannel): boolean {
  if (channel === 'experimental') {
    return false
  }
  return getChannelConfig(channel).autoInstall
}

/**
 * Return the version string published on a given channel.
 *
 * Examples: `'1.2.0'`, `'1.3.0-beta.2'`, `'1.4.0-experimental'`.
 */
export function getChannelVersion(channel: UpdateChannel): string {
  return CHANNEL_VERSIONS[channel]
}

/**
 * Compare two dotted (semver-ish) version strings.
 *
 * Returns a negative number if `a < b`, zero if equal, positive if
 * `a > b`. Non-numeric suffixes (e.g. `-beta.2`) are ignored for the
 * numeric comparison and resolved conservatively: a pre-release of the
 * same numeric triple is considered *older* than its release.
 */
function compareVersions(a: string, b: string): number {
  const parseCore = (v: string): number[] => {
    const core = v.split('-')[0] ?? v
    return core.split('.').map(part => {
      const n = Number.parseInt(part, 10)
      return Number.isNaN(n) ? 0 : n
    })
  }

  const pa = parseCore(a)
  const pb = parseCore(b)
  const len = Math.max(pa.length, pb.length)

  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) {
      return da - db
    }
  }

  // Same numeric core: a release (no suffix) is newer than a pre-release.
  const aPre = a.includes('-')
  const bPre = b.includes('-')
  if (aPre && !bPre) return -1
  if (!aPre && bPre) return 1
  return 0
}

/**
 * Decide whether an update should be offered to the user.
 *
 * An update is offered when the channel's published version is newer
 * than the currently installed one. For the experimental channel this
 * only gates *offering* — even when this returns true, the update must
 * still go through explicit review (see {@link isAutoInstallAllowed}).
 *
 * @param currentVersion The version currently installed locally.
 * @param channel         The channel to check for an available update.
 */
export function shouldOfferUpdate(currentVersion: string, channel: UpdateChannel): boolean {
  const channelVersion = getChannelVersion(channel)
  return compareVersions(channelVersion, currentVersion) > 0
}

/**
 * Return a human-readable label for a channel.
 */
export function channelLabel(channel: UpdateChannel): string {
  return CHANNEL_LABELS[channel]
}

/**
 * Convenience: describe an update package in terms of its channel.
 *
 * Given an {@link UpdatePackage}, infer which channel (if any) it
 * belongs to based on its `database_version` suffix, returning the
 * channel and a boolean indicating whether the inference was certain.
 */
export function inferChannelFromPackage(
  pkg: UpdatePackage,
): { channel: UpdateChannel; certain: boolean } {
  const v = pkg.database_version
  if (v.includes('experimental')) {
    return { channel: 'experimental', certain: true }
  }
  if (v.includes('beta') || v.includes('-rc') || v.includes('-alpha')) {
    return { channel: 'beta', certain: true }
  }
  // Plain version with no pre-release suffix is most likely stable.
  if (/^\d+\.\d+\.\d+$/.test(v)) {
    return { channel: 'stable', certain: true }
  }
  // Anything else (e.g. "-local") is ambiguous; default to stable.
  return { channel: 'stable', certain: false }
}
