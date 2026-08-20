/**
 * Shared closure-run bookkeeping for the fixture's REAL task handlers. Tests
 * and the executor share the main worker's isolate under the workers pool, so
 * module-level state written by a handler closure is readable from tests —
 * that is how "this closure executed exactly once" is proven (docs/testing.md).
 *
 * Counters are keyed by the step idempotency key (`${taskId}:${stepName}`),
 * so per-test unique taskIds keep tests independent without resets.
 */

const closureRuns = new Map<string, number>();

/** Records one closure execution under the step's idempotency key. */
export function recordRun(idempotencyKey: string): number {
  const next = (closureRuns.get(idempotencyKey) ?? 0) + 1;
  closureRuns.set(idempotencyKey, next);
  return next;
}

/** How many times the closure keyed by `${taskId}:${stepName}` executed. */
export function runCount(idempotencyKey: string): number {
  return closureRuns.get(idempotencyKey) ?? 0;
}
