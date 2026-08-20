/**
 * The one wrapper through which the worker talks to TaskRunner (docs/how-it-works.md
 * §6.1). Package rule: never call a DO stub method bare — DO networking is
 * unreliable and retried methods are idempotent by design.
 *
 * Correction over upstream durable-utils (which reuses one stub across
 * attempts): Cloudflare's error-handling guidance mandates a FRESH stub per
 * attempt, since many exceptions leave the stub in a broken state — so the
 * stub is constructed inside the retried closure.
 */

import type { TaskRunner } from "../do/task-runner";
import { isErrorRetryable, tryWhile } from "../vendor/retries";

const MAX_ATTEMPTS = 4;

/**
 * Calls a TaskRunner method with retries, constructing a fresh stub for every
 * attempt. Retries only errors workerd marks `.retryable` (and not
 * `.overloaded`), up to 4 attempts with 100ms–3s full-jitter backoff.
 */
export async function callTaskRunner<T>(
  ns: DurableObjectNamespace<TaskRunner>,
  taskId: string,
  fn: (stub: DurableObjectStub<TaskRunner>, attempt: number) => Promise<T>,
): Promise<T> {
  return tryWhile(
    (attempt) => fn(ns.getByName(taskId), attempt),
    (err, next) => next <= MAX_ATTEMPTS && isErrorRetryable(err),
    { baseDelayMs: 100, maxDelayMs: 3_000 },
  );
}
