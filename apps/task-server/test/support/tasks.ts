/**
 * Task-flow helpers for the integration suite. The app exports the library
 * TaskRunner untouched (PRODUCTION scheduling — immediate wakes), so workerd
 * fires genuinely-due alarms on its own here; a pure `runDurableObjectAlarm`
 * drain loop can observe "no alarm pending" while an engine attempt is still
 * in flight. `drainTaskUntil` therefore combines deterministic alarm ticks
 * (which fire not-yet-due execution wakes such as `step.sleep` early) with
 * bounded polling of the wire snapshot — the same wait pattern the package's
 * own production-scheduling e2e uses. Elicit deadlines are the exception:
 * they are wall-clock honest, so an early tick never times an ask out.
 */

import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { getTaskResultSchema } from "durable-mcp-server";
import { z } from "zod";
import { callResult } from "./jsonrpc";

export type TaskSnapshot = z.output<typeof getTaskResultSchema>;

/** `tasks/get` over the wire, validated with the package's wire schema. */
export async function getTask(taskId: string): Promise<TaskSnapshot> {
  return getTaskResultSchema.parse(await callResult("tasks/get", { taskId }));
}

export interface DrainOptions {
  timeoutMs?: number;
  /** Called with every polled snapshot, e.g. to collect statusMessages. */
  observe?: (snapshot: TaskSnapshot) => void;
}

/**
 * Drives the task's alarm chain with `runDurableObjectAlarm` until the wire
 * snapshot reaches one of the wanted statuses.
 */
export async function drainTaskUntil(
  taskId: string,
  statuses: readonly TaskSnapshot["status"][],
  options?: DrainOptions,
): Promise<TaskSnapshot> {
  const timeoutMs = options?.timeoutMs ?? 15_000;
  const stub = env.TASK_RUNNER.getByName(taskId); // per-task DO: taskId IS the DO name (D2)
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await runDurableObjectAlarm(stub);
    const snapshot = await getTask(taskId);
    options?.observe?.(snapshot);
    if (statuses.includes(snapshot.status)) {
      return snapshot;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `task "${taskId}" did not reach ${statuses.join("/")} within ${timeoutMs}ms ` +
          `(last status: ${snapshot.status})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
