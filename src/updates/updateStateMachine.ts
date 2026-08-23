/**
 * Central state machine for database update operations.
 *
 * A single instance (`updateStateMachine`) tracks the lifecycle of one update
 * operation at a time. It enforces:
 *   - valid state transitions (throws on illegal moves),
 *   - single-flight (rejects a new operation while one is still running),
 *   - EventTarget-based progress notifications,
 *   - a reset path back to `idle`.
 *
 * The machine owns no IO. It only transitions state and records the last
 * error / package. The `UpdateService` drives it.
 */

import type {
  UpdateState,
  UpdateOperation,
  UpdateError,
  UpdateProgressEvent,
  UpdateStateListener,
} from './updateTypes'

const EVENT_TYPE = 'update:progress'

/**
 * Allowed transitions. Every state maps to the set of states it may move to
 * directly. Anything not listed throws `Error('Invalid state transition …')`.
 */
const TRANSITIONS: Readonly<Record<UpdateState, readonly UpdateState[]>> = {
  idle: ['checking', 'interrupted'],
  checking: ['requesting_ai', 'failed', 'interrupted'],
  requesting_ai: ['receiving', 'failed', 'interrupted'],
  receiving: ['normalizing', 'failed', 'interrupted'],
  normalizing: ['parsing', 'failed', 'interrupted'],
  parsing: ['validating', 'failed', 'interrupted'],
  validating: ['sandboxing', 'awaiting_review', 'failed', 'interrupted'],
  sandboxing: ['awaiting_review', 'failed', 'interrupted'],
  awaiting_review: ['installing', 'failed', 'interrupted', 'rolled_back'],
  installing: ['verifying', 'failed', 'interrupted', 'rolled_back'],
  verifying: ['completed', 'failed', 'interrupted', 'rolled_back'],
  completed: ['idle'],
  failed: ['idle', 'checking'],
  interrupted: ['idle', 'rolled_back', 'checking'],
  rolled_back: ['idle'],
}

/** States from which a brand-new operation may begin. */
const STARTABLE_STATES: ReadonlySet<UpdateState> = new Set<UpdateState>([
  'idle',
  'failed',
  'completed',
  'interrupted',
  'rolled_back',
])

/** States that mean an operation is still in flight (not terminal). */
const ACTIVE_STATES: ReadonlySet<UpdateState> = new Set<UpdateState>([
  'checking',
  'requesting_ai',
  'receiving',
  'normalizing',
  'parsing',
  'validating',
  'sandboxing',
  'awaiting_review',
  'installing',
  'verifying',
])

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

class UpdateStateMachine extends EventTarget {
  private operation: UpdateOperation = {
    id: makeId(),
    state: 'idle',
    startedAt: Date.now(),
    updatedAt: Date.now(),
  }

  /** True when an operation is mid-flight (not in a terminal/startable state). */
  get isRunning(): boolean {
    return ACTIVE_STATES.has(this.operation.state)
  }

  get current(): UpdateOperation {
    return { ...this.operation }
  }

  get state(): UpdateState {
    return this.operation.state
  }

  get error(): UpdateError | undefined {
    return this.operation.error
  }

  /**
   * Begin a new operation. Rejects (throws) if an operation is already
   * running — callers should catch and surface the conflict themselves, or
   * call `reset()` first.
   */
  start(): UpdateOperation {
    if (!STARTABLE_STATES.has(this.operation.state)) {
      throw new Error(
        `Cannot start update: an operation is already in progress (state "${this.operation.state}")`,
      )
    }
    this.operation = {
      id: makeId(),
      state: 'idle',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    }
    // Transition straight into `checking` — `idle` only exists as the pre-start
    // state for a fresh operation record.
    this.transition('checking')
    return this.current
  }

  /**
   * Move to `to`. Throws if the transition is not allowed.
   * Records an error on the operation when moving to `failed`.
   */
  transition(to: UpdateState, error?: UpdateError): UpdateOperation {
    const from = this.operation.state
    const allowed = TRANSITIONS[from]
    if (!allowed || !allowed.includes(to)) {
      throw new Error(`Invalid state transition: ${from} → ${to}`)
    }

    this.operation = {
      ...this.operation,
      state: to,
      updatedAt: Date.now(),
      error: to === 'failed' ? error ?? this.operation.error : this.operation.error,
    }

    this.dispatch(from, to)
    return this.current
  }

  /** Convenience: record a failure and land in the `failed` state. */
  fail(error: UpdateError): UpdateOperation {
    return this.transition('failed', error)
  }

  /**
   * Reset back to `idle`, clearing the operation record. Allowed from any
   * terminal state (`completed`, `failed`, `interrupted`, `rolled_back`) or
   * `idle` itself. Throws if an operation is still actively running — call
   * `interrupt()` first to abandon it.
   */
  reset(): UpdateOperation {
    if (this.isRunning) {
      throw new Error(
        `Cannot reset while an operation is running (state "${this.operation.state}"). Call interrupt() first.`,
      )
    }
    this.operation = {
      id: makeId(),
      state: 'idle',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    }
    return this.current
  }

  /**
   * Abandon a running operation, moving to `interrupted`. Allowed from any
   * active state. No-op if already in a terminal state.
   */
  interrupt(): UpdateOperation {
    if (!this.isRunning) return this.current
    this.transition('interrupted')
    return this.current
  }

  /** Attach typed progress listener. Returns an unsubscribe function. */
  onStateChange(listener: UpdateStateListener): () => void {
    const handler = (e: Event) => listener(e as UpdateProgressEvent)
    this.addEventListener(EVENT_TYPE, handler)
    return () => this.removeEventListener(EVENT_TYPE, handler)
  }

  /** Update the in-memory operation record (context / package) without a
   *  state change. Used by the service to stash context as it is gathered. */
  setContext(ctx: UpdateOperation['context']): void {
    this.operation = { ...this.operation, context: ctx, updatedAt: Date.now() }
  }

  setPackage(pkg: UpdateOperation['package']): void {
    this.operation = { ...this.operation, package: pkg, updatedAt: Date.now() }
  }

  private dispatch(from: UpdateState, to: UpdateState): void {
    const event = new Event(EVENT_TYPE) as UpdateProgressEvent
    Object.defineProperty(event, 'detail', {
      value: {
        operationId: this.operation.id,
        from,
        to,
        operation: this.current,
        timestamp: Date.now(),
      },
      writable: false,
      configurable: false,
      enumerable: true,
    })
    this.dispatchEvent(event)
  }
}

/** Singleton — the single source of truth for update operation state. */
export const updateStateMachine = new UpdateStateMachine()

export { UpdateStateMachine, EVENT_TYPE as UPDATE_PROGRESS_EVENT_TYPE }
