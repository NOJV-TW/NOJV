/**
 * Pure helpers for `examAutoCloseWorkflow`. Kept in a separate
 * module so unit tests can import them without transitively pulling
 * in `@temporalio/workflow`, which throws `IllegalStateError` when
 * its runtime primitives are called outside a workflow sandbox.
 */

/**
 * How many ms to sleep before running the auto-close.
 *
 * If `endsAt` is already in the past, returns `0` so the workflow
 * skips the sleep and runs the close straight away.
 *
 * `nowMs` defaults to `Date.now()`. Inside a workflow execution this
 * is the Temporal-patched clock, which reads from workflow history
 * so the timer is deterministic across replays.
 */
export function computeAutoCloseDelayMs(endsAt: string, nowMs: number = Date.now()): number {
  return Math.max(0, new Date(endsAt).getTime() - nowMs);
}
