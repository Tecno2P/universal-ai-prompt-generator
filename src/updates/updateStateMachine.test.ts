import { describe, it, expect, beforeEach } from 'vitest'
import { updateStateMachine } from './updateStateMachine'
import type { UpdateState } from './updateTypes'

describe('updateStateMachine', () => {
  beforeEach(() => {
    if (updateStateMachine.isRunning) updateStateMachine.interrupt()
    try {
      updateStateMachine.reset()
    } catch {
      /* already idle */
    }
  })

  /** Drive the machine along the happy path until it reaches `target`. */
  function reach(target: UpdateState): void {
    updateStateMachine.start() // → checking
    updateStateMachine.transition('requesting_ai')
    updateStateMachine.transition('receiving')
    updateStateMachine.transition('normalizing')
    updateStateMachine.transition('parsing')
    updateStateMachine.transition('validating')
    if (target === 'validating') return
    updateStateMachine.transition('sandboxing')
    updateStateMachine.transition('awaiting_review')
    if (target === 'awaiting_review' || target === 'rolled_back') {
      if (target === 'rolled_back') updateStateMachine.transition('rolled_back')
      return
    }
    updateStateMachine.transition('installing')
    updateStateMachine.transition('verifying')
    if (target === 'verifying') return
    updateStateMachine.transition('completed')
  }

  // ── valid transitions ────────────────────────────────────────

  it('starts in idle and moves into checking via start()', () => {
    expect(updateStateMachine.state).toBe('idle')
    const op = updateStateMachine.start()
    expect(op.state).toBe('checking')
    expect(updateStateMachine.state).toBe('checking')
  })

  it('walks the full happy-path sequence', () => {
    reach('completed')
    expect(updateStateMachine.state).toBe('completed')
  })

  it('allows awaiting_review → rolled_back (user rejects)', () => {
    reach('awaiting_review')
    updateStateMachine.transition('rolled_back')
    expect(updateStateMachine.state).toBe('rolled_back')
  })

  it('allows failed → idle (retry from failure)', () => {
    updateStateMachine.start()
    updateStateMachine.transition('requesting_ai')
    updateStateMachine.fail({ code: 'UPDATE_AI_JSON_INVALID', message: 'x', retryable: true })
    expect(updateStateMachine.state).toBe('failed')
    updateStateMachine.reset()
    expect(updateStateMachine.state).toBe('idle')
  })

  it('allows failed → checking (restart after failure)', () => {
    updateStateMachine.start()
    updateStateMachine.transition('requesting_ai')
    updateStateMachine.fail({ code: 'UPDATE_NETWORK_FAILED', message: 'x', retryable: true })
    updateStateMachine.transition('checking')
    expect(updateStateMachine.state).toBe('checking')
  })

  it('allows interrupted → rolled_back', () => {
    updateStateMachine.start()
    updateStateMachine.transition('requesting_ai')
    updateStateMachine.transition('receiving')
    updateStateMachine.interrupt()
    expect(updateStateMachine.state).toBe('interrupted')
    updateStateMachine.transition('rolled_back')
    expect(updateStateMachine.state).toBe('rolled_back')
  })

  // ── invalid transitions ──────────────────────────────────────

  it('throws on an invalid transition (idle → installing)', () => {
    expect(() => updateStateMachine.transition('installing')).toThrow(
      /Invalid state transition/,
    )
  })

  it('throws on jumping ahead (checking → completed)', () => {
    updateStateMachine.start()
    expect(() => updateStateMachine.transition('completed')).toThrow(
      /Invalid state transition/,
    )
  })

  it('throws on transition from a terminal state without reset (completed → checking)', () => {
    reach('completed')
    expect(() => updateStateMachine.transition('checking')).toThrow(
      /Invalid state transition/,
    )
  })

  it('throws on transition from failed → receiving (not in allowed set)', () => {
    updateStateMachine.start()
    updateStateMachine.transition('requesting_ai')
    updateStateMachine.fail({ code: 'UPDATE_SCHEMA_INVALID', message: 'x', retryable: false })
    expect(() => updateStateMachine.transition('receiving')).toThrow(
      /Invalid state transition/,
    )
  })

  // ── double-operation prevention ──────────────────────────────

  it('prevents a second start() while an operation is running', () => {
    updateStateMachine.start()
    expect(() => updateStateMachine.start()).toThrow(/already in progress/)
    expect(updateStateMachine.isRunning).toBe(true)
  })

  it('allows start() again after reset from a terminal state', () => {
    reach('rolled_back')
    updateStateMachine.reset()
    expect(() => updateStateMachine.start()).not.toThrow()
  })

  // ── state after failure ───────────────────────────────────────

  it('records the error object on fail()', () => {
    updateStateMachine.start()
    updateStateMachine.transition('requesting_ai')
    const error = { code: 'UPDATE_NETWORK_FAILED' as const, message: 'boom', retryable: true }
    updateStateMachine.fail(error)
    expect(updateStateMachine.state).toBe('failed')
    expect(updateStateMachine.error).toEqual(error)
    expect(updateStateMachine.current.error).toEqual(error)
  })

  it('fail() from failed throws and keeps the first error', () => {
    updateStateMachine.start()
    updateStateMachine.transition('requesting_ai')
    updateStateMachine.transition('receiving')
    const e1 = { code: 'UPDATE_AI_JSON_INVALID' as const, message: 'first', retryable: true }
    updateStateMachine.fail(e1)
    // failing again from 'failed' isn't a valid transition, so it throws,
    // but the state + error remain from the first failure.
    expect(() =>
      updateStateMachine.fail({ code: 'UPDATE_SCHEMA_INVALID', message: 'second', retryable: false }),
    ).toThrow()
    expect(updateStateMachine.error).toEqual(e1)
  })

  // ── state after completion ───────────────────────────────────

  it('reaches completed and exposes a non-running flag', () => {
    reach('completed')
    expect(updateStateMachine.state).toBe('completed')
    expect(updateStateMachine.isRunning).toBe(false)
  })

  // ── reset behavior ────────────────────────────────────────────

  it('reset() throws while an operation is actively running', () => {
    updateStateMachine.start()
    updateStateMachine.transition('requesting_ai')
    expect(() => updateStateMachine.reset()).toThrow(/Cannot reset/)
  })

  it('reset() from idle is a no-op and stays idle', () => {
    expect(updateStateMachine.state).toBe('idle')
    updateStateMachine.reset()
    expect(updateStateMachine.state).toBe('idle')
  })

  it('reset() clears error and assigns a new operation id', () => {
    updateStateMachine.start()
    updateStateMachine.transition('requesting_ai')
    updateStateMachine.transition('receiving')
    updateStateMachine.fail({ code: 'UPDATE_AI_JSON_INVALID', message: 'x', retryable: true })
    const failedId = updateStateMachine.current.id
    updateStateMachine.reset()
    expect(updateStateMachine.state).toBe('idle')
    expect(updateStateMachine.error).toBeUndefined()
    expect(updateStateMachine.current.id).not.toBe(failedId)
  })

  it('interrupt() moves a running op to interrupted and is a no-op when terminal', () => {
    updateStateMachine.start()
    updateStateMachine.transition('requesting_ai')
    updateStateMachine.transition('receiving')
    updateStateMachine.interrupt()
    expect(updateStateMachine.state).toBe('interrupted')
    // already terminal → no-op
    updateStateMachine.interrupt()
    expect(updateStateMachine.state).toBe('interrupted')
  })

  // ── events ───────────────────────────────────────────────────

  it('emits a progress event on every transition', () => {
    const seen: string[] = []
    const off = updateStateMachine.onStateChange((e) => {
      seen.push(`${e.detail.from}→${e.detail.to}`)
    })
    updateStateMachine.start() // idle → checking
    updateStateMachine.transition('requesting_ai')
    off()
    expect(seen).toEqual(['idle→checking', 'checking→requesting_ai'])
  })

  it('unsubscribe stops events', () => {
    let count = 0
    const off = updateStateMachine.onStateChange(() => count++)
    updateStateMachine.start()
    off()
    updateStateMachine.reset()
    updateStateMachine.start()
    expect(count).toBe(1)
  })

  it('is a singleton (same instance across imports)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { updateStateMachine: again } = require('./updateStateMachine')
    expect(again).toBe(updateStateMachine)
  })
})
