/**
 * Deterministic alarm drivers (docs/testing.md, design/002 §5).
 *
 * `runDurableObjectAlarm` deletes the pending alarm and invokes `alarm()`
 * regardless of its scheduled time. Execution wakes (claims, step retries,
 * sleep wakes) are due-on-fire, so the drain loop walks the engine's own
 * persisted schedule step by step. TTL/expiry/purge deadlines are
 * wall-clock-honest: an early fire re-arms without acting — so the loop also
 * stops when a tick changes nothing observable (task row, journal, input
 * requests, alarm), which is exactly the "only future deadlines remain"
 * state. (This is the one adaptation over the RFC's naive loop.)
 */

import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { TaskRunner } from "../../src";

export interface DrainOptions {
  /** Safety valve: throw if the chain has not quiesced after this many ticks. */
  max?: number;
  /** Defaults to the fixture's TASK_RUNNER namespace. */
  namespace?: DurableObjectNamespace<TaskRunner>;
}

/** Snapshot of everything an alarm tick could observably change. */
export async function taskStateSnapshot(stub: DurableObjectStub<TaskRunner>): Promise<string> {
  return runInDurableObject(stub, async (_instance, state) => {
    const alarm = await state.storage.getAlarm();
    const dump = (table: string): unknown => {
      try {
        return state.storage.sql.exec(`SELECT * FROM ${table}`).toArray();
      } catch {
        return "missing";
      }
    };
    return JSON.stringify({
      alarm,
      task: dump("task"),
      steps: dump("steps"),
      inputRequests: dump("input_requests"),
    });
  });
}

export function taskStub(
  taskId: string,
  namespace?: DurableObjectNamespace<TaskRunner>,
): DurableObjectStub<TaskRunner> {
  const ns = namespace ?? env.TASK_RUNNER;
  return ns.getByName(taskId); // per-task DO: taskId IS the DO name (D2)
}

/** Drains the task's alarm chain until it quiesces. */
export async function drainTaskAlarms(taskId: string, options?: DrainOptions): Promise<void> {
  const stub = taskStub(taskId, options?.namespace);
  const max = options?.max ?? 100;
  let before = await taskStateSnapshot(stub);
  for (let i = 0; i < max; i++) {
    const ran = await runDurableObjectAlarm(stub);
    if (!ran) {
      return; // no alarm pending
    }
    const after = await taskStateSnapshot(stub);
    if (after === before) {
      return; // only future wall-clock deadlines remain
    }
    before = after;
  }
  throw new Error(`alarm chain for task "${taskId}" did not quiesce after ${max} ticks`);
}
